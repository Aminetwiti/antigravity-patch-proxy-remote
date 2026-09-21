package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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
	"github.com/gorilla/websocket"
)

func setupV1AdapterTestServer(t *testing.T, authToken string) (*V1Adapter, *httptest.Server, func()) {
	t.Helper()
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "v1_test.db")
	store, err := eventstore.NewSQLiteEventStore(dbPath)
	if err != nil {
		t.Fatalf("failed to create sqlite event store: %v", err)
	}

	sessionSvc := session.NewService(store, nil)
	wsMgr := workspace.NewManager()
	_, _ = wsMgr.RegisterWorkspace("default-workspace", "default-workspace", dir)

	reg := tools.NewRegistry(wsMgr, false)
	apprMgr := approval.NewManager(sessionSvc, 5*time.Second)

	llm := &agent.MockLLMClient{
		Responses: []*agent.LLMResponse{
			{
				Thought:   "I will test v1 adapter",
				ToolCalls: nil,
				Done:      true,
			},
		},
	}

	engine := agent.NewEngine(sessionSvc, wsMgr, reg, apprMgr, llm)
	adapter := NewV1Adapter(sessionSvc, store, wsMgr, engine, apprMgr, authToken)

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", adapter.HandleWebSocket)
	ts := httptest.NewServer(mux)

	cleanup := func() {
		ts.Close()
		store.Close()
	}

	return adapter, ts, cleanup
}

func TestV1Adapter_AuthAndHandshake(t *testing.T) {
	_, ts, cleanup := setupV1AdapterTestServer(t, "v1-secret")
	defer cleanup()

	// Connect without token -> should fail 401
	uNoAuth := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws"
	_, _, err := websocket.DefaultDialer.Dial(uNoAuth, nil)
	if err == nil {
		t.Fatalf("expected failure connecting without token, got success")
	}

	// Connect with token query param
	uAuth := uNoAuth + "?token=v1-secret"
	conn, resp, err := websocket.DefaultDialer.Dial(uAuth, nil)
	if err != nil {
		t.Fatalf("failed to dial with token: %v", err)
	}
	defer conn.Close()

	if resp.StatusCode != http.StatusSwitchingProtocols {
		t.Fatalf("expected 101 Switching Protocols, got %d", resp.StatusCode)
	}

	// Ping
	ping := map[string]string{"type": "ping", "requestId": "req-ping-1"}
	if err := conn.WriteJSON(ping); err != nil {
		t.Fatalf("failed to send ping: %v", err)
	}

	var pong map[string]interface{}
	if err := conn.ReadJSON(&pong); err != nil {
		t.Fatalf("failed to read pong: %v", err)
	}
	if pong["type"] != "pong" {
		t.Errorf("expected pong, got %v", pong["type"])
	}
}

func TestV1Adapter_ListSessionsAndCreateCascade(t *testing.T) {
	adapter, ts, cleanup := setupV1AdapterTestServer(t, "")
	defer cleanup()

	u := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws"
	conn, _, err := websocket.DefaultDialer.Dial(u, nil)
	if err != nil {
		t.Fatalf("failed to dial: %v", err)
	}
	defer conn.Close()

	// 1. Create a session via sessionService
	sess, err := adapter.sessionSvc.CreateSession(context.Background(), "test-server", "default-workspace", "Test Session")
	if err != nil {
		t.Fatalf("failed to create session: %v", err)
	}

	// 2. Request list_sessions
	if err := conn.WriteJSON(map[string]string{
		"type":      "list_sessions",
		"requestId": "r-list",
	}); err != nil {
		t.Fatalf("failed to send list_sessions: %v", err)
	}

	var res V1OutgoingMessage
	if err := conn.ReadJSON(&res); err != nil {
		t.Fatalf("failed to read list_sessions response: %v", err)
	}

	if res.Type != "response" || res.RequestID != "r-list" {
		t.Fatalf("unexpected response: %+v", res)
	}

	dataBytes, _ := json.Marshal(res.Data)
	var dataMap map[string][]map[string]interface{}
	_ = json.Unmarshal(dataBytes, &dataMap)

	sessions := dataMap["sessions"]
	if len(sessions) != 1 {
		t.Fatalf("expected 1 session, got %d", len(sessions))
	}
	if sessions[0]["cascadeId"] != sess.ID {
		t.Errorf("expected cascadeId %s, got %s", sess.ID, sessions[0]["cascadeId"])
	}

	// 3. Create new conversation via WebSocket
	if err := conn.WriteJSON(map[string]string{
		"type":      "new_conversation",
		"requestId": "r-new",
	}); err != nil {
		t.Fatalf("failed to send new_conversation: %v", err)
	}

	var newRes V1OutgoingMessage
	if err := conn.ReadJSON(&newRes); err != nil {
		t.Fatalf("failed to read new_conversation response: %v", err)
	}
	if newRes.Type != "response" || newRes.RequestID != "r-new" {
		t.Fatalf("unexpected new_conversation response: %+v", newRes)
	}
}

