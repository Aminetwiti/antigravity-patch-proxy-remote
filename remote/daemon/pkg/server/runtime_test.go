package server_test

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/antigravity/remote-daemon/pkg/agent"
	"github.com/antigravity/remote-daemon/pkg/approval"
	"github.com/antigravity/remote-daemon/pkg/domain"
	"github.com/antigravity/remote-daemon/pkg/eventstore"
	"github.com/antigravity/remote-daemon/pkg/protocol"
	"github.com/antigravity/remote-daemon/pkg/server"
	"github.com/antigravity/remote-daemon/pkg/tools"
	"github.com/antigravity/remote-daemon/pkg/workspace"
	"github.com/gorilla/websocket"
)

func setupTestServer(t *testing.T) (*server.RuntimeServer, *httptest.Server, func()) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "runtime_test.db")

	store, err := eventstore.NewSQLiteEventStore(dbPath)
	if err != nil {
		t.Fatalf("failed to create sqlite store: %v", err)
	}

	serverInfo := domain.Server{
		ID:        "srv-test-1",
		Hostname:  "test-vps",
		Version:   "2.0.0",
		CreatedAt: time.Now(),
	}

	rt := server.NewRuntimeServer(serverInfo, store)
	httpSrv := httptest.NewServer(rt)

	cleanup := func() {
		httpSrv.Close()
		_ = store.Close()
	}

	return rt, httpSrv, cleanup
}

func toWsURL(httpURL string) string {
	return "ws" + strings.TrimPrefix(httpURL, "http")
}

func TestRuntimeServer_AttachAndCatchup(t *testing.T) {
	rt, httpSrv, cleanup := setupTestServer(t)
	defer cleanup()

	ctx := context.Background()
	svc := rt.SessionService()

	// 1. Create session (creates Seq 1)
	sess, err := svc.CreateSession(ctx, "srv-test-1", "ws-1", "Test Session")
	if err != nil {
		t.Fatalf("CreateSession failed: %v", err)
	}

	// 2. Emit 3 events (Seq 2, 3, 4)
	for i := 1; i <= 3; i++ {
		_, err := svc.EmitEvent(ctx, sess.ID, "agent.thought", []byte(`{"step": 1}`))
		if err != nil {
			t.Fatalf("EmitEvent failed: %v", err)
		}
	}

	// 3. Dial WebSocket
	wsURL := toWsURL(httpSrv.URL)
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial failed: %v", err)
	}
	defer conn.Close()

	// 4. Send Attach with lastSequence = 1 (client already had seq 1, needs 2, 3, 4)
	attachMsg := protocol.V2Envelope{
		Version:      protocol.ProtocolVersion,
		Type:         protocol.TypeSessionAttach,
		SessionID:    sess.ID,
		LastSequence: 1,
	}
	if err := conn.WriteJSON(attachMsg); err != nil {
		t.Fatalf("failed to write attach: %v", err)
	}

	// 5. Read catchup message
	var catchup protocol.CatchupResponse
	if err := conn.ReadJSON(&catchup); err != nil {
		t.Fatalf("failed to read catchup: %v", err)
	}

	if catchup.Type != protocol.TypeSessionCatchup {
		t.Fatalf("expected catchup message type, got: %s", catchup.Type)
	}
	if len(catchup.Events) != 3 {
		t.Fatalf("expected 3 catchup events, got: %d", len(catchup.Events))
	}
	if catchup.Events[0].Sequence != 2 || catchup.Events[2].Sequence != 4 {
		t.Fatalf("unexpected sequence range: %d to %d", catchup.Events[0].Sequence, catchup.Events[2].Sequence)
	}

	// 6. Send live event from server while client is attached
	liveEvt, err := svc.EmitEvent(ctx, sess.ID, "tool.output", []byte(`{"exitCode": 0}`))
	if err != nil {
		t.Fatalf("EmitEvent live failed: %v", err)
	}

	// 7. Read live event message on client
	var liveMsg protocol.LiveEventMessage
	if err := conn.ReadJSON(&liveMsg); err != nil {
		t.Fatalf("failed to read live event: %v", err)
	}

	if liveMsg.Type != protocol.TypeSessionEvent {
		t.Fatalf("expected live event, got: %s", liveMsg.Type)
	}
	if liveMsg.Event.Sequence != liveEvt.Sequence {
		t.Fatalf("expected seq %d, got %d", liveEvt.Sequence, liveMsg.Event.Sequence)
	}
}

