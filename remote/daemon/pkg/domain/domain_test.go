package domain_test

import (
	"testing"

	"github.com/antigravity/remote-daemon/pkg/domain"
)

func TestFSMTransitions(t *testing.T) {
	tests := []struct {
		from  domain.SessionState
		to    domain.SessionState
		valid bool
	}{
		{domain.SessionStateCreated, domain.SessionStateStarting, true},
		{domain.SessionStateCreated, domain.SessionStateQueued, true},
		{domain.SessionStateCreated, domain.SessionStateRunning, false},
		{domain.SessionStateStarting, domain.SessionStateRunning, true},
		{domain.SessionStateRunning, domain.SessionStateWaitingApproval, true},
		{domain.SessionStateWaitingApproval, domain.SessionStateRunning, true},
		{domain.SessionStateRunning, domain.SessionStatePaused, true},
		{domain.SessionStatePaused, domain.SessionStateRunning, true},
		{domain.SessionStateRunning, domain.SessionStateCompleted, true},
		{domain.SessionStateCompleted, domain.SessionStateRunning, false},
		{domain.SessionStateFailed, domain.SessionStateStarting, false},
		{domain.SessionStateCancelled, domain.SessionStateRunning, false},
		{domain.SessionStateRecovering, domain.SessionStatePaused, true},
		{domain.SessionStateRecovering, domain.SessionStateRunning, true},
	}

	for _, tt := range tests {
		got := domain.CanTransition(tt.from, tt.to)
		if got != tt.valid {
			t.Errorf("CanTransition(%s, %s) = %v; want %v", tt.from, tt.to, got, tt.valid)
		}
	}
}
