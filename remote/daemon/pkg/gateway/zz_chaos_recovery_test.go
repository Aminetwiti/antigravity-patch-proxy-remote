package gateway

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/antigravity/remote-daemon/pkg/domain"
	"github.com/antigravity/remote-daemon/pkg/eventstore"
)

// TestChaosRecovery_24_7_Durability demonstrates complete 24/7 runtime resilience conforming to Staff Engineer standards:
// 1. Crash/reboot durability: Event sourcing replay works directly from SQLite when RAM buffer is completely cold.
// 2. Persistent idempotency: Commands registered before daemon reboot are deduplicated immediately upon client retry.
// 3. Optimistic concurrency control: Atomic SQL version increments prevent concurrent split-brain writes.
func TestChaosRecovery_24_7_Durability(t *testing.T) {
	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "chaos_durability.db")

	// --- PHASE 1: Active session writing to SQLite ---
	store, err := eventstore.NewSQLiteEventStore(dbPath)
	if err != nil {
		t.Fatalf("failed to initialize SQLite event store: %v", err)
	}

	sessID := "sess-24-7-chaos"
	err = store.CreateSession(ctx, &domain.Session{
		ID:          sessID,
		ServerID:    "srv_prod_1",
		WorkspaceID: "ws_default",
		Title:       "24/7 Resilience Session",
		State:       domain.SessionStateRunning,
		Version:     1,
	})
	if err != nil {
		t.Fatalf("failed to create initial session: %v", err)
	}
	// Transition CREATED -> STARTING -> RUNNING (valid FSM path)
	if err := store.UpdateSessionStateWithVersion(ctx, sessID, domain.SessionStateStarting, 1); err != nil {
		t.Fatalf("failed to transition to STARTING: %v", err)
	}
	if err := store.UpdateSessionStateWithVersion(ctx, sessID, domain.SessionStateRunning, 2); err != nil {
		t.Fatalf("failed to transition to RUNNING: %v", err)
	}

	// Emit 4 sequential events
	_, err = store.AppendEvent(ctx, sessID, "evt_1", "session.created", []byte(`{"status":"created"}`))
	if err != nil {
		t.Fatalf("failed to append evt_1: %v", err)
	}
	_, err = store.AppendEvent(ctx, sessID, "evt_2", "agent.thinking", []byte(`{"thought":"examining codebase"}`))
	if err != nil {
		t.Fatalf("failed to append evt_2: %v", err)
	}
	_, err = store.AppendEvent(ctx, sessID, "evt_3", "tool.call", []byte(`{"tool":"git_diff"}`))
	if err != nil {
		t.Fatalf("failed to append evt_3: %v", err)
	}
	_, err = store.AppendEvent(ctx, sessID, "evt_4", "tool.result", []byte(`{"diff":"+clean"}`))
	if err != nil {
		t.Fatalf("failed to append evt_4: %v", err)
	}

	// Capture snapshot at sequence 4
	err = store.SaveSnapshot(ctx, &domain.Snapshot{
		SessionID:  sessID,
		Sequence:   4,
		State:      domain.SessionStateRunning,
		Title:      "24/7 Resilience Session",
		CapturedAt: time.Now(),
	})
	if err != nil {
		t.Fatalf("failed to save snapshot: %v", err)
	}

	// Register a persistent command in DB
	persistedCmdID := "cmd_pre_reboot_999"
	sigPreReboot := CalculateSignature("send_prompt", map[string]interface{}{
		"cascadeId": sessID,
		"prompt":    "hello again",
		"hasMedia":  false,
	})
	err = store.RegisterCommand(ctx, &domain.CommandRecord{
		CommandID:   persistedCmdID,
		SessionID:   sessID,
		ActorID:     "remote_phone",
		CommandType: "send_prompt",
		PayloadHash: sigPreReboot,
		Status:      "accepted",
		CreatedAt:   time.Now().UnixMilli(),
	})
	if err != nil {
		t.Fatalf("failed to register pre-reboot command: %v", err)
	}

	// --- PHASE 2: SIMULATE BRUTAL DAEMON REBOOT (kill process & memory) ---
	_ = store.Close()

	// Fresh startup from disk
	rebootedStore, err := eventstore.NewSQLiteEventStore(dbPath)
	if err != nil {
		t.Fatalf("failed to reload SQLite event store after reboot: %v", err)
	}
	defer rebootedStore.Close()

	// Instantiate new gateway server with fresh, cold in-memory buffers
	gw := NewServer(&fakeRPCClient{}, "")
	gw.SetEventStore(rebootedStore)

	// Invariant Check: Memory cache is completely cold (0 events in RAM)
	if lastIdx := gw.streamBuffer.LastStepIndex(sessID); lastIdx != 0 {
		t.Fatalf("expected RAM buffer stepIndex to be 0 after reboot, got: %d", lastIdx)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", gw.HandleWebSocket)
	ts := httptest.NewServer(mux)
	defer ts.Close()

	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws"
	client := dialWS(t, wsURL)
	defer client.conn.Close()

	// --- PHASE 3: VERIFY CATCHUP EVENT REPLAY ON COLD MEMORY ---
	// Client reconnects asking for missed events since step 1
	syncReq := `{"type":"sync_session","requestId":"req_sync_reboot","cascadeId":"sess-24-7-chaos","lastStepIndex":1}`
	client.sendRaw(t, syncReq)

	msg := client.recv(t)
	if msg["type"] != "sync_catchup" {
		t.Fatalf("expected sync_catchup from cold DB, got: %v (error: %v)", msg["type"], msg["error"])
	}

	data, _ := msg["data"].(map[string]interface{})
	if data == nil {
		data, _ = msg["Data"].(map[string]interface{})
	}
	if data == nil {
		t.Fatalf("missing data in sync_catchup: %v", msg)
	}

	missedEvents, _ := data["missedEvents"].([]interface{})
	// Expecting 3 events: sequence 2, 3, and 4
	if len(missedEvents) != 3 {
		t.Fatalf("expected 3 missed events fetched from SQLite, got: %d", len(missedEvents))
	}

	currStepIndex, _ := data["currentStepIndex"].(float64)
	if int64(currStepIndex) != 4 {
		t.Errorf("expected currentStepIndex 4, got: %v", currStepIndex)
	}

	snapshot, _ := data["snapshot"].(map[string]interface{})
	if snapshot == nil {
		t.Errorf("expected snapshot retrieved from SQLite, got nil")
	} else {
		snapSeq, _ := snapshot["sequence"].(float64)
		if int64(snapSeq) != 4 {
			t.Errorf("expected snapshot sequence 4, got: %v", snapSeq)
		}
	}

	// --- PHASE 4: VERIFY CROSS-REBOOT COMMAND IDEMPOTENCY ---
	// Client retransmits the same command ID after reboot
	dupCmd := `{"type":"send_prompt","requestId":"req_retry_reboot","commandId":"cmd_pre_reboot_999","cascadeId":"sess-24-7-chaos","prompt":"hello again"}`
	client.sendRaw(t, dupCmd)

	dupResp := client.recv(t)
	if dupResp["type"] != "response" {
		t.Fatalf("expected response type, got: %v", dupResp["type"])
	}
	respData, _ := dupResp["data"].(map[string]interface{})
	if respData == nil {
		t.Fatalf("expected response data, got nil: %v", dupResp)
	}
	if respData["deduplicated"] != true {
		t.Errorf("expected deduplicated=true after reboot, got: %v", respData["deduplicated"])
	}
	if respData["commandId"] != persistedCmdID {
		t.Errorf("expected commandId %s, got: %v", persistedCmdID, respData["commandId"])
	}
	if respData["status"] != "accepted" {
		t.Errorf("expected status 'accepted', got: %v", respData["status"])
	}

	// --- PHASE 5: VERIFY OPTIMISTIC CONCURRENCY PROTECTION ---
	// Atomic version update with correct expected version (3)
	err = rebootedStore.UpdateSessionStateWithVersion(ctx, sessID, domain.SessionStateWaitingInput, 3)
	if err != nil {
		t.Fatalf("expected successful state update with version 3, got error: %v", err)
	}

	// Stale concurrent update using old version (3) must fail with ErrVersionConflict
	err = rebootedStore.UpdateSessionStateWithVersion(ctx, sessID, domain.SessionStateRunning, 3)
	if !errors.Is(err, domain.ErrVersionConflict) {
		t.Fatalf("expected ErrVersionConflict on stale version, got: %v", err)
	}

	// Valid update using new incremented version (4) succeeds
	err = rebootedStore.UpdateSessionStateWithVersion(ctx, sessID, domain.SessionStateRunning, 4)
	if err != nil {
		t.Fatalf("expected successful update with version 4, got: %v", err)
	}
}
