package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"

	"github.com/antigravity/remote-daemon/pkg/approval"
	"github.com/antigravity/remote-daemon/pkg/domain"
	"github.com/antigravity/remote-daemon/pkg/session"
	"github.com/antigravity/remote-daemon/pkg/tools"
	"github.com/antigravity/remote-daemon/pkg/workspace"
)

var (
	ErrSessionBusy = errors.New("agent turn is already running for this session")
)

type Engine struct {
	sessionSvc *session.Service
	wsMgr      *workspace.Manager
	toolsReg   *tools.Registry
	apprMgr    *approval.Manager
	llmClient  LLMClient
	maxTurns   int

	mu         sync.Mutex
	turnCancels map[string]context.CancelFunc // sessionID -> cancel
}

func NewEngine(
	sessionSvc *session.Service,
	wsMgr *workspace.Manager,
	toolsReg *tools.Registry,
	apprMgr *approval.Manager,
	llmClient LLMClient,
) *Engine {
	return &Engine{
		sessionSvc:  sessionSvc,
		wsMgr:       wsMgr,
		toolsReg:    toolsReg,
		apprMgr:     apprMgr,
		llmClient:   llmClient,
		maxTurns:    25,
		turnCancels: make(map[string]context.CancelFunc),
	}
}

func (e *Engine) StartTurn(ctx context.Context, sessionID, prompt string) error {
	sess, err := e.sessionSvc.GetSession(ctx, sessionID)
	if err != nil {
		return err
	}

	e.mu.Lock()
	if _, active := e.turnCancels[sessionID]; active {
		e.mu.Unlock()
		return ErrSessionBusy
	}

	turnCtx, cancel := context.WithCancel(context.Background())
	e.turnCancels[sessionID] = cancel
	e.mu.Unlock()

	// 1. Transition FSM to RUNNING
	if sess.State == domain.SessionStateCreated {
		_ = e.sessionSvc.TransitionState(ctx, sessionID, domain.SessionStateStarting, "Starting agent turn")
		_ = e.sessionSvc.TransitionState(ctx, sessionID, domain.SessionStateRunning, "Agent execution loop active")
	} else if sess.State == domain.SessionStateWaitingInput || sess.State == domain.SessionStatePaused {
		_ = e.sessionSvc.TransitionState(ctx, sessionID, domain.SessionStateRunning, "Resuming execution with new prompt")
	}

	// 2. Emit user message
	if prompt != "" {
		payload, _ := json.Marshal(map[string]string{"text": prompt})
		_, _ = e.sessionSvc.EmitEvent(turnCtx, sessionID, "user.message", payload)
	}

	// 3. Launch background execution loop in isolated goroutine (survives client disconnection)
	go e.runExecutionLoop(turnCtx, sessionID, sess.WorkspaceID)

	return nil
}

func (e *Engine) CancelTurn(ctx context.Context, sessionID string) error {
	e.mu.Lock()
	cancel, exists := e.turnCancels[sessionID]
	if exists {
		delete(e.turnCancels, sessionID)
		cancel()
	}
	e.mu.Unlock()

	_ = e.sessionSvc.TransitionState(ctx, sessionID, domain.SessionStateCancelled, "Turn cancelled by user")
	_, _ = e.sessionSvc.EmitEvent(ctx, sessionID, "agent.cancelled", []byte(`{"reason":"user_requested"}`))
	return nil
}

