package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/antigravity/remote-daemon/pkg/auth"
	"github.com/antigravity/remote-daemon/pkg/domain"
	"github.com/antigravity/remote-daemon/pkg/mcp"
	"github.com/antigravity/remote-daemon/pkg/workspace"
)

type contextKey string

const identityKey contextKey = "identity"

func getIdentity(r *http.Request) *auth.Identity {
	if ident, ok := r.Context().Value(identityKey).(*auth.Identity); ok {
		return ident
	}
	return &auth.Identity{UserID: "anonymous", Role: auth.RoleUser}
}

type RESTHandler struct {
	rt        *RuntimeServer
	wsMgr     *workspace.Manager
	authToken string
	rbacMgr   *auth.RBACManager
	startTime time.Time
}

func NewRESTHandler(rt *RuntimeServer, wsMgr *workspace.Manager, authToken string) *RESTHandler {
	rbac := auth.NewRBACManager(authToken)
	if rt != nil {
		rt.SetRBACManager(rbac)
	}
	return &RESTHandler{
		rt:        rt,
		wsMgr:     wsMgr,
		authToken: authToken,
		rbacMgr:   rbac,
		startTime: time.Now(),
	}
}

func (h *RESTHandler) SetRBACManager(m *auth.RBACManager) {
	h.rbacMgr = m
	if h.rt != nil {
		h.rt.SetRBACManager(m)
	}
}

func (h *RESTHandler) RBACManager() *auth.RBACManager {
	return h.rbacMgr
}

func (h *RESTHandler) AuthMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := r.URL.Query().Get("token")
		if token == "" {
			authHeader := r.Header.Get("Authorization")
			if strings.HasPrefix(authHeader, "Bearer ") {
				token = strings.TrimPrefix(authHeader, "Bearer ")
			}
		}

		ident, err := h.rbacMgr.Authenticate(token)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "unauthorized: " + err.Error()})
			return
		}

		ctx := context.WithValue(r.Context(), identityKey, ident)
		next(w, r.WithContext(ctx))
	}
}

func (h *RESTHandler) HandleHealth(w http.ResponseWriter, r *http.Request) {
	hostname, _ := os.Hostname()
	info := h.rt.ServerInfo()

	resp := map[string]interface{}{
		"status":        "ONLINE",
		"mode":          "server",
		"version":       info.Version,
		"build":         info.GitCommit,
		"buildTime":     info.BuildTime,
		"goVersion":     runtime.Version(),
		"serverId":      info.ID,
		"hostname":      hostname,
		"platform":      runtime.GOOS,
		"arch":          runtime.GOARCH,
		"uptimeSeconds": int(time.Since(h.startTime).Seconds()),
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

func (h *RESTHandler) HandleListSessions(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	ident := getIdentity(r)
	sessions, err := h.rt.store.ListSessions(ctx)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	var filtered []domain.Session
	for _, s := range sessions {
		if h.rbacMgr.CanAccessSession(ident, s.OwnerID) {
			filtered = append(filtered, s)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"sessions": filtered,
	})
}

func (h *RESTHandler) HandleCreateSession(w http.ResponseWriter, r *http.Request) {
	ident := getIdentity(r)
	if ident.Role == auth.RoleReadOnly {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "forbidden: read-only user cannot create sessions"})
		return
	}

	var body struct {
		Title       string `json:"title"`
		WorkspaceID string `json:"workspaceId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "invalid json body"})
		return
	}

	ctx := r.Context()
	sess, err := h.rt.SessionService().CreateSessionWithOwner(ctx, h.rt.ServerInfo().ID, body.WorkspaceID, body.Title, ident.UserID)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	if h.wsMgr != nil && body.WorkspaceID != "" {
		if head, errHead := h.wsMgr.GetGitHead(body.WorkspaceID); errHead == nil && head != "" {
			sess.BaseCommit = head
		}
		if branch, errBranch := h.wsMgr.CurrentBranch(body.WorkspaceID); errBranch == nil && branch != "" {
			sess.BaseBranch = branch
		}
		_ = h.rt.SessionService().UpdateSessionLineage(ctx, sess.ID, sess.BaseCommit, sess.BaseBranch, "")
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(sess)
}

func (h *RESTHandler) HandleWorkspaces(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost {
		ident := getIdentity(r)
		if ident.Role != auth.RoleAdmin {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "forbidden: only admin can register workspaces"})
			return
		}

		var body struct {
			ID   string `json:"id"`
			Name string `json:"name"`
			Path string `json:"path"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "invalid json body"})
			return
		}

		ws, err := h.wsMgr.RegisterWorkspace(body.ID, body.Name, body.Path)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(ws)
		return
	}

	// GET: list workspaces
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"workspaces": h.wsMgr.ListWorkspaces(),
	})
}

