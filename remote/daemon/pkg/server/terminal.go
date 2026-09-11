package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/antigravity/remote-daemon/pkg/auth"
	"github.com/antigravity/remote-daemon/pkg/workspace"
	"github.com/gorilla/websocket"
)

const (
	maxScrollbackBytes     = 1024 * 1024 // 1MB scrollback ceiling
	maxConcurrentTerminals = 32          // Concurrency limit preventing terminal resource exhaustion
)

type TerminalMessage struct {
	Type string `json:"type"` // "input", "output", "kill", "exit", "error"
	Data string `json:"data,omitempty"`
	Code int    `json:"code,omitempty"`
}

// PersistentTerminal represents a long-running subprocess decoupled from individual WebSocket connections.
type PersistentTerminal struct {
	ID         string
	OwnerID    string
	Dir        string
	cmd        *exec.Cmd
	stdin      io.WriteCloser
	mu         sync.RWMutex
	scrollback []byte
	listeners  map[*websocket.Conn]chan TerminalMessage
	exited     bool
	exitCode   int
	doneChan   chan struct{}
}

func newPersistentTerminal(id, dir, ownerID string) (*PersistentTerminal, error) {
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
		return nil, fmt.Errorf("failed opening stdin pipe: %w", err)
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		_ = stdin.Close()
		return nil, fmt.Errorf("failed opening stdout pipe: %w", err)
	}

	stderr, err := cmd.StderrPipe()
	if err != nil {
		_ = stdin.Close()
		_ = stdout.Close()
		return nil, fmt.Errorf("failed opening stderr pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		_ = stdin.Close()
		_ = stdout.Close()
		_ = stderr.Close()
		return nil, fmt.Errorf("failed starting shell process: %w", err)
	}

	term := &PersistentTerminal{
		ID:         id,
		OwnerID:    ownerID,
		Dir:        dir,
		cmd:        cmd,
		stdin:      stdin,
		scrollback: make([]byte, 0, 8192),
		listeners:  make(map[*websocket.Conn]chan TerminalMessage),
		doneChan:   make(chan struct{}),
	}

	go term.readPump(stdout)
	go term.readPump(stderr)
	go term.waitLoop()

	return term, nil
}

func (t *PersistentTerminal) appendOutput(chunk []byte) {
	t.mu.Lock()
	defer t.mu.Unlock()

	t.scrollback = append(t.scrollback, chunk...)
	if len(t.scrollback) > maxScrollbackBytes {
		// Drop oldest bytes beyond maxScrollbackBytes
		overflow := len(t.scrollback) - maxScrollbackBytes
		t.scrollback = t.scrollback[overflow:]
	}

	msg := TerminalMessage{
		Type: "output",
		Data: string(chunk),
	}

	for _, ch := range t.listeners {
		select {
		case ch <- msg:
		default:
			// Non-blocking drop if consumer is stalled
		}
	}
}

func (t *PersistentTerminal) readPump(r io.Reader) {
	buf := make([]byte, 2048)
	for {
		n, err := r.Read(buf)
		if n > 0 {
			t.appendOutput(buf[:n])
		}
		if err != nil {
			return
		}
	}
}

func (t *PersistentTerminal) waitLoop() {
	err := t.cmd.Wait()
	exitCode := 0
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		} else {
			exitCode = 1
		}
	}

	t.mu.Lock()
	t.exited = true
	t.exitCode = exitCode
	msg := TerminalMessage{Type: "exit", Code: exitCode}
	for _, ch := range t.listeners {
		select {
		case ch <- msg:
		default:
		}
	}
	t.mu.Unlock()

	close(t.doneChan)
}

func (t *PersistentTerminal) Attach(conn *websocket.Conn) (chan TerminalMessage, []byte, bool, int) {
	t.mu.Lock()
	defer t.mu.Unlock()

	ch := make(chan TerminalMessage, 128)
	t.listeners[conn] = ch

	scrollCopy := make([]byte, len(t.scrollback))
	copy(scrollCopy, t.scrollback)

	return ch, scrollCopy, t.exited, t.exitCode
}

