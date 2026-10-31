package agent

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"
	"time"

	"github.com/antigravity/remote-daemon/pkg/approval"
	"github.com/antigravity/remote-daemon/pkg/domain"
	"github.com/antigravity/remote-daemon/pkg/eventstore"
	"github.com/antigravity/remote-daemon/pkg/session"
	"github.com/antigravity/remote-daemon/pkg/tools"
	"github.com/antigravity/remote-daemon/pkg/workspace"
)

type mockSubagentLLM struct {
	turnCount int
}

func (m *mockSubagentLLM) Generate(ctx context.Context, messages []LLMMessage, availableTools []tools.ToolDefinition, onChunk func(string)) (*LLMResponse, error) {
	m.turnCount++
	lastMsg := messages[len(messages)-1]

	// If user asks parent to research
	if lastMsg.Role == "user" && lastMsg.Content == "Delegate task to researcher" {
		callArgs, _ := json.Marshal(map[string]string{
			"role": "researcher",
			"task": "Investigate security audit",
		})
		return &LLMResponse{
			Thought: "I will delegate this to the researcher subagent.",
			Message: "Delegating investigation to researcher...",
			ToolCalls: []ToolCall{
				{
					ID:        "call_subagent_1",
					Name:      "invoke_subagent",
					Arguments: callArgs,
				},
			},
		}, nil
	}

	// If this is the subagent's prompt
	if lastMsg.Role == "user" && len(messages) == 1 {
		return &LLMResponse{
			Thought: "I am conducting the security audit.",
			Message: "Audit findings: all endpoints require bearer tokens.",
			Done:    true,
		}, nil
	}

	// If parent receives tool result from subagent
	if lastMsg.Role == "tool" && lastMsg.ToolCallID == "call_subagent_1" {
		return &LLMResponse{
			Thought: "The subagent completed its mission.",
			Message: "Summary based on subagent: " + lastMsg.Content,
			Done:    true,
		}, nil
	}

	return &LLMResponse{Message: "Default response", Done: true}, nil
}

func TestAgentEngine_SubagentDelegation(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "subagent_test.db")
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

	toolsReg := tools.NewRegistry(wsMgr, true)
	apprMgr := approval.NewManager(sessSvc, 5*time.Minute)
	llm := &mockSubagentLLM{}

	eng := NewEngine(sessSvc, wsMgr, toolsReg, apprMgr, llm)

	ctx := context.Background()
	parentSess, err := sessSvc.CreateSession(ctx, "srv-1", ws.ID, "Parent Main Session")
	if err != nil {
		t.Fatalf("failed to create parent session: %v", err)
	}

	// Start parent turn that will trigger subagent delegation
	err = eng.StartTurn(ctx, parentSess.ID, "Delegate task to researcher")
	if err != nil {
		t.Fatalf("StartTurn failed: %v", err)
	}

	// Wait for turn completion
	timeout := time.After(3 * time.Second)
	ticker := time.NewTicker(20 * time.Millisecond)
	defer ticker.Stop()

	completed := false
	for !completed {
		select {
		case <-timeout:
			t.Fatalf("timed out waiting for parent turn to complete")
		case <-ticker.C:
			s, _ := sessSvc.GetSession(ctx, parentSess.ID)
			if s.State == domain.SessionStateWaitingInput {
				completed = true
			}
		}
	}

	// Verify events in parent session
	events, err := sessSvc.GetCatchupEvents(ctx, parentSess.ID, 0, 100)
	if err != nil {
		t.Fatalf("GetCatchupEvents failed: %v", err)
	}

	var hasSubagentStarted, hasSubagentCompleted bool
	for _, ev := range events {
		if ev.Type == domain.EventSubagentStarted {
			hasSubagentStarted = true
		}
		if ev.Type == domain.EventSubagentCompleted {
			hasSubagentCompleted = true
		}
	}

	if !hasSubagentStarted {
		t.Errorf("expected EventSubagentStarted in parent events")
	}
	if !hasSubagentCompleted {
		t.Errorf("expected EventSubagentCompleted in parent events")
	}

	// Verify subagent child session exists
	sessions, err := sessSvc.ListSessions(ctx)
	if err != nil {
		t.Fatalf("ListSessions failed: %v", err)
	}

	if len(sessions) < 2 {
		t.Errorf("expected at least 2 sessions (parent + child), got %d", len(sessions))
	}

	var childSession *domain.Session
	for _, s := range sessions {
		if s.ID != parentSess.ID {
			childSession = &s
			break
		}
	}

	if childSession == nil {
		t.Fatalf("child subagent session not found in session list")
	}

	if childSession.State != domain.SessionStateCompleted {
		t.Errorf("expected child session to be COMPLETED, got %s", childSession.State)
	}
}