func (h *RESTHandler) HandleBranches(w http.ResponseWriter, r *http.Request) {
	wsID := r.URL.Query().Get("workspaceId")
	if wsID == "" {
		wsList := h.wsMgr.ListWorkspaces()
		if len(wsList) > 0 {
			wsID = wsList[0].ID
		}
	}
	if wsID == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "workspaceId required"})
		return
	}

	branches, err := h.wsMgr.ListBranches(wsID)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	currentBranch, _ := h.wsMgr.CurrentBranch(wsID)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"workspaceId":   wsID,
		"currentBranch": currentBranch,
		"branches":      branches,
	})
}

func (h *RESTHandler) HandleWorktrees(w http.ResponseWriter, r *http.Request) {
	ident := getIdentity(r)
	if ident.Role == auth.RoleReadOnly {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "forbidden: read-only user cannot modify worktrees"})
		return
	}

	if r.Method == http.MethodPost {
		var body struct {
			BaseWorkspaceID string `json:"baseWorkspaceId"`
			Branch          string `json:"branch"`
			WorktreeID      string `json:"worktreeId"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "invalid json body"})
			return
		}

		wt, err := h.wsMgr.CreateWorktree(body.BaseWorkspaceID, body.Branch, body.WorktreeID)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(wt)
		return
	}

	if r.Method == http.MethodDelete {
		id := r.URL.Query().Get("worktreeId")
		if id == "" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "worktreeId parameter required"})
			return
		}

		if err := h.wsMgr.RemoveWorktree(id); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "deleted", "worktreeId": id})
		return
	}

	w.WriteHeader(http.StatusMethodNotAllowed)
}

func (h *RESTHandler) HandleSchedules(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost || r.Method == http.MethodDelete {
		ident := getIdentity(r)
		if ident.Role != auth.RoleAdmin {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "forbidden: only admin can configure schedules"})
			return
		}
	}

	sched := h.rt.Scheduler()
	if sched == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "scheduler not initialized"})
		return
	}

	if r.Method == http.MethodGet {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"schedules": sched.ListJobs(),
		})
		return
	}

	if r.Method == http.MethodPost {
		var job ScheduledJob
		if err := json.NewDecoder(r.Body).Decode(&job); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "invalid json body"})
			return
		}

		if err := sched.AddJob(job); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(job)
		return
	}

	if r.Method == http.MethodDelete {
		id := r.URL.Query().Get("id")
		if id == "" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "id parameter required"})
			return
		}

		if err := sched.RemoveJob(id); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNotFound)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "deleted", "id": id})
		return
	}

	w.WriteHeader(http.StatusMethodNotAllowed)
}

func (h *RESTHandler) HandleMetrics(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessions, _ := h.rt.store.ListSessions(ctx)
	totalSessions := len(sessions)
	activeSessions := 0
	for _, s := range sessions {
		if s.State != domain.SessionStateCompleted && s.State != domain.SessionStateFailed && s.State != domain.SessionStateCancelled {
			activeSessions++
		}
	}

	pendingApprovals := 0
	if apprMgr := h.rt.ApprovalManager(); apprMgr != nil {
		pendingApprovals = len(apprMgr.GetPendingRequests(""))
	}

	schedulesCount := 0
	if sched := h.rt.Scheduler(); sched != nil {
		schedulesCount = len(sched.ListJobs())
	}

	uptimeSec := int(time.Since(h.startTime).Seconds())

	var sb strings.Builder
	sb.WriteString("# HELP ag_uptime_seconds Total runtime server uptime in seconds\n")
	sb.WriteString("# TYPE ag_uptime_seconds counter\n")
	fmt.Fprintf(&sb, "ag_uptime_seconds %d\n\n", uptimeSec)

	sb.WriteString("# HELP ag_sessions_total Total number of sessions created\n")
	sb.WriteString("# TYPE ag_sessions_total counter\n")
	fmt.Fprintf(&sb, "ag_sessions_total %d\n\n", totalSessions)

	sb.WriteString("# HELP ag_sessions_active Number of active sessions\n")
	sb.WriteString("# TYPE ag_sessions_active gauge\n")
	fmt.Fprintf(&sb, "ag_sessions_active %d\n\n", activeSessions)

	sb.WriteString("# HELP ag_approvals_pending Number of pending tool approval requests\n")
	sb.WriteString("# TYPE ag_approvals_pending gauge\n")
	fmt.Fprintf(&sb, "ag_approvals_pending %d\n\n", pendingApprovals)

	sb.WriteString("# HELP ag_scheduler_jobs_total Number of configured background scheduler jobs\n")
	sb.WriteString("# TYPE ag_scheduler_jobs_total gauge\n")
	fmt.Fprintf(&sb, "ag_scheduler_jobs_total %d\n", schedulesCount)

	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	_, _ = w.Write([]byte(sb.String()))
}

func (h *RESTHandler) HandleApprovals(w http.ResponseWriter, r *http.Request) {
	apprMgr := h.rt.ApprovalManager()
	if apprMgr == nil {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"approvals": []interface{}{}})
		return
	}

	if r.Method == http.MethodGet {
		sessionID := r.URL.Query().Get("sessionId")
		list := apprMgr.GetPendingRequests(sessionID)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"approvals": list})
		return
	}

	w.WriteHeader(http.StatusMethodNotAllowed)
}

func (h *RESTHandler) HandleResolveApproval(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	ident := getIdentity(r)
	if ident.Role == auth.RoleReadOnly {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "forbidden: read-only user cannot resolve approvals"})
		return
	}

	apprMgr := h.rt.ApprovalManager()
	if apprMgr == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "approval manager not initialized"})
		return
	}

	var body struct {
		ApprovalID string `json:"approvalId"`
		Approved   bool   `json:"approved"`
		Reason     string `json:"reason"`
		ActorID    string `json:"actorId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "invalid json body"})
		return
	}

	if body.ApprovalID == "" {
		body.ApprovalID = r.URL.Query().Get("id")
	}

	if appr, ok := apprMgr.GetApprovalRequest(body.ApprovalID); ok {
		if sess, err := h.rt.store.GetSession(r.Context(), appr.SessionID); err == nil {
			if !h.rbacMgr.CanMutateSession(ident, sess.OwnerID) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusForbidden)
				_ = json.NewEncoder(w).Encode(map[string]string{"error": "forbidden: cannot mutate session owned by another user"})
				return
			}
		}
	}

	actorID := body.ActorID
	if actorID == "" || actorID == "rest-api" {
		if ident.UserID != "" {
			actorID = ident.UserID
		} else {
			actorID = "rest-api"
		}
	}

	err := apprMgr.ResolveApproval(body.ApprovalID, body.Approved, actorID, body.Reason)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"success":    true,
		"approvalId": body.ApprovalID,
		"approved":   body.Approved,
	})
}

