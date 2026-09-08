package eventstore_test

import (
	"context"
	"fmt"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/antigravity/remote-daemon/pkg/domain"
	"github.com/antigravity/remote-daemon/pkg/eventstore"
)

func TestSQLiteEventStore_Lifecycle(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test-ag-remote.db")

	store, err := eventstore.NewSQLiteEventStore(dbPath)
	if err != nil {
		t.Fatalf("failed to create sqlite event store: %v", err)
	}
	defer store.Close()

	ctx := context.Background()

	// 1. Create Session
	sess := &domain.Session{
		ID:          "sess-001",
		ServerID:    "srv-local",
		WorkspaceID: "ws-project",
		Title:       "Test Session",
	}
	if err := store.CreateSession(ctx, sess); err != nil {
		t.Fatalf("CreateSession failed: %v", err)
	}

	// 2. Verify fetched session
	got, err := store.GetSession(ctx, "sess-001")
	if err != nil {
		t.Fatalf("GetSession failed: %v", err)
	}
	if got.State != domain.SessionStateCreated {
		t.Errorf("got state %s; want CREATED", got.State)
	}

	// 3. Append Events
	for i := 1; i <= 10; i++ {
		evID := fmt.Sprintf("evt-%d", i)
		evType := "test.event"
		payload := []byte(fmt.Sprintf(`{"step": %d}`, i))
		ev, err := store.AppendEvent(ctx, "sess-001", evID, evType, payload)
		if err != nil {
			t.Fatalf("failed to append event %d: %v", i, err)
		}
		if ev.Sequence != int64(i) {
			t.Errorf("expected sequence %d; got %d", i, ev.Sequence)
		}
	}

	// 4. Verify latest sequence
	latestSeq, err := store.GetLatestSequence(ctx, "sess-001")
	if err != nil {
		t.Fatalf("GetLatestSequence failed: %v", err)
	}
	if latestSeq != 10 {
		t.Errorf("expected latest sequence 10; got %d", latestSeq)
	}

	// 5. Test GetEventsSince (catchup replay)
	missed, err := store.GetEventsSince(ctx, "sess-001", 5, 100)
	if err != nil {
		t.Fatalf("GetEventsSince failed: %v", err)
	}
	if len(missed) != 5 {
		t.Fatalf("expected 5 missed events (6..10); got %d", len(missed))
	}
	if missed[0].Sequence != 6 || missed[4].Sequence != 10 {
		t.Errorf("incorrect sequence range in replay: first=%d last=%d", missed[0].Sequence, missed[4].Sequence)
	}

	// 6. Snapshot save and retrieval
	snap := &domain.Snapshot{
		SessionID:   "sess-001",
		Sequence:    10,
		State:       domain.SessionStateRunning,
		Title:       "Test Session",
		PendingData: map[string]interface{}{"currentTool": "terminal.run"},
		CapturedAt:  time.Now(),
	}
	if err := store.SaveSnapshot(ctx, snap); err != nil {
		t.Fatalf("SaveSnapshot failed: %v", err)
	}

	latestSnap, err := store.GetLatestSnapshot(ctx, "sess-001")
	if err != nil {
		t.Fatalf("GetLatestSnapshot failed: %v", err)
	}
	if latestSnap == nil {
		t.Fatal("expected snapshot, got nil")
	}
	if latestSnap.Sequence != 10 || latestSnap.State != domain.SessionStateRunning {
		t.Errorf("incorrect snapshot contents")
	}
}

