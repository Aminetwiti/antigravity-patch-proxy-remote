package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/antigravity/remote-daemon/pkg/agent"
	"github.com/antigravity/remote-daemon/pkg/approval"
	"github.com/antigravity/remote-daemon/pkg/auth"
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

	agentEng          *agent.Engine
	apprMgr           *approval.Manager
	v1Adapter         *V1Adapter
	scheduler         *Scheduler
	webhookDispatcher *notification.WebhookDispatcher
	checkpointMgr     *session.CheckpointManager
	memStore          *memory.MemoryStore
	mcpMgr            *mcp.Manager
	rbacMgr           *auth.RBACManager
	reconciler        *Reconciler

	mu               sync.RWMutex
	attachedClients  map[string]map[*websocket.Conn]*AttachedClient
	clientSessions   map[*websocket.Conn]string
	clientIdentities map[*websocket.Conn]*auth.Identity

	upgrader websocket.Upgrader
}

// checkOrigin prevents Cross-Site WebSocket Hijacking (CSWSH) while accepting
// native clients (no Origin header), loopback, private LANs, and matching host/domain.
func checkOrigin(r *http.Request) bool {
	o := r.Header.Get("Origin")
	if o == "" {
		return true // native clients (mobile app, electron, CLI)
	}
	if o == "null" {
		return false // reject sandboxed iframes
	}
	u, err := url.Parse(o)
	if err != nil {
		return false
	}
	h := strings.ToLower(u.Hostname())
	if h == "localhost" || h == "127.0.0.1" || h == "::1" {
		return true
	}
	ip := net.ParseIP(h)
	if ip != nil {
		for _, cidr := range []string{"192.168.0.0/16", "10.0.0.0/8", "172.16.0.0/12"} {
			if _, n, err := net.ParseCIDR(cidr); err == nil && n.Contains(ip) {
				return true
			}
		}
	}
	reqHost := r.Host
	if host, _, err := net.SplitHostPort(reqHost); err == nil {
		reqHost = host
	}
	return strings.EqualFold(h, reqHost)
}

func NewRuntimeServer(serverInfo domain.Server, store eventstore.EventStore) *RuntimeServer {
	rt := &RuntimeServer{
		serverInfo:       serverInfo,
		store:            store,
		attachedClients:  make(map[string]map[*websocket.Conn]*AttachedClient),
		clientSessions:   make(map[*websocket.Conn]string),
		clientIdentities: make(map[*websocket.Conn]*auth.Identity),
		upgrader: websocket.Upgrader{
			CheckOrigin: checkOrigin,
		},
	}

	rt.sessionSvc = session.NewService(store, rt)
	rt.reconciler = NewReconciler(store, rt.sessionSvc, nil, 15*time.Second)
	rt.reconciler.Start()
	return rt
}

func (r *RuntimeServer) Reconciler() *Reconciler {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.reconciler
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

func (r *RuntimeServer) SetRBACManager(m *auth.RBACManager) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.rbacMgr = m
}

func (r *RuntimeServer) RBACManager() *auth.RBACManager {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.rbacMgr
}

func (r *RuntimeServer) getClientIdentity(conn *websocket.Conn) *auth.Identity {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if ident, ok := r.clientIdentities[conn]; ok {
		return ident
	}
	return &auth.Identity{UserID: "anonymous", Role: auth.RoleUser}
}