func (h *RESTHandler) HandleExportSession(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	sessionID := r.URL.Query().Get("sessionId")
	if sessionID == "" {
		parts := strings.Split(r.URL.Path, "/")
		for i, p := range parts {
			if p == "sessions" && i+1 < len(parts) {
				sessionID = parts[i+1]
				break
			}
		}
	}

	if sessionID == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "missing sessionId parameter"})
		return
	}

	ctx := r.Context()
	sess, err := h.rt.store.GetSession(ctx, sessionID)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	ident := getIdentity(r)
	if !h.rbacMgr.CanAccessSession(ident, sess.OwnerID) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "forbidden: cannot access session owned by another user"})
		return
	}

	export, err := BuildSessionExport(ctx, h.rt.store, sessionID)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	format := strings.ToLower(r.URL.Query().Get("format"))
	if format == "json" {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(export)
		return
	}

	w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"session-%s.md\"", sessionID))
	md := FormatSessionMarkdown(export)
	_, _ = w.Write([]byte(md))
}

func (h *RESTHandler) HandleRollbackSession(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	var body struct {
		SessionID string `json:"sessionId"`
		Sequence  int64  `json:"sequence"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)

	if body.SessionID == "" {
		body.SessionID = r.URL.Query().Get("sessionId")
	}

	ctx := r.Context()
	sess, err := h.rt.store.GetSession(ctx, body.SessionID)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	ident := getIdentity(r)
	if !h.rbacMgr.CanMutateSession(ident, sess.OwnerID) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "forbidden: cannot mutate session owned by another user"})
		return
	}

	chkMgr := h.rt.CheckpointManager()
	if chkMgr == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "checkpoint manager not initialized"})
		return
	}

	snap, err := chkMgr.RollbackSession(ctx, body.SessionID, body.Sequence)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"success":  true,
		"snapshot": snap,
	})
}

func (h *RESTHandler) HandleMemories(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost || r.Method == http.MethodDelete {
		ident := getIdentity(r)
		if ident.Role == auth.RoleReadOnly {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "forbidden: read-only user cannot mutate memories"})
			return
		}
	}

	memStore := h.rt.MemoryStore()
	if memStore == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "memory store not initialized"})
		return
	}

	ctx := r.Context()

	switch r.Method {
	case http.MethodGet:
		category := r.URL.Query().Get("category")
		query := r.URL.Query().Get("query")
		list, err := memStore.Recall(ctx, category, query, 50)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"memories": list})

	case http.MethodPost:
		var body struct {
			Category string   `json:"category"`
			Key      string   `json:"key"`
			Content  string   `json:"content"`
			Tags     []string `json:"tags"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "invalid json body"})
			return
		}
		mem, err := memStore.Store(ctx, body.Category, body.Key, body.Content, body.Tags)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(mem)

	case http.MethodDelete:
		ident := getIdentity(r)
		if ident.Role == auth.RoleReadOnly {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "forbidden: read-only user cannot mutate memories"})
			return
		}

		id := r.URL.Query().Get("id")
		if id == "" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "missing id query param"})
			return
		}
		if err := memStore.Delete(ctx, id); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "deleted", "id": id})

	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (h *RESTHandler) HandleWorkspaceDiff(w http.ResponseWriter, r *http.Request) {
	wsID := r.URL.Query().Get("id")
	if wsID == "" {
		wsID = r.URL.Query().Get("workspaceId")
	}
	if wsID == "" {
		if sessID := r.URL.Query().Get("sessionId"); sessID != "" {
			if sess, err := h.rt.store.GetSession(r.Context(), sessID); err == nil {
				wsID = sess.WorkspaceID
			}
		}
	}
	if wsID == "" {
		wsList := h.wsMgr.ListWorkspaces()
		if len(wsList) > 0 {
			wsID = wsList[0].ID
		}
	}
	if wsID == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "workspaceId or sessionId required"})
		return
	}

	diff, err := h.wsMgr.Diff(wsID)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(diff)
}