func (t *PersistentTerminal) Detach(conn *websocket.Conn) {
	t.mu.Lock()
	defer t.mu.Unlock()

	if ch, ok := t.listeners[conn]; ok {
		delete(t.listeners, conn)
		close(ch)
	}
}

func (t *PersistentTerminal) WriteInput(data string) error {
	t.mu.RLock()
	defer t.mu.RUnlock()
	if t.exited {
		return fmt.Errorf("terminal process has exited")
	}
	_, err := io.WriteString(t.stdin, data)
	return err
}

func (t *PersistentTerminal) Kill() error {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.exited {
		return nil
	}
	if t.cmd.Process != nil {
		return t.cmd.Process.Kill()
	}
	return nil
}

func (t *PersistentTerminal) IsRunning() bool {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return !t.exited
}

// TerminalManager tracks persistent terminal sessions across client disconnects and reconnects.
type TerminalManager struct {
	mu       sync.RWMutex
	sessions map[string]*PersistentTerminal
}

func NewTerminalManager() *TerminalManager {
	return &TerminalManager{
		sessions: make(map[string]*PersistentTerminal),
	}
}

func (m *TerminalManager) Get(termID string) (*PersistentTerminal, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	t, ok := m.sessions[termID]
	return t, ok
}

func (m *TerminalManager) GetOrCreate(termID, dir, ownerID string) (*PersistentTerminal, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if existing, ok := m.sessions[termID]; ok && existing.IsRunning() {
		return existing, nil
	}

	if len(m.sessions) >= maxConcurrentTerminals {
		return nil, errors.New("maximum concurrent terminal limit reached (32)")
	}

	term, err := newPersistentTerminal(termID, dir, ownerID)
	if err != nil {
		return nil, err
	}
	m.sessions[termID] = term
	return term, nil
}

func (m *TerminalManager) Remove(termID string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if term, ok := m.sessions[termID]; ok {
		_ = term.Kill()
		delete(m.sessions, termID)
	}
}

type TerminalHandler struct {
	wsMgr     *workspace.Manager
	authToken string
	rbacMgr   *auth.RBACManager
	mgr       *TerminalManager
	upgrader  websocket.Upgrader
}

func NewTerminalHandler(wsMgr *workspace.Manager, authToken string) *TerminalHandler {
	return &TerminalHandler{
		wsMgr:     wsMgr,
		authToken: authToken,
		rbacMgr:   auth.NewRBACManager(authToken),
		mgr:       NewTerminalManager(),
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return true },
		},
	}
}

func (h *TerminalHandler) SetRBACManager(m *auth.RBACManager) {
	if m != nil {
		h.rbacMgr = m
	}
}

func (h *TerminalHandler) Manager() *TerminalManager {
	return h.mgr
}

