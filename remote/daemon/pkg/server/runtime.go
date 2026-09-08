package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sync"

	"github.com/antigravity/remote-daemon/pkg/agent"
	"github.com/antigravity/remote-daemon/pkg/approval"
	"github.com/antigravity/remote-daemon/pkg/domain"
	"github.com/antigravity/remote-daemon/pkg/eventstore"
	"github.com/antigravity/remote-daemon/pkg/mcp"
	"github.com/antigravity/remote-daemon/pkg/memory"
	"github.com/antigravity/remote-daemon/pkg/notification"
	"github.com/antigravity/remote-daemon/pkg/protocol"
	"github.com/antigravity/remote-daemon/pkg/session"
	"github.com/gorilla/websocket"
)

var (
	ErrClientAlreadyAttached = errors.New("client already attached to session")
	ErrSessionNotAttached    = errors.New("client is not attached to this session")
	ErrSessionNotFound       = errors.New("session not found")
)

type AttachedClient struct {
	Conn         *websocket.Conn
	DeviceID     string
	LastAckedSeq int64
	CatchupDone  bool
	pendingQueue []domain.Event
	writeMu      sync.Mutex
}

func (c *AttachedClient) SendJSON(v interface{}) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	return c.Conn.WriteJSON(v)
}

type RuntimeServer struct {
	serverInfo domain.Server
	store      eventstore.EventStore
	sessionSvc *session.Service

	agentEng  *agent.Engine
	apprMgr   *approval.Manager
	v1Adapter *V1Adapter
	scheduler *Scheduler
	webhookDispatcher *notification.WebhookDispatcher
	checkpointMgr     *session.CheckpointManager
	memStore          *memory.MemoryStore
	mcpMgr            *mcp.Manager

	mu              sync.RWMutex
	attachedClients map[string]map[*websocket.Conn]*AttachedClient
	clientSessions  map[*websocket.Conn]string

	upgrader websocket.Upgrader
}

func NewRuntimeServer(serverInfo domain.Server, store eventstore.EventStore) *RuntimeServer {
	rt := &RuntimeServer{
		serverInfo:      serverInfo,
		store:           store,
		attachedClients: make(map[string]map[*websocket.Conn]*AttachedClient),
		clientSessions:  make(map[*websocket.Conn]string),
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return true },
		},
	}

	rt.sessionSvc = session.NewService(store, rt)
	return rt
}

func (r *RuntimeServer) SessionService() *session.Service {
	return r.sessionSvc
}

func (r *RuntimeServer) ServerInfo() domain.Server {
	return r.serverInfo
}

func (r *RuntimeServer) SetAgentEngine(eng *agent.Engine, apprMgr *approval.Manager) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.agentEng = eng
	r.apprMgr = apprMgr
}

func (r *RuntimeServer) AgentEngine() *agent.Engine {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.agentEng
}

func (r *RuntimeServer) ApprovalManager() *approval.Manager {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.apprMgr
}

func (r *RuntimeServer) SetV1Adapter(adapter *V1Adapter) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.v1Adapter = adapter
}

func (r *RuntimeServer) V1Adapter() *V1Adapter {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.v1Adapter
}

func (r *RuntimeServer) SetScheduler(sched *Scheduler) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.scheduler = sched
}

func (r *RuntimeServer) Scheduler() *Scheduler {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.scheduler
}

func (r *RuntimeServer) SetWebhookDispatcher(d *notification.WebhookDispatcher) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.webhookDispatcher = d
}

func (r *RuntimeServer) WebhookDispatcher() *notification.WebhookDispatcher {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.webhookDispatcher
}

func (r *RuntimeServer) SetCheckpointManager(m *session.CheckpointManager) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.checkpointMgr = m
}

func (r *RuntimeServer) CheckpointManager() *session.CheckpointManager {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.checkpointMgr
}

func (r *RuntimeServer) SetMemoryStore(m *memory.MemoryStore) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.memStore = m
}

