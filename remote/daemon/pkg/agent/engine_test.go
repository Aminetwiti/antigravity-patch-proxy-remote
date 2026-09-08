package agent_test

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/antigravity/remote-daemon/pkg/agent"
	"github.com/antigravity/remote-daemon/pkg/approval"
	"github.com/antigravity/remote-daemon/pkg/domain"
	"github.com/antigravity/remote-daemon/pkg/eventstore"
	"github.com/antigravity/remote-daemon/pkg/session"
	"github.com/antigravity/remote-daemon/pkg/tools"
	"github.com/antigravity/remote-daemon/pkg/workspace"
)

func setupTestEngine(t *testing.T, autoApprove bool, mockResponses ...*agent.LLMResponse) (*agent.Engine, *session.Service, *workspace.Manager, *approval.Manager, string, string, func()) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "agent_test.db")

	store, err := eventstore.NewSQLiteEventStore(dbPath)
	if err != nil {
		t.Fatalf("failed to init eventstore: %v", err)
	}

	sessionSvc := session.NewService(store, nil)
	wsMgr := workspace.NewManager()

	wsDir := filepath.Join(tmpDir, "work")
	ws, err := wsMgr.RegisterWorkspace("ws-test", "test-ws", wsDir)
	if err != nil {
		_ = store.Close()
		t.Fatalf("failed to register workspace: %v", err)
	}

	apprMgr := approval.NewManager(sessionSvc, 5*time.Second)
	toolsReg := tools.NewRegistry(wsMgr, autoApprove)

	mockLLM := agent.NewMockLLMClient(mockResponses...)
	eng := agent.NewEngine(sessionSvc, wsMgr, toolsReg, apprMgr, mockLLM)

	sess, err := sessionSvc.CreateSession(context.Background(), "srv-1", ws.ID, "Agent Session")
	if err != nil {
		_ = store.Close()
		t.Fatalf("failed to create session: %v", err)
	}

	cleanup := func() {
		_ = store.Close()
	}

	return eng, sessionSvc, wsMgr, apprMgr, sess.ID, ws.ID, cleanup
}

