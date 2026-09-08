package server

import (
	"encoding/json"
	"net/http"
	"os"
	"runtime"
	"strings"
	"time"

	"github.com/antigravity/remote-daemon/pkg/domain"
	"github.com/antigravity/remote-daemon/pkg/workspace"
)

type RESTHandler struct {
	rt         *RuntimeServer
	wsMgr      *workspace.Manager
	authToken  string
	startTime  time.Time
}

func NewRESTHandler(rt *RuntimeServer, wsMgr *workspace.Manager, authToken string) *RESTHandler {
	return &RESTHandler{
		rt:        rt,
		wsMgr:     wsMgr,
		authToken: authToken,
		startTime: time.Now(),
	}
}

func (h *RESTHandler) AuthMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if h.authToken != "" && h.authToken != "none" {
			token := r.URL.Query().Get("token")
			if token == "" {
				authHeader := r.Header.Get("Authorization")
				if strings.HasPrefix(authHeader, "Bearer ") {
					token = strings.TrimPrefix(authHeader, "Bearer ")
				}
			}
			if token != h.authToken {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnauthorized)
				_ = json.NewEncoder(w).Encode(map[string]string{"error": "unauthorized: invalid or missing token"})
				return
			}
		}
		next(w, r)
	}
}

func (h *RESTHandler) HandleHealth(w http.ResponseWriter, r *http.Request) {
	hostname, _ := os.Hostname()
	info := h.rt.ServerInfo()

	resp := map[string]interface{}{
		"status":         "ONLINE",
		"mode":           "server",
		"version":        info.Version,
		"serverId":       info.ID,
		"hostname":       hostname,
		"platform":       runtime.GOOS,
		"uptimeSeconds":  int(time.Since(h.startTime).Seconds()),
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

func (h *RESTHandler) HandleListSessions(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	sessions, err := h.rt.store.ListSessions(ctx)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"sessions": sessions,
	})
}

func (h *RESTHandler) HandleCreateSession(w http.ResponseWriter, r *http.Request) {
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
	sess, err := h.rt.SessionService().CreateSession(ctx, h.rt.ServerInfo().ID, body.WorkspaceID, body.Title)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(sess)
}

func (h *RESTHandler) HandleWorkspaces(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost {
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

func NewMux(rt *RuntimeServer, wsMgr *workspace.Manager, authToken string) http.Handler {
	mux := http.NewServeMux()
	rest := NewRESTHandler(rt, wsMgr, authToken)

	// Health (public)
	mux.HandleFunc("/health", rest.HandleHealth)

	// Sessions REST API
	mux.HandleFunc("/v2/sessions", rest.AuthMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			rest.HandleCreateSession(w, r)
		} else {
			rest.HandleListSessions(w, r)
		}
	}))

	// Workspaces REST API
	mux.HandleFunc("/v2/workspaces", rest.AuthMiddleware(rest.HandleWorkspaces))
	mux.HandleFunc("/v2/workspaces/branches", rest.AuthMiddleware(rest.HandleBranches))
	mux.HandleFunc("/v2/workspaces/worktrees", rest.AuthMiddleware(rest.HandleWorktrees))

	// Scheduled Tasks REST API
	mux.HandleFunc("/v2/schedules", rest.AuthMiddleware(rest.HandleSchedules))

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
		if authToken != "" && authToken != "none" {
			token := r.URL.Query().Get("token")
			if token == "" {
				authHeader := r.Header.Get("Authorization")
				if strings.HasPrefix(authHeader, "Bearer ") {
					token = strings.TrimPrefix(authHeader, "Bearer ")
				}
			}
			if token != authToken {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
		}
		rt.ServeHTTP(w, r)
	})

	return mux
}

// Ensure domain is imported for typing
var _ = domain.SessionStateCreated