func TestV1Adapter_PromptStreamingAndApproval(t *testing.T) {
	adapter, ts, cleanup := setupV1AdapterTestServer(t, "")
	defer cleanup()

	u := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws"
	conn, _, err := websocket.DefaultDialer.Dial(u, nil)
	if err != nil {
		t.Fatalf("failed to dial: %v", err)
	}
	defer conn.Close()

	sess, err := adapter.sessionSvc.CreateSession(context.Background(), "test-server", "default-workspace", "Test Prompt")
	if err != nil {
		t.Fatalf("failed to create session: %v", err)
	}

	// Send prompt
	if err := conn.WriteJSON(map[string]string{
		"type":      "send_prompt",
		"requestId": "p-1",
		"cascadeId": sess.ID,
		"prompt":    "Hello from mobile app",
	}); err != nil {
		t.Fatalf("failed to send send_prompt: %v", err)
	}

	// Expect stream_start
	var startMsg V1OutgoingMessage
	if err := conn.ReadJSON(&startMsg); err != nil {
		t.Fatalf("failed to read stream_start: %v", err)
	}
	if startMsg.Type != "stream_start" || startMsg.RequestID != "p-1" {
		t.Fatalf("expected stream_start, got: %+v", startMsg)
	}

	// Test OnDomainEvent thought chunk
	adapter.OnDomainEvent(domain.Event{
		SessionID: sess.ID,
		Type:      "agent.thought_chunk",
		Payload:   []byte(`{"chunk": "Thinking about the task..."}`),
	})

	var deltaMsg V1OutgoingMessage
	if err := conn.ReadJSON(&deltaMsg); err != nil {
		t.Fatalf("failed to read stream_delta: %v", err)
	}
	if deltaMsg.Type != "stream_delta" {
		t.Fatalf("expected stream_delta, got: %+v", deltaMsg)
	}

	// Transition isolated session through valid FSM states for approval test: CREATED -> STARTING -> RUNNING
	apprSess, err := adapter.sessionSvc.CreateSession(context.Background(), "test-server", "default-workspace", "Approval Session")
	if err != nil {
		t.Fatalf("failed to create approval session: %v", err)
	}
	_ = adapter.sessionSvc.TransitionState(context.Background(), apprSess.ID, domain.SessionStateStarting, "starting")
	_ = adapter.sessionSvc.TransitionState(context.Background(), apprSess.ID, domain.SessionStateRunning, "running")

	var apprErr error
	go func() {
		params := json.RawMessage(`{"command": "rm -rf /tmp"}`)
		_, apprErr = adapter.approvalMgr.RequestApproval(context.Background(), apprSess.ID, "run_command", params, "Test danger", 5)
	}()

	time.Sleep(50 * time.Millisecond)
	reqs := adapter.approvalMgr.GetPendingRequests(apprSess.ID)
	if len(reqs) == 0 {
		t.Fatalf("expected pending approval request, apprErr: %v", apprErr)
	}
	apprID := reqs[0].ID

	adapter.OnDomainEvent(domain.Event{
		SessionID: apprSess.ID,
		Type:      "approval.requested",
		Payload:   []byte(`{"approval_id": "` + apprID + `", "tool": "run_command", "args": {"command": "rm -rf /tmp"}}`),
	})

	var apprMsg V1OutgoingMessage
	if err := conn.ReadJSON(&apprMsg); err != nil {
		t.Fatalf("failed to read approval_pending: %v", err)
	}
	if apprMsg.Type != "approval_pending" {
		t.Fatalf("expected approval_pending, got: %+v", apprMsg)
	}

	// Client submits approval response
	if err := conn.WriteJSON(map[string]string{
		"type":      "submit_approval",
		"requestId": "appr-resp-1",
		"callId":    apprID,
		"decision":  "allow",
	}); err != nil {
		t.Fatalf("failed to send submit_approval: %v", err)
	}

	var apprRes V1OutgoingMessage
	if err := conn.ReadJSON(&apprRes); err != nil {
		t.Fatalf("failed to read submit_approval response: %v", err)
	}
	if apprRes.Type != "response" || apprRes.RequestID != "appr-resp-1" {
		t.Fatalf("expected response, got: %+v", apprRes)
	}

	// Test stream_end
	adapter.OnDomainEvent(domain.Event{
		SessionID: sess.ID,
		Type:      "agent.completed",
	})

	var endMsg V1OutgoingMessage
	if err := conn.ReadJSON(&endMsg); err != nil {
		t.Fatalf("failed to read stream_end: %v", err)
	}
	if endMsg.Type != "stream_end" {
		t.Fatalf("expected stream_end, got: %+v", endMsg)
	}
}

