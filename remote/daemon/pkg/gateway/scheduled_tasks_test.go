package gateway

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestScheduledTasks_RPCAndWSFlow(t *testing.T) {
	dir := t.TempDir()
	old := scheduledTasksPath
	oldSidecars := sidecarsDirPath
	oldConfig := mainConfigFilePath
	scheduledTasksPath = filepath.Join(dir, "scheduled_tasks.json")
	sidecarsDirPath = filepath.Join(dir, "sidecars")
	mainConfigFilePath = filepath.Join(dir, "config.json")
	defer func() {
		scheduledTasksPath = old
		sidecarsDirPath = oldSidecars
		mainConfigFilePath = oldConfig
	}()

	backend := &fakeRPCClient{}
	server := NewServer(backend, "")
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", server.HandleWebSocket)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"
	dialer := websocket.Dialer{HandshakeTimeout: 2 * time.Second}
	conn, _, err := dialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("Dial err: %v", err)
	}
	defer conn.Close()

	// 1. list_scheduled_tasks
	reqList := map[string]interface{}{
		"type":      "list_scheduled_tasks",
		"requestId": "req_list_1",
	}
	if err := conn.WriteJSON(reqList); err != nil {
		t.Fatalf("WriteJSON err: %v", err)
	}

	var resList OutgoingMessage
	if err := conn.ReadJSON(&resList); err != nil {
		t.Fatalf("ReadJSON err: %v", err)
	}
	if resList.Type != "response" || resList.RequestID != "req_list_1" {
		t.Fatalf("Unexpected list response: %+v", resList)
	}

	// 2. schedule_task
	reqCreate := map[string]interface{}{
		"type":      "schedule_task",
		"requestId": "req_create_1",
		"taskId":    "task_test_99",
		"data": map[string]interface{}{
			"name":           "CI Runner",
			"prompt":         "run all tests",
			"workspaceName":  "antigravity-add-model-main",
			"cronExpression": "0 18 * * *",
			"isEnabled":      true,
		},
	}
	if err := conn.WriteJSON(reqCreate); err != nil {
		t.Fatalf("WriteJSON err: %v", err)
	}

	// Read broadcast event or unary response
	var msg1, msg2 OutgoingMessage
	_ = conn.ReadJSON(&msg1)
	_ = conn.ReadJSON(&msg2)

	var resCreate *OutgoingMessage
	if msg1.RequestID == "req_create_1" {
		resCreate = &msg1
	} else if msg2.RequestID == "req_create_1" {
		resCreate = &msg2
	}
	if resCreate == nil {
		t.Fatalf("Did not receive create response: msg1=%+v, msg2=%+v", msg1, msg2)
	}

	// 3. update_scheduled_task
	reqUpdate := map[string]interface{}{
		"type":      "update_scheduled_task",
		"requestId": "req_up_1",
		"taskId":    "task_test_99",
		"data": map[string]interface{}{
			"name":           "CI Runner Daily",
			"prompt":         "run full test suite and report",
			"cronExpression": "0 12 * * *",
			"isEnabled":      true,
		},
	}
	if err := conn.WriteJSON(reqUpdate); err != nil {
		t.Fatalf("WriteJSON err: %v", err)
	}
	var resUp OutgoingMessage
	_ = conn.ReadJSON(&resUp)

	// 4. trigger_scheduled_task
	reqTrigger := map[string]interface{}{
		"type":      "trigger_scheduled_task",
		"requestId": "req_trig_1",
		"taskId":    "task_test_99",
	}
	if err := conn.WriteJSON(reqTrigger); err != nil {
		t.Fatalf("WriteJSON err: %v", err)
	}
	var resTrig OutgoingMessage
	_ = conn.ReadJSON(&resTrig)

	// 5. cancel_scheduled_task
	reqCancel := map[string]interface{}{
		"type":      "cancel_scheduled_task",
		"requestId": "req_del_1",
		"taskId":    "task_test_99",
	}
	if err := conn.WriteJSON(reqCancel); err != nil {
		t.Fatalf("WriteJSON err: %v", err)
	}
	var resDel OutgoingMessage
	_ = conn.ReadJSON(&resDel)
}

func parseRawJSON(raw []byte) map[string]interface{} {
	var m map[string]interface{}
	_ = json.Unmarshal(raw, &m)
	return m
}