func (h *RESTHandler) HandleWorkspaceCommit(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	ident := getIdentity(r)
	if ident.Role == auth.RoleReadOnly {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "forbidden: read-only user cannot commit"})
		return
	}

	var body struct {
		WorkspaceID string `json:"workspaceId"`
		SessionID   string `json:"sessionId"`
		Message     string `json:"message"`
		Author      string `json:"author"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "invalid json body"})
		return
	}

	wsID := body.WorkspaceID
	if wsID == "" && body.SessionID != "" {
		if sess, err := h.rt.store.GetSession(r.Context(), body.SessionID); err == nil {
			wsID = sess.WorkspaceID
		}
	}
	if wsID == "" {
		wsList := h.wsMgr.ListWorkspaces()
		if len(wsList) > 0 {
			wsID = wsList[0].ID
		}
	}

	res, err := h.wsMgr.Commit(wsID, body.Message, body.Author)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(res)
}

func (h *RESTHandler) HandlePromoteShadowWorktree(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var body struct {
		WorkspaceID string `json:"workspaceId"`
		SessionID   string `json:"sessionId"`
		Message     string `json:"message"`
		Author      string `json:"author"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "invalid json: " + err.Error()})
		return
	}
	if body.WorkspaceID == "" {
		body.WorkspaceID = "default"
	}
	res, err := h.wsMgr.PromoteShadowWorktree(body.WorkspaceID, body.SessionID, body.Message, body.Author)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(res)
}