func (h *TerminalHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// 1. Auth verification
	token := r.URL.Query().Get("token")
	if token == "" {
		authHeader := r.Header.Get("Authorization")
		if strings.HasPrefix(authHeader, "Bearer ") {
			token = strings.TrimPrefix(authHeader, "Bearer ")
		}
	}
	ident, err := h.rbacMgr.Authenticate(token)
	if err != nil {
		http.Error(w, "unauthorized: "+err.Error(), http.StatusUnauthorized)
		return
	}

	// 2. Resolve workspace directory
	workspaceID := r.URL.Query().Get("workspaceId")
	sessionID := r.URL.Query().Get("sessionId")
	dir := "."
	if workspaceID != "" && h.wsMgr != nil {
		targetWsID := workspaceID
		if sessionID != "" {
			if sw, err := h.wsMgr.EnsureSessionWorktree(workspaceID, sessionID); err == nil && sw != nil {
				targetWsID = sw.ID
			}
		}
		resolved, err := h.wsMgr.ResolvePath(targetWsID, ".")
		if err != nil {
			http.Error(w, "invalid workspace: "+err.Error(), http.StatusBadRequest)
			return
		}
		dir = resolved
	}

	termID := r.URL.Query().Get("terminalId")
	if termID == "" {
		if sessionID != "" {
			termID = "sess_" + sessionID
		} else {
			termID = fmt.Sprintf("term_%d_%s", time.Now().UnixNano(), ident.UserID)
		}
	}

	// 3. Ownership / Takeover check & creation permission
	if existing, ok := h.mgr.Get(termID); ok && existing.IsRunning() {
		// Terminal already exists: deny access if owned by a different user and caller is not admin
		if ident.Role != auth.RoleAdmin && existing.OwnerID != "" && existing.OwnerID != ident.UserID {
			http.Error(w, "forbidden: cannot access terminal owned by another user", http.StatusForbidden)
			return
		}
	} else {
		// Terminal does not exist: read-only users cannot create terminal subprocesses
		if ident.Role == auth.RoleReadOnly {
			http.Error(w, "forbidden: read-only user cannot create terminal session", http.StatusForbidden)
			return
		}
	}

	// 4. Upgrade to WebSocket
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[Terminal] upgrade failed: %v", err)
		return
	}
	defer conn.Close()

	// 5. Get or create persistent terminal session
	term, err := h.mgr.GetOrCreate(termID, dir, ident.UserID)
	if err != nil {
		_ = conn.WriteJSON(TerminalMessage{Type: "error", Data: "failed to start terminal: " + err.Error()})
		return
	}

	// 6. Attach WebSocket listener (detaches cleanly on disconnect without killing process)
	ch, scrollback, exited, exitCode := term.Attach(conn)
	defer term.Detach(conn)

	var writeMu sync.Mutex
	sendMsg := func(msg TerminalMessage) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		return conn.WriteJSON(msg)
	}

	// Replay scrollback backlog to newly attached client
	if len(scrollback) > 0 {
		_ = sendMsg(TerminalMessage{
			Type: "output",
			Data: string(scrollback),
		})
	}
	if exited {
		_ = sendMsg(TerminalMessage{
			Type: "exit",
			Code: exitCode,
		})
		return
	}

	// Background worker forwarding terminal outputs to this specific WebSocket
	stopForwarding := make(chan struct{})
	defer close(stopForwarding)
	go func() {
		for {
			select {
			case <-stopForwarding:
				return
			case msg, ok := <-ch:
				if !ok {
					return
				}
				if err := sendMsg(msg); err != nil {
					return
				}
			}
		}
	}()

	// 7. Read inputs from WebSocket client.
	// On connection drop/error: EXIT LOOP AND DETACH WITHOUT KILLING SUBPROCESS!
	for {
		conn.SetReadDeadline(time.Now().Add(10 * time.Minute))
		_, message, err := conn.ReadMessage()
		if err != nil {
			// Clean detach on client disconnection — DO NOT KILL SUBPROCESS (HIGH-01 Remediation)
			break
		}

		var msg TerminalMessage
		if err := json.Unmarshal(message, &msg); err != nil {
			continue
		}

		switch msg.Type {
		case "input", "stdin":
			if ident.Role == auth.RoleReadOnly {
				_ = sendMsg(TerminalMessage{Type: "error", Data: "forbidden: read-only user cannot send input"})
				continue
			}
			_ = term.WriteInput(msg.Data)
		case "kill":
			if ident.Role != auth.RoleAdmin && term.OwnerID != "" && term.OwnerID != ident.UserID {
				_ = sendMsg(TerminalMessage{Type: "error", Data: "forbidden: cannot kill terminal owned by another user"})
				continue
			}
			_ = term.Kill()
			h.mgr.Remove(termID)
			return
		}
	}
}

