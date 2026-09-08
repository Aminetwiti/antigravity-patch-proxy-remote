package server_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/antigravity/remote-daemon/pkg/server"
	"github.com/antigravity/remote-daemon/pkg/workspace"
	"github.com/gorilla/websocket"
)

func TestTerminalHandler_InteractiveExecution(t *testing.T) {
	wsMgr := workspace.NewManager()
	tmpDir := t.TempDir()
	ws, err := wsMgr.RegisterWorkspace("ws-term", "TermWS", tmpDir)
	if err != nil {
		t.Fatalf("failed to register workspace: %v", err)
	}

	handler := server.NewTerminalHandler(wsMgr, "term-secret")

	ts := httptest.NewServer(handler)
	defer ts.Close()

	// Convert http:// to ws://
	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "?token=term-secret&workspaceId=" + ws.ID

	dialer := websocket.Dialer{HandshakeTimeout: 5 * time.Second}
	conn, _, err := dialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("failed to connect to terminal websocket: %v", err)
	}
	defer conn.Close()

	// Send echo command
	inputMsg := map[string]string{
		"type": "input",
		"data": "echo antigravity_terminal_online\n",
	}
	if err := conn.WriteJSON(inputMsg); err != nil {
		t.Fatalf("failed to write input message: %v", err)
	}

	// Read outputs until expected string is found
	found := false
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		_ = conn.SetReadDeadline(time.Now().Add(1 * time.Second))
		var msg struct {
			Type string `json:"type"`
			Data string `json:"data"`
		}
		err := conn.ReadJSON(&msg)
		if err != nil {
			break
		}
		if strings.Contains(msg.Data, "antigravity_terminal_online") {
			found = true
			break
		}
	}

	if !found {
		t.Fatalf("did not receive expected terminal output within deadline")
	}

	// Terminate shell cleanly
	_ = conn.WriteJSON(map[string]string{"type": "kill"})
}

func TestTerminalHandler_Unauthorized(t *testing.T) {
	wsMgr := workspace.NewManager()
	handler := server.NewTerminalHandler(wsMgr, "required-secret")

	ts := httptest.NewServer(handler)
	defer ts.Close()

	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "?token=wrong-secret"

	dialer := websocket.Dialer{HandshakeTimeout: 2 * time.Second}
	_, resp, err := dialer.Dial(wsURL, nil)
	if err == nil {
		t.Fatalf("expected dial to fail with 401 Unauthorized")
	}
	if resp != nil && resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected HTTP 401, got %d", resp.StatusCode)
	}
}

func TestTerminalHandler_DisconnectPersistsSubprocess(t *testing.T) {
	wsMgr := workspace.NewManager()
	tmpDir := t.TempDir()
	ws, _ := wsMgr.RegisterWorkspace("ws-persists", "PersistWS", tmpDir)

	handler := server.NewTerminalHandler(wsMgr, "term-secret")
	ts := httptest.NewServer(handler)
	defer ts.Close()

	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "?token=term-secret&workspaceId=" + ws.ID + "&terminalId=term_persist_1"

	dialer := websocket.Dialer{HandshakeTimeout: 5 * time.Second}
	conn1, _, err := dialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("failed to dial conn1: %v", err)
	}

	// Send an echo
	_ = conn1.WriteJSON(map[string]string{
		"type": "input",
		"data": "echo PERSISTENT_SUBPROCESS_ALIVE\n",
	})

	// Wait briefly for echo output
	deadline := time.Now().Add(3 * time.Second)
	found := false
	for time.Now().Before(deadline) {
		_ = conn1.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
		var msg struct {
			Type string `json:"type"`
			Data string `json:"data"`
		}
		if err := conn1.ReadJSON(&msg); err == nil && strings.Contains(msg.Data, "PERSISTENT_SUBPROCESS_ALIVE") {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("did not see initial output on conn1")
	}

	// Disconnect client 1!
	_ = conn1.Close()
	time.Sleep(100 * time.Millisecond)

	// Verify terminal subprocess in manager is STILL RUNNING!
	term, err := handler.Manager().GetOrCreate("term_persist_1", tmpDir, "admin")
	if err != nil {
		t.Fatalf("failed getting session: %v", err)
	}
	if !term.IsRunning() {
		t.Fatalf("HIGH-01 REGRESSION: terminal subprocess was killed upon client disconnect!")
	}

	// Reconnect with client 2 and verify scrollback is received
	conn2, _, err := dialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("failed to dial conn2: %v", err)
	}
	defer conn2.Close()

	_ = conn2.SetReadDeadline(time.Now().Add(3 * time.Second))
	var msg2 struct {
		Type string `json:"type"`
		Data string `json:"data"`
	}
	err = conn2.ReadJSON(&msg2)
	if err != nil {
		t.Fatalf("failed to read from conn2: %v", err)
	}
	if !strings.Contains(msg2.Data, "PERSISTENT_SUBPROCESS_ALIVE") {
		t.Errorf("expected reconnected client to receive scrollback, got: %s", msg2.Data)
	}

	// Kill to cleanup
	_ = conn2.WriteJSON(map[string]string{"type": "kill"})
}
