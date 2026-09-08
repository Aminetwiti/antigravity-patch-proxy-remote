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
		"status": "ok",
	})
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
