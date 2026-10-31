package ide

import (
	"time"
)

// Instance représente un processus Language Server actif d'Antigravity IDE.
type Instance struct {
	PID         int       `json:"pid"`
	Port        int       `json:"port"`
	CSRFToken   string    `json:"csrfToken"`
	WorkspaceID string    `json:"workspaceId,omitempty"`
	AppDataDir  string    `json:"appDataDir"`
	ActiveSince time.Time `json:"activeSince"`
}

// Workspace représente un espace de travail configuré ou ouvert dans Antigravity IDE.
type Workspace struct {
	URI       string `json:"uri"`
	Path      string `json:"path"`
	Name      string `json:"name"`
	IsActive  bool   `json:"isActive"`
	Profile   string `json:"profile,omitempty"`
}

// SessionSummary résume une session de dialogue Antigravity IDE.
type SessionSummary struct {
	CascadeID      string    `json:"cascadeId"`
	Title          string    `json:"title"`
	WorkspacePath  string    `json:"workspacePath"`
	LastModified   time.Time `json:"lastModified"`
	StepCount      int       `json:"stepCount"`
	ActiveModel    string    `json:"activeModel,omitempty"`
	HasDatabase    bool      `json:"hasDatabase"`
	HasTranscript  bool      `json:"hasTranscript"`
}

// Step représente une étape chronologique au sein d'une session.
type Step struct {
	Index       int       `json:"index"`
	Type        string    `json:"type"`        // USER_INPUT, PLANNER_RESPONSE, TOOL_CALL, CHECKPOINT
	Status      string    `json:"status"`      // PENDING, DONE, ERROR, CANCELLED
	Source      string    `json:"source"`      // USER_EXPLICIT, MODEL, SYSTEM
	Content     string    `json:"content"`
	CreatedAt   time.Time `json:"createdAt"`
	HasDiff     bool      `json:"hasDiff,omitempty"`
}
