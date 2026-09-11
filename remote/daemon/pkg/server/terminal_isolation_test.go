package server_test

import (
	"fmt"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/antigravity/remote-daemon/pkg/server"
	"github.com/antigravity/remote-daemon/pkg/workspace"
	"github.com/gorilla/websocket"
)

func TestTerminalIsolation_WorktreePerSession(t *testing.T) {
	wsMgr := workspace.NewManager()
	tmpDir := t.TempDir()

	// Initialize real git repo
	cmd := exec.Command("git", "init")
	cmd.Dir = tmpDir
	if err := cmd.Run(); err != nil {
		t.Skipf("git not available, skipping worktree test: %v", err)
	}
	_ = os.WriteFile(filepath.Join(tmpDir, "README.md"), []byte("# Base"), 0644)
	cmd = exec.Command("git", "add", ".")
	cmd.Dir = tmpDir
	_ = cmd.Run()
	cmd = exec.Command("git", "-c", "user.name=Test", "-c", "user.email=test@test.com", "commit", "-m", "initial")
	cmd.Dir = tmpDir
	_ = cmd.Run()

	ws, err := wsMgr.RegisterWorkspace("ws-term-iso", "TermIsoWS", tmpDir)
	if err != nil {
		t.Fatalf("failed to register workspace: %v", err)
	}

	handler := server.NewTerminalHandler(wsMgr, "term-secret")
	ts := httptest.NewServer(handler)
	defer ts.Close()

	// Session A connects
	wsURL_A := fmt.Sprintf("ws%s?token=term-secret&workspaceId=%s&sessionId=sess-term-A", strings.TrimPrefix(ts.URL, "http"), ws.ID)
	dialer := websocket.Dialer{HandshakeTimeout: 5 * time.Second}
	connA, _, err := dialer.Dial(wsURL_A, nil)
	if err != nil {
		t.Fatalf("failed to connect session A terminal: %v", err)
	}
	defer connA.Close()

	// Session B connects
	wsURL_B := fmt.Sprintf("ws%s?token=term-secret&workspaceId=%s&sessionId=sess-term-B", strings.TrimPrefix(ts.URL, "http"), ws.ID)
	connB, _, err := dialer.Dial(wsURL_B, nil)
	if err != nil {
		t.Fatalf("failed to connect session B terminal: %v", err)
	}
	defer connB.Close()

	// In session A, create marker_A.txt
	_ = connA.WriteJSON(map[string]string{
		"type": "input",
		"data": "echo sessionA_unique_marker > marker_A.txt\n",
	})

	time.Sleep(500 * time.Millisecond)

	// In base repo, marker_A.txt MUST NOT exist!
	baseMarker := filepath.Join(tmpDir, "marker_A.txt")
	if _, err := os.Stat(baseMarker); err == nil {
		t.Fatalf("ISOLATION FAULT: marker_A.txt was created directly in base repository!")
	}

	// Clean up terminals
	_ = connA.WriteJSON(map[string]string{"type": "kill"})
	_ = connB.WriteJSON(map[string]string{"type": "kill"})
}

func TestTerminalIsolation_NoTerminalIDCollision(t *testing.T) {
	wsMgr := workspace.NewManager()
	tmpDir := t.TempDir()
	ws, _ := wsMgr.RegisterWorkspace("ws-term-collision", "CollisionWS", tmpDir)

	handler := server.NewTerminalHandler(wsMgr, "term-secret")
	ts := httptest.NewServer(handler)
	defer ts.Close()

	wsURL := fmt.Sprintf("ws%s?token=term-secret&workspaceId=%s", strings.TrimPrefix(ts.URL, "http"), ws.ID)
	dialer := websocket.Dialer{HandshakeTimeout: 5 * time.Second}
	conn1, _, err := dialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("failed to connect conn1: %v", err)
	}
	defer conn1.Close()

	conn2, _, err := dialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("failed to connect conn2: %v", err)
	}
	defer conn2.Close()

	// Both connections connected without explicit terminalId.
	// If they collided, they'd both be attached to the same PersistentTerminal ("ws_" + ws.ID).
	if _, ok := handler.Manager().Get("ws_" + ws.ID); ok {
		t.Fatalf("ISOLATION FAULT: terminal used shared ws_ fallback key, causing connection collision!")
	}

	_ = conn1.WriteJSON(map[string]string{"type": "kill"})
	_ = conn2.WriteJSON(map[string]string{"type": "kill"})
}