func (h *RESTHandler) HandleDiscardShadowWorktree(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var body struct {
		WorkspaceID string `json:"workspaceId"`
		SessionID   string `json:"sessionId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "invalid json: " + err.Error()})
		return
	}
	if body.WorkspaceID == "" {
		body.WorkspaceID = "default"
	}
	if err := h.wsMgr.DiscardShadowWorktree(body.WorkspaceID, body.SessionID); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}

func (h *RESTHandler) HandleSessionTelemetry(w http.ResponseWriter, r *http.Request) {
	sessID := r.URL.Query().Get("id")
	if sessID == "" {
		sessID = r.URL.Query().Get("sessionId")
	}
	if sessID == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "sessionId required"})
		return
	}
	sess, err := h.rt.store.GetSession(r.Context(), sessID)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"sessionId":   sess.ID,
		"workspaceId": sess.WorkspaceID,
		"state":       sess.State,
		"title":       sess.Title,
		"createdAt":   sess.CreatedAt,
		"updatedAt":   sess.UpdatedAt,
	})
}

func (h *RESTHandler) HandleWorkspaceTree(w http.ResponseWriter, r *http.Request) {
	wsID := r.URL.Query().Get("id")
	if wsID == "" {
		wsID = r.URL.Query().Get("workspaceId")
	}
	if wsID == "" {
		if sessID := r.URL.Query().Get("sessionId"); sessID != "" {
			if sess, err := h.rt.store.GetSession(r.Context(), sessID); err == nil {
				wsID = sess.WorkspaceID
			}
		}
	}
	if wsID == "" {
		wsList := h.wsMgr.ListWorkspaces()
		if len(wsList) > 0 {
			wsID = wsList[0].ID
		}
	}
	if wsID == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "workspaceId required"})
		return
	}

	path := r.URL.Query().Get("path")
	depth := 3
	if dStr := r.URL.Query().Get("depth"); dStr != "" {
		if d, err := strconv.Atoi(dStr); err == nil && d > 0 && d <= 8 {
			depth = d
		}
	}

	files, err := h.wsMgr.ListDirectory(wsID, path, depth)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"files": files})
}

func (h *RESTHandler) HandleWorkspaceFile(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		wsID := r.URL.Query().Get("id")
		if wsID == "" {
			wsID = r.URL.Query().Get("workspaceId")
		}
		if wsID == "" {
			wsList := h.wsMgr.ListWorkspaces()
			if len(wsList) > 0 {
				wsID = wsList[0].ID
			}
		}
		filePath := r.URL.Query().Get("path")
		if filePath == "" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "path required"})
			return
		}

		data, err := h.wsMgr.ReadFile(wsID, filePath)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNotFound)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"path":    filePath,
			"content": string(data),
			"size":    len(data),
		})

	case http.MethodPost, http.MethodPut:
		ident := getIdentity(r)
		if ident.Role == auth.RoleReadOnly {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "forbidden: read-only user cannot write files"})
			return
		}

		var body struct {
			WorkspaceID string `json:"workspaceId"`
			Path        string `json:"path"`
			Content     string `json:"content"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "invalid json body"})
			return
		}

		wsID := body.WorkspaceID
		if wsID == "" {
			wsList := h.wsMgr.ListWorkspaces()
			if len(wsList) > 0 {
				wsID = wsList[0].ID
			}
		}

		if err := h.wsMgr.WriteFile(wsID, body.Path, []byte(body.Content)); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"path":    body.Path,
			"size":    len(body.Content),
		})

	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (h *RESTHandler) HandleWorkspaceSearch(w http.ResponseWriter, r *http.Request) {
	wsID := r.URL.Query().Get("id")
	if wsID == "" {
		wsID = r.URL.Query().Get("workspaceId")
	}
	if wsID == "" {
		wsList := h.wsMgr.ListWorkspaces()
		if len(wsList) > 0 {
			wsID = wsList[0].ID
		}
	}
	query := r.URL.Query().Get("query")
	maxResults := 50
	if mStr := r.URL.Query().Get("max"); mStr != "" {
		if m, err := strconv.Atoi(mStr); err == nil && m > 0 {
			maxResults = m
		}
	}

	results, err := h.wsMgr.SearchFiles(wsID, query, maxResults)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"results": results})
}