func TestV1Adapter_FileOperations(t *testing.T) {
	_, ts, cleanup := setupV1AdapterTestServer(t, "")
	defer cleanup()

	u := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws"
	conn, _, err := websocket.DefaultDialer.Dial(u, nil)
	if err != nil {
		t.Fatalf("failed to dial: %v", err)
	}
	defer conn.Close()

	// 1. Write file
	writeReq := map[string]interface{}{
		"type":          "write_file",
		"requestId":     "req-wf-1",
		"workspacePath": "default-workspace",
		"filePath":      "hello.txt",
		"content":       "SGVsbG8gRnJvbSBWMSBBZGFwdGVyIQ==", // "Hello From V1 Adapter!" base64
		"overwrite":     true,
	}
	if err := conn.WriteJSON(writeReq); err != nil {
		t.Fatalf("failed to write file: %v", err)
	}

	var writeRes V1OutgoingMessage
	if err := conn.ReadJSON(&writeRes); err != nil {
		t.Fatalf("failed to read write_file response: %v", err)
	}
	if writeRes.Type != "response" || writeRes.RequestID != "req-wf-1" {
		t.Fatalf("unexpected write_file response: %+v", writeRes)
	}

	// 2. Read file
	readReq := map[string]string{
		"type":          "read_file",
		"requestId":     "req-rf-1",
		"workspacePath": "default-workspace",
		"filePath":      "hello.txt",
	}
	if err := conn.WriteJSON(readReq); err != nil {
		t.Fatalf("failed to send read_file: %v", err)
	}

	var readRes V1OutgoingMessage
	if err := conn.ReadJSON(&readRes); err != nil {
		t.Fatalf("failed to read read_file response: %v", err)
	}
	if readRes.Type != "response" || readRes.RequestID != "req-rf-1" {
		t.Fatalf("unexpected read_file response: %+v", readRes)
	}

	dataMap, _ := readRes.Data.(map[string]interface{})
	if dataMap["content"] != "SGVsbG8gRnJvbSBWMSBBZGFwdGVyIQ==" {
		t.Errorf("expected content 'SGVsbG8gRnJvbSBWMSBBZGFwdGVyIQ==', got %v", dataMap["content"])
	}

	// 3. List workspaces
	listWsReq := map[string]string{
		"type":      "list_workspaces",
		"requestId": "req-lw-1",
	}
	if err := conn.WriteJSON(listWsReq); err != nil {
		t.Fatalf("failed to send list_workspaces: %v", err)
	}

	var listWsRes V1OutgoingMessage
	if err := conn.ReadJSON(&listWsRes); err != nil {
		t.Fatalf("failed to read list_workspaces response: %v", err)
	}
	if listWsRes.Type != "response" || listWsRes.RequestID != "req-lw-1" {
		t.Fatalf("unexpected list_workspaces response: %+v", listWsRes)
	}
}

func TestV1Adapter_SyncSessionCatchup(t *testing.T) {
	adapter, ts, cleanup := setupV1AdapterTestServer(t, "")
	defer cleanup()

	ctx := context.Background()
	sess, err := adapter.sessionSvc.CreateSession(ctx, "srv-1", "default-workspace", "Sync Session Test")
	if err != nil {
		t.Fatalf("failed to create session: %v", err)
	}

	// Append 3 events to the session in SQLite
	_, _ = adapter.eventStore.AppendEvent(ctx, sess.ID, "evt-1", "user.prompt", []byte(`{"text":"hello"}`))
	_, _ = adapter.eventStore.AppendEvent(ctx, sess.ID, "evt-2", "agent.thought", []byte(`{"thought":"working"}`))
	_, _ = adapter.eventStore.AppendEvent(ctx, sess.ID, "evt-3", "agent.finish", []byte(`{"result":"done"}`))

	// Save snapshot
	_ = adapter.eventStore.SaveSnapshot(ctx, &domain.Snapshot{
		SessionID:  sess.ID,
		Sequence:   3,
		State:      domain.SessionStateRunning,
		Title:      sess.Title,
		CapturedAt: time.Now(),
	})

	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial failed: %v", err)
	}
	defer conn.Close()

	// Send sync_session request asking for events since step 1
	syncReq := map[string]interface{}{
		"type":          "sync_session",
		"requestId":     "req-sync-v1",
		"cascadeId":     sess.ID,
		"lastStepIndex": 1,
	}
	if err := conn.WriteJSON(syncReq); err != nil {
		t.Fatalf("failed to send sync_session: %v", err)
	}

	var syncRes V1OutgoingMessage
	if err := conn.ReadJSON(&syncRes); err != nil {
		t.Fatalf("failed to read sync_catchup: %v", err)
	}

	if syncRes.Type != "sync_catchup" || syncRes.RequestID != "req-sync-v1" {
		t.Fatalf("expected sync_catchup response, got: %+v", syncRes)
	}

	dataMap, _ := syncRes.Data.(map[string]interface{})
	if dataMap == nil {
		t.Fatalf("expected data map in sync_catchup response: %+v", syncRes)
	}

	missed, _ := dataMap["missedEvents"].([]interface{})
	if len(missed) != 3 {
		t.Errorf("expected 3 missed events, got: %d", len(missed))
	}

	currStep, _ := dataMap["currentStepIndex"].(float64)
	if int64(currStep) != 4 {
		t.Errorf("expected currentStepIndex 4, got: %v", currStep)
	}

	if dataMap["snapshot"] == nil {
		t.Errorf("expected snapshot in sync_catchup, got nil")
	}
}