func TestRuntimeServer_DisconnectAndReconnect_ZeroLoss(t *testing.T) {
	rt, httpSrv, cleanup := setupTestServer(t)
	defer cleanup()

	ctx := context.Background()
	svc := rt.SessionService()

	// 1. Create session (Seq 1)
	sess, err := svc.CreateSession(ctx, "srv-test-1", "ws-1", "Persist Session")
	if err != nil {
		t.Fatalf("CreateSession failed: %v", err)
	}

	// Emit events 2 and 3
	_, _ = svc.EmitEvent(ctx, sess.ID, "e2", []byte(`{}`))
	_, _ = svc.EmitEvent(ctx, sess.ID, "e3", []byte(`{}`))

	wsURL := toWsURL(httpSrv.URL)

	// 2. Client 1 attaches, catches up to seq 3
	conn1, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial 1 failed: %v", err)
	}

	_ = conn1.WriteJSON(protocol.V2Envelope{
		Version:      protocol.ProtocolVersion,
		Type:         protocol.TypeSessionAttach,
		SessionID:    sess.ID,
		LastSequence: 0,
	})

	var c1Catchup protocol.CatchupResponse
	if err := conn1.ReadJSON(&c1Catchup); err != nil {
		t.Fatalf("c1 catchup failed: %v", err)
	}
	if len(c1Catchup.Events) != 3 {
		t.Fatalf("expected 3 events, got %d", len(c1Catchup.Events))
	}

	// 3. Client 1 disconnects unexpectedly (e.g. mobile lock screen / tunnel drop)
	conn1.Close()
	time.Sleep(50 * time.Millisecond)

	// 4. Server continues running autonomously! Emits events 4, 5, 6 while client is offline
	_, _ = svc.EmitEvent(ctx, sess.ID, "offline_work_4", []byte(`{}`))
	_, _ = svc.EmitEvent(ctx, sess.ID, "offline_work_5", []byte(`{}`))
	_, _ = svc.EmitEvent(ctx, sess.ID, "offline_work_6", []byte(`{}`))

	// 5. Client reconnects, asking for events since last known sequence (3)
	conn2, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial 2 failed: %v", err)
	}
	defer conn2.Close()

	_ = conn2.WriteJSON(protocol.V2Envelope{
		Version:      protocol.ProtocolVersion,
		Type:         protocol.TypeSessionAttach,
		SessionID:    sess.ID,
		LastSequence: 3, // Client knows up to seq 3
	})

	var c2Catchup protocol.CatchupResponse
	if err := conn2.ReadJSON(&c2Catchup); err != nil {
		t.Fatalf("c2 catchup failed: %v", err)
	}

	// Verify ZERO lost events, ZERO duplicate events
	if len(c2Catchup.Events) != 3 {
		t.Fatalf("expected 3 catchup events (4, 5, 6), got %d", len(c2Catchup.Events))
	}
	expectedSeqs := []int64{4, 5, 6}
	for i, ev := range c2Catchup.Events {
		if ev.Sequence != expectedSeqs[i] {
			t.Fatalf("event index %d: expected seq %d, got %d", i, expectedSeqs[i], ev.Sequence)
		}
	}
}

