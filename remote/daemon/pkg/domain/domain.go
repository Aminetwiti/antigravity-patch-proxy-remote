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
	GitCommit string       `json:"gitCommit,omitempty"`
	BuildTime string       `json:"buildTime,omitempty"`
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
		SessionStateRecovering,
		SessionStateFailed,
		SessionStateCancelled,
	},
	SessionStateRunning: {
		SessionStateWaitingInput,
		SessionStateWaitingApproval,
		SessionStatePaused,
		SessionStateRecovering,
		SessionStateCompleted,
		SessionStateFailed,
		SessionStateCancelled,
	},
	SessionStateWaitingInput: {
		SessionStateRunning,
		SessionStatePaused,
		SessionStateRecovering,
		SessionStateCancelled,
		SessionStateFailed,
	},
	SessionStateWaitingApproval: {
		SessionStateRunning,
		SessionStatePaused,
		SessionStateRecovering,
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

var (
	ErrVersionConflict  = fmt.Errorf("optimistic concurrency conflict: session version has changed")
	ErrCommandDuplicate = fmt.Errorf("command duplicate: already processed")
	ErrCommandConflict  = fmt.Errorf("conflicting payload: command conflict for existing command id")
)

type Session struct {
	ID           string       `json:"id"`
	ServerID     string       `json:"serverId"`
	WorkspaceID  string       `json:"workspaceId"`
	OwnerID      string       `json:"ownerId,omitempty"`
	Title        string       `json:"title"`
	State        SessionState `json:"state"`
	Version      int64        `json:"version"`
	CreatedAt    time.Time    `json:"createdAt"`
	UpdatedAt    time.Time    `json:"updatedAt"`
	LastSequence int64        `json:"lastSequence"`
	BaseCommit   string       `json:"baseCommit,omitempty"`
	BaseBranch   string       `json:"baseBranch,omitempty"`
	OriginCommit string       `json:"originCommit,omitempty"`
}

type CommandRecord struct {
	CommandID   string `json:"commandId"`
	SessionID   string `json:"sessionId"`
	ActorID     string `json:"actorId"`
	CommandType string `json:"commandType"`
	PayloadHash string `json:"payloadHash"`
	Status      string `json:"status"`
	CreatedAt   int64  `json:"createdAt"`
}

const (
	EventSessionCreated     = "session.created"
	EventSessionStarted     = "session.started"
	EventRuntimeAttached    = "runtime.attached"
	EventRuntimeDetached    = "runtime.detached"
	EventRuntimeRecovered   = "runtime.recovered"
	EventSessionReconnected = "session.reconnected"
	EventSessionReconciled  = "session.reconciled"
	EventSessionPaused      = "session.paused"
	EventSessionResumed     = "session.resumed"
	EventSessionCompleted   = "session.completed"
	EventSessionFailed      = "session.failed"
)

type Workspace struct {
	ID        string    `json:"id"`
	ServerID  string    `json:"serverId"`
	OwnerID   string    `json:"ownerId,omitempty"`
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

const (
	EventSubagentStarted   = "subagent.started"
	EventSubagentProgress  = "subagent.progress"
	EventSubagentCompleted = "subagent.completed"
	EventSubagentFailed    = "subagent.failed"
)

// ScheduledJob represents an autonomous scheduled task persisted in the database.
type ScheduledJob struct {
	ID             string    `json:"id"`
	OwnerID        string    `json:"ownerId,omitempty"`
	WorkspaceID    string    `json:"workspaceId"`
	SessionID      string    `json:"sessionId,omitempty"`
	Name           string    `json:"name"`
	CronExpression string    `json:"cron"` // Standard 5-field cron (min, hour, day, month, weekday)
	Prompt         string    `json:"prompt"`
	IsEnabled      bool      `json:"isEnabled"`
	NextRunAt      time.Time `json:"nextRunAt,omitempty"`
	LastRunAt      time.Time `json:"lastRunAt,omitempty"`
	LastStatus     string    `json:"lastStatus,omitempty"`
	RetryCount     int       `json:"retryCount,omitempty"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}