func (e *Engine) runExecutionLoop(ctx context.Context, sessionID, workspaceID string) {
	defer func() {
		e.mu.Lock()
		delete(e.turnCancels, sessionID)
		e.mu.Unlock()
	}()

	historyEvents, err := e.sessionSvc.GetCatchupEvents(ctx, sessionID, 0, 1000)
	if err != nil {
		_ = e.sessionSvc.TransitionState(ctx, sessionID, domain.SessionStateFailed, fmt.Sprintf("Failed to load session history: %v", err))
		return
	}

	messages := e.buildContextMessages(historyEvents)
	availableTools := e.toolsReg.ListTools()

	for turn := 0; turn < e.maxTurns; turn++ {
		if ctx.Err() != nil {
			_ = e.sessionSvc.TransitionState(context.Background(), sessionID, domain.SessionStateCancelled, "Execution loop cancelled")
			return
		}

		onChunk := func(chunk string) {
			_, _ = e.sessionSvc.EmitEvent(ctx, sessionID, "agent.thought_chunk", []byte(chunk))
		}

		resp, err := e.llmClient.Generate(ctx, messages, availableTools, onChunk)
		if err != nil {
			_ = e.sessionSvc.TransitionState(ctx, sessionID, domain.SessionStateFailed, fmt.Sprintf("LLM generation failed: %v", err))
			errPayload, _ := json.Marshal(map[string]string{"error": err.Error()})
			_, _ = e.sessionSvc.EmitEvent(ctx, sessionID, "agent.error", errPayload)
			return
		}

		// Emit agent thought event
		if resp.Thought != "" || resp.Message != "" {
			thoughtPayload, _ := json.Marshal(map[string]string{
				"thought": resp.Thought,
				"message": resp.Message,
			})
			_, _ = e.sessionSvc.EmitEvent(ctx, sessionID, "agent.thought", thoughtPayload)
			messages = append(messages, LLMMessage{
				Role:    "assistant",
				Content: resp.Message,
			})
		}

		// If no tool calls or explicitly done -> turn complete
		if len(resp.ToolCalls) == 0 || resp.Done {
			completePayload, _ := json.Marshal(map[string]interface{}{
				"summary": resp.Message,
				"done":    true,
			})
			_, _ = e.sessionSvc.EmitEvent(ctx, sessionID, "agent.completed", completePayload)
			_ = e.sessionSvc.TransitionState(ctx, sessionID, domain.SessionStateWaitingInput, "Turn completed, awaiting next input")
			return
		}

		// Execute tool calls
		for _, tc := range resp.ToolCalls {
			tcPayload, _ := json.Marshal(tc)
			_, _ = e.sessionSvc.EmitEvent(ctx, sessionID, "tool.call", tcPayload)

			// Check if approval required
			if e.toolsReg.NeedsApproval(tc.Name, tc.Arguments) {
				approved, err := e.apprMgr.RequestApproval(ctx, sessionID, tc.Name, tc.Arguments, "Tool execution requires confirmation", 300)
				if err != nil || !approved {
					errMsg := "Tool execution denied or timed out"
					if err != nil {
						errMsg = err.Error()
					}
					toolResultPayload, _ := json.Marshal(map[string]interface{}{
						"callId":  tc.ID,
						"success": false,
						"error":   errMsg,
					})
					_, _ = e.sessionSvc.EmitEvent(ctx, sessionID, "tool.result", toolResultPayload)
					messages = append(messages, LLMMessage{
						Role:       "tool",
						ToolCallID: tc.ID,
						Content:    fmt.Sprintf("Error: %s", errMsg),
					})
					continue
				}
			}

			// Execute tool with streaming output chunking
			onOutputChunk := func(c []byte) {
				chunkPayload, _ := json.Marshal(map[string]interface{}{
					"callId": tc.ID,
					"chunk":  string(c),
				})
				_, _ = e.sessionSvc.EmitEvent(ctx, sessionID, "tool.output", chunkPayload)
			}

			result, execErr := e.toolsReg.Execute(ctx, sessionID, workspaceID, tc.Name, tc.Arguments, onOutputChunk)
			if execErr != nil {
				result = &tools.ToolResult{Success: false, Error: execErr.Error()}
			}

			resPayload, _ := json.Marshal(map[string]interface{}{
				"callId":   tc.ID,
				"success":  result.Success,
				"output":   result.Output,
				"error":    result.Error,
				"exitCode": result.ExitCode,
			})
			_, _ = e.sessionSvc.EmitEvent(ctx, sessionID, "tool.result", resPayload)

			content := result.Output
			if !result.Success && result.Error != "" {
				content = fmt.Sprintf("Error: %s\n%s", result.Error, result.Output)
			}

			messages = append(messages, LLMMessage{
				Role:       "tool",
				ToolCallID: tc.ID,
				Content:    content,
			})
		}
	}

	// Reached max turns without completion
	_, _ = e.sessionSvc.EmitEvent(ctx, sessionID, "agent.max_turns", []byte(`{"status":"limit_reached"}`))
	_ = e.sessionSvc.TransitionState(ctx, sessionID, domain.SessionStateWaitingInput, "Max turn limit reached")
}

func (e *Engine) buildContextMessages(events []domain.Event) []LLMMessage {
	var msgs []LLMMessage
	for _, ev := range events {
		switch ev.Type {
		case "user.message":
			var data map[string]string
			if err := json.Unmarshal(ev.Payload, &data); err == nil {
				msgs = append(msgs, LLMMessage{Role: "user", Content: data["text"]})
			}
		case "agent.thought":
			var data map[string]string
			if err := json.Unmarshal(ev.Payload, &data); err == nil {
				msgs = append(msgs, LLMMessage{Role: "assistant", Content: data["message"]})
			}
		case "tool.result":
			var data map[string]interface{}
			if err := json.Unmarshal(ev.Payload, &data); err == nil {
				callID, _ := data["callId"].(string)
				out, _ := data["output"].(string)
				msgs = append(msgs, LLMMessage{Role: "tool", ToolCallID: callID, Content: out})
			}
		}
	}
	return msgs
}
