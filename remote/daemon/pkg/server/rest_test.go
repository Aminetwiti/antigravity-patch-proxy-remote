package server_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/antigravity/remote-daemon/pkg/approval"
	"github.com/antigravity/remote-daemon/pkg/domain"
	"github.com/antigravity/remote-daemon/pkg/eventstore"
	"github.com/antigravity/remote-daemon/pkg/mcp"
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
	_, _ = wsMgr.RegisterWorkspace("default", "Default Workspace", tmpDir)

	mcpMgr := mcp.NewManager(nil)
	rt.SetMCPManager(mcpMgr)

	sched := server.NewScheduler(rt.SessionService(), nil)
	rt.SetScheduler(sched)

	apprMgr := approval.NewManager(nil, 5*time.Minute)
	rt.SetAgentEngine(nil, apprMgr)

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

func TestREST_Metrics(t *testing.T) {
	mux, cleanup := setupMuxTest(t, "token-metrics")
	defer cleanup()

	req := httptest.NewRequest("GET", "/metrics", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on GET /metrics, got %d", w.Code)
	}

	body := w.Body.String()
	for _, expectedMetric := range []string{
		"ag_uptime_seconds",
		"ag_sessions_total",
		"ag_sessions_active",
		"ag_approvals_pending",
		"ag_scheduler_jobs_total",
	} {
		if !strings.Contains(body, expectedMetric) {
			t.Errorf("expected /metrics output to contain %s, got:\n%s", expectedMetric, body)
		}
	}
}

func TestREST_Approvals(t *testing.T) {
	mux, cleanup := setupMuxTest(t, "token-appr")
	defer cleanup()

	// 1. GET /v2/approvals -> list pending
	getReq := httptest.NewRequest("GET", "/v2/approvals?token=token-appr", nil)
	getW := httptest.NewRecorder()
	mux.ServeHTTP(getW, getReq)

	if getW.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on GET /v2/approvals, got %d", getW.Code)
	}

	var getResp map[string]interface{}
	if err := json.NewDecoder(getW.Body).Decode(&getResp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if _, ok := getResp["approvals"]; !ok {
		t.Fatalf("expected 'approvals' key in response")
	}

	// 2. POST /v2/approvals/resolve -> not found if approval ID doesn't exist
	resolveBody := []byte(`{"approvalId": "non-existent-appr", "approved": true, "reason": "approved by test"}`)
	resolveReq := httptest.NewRequest("POST", "/v2/approvals/resolve?token=token-appr", bytes.NewReader(resolveBody))
	resolveW := httptest.NewRecorder()
	mux.ServeHTTP(resolveW, resolveReq)

	if resolveW.Code != http.StatusNotFound {
		t.Fatalf("expected 404 on non-existent approval ID, got %d (%s)", resolveW.Code, resolveW.Body.String())
	}
}

func TestREST_MCPServers(t *testing.T) {
	mux, cleanup := setupMuxTest(t, "token-mcp")
	defer cleanup()

	// 1. GET /v2/mcp/servers -> list servers
	req := httptest.NewRequest("GET", "/v2/mcp/servers?token=token-mcp", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on GET /v2/mcp/servers, got %d", w.Code)
	}

	var resp map[string]interface{}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if _, ok := resp["servers"]; !ok {
		t.Fatalf("expected 'servers' in response")
	}

	// 2. POST /v2/mcp/servers with invalid json -> 400
	badReq := httptest.NewRequest("POST", "/v2/mcp/servers?token=token-mcp", bytes.NewReader([]byte("{invalid-json")))
	badW := httptest.NewRecorder()
	mux.ServeHTTP(badW, badReq)
	if badW.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 on invalid json, got %d", badW.Code)
	}

	// 3. DELETE without name -> 400
	delReq := httptest.NewRequest("DELETE", "/v2/mcp/servers?token=token-mcp", nil)
	delW := httptest.NewRecorder()
	mux.ServeHTTP(delW, delReq)
	if delW.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 on missing name parameter, got %d", delW.Code)
	}
}

