package server

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/antigravity/remote-daemon/pkg/workspace"
	"github.com/gorilla/websocket"
)

type TerminalHandler struct {
	wsMgr     *workspace.Manager
	authToken string
	upgrader  websocket.Upgrader
}

func NewTerminalHandler(wsMgr *workspace.Manager, authToken string) *TerminalHandler {
	return &TerminalHandler{
		wsMgr:     wsMgr,
		authToken: authToken,
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return true },
		},
	}
}

type TerminalMessage struct {
	Type string `json:"type"` // "input", "output", "kill", "exit", "error"
	Data string `json:"data,omitempty"`
	Code int    `json:"code,omitempty"`
}

func (h *TerminalHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// 1. Auth verification
	if h.authToken != "" && h.authToken != "none" {
		token := r.URL.Query().Get("token")
		if token == "" {
			authHeader := r.Header.Get("Authorization")
			if strings.HasPrefix(authHeader, "Bearer ") {
				token = strings.TrimPrefix(authHeader, "Bearer ")
			}
		}
		if token != h.authToken {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
	}

	// 2. Resolve workspace directory
	workspaceID := r.URL.Query().Get("workspaceId")
	dir := "."
	if workspaceID != "" && h.wsMgr != nil {
		resolved, err := h.wsMgr.ResolvePath(workspaceID, ".")
		if err != nil {
			http.Error(w, "invalid workspace: "+err.Error(), http.StatusBadRequest)
			return
		}
		dir = resolved
	}

	// 3. Upgrade to WebSocket
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[Terminal] upgrade failed: %v", err)
		return
	}
	defer conn.Close()

	// 4. Select shell
	shell := "sh"
	if runtime.GOOS == "windows" {
		shell = "cmd.exe"
	} else if _, err := exec.LookPath("bash"); err == nil {
		shell = "bash"
	}

	cmd := exec.Command(shell)
	cmd.Dir = dir

	stdin, err := cmd.StdinPipe()
	if err != nil {
		_ = conn.WriteJSON(TerminalMessage{Type: "error", Data: err.Error()})
		return
	}
	defer stdin.Close()

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		_ = conn.WriteJSON(TerminalMessage{Type: "error", Data: err.Error()})
		return
	}

	stderr, err := cmd.StderrPipe()
	if err != nil {
		_ = conn.WriteJSON(TerminalMessage{Type: "error", Data: err.Error()})
		return
	}

	if err := cmd.Start(); err != nil {
		_ = conn.WriteJSON(TerminalMessage{Type: "error", Data: "failed to start shell: " + err.Error()})
		return
	}

	var writeMu sync.Mutex
	sendMsg := func(msg TerminalMessage) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		return conn.WriteJSON(msg)
	}

	// 5. Pump stdout and stderr to WebSocket
	readPump := func(r io.Reader) {
		buf := make([]byte, 2048)
		for {
			n, err := r.Read(buf)
			if n > 0 {
				_ = sendMsg(TerminalMessage{
					Type: "output",
					Data: string(buf[:n]),
				})
			}
			if err != nil {
				return
			}
		}
	}

	go readPump(stdout)
	go readPump(stderr)

	// 6. Monitor process exit in background
	doneChan := make(chan struct{})
	go func() {
		err := cmd.Wait()
		exitCode := 0
		if err != nil {
			if exitErr, ok := err.(*exec.ExitError); ok {
				exitCode = exitErr.ExitCode()
			} else {
				exitCode = 1
			}
		}
		_ = sendMsg(TerminalMessage{Type: "exit", Code: exitCode})
		close(doneChan)
	}()

	// 7. Read inputs from WebSocket client
	for {
		conn.SetReadDeadline(time.Now().Add(10 * time.Minute))
		_, message, err := conn.ReadMessage()
		if err != nil {
			_ = cmd.Process.Kill()
			break
		}

		var msg TerminalMessage
		if err := json.Unmarshal(message, &msg); err != nil {
			continue
		}

		switch msg.Type {
		case "input":
			_, _ = io.WriteString(stdin, msg.Data)
		case "kill":
			_ = cmd.Process.Kill()
			return
		}
	}

	<-doneChan
}