func (h *RESTHandler) HandleWorkspaceSync(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	ident := getIdentity(r)
	if ident.Role == auth.RoleReadOnly {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "forbidden: read-only user cannot sync workspace"})
		return
	}

	var body struct {
		WorkspaceID string `json:"workspaceId"`
		Action      string `json:"action"` // "pull", "push", "preflight", "safe_pull"
		Remote      string `json:"remote"`
		Branch      string `json:"branch"`
		Force       bool   `json:"force"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "invalid json body"})
		return
	}

	wsID := body.WorkspaceID
	if wsID == "" {
		wsList := h.wsMgr.ListWorkspaces()
		if len(wsList) > 0 {
			wsID = wsList[0].ID
		}
	}

	if body.Action == "preflight" {
		preflight, err := h.wsMgr.PreflightSync(wsID, body.Remote, body.Branch)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			_ = json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error()})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(preflight)
		return
	}

	if body.Action == "push" {
		res, err := h.wsMgr.Push(wsID, body.Remote, body.Branch)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			_ = json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "result": res})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(res)
		return
	}

	if body.Action == "safe_pull" || (!body.Force && body.Action == "pull") {
		res, err := h.wsMgr.SafeSync(wsID, body.Remote, body.Branch)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusConflict)
			_ = json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "result": res})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(res)
		return
	}

	// Default fallback action: forced pull
	res, err := h.wsMgr.Pull(wsID, body.Remote, body.Branch)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "result": res})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(res)
}

func (h *RESTHandler) HandleMCPServers(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost || r.Method == http.MethodDelete {
		ident := getIdentity(r)
		if ident.Role != auth.RoleAdmin {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "forbidden: only admin can manage MCP servers"})
			return
		}
	}

	mcpMgr := h.rt.MCPManager()
	if mcpMgr == nil {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"servers": []interface{}{}})
		return
	}

	switch r.Method {
	case http.MethodGet:
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"servers": mcpMgr.ListServers(),
		})

	case http.MethodPost:
		var cfg mcp.ServerConfig
		if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "invalid json body"})
			return
		}

		info, err := mcpMgr.RegisterServer(r.Context(), cfg)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(info)

	case http.MethodDelete:
		ident := getIdentity(r)
		if ident.Role != auth.RoleAdmin {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "forbidden: only admin can manage MCP servers"})
			return
		}

		name := r.URL.Query().Get("name")
		if name == "" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "name parameter required"})
			return
		}

		if err := mcpMgr.UnregisterServer(name); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNotFound)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "unregistered", "name": name})

	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (h *RESTHandler) HandleMCPCall(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	ident := getIdentity(r)
	if ident.Role == auth.RoleReadOnly {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "forbidden: read-only user cannot call MCP tools"})
		return
	}

	mcpMgr := h.rt.MCPManager()
	if mcpMgr == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "mcp manager not initialized"})
		return
	}

	var body struct {
		ServerName string                 `json:"serverName"`
		ToolName   string                 `json:"toolName"`
		Arguments  map[string]interface{} `json:"arguments"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "invalid json body"})
		return
	}

	output, err := mcpMgr.CallServerTool(r.Context(), body.ServerName, body.ToolName, body.Arguments)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"output":  output,
	})
}

func NewMux(rt *RuntimeServer, wsMgr *workspace.Manager, authToken string) http.Handler {
	return NewMuxWithRBAC(rt, wsMgr, auth.NewRBACManager(authToken))
}