func TestREST_WorkspaceDiffAndCommit(t *testing.T) {
	mux, cleanup := setupMuxTest(t, "token-git")
	defer cleanup()

	// 1. GET /v2/workspaces/diff -> returns diff or error if not git repo
	diffReq := httptest.NewRequest("GET", "/v2/workspaces/diff?token=token-git&id=default", nil)
	diffW := httptest.NewRecorder()
	mux.ServeHTTP(diffW, diffReq)

	// Since default workspace is a tempDir without git init, it either returns 500 (git status failed) or 200
	if diffW.Code != http.StatusOK && diffW.Code != http.StatusInternalServerError {
		t.Fatalf("unexpected code on diff: %d", diffW.Code)
	}

	// 2. POST /v2/workspaces/commit with empty message -> 400
	commitBody := []byte(`{"workspaceId": "default", "message": ""}`)
	commitReq := httptest.NewRequest("POST", "/v2/workspaces/commit?token=token-git", bytes.NewReader(commitBody))
	commitW := httptest.NewRecorder()
	mux.ServeHTTP(commitW, commitReq)

	if commitW.Code != http.StatusBadRequest && commitW.Code != http.StatusInternalServerError {
		t.Fatalf("expected error on empty commit message, got %d", commitW.Code)
	}
}

func TestREST_WorkspaceFileTreeAndSync(t *testing.T) {
	mux, cleanup := setupMuxTest(t, "token-sync")
	defer cleanup()

	// 1. POST /v2/workspaces/file -> write file
	writeBody := []byte(`{"workspaceId": "default", "path": "docs/readme.txt", "content": "hello world from sync"}`)
	writeReq := httptest.NewRequest("POST", "/v2/workspaces/file?token=token-sync", bytes.NewReader(writeBody))
	writeW := httptest.NewRecorder()
	mux.ServeHTTP(writeW, writeReq)

	if writeW.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on write file, got %d: %s", writeW.Code, writeW.Body.String())
	}

	// 2. GET /v2/workspaces/file -> read file
	readReq := httptest.NewRequest("GET", "/v2/workspaces/file?token=token-sync&id=default&path=docs/readme.txt", nil)
	readW := httptest.NewRecorder()
	mux.ServeHTTP(readW, readReq)

	if readW.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on read file, got %d: %s", readW.Code, readW.Body.String())
	}

	var fileResp map[string]interface{}
	if err := json.NewDecoder(readW.Body).Decode(&fileResp); err != nil {
		t.Fatalf("decode read file resp failed: %v", err)
	}
	if fileResp["content"] != "hello world from sync" {
		t.Errorf("expected content 'hello world from sync', got %v", fileResp["content"])
	}

	// 3. GET /v2/workspaces/tree -> list directory tree
	treeReq := httptest.NewRequest("GET", "/v2/workspaces/tree?token=token-sync&id=default&depth=3", nil)
	treeW := httptest.NewRecorder()
	mux.ServeHTTP(treeW, treeReq)

	if treeW.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on tree, got %d: %s", treeW.Code, treeW.Body.String())
	}

	var treeResp struct {
		Files []workspace.FileInfo `json:"files"`
	}
	if err := json.NewDecoder(treeW.Body).Decode(&treeResp); err != nil {
		t.Fatalf("decode tree resp failed: %v", err)
	}
	found := false
	for _, f := range treeResp.Files {
		if strings.Contains(f.Path, "readme.txt") {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("expected readme.txt to be listed in tree, got %+v", treeResp.Files)
	}

	// 4. GET /v2/workspaces/search -> search file contents
	searchReq := httptest.NewRequest("GET", "/v2/workspaces/search?token=token-sync&id=default&query=sync", nil)
	searchW := httptest.NewRecorder()
	mux.ServeHTTP(searchW, searchReq)

	if searchW.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on search, got %d: %s", searchW.Code, searchW.Body.String())
	}

	var searchResp struct {
		Results []workspace.SearchResult `json:"results"`
	}
	if err := json.NewDecoder(searchW.Body).Decode(&searchResp); err != nil {
		t.Fatalf("decode search resp failed: %v", err)
	}
	if len(searchResp.Results) == 0 {
		t.Errorf("expected search to return matches for 'sync'")
	}

	// 5. POST /v2/workspaces/sync with invalid json -> 400
	badSyncReq := httptest.NewRequest("POST", "/v2/workspaces/sync?token=token-sync", bytes.NewReader([]byte("{invalid-json")))
	badSyncW := httptest.NewRecorder()
	mux.ServeHTTP(badSyncW, badSyncReq)
	if badSyncW.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 on bad sync body, got %d", badSyncW.Code)
	}
}
