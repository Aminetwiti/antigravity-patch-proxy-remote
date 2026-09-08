package server_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/antigravity/remote-daemon/pkg/domain"
	"github.com/antigravity/remote-daemon/pkg/eventstore"
	"github.com/antigravity/remote-daemon/pkg/server"
	"github.com/antigravity/remote-daemon/pkg/workspace"
)

func setupMuxTest(t *testing.T, authToken string) (http.Handler, func()) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "rest_test.db")

	store, err := eventstore.NewSQLiteEventStore(dbPath)
	if err != nil {
		t.Fatalf("failed to create sqlite store: %v", err)
	}

	serverInfo := domain.Server{
		ID:        "srv-rest-1",
		Hostname:  "test-host",
		Version:   "2.0.0",
		CreatedAt: time.Now(),
	}

	rt := server.NewRuntimeServer(serverInfo, store)
	wsMgr := workspace.NewManager()

	sched := server.NewScheduler(rt.SessionService(), nil)
	rt.SetScheduler(sched)

	mux := server.NewMux(rt, wsMgr, authToken)

	cleanup := func() {
		_ = store.Close()
	}

	return mux, cleanup
}

func TestREST_Health(t *testing.T) {
	mux, cleanup := setupMuxTest(t, "secret-token")
	defer cleanup()

	req := httptest.NewRequest("GET", "/health", nil)
	w := httptest.NewRecorder()

	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got: %d", w.Code)
	}

	var resp map[string]interface{}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode health response: %v", err)
	}

	if resp["status"] != "ONLINE" || resp["mode"] != "server" {
		t.Fatalf("unexpected health resp: %+v", resp)
	}
}

func TestREST_AuthMiddleware(t *testing.T) {
	mux, cleanup := setupMuxTest(t, "valid-token-123")
	defer cleanup()

	// 1. Missing token -> 401
	req1 := httptest.NewRequest("GET", "/v2/sessions", nil)
	w1 := httptest.NewRecorder()
	mux.ServeHTTP(w1, req1)
	if w1.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 on missing token, got: %d", w1.Code)
	}

	// 2. Invalid token -> 401
	req2 := httptest.NewRequest("GET", "/v2/sessions?token=wrong-token", nil)
	w2 := httptest.NewRecorder()
	mux.ServeHTTP(w2, req2)
	if w2.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 on invalid token, got: %d", w2.Code)
	}

	// 3. Valid query token -> 200
	req3 := httptest.NewRequest("GET", "/v2/sessions?token=valid-token-123", nil)
	w3 := httptest.NewRecorder()
	mux.ServeHTTP(w3, req3)
	if w3.Code != http.StatusOK {
		t.Fatalf("expected 200 on valid query token, got: %d", w3.Code)
	}

	// 4. Valid Bearer header -> 200
	req4 := httptest.NewRequest("GET", "/v2/sessions", nil)
	req4.Header.Set("Authorization", "Bearer valid-token-123")
	w4 := httptest.NewRecorder()
	mux.ServeHTTP(w4, req4)
	if w4.Code != http.StatusOK {
		t.Fatalf("expected 200 on valid bearer header, got: %d", w4.Code)
	}
}

func TestREST_CreateAndListSessions(t *testing.T) {
	mux, cleanup := setupMuxTest(t, "test-token")
	defer cleanup()

	// 1. Create session via POST
	body := []byte(`{"title": "Automated REST Session", "workspaceId": "ws-rest"}`)
	postReq := httptest.NewRequest("POST", "/v2/sessions?token=test-token", bytes.NewReader(body))
	postW := httptest.NewRecorder()
	mux.ServeHTTP(postW, postReq)

	if postW.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created, got: %d, body: %s", postW.Code, postW.Body.String())
	}

	var createdSess domain.Session
	if err := json.NewDecoder(postW.Body).Decode(&createdSess); err != nil {
		t.Fatalf("failed to decode created session: %v", err)
	}

	if createdSess.Title != "Automated REST Session" {
		t.Fatalf("unexpected title: %s", createdSess.Title)
	}

	// 2. List sessions via GET
	getReq := httptest.NewRequest("GET", "/v2/sessions?token=test-token", nil)
	getW := httptest.NewRecorder()
	mux.ServeHTTP(getW, getReq)

	if getW.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got: %d", getW.Code)
	}

	var listResp struct {
		Sessions []domain.Session `json:"sessions"`
	}
	if err := json.NewDecoder(getW.Body).Decode(&listResp); err != nil {
		t.Fatalf("failed to decode list sessions: %v", err)
	}

	if len(listResp.Sessions) != 1 || listResp.Sessions[0].ID != createdSess.ID {
		t.Fatalf("expected 1 session in list, got %+v", listResp.Sessions)
	}
}

func TestREST_Schedules(t *testing.T) {
	mux, cleanup := setupMuxTest(t, "token-sched")
	defer cleanup()

	// 1. Create schedule via POST
	body := []byte(`{"id": "cron-audit", "name": "Nightly Audit", "cron": "0 2 * * *", "prompt": "Audit repo", "workspaceId": "default", "isEnabled": true}`)
	postReq := httptest.NewRequest("POST", "/v2/schedules?token=token-sched", bytes.NewReader(body))
	postW := httptest.NewRecorder()
	mux.ServeHTTP(postW, postReq)

	if postW.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created on POST /v2/schedules, got %d (%s)", postW.Code, postW.Body.String())
	}

	// 2. List schedules via GET
	getReq := httptest.NewRequest("GET", "/v2/schedules?token=token-sched", nil)
	getW := httptest.NewRecorder()
	mux.ServeHTTP(getW, getReq)

	if getW.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on GET /v2/schedules, got %d", getW.Code)
	}

	var listResp struct {
		Schedules []server.ScheduledJob `json:"schedules"`
	}
	if err := json.NewDecoder(getW.Body).Decode(&listResp); err != nil {
		t.Fatalf("failed to decode schedules: %v", err)
	}

	if len(listResp.Schedules) != 1 || listResp.Schedules[0].ID != "cron-audit" {
		t.Fatalf("expected 1 schedule cron-audit, got %+v", listResp.Schedules)
	}

	// 3. Delete schedule via DELETE
	delReq := httptest.NewRequest("DELETE", "/v2/schedules?id=cron-audit&token=token-sched", nil)
	delW := httptest.NewRecorder()
	mux.ServeHTTP(delW, delReq)

	if delW.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on DELETE, got %d", delW.Code)
	}
}

func TestREST_Workspaces(t *testing.T) {
	mux, cleanup := setupMuxTest(t, "token-ws")
	defer cleanup()

	// 1. Create workspace via POST
	body := []byte(`{"id": "ws-cloud", "name": "Cloud Workspace", "path": "test-cloud-dir"}`)
	postReq := httptest.NewRequest("POST", "/v2/workspaces?token=token-ws", bytes.NewReader(body))
	postW := httptest.NewRecorder()
	mux.ServeHTTP(postW, postReq)

	if postW.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created on POST /v2/workspaces, got %d (%s)", postW.Code, postW.Body.String())
	}

	// 2. List workspaces via GET
	getReq := httptest.NewRequest("GET", "/v2/workspaces?token=token-ws", nil)
	getW := httptest.NewRecorder()
	mux.ServeHTTP(getW, getReq)

	if getW.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on GET /v2/workspaces, got %d", getW.Code)
	}
}