func TestRuntimeServer_MultiClientBroadcast(t *testing.T) {
	rt, httpSrv, cleanup := setupTestServer(t)
	defer cleanup()

	ctx := context.Background()
	svc := rt.SessionService()

	sess, err := svc.CreateSession(ctx, "srv-test-1", "ws-1", "Multi-Client")
	if err != nil {
		t.Fatalf("CreateSession failed: %v", err)
	}

	wsURL := toWsURL(httpSrv.URL)

	// Connect Client 1 (e.g. Desktop)
	conn1, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial conn1 failed: %v", err)
	}
	defer conn1.Close()

	_ = conn1.WriteJSON(protocol.V2Envelope{
		Version:      protocol.ProtocolVersion,
		Type:         protocol.TypeSessionAttach,
		SessionID:    sess.ID,
		LastSequence: 1,
	})
	var cu1 protocol.CatchupResponse
	_ = conn1.ReadJSON(&cu1)

	// Connect Client 2 (e.g. Mobile)
	conn2, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial conn2 failed: %v", err)
	}
	defer conn2.Close()

	_ = conn2.WriteJSON(protocol.V2Envelope{
		Version:      protocol.ProtocolVersion,
		Type:         protocol.TypeSessionAttach,
		SessionID:    sess.ID,
		LastSequence: 1,
	})
	var cu2 protocol.CatchupResponse
	_ = conn2.ReadJSON(&cu2)

	if rt.AttachedCount(sess.ID) != 2 {
		t.Fatalf("expected 2 attached clients, got %d", rt.AttachedCount(sess.ID))
	}

	// Server broadcasts an event
	liveEvt, err := svc.EmitEvent(ctx, sess.ID, "broadcast.test", []byte(`{"hello":"world"}`))
	if err != nil {
		t.Fatalf("EmitEvent failed: %v", err)
	}

	// Both clients must receive it
	var wg sync.WaitGroup
	wg.Add(2)

	checkClient := func(c *websocket.Conn, name string) {
		defer wg.Done()
		var msg protocol.LiveEventMessage
		if err := c.ReadJSON(&msg); err != nil {
			t.Errorf("%s failed to read live event: %v", name, err)
			return
		}
		if msg.Event.Sequence != liveEvt.Sequence {
			t.Errorf("%s sequence mismatch: expected %d, got %d", name, liveEvt.Sequence, msg.Event.Sequence)
		}
	}

	go checkClient(conn1, "desktop")
	go checkClient(conn2, "mobile")

	wg.Wait()
}

func TestRuntimeServer_CommandExecutionAndIdempotency(t *testing.T) {
	rt, httpSrv, cleanup := setupTestServer(t)
	defer cleanup()

	ctx := context.Background()
	svc := rt.SessionService()

	sess, err := svc.CreateSession(ctx, "srv-test-1", "ws-1", "Commands")
	if err != nil {
		t.Fatalf("CreateSession failed: %v", err)
	}

	// Session starts in 'created' state. Transition to 'starting' then 'running'
	if err := svc.TransitionState(ctx, sess.ID, domain.SessionStateStarting, "starting"); err != nil {
		t.Fatalf("TransitionState starting failed: %v", err)
	}
	if err := svc.TransitionState(ctx, sess.ID, domain.SessionStateRunning, "running"); err != nil {
		t.Fatalf("TransitionState running failed: %v", err)
	}

	wsURL := toWsURL(httpSrv.URL)
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial failed: %v", err)
	}
	defer conn.Close()

	// 1. Send Pause command via WebSocket
	pauseMsg := protocol.V2Envelope{
		Version:   protocol.ProtocolVersion,
		Type:      protocol.TypeSessionPause,
		RequestID: "req-pause-001",
		SessionID: sess.ID,
		Payload:   json.RawMessage(`{"reason":"user clicked pause"}`),
	}
	if err := conn.WriteJSON(pauseMsg); err != nil {
		t.Fatalf("failed to write pause: %v", err)
	}

	var ack protocol.AckResponse
	if err := conn.ReadJSON(&ack); err != nil {
		t.Fatalf("failed to read ack: %v", err)
	}

	if !ack.Success || ack.RequestID != "req-pause-001" {
		t.Fatalf("expected successful ack for req-pause-001, got %+v", ack)
	}

	// Verify state is paused
	currentSess, _ := svc.GetSession(ctx, sess.ID)
	if currentSess.State != domain.SessionStatePaused {
		t.Fatalf("expected state paused, got: %s", currentSess.State)
	}

	// 2. Resend same command (idempotent retry)
	if err := conn.WriteJSON(pauseMsg); err != nil {
		t.Fatalf("failed to resend pause: %v", err)
	}

	var retryAck protocol.AckResponse
	if err := conn.ReadJSON(&retryAck); err != nil {
		t.Fatalf("failed to read retry ack: %v", err)
	}
	if !retryAck.Success {
		t.Fatalf("expected successful idempotent ack, got %+v", retryAck)
	}

	// 3. Send conflicting command with same RequestID but different payload
	conflictMsg := protocol.V2Envelope{
		Version:   protocol.ProtocolVersion,
		Type:      protocol.TypeSessionPause,
		RequestID: "req-pause-001",
		SessionID: sess.ID,
		Payload:   json.RawMessage(`{"reason":"DIFFERENT REASON"}`),
	}
	if err := conn.WriteJSON(conflictMsg); err != nil {
		t.Fatalf("failed to write conflictMsg: %v", err)
	}

	var errResp protocol.ErrorResponse
	if err := conn.ReadJSON(&errResp); err != nil {
		t.Fatalf("failed to read errResp: %v", err)
	}
	if errResp.Type != protocol.TypeErrorResponse || !strings.Contains(errResp.Error, "conflicting") {
		t.Fatalf("expected conflict error, got %+v", errResp)
	}
}

