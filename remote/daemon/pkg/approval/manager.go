package approval

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/antigravity/remote-daemon/pkg/domain"
)

var (
	ErrApprovalNotFound = errors.New("pending approval request not found")
	ErrApprovalDenied   = errors.New("tool execution denied by user approval")
	ErrApprovalTimeout  = errors.New("approval request timed out")
)

type StateTransitioner interface {
	TransitionState(ctx context.Context, sessionID string, targetState domain.SessionState, reason string) error
	EmitEvent(ctx context.Context, sessionID, eventType string, payload []byte) (*domain.Event, error)
}

type ApprovalRequest struct {
	ID         string          `json:"id"`
	SessionID  string          `json:"sessionId"`
	ToolName   string          `json:"toolName"`
	Parameters json.RawMessage `json:"parameters"`
	Reason     string          `json:"reason,omitempty"`
	CreatedAt  int64           `json:"createdAt"`
	TimeoutSec int             `json:"timeoutSec"`
}

type ApprovalResponse struct {
	ApprovalID string `json:"approvalId"`
	Approved   bool   `json:"approved"`
	Reason     string `json:"reason,omitempty"`
	ActorID    string `json:"actorId,omitempty"`
}

type Manager struct {
	mu           sync.RWMutex
	pending      map[string]chan ApprovalResponse
	requests     map[string]*ApprovalRequest
	transitioner StateTransitioner
	defaultTimeout time.Duration
}

func NewManager(transitioner StateTransitioner, defaultTimeout time.Duration) *Manager {
	if defaultTimeout <= 0 {
		defaultTimeout = 5 * time.Minute
	}
	return &Manager{
		pending:        make(map[string]chan ApprovalResponse),
		requests:       make(map[string]*ApprovalRequest),
		transitioner:   transitioner,
		defaultTimeout: defaultTimeout,
	}
}

func (m *Manager) RequestApproval(ctx context.Context, sessionID, toolName string, params json.RawMessage, reason string, timeoutSec int) (bool, error) {
	approvalID := fmt.Sprintf("appr_%d_%s", time.Now().UnixNano(), toolName)
	timeout := m.defaultTimeout
	if timeoutSec > 0 {
		timeout = time.Duration(timeoutSec) * time.Second
	}

	req := &ApprovalRequest{
		ID:         approvalID,
		SessionID:  sessionID,
		ToolName:   toolName,
		Parameters: params,
		Reason:     reason,
		CreatedAt:  time.Now().UnixMilli(),
		TimeoutSec: int(timeout.Seconds()),
	}

	respChan := make(chan ApprovalResponse, 1)

	m.mu.Lock()
	m.pending[approvalID] = respChan
	m.requests[approvalID] = req
	m.mu.Unlock()

	defer func() {
		m.mu.Lock()
		delete(m.pending, approvalID)
		delete(m.requests, approvalID)
		m.mu.Unlock()
	}()

	// 1. Transition FSM to WAITING_APPROVAL
	if m.transitioner != nil {
		if err := m.transitioner.TransitionState(ctx, sessionID, domain.SessionStateWaitingApproval, fmt.Sprintf("Approval requested for tool: %s", toolName)); err != nil {
			return false, fmt.Errorf("failed to transition state to WAITING_APPROVAL: %w", err)
		}

		// 2. Emit approval.requested event into durable store
		payloadBytes, _ := json.Marshal(req)
		_, _ = m.transitioner.EmitEvent(ctx, sessionID, "approval.requested", payloadBytes)
	}

	// 3. Await response, timeout, or context cancellation
	timer := time.NewTimer(timeout)
	defer timer.Stop()

	var resp ApprovalResponse
	select {
	case <-ctx.Done():
		return false, ctx.Err()

	case <-timer.C:
		m.restoreRunningState(ctx, sessionID, "Approval request timed out")
		if m.transitioner != nil {
			timeoutPayload, _ := json.Marshal(map[string]interface{}{
				"approvalId": approvalID,
				"error":      "timeout",
			})
			_, _ = m.transitioner.EmitEvent(ctx, sessionID, "approval.timeout", timeoutPayload)
		}
		return false, ErrApprovalTimeout

	case resp = <-respChan:
		// Response received from client
	}

	// 4. Transition FSM back to RUNNING
	resumeReason := fmt.Sprintf("Approval resolved for tool %s: approved=%v", toolName, resp.Approved)
	m.restoreRunningState(ctx, sessionID, resumeReason)

	if m.transitioner != nil {
		resPayload, _ := json.Marshal(map[string]interface{}{
			"approvalId": approvalID,
			"approved":   resp.Approved,
			"actorId":    resp.ActorID,
			"reason":     resp.Reason,
		})
		_, _ = m.transitioner.EmitEvent(ctx, sessionID, "approval.resolved", resPayload)
	}

	if !resp.Approved {
		return false, ErrApprovalDenied
	}

	return true, nil
}

func (m *Manager) restoreRunningState(ctx context.Context, sessionID, reason string) {
	if m.transitioner != nil {
		_ = m.transitioner.TransitionState(ctx, sessionID, domain.SessionStateRunning, reason)
	}
}

func (m *Manager) ResolveApproval(approvalID string, approved bool, actorID, reason string) error {
	m.mu.Lock()
	respChan, ok := m.pending[approvalID]
	if !ok {
		m.mu.Unlock()
		return ErrApprovalNotFound
	}
	delete(m.pending, approvalID)
	m.mu.Unlock()

	resp := ApprovalResponse{
		ApprovalID: approvalID,
		Approved:   approved,
		ActorID:    actorID,
		Reason:     reason,
	}

	select {
	case respChan <- resp:
		return nil
	default:
		return errors.New("approval already resolved")
	}
}

func (m *Manager) GetApprovalRequest(approvalID string) (*ApprovalRequest, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	req, ok := m.requests[approvalID]
	if !ok {
		return nil, false
	}
	cp := *req
	return &cp, true
}

func (m *Manager) GetPendingRequests(sessionID string) []*ApprovalRequest {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var list []*ApprovalRequest
	for _, req := range m.requests {
		if sessionID == "" || req.SessionID == sessionID {
			list = append(list, req)
		}
	}
	return list
}

