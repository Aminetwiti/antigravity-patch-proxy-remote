package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/antigravity/remote-daemon/pkg/approval"
	"github.com/antigravity/remote-daemon/pkg/domain"
	"github.com/antigravity/remote-daemon/pkg/session"
	"github.com/antigravity/remote-daemon/pkg/tools"
	"github.com/antigravity/remote-daemon/pkg/workspace"
)

var (
	ErrSessionBusy = errors.New("agent turn is already running for this session")
)

// SessionTelemetry encapsulates real-time execution HUD metrics for the session.
type SessionTelemetry struct {
	SessionID        string    `json:"sessionId"`
	WorkspaceID      string    `json:"workspaceId"`
	State            string    `json:"state"`
	PromptTokens     int       `json:"promptTokens"`
	CompletionTokens int       `json:"completionTokens"`
	TotalTokens      int       `json:"totalTokens"`
	TokenBudget      int       `json:"tokenBudget"`
	BudgetPercent    float64   `json:"budgetPercent"`
	ActiveSubagents  int       `json:"activeSubagents"`
	TurnsCompleted   int       `json:"turnsCompleted"`
	LastUpdated      time.Time `json:"lastUpdated"`
}

// GitPolicy configures automated Git behavior per session.
// Staff Engineer principle: Push is NOT an automatic consequence of completion.
type GitPolicy struct {
	Commit             string `json:"commit"` // "auto" (default) or "manual"
	Push               string `json:"push"`   // "manual" (default), "auto", "approval"
	Merge              string `json:"merge"`  // "approval" (default), "auto", "manual"
	ExpectedBaseCommit string `json:"expectedBaseCommit,omitempty"` // Base commit to guard against stale push
}

type Engine struct {
	sessionSvc *session.Service
	wsMgr      *workspace.Manager
	toolsReg   *tools.Registry
	apprMgr    *approval.Manager
	llmClient  LLMClient
	maxTurns   int
	gitPolicy  GitPolicy

	mu              sync.Mutex
	turnCancels     map[string]context.CancelFunc // sessionID -> cancel
	sessionTokens   map[string]*UsageInfo         // sessionID -> cumulative Usage
	maxBudgets      map[string]int                // sessionID -> max token ceiling
	activeSubagents map[string]int                // sessionID -> active children
	sessionTurns    map[string]int                // sessionID -> turns completed
}

func NewEngine(
	sessionSvc *session.Service,
	wsMgr *workspace.Manager,
	toolsReg *tools.Registry,
	apprMgr *approval.Manager,
	llmClient LLMClient,
) *Engine {
	eng := &Engine{
		sessionSvc: sessionSvc,
		wsMgr:      wsMgr,
		toolsReg:   toolsReg,
		apprMgr:    apprMgr,
		llmClient:  llmClient,
		maxTurns:   25,
		gitPolicy: GitPolicy{
			Commit: "manual",
			Push:   "manual",
			Merge:  "approval",
		},
		turnCancels:     make(map[string]context.CancelFunc),
		sessionTokens:   make(map[string]*UsageInfo),
		maxBudgets:      make(map[string]int),
		activeSubagents: make(map[string]int),
		sessionTurns:    make(map[string]int),
	}
	if toolsReg != nil {
		toolsReg.SetSubagentRunner(eng)
	}
	return eng
}

func (e *Engine) SetGitPolicy(p GitPolicy) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.gitPolicy = p
}

func (e *Engine) GitPolicy() GitPolicy {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.gitPolicy
}

func (e *Engine) GetSessionTelemetry(ctx context.Context, sessionID string) (*SessionTelemetry, error) {
	sess, err := e.sessionSvc.GetSession(ctx, sessionID)
	if err != nil {
		return nil, err
	}

	e.mu.Lock()
	defer e.mu.Unlock()

	usage := UsageInfo{}
	if u, ok := e.sessionTokens[sessionID]; ok {
		usage = *u
	}
	budget := e.maxBudgets[sessionID]
	var budgetPercent float64
	if budget > 0 {
		budgetPercent = float64(usage.TotalTokens) / float64(budget) * 100.0
	}
	activeSubs := e.activeSubagents[sessionID]
	turns := e.sessionTurns[sessionID]

	return &SessionTelemetry{
		SessionID:        sessionID,
		WorkspaceID:      sess.WorkspaceID,
		State:            string(sess.State),
		PromptTokens:     usage.PromptTokens,
		CompletionTokens: usage.CompletionTokens,
		TotalTokens:      usage.TotalTokens,
		TokenBudget:      budget,
		BudgetPercent:    budgetPercent,
		ActiveSubagents:  activeSubs,
		TurnsCompleted:   turns,
		LastUpdated:      time.Now(),
	}, nil
}

