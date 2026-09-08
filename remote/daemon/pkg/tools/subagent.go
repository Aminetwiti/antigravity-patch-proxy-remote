package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
)

// SubagentRunner defines the interface for running autonomous subagents.
type SubagentRunner interface {
	RunSubagent(ctx context.Context, parentSessionID, role, task, workspaceID string, onChunk func([]byte)) (string, error)
}

// InvokeSubagentTool enables agents to spawn specialized subagents.
type InvokeSubagentTool struct {
	mu     sync.RWMutex
	runner SubagentRunner
}

func NewInvokeSubagentTool(runner SubagentRunner) *InvokeSubagentTool {
	return &InvokeSubagentTool{runner: runner}
}

func (t *InvokeSubagentTool) SetRunner(runner SubagentRunner) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.runner = runner
}

func (t *InvokeSubagentTool) Name() string {
	return "invoke_subagent"
}

func (t *InvokeSubagentTool) Description() string {
	return "Spawn a focused subagent with an isolated role, task, and workspace to perform deep research, code review, testing, or auditing, and return synthesized findings."
}

func (t *InvokeSubagentTool) ParametersSchema() map[string]interface{} {
	return map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"role": map[string]interface{}{
				"type":        "string",
				"description": "Specialist role of the subagent (e.g. researcher, code_reviewer, tester, auditor)",
			},
			"task": map[string]interface{}{
				"type":        "string",
				"description": "Specific mission instructions, goal, and context for the subagent",
			},
			"workspace_id": map[string]interface{}{
				"type":        "string",
				"description": "Optional workspace ID to isolate subagent (defaults to current session workspace)",
			},
		},
		"required": []string{"role", "task"},
	}
}

func (t *InvokeSubagentTool) RequiresApproval(params json.RawMessage) bool {
	return false
}

type invokeSubagentParams struct {
	Role        string `json:"role"`
	Task        string `json:"task"`
	WorkspaceID string `json:"workspace_id"`
}

func (t *InvokeSubagentTool) Execute(ctx context.Context, sessionID, workspaceID string, params json.RawMessage, onChunk func(chunk []byte)) (*ToolResult, error) {
	t.mu.RLock()
	runner := t.runner
	t.mu.RUnlock()

	if runner == nil {
		return &ToolResult{
			Success: false,
			Error:   "subagent execution runner is not configured",
		}, nil
	}

	var p invokeSubagentParams
	if err := json.Unmarshal(params, &p); err != nil {
		return &ToolResult{
			Success: false,
			Error:   fmt.Sprintf("invalid parameters: %v", err),
		}, nil
	}

	if p.Role == "" {
		p.Role = "assistant"
	}
	if p.Task == "" {
		return &ToolResult{
			Success: false,
			Error:   "task is required for subagent invocation",
		}, nil
	}

	targetWs := workspaceID
	if p.WorkspaceID != "" {
		targetWs = p.WorkspaceID
	}

	result, err := runner.RunSubagent(ctx, sessionID, p.Role, p.Task, targetWs, onChunk)
	if err != nil {
		return &ToolResult{
			Success: false,
			Error:   fmt.Sprintf("subagent execution failed: %v", err),
		}, nil
	}

	return &ToolResult{
		Success: true,
		Output:  result,
	}, nil
}
