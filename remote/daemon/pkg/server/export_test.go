package server_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/antigravity/remote-daemon/pkg/domain"
	"github.com/antigravity/remote-daemon/pkg/eventstore"
	"github.com/antigravity/remote-daemon/pkg/memory"
	"github.com/antigravity/remote-daemon/pkg/server"
	"github.com/antigravity/remote-daemon/pkg/session"
	"github.com/antigravity/remote-daemon/pkg/workspace"
)

func TestREST_ExportAndMemories(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "export_test.db")

	store, err := eventstore.NewSQLiteEventStore(dbPath)
	if err != nil {
		t.Fatalf("failed to create sqlite store: %v", err)
	}
	defer store.Close()

	serverInfo := domain.Server{
		ID:        "srv-export-1",
		Hostname:  "test-host",
		Version:   "2.0.0",
		CreatedAt: time.Now(),
	}

	rt := server.NewRuntimeServer(serverInfo, store)
	wsMgr := workspace.NewManager()

	memStore, err := memory.NewMemoryStore(filepath.Join(tmpDir, "mem.db"))
	if err != nil {
		t.Fatalf("failed creating mem store: %v", err)
	}
	defer memStore.Close()
	rt.SetMemoryStore(memStore)

	chkMgr := session.NewCheckpointManager(store, rt.SessionService(), wsMgr)
	rt.SetCheckpointManager(chkMgr)

	mux := server.NewMux(rt, wsMgr, "token-exp")

	ctx := context.Background()
	sess, err := rt.SessionService().CreateSession(ctx, "srv-export-1", "default", "Sample Export Session")
	if err != nil {
		t.Fatalf("failed creating session: %v", err)
	}

	// Emit mock events
	_, _ = rt.SessionService().EmitEvent(ctx, sess.ID, "user.message", []byte(`{"text":"Build a REST API"}`))
	_, _ = rt.SessionService().EmitEvent(ctx, sess.ID, "agent.thought", []byte(`{"thought":"I will inspect files","message":"Starting implementation"}`))
	_, _ = rt.SessionService().EmitEvent(ctx, sess.ID, "tool.call", []byte(`{"name":"run_command","parameters":{"command":"go build"}}`))
	_, _ = rt.SessionService().EmitEvent(ctx, sess.ID, "tool.result", []byte(`{"success":true,"output":"ok"}`))

	// 1. GET /v2/sessions/export?format=json
	reqJSON := httptest.NewRequest("GET", "/v2/sessions/export?sessionId="+sess.ID+"&format=json&token=token-exp", nil)
	wJSON := httptest.NewRecorder()
	mux.ServeHTTP(wJSON, reqJSON)

	if wJSON.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on json export, got %d", wJSON.Code)
	}

	var exportResp server.SessionExport
	if err := json.NewDecoder(wJSON.Body).Decode(&exportResp); err != nil {
		t.Fatalf("failed decoding json export: %v", err)
	}
	if exportResp.SessionID != sess.ID || exportResp.ToolCounts["run_command"] != 1 {
		t.Fatalf("unexpected export data: %+v", exportResp)
	}

	// 2. GET /v2/sessions/export?format=markdown
	reqMD := httptest.NewRequest("GET", "/v2/sessions/export?sessionId="+sess.ID+"&format=markdown&token=token-exp", nil)
	wMD := httptest.NewRecorder()
	mux.ServeHTTP(wMD, reqMD)

	if wMD.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on markdown export, got %d", wMD.Code)
	}
	mdBody := wMD.Body.String()
	if !strings.Contains(mdBody, "# Session Post-Mortem: Sample Export Session") || !strings.Contains(mdBody, "run_command") {
		t.Fatalf("expected markdown to contain header and tool usage, got:\n%s", mdBody)
	}

	// 3. POST /v2/memories
	postMemBody := []byte(`{"category":"architecture","key":"api_design","content":"REST over HTTP with Bearer Auth","tags":["api","rest"]}`)
	reqPostMem := httptest.NewRequest("POST", "/v2/memories?token=token-exp", bytes.NewReader(postMemBody))
	wPostMem := httptest.NewRecorder()
	mux.ServeHTTP(wPostMem, reqPostMem)

	if wPostMem.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created on POST /v2/memories, got %d", wPostMem.Code)
	}

	// 4. GET /v2/memories
	reqGetMem := httptest.NewRequest("GET", "/v2/memories?category=architecture&token=token-exp", nil)
	wGetMem := httptest.NewRecorder()
	mux.ServeHTTP(wGetMem, reqGetMem)

	if wGetMem.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on GET /v2/memories, got %d", wGetMem.Code)
	}
	if !strings.Contains(wGetMem.Body.String(), "api_design") {
		t.Fatalf("expected memories response to contain 'api_design', got: %s", wGetMem.Body.String())
	}
}