func TestConcurrentEventAppend(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "concurrent-ag-remote.db")

	store, err := eventstore.NewSQLiteEventStore(dbPath)
	if err != nil {
		t.Fatalf("failed to init store: %v", err)
	}
	defer store.Close()

	ctx := context.Background()
	sessID := "sess-concurrent"
	sess := &domain.Session{
		ID:          sessID,
		ServerID:    "server-01",
		WorkspaceID: "ws-01",
		Title:       "Concurrent Append Test",
	}
	if err := store.CreateSession(ctx, sess); err != nil {
		t.Fatalf("CreateSession failed: %v", err)
	}

	const numGoroutines = 10
	const eventsPerGoroutine = 100
	totalEvents := numGoroutines * eventsPerGoroutine

	var wg sync.WaitGroup
	wg.Add(numGoroutines)

	for g := 0; g < numGoroutines; g++ {
		go func(gorID int) {
			defer wg.Done()
			for e := 0; e < eventsPerGoroutine; e++ {
				evID := fmt.Sprintf("evt-g%d-e%d", gorID, e)
				_, err := store.AppendEvent(ctx, sessID, evID, "concurrent.event", []byte(`{"ok": true}`))
				if err != nil {
					t.Errorf("failed concurrent append: %v", err)
					return
				}
			}
		}(g)
	}

	wg.Wait()

	latestSeq, err := store.GetLatestSequence(ctx, sessID)
	if err != nil {
		t.Fatalf("failed to get latest sequence: %v", err)
	}
	if latestSeq != int64(totalEvents) {
		t.Errorf("expected latest sequence %d, got %d", totalEvents, latestSeq)
	}

	allEvs, err := store.GetEventsSince(ctx, sessID, 0, totalEvents+10)
	if err != nil {
		t.Fatalf("Failed to read all events: %v", err)
	}
	if len(allEvs) != totalEvents {
		t.Fatalf("expected %d events; got %d", totalEvents, len(allEvs))
	}

	seen := make(map[int64]bool)
	for _, ev := range allEvs {
		if seen[ev.Sequence] {
			t.Errorf("duplicate sequence number detected: %d", ev.Sequence)
		}
		seen[ev.Sequence] = true
	}
	for seq := int64(1); seq <= int64(totalEvents); seq++ {
		if !seen[seq] {
			t.Errorf("missing sequence number in event store: %d", seq)
		}
	}
}

func TestPersistenceAcrossRestart(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "restart-test.db")

	ctx := context.Background()
	sessID := "restart-sess"

	// Phase 1 : Open store, write data, then close (simulating server shutdown)
	store1, err := eventstore.NewSQLiteEventStore(dbPath)
	if err != nil {
		t.Fatalf("failed to open store1: %v", err)
	}
	sess := &domain.Session{
		ID:          sessID,
		ServerID:    "srv-1",
		WorkspaceID: "ws-1",
		Title:       "Restart Session",
	}
	if err := store1.CreateSession(ctx, sess); err != nil {
		t.Fatalf("failed to create session: %v", err)
	}
	for i := 1; i <= 20; i++ {
		var payload = []byte(fmt.Sprintf(`{"event_num": %d}`, i))
		if _, err := store1.AppendEvent(ctx, sessID, fmt.Sprintf("re-evt-%d", i), "state.update", payload); err != nil {
			t.Fatalf("failed to append event in phase 1: %v", err)
		}
	}
	store1.Close()

	// Phase 2 : Reopen database from disk, verify contents and append further
	store2, err := eventstore.NewSQLiteEventStore(dbPath)
	if err != nil {
		t.Fatalf("failed to reopen store2: %v", err)
	}
	defer store2.Close()

	reopenedSess, err := store2.GetSession(ctx, sessID)
	if err != nil {
		t.Fatalf("failed to fetch reopened session: %v", err)
	}
	if reopenedSess.LastSequence != 20 {
		t.Errorf("expected last_sequence 20 post-restart; got %d", reopenedSess.LastSequence)
	}

	evs, err := store2.GetEventsSince(ctx, sessID, 0, 100)
	if err != nil {
		t.Fatalf("failed to get events post-restart: %v", err)
	}
	if len(evs) != 20 {
		t.Errorf("expected 20 events post-restart; got %d", len(evs))
	}

	ev21, err := store2.AppendEvent(ctx, sessID, "re-evt-21", "post.restart", []byte("ok"))
	if err != nil {
		t.Fatalf("failed to append event 21 post-restart: %v", err)
	}
	if ev21.Sequence != 21 {
		t.Errorf("expected sequence 21; got %d", ev21.Sequence)
	}
}
