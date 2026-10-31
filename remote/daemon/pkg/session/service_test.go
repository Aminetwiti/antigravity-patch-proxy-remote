package session_test

import (
	"context"
	"path/filepath"
	"sync"
	"testing"

	"github.com/antigravity/remote-daemon/pkg/domain"
	"github.com/antigravity/remote-daemon/pkg/eventstore"
	"github.com/antigravity/remote-daemon/pkg/session"
)

type MockBroadcaster struct {
	mu           sync.Mutex
	events       []*domain.Event
	sessionState []domain.SessionState
}

func (m *MockBroadcaster) BroadcastEvent(event *domain.Event) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.events = append(m.events, event)
}

func (m *MockBroadcaster) BroadcastSessionUpdate(s *domain.Session) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sessionState = append(m.sessionState, s.State)
}

func (m *MockBroadcaster) EventCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.events)
}

func TestSessionService_LifecycleAndFSM(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "session-test.db")

	store, err := eventstore.NewSQLiteEventStore(dbPath)
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}
	defer store.Close()

	broadcaster := &MockBroadcaster{}
	svc := session.NewService(store, broadcaster)
	ctx := context.Background()

	// 1. Create session
	sess, err := svc.CreateSession(ctx, "srv-prod", "ws-app", "Backend Auth Refactor")
	if err != nil {
		t.Fatalf("CreateSession failed: %v", err)
	}
	if sess.State != domain.SessionStateCreated {
		t.Errorf("expected CREATED state, got %s", sess.State)
	}
	if broadcaster.EventCount() != 1 {
		t.Errorf("expected 1 init event broadcast, got %d", broadcaster.EventCount())
	}

	// 2. Valid transition: CREATED -> STARTING
	if err := svc.TransitionState(ctx, sess.ID, domain.SessionStateStarting, "agent starting container"); err != nil {
		t.Fatalf("Transition to STARTING failed: %v", err)
	}

	// 3. Valid transition: STARTING -> RUNNING
	if err := svc.TransitionState(ctx, sess.ID, domain.SessionStateRunning, "agent container ready"); err != nil {
		t.Fatalf("Transition to RUNNING failed: %v", err)
	}

	// 4. Invalid transition: RUNNING -> CREATED
	if err := svc.TransitionState(ctx, sess.ID, domain.SessionStateCreated, "illegal transition"); err == nil {
		t.Fatal("expected error on illegal transition RUNNING -> CREATED, got nil")
	}

	// 5. Valid transition: RUNNING -> WAITING_APPROVAL
	if err := svc.TransitionState(ctx, sess.ID, domain.SessionStateWaitingApproval, "run_command needs review"); err != nil {
		t.Fatalf("Transition to WAITING_APPROVAL failed: %v", err)
	}

	// 6. Valid transition: WAITING_APPROVAL -> RUNNING
	if err := svc.TransitionState(ctx, sess.ID, domain.SessionStateRunning, "approval granted"); err != nil {
		t.Fatalf("Transition to RUNNING failed: %v", err)
	}

	// 7. Valid transition: RUNNING -> COMPLETED
	if err := svc.TransitionState(ctx, sess.ID, domain.SessionStateCompleted, "all steps finished"); err != nil {
		t.Fatalf("Transition to COMPLETED failed: %v", err)
	}

	// 8. Terminal state check: COMPLETED -> RUNNING must fail
	if err := svc.TransitionState(ctx, sess.ID, domain.SessionStateRunning, "resume completed session"); err == nil {
		t.Fatal("expected error on transition from terminal COMPLETED state, got nil")
	}

	// 9. Verify all events recorded in EventStore
	events, err := svc.GetCatchupEvents(ctx, sess.ID, 0, 100)
	if err != nil {
		t.Fatalf("failed to fetch catchup events: %v", err)
	}
	// Initial session.created (seq 1) + 5 transitions = 6 events
	if len(events) != 6 {
		t.Errorf("expected 6 events in store, got %d", len(events))
	}
}

func TestSessionService_CommandIdempotency(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "idempotency-test.db")

	store, err := eventstore.NewSQLiteEventStore(dbPath)
	if err != nil {
		t.Fatalf("failed to init store: %v", err)
	}
	defer store.Close()

	svc := session.NewService(store, nil)
	cmdID := "cmd_12345"
	sessID := "sess_abc"
	payload1 := map[string]interface{}{"prompt": "run unit tests", "noTools": false}
	payload2 := map[string]interface{}{"prompt": "DROP DATABASE", "noTools": true}

	// First execution -> success
	err1 := svc.CheckAndRegisterCommand(cmdID, sessID, payload1)
	if err1 != nil {
		t.Fatalf("expected first command registration to succeed, got %v", err1)
	}

	// Same commandID, same payload -> ErrCommandDuplicate (idempotent ignore)
	err2 := svc.CheckAndRegisterCommand(cmdID, sessID, payload1)
	if err2 != session.ErrCommandDuplicate {
		t.Fatalf("expected ErrCommandDuplicate, got %v", err2)
	}

	// Same commandID, different payload -> ErrCommandConflict (rejection)
	err3 := svc.CheckAndRegisterCommand(cmdID, sessID, payload2)
	if err3 != session.ErrCommandConflict {
		t.Fatalf("expected ErrCommandConflict, got %v", err3)
	}
}