func NewMuxWithRBAC(rt *RuntimeServer, wsMgr *workspace.Manager, rbacMgr *auth.RBACManager) http.Handler {
	mux := http.NewServeMux()
	adminToken := ""
	if rbacMgr != nil {
		adminToken = rbacMgr.AdminToken()
	}
	rest := &RESTHandler{
		rt:        rt,
		wsMgr:     wsMgr,
		authToken: adminToken,
		rbacMgr:   rbacMgr,
		startTime: time.Now(),
	}
	if rt != nil && rbacMgr != nil {
		rt.SetRBACManager(rbacMgr)
	}

	// Health (public)
	mux.HandleFunc("/health", rest.HandleHealth)

	// Prometheus Metrics Exporter (public or scraper)
	mux.HandleFunc("/metrics", rest.HandleMetrics)

	// Sessions REST API
	mux.HandleFunc("/v2/sessions", rest.AuthMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			rest.HandleCreateSession(w, r)
		} else {
			rest.HandleListSessions(w, r)
		}
	}))

	// Session Export & Rollback
	mux.HandleFunc("/v2/sessions/export", rest.AuthMiddleware(rest.HandleExportSession))
	mux.HandleFunc("/v2/sessions/rollback", rest.AuthMiddleware(rest.HandleRollbackSession))

	// Long-Term Memory API
	mux.HandleFunc("/v2/memories", rest.AuthMiddleware(rest.HandleMemories))

	// Workspaces REST API
	mux.HandleFunc("/v2/workspaces", rest.AuthMiddleware(rest.HandleWorkspaces))
	mux.HandleFunc("/v2/workspaces/branches", rest.AuthMiddleware(rest.HandleBranches))
	mux.HandleFunc("/v2/workspaces/worktrees", rest.AuthMiddleware(rest.HandleWorktrees))
	mux.HandleFunc("/v2/workspaces/diff", rest.AuthMiddleware(rest.HandleWorkspaceDiff))
	mux.HandleFunc("/v2/workspaces/commit", rest.AuthMiddleware(rest.HandleWorkspaceCommit))
	mux.HandleFunc("/v2/workspaces/tree", rest.AuthMiddleware(rest.HandleWorkspaceTree))
	mux.HandleFunc("/v2/workspaces/file", rest.AuthMiddleware(rest.HandleWorkspaceFile))
	mux.HandleFunc("/v2/workspaces/search", rest.AuthMiddleware(rest.HandleWorkspaceSearch))
	mux.HandleFunc("/v2/workspaces/sync", rest.AuthMiddleware(rest.HandleWorkspaceSync))
	mux.HandleFunc("/v2/workspaces/shadow/promote", rest.AuthMiddleware(rest.HandlePromoteShadowWorktree))
	mux.HandleFunc("/v2/workspaces/shadow/discard", rest.AuthMiddleware(rest.HandleDiscardShadowWorktree))
	mux.HandleFunc("/v2/sessions/telemetry", rest.AuthMiddleware(rest.HandleSessionTelemetry))

	// Session Git shortcuts
	mux.HandleFunc("/v2/sessions/diff", rest.AuthMiddleware(rest.HandleWorkspaceDiff))
	mux.HandleFunc("/v2/sessions/commit", rest.AuthMiddleware(rest.HandleWorkspaceCommit))

	// MCP Host REST API
	mux.HandleFunc("/v2/mcp/servers", rest.AuthMiddleware(rest.HandleMCPServers))
	mux.HandleFunc("/v2/mcp/servers/call", rest.AuthMiddleware(rest.HandleMCPCall))

	// Scheduled Tasks REST API
	mux.HandleFunc("/v2/schedules", rest.AuthMiddleware(rest.HandleSchedules))

	// Approvals REST API
	mux.HandleFunc("/v2/approvals", rest.AuthMiddleware(rest.HandleApprovals))
	mux.HandleFunc("/v2/approvals/resolve", rest.AuthMiddleware(rest.HandleResolveApproval))

	// Interactive Terminal WebSocket (/v2/terminal) and One-Shot Command Execution (/v2/terminal/exec)
	termHandler := NewTerminalHandler(wsMgr, adminToken)
	if rbacMgr != nil {
		termHandler.SetRBACManager(rbacMgr)
	}
	mux.Handle("/v2/terminal", termHandler)
	mux.HandleFunc("/v2/terminal/exec", termHandler.HandleExec)

	// Web Console Single-Page App (GET / and GET /console)
	mux.HandleFunc("/console", HandleWebConsole)
	mux.HandleFunc("/", HandleWebConsole)

	// Protocol v1 Compatibility WebSocket Endpoint (/ws)
	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		if adapter := rt.V1Adapter(); adapter != nil {
			adapter.HandleWebSocket(w, r)
			return
		}
		http.Error(w, `{"error":"v1 adapter not initialized"}`, http.StatusServiceUnavailable)
	})

	// WebSocket Endpoint (/v2/ws)
	mux.HandleFunc("/v2/ws", func(w http.ResponseWriter, r *http.Request) {
		token := r.URL.Query().Get("token")
		if token == "" {
			authHeader := r.Header.Get("Authorization")
			if strings.HasPrefix(authHeader, "Bearer ") {
				token = strings.TrimPrefix(authHeader, "Bearer ")
			}
		}
		ident, err := rest.rbacMgr.Authenticate(token)
		if err != nil {
			http.Error(w, "unauthorized: "+err.Error(), http.StatusUnauthorized)
			return
		}
		ctx := context.WithValue(r.Context(), identityKey, ident)
		rt.ServeHTTP(w, r.WithContext(ctx))
	})

	// Global Sliding-Window Rate Limiter (120 req/min)
	rateLimiter := NewSlidingWindowLimiter(120, time.Minute)
	return rateLimiter.Middleware(mux)
}

// Ensure domain is imported for typing
var _ = domain.SessionStateCreated
