package approval_test

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/antigravity/remote-daemon/pkg/approval"
	"github.com/antigravity/remote-daemon/pkg/domain"
)

type mockTransitioner struct {
	mu          sync.Mutex
	state       domain.SessionState
	transitions []domain.SessionState
	events      []string
}

func (m *mockTransitioner) TransitionState(ctx context.Context, sessionID string, targetState domain.SessionState, reason string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.state = targetState
	m.transitions = append(m.transitions, targetState)
	return nil
}

func (m *mockTransitioner) EmitEvent(ctx context.Context, sessionID, eventType string, payload []byte) (*domain.Event, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.events = append(m.events, eventType)
	return &domain.Event{SessionID: sessionID, Type: eventType}, nil
}

func TestApprovalManager_Grant(t *testing.T) {
	trans := &mockTransitioner{state: domain.SessionStateRunning}
	mgr := approval.NewManager(trans, 2*time.Second)

	ctx := context.Background()
	params := json.RawMessage(`{"command": "rm -rf /tmp/test"}`)

	done := make(chan struct{})
	var approved bool
	var reqErr error

	go func() {
		defer close(done)
		approved, reqErr = mgr.RequestApproval(ctx, "sess-1", "run_command", params, "dangerous delete", 2)
	}()

	// Wait for approval request to be registered
	time.Sleep(20 * time.Millisecond)

	reqs := mgr.GetPendingRequests("sess-1")
	if len(reqs) != 1 {
		t.Fatalf("expected 1 pending request, got %d", len(reqs))
	}
	apprID := reqs[0].ID

	trans.mu.Lock()
	if trans.state != domain.SessionStateWaitingApproval {
		t.Fatalf("expected state WAITING_APPROVAL, got %s", trans.state)
	}
	trans.mu.Unlock()

	// Grant approval
	if err := mgr.ResolveApproval(apprID, true, "admin", "approved by test"); err != nil {
		t.Fatalf("ResolveApproval failed: %v", err)
	}

	<-done

	if reqErr != nil {
		t.Fatalf("expected no error on approval grant, got: %v", reqErr)
	}
	if !approved {
		t.Fatalf("expected approved=true, got false")
	}

	trans.mu.Lock()
	if trans.state != domain.SessionStateRunning {
		t.Fatalf("expected state restored to RUNNING, got %s", trans.state)
	}
	trans.mu.Unlock()
}

func TestApprovalManager_Deny(t *testing.T) {
	trans := &mockTransitioner{state: domain.SessionStateRunning}
	mgr := approval.NewManager(trans, 2*time.Second)

	ctx := context.Background()
	params := json.RawMessage(`{"command": "rm -rf /tmp/test"}`)

	done := make(chan struct{})
	var approved bool
	var reqErr error

	go func() {
		defer close(done)
		approved, reqErr = mgr.RequestApproval(ctx, "sess-1", "run_command", params, "dangerous delete", 2)
	}()

	time.Sleep(20 * time.Millisecond)
	reqs := mgr.GetPendingRequests("sess-1")
	if len(reqs) != 1 {
		t.Fatalf("expected 1 pending request, got %d", len(reqs))
	}

	// Deny approval
	if err := mgr.ResolveApproval(reqs[0].ID, false, "admin", "denied by security"); err != nil {
		t.Fatalf("ResolveApproval failed: %v", err)
	}

	<-done

	if !errors.Is(reqErr, approval.ErrApprovalDenied) {
		t.Fatalf("expected ErrApprovalDenied, got: %v", reqErr)
	}
	if approved {
		t.Fatalf("expected approved=false, got true")
	}

	trans.mu.Lock()
	if trans.state != domain.SessionStateRunning {
		t.Fatalf("expected state restored to RUNNING, got %s", trans.state)
	}
	trans.mu.Unlock()
}

func TestApprovalManager_Timeout(t *testing.T) {
	trans := &mockTransitioner{state: domain.SessionStateRunning}
	mgr := approval.NewManager(trans, 50*time.Millisecond)

	ctx := context.Background()
	params := json.RawMessage(`{"command": "sleep 10"}`)

	approved, err := mgr.RequestApproval(ctx, "sess-1", "run_command", params, "timeout test", 0)

	if !errors.Is(err, approval.ErrApprovalTimeout) {
		t.Fatalf("expected ErrApprovalTimeout, got: %v", err)
	}
	if approved {
		t.Fatalf("expected approved=false, got true")
	}

	trans.mu.Lock()
	if trans.state != domain.SessionStateRunning {
		t.Fatalf("expected state restored to RUNNING, got %s", trans.state)
	}
	trans.mu.Unlock()
}
