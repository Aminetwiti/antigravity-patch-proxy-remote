package server

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/antigravity/remote-daemon/pkg/agent"
	"github.com/antigravity/remote-daemon/pkg/approval"
	"github.com/antigravity/remote-daemon/pkg/domain"
	"github.com/antigravity/remote-daemon/pkg/eventstore"
	"github.com/antigravity/remote-daemon/pkg/mcp"
	"github.com/antigravity/remote-daemon/pkg/session"
	"github.com/antigravity/remote-daemon/pkg/workspace"
	"github.com/gorilla/websocket"
)

// V1IncomingMessage represents incoming messages from Protocol v1 clients (e.g. Flutter mobile app).
type V1IncomingMessage struct {
	Type          string                 `json:"type"`
	RequestID     string                 `json:"requestId"`
	CascadeID     string                 `json:"cascadeId,omitempty"`
	Prompt        string                 `json:"prompt,omitempty"`
	CallID        string                 `json:"callId,omitempty"`
	Decision      string                 `json:"decision,omitempty"`
	FilePath      string                 `json:"filePath,omitempty"`
	WorkspacePath string                 `json:"workspacePath,omitempty"`
	Content       string                 `json:"content,omitempty"`
	Overwrite     bool                   `json:"overwrite,omitempty"`
	ModelUID      string                 `json:"modelUID,omitempty"`
	Data          map[string]interface{} `json:"data,omitempty"`
}

// V1OutgoingMessage represents messages pushed back to Protocol v1 clients.
type V1OutgoingMessage struct {
	Type      string      `json:"type"`
	RequestID string      `json:"requestId,omitempty"`
	CascadeID string      `json:"cascadeId,omitempty"`
	Data      interface{} `json:"data,omitempty"`
	Error     string      `json:"error,omitempty"`
}

// V1Adapter provides backward compatibility with Protocol v1 clients on /ws.
type V1Adapter struct {
	sessionSvc  *session.Service
	eventStore  eventstore.EventStore
	wsManager   *workspace.Manager
	agentEngine *agent.Engine
	approvalMgr *approval.Manager
	authToken   string
	mcpMgr      *mcp.Manager

	upgrader websocket.Upgrader

	mu          sync.Mutex
	connections map[*websocket.Conn]bool
	writeLocks  map[*websocket.Conn]*sync.Mutex

	// activePrompts tracks running prompts mapped to client requestIDs
	activePrompts map[string]string // sessionID -> requestID
}

func (a *V1Adapter) SetMCPManager(mgr *mcp.Manager) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.mcpMgr = mgr
}

// NewV1Adapter initializes a new Protocol v1 compatibility adapter.
func NewV1Adapter(
	sessionSvc *session.Service,
	eventStore eventstore.EventStore,
	wsMgr *workspace.Manager,
	agentEngine *agent.Engine,
	approvalMgr *approval.Manager,
	authToken string,
) *V1Adapter {
	return &V1Adapter{
		sessionSvc:  sessionSvc,
		eventStore:  eventStore,
		wsManager:   wsMgr,
		agentEngine: agentEngine,
		approvalMgr: approvalMgr,
		authToken:   authToken,
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return true },
		},
		connections:   make(map[*websocket.Conn]bool),
		writeLocks:    make(map[*websocket.Conn]*sync.Mutex),
		activePrompts: make(map[string]string),
	}
}

// HandleWebSocket handles incoming Protocol v1 WebSocket connections on /ws.
func (a *V1Adapter) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	// Authentication check if authToken is configured
	if a.authToken != "" {
		token := r.URL.Query().Get("token")
		if token == "" {
			authHeader := r.Header.Get("Authorization")
			if strings.HasPrefix(authHeader, "Bearer ") {
				token = strings.TrimPrefix(authHeader, "Bearer ")
			}
		}
		if token != a.authToken {
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
			return
		}
	}

	conn, err := a.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[V1Adapter] WebSocket upgrade failed: %v", err)
		return
	}

	a.mu.Lock()
	a.connections[conn] = true
	a.writeLocks[conn] = &sync.Mutex{}
	a.mu.Unlock()

	defer func() {
		a.mu.Lock()
		delete(a.connections, conn)
		delete(a.writeLocks, conn)
		a.mu.Unlock()
		conn.Close()
	}()

	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			break
		}

		var msg V1IncomingMessage
		if err := json.Unmarshal(message, &msg); err != nil {
			a.writeJSON(conn, V1OutgoingMessage{
				Type:  "error",
				Error: "invalid json format",
			})
			continue
		}

		go a.handleAction(conn, msg)
	}
}