func TestAgentEngine_MultiStepLoop(t *testing.T) {
	// Response 1: Call write_to_file
	resp1 := &agent.LLMResponse{
		Thought: "I need to write a greeting file.",
		Message: "Creating greet.txt now.",
		ToolCalls: []agent.ToolCall{
			{
				ID:   "call_1",
				Name: "write_to_file",
				Arguments: json.RawMessage(`{
					"path": "greet.txt",
					"content": "Hello from autonomous remote agent!"
				}`),
			},
		},
		Done: false,
	}

	// Response 2: Done
	resp2 := &agent.LLMResponse{
		Thought: "The file has been written.",
		Message: "I have successfully created greet.txt with your greeting.",
		Done:    true,
	}

	eng, sessionSvc, wsMgr, _, sessID, wsID, cleanup := setupTestEngine(t, true, resp1, resp2)
	defer cleanup()
	ctx := context.Background()

	err := eng.StartTurn(ctx, sessID, "Please write a greeting file")
	if err != nil {
		t.Fatalf("StartTurn failed: %v", err)
	}

	// Poll until session reaches WAITING_INPUT (turn completed)
	deadline := time.Now().Add(5 * time.Second)
	var finalSess *domain.Session
	for time.Now().Before(deadline) {
		finalSess, _ = sessionSvc.GetSession(ctx, sessID)
		if finalSess.State == domain.SessionStateWaitingInput {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}

	if finalSess.State != domain.SessionStateWaitingInput {
		t.Fatalf("expected state WAITING_INPUT, got: %s", finalSess.State)
	}

	// Verify file was written to workspace
	content, err := wsMgr.ReadFile(wsID, "greet.txt")
	if err != nil {
		t.Fatalf("expected greet.txt to exist: %v", err)
	}
	if !strings.Contains(string(content), "autonomous remote agent") {
		t.Fatalf("unexpected content: %s", string(content))
	}

	// Verify events recorded in EventStore
	events, err := sessionSvc.GetCatchupEvents(ctx, sessID, 0, 100)
	if err != nil {
		t.Fatalf("GetCatchupEvents failed: %v", err)
	}

	eventTypes := make([]string, 0, len(events))
	for _, ev := range events {
		eventTypes = append(eventTypes, ev.Type)
	}

	expectedTypes := []string{
		"session.created",
		"session.state_changed",
		"user.message",
		"agent.thought",
		"tool.call",
		"tool.result",
		"agent.thought",
		"agent.completed",
	}

	for _, exp := range expectedTypes {
		found := false
		for _, actual := range eventTypes {
			if actual == exp {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("expected event type %q not found in event log: %v", exp, eventTypes)
		}
	}
}

func TestAgentEngine_ApprovalIntegration(t *testing.T) {
	// Gated execution: autoApprove = false
	resp1 := &agent.LLMResponse{
		Thought: "Executing build command.",
		ToolCalls: []agent.ToolCall{
			{
				ID:   "call_cmd_1",
				Name: "run_command",
				Arguments: json.RawMessage(`{
					"command": "whoami"
				}`),
			},
		},
		Done: false,
	}

	resp2 := &agent.LLMResponse{
		Thought: "Command finished.",
		Message: "Build complete.",
		Done:    true,
	}

	eng, sessionSvc, _, apprMgr, sessID, _, cleanup := setupTestEngine(t, false, resp1, resp2)
	defer cleanup()
	ctx := context.Background()

	err := eng.StartTurn(ctx, sessID, "Run the build")
	if err != nil {
		t.Fatalf("StartTurn failed: %v", err)
	}

	// Wait for engine to pause at WAITING_APPROVAL
	deadline := time.Now().Add(3 * time.Second)
	var pendingApprID string
	for time.Now().Before(deadline) {
		reqs := apprMgr.GetPendingRequests(sessID)
		if len(reqs) > 0 {
			pendingApprID = reqs[0].ID
			break
		}
		time.Sleep(20 * time.Millisecond)
	}

	if pendingApprID == "" {
		t.Fatalf("expected pending approval request, got none")
	}

	sess, _ := sessionSvc.GetSession(ctx, sessID)
	if sess.State != domain.SessionStateWaitingApproval {
		t.Fatalf("expected state WAITING_APPROVAL, got %s", sess.State)
	}

	// Approve via approval manager
	if err := apprMgr.ResolveApproval(pendingApprID, true, "reviewer", "verified build command"); err != nil {
		t.Fatalf("ResolveApproval failed: %v", err)
	}

	// Wait for turn to complete
	deadline = time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		sess, _ = sessionSvc.GetSession(ctx, sessID)
		if sess.State == domain.SessionStateWaitingInput {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}

	if sess.State != domain.SessionStateWaitingInput {
		t.Fatalf("expected state WAITING_INPUT after approved execution, got %s", sess.State)
	}
}

func TestAgentEngine_Cancellation(t *testing.T) {
	resp1 := &agent.LLMResponse{
		Thought: "Starting long running task",
		ToolCalls: []agent.ToolCall{
			{
				ID:   "call_long",
				Name: "run_command",
				Arguments: json.RawMessage(`{"command": "sleep 10"}`),
			},
		},
	}

	eng, sessionSvc, _, _, sessID, _, cleanup := setupTestEngine(t, true, resp1)
	defer cleanup()
	ctx := context.Background()

	_ = eng.StartTurn(ctx, sessID, "Run long task")
	time.Sleep(50 * time.Millisecond)

	// Cancel turn
	if err := eng.CancelTurn(ctx, sessID); err != nil {
		t.Fatalf("CancelTurn failed: %v", err)
	}

	sess, _ := sessionSvc.GetSession(ctx, sessID)
	if sess.State != domain.SessionStateCancelled {
		t.Fatalf("expected state CANCELLED, got %s", sess.State)
	}
}