func TestRuntimeServer_CatchupLiveRaceCondition(t *testing.T) {
	rt, httpSrv, cleanup := setupTestServer(t)
	defer cleanup()

	ctx := context.Background()
	svc := rt.SessionService()

	sess, err := svc.CreateSession(ctx, "srv-test-1", "ws-1", "Race Condition Test")
	if err != nil {
		t.Fatalf("CreateSession failed: %v", err)
	}

	// Pre-populate 50 events
	for i := 1; i <= 50; i++ {
		_, err := svc.EmitEvent(ctx, sess.ID, "seed.event", []byte(`{}`))
		if err != nil {
			t.Fatalf("seed failed: %v", err)
		}
	}

	wsURL := toWsURL(httpSrv.URL)
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial failed: %v", err)
	}
	defer conn.Close()

	// Concurrently emit 50 more events while attaching
	emitDone := make(chan struct{})
	go func() {
		defer close(emitDone)
		for i := 1; i <= 50; i++ {
			_, _ = svc.EmitEvent(ctx, sess.ID, "live.event", []byte(`{}`))
			time.Sleep(1 * time.Millisecond)
		}
	}()

	// Attach with lastSequence = 20 (so it has to catch up 30 seeded events + whatever live events happen)
	_ = conn.WriteJSON(protocol.V2Envelope{
		Version:      protocol.ProtocolVersion,
		Type:         protocol.TypeSessionAttach,
		SessionID:    sess.ID,
		LastSequence: 20,
	})

	// Collect all events received by client
	receivedSeqs := make([]int64, 0, 100)
	var mu sync.Mutex

	// Read initial catchup
	var catchup protocol.CatchupResponse
	if err := conn.ReadJSON(&catchup); err != nil {
		t.Fatalf("read catchup failed: %v", err)
	}
	for _, ev := range catchup.Events {
		receivedSeqs = append(receivedSeqs, ev.Sequence)
	}

	<-emitDone

	// Give a moment for any in-flight live events to arrive over ws
	time.Sleep(50 * time.Millisecond)

	// Read remaining live events with short timeout
	_ = conn.SetReadDeadline(time.Now().Add(200 * time.Millisecond))
	for {
		var liveMsg protocol.LiveEventMessage
		if err := conn.ReadJSON(&liveMsg); err != nil {
			break
		}
		mu.Lock()
		receivedSeqs = append(receivedSeqs, liveMsg.Event.Sequence)
		mu.Unlock()
	}

	// Verify all received sequences are strictly increasing with NO duplicates
	if len(receivedSeqs) == 0 {
		t.Fatalf("expected to receive events, got none")
	}

	seen := make(map[int64]bool)
	for i, seq := range receivedSeqs {
		if seen[seq] {
			t.Fatalf("duplicate event sequence received: %d", seq)
		}
		seen[seq] = true
		if i > 0 && seq <= receivedSeqs[i-1] {
			t.Fatalf("events received out of order: seq[%d]=%d <= seq[%d]=%d", i, seq, i-1, receivedSeqs[i-1])
		}
	}
}