func (a *V1Adapter) writeJSON(conn *websocket.Conn, msg V1OutgoingMessage) {
	a.mu.Lock()
	lock, ok := a.writeLocks[conn]
	a.mu.Unlock()
	if !ok {
		return
	}

	lock.Lock()
	defer lock.Unlock()
	_ = conn.WriteJSON(msg)
}

func (a *V1Adapter) broadcast(msg V1OutgoingMessage) {
	a.mu.Lock()
	conns := make([]*websocket.Conn, 0, len(a.connections))
	for c := range a.connections {
		conns = append(conns, c)
	}
	a.mu.Unlock()

	for _, c := range conns {
		a.writeJSON(c, msg)
	}
}

func (a *V1Adapter) handleAction(conn *websocket.Conn, msg V1IncomingMessage) {
	ctx := context.Background()

	switch msg.Type {
	case "ping", "heartbeat":
		a.writeJSON(conn, V1OutgoingMessage{
			Type:      "pong",
			RequestID: msg.RequestID,
		})

	case "list_sessions":
		sessions, err := a.sessionSvc.ListSessions(ctx)
		if err != nil {
			a.writeJSON(conn, V1OutgoingMessage{
				Type:      "error",
				RequestID: msg.RequestID,
				Error:     err.Error(),
			})
			return
		}

		var items []map[string]interface{}
		for _, s := range sessions {
			status := "CASCADE_STATUS_READY"
			switch s.State {
			case domain.SessionStateRunning:
				status = "CASCADE_STATUS_RUNNING"
			case domain.SessionStateWaitingApproval:
				status = "CASCADE_STATUS_WAITING_APPROVAL"
			case domain.SessionStateFailed:
				status = "CASCADE_STATUS_ERROR"
			}

			items = append(items, map[string]interface{}{
				"cascadeId": s.ID,
				"workspace": s.WorkspaceID,
				"status":    status,
				"title":     s.Title,
				"updatedAt": s.UpdatedAt.Format(time.RFC3339),
				"isIde":     false,
				"isRemote":  true,
				"isServer":  true,
			})
		}

		a.writeJSON(conn, V1OutgoingMessage{
			Type:      "response",
			RequestID: msg.RequestID,
			Data: map[string]interface{}{
				"sessions": items,
			},
		})

	case "create_cascade", "new_conversation":
		wsID := "default-workspace"
		if msg.WorkspacePath != "" {
			wsID = msg.WorkspacePath
		}
		newSess, err := a.sessionSvc.CreateSession(ctx, "local-server", wsID, "New Conversation")
		if err != nil {
			a.writeJSON(conn, V1OutgoingMessage{
				Type:      "error",
				RequestID: msg.RequestID,
				Error:     err.Error(),
			})
			return
		}

		a.writeJSON(conn, V1OutgoingMessage{
			Type:      "response",
			RequestID: msg.RequestID,
			Data: map[string]interface{}{
				"cascadeId": newSess.ID,
			},
		})

	case "send_prompt":
		sessID := msg.CascadeID
		if sessID == "" {
			newSess, err := a.sessionSvc.CreateSession(ctx, "local-server", "default-workspace", "New Session")
			if err != nil {
				a.writeJSON(conn, V1OutgoingMessage{
					Type:      "error",
					RequestID: msg.RequestID,
					Error:     err.Error(),
				})
				return
			}
			sessID = newSess.ID
		}

		a.mu.Lock()
		a.activePrompts[sessID] = msg.RequestID
		a.mu.Unlock()

		// Send stream_start acknowledgment immediately
		a.writeJSON(conn, V1OutgoingMessage{
			Type:      "stream_start",
			RequestID: msg.RequestID,
			CascadeID: sessID,
		})

		// Start agent execution turn
		if a.agentEngine != nil {
			go func() {
				if err := a.agentEngine.StartTurn(context.Background(), sessID, msg.Prompt); err != nil {
					a.writeJSON(conn, V1OutgoingMessage{
						Type:      "error",
						RequestID: msg.RequestID,
						CascadeID: sessID,
						Error:     err.Error(),
					})
				}
			}()
		}

	case "submit_approval":
		decision := strings.ToLower(msg.Decision) == "allow"
		if a.approvalMgr != nil {
			err := a.approvalMgr.ResolveApproval(msg.CallID, decision, "mobile-client", "user decision via v1 protocol")
			if err != nil {
				a.writeJSON(conn, V1OutgoingMessage{
					Type:      "error",
					RequestID: msg.RequestID,
					Error:     err.Error(),
				})
				return
			}
		}

		a.writeJSON(conn, V1OutgoingMessage{
			Type:      "response",
			RequestID: msg.RequestID,
			Data: map[string]interface{}{
				"success": true,
			},
		})

	case "cancel_generation", "stop_generation":
		if a.agentEngine != nil && msg.CascadeID != "" {
			_ = a.agentEngine.CancelTurn(context.Background(), msg.CascadeID)
		}
		a.writeJSON(conn, V1OutgoingMessage{
			Type:      "response",
			RequestID: msg.RequestID,
			Data: map[string]interface{}{
				"stopped": true,
			},
		})

	case "read_file", "view_file":
		wsID := "default-workspace"
		if msg.WorkspacePath != "" {
			wsID = msg.WorkspacePath
		}
		filePath := msg.FilePath
		if filePath == "" && msg.Data != nil {
			if p, ok := msg.Data["filePath"].(string); ok {
				filePath = p
			} else if p, ok := msg.Data["path"].(string); ok {
				filePath = p
			}
		}
		content, err := a.wsManager.ReadFile(wsID, filePath)
		if err != nil {
			a.writeJSON(conn, V1OutgoingMessage{
				Type:      "error",
				RequestID: msg.RequestID,
				Error:     err.Error(),
			})
			return
		}

		a.writeJSON(conn, V1OutgoingMessage{
			Type:      "response",
			RequestID: msg.RequestID,
			Data: map[string]interface{}{
				"content": base64.StdEncoding.EncodeToString(content),
			},
		})

	case "write_file":
		wsID := "default-workspace"
		if msg.WorkspacePath != "" {
			wsID = msg.WorkspacePath
		}
		filePath := msg.FilePath
		if filePath == "" && msg.Data != nil {
			if p, ok := msg.Data["filePath"].(string); ok {
				filePath = p
			} else if p, ok := msg.Data["path"].(string); ok {
				filePath = p
			}
		}
		rawContent := msg.Content
		if rawContent == "" && msg.Data != nil {
			if c, ok := msg.Data["content"].(string); ok {
				rawContent = c
			}
		}
		decoded, err := base64.StdEncoding.DecodeString(rawContent)
		if err != nil {
			decoded = []byte(rawContent)
		}
		err = a.wsManager.WriteFile(wsID, filePath, decoded)
		if err != nil {
			a.writeJSON(conn, V1OutgoingMessage{
				Type:      "error",
				RequestID: msg.RequestID,
				Error:     err.Error(),
			})
			return
		}

		a.writeJSON(conn, V1OutgoingMessage{
			Type:      "response",
			RequestID: msg.RequestID,
			Data: map[string]interface{}{
				"success": true,
			},
		})

	case "list_workspaces":
		list := a.wsManager.ListWorkspaces()
		a.writeJSON(conn, V1OutgoingMessage{
			Type:      "response",
			RequestID: msg.RequestID,
			Data: map[string]interface{}{
				"workspaces": list,
			},
		})

	case "list_files", "list_dir":
		wsID := "default-workspace"
		if msg.WorkspacePath != "" {
			wsID = msg.WorkspacePath
		}
		path, _ := msg.Data["path"].(string)
		files, err := a.wsManager.ListDirectory(wsID, path, 6)
		if err != nil {
			a.writeJSON(conn, V1OutgoingMessage{
				Type:      "error",
				RequestID: msg.RequestID,
				Error:     err.Error(),
			})
			return
		}
		a.writeJSON(conn, V1OutgoingMessage{
			Type:      "response",
			RequestID: msg.RequestID,
			Data: map[string]interface{}{
				"files": files,
			},
		})

	case "search_files":
		wsID := "default-workspace"
		if msg.WorkspacePath != "" {
			wsID = msg.WorkspacePath
		}
		query, _ := msg.Data["query"].(string)
		res, err := a.wsManager.SearchFiles(wsID, query, 50)
		if err != nil {
			a.writeJSON(conn, V1OutgoingMessage{
				Type:      "error",
				RequestID: msg.RequestID,
				Error:     err.Error(),
			})
			return
		}
		a.writeJSON(conn, V1OutgoingMessage{
			Type:      "response",
			RequestID: msg.RequestID,
			Data: map[string]interface{}{
				"results": res,
			},
		})

	case "list_mcp_servers":
		var servers []interface{}
		if a.mcpMgr != nil {
			for _, s := range a.mcpMgr.ListServers() {
				servers = append(servers, map[string]interface{}{
					"name":        s.Name,
					"status":      s.Status,
					"toolCount":   s.ToolCount,
					"tools":       s.Tools,
					"description": s.Description,
					"sidecarId":   s.Name,
				})
			}
		}
		a.writeJSON(conn, V1OutgoingMessage{
			Type:      "response",
			RequestID: msg.RequestID,
			Data: map[string]interface{}{
				"servers": servers,
			},
		})

	case "connect_mcp_server":
		serverName, _ := msg.Data["serverName"].(string)
		if serverName == "" {
			serverName = msg.Prompt
		}
		status := "ready"
		if a.mcpMgr != nil {
			if s, ok := a.mcpMgr.GetServer(serverName); ok {
				status = s.Status
			}
		}
		a.writeJSON(conn, V1OutgoingMessage{
			Type:      "response",
			RequestID: msg.RequestID,
			Data: map[string]interface{}{
				"serverName": serverName,
				"status":     status,
				"connected":  true,
			},
		})

	case "call_mcp_tool":
		serverName, _ := msg.Data["serverName"].(string)
		toolName, _ := msg.Data["toolName"].(string)
		args, _ := msg.Data["arguments"].(map[string]interface{})
		if a.mcpMgr == nil {
			a.writeJSON(conn, V1OutgoingMessage{
				Type:      "error",
				RequestID: msg.RequestID,
				Error:     "mcp manager not initialized",
			})
			return
		}
		out, err := a.mcpMgr.CallServerTool(ctx, serverName, toolName, args)
		if err != nil {
			a.writeJSON(conn, V1OutgoingMessage{
				Type:      "error",
				RequestID: msg.RequestID,
				Error:     err.Error(),
			})
			return
		}
		a.writeJSON(conn, V1OutgoingMessage{
			Type:      "response",
			RequestID: msg.RequestID,
			Data: map[string]interface{}{
				"success": true,
				"output":  out,
			},
		})

	case "git_diff", "get_git_diff":
		wsID := "default-workspace"
		if msg.WorkspacePath != "" {
			wsID = msg.WorkspacePath
		}
		diff, err := a.wsManager.Diff(wsID)
		if err != nil {
			a.writeJSON(conn, V1OutgoingMessage{
				Type:      "error",
				RequestID: msg.RequestID,
				Error:     err.Error(),
			})
			return
		}
		a.writeJSON(conn, V1OutgoingMessage{
			Type:      "response",
			RequestID: msg.RequestID,
			Data:      diff,
		})

	case "git_commit":
		wsID := "default-workspace"
		if msg.WorkspacePath != "" {
			wsID = msg.WorkspacePath
		}
		commitMsg, _ := msg.Data["message"].(string)
		author, _ := msg.Data["author"].(string)
		res, err := a.wsManager.Commit(wsID, commitMsg, author)
		if err != nil {
			a.writeJSON(conn, V1OutgoingMessage{
				Type:      "error",
				RequestID: msg.RequestID,
				Error:     err.Error(),
			})
			return
		}
		a.writeJSON(conn, V1OutgoingMessage{
			Type:      "response",
			RequestID: msg.RequestID,
			Data:      res,
		})

	default:
		a.writeJSON(conn, V1OutgoingMessage{
			Type:      "response",
			RequestID: msg.RequestID,
			Data: map[string]interface{}{
				"status": "ok",
			},
		})
	}
}