func (r *RuntimeServer) MemoryStore() *memory.MemoryStore {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.memStore
}

func (r *RuntimeServer) SetMCPManager(m *mcp.Manager) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.mcpMgr = m
}

func (r *RuntimeServer) MCPManager() *mcp.Manager {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.mcpMgr
}

// BroadcastEvent broadcasts to all clients attached to event.SessionID.
// If a client is still in catchup mode, it stages the event in client.pendingQueue
// so that catchup and live events never race, guaranteeing zero lost and zero duplicate events.
func (r *RuntimeServer) BroadcastEvent(event *domain.Event) {
	// Fan out to Protocol v1 adapter if active
	r.mu.RLock()
	adapter := r.v1Adapter
	dispatcher := r.webhookDispatcher
	r.mu.RUnlock()
	if adapter != nil {
		adapter.OnDomainEvent(*event)
	}
	if dispatcher != nil {
		dispatcher.OnDomainEvent(*event)
	}

	r.mu.Lock()
	clients, ok := r.attachedClients[event.SessionID]
	if !ok || len(clients) == 0 {
		r.mu.Unlock()
		return
	}

	for _, client := range clients {
		client.writeMu.Lock()
		if !client.CatchupDone {
			client.pendingQueue = append(client.pendingQueue, *event)
			client.writeMu.Unlock()
			continue
		}
		client.writeMu.Unlock()

		msg := protocol.LiveEventMessage{
			Version:   protocol.ProtocolVersion,
			Type:      protocol.TypeSessionEvent,
			SessionID: event.SessionID,
			Event:     *event,
		}
		_ = client.SendJSON(msg)
	}
	r.mu.Unlock()
}

func (r *RuntimeServer) BroadcastSessionUpdate(s *domain.Session) {
	// Optional session metadata update notification
}

func (r *RuntimeServer) AttachClient(conn *websocket.Conn, deviceID, sessionID string, lastSeq int64) error {
	r.mu.Lock()
	clients, ok := r.attachedClients[sessionID]
	if !ok {
		clients = make(map[*websocket.Conn]*AttachedClient)
		r.attachedClients[sessionID] = clients
	}

	client := &AttachedClient{
		Conn:         conn,
		DeviceID:     deviceID,
		LastAckedSeq: lastSeq,
		CatchupDone:  false,
		pendingQueue: make([]domain.Event, 0),
	}
	clients[conn] = client
	r.clientSessions[conn] = sessionID
	r.mu.Unlock()

	ctx := context.Background()
	missed, err := r.store.GetEventsSince(ctx, sessionID, lastSeq, 2000)
	if err != nil {
		return fmt.Errorf("failed to fetch catchup events: %w", err)
	}

	var toSeq int64 = lastSeq
	if len(missed) > 0 {
		toSeq = missed[len(missed)-1].Sequence
	}

	catchupMsg := protocol.CatchupResponse{
		Version:      protocol.ProtocolVersion,
		Type:         protocol.TypeSessionCatchup,
		SessionID:    sessionID,
		FromSequence: lastSeq + 1,
		ToSequence:   toSeq,
		Events:       missed,
	}

	if err := client.SendJSON(catchupMsg); err != nil {
		return err
	}

	// Drain any events that arrived in pendingQueue during the DB fetch
	client.writeMu.Lock()
	client.CatchupDone = true
	var pendingToSend []domain.Event
	for _, pEvt := range client.pendingQueue {
		if pEvt.Sequence > toSeq {
			pendingToSend = append(pendingToSend, pEvt)
		}
	}
	client.pendingQueue = nil
	client.writeMu.Unlock()

	for _, pEvt := range pendingToSend {
		msg := protocol.LiveEventMessage{
			Version:   protocol.ProtocolVersion,
			Type:      protocol.TypeSessionEvent,
			SessionID: sessionID,
			Event:     pEvt,
		}
		_ = client.SendJSON(msg)
	}

	return nil
}