func (r *RuntimeServer) AttachClient(conn *websocket.Conn, deviceID, sessionID string, lastSeq int64) error {
	ctx := context.Background()

	// 1. SessionID validation: must exist and be registered in store
	if sessionID == "" {
		return errors.New("invalid attach: sessionID is required")
	}
	sess, err := r.store.GetSession(ctx, sessionID)
	if err != nil || sess == nil {
		return fmt.Errorf("session not found: %s", sessionID)
	}

	// 2. Authorization validation
	if r.rbacMgr != nil {
		ident := r.getClientIdentity(conn)
		if !r.rbacMgr.CanAccessSession(ident, sess.OwnerID) {
			return errors.New("forbidden: cannot access session owned by another user")
		}
	}

	// 3. Sequence normalization: client cursor is never blindly trusted
	if lastSeq < 0 {
		lastSeq = 0
	}
	latestSeq, errSeq := r.store.GetLatestSequence(ctx, sessionID)
	if errSeq == nil && latestSeq >= 0 && lastSeq > latestSeq {
		// Client supplied an invalid future sequence: reset to 0 to safely resync
		lastSeq = 0
	}

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

	snapshot, errSnap := r.store.GetLatestSnapshot(ctx, sessionID)
	if errSnap == nil && snapshot != nil && lastSeq < snapshot.Sequence {
		snapPayload, _ := json.Marshal(snapshot.PendingData)
		snapEvent := domain.Event{
			SessionID: sessionID,
			Sequence:  snapshot.Sequence,
			Type:      "session.snapshot",
			Payload:   snapPayload,
			Timestamp: snapshot.CapturedAt.UnixMilli(),
		}
		_ = client.SendJSON(protocol.LiveEventMessage{
			Version:   protocol.ProtocolVersion,
			Type:      protocol.TypeSessionEvent,
			SessionID: sessionID,
			Event:     snapEvent,
		})
		lastSeq = snapshot.Sequence
		client.LastAckedSeq = lastSeq
	}

	// 5. Fetch catchup events strictly from validated sequence
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
		if pEvt.Sequence < 0 || pEvt.Sequence > toSeq {
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

	delete(r.clientIdentities, conn)
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
		ident := r.getClientIdentity(conn)
		if ident != nil && ident.Role == auth.RoleReadOnly {
			return r.sendError(conn, env.RequestID, "forbidden: read-only role cannot create sessions")
		}
		type createPayload struct {
			Title       string `json:"title"`
			WorkspaceID string `json:"workspaceId"`
		}
		var cp createPayload
		if len(env.Payload) > 0 {
			_ = json.Unmarshal(env.Payload, &cp)
		}
		ownerID := ""
		if ident != nil {
			ownerID = ident.UserID
		}
		sess, err := r.sessionSvc.CreateSessionWithOwner(ctx, r.serverInfo.ID, cp.WorkspaceID, cp.Title, ownerID)
		if err != nil {
			return r.sendError(conn, env.RequestID, err.Error())
		}
		data, _ := json.Marshal(sess)
		return r.sendAck(conn, env.RequestID, sess.ID, data)

	case protocol.TypeSessionPause:
		if r.rbacMgr != nil {
			if sess, err := r.store.GetSession(ctx, env.SessionID); err == nil {
				ident := r.getClientIdentity(conn)
				if !r.rbacMgr.CanMutateSession(ident, sess.OwnerID) {
					return r.sendError(conn, env.RequestID, "forbidden: cannot mutate session owned by another user")
				}
			}
		}
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
		if r.rbacMgr != nil {
			if sess, err := r.store.GetSession(ctx, env.SessionID); err == nil {
				ident := r.getClientIdentity(conn)
				if !r.rbacMgr.CanMutateSession(ident, sess.OwnerID) {
					return r.sendError(conn, env.RequestID, "forbidden: cannot mutate session owned by another user")
				}
			}
		}
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
		if r.rbacMgr != nil {
			if sess, err := r.store.GetSession(ctx, env.SessionID); err == nil {
				ident := r.getClientIdentity(conn)
				if !r.rbacMgr.CanMutateSession(ident, sess.OwnerID) {
					return r.sendError(conn, env.RequestID, "forbidden: cannot mutate session owned by another user")
				}
			}
		}
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
		sess, err := r.store.GetSession(ctx, env.SessionID)
		if err != nil {
			return r.sendError(conn, env.RequestID, fmt.Sprintf("session not found: %v", err))
		}
		if domain.IsTerminalState(sess.State) {
			return r.sendError(conn, env.RequestID, fmt.Sprintf("cannot prompt terminal session: state is %s", sess.State))
		}
		if r.rbacMgr != nil {
			ident := r.getClientIdentity(conn)
			if !r.rbacMgr.CanMutateSession(ident, sess.OwnerID) {
				return r.sendError(conn, env.RequestID, "forbidden: cannot mutate session owned by another user")
			}
		}
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
			if err := r.sendAck(conn, env.RequestID, env.SessionID, []byte(`{"status":"turn_started"}`)); err != nil {
				return err
			}
			go func() {
				_ = r.agentEng.StartTurn(context.Background(), env.SessionID, promptText)
			}()
			return nil
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
		ident := r.getClientIdentity(conn)
		if ident.Role == auth.RoleReadOnly {
			return r.sendError(conn, env.RequestID, "forbidden: read-only role cannot resolve approvals")
		}
		apprReq, ok := r.apprMgr.GetApprovalRequest(arp.ApprovalID)
		if !ok {
			return r.sendError(conn, env.RequestID, "approval request not found or already resolved")
		}
		if env.SessionID != "" && env.SessionID != apprReq.SessionID {
			return r.sendError(conn, env.RequestID, "session id mismatch for approval request")
		}
		sess, err := r.store.GetSession(ctx, apprReq.SessionID)
		if err != nil {
			return r.sendError(conn, env.RequestID, fmt.Sprintf("session for approval not found: %v", err))
		}
		if domain.IsTerminalState(sess.State) {
			return r.sendError(conn, env.RequestID, fmt.Sprintf("cannot resolve approval: session is %s", sess.State))
		}
		if r.rbacMgr != nil {
			if !r.rbacMgr.CanMutateSession(ident, sess.OwnerID) {
				return r.sendError(conn, env.RequestID, "forbidden: cannot mutate session owned by another user")
			}
		}
		actorID := "client"
		if ident.UserID != "" {
			actorID = ident.UserID
		}
		if err := r.apprMgr.ResolveApproval(arp.ApprovalID, arp.Approved, actorID, arp.Reason); err != nil {
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
	if ident, ok := req.Context().Value(identityKey).(*auth.Identity); ok {
		r.mu.Lock()
		r.clientIdentities[conn] = ident
		r.mu.Unlock()
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