// OnDomainEvent is invoked whenever a new event is emitted by SessionService/AgentEngine.
// It maps Protocol v2 Domain Events to Protocol v1 stream deltas and notifications.
func (a *V1Adapter) OnDomainEvent(evt domain.Event) {
	a.mu.Lock()
	reqID := a.activePrompts[evt.SessionID]
	a.mu.Unlock()

	var payload map[string]interface{}
	if len(evt.Payload) > 0 {
		_ = json.Unmarshal(evt.Payload, &payload)
	}

	switch evt.Type {
	case "agent.thought_chunk":
		text, _ := payload["chunk"].(string)
		if text != "" {
			a.broadcast(V1OutgoingMessage{
				Type:      "stream_delta",
				RequestID: reqID,
				CascadeID: evt.SessionID,
				Data: map[string]interface{}{
					"events": []map[string]interface{}{
						{
							"type": "thought",
							"text": text,
						},
					},
				},
			})
		}

	case "tool.call":
		toolName, _ := payload["tool"].(string)
		callID, _ := payload["call_id"].(string)
		args := payload["args"]
		a.broadcast(V1OutgoingMessage{
			Type:      "stream_delta",
			RequestID: reqID,
			CascadeID: evt.SessionID,
			Data: map[string]interface{}{
				"events": []map[string]interface{}{
					{
						"type":   "tool_call",
						"name":   toolName,
						"callId": callID,
						"args":   args,
					},
				},
			},
		})

	case "tool.output":
		callID, _ := payload["call_id"].(string)
		chunk, _ := payload["chunk"].(string)
		a.broadcast(V1OutgoingMessage{
			Type:      "stream_delta",
			RequestID: reqID,
			CascadeID: evt.SessionID,
			Data: map[string]interface{}{
				"events": []map[string]interface{}{
					{
						"type":   "tool_output",
						"callId": callID,
						"chunk":  chunk,
					},
				},
			},
		})

	case "tool.result":
		callID, _ := payload["call_id"].(string)
		output, _ := payload["output"].(string)
		a.broadcast(V1OutgoingMessage{
			Type:      "stream_delta",
			RequestID: reqID,
			CascadeID: evt.SessionID,
			Data: map[string]interface{}{
				"events": []map[string]interface{}{
					{
						"type":   "tool_result",
						"callId": callID,
						"output": output,
					},
				},
			},
		})

	case "approval.requested":
		callID, _ := payload["approval_id"].(string)
		toolName, _ := payload["tool"].(string)
		args := payload["args"]
		a.broadcast(V1OutgoingMessage{
			Type:      "approval_pending",
			CascadeID: evt.SessionID,
			Data: map[string]interface{}{
				"callId":    callID,
				"cascadeId": evt.SessionID,
				"type":      toolName,
				"command":   fmt.Sprintf("%v", args),
				"detail":    fmt.Sprintf("Approval requested for %s", toolName),
			},
		})

	case "agent.completed", "session.closed":
		a.broadcast(V1OutgoingMessage{
			Type:      "stream_end",
			RequestID: reqID,
			CascadeID: evt.SessionID,
		})
		a.mu.Lock()
		delete(a.activePrompts, evt.SessionID)
		a.mu.Unlock()
	}
}
