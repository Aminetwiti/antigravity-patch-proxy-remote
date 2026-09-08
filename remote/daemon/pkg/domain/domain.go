package domain

import (
	"encoding/json"
	"fmt"
	"time"
)

type ServerStatus string

const (
	ServerStatusOnline     ServerStatus = "ONLINE"
	ServerStatusOffline    ServerStatus = "OFFLINE"
	ServerStatusConnecting ServerStatus = "CONNECTING"
	ServerStatusDegraded   ServerStatus = "DEGRADED"
	ServerStatusUpdating   ServerStatus = "UPDATING"
)

type Server struct {
	ID        string       `json:"id"`
	Name      string       `json:"name"`
	Hostname  string       `json:"hostname"`
	Platform  string       `json:"platform"`
	Version   string       `json:"version"`
	Status    ServerStatus `json:"status"`
	CreatedAt time.Time    `json:"createdAt"`
	UpdatedAt time.Time    `json:"updatedAt"`
}

type SessionState string

const (
	SessionStateCreated         SessionState = "CREATED"
	SessionStateQueued          SessionState = "QUEUED"
	SessionStateStarting        SessionState = "STARTING"
	SessionStateRunning         SessionState = "RUNNING"
	SessionStateWaitingInput    SessionState = "WAITING_INPUT"
	SessionStateWaitingApproval SessionState = "WAITING_APPROVAL"
	SessionStatePaused          SessionState = "PAUSED"
	SessionStateRecovering      SessionState = "RECOVERING"
	SessionStateCompleted       SessionState = "COMPLETED"
	SessionStateFailed          SessionState = "FAILED"
	SessionStateCancelled       SessionState = "CANCELLED")


var AllowedTransitions = map[SessionState][]SessionState{
	SessionStateCreated: {
		SessionStateQueued,
		SessionStateStarting,
		SessionStateCancelled,
	},
	SessionStateQueued: {
		SessionStateStarting,
		SessionStateCancelled,
		SessionStateFailed,
	},
	SessionStateStarting: {
		SessionStateRunning,
		SessionStateFailed,
		SessionStateCancelled,
	},
	SessionStateRunning: {
		SessionStateWaitingInput,
		SessionStateWaitingApproval,
		SessionStatePaused,
		SessionStateCompleted,
		SessionStateFailed,
		SessionStateCancelled,
	},
	SessionStateWaitingInput: {
		SessionStateRunning,
		SessionStatePaused,
		SessionStateCancelled,
		SessionStateFailed,
	},
	SessionStateWaitingApproval: {
		SessionStateRunning,
		SessionStatePaused,
		SessionStateCancelled,
		SessionStateFailed,
	},
	SessionStatePaused: {
		SessionStateRunning,
		SessionStateCancelled,
	},
	SessionStateRecovering: {
		SessionStateRunning,
		SessionStatePaused,
		SessionStateFailed,
	},
	SessionStateCompleted: {},
	SessionStateFailed:    {},
	SessionStateCancelled: {},
}

type ErrInvalidTransition struct {
	From SessionState
	To   SessionState
}

func (e ErrInvalidTransition) Error() string {
	return fmt.Sprintf("Invalid session state transition: cannot transition from %s to %s", e.From, e.To)
}

func CanTransition(from, to SessionState) bool {
	allowed, ok := AllowedTransitions[from]
	if !ok {
		return false
	}
	for _, target := range allowed {
		if target == to {
			return true
		}
	}
	return false
}

type Session struct {
	ID           string       `json:"id"`
	ServerID     string       `json:"serverId"`
	WorkspaceID  string       `json:"workspaceId"`
	Title        string       `json:"title"`
	State        SessionState `json:"state"`
	CreatedAt    time.Time    `json:"createdAt"`
	UpdatedAt    time.Time    `json:"updatedAt"`
	LastSequence int64        `json:"lastSequence"`
}

type Workspace struct {
	ID        string    `json:"id"`
	ServerID  string    `json:"serverId"`
	Name      string    `json:"name"`
	Path      string    `json:"path"`
	RepoURL   string    `json:"repoUrl,omitempty"`
	Branch    string    `json:"branch,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type Event struct {
	SessionID string          `json:"sessionId"`
	Sequence  int64          `json:"sequence"`
	EventID   string          `json:"eventId"`
	Type      string          `json:"type"`
	Timestamp int64          `json:"timestamp"`
	Payload   json.RawMessage `json:"payload"`
}


type Command struct {
	SessionID    string          `json:"sessionId"`
	CommandID   string          `json:"commandId"`
	ActorID     string          `json:"actorId"`
	Type        string          `json:"type"`
	Timestamp   int64          `json:"timestamp"`
	Payload     json.RawMessage `json:"payload"`
}

type Snapshot struct {
	SessionID   string                 `json:"sessionId"`
	Sequence    int64                 `json:"sequence"`
	State       SessionState           `json:"state"`
	Title       string                 `json:"title"`
	PendingData map[string]interface{} `json:"pendingData,omitempty"`
	CapturedAt  time.Time              `json:"capturedAt"`
}


