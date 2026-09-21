package agent_test

import (
	"context"
	"errors"
	"testing"

	"github.com/antigravity/remote-daemon/pkg/agent"
	"github.com/antigravity/remote-daemon/pkg/domain"
)

// TestBreak_ResurrectCancelledSession_MustBeRefused proves that attempting
// to start an agent turn on a session in a terminal state (CANCELLED, COMPLETED, FAILED)
// must be strictly rejected and not allowed to execute background loops or emit user messages.
func TestBreak_ResurrectCancelledSession_MustBeRefused(t *testing.T) {
	mockResp := &agent.LLMResponse{
		Message: "I resurrected!",
		Done:    true,
	}
	eng, sessionSvc, _, _, sessID, _, cleanup := setupTestEngine(t, true, mockResp)
	defer cleanup()

	ctx := context.Background()

	// 1. Session begins in CREATED, cancel it
	if err := sessionSvc.TransitionState(ctx, sessID, domain.SessionStateCancelled, "user cancelled session"); err != nil {
		t.Fatalf("failed to cancel session: %v", err)
	}

	sess, err := sessionSvc.GetSession(ctx, sessID)
	if err != nil || sess.State != domain.SessionStateCancelled {
		t.Fatalf("expected state CANCELLED, got %v (err: %v)", sess.State, err)
	}

	// 2. Adversary attempts to resurrect cancelled session via StartTurn
	err = eng.StartTurn(ctx, sessID, "Execute rogue command")
	if err == nil {
		t.Fatalf("SECURITY VIOLATION: StartTurn succeeded on CANCELLED session! Cancelled session was resurrected.")
	}

	if !errors.Is(err, domain.ErrSessionTerminal) {
		t.Fatalf("expected ErrSessionTerminal, got: %v", err)
	}
}

// TestBreak_ResurrectCompletedSession_MustBeRefused verifies that COMPLETED sessions cannot be resurrected.
func TestBreak_ResurrectCompletedSession_MustBeRefused(t *testing.T) {
	mockResp := &agent.LLMResponse{
		Message: "Done",
		Done:    true,
	}
	eng, sessionSvc, _, _, sessID, _, cleanup := setupTestEngine(t, true, mockResp)
	defer cleanup()

	ctx := context.Background()

	_ = sessionSvc.TransitionState(ctx, sessID, domain.SessionStateStarting, "start")
	_ = sessionSvc.TransitionState(ctx, sessID, domain.SessionStateRunning, "running")
	_ = sessionSvc.TransitionState(ctx, sessID, domain.SessionStateCompleted, "all tasks done")

	err := eng.StartTurn(ctx, sessID, "Run another command after completion")
	if err == nil {
		t.Fatalf("VIOLATION: StartTurn succeeded on COMPLETED session!")
	}
}