func (e *Engine) GetSessionUsage(sessionID string) UsageInfo {
	e.mu.Lock()
	defer e.mu.Unlock()
	if u, ok := e.sessionTokens[sessionID]; ok {
		return *u
	}
	return UsageInfo{}
}

func (e *Engine) SetSessionBudget(sessionID string, maxTokens int) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.maxBudgets[sessionID] = maxTokens
}

func (e *Engine) StartTurn(ctx context.Context, sessionID, prompt string) error {
	sess, err := e.sessionSvc.GetSession(ctx, sessionID)
	if err != nil {
		return err
	}

	if domain.IsTerminalState(sess.State) {
		return fmt.Errorf("cannot start turn on terminal session %s (state=%s): %w", sessionID, sess.State, domain.ErrSessionTerminal)
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

	effectiveWsID := sess.WorkspaceID
	if e.wsMgr != nil {
		if sws, err := e.wsMgr.EnsureSessionWorktree(sess.WorkspaceID, sessionID); err == nil && sws != nil {
			effectiveWsID = sws.ID
		}
	}

	// 3. Launch background execution loop in isolated goroutine (survives client disconnection)
	go e.runExecutionLoop(turnCtx, sessionID, effectiveWsID, sess.WorkspaceID)

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

func (e *Engine) runExecutionLoop(ctx context.Context, sessionID, effectiveWsID, baseWsID string) {
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
		e.mu.Lock()
		e.sessionTurns[sessionID] = turn + 1
		e.mu.Unlock()

		if ctx.Err() != nil {
			_ = e.sessionSvc.TransitionState(context.Background(), sessionID, domain.SessionStateCancelled, "Execution loop cancelled")
			return
		}

		onChunk := func(chunk string) {
			chunkPayload, _ := json.Marshal(map[string]string{"chunk": chunk})
			e.sessionSvc.EmitEphemeralEvent(sessionID, "agent.thought_chunk", chunkPayload)
		}

		// ponytail: re-compact older tool outputs on every turn to prevent token bloat
		messages = CompactContextMessages(messages)

		resp, err := e.llmClient.Generate(ctx, messages, availableTools, onChunk)
		if err != nil {
			_ = e.sessionSvc.TransitionState(ctx, sessionID, domain.SessionStateFailed, fmt.Sprintf("LLM generation failed: %v", err))
			errPayload, _ := json.Marshal(map[string]string{"error": err.Error()})
			_, _ = e.sessionSvc.EmitEvent(ctx, sessionID, "agent.error", errPayload)
			return
		}

		// Token usage accounting
		if resp.Usage.TotalTokens > 0 {
			e.mu.Lock()
			curr, ok := e.sessionTokens[sessionID]
			if !ok {
				curr = &UsageInfo{}
				e.sessionTokens[sessionID] = curr
			}
			curr.PromptTokens += resp.Usage.PromptTokens
			curr.CompletionTokens += resp.Usage.CompletionTokens
			curr.TotalTokens += resp.Usage.TotalTokens
			totalNow := *curr
			maxB := e.maxBudgets[sessionID]
			e.mu.Unlock()

			usagePayload, _ := json.Marshal(map[string]interface{}{
				"turn":         turn + 1,
				"turnUsage":    resp.Usage,
				"sessionTotal": totalNow,
			})
			_, _ = e.sessionSvc.EmitEvent(ctx, sessionID, "agent.token_usage", usagePayload)

			if telem, telemErr := e.GetSessionTelemetry(ctx, sessionID); telemErr == nil {
				telemData, _ := json.Marshal(telem)
				e.sessionSvc.EmitEphemeralEvent(sessionID, "session.telemetry", telemData)
			}

			if maxB > 0 && totalNow.TotalTokens >= maxB {
				_ = e.sessionSvc.TransitionState(ctx, sessionID, domain.SessionStatePaused, fmt.Sprintf("Token budget ceiling reached (%d >= %d)", totalNow.TotalTokens, maxB))
				_, _ = e.sessionSvc.EmitEvent(ctx, sessionID, "agent.budget_exceeded", usagePayload)
				return
			}
		}

		// Emit agent thought event
		if resp.Thought != "" || resp.Message != "" || len(resp.ToolCalls) > 0 {
			thoughtPayload, _ := json.Marshal(map[string]interface{}{
				"thought":   resp.Thought,
				"message":   resp.Message,
				"toolCalls": resp.ToolCalls,
			})
			_, _ = e.sessionSvc.EmitEvent(ctx, sessionID, "agent.thought", thoughtPayload)
			messages = append(messages, LLMMessage{
				Role:      "assistant",
				Content:   resp.Message,
				ToolCalls: resp.ToolCalls,
			})
		}

		// If no tool calls or explicitly done -> turn complete
		if len(resp.ToolCalls) == 0 || resp.Done {
			// Staff Engineer Git policy: local commit on session branch, push is controlled by policy
			e.checkpointGitPolicy(ctx, sessionID, effectiveWsID, baseWsID, turn, resp.Message)

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
				e.sessionSvc.EmitEphemeralEvent(sessionID, "tool.output", chunkPayload)
			}

			result, execErr := e.toolsReg.Execute(ctx, sessionID, effectiveWsID, tc.Name, tc.Arguments, onOutputChunk)
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
	e.checkpointGitPolicy(ctx, sessionID, effectiveWsID, baseWsID, e.maxTurns, "max turns reached")
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
			var data struct {
				Thought   string     `json:"thought"`
				Message   string     `json:"message"`
				ToolCalls []ToolCall `json:"toolCalls"`
			}
			if err := json.Unmarshal(ev.Payload, &data); err == nil {
				msgs = append(msgs, LLMMessage{
					Role:      "assistant",
					Content:   data.Message,
					ToolCalls: data.ToolCalls,
				})
			}
		case "tool.call":
			var tc ToolCall
			if err := json.Unmarshal(ev.Payload, &tc); err == nil && len(msgs) > 0 && msgs[len(msgs)-1].Role == "assistant" {
				last := &msgs[len(msgs)-1]
				found := false
				for _, existing := range last.ToolCalls {
					if existing.ID == tc.ID {
						found = true
						break
					}
				}
				if !found {
					last.ToolCalls = append(last.ToolCalls, tc)
				}
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
	return CompactContextMessages(msgs)
}

const (
	maxRecentToolOutput = 32000
	maxOlderToolOutput  = 2000
	recentMessageWindow = 6
)

// CompactToolOutput truncates large tool outputs in the middle while preserving head and tail.
func CompactToolOutput(out string, maxLen int) string {
	if len(out) <= maxLen {
		return out
	}
	half := maxLen / 2
	head := out[:half]
	tail := out[len(out)-half:]
	omitted := len(out) - maxLen
	return fmt.Sprintf("%s\n\n[... %d bytes omitted for context compaction ...]\n\n%s", head, omitted, tail)
}

// CompactContextMessages compacts older tool outputs to avoid token blowouts in long sessions.
func CompactContextMessages(msgs []LLMMessage) []LLMMessage {
	if len(msgs) == 0 {
		return msgs
	}
	result := make([]LLMMessage, len(msgs))
	copy(result, msgs)

	cutoff := len(result) - recentMessageWindow
	if cutoff < 0 {
		cutoff = 0
	}

	for i := range result {
		if result[i].Role != "tool" || len(result[i].Content) == 0 {
			continue
		}
		if i < cutoff {
			result[i].Content = CompactToolOutput(result[i].Content, maxOlderToolOutput)
		} else {
			result[i].Content = CompactToolOutput(result[i].Content, maxRecentToolOutput)
		}
	}
	return result
}

// RunSubagent executes an isolated child agent session and returns its synthesized outcome.
func (e *Engine) RunSubagent(ctx context.Context, parentSessionID, role, task, workspaceID string, onChunk func([]byte)) (string, error) {
	parentSess, err := e.sessionSvc.GetSession(ctx, parentSessionID)
	if err != nil {
		return "", fmt.Errorf("parent session not found: %w", err)
	}

	e.mu.Lock()
	e.activeSubagents[parentSessionID]++
	e.mu.Unlock()
	defer func() {
		e.mu.Lock()
		if e.activeSubagents[parentSessionID] > 0 {
			e.activeSubagents[parentSessionID]--
		}
		e.mu.Unlock()
	}()

	title := fmt.Sprintf("[%s] %s", role, task)
	if len(title) > 60 {
		title = title[:60] + "..."
	}

	childSess, err := e.sessionSvc.CreateSession(ctx, parentSess.ServerID, workspaceID, title)
	if err != nil {
		return "", fmt.Errorf("failed to create subagent session: %w", err)
	}

	// Isolate subagent in an ephemeral shadow worktree if Git workspace manager is available
	effectiveWsID := workspaceID
	var shadowCleanup func()
	if e.wsMgr != nil {
		if shadowWs, cleanup, errWs := e.wsMgr.CreateShadowWorktree(workspaceID, childSess.ID); errWs == nil && shadowWs != nil {
			effectiveWsID = shadowWs.ID
			shadowCleanup = cleanup
		}
	}
	if shadowCleanup != nil {
		defer shadowCleanup()
	}

	startPayload, _ := json.Marshal(map[string]interface{}{
		"parentSessionId":   parentSessionID,
		"subagentSessionId": childSess.ID,
		"role":              role,
		"task":              task,
		"workspaceId":       effectiveWsID,
	})
	_, _ = e.sessionSvc.EmitEvent(ctx, parentSessionID, domain.EventSubagentStarted, startPayload)

	subagentPrompt := fmt.Sprintf("You are a specialized subagent acting as %s. Your task is: %s\nFocus strictly on this mission and provide a clear, structured summary of findings.", role, task)

	_ = e.sessionSvc.TransitionState(ctx, childSess.ID, domain.SessionStateStarting, "Starting subagent turn")
	_ = e.sessionSvc.TransitionState(ctx, childSess.ID, domain.SessionStateRunning, "Subagent active")

	promptPayload, _ := json.Marshal(map[string]string{"text": subagentPrompt})
	_, _ = e.sessionSvc.EmitEvent(ctx, childSess.ID, "user.message", promptPayload)

	// Available tools for subagent (exclude invoke_subagent to prevent recursion)
	allTools := e.toolsReg.ListTools()
	var subagentTools []tools.ToolDefinition
	for _, t := range allTools {
		if t.Name != "invoke_subagent" {
			subagentTools = append(subagentTools, t)
		}
	}

	messages := []LLMMessage{
		{Role: "user", Content: subagentPrompt},
	}

	var finalSummary string
	subagentMaxTurns := 10

	for turn := 0; turn < subagentMaxTurns; turn++ {
		if ctx.Err() != nil {
			_ = e.sessionSvc.TransitionState(context.Background(), childSess.ID, domain.SessionStateCancelled, "Subagent cancelled")
			_, _ = e.sessionSvc.EmitEvent(ctx, parentSessionID, domain.EventSubagentFailed, []byte(fmt.Sprintf(`{"error":"cancelled","subagentSessionId":%q}`, childSess.ID)))
			return "", ctx.Err()
		}

		resp, err := e.llmClient.Generate(ctx, messages, subagentTools, func(chunk string) {
			if onChunk != nil {
				onChunk([]byte(chunk))
			}
			_, _ = e.sessionSvc.EmitEvent(ctx, childSess.ID, "agent.thought_chunk", []byte(chunk))
		})
		if err != nil {
			_ = e.sessionSvc.TransitionState(ctx, childSess.ID, domain.SessionStateFailed, err.Error())
			failPayload, _ := json.Marshal(map[string]interface{}{
				"subagentSessionId": childSess.ID,
				"error":             err.Error(),
			})
			_, _ = e.sessionSvc.EmitEvent(ctx, parentSessionID, domain.EventSubagentFailed, failPayload)
			return "", err
		}

		if resp.Thought != "" || resp.Message != "" || len(resp.ToolCalls) > 0 {
			messages = append(messages, LLMMessage{
				Role:      "assistant",
				Content:   resp.Message,
				ToolCalls: resp.ToolCalls,
			})
		}

		if len(resp.ToolCalls) == 0 || resp.Done {
			finalSummary = resp.Message
			_ = e.sessionSvc.TransitionState(ctx, childSess.ID, domain.SessionStateCompleted, "Subagent task complete")
			completePayload, _ := json.Marshal(map[string]interface{}{
				"parentSessionId":   parentSessionID,
				"subagentSessionId": childSess.ID,
				"role":              role,
				"result":            finalSummary,
			})
			_, _ = e.sessionSvc.EmitEvent(ctx, parentSessionID, domain.EventSubagentCompleted, completePayload)

			// Promote shadow worktree changes if isolated shadow was used
			if e.wsMgr != nil && effectiveWsID != workspaceID {
				_, _ = e.wsMgr.PromoteShadowWorktree(workspaceID, childSess.ID, fmt.Sprintf("Subagent [%s]: %s", role, task), role)
			}
			break
		}

		for _, tc := range resp.ToolCalls {
			result, execErr := e.toolsReg.Execute(ctx, childSess.ID, effectiveWsID, tc.Name, tc.Arguments, onChunk)
			if execErr != nil {
				result = &tools.ToolResult{Success: false, Error: execErr.Error()}
			}
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

	return finalSummary, nil
}

// checkpointGitPolicy implements the Staff Engineer Git policy:
// Local checkpoint commit on dedicated session branch; push/merge is governed by policy (never accidental).
func (e *Engine) checkpointGitPolicy(ctx context.Context, sessionID, effectiveWsID, baseWsID string, turn int, summary string) {
	if e.wsMgr == nil || effectiveWsID == "" {
		return
	}
	policy := e.GitPolicy()
	autoCommit := policy.Commit == "auto" || os.Getenv("AG_GIT_AUTO_COMMIT") == "true"
	if !autoCommit {
		return
	}
	diff, err := e.wsMgr.Diff(effectiveWsID)
	if err != nil || diff == nil || diff.Clean {
		return
	}
	branch, _ := e.wsMgr.CurrentBranch(effectiveWsID)
	if branch == "" {
		branch = "main"
	}
	shortSummary := summary
	if len(shortSummary) > 60 {
		shortSummary = shortSummary[:57] + "..."
	}
	if shortSummary == "" {
		shortSummary = "apply workspace changes"
	}
	commitMsg := fmt.Sprintf("chore(antigravity): session %s turn %d - %s", sessionID, turn+1, shortSummary)
	commitRes, err := e.wsMgr.Commit(effectiveWsID, commitMsg, "")
	if err != nil {
		return
	}

	autoPush := policy.Push == "auto" || os.Getenv("AG_GIT_AUTO_PUSH") == "true"
	pushed := false
	if autoPush {
		var pushRes *workspace.GitSyncResult
		if policy.ExpectedBaseCommit != "" {
			pushRes, _ = e.wsMgr.Push(effectiveWsID, "origin", branch, policy.ExpectedBaseCommit)
		} else {
			pushRes, _ = e.wsMgr.Push(effectiveWsID, "origin", branch)
		}
		pushed = pushRes != nil && pushRes.Success
	}

	evtPayload, _ := json.Marshal(map[string]interface{}{
		"commitHash":         commitRes.CommitHash,
		"branch":             branch,
		"effectiveWorkspace": effectiveWsID,
		"baseWorkspace":      baseWsID,
		"pushed":             pushed,
		"pushPolicy":         policy.Push,
		"filesCount":         len(diff.Files),
		"message":            commitMsg,
		"readyForReview":     true,
	})
	_, _ = e.sessionSvc.EmitEvent(ctx, sessionID, "git.checkpoint", evtPayload)
}