func TestRuntimeServer_EndToEndAgentPromptAndApproval(t *testing.T) {
	rt, httpSrv, cleanup := setupTestServer(t)
	defer cleanup()

	ctx := context.Background()
	svc := rt.SessionService()
	wsMgr := workspace.NewManager()
	tmpDir := t.TempDir()
	ws, err := wsMgr.RegisterWorkspace("ws-agent-e2e", "e2e-project", tmpDir)
	if err != nil {
		t.Fatalf("RegisterWorkspace failed: %v", err)
	}

	apprMgr := approval.NewManager(svc, 5*time.Second)
	toolsReg := tools.NewRegistry(wsMgr, false) // gated mode: run_command requires approval

	resp1 := &agent.LLMResponse{
		Thought: "I need to run whoami to verify.",
		ToolCalls: []agent.ToolCall{
			{
				ID:   "call_whoami_1",
				Name: "run_command",
				Arguments: json.RawMessage(`{"command": "whoami"}`),
			},
		},
		Done: false,
	}
	resp2 := &agent.LLMResponse{
		Thought: "Command executed successfully.",
		Message: "Task complete.",
		Done:    true,
	}

	mockLLM := agent.NewMockLLMClient(resp1, resp2)
	eng := agent.NewEngine(svc, wsMgr, toolsReg, apprMgr, mockLLM)
	rt.SetAgentEngine(eng, apprMgr)

	// Create session
	sess, err := svc.CreateSession(ctx, "srv-test-1", ws.ID, "E2E Agent Session")
	if err != nil {
		t.Fatalf("CreateSession failed: %v", err)
	}

	wsURL := toWsURL(httpSrv.URL)
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial failed: %v", err)
	}
	defer conn.Close()

	// 1. Attach to session
	_ = conn.WriteJSON(protocol.V2Envelope{
		Version:      protocol.ProtocolVersion,
		Type:         protocol.TypeSessionAttach,
		SessionID:    sess.ID,
		LastSequence: 0,
	})

	var catchup protocol.CatchupResponse
	if err := conn.ReadJSON(&catchup); err != nil {
		t.Fatalf("read catchup failed: %v", err)
	}

	// 2. Send session.prompt
	promptMsg := protocol.V2Envelope{
		Version:   protocol.ProtocolVersion,
		Type:      protocol.TypeSessionPrompt,
		RequestID: "req-prompt-001",
		SessionID: sess.ID,
		Payload:   json.RawMessage(`{"text": "Execute system check"}`),
	}
	if err := conn.WriteJSON(promptMsg); err != nil {
		t.Fatalf("failed to write prompt: %v", err)
	}

	// 3. Read messages in client event loop
	promptAcked := false
	approvalSent := false
	apprAcked := false
	completedFound := false

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) && !completedFound {
		_ = conn.SetReadDeadline(time.Now().Add(1 * time.Second))
		_, msgBytes, err := conn.ReadMessage()
		if err != nil {
			break
		}

		var base struct {
			Type      string `json:"type"`
			RequestID string `json:"requestId"`
		}
		_ = json.Unmarshal(msgBytes, &base)

		switch base.Type {
		case protocol.TypeSessionAck:
			if base.RequestID == "req-prompt-001" {
				promptAcked = true
			} else if base.RequestID == "req-appr-001" {
				apprAcked = true
			}

		case protocol.TypeSessionEvent:
			var live protocol.LiveEventMessage
			_ = json.Unmarshal(msgBytes, &live)

			if live.Event.Type == "approval.requested" && !approvalSent {
				var apprReq approval.ApprovalRequest
				_ = json.Unmarshal(live.Event.Payload, &apprReq)

				if apprReq.ToolName != "run_command" {
					t.Fatalf("expected approval for run_command, got: %s", apprReq.ToolName)
				}

				respPayload, _ := json.Marshal(protocol.ApprovalRespondPayload{
					ApprovalID: apprReq.ID,
					Approved:   true,
					Reason:     "approved by test client",
				})
				apprMsg := protocol.V2Envelope{
					Version:   protocol.ProtocolVersion,
					Type:      protocol.TypeApprovalRespond,
					RequestID: "req-appr-001",
					SessionID: sess.ID,
					Payload:   respPayload,
				}
				if err := conn.WriteJSON(apprMsg); err != nil {
					t.Fatalf("failed to send approval response: %v", err)
				}
				approvalSent = true
			} else if live.Event.Type == "agent.completed" {
				completedFound = true
			}
		}
	}

	if !promptAcked {
		t.Fatalf("expected prompt to be acknowledged")
	}
	if !approvalSent {
		t.Fatalf("expected approval.requested event to be received and answered")
	}
	if !apprAcked {
		t.Fatalf("expected approval response to be acknowledged")
	}
	if !completedFound {
		t.Fatalf("expected agent.completed live event to be received")
	}
}

