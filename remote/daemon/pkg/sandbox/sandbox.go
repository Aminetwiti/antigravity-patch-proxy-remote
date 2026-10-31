package sandbox

import (
	"context"
	"fmt"
	"time"
)

type Mode string

const (
	ModeStrict    Mode = "strict"    // If requested sandbox is unavailable, fail closed with ErrSandboxUnavailable.
	ModePreferred Mode = "preferred" // If sandbox is unavailable, log explicit warning and fall back to native host execution.
	ModeNative    Mode = "native"    // Host execution directly.
)

var (
	ErrSandboxUnavailable = fmt.Errorf("sandboxed execution failed: requested container sandbox is unavailable or failed to start")
)

// ExecutionRequest represents the command execution parameters.
type ExecutionRequest struct {
	SessionID   string        `json:"sessionId"`
	WorkspaceID string        `json:"workspaceId"`
	Directory   string        `json:"directory"`
	CommandLine string        `json:"commandLine"`
	Timeout     time.Duration `json:"timeout"`
	Env         []string      `json:"env,omitempty"`
}

// ExecutionResult represents the outcome of a sandboxed execution.
type ExecutionResult struct {
	ExitCode int           `json:"exitCode"`
	Output   string        `json:"output"`
	Duration time.Duration `json:"duration"`
	Error    string        `json:"error,omitempty"`
}

// Provider defines the interface for running commands in an execution sandbox.
type Provider interface {
	Name() string
	IsAvailable() bool
	Execute(ctx context.Context, req ExecutionRequest, onChunk func(chunk []byte)) (*ExecutionResult, error)
}