// ExecRequest represents the JSON body for POST /v2/terminal/exec.
type ExecRequest struct {
	Command     string `json:"command"`
	TimeoutMs   int    `json:"timeout_ms,omitempty"`
	WorkspaceID string `json:"workspaceId,omitempty"`
	SessionID   string `json:"sessionId,omitempty"`
}

// ExecResponse represents the JSON output for POST /v2/terminal/exec.
type ExecResponse struct {
	OK       bool   `json:"ok"`
	Stdout   string `json:"stdout"`
	Stderr   string `json:"stderr"`
	ExitCode int    `json:"exitCode"`
	Error    string `json:"error,omitempty"`
}

// HandleExec executes a one-shot command synchronously on the host or workspace directory.
func (h *TerminalHandler) HandleExec(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		_ = json.NewEncoder(w).Encode(ExecResponse{OK: false, Error: "method not allowed", ExitCode: 405})
		return
	}

	// 1. Auth verification
	token := r.URL.Query().Get("token")
	if token == "" {
		authHeader := r.Header.Get("Authorization")
		if strings.HasPrefix(authHeader, "Bearer ") {
			token = strings.TrimPrefix(authHeader, "Bearer ")
		}
	}
	ident, err := h.rbacMgr.Authenticate(token)
	if err != nil {
		w.WriteHeader(http.StatusUnauthorized)
		_ = json.NewEncoder(w).Encode(ExecResponse{OK: false, Error: "unauthorized: " + err.Error(), ExitCode: 401})
		return
	}

	if ident.Role == auth.RoleReadOnly {
		w.WriteHeader(http.StatusForbidden)
		_ = json.NewEncoder(w).Encode(ExecResponse{OK: false, Error: "forbidden: read-only user cannot execute commands", ExitCode: 403})
		return
	}

	// 2. Decode payload
	var req ExecRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(ExecResponse{OK: false, Error: "invalid request body: " + err.Error(), ExitCode: 400})
		return
	}

	cmdStr := strings.TrimSpace(req.Command)
	if cmdStr == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(ExecResponse{OK: false, Error: "command cannot be empty", ExitCode: 400})
		return
	}

	// 3. Resolve directory
	dir := "."
	if req.WorkspaceID != "" && h.wsMgr != nil {
		targetWsID := req.WorkspaceID
		if req.SessionID != "" {
			if sw, err := h.wsMgr.EnsureSessionWorktree(req.WorkspaceID, req.SessionID); err == nil && sw != nil {
				targetWsID = sw.ID
			}
		}
		resolved, err := h.wsMgr.ResolvePath(targetWsID, ".")
		if err == nil {
			dir = resolved
		}
	}

	// 4. Execution timeout
	timeout := 15 * time.Second
	if req.TimeoutMs > 0 {
		timeout = time.Duration(req.TimeoutMs) * time.Millisecond
		if timeout > 10*time.Minute {
			timeout = 10 * time.Minute
		}
	}

	ctx, cancel := context.WithTimeout(r.Context(), timeout)
	defer cancel()

	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.CommandContext(ctx, "cmd.exe", "/C", cmdStr)
	} else if _, err := exec.LookPath("bash"); err == nil {
		cmd = exec.CommandContext(ctx, "bash", "-c", cmdStr)
	} else {
		cmd = exec.CommandContext(ctx, "sh", "-c", cmdStr)
	}
	cmd.Dir = dir

	var stdoutBuf, stderrBuf strings.Builder
	cmd.Stdout = &stdoutBuf
	cmd.Stderr = &stderrBuf

	runErr := cmd.Run()
	exitCode := 0
	if runErr != nil {
		if exitErr, ok := runErr.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		} else {
			exitCode = 1
		}
	}

	resp := ExecResponse{
		OK:       runErr == nil,
		Stdout:   stdoutBuf.String(),
		Stderr:   stderrBuf.String(),
		ExitCode: exitCode,
	}
	if runErr != nil {
		resp.Error = runErr.Error()
	}

	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(resp)
}