func TestRuntimeServer_PromptOnCancelledSession_ReturnsError(t *testing.T) {
	rt, httpSrv, cleanup := setupTestServer(t)
	defer cleanup()

	ctx := context.Background()
	svc := rt.SessionService()
	sess, err := svc.CreateSession(ctx, "srv-1", "ws-1", "Test Session")
	if err != nil {
		t.Fatalf("failed to create session: %v", err)
	}

	// Transition to CANCELLED
	if err := svc.TransitionState(ctx, sess.ID, domain.SessionStateCancelled, "cancelled by user"); err != nil {
		t.Fatalf("failed to cancel session: %v", err)
	}

	wsURL := toWsURL(httpSrv.URL) + "/v2/runtime/ws"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("failed to dial websocket: %v", err)
	}
	defer conn.Close()

	// Attach to session
	attachMsg := protocol.V2Envelope{
		Version:   protocol.ProtocolVersion,
		Type:      protocol.TypeSessionAttach,
		RequestID: "req-attach-canc",
		SessionID: sess.ID,
		Payload:   []byte(`{"lastSequence": 0}`),
	}
	if err := conn.WriteJSON(attachMsg); err != nil {
		t.Fatalf("failed to write attach: %v", err)
	}

	// Read attach catchup
	var catchup protocol.CatchupResponse
	if err := conn.ReadJSON(&catchup); err != nil {
		t.Fatalf("failed to read attach catchup: %v", err)
	}

	// Now try to send a prompt to the cancelled session
	promptMsg := protocol.V2Envelope{
		Version:   protocol.ProtocolVersion,
		Type:      protocol.TypeSessionPrompt,
		RequestID: "req-prompt-canc",
		SessionID: sess.ID,
		Payload:   []byte(`{"text":"hello cancelled session"}`),
	}
	if err := conn.WriteJSON(promptMsg); err != nil {
		t.Fatalf("failed to write prompt: %v", err)
	}

	// Read response - must be an error
	var errResp protocol.ErrorResponse
	if err := conn.ReadJSON(&errResp); err != nil {
		t.Fatalf("failed to read error response: %v", err)
	}
	if errResp.Type != protocol.TypeErrorResponse || !strings.Contains(errResp.Error, "terminal") {
		t.Fatalf("expected terminal session error, got: %+v", errResp)
	}
}

func TestRuntimeServer_ApprovalCrossSession_IsRejected(t *testing.T) {
	rt, httpSrv, cleanup := setupTestServer(t)
	defer cleanup()

	ctx := context.Background()
	svc := rt.SessionService()
	sess1, err := svc.CreateSession(ctx, "srv-1", "ws-1", "Victim Session")
	if err != nil {
		t.Fatalf("failed to create session 1: %v", err)
	}
	_ = svc.TransitionState(ctx, sess1.ID, domain.SessionStateStarting, "start")
	_ = svc.TransitionState(ctx, sess1.ID, domain.SessionStateRunning, "run")

	sess2, err := svc.CreateSession(ctx, "srv-1", "ws-1", "Attacker Session")
	if err != nil {
		t.Fatalf("failed to create session 2: %v", err)
	}

	apprMgr := approval.NewManager(svc, 10*time.Second)
	rt.SetAgentEngine(nil, apprMgr)
	go func() {
		_, _ = apprMgr.RequestApproval(ctx, sess1.ID, "run_command", []byte(`{"command":"rm -rf /"}`), "Dangerous command", 10)
	}()

	var apprID string
	for i := 0; i < 20; i++ {
		reqs := apprMgr.GetPendingRequests(sess1.ID)
		if len(reqs) > 0 {
			apprID = reqs[0].ID
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if apprID == "" {
		t.Fatalf("failed to acquire pending approval id")
	}

	wsURL := toWsURL(httpSrv.URL) + "/v2/runtime/ws"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("failed to dial websocket: %v", err)
	}
	defer conn.Close()

	// Attempt 1: Resolve approval using attacker's session ID (sess2.ID) for sess1's approval
	respPayload, _ := json.Marshal(protocol.ApprovalRespondPayload{
		ApprovalID: apprID,
		Approved:   true,
		Reason:     "spoofed by attacker",
	})
	spoofedMsg := protocol.V2Envelope{
		Version:   protocol.ProtocolVersion,
		Type:      protocol.TypeApprovalRespond,
		RequestID: "req-spoof-001",
		SessionID: sess2.ID, // Attacker session ID
		Payload:   respPayload,
	}
	if err := conn.WriteJSON(spoofedMsg); err != nil {
		t.Fatalf("failed to write spoofed approval: %v", err)
	}

	var errResp protocol.ErrorResponse
	if err := conn.ReadJSON(&errResp); err != nil {
		t.Fatalf("failed to read error response: %v", err)
	}
	if errResp.Type != protocol.TypeErrorResponse || !strings.Contains(errResp.Error, "mismatch") {
		t.Fatalf("expected session mismatch error, got: %+v", errResp)
	}
}