func (r *RuntimeServer) DetachClient(conn *websocket.Conn) {
	r.mu.Lock()
	defer r.mu.Unlock()

	sessionID, ok := r.clientSessions[conn]
	if !ok {
		return
	}

	delete(r.clientSessions, conn)
	if clients, exists := r.attachedClients[sessionID]; exists {
		delete(clients, conn)
		if len(clients) == 0 {
			delete(r.attachedClients, sessionID)
		}
	}
}

func (r *RuntimeServer) AttachedCount(sessionID string) int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.attachedClients[sessionID])
}

func (r *RuntimeServer) HandleClientMessage(conn *websocket.Conn, msgBytes []byte) error {
	var env protocol.V2Envelope
	if err := json.Unmarshal(msgBytes, &env); err != nil {
		return err
	}

	ctx := context.Background()

	switch env.Type {
	case protocol.TypeSessionAttach:
		return r.AttachClient(conn, "client-device", env.SessionID, env.LastSequence)

	case protocol.TypeSessionCatchupAck:
		r.mu.Lock()
		if sessID, ok := r.clientSessions[conn]; ok {
			if clients, ok2 := r.attachedClients[sessID]; ok2 {
				if client, ok3 := clients[conn]; ok3 {
					client.LastAckedSeq = env.LastSequence
				}
			}
		}
		r.mu.Unlock()
		return nil

	case protocol.TypeSessionCreate:
		type createPayload struct {
			Title       string `json:"title"`
			WorkspaceID string `json:"workspaceId"`
		}
		var cp createPayload
		if len(env.Payload) > 0 {
			_ = json.Unmarshal(env.Payload, &cp)
		}
		sess, err := r.sessionSvc.CreateSession(ctx, r.serverInfo.ID, cp.WorkspaceID, cp.Title)
		if err != nil {
			return r.sendError(conn, env.RequestID, err.Error())
		}
		data, _ := json.Marshal(sess)
		return r.sendAck(conn, env.RequestID, sess.ID, data)

	case protocol.TypeSessionPause:
		if err := r.sessionSvc.CheckAndRegisterCommand(env.RequestID, env.SessionID, env.Payload); err != nil {
			if err == session.ErrCommandDuplicate {
				return r.sendAck(conn, env.RequestID, env.SessionID, nil)
			}
			return r.sendError(conn, env.RequestID, err.Error())
		}
		if err := r.sessionSvc.TransitionState(ctx, env.SessionID, domain.SessionStatePaused, "User requested pause"); err != nil {
			return r.sendError(conn, env.RequestID, err.Error())
		}
		return r.sendAck(conn, env.RequestID, env.SessionID, nil)

	case protocol.TypeSessionResume:
		if err := r.sessionSvc.CheckAndRegisterCommand(env.RequestID, env.SessionID, env.Payload); err != nil {
			if err == session.ErrCommandDuplicate {
				return r.sendAck(conn, env.RequestID, env.SessionID, nil)
			}
			return r.sendError(conn, env.RequestID, err.Error())
		}
		if err := r.sessionSvc.TransitionState(ctx, env.SessionID, domain.SessionStateRunning, "User requested resume"); err != nil {
			return r.sendError(conn, env.RequestID, err.Error())
		}
		return r.sendAck(conn, env.RequestID, env.SessionID, nil)

	case protocol.TypeSessionCancel:
		if err := r.sessionSvc.CheckAndRegisterCommand(env.RequestID, env.SessionID, env.Payload); err != nil {
			if err == session.ErrCommandDuplicate {
				return r.sendAck(conn, env.RequestID, env.SessionID, nil)
			}
			return r.sendError(conn, env.RequestID, err.Error())
		}
		if r.agentEng != nil {
			_ = r.agentEng.CancelTurn(ctx, env.SessionID)
		} else {
			if err := r.sessionSvc.TransitionState(ctx, env.SessionID, domain.SessionStateCancelled, "User requested cancellation"); err != nil {
				return r.sendError(conn, env.RequestID, err.Error())
			}
		}
		return r.sendAck(conn, env.RequestID, env.SessionID, nil)

	case protocol.TypeSessionPrompt:
		if err := r.sessionSvc.CheckAndRegisterCommand(env.RequestID, env.SessionID, env.Payload); err != nil {
			if err == session.ErrCommandDuplicate {
				return r.sendAck(conn, env.RequestID, env.SessionID, []byte(`{"status":"already_processed"}`))
			}
			return r.sendError(conn, env.RequestID, err.Error())
		}

		var promptText string
		var pp protocol.PromptPayload
		if err := json.Unmarshal(env.Payload, &pp); err == nil && pp.Text != "" {
			promptText = pp.Text
		} else {
			promptText = string(env.Payload)
		}

		if r.agentEng != nil {
			if err := r.agentEng.StartTurn(ctx, env.SessionID, promptText); err != nil {
				return r.sendError(conn, env.RequestID, err.Error())
			}
			return r.sendAck(conn, env.RequestID, env.SessionID, []byte(`{"status":"turn_started"}`))
		}

		ev, err := r.sessionSvc.EmitEvent(ctx, env.SessionID, "user.message", env.Payload)
		if err != nil {
			return r.sendError(conn, env.RequestID, err.Error())
		}
		data, _ := json.Marshal(ev)
		return r.sendAck(conn, env.RequestID, env.SessionID, data)

	case protocol.TypeApprovalRespond:
		if r.apprMgr == nil {
			return r.sendError(conn, env.RequestID, "no approval manager configured")
		}
		var arp protocol.ApprovalRespondPayload
		if err := json.Unmarshal(env.Payload, &arp); err != nil {
			return r.sendError(conn, env.RequestID, "invalid approval response payload")
		}
		if err := r.apprMgr.ResolveApproval(arp.ApprovalID, arp.Approved, "client", arp.Reason); err != nil {
			return r.sendError(conn, env.RequestID, err.Error())
		}
		return r.sendAck(conn, env.RequestID, env.SessionID, []byte(`{"status":"resolved"}`))

	default:
		return nil
	}
}

