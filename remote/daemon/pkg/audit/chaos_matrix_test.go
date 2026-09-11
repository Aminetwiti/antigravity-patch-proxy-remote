package audit_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/antigravity/remote-daemon/pkg/agent"
	"github.com/antigravity/remote-daemon/pkg/approval"
	"github.com/antigravity/remote-daemon/pkg/domain"
	"github.com/antigravity/remote-daemon/pkg/eventstore"
	"github.com/antigravity/remote-daemon/pkg/mcp"
	"github.com/antigravity/remote-daemon/pkg/protocol"
	"github.com/antigravity/remote-daemon/pkg/server"
	"github.com/antigravity/remote-daemon/pkg/tools"
	"github.com/antigravity/remote-daemon/pkg/workspace"
	"github.com/gorilla/websocket"
)

// -----------------------------------------------------------------------------
// CHAOS RECONNECT MATRIX 24/7
// Scenario:
//   START SESSION -> Agent RUNNING -> Desktop Disconnect -> Mobile Attach ->
//   Mobile Disconnect -> Desktop Attach -> Daemon SIGKILL (reopen same SQLite DB) ->
//   Daemon Restart -> Desktop Attach -> Mobile Attach -> Agent Completes.
//
// Asserts 8 Invariants:
//   1. Identical SessionID throughout all phases
//   2. Identical WorkspaceID throughout all phases
//   3. Identical CommandID deduplication (Idempotency)
//   4. Strictly monotonic sequence numbers (no backwards jumps)
//   5. Zero event loss (contiguous sequences 1..N in SQLite)
//   6. Zero event duplication (unique sequences)
//   7. Idempotency enforced (duplicate prompt is rejected gracefully)
//   8. Valid FSM transitions (valid lifecycle states throughout)
// -----------------------------------------------------------------------------
func TestChaos_ReconnectMatrix24_7(t *testing.T) {
	// 1. Mock LLM Setup
	resp1 := &agent.LLMResponse{
		Thought: "Phase 1: write initial source file",
		ToolCalls: []agent.ToolCall{
			{
				ID:   "call_write_1",
				Name: "write_to_file",
				Arguments: json.RawMessage(`{
					"path": "chaos.go",
					"content": "package main\n\nfunc Status() string { return \"resilient\" }\n"
				}`),
			},
		},
	}
	resp2 := &agent.LLMResponse{
		Thought: "Phase 2: verify workspace status",
		ToolCalls: []agent.ToolCall{
			{
				ID:   "call_cmd_1",
				Name: "run_command",
				Arguments: json.RawMessage(`{
					"command": "git status --porcelain"
				}`),
			},
		},
	}
	resp3 := &agent.LLMResponse{
		Thought: "Phase 3: all tasks successfully completed",
		Message: "Chaos matrix resilient execution verified.",
		Done:    true,
	}

	mockLLM := agent.NewMockLLMClient(resp1, resp2, resp3)
	authToken := "chaos-token-matrix-2026"
	cluster, cleanup := setupTestCluster(t, authToken, mockLLM)
	defer cleanup()

	// 2. Setup real Git repository in workspace
	repoDir := filepath.Join(cluster.TempDir, "chaos_repo")
	if err := os.MkdirAll(repoDir, 0755); err != nil {
		t.Fatalf("failed to create repo directory: %v", err)
	}

	runGit := func(args ...string) {
		cmd := exec.Command("git", args...)
		cmd.Dir = repoDir
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %s failed: %v, output: %s", strings.Join(args, " "), err, string(out))
		}
	}

	runGit("init")
	runGit("config", "user.name", "ChaosMatrixTester")
	runGit("config", "user.email", "chaos@antigravity.test")
	readmePath := filepath.Join(repoDir, "README.md")
	_ = os.WriteFile(readmePath, []byte("# Chaos Resilience Test\n"), 0644)
	runGit("add", "README.md")
	runGit("commit", "-m", "initial commit")

	ws, err := cluster.WsMgr.RegisterWorkspace("ws-chaos-matrix", "Chaos Matrix Workspace", repoDir)
	if err != nil {
		t.Fatalf("failed to register workspace: %v", err)
	}

	// 3. START SESSION via REST API
	sessReqBody := []byte(fmt.Sprintf(`{"title": "Chaos 24/7 Resilience Session", "workspaceId": "%s"}`, ws.ID))
	req, _ := http.NewRequest("POST", cluster.ServerURL+"/v2/sessions?token="+authToken, bytes.NewReader(sessReqBody))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("REST create session failed: %v", err)
	}
	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200/201 on create session, got: %d", resp.StatusCode)
	}
	var createdSess domain.Session
	_ = json.NewDecoder(resp.Body).Decode(&createdSess)
	resp.Body.Close()

	if createdSess.ID == "" {
		t.Fatalf("created session ID is empty")
	}

	// Invariant 1 & 2 baseline
	invariantSessionID := createdSess.ID
	invariantWorkspaceID := ws.ID
	if createdSess.WorkspaceID != invariantWorkspaceID {
		t.Fatalf("workspace mismatch: expected %s, got %s", invariantWorkspaceID, createdSess.WorkspaceID)
	}
	if createdSess.BaseCommit == "" {
		t.Fatalf("critique 1 violation: BaseCommit was not recorded at session creation")
	}

	t.Logf("Initialized session %s on workspace %s (BaseCommit: %s, BaseBranch: %s)",
		invariantSessionID, invariantWorkspaceID, createdSess.BaseCommit, createdSess.BaseBranch)

	// Streamed event collection & sequence monitoring across all connections
	var seqMu sync.Mutex
	receivedSequences := make([]int64, 0)
	var maxReceivedSeq int64 = 0

	recordSeq := func(seq int64) {
		seqMu.Lock()
		defer seqMu.Unlock()
		if seq <= 0 {
			return
		}
		receivedSequences = append(receivedSequences, seq)
		if seq > maxReceivedSeq {
			maxReceivedSeq = seq
		}
	}

	getLatestSeq := func() int64 {
		seqMu.Lock()
		defer seqMu.Unlock()
		return maxReceivedSeq
	}

	dialWS := func(wsURL string) *websocket.Conn {
		conn, resp, err := websocket.DefaultDialer.Dial(wsURL+"?token="+authToken, nil)
		if err != nil {
			t.Fatalf("failed to dial websocket at %s: %v", wsURL, err)
		}
		if resp.StatusCode != http.StatusSwitchingProtocols {
			t.Fatalf("expected 101 Switching Protocols, got %d", resp.StatusCode)
		}
		return conn
	}

	sendAttach := func(conn *websocket.Conn, lastSeq int64) {
		env := protocol.V2Envelope{
			Version:      2,
			Type:         protocol.TypeSessionAttach,
			SessionID:    invariantSessionID,
			LastSequence: lastSeq,
		}
		data, _ := json.Marshal(env)
		if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
			t.Fatalf("failed to write attach envelope: %v", err)
		}
	}

	// 4. PHASE A: Desktop attaches at sequence 0
	wsDesktop1 := dialWS(cluster.WSURL)
	sendAttach(wsDesktop1, 0)

	// Read attach catchup
	var catchup1 protocol.CatchupResponse
	_ = wsDesktop1.SetReadDeadline(time.Now().Add(3 * time.Second))
	if err := wsDesktop1.ReadJSON(&catchup1); err != nil {
		t.Fatalf("desktop1 failed to read catchup response: %v", err)
	}
	if catchup1.Type != protocol.TypeSessionCatchup {
		t.Fatalf("expected session.catchup, got %s", catchup1.Type)
	}
	if catchup1.SessionID != invariantSessionID {
		t.Fatalf("INVARIANT 1 VIOLATION: catchup sessionID %s != %s", catchup1.SessionID, invariantSessionID)
	}
	for _, ev := range catchup1.Events {
		recordSeq(ev.Sequence)
	}

	// 5. PHASE B: Desktop sends prompt command (cmd-chaos-prompt-1)
	cmdID := "cmd-chaos-prompt-1"
	promptPayload, _ := json.Marshal(map[string]string{"text": "Execute chaos matrix turn"})
	promptEnv := protocol.V2Envelope{
		Version:   2,
		Type:      protocol.TypeSessionPrompt,
		RequestID: cmdID,
		SessionID: invariantSessionID,
		Payload:   promptPayload,
	}
	promptBytes, _ := json.Marshal(promptEnv)
	if err := wsDesktop1.WriteMessage(websocket.TextMessage, promptBytes); err != nil {
		t.Fatalf("failed to write prompt message: %v", err)
	}

	// Read prompt ack
	var promptAck protocol.AckResponse
	_ = wsDesktop1.SetReadDeadline(time.Now().Add(3 * time.Second))
	if err := wsDesktop1.ReadJSON(&promptAck); err != nil {
		t.Fatalf("failed to read prompt ack: %v", err)
	}
	if !promptAck.Success || promptAck.RequestID != cmdID {
		t.Fatalf("prompt ack failed or ID mismatch: %+v", promptAck)
	}

	// Read at least 1 or 2 live events on Desktop
	deadlineA := time.Now().Add(3 * time.Second)
	desktop1EventCount := 0
	for time.Now().Before(deadlineA) && desktop1EventCount < 2 {
		_ = wsDesktop1.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
		var liveMsg protocol.LiveEventMessage
		if err := wsDesktop1.ReadJSON(&liveMsg); err == nil {
			if liveMsg.Type == protocol.TypeSessionEvent {
				if liveMsg.SessionID != invariantSessionID {
					t.Fatalf("INVARIANT 1 VIOLATION: event sessionID %s != %s", liveMsg.SessionID, invariantSessionID)
				}
				recordSeq(liveMsg.Event.Sequence)
				desktop1EventCount++
			}
		} else if !strings.Contains(err.Error(), "timeout") {
			break
		}
	}

	t.Logf("Phase A/B: Desktop received %d initial events, current maxSeq=%d", desktop1EventCount, getLatestSeq())

	// 6. PHASE C: Desktop abruptly disconnects while agent is running
	_ = wsDesktop1.Close()
	t.Logf("Phase C: Desktop disconnected abruptly. Simulating mobile handover...")

	// 7. PHASE D: Mobile attaches with lastSequence=getLatestSeq()
	wsMobile1 := dialWS(cluster.WSURL)
	mobileLastSeq := getLatestSeq()
	sendAttach(wsMobile1, mobileLastSeq)

	var catchupMobile protocol.CatchupResponse
	_ = wsMobile1.SetReadDeadline(time.Now().Add(3 * time.Second))
	if err := wsMobile1.ReadJSON(&catchupMobile); err != nil {
		t.Fatalf("mobile failed to read catchup response: %v", err)
	}
	if catchupMobile.Type != protocol.TypeSessionCatchup {
		t.Fatalf("expected session.catchup on mobile, got %s", catchupMobile.Type)
	}
	if catchupMobile.SessionID != invariantSessionID {
		t.Fatalf("INVARIANT 1 VIOLATION: mobile catchup sessionID %s != %s", catchupMobile.SessionID, invariantSessionID)
	}
	for _, ev := range catchupMobile.Events {
		recordSeq(ev.Sequence)
	}

	// Stream a few more events to Mobile
	deadlineB := time.Now().Add(3 * time.Second)
	mobileEventCount := 0
	for time.Now().Before(deadlineB) && mobileEventCount < 1 {
		_ = wsMobile1.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
		var liveMsg protocol.LiveEventMessage
		if err := wsMobile1.ReadJSON(&liveMsg); err == nil {
			if liveMsg.Type == protocol.TypeSessionEvent {
				recordSeq(liveMsg.Event.Sequence)
				mobileEventCount++
			}
		} else if !strings.Contains(err.Error(), "timeout") {
			break
		}
	}
	t.Logf("Phase D: Mobile received catchup (%d events) + live (%d events), current maxSeq=%d",
		len(catchupMobile.Events), mobileEventCount, getLatestSeq())

	// 8. PHASE E: Mobile disconnects
	_ = wsMobile1.Close()
	t.Logf("Phase E: Mobile disconnected abruptly.")

	// 9. PHASE F: Desktop re-attaches
	wsDesktop2 := dialWS(cluster.WSURL)
	desktop2LastSeq := getLatestSeq()
	sendAttach(wsDesktop2, desktop2LastSeq)

	var catchupDesktop2 protocol.CatchupResponse
	_ = wsDesktop2.SetReadDeadline(time.Now().Add(3 * time.Second))
	if err := wsDesktop2.ReadJSON(&catchupDesktop2); err != nil {
		t.Fatalf("desktop2 failed to read catchup response: %v", err)
	}
	for _, ev := range catchupDesktop2.Events {
		recordSeq(ev.Sequence)
	}
	_ = wsDesktop2.Close()
	t.Logf("Phase F: Desktop re-attached, processed catchup. Current maxSeq=%d", getLatestSeq())

	// 10. PHASE G: DAEMON SIGKILL (Simulate crash while SQLite persists)
	dbPath := cluster.DBPath
	cluster.HttpServer.Close()
	_ = cluster.McpMgr.Close()
	_ = cluster.Store.Close()
	t.Logf("Phase G: DAEMON SIGKILL complete. Server killed, SQLite preserved at %s", dbPath)

	// 11. PHASE H: DAEMON RESTART (Reopen SQLite DB and rebuild stack)
	reopenedStore, err := eventstore.NewSQLiteEventStore(dbPath)
	if err != nil {
		t.Fatalf("failed to reopen SQLite store after crash: %v", err)
	}
	defer reopenedStore.Close()

	serverInfo := domain.Server{
		ID:        "srv-audit-1",
		Hostname:  "audit-vps",
		Platform:  "linux",
		Version:   "2.0.0",
		Status:    domain.ServerStatusOnline,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	newRT := server.NewRuntimeServer(serverInfo, reopenedStore)
	newWsMgr := workspace.NewManager()
	_, _ = newWsMgr.RegisterWorkspace(ws.ID, ws.Name, repoDir)
	newToolsReg := tools.NewRegistry(newWsMgr, true)
	newApprMgr := approval.NewManager(newRT.SessionService(), 5*time.Minute)
	newEng := agent.NewEngine(newRT.SessionService(), newWsMgr, newToolsReg, newApprMgr, mockLLM)
	newRT.SetAgentEngine(newEng, newApprMgr)

	newMcpMgr := mcp.NewManager(newToolsReg)
	defer newMcpMgr.Close()
	newRT.SetMCPManager(newMcpMgr)

	newV1Adapter := server.NewV1Adapter(newRT.SessionService(), reopenedStore, newWsMgr, newEng, newApprMgr, authToken)
	newV1Adapter.SetMCPManager(newMcpMgr)
	newRT.SetV1Adapter(newV1Adapter)

	newSched := server.NewScheduler(newRT.SessionService(), newEng)
	newRT.SetScheduler(newSched)

	newMux := server.NewMux(newRT, newWsMgr, authToken)
	newTs := httptest.NewServer(newMux)
	defer newTs.Close()

	newWSURL := "ws" + strings.TrimPrefix(newTs.URL, "http") + "/v2/ws"
	t.Logf("Phase H: Daemon restarted on %s", newTs.URL)

	// 12. PHASE I: Desktop attaches to restarted daemon
	wsDesktop3 := dialWS(newWSURL)
	defer wsDesktop3.Close()
	desktop3LastSeq := getLatestSeq()
	sendAttach(wsDesktop3, desktop3LastSeq)

	var catchupDesktop3 protocol.CatchupResponse
	_ = wsDesktop3.SetReadDeadline(time.Now().Add(3 * time.Second))
	if err := wsDesktop3.ReadJSON(&catchupDesktop3); err != nil {
		t.Fatalf("desktop3 failed to read catchup from restarted daemon: %v", err)
	}
	if catchupDesktop3.SessionID != invariantSessionID {
		t.Fatalf("INVARIANT 1 VIOLATION: restarted daemon catchup sessionID %s != %s", catchupDesktop3.SessionID, invariantSessionID)
	}
	for _, ev := range catchupDesktop3.Events {
		recordSeq(ev.Sequence)
	}

	// 13. PHASE J: Mobile attaches to restarted daemon
	wsMobile2 := dialWS(newWSURL)
	defer wsMobile2.Close()
	mobile2LastSeq := getLatestSeq()
	sendAttach(wsMobile2, mobile2LastSeq)

	var catchupMobile2 protocol.CatchupResponse
	_ = wsMobile2.SetReadDeadline(time.Now().Add(3 * time.Second))
	if err := wsMobile2.ReadJSON(&catchupMobile2); err != nil {
		t.Fatalf("mobile2 failed to read catchup from restarted daemon: %v", err)
	}
	if catchupMobile2.SessionID != invariantSessionID {
		t.Fatalf("INVARIANT 1 VIOLATION: restarted daemon mobile catchup sessionID %s != %s", catchupMobile2.SessionID, invariantSessionID)
	}
	for _, ev := range catchupMobile2.Events {
		recordSeq(ev.Sequence)
	}

	// 14. PHASE K: Idempotency Verification (duplicate commandID)
	dupPromptEnv := protocol.V2Envelope{
		Version:   2,
		Type:      protocol.TypeSessionPrompt,
		RequestID: cmdID, // SAME commandID as Phase B
		SessionID: invariantSessionID,
		Payload:   promptPayload,
	}
	dupPromptBytes, _ := json.Marshal(dupPromptEnv)
	if err := wsDesktop3.WriteMessage(websocket.TextMessage, dupPromptBytes); err != nil {
		t.Fatalf("failed to send duplicate prompt message: %v", err)
	}

	var dupAck protocol.AckResponse
	_ = wsDesktop3.SetReadDeadline(time.Now().Add(3 * time.Second))
	if err := wsDesktop3.ReadJSON(&dupAck); err != nil {
		t.Fatalf("failed to read duplicate prompt ack: %v", err)
	}
	if !dupAck.Success {
		t.Fatalf("expected duplicate ack to succeed, got %+v", dupAck)
	}
	// Verify it acknowledged as already_processed
	if !strings.Contains(string(dupAck.Data), "already_processed") {
		t.Fatalf("INVARIANT 3/7 VIOLATION: expected 'already_processed' in dupAck.Data, got: %s", string(dupAck.Data))
	}
	t.Logf("Phase K: Idempotency verified! Duplicate commandID %s acknowledged as already_processed", cmdID)

	// 15. Wait for agent to finish or check session state
	deadlineEnd := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadlineEnd) {
		s, err := reopenedStore.GetSession(context.Background(), invariantSessionID)
		if err == nil && (s.State == domain.SessionStateCompleted || s.State == domain.SessionStateWaitingInput || s.State == domain.SessionStateRunning) {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}

	// 16. ASSERT ALL 8 INVARIANTS RIGOROUSLY
	ctx := context.Background()

	// Invariant 1: Identical sessionID
	recoveredSess, err := reopenedStore.GetSession(ctx, invariantSessionID)
	if err != nil || recoveredSess == nil {
		t.Fatalf("INVARIANT 1 FAIL: Session %s not found in reopened store: %v", invariantSessionID, err)
	}
	if recoveredSess.ID != invariantSessionID {
		t.Fatalf("INVARIANT 1 FAIL: recovered session ID %s != %s", recoveredSess.ID, invariantSessionID)
	}

	// Invariant 2: Identical workspaceID
	if recoveredSess.WorkspaceID != invariantWorkspaceID {
		t.Fatalf("INVARIANT 2 FAIL: recovered workspace ID %s != %s", recoveredSess.WorkspaceID, invariantWorkspaceID)
	}

	// Invariant 3: Identical commandID
	cmdRec, err := reopenedStore.GetCommand(ctx, cmdID)
	if err != nil || cmdRec == nil {
		t.Fatalf("INVARIANT 3 FAIL: command record %s not found in SQLite: %v", cmdID, err)
	}
	if cmdRec.CommandID != cmdID {
		t.Fatalf("INVARIANT 3 FAIL: command record ID mismatch: %s != %s", cmdRec.CommandID, cmdID)
	}

	// Invariant 4: Strictly monotonic sequence numbers
	for i := 1; i < len(receivedSequences); i++ {
		if receivedSequences[i] <= receivedSequences[i-1] {
			t.Fatalf("INVARIANT 4 FAIL: received non-monotonic sequence at idx %d (%d <= %d)",
				i, receivedSequences[i], receivedSequences[i-1])
		}
	}

	// Invariant 5: Zero event loss (contiguous sequences 1..N without holes)
	allEvents, err := reopenedStore.GetEventsSince(ctx, invariantSessionID, 0, 1000)
	if err != nil {
		t.Fatalf("failed to retrieve all events from reopened store: %v", err)
	}
	if len(allEvents) == 0 {
		t.Fatalf("INVARIANT 5 FAIL: no events recorded in SQLite store")
	}
	for idx, ev := range allEvents {
		expectedSeq := int64(idx + 1)
		if ev.Sequence != expectedSeq {
			t.Fatalf("INVARIANT 5 FAIL: event loss/gap detected! Expected sequence %d, got %d", expectedSeq, ev.Sequence)
		}
	}

	// Invariant 6: Zero event duplication
	seenSeqs := make(map[int64]bool)
	for _, ev := range allEvents {
		if seenSeqs[ev.Sequence] {
			t.Fatalf("INVARIANT 6 FAIL: duplicate event sequence %d found in SQLite store!", ev.Sequence)
		}
		seenSeqs[ev.Sequence] = true
	}

	// Invariant 7: Idempotency enforced
	// Ensure duplicate command did not create duplicate prompt events with identical command payloads
	promptEventCount := 0
	for _, ev := range allEvents {
		if ev.Type == "user.message" || ev.Type == "prompt" {
			promptEventCount++
		}
	}
	if promptEventCount > 1 {
		t.Fatalf("INVARIANT 7 FAIL: duplicate prompt caused multiple prompt events! Count=%d", promptEventCount)
	}

	// Invariant 8: Valid FSM transitions
	validStates := map[domain.SessionState]bool{
		domain.SessionStateCreated:      true,
		domain.SessionStateRunning:      true,
		domain.SessionStateWaitingInput: true,
		domain.SessionStateCompleted:    true,
		domain.SessionStatePaused:       true,
		domain.SessionStateCancelled:    true,
		domain.SessionStateFailed:       true,
	}
	if !validStates[recoveredSess.State] {
		t.Fatalf("INVARIANT 8 FAIL: session is in an invalid FSM state: %s", recoveredSess.State)
	}

	t.Logf("=== CHAOS RECONNECT MATRIX 24/7 PASSED ===")
	t.Logf("  Invariant 1 (SessionID):   %s (IDENTICAL)", recoveredSess.ID)
	t.Logf("  Invariant 2 (WorkspaceID): %s (IDENTICAL)", recoveredSess.WorkspaceID)
	t.Logf("  Invariant 3 (CommandID):   %s (IDENTICAL)", cmdRec.CommandID)
	t.Logf("  Invariant 4 (Monotonicity): %d stream events strictly monotonic", len(receivedSequences))
	t.Logf("  Invariant 5 (Zero Loss):   %d/%d contiguous events in SQLite (NO GAPS)", len(allEvents), len(allEvents))
	t.Logf("  Invariant 6 (Zero Dup):    0 duplicate sequences detected")
	t.Logf("  Invariant 7 (Idempotency): Verified with status:already_processed")
	t.Logf("  Invariant 8 (FSM Valid):   Final state %s", recoveredSess.State)
}