func (r *RuntimeServer) sendAck(conn *websocket.Conn, reqID, sessionID string, data json.RawMessage) error {
	r.mu.RLock()
	client := r.findClientByConn(conn)
	r.mu.RUnlock()

	ack := protocol.AckResponse{
		Version:   protocol.ProtocolVersion,
		Type:      protocol.TypeSessionAck,
		RequestID: reqID,
		SessionID: sessionID,
		Success:   true,
		Data:      data,
	}

	if client != nil {
		return client.SendJSON(ack)
	}
	return conn.WriteJSON(ack)
}

func (r *RuntimeServer) sendError(conn *websocket.Conn, reqID, errMsg string) error {
	r.mu.RLock()
	client := r.findClientByConn(conn)
	r.mu.RUnlock()

	errResp := protocol.ErrorResponse{
		Version:   protocol.ProtocolVersion,
		Type:      protocol.TypeErrorResponse,
		RequestID: reqID,
		Error:     errMsg,
	}

	if client != nil {
		return client.SendJSON(errResp)
	}
	return conn.WriteJSON(errResp)
}

func (r *RuntimeServer) findClientByConn(conn *websocket.Conn) *AttachedClient {
	for _, clients := range r.attachedClients {
		if c, exists := clients[conn]; exists {
			return c
		}
	}
	return nil
}

func (r *RuntimeServer) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	conn, err := r.upgrader.Upgrade(w, req, nil)
	if err != nil {
		return
	}
	defer func() {
		r.DetachClient(conn)
		_ = conn.Close()
	}()

	for {
		_, msgBytes, err := conn.ReadMessage()
		if err != nil {
			break
		}
		if err := r.HandleClientMessage(conn, msgBytes); err != nil {
			_ = r.sendError(conn, "", err.Error())
		}
	}
}
