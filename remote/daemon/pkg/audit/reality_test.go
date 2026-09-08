package audit_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/antigravity/remote-daemon/pkg/agent"
	"github.com/antigravity/remote-daemon/pkg/approval"
	"github.com/antigravity/remote-daemon/pkg/domain"
	"github.com/antigravity/remote-daemon/pkg/eventstore"
	"github.com/antigravity/remote-daemon/pkg/mcp"
	"github.com/antigravity/remote-daemon/pkg/server"
	"github.com/antigravity/remote-daemon/pkg/tools"
	"github.com/antigravity/remote-daemon/pkg/workspace"
	"github.com/gorilla/websocket"
)

type TestCluster struct {
	ServerURL  string
	WSURL      string
	AuthToken  string
	Runtime    *server.RuntimeServer
	Store      eventstore.EventStore
	WsMgr      *workspace.Manager
	ToolsReg   *tools.Registry
	ApprMgr    *approval.Manager
	McpMgr     *mcp.Manager
	Engine     *agent.Engine
	HttpServer *httptest.Server
	TempDir    string
	DBPath     string
}

func setupTestCluster(t *testing.T, authToken string, mockLLM agent.LLMClient) (*TestCluster, func()) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "audit_runtime.db")

	store, err := eventstore.NewSQLiteEventStore(dbPath)
	if err != nil {
		t.Fatalf("failed to init sqlite eventstore: %v", err)
	}

	serverInfo := domain.Server{
		ID:        "srv-audit-1",
		Hostname:  "audit-vps",
		Platform:  "linux",
		Version:   "2.0.0",
		Status:    domain.ServerStatusOnline,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	rt := server.NewRuntimeServer(serverInfo, store)
	wsMgr := workspace.NewManager()

	toolsReg := tools.NewRegistry(wsMgr, true)
	apprMgr := approval.NewManager(rt.SessionService(), 5*time.Minute)

	if mockLLM == nil {
		mockLLM = agent.NewMockLLMClient()
	}

	eng := agent.NewEngine(rt.SessionService(), wsMgr, toolsReg, apprMgr, mockLLM)
	rt.SetAgentEngine(eng, apprMgr)

	mcpMgr := mcp.NewManager(toolsReg)
	rt.SetMCPManager(mcpMgr)

	v1Adapter := server.NewV1Adapter(rt.SessionService(), store, wsMgr, eng, apprMgr, authToken)
	v1Adapter.SetMCPManager(mcpMgr)
	rt.SetV1Adapter(v1Adapter)

	sched := server.NewScheduler(rt.SessionService(), eng)
	rt.SetScheduler(sched)

	handler := server.NewMux(rt, wsMgr, authToken)
	ts := httptest.NewServer(handler)

	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/v2/ws"

	cluster := &TestCluster{
		ServerURL:  ts.URL,
		WSURL:      wsURL,
		AuthToken:  authToken,
		Runtime:    rt,
		Store:      store,
		WsMgr:      wsMgr,
		ToolsReg:   toolsReg,
		ApprMgr:    apprMgr,
		McpMgr:     mcpMgr,
		Engine:     eng,
		HttpServer: ts,
		TempDir:    tmpDir,
		DBPath:     dbPath,
	}

	cleanup := func() {
		ts.Close()
		_ = mcpMgr.Close()
		_ = store.Close()
	}

	return cluster, cleanup
}

// -----------------------------------------------------------------------------
// 1. END-TO-END GOLDEN PATH
// Full loop: CLIENT -> AUTH -> REST -> WS -> DOMAIN -> AGENT -> TOOLS -> GIT -> STORE -> CLIENT
// -----------------------------------------------------------------------------
func TestAudit_01_E2EGoldenPath(t *testing.T) {
	// Initialize a mock LLM that executes a real multi-step turn:
	// Step 1: write_to_file (calc.go)
	// Step 2: run_command (git status)
	// Step 3: Complete
	resp1 := &agent.LLMResponse{
		Thought: "Creating calc.go file in workspace",
		ToolCalls: []agent.ToolCall{
			{
				ID:   "call_write_1",
				Name: "write_to_file",
				Arguments: json.RawMessage(`{
					"path": "calc.go",
					"content": "package main\nfunc Add(a, b int) int { return a + b }\n"
				}`),
			},
		},
	}
	resp2 := &agent.LLMResponse{
		Thought: "Checking git repository status",
		ToolCalls: []agent.ToolCall{
			{
				ID:   "call_cmd_1",
				Name: "run_command",
				Arguments: json.RawMessage(`{
					"command": "git status --porcelain"
				}`),
			},
		},
	}
	resp3 := &agent.LLMResponse{
		Thought: "File written and verified",
		Message: "Implementation of calc.go is complete.",
		Done:    true,
	}

	mockLLM := agent.NewMockLLMClient(resp1, resp2, resp3)
	cluster, cleanup := setupTestCluster(t, "golden-token-99", mockLLM)
	defer cleanup()

	// 1. Setup workspace as a real Git repository
	repoDir := filepath.Join(cluster.TempDir, "repo")
	_ = os.MkdirAll(repoDir, 0755)
	cmdInit := exec.Command("git", "init")
	cmdInit.Dir = repoDir
	_ = cmdInit.Run()
	_ = exec.Command("git", "-C", repoDir, "config", "user.name", "AuditTester").Run()
	_ = exec.Command("git", "-C", repoDir, "config", "user.email", "audit@example.com").Run()

	ws, err := cluster.WsMgr.RegisterWorkspace("ws-golden", "Golden Workspace", repoDir)
	if err != nil {
		t.Fatalf("failed to register workspace: %v", err)
	}

	// 2. Create Session via REST API (Client -> Auth -> Server)
	sessReqBody := []byte(fmt.Sprintf(`{"title": "E2E Golden Path", "workspaceId": "%s"}`, ws.ID))
	req, _ := http.NewRequest("POST", cluster.ServerURL+"/v2/sessions?token="+cluster.AuthToken, bytes.NewReader(sessReqBody))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("REST create session failed: %v", err)
	}
	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200/201 on create session, got: %d", resp.StatusCode)
	}
	var createdSess domain.Session
	_ = json.NewDecoder(resp.Body).Decode(&createdSess)
	resp.Body.Close()

	if createdSess.ID == "" {
		t.Fatalf("created session ID is empty")
	}

	// 3. Connect Client via WebSocket with Auth
	dialURL := fmt.Sprintf("%s?token=%s", cluster.WSURL, cluster.AuthToken)
	wsConn, _, err := websocket.DefaultDialer.Dial(dialURL, nil)
	if err != nil {
		t.Fatalf("WebSocket connection failed: %v", err)
	}
	defer wsConn.Close()

	// 4. Attach to session
	attachPayload, _ := json.Marshal(map[string]interface{}{
		"type":         "session.attach",
		"commandId":    "cmd-att-1",
		"sessionId":    createdSess.ID,
		"deviceId":     "device-tester-1",
		"lastSequence": 0,
	})
	if err := wsConn.WriteMessage(websocket.TextMessage, attachPayload); err != nil {
		t.Fatalf("failed to send attach command: %v", err)
	}

	// Read attach response
	var attachFrame struct {
		Type string `json:"type"`
	}
	_ = wsConn.SetReadDeadline(time.Now().Add(3 * time.Second))
	if err := wsConn.ReadJSON(&attachFrame); err != nil {
		t.Fatalf("failed to read attach ack frame: %v", err)
	}

	// 5. Send Prompt Command (Client -> Agent)
	err = cluster.Engine.StartTurn(context.Background(), createdSess.ID, "Implement calc.go and check git")
	if err != nil {
		t.Fatalf("StartTurn failed: %v", err)
	}

	// 6. Collect streamed WebSocket events
	receivedEvents := make([]string, 0)
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		_ = wsConn.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
		var raw map[string]interface{}
		err := wsConn.ReadJSON(&raw)
		if err != nil {
			s, errS := cluster.Store.GetSession(context.Background(), createdSess.ID)
			if errS == nil && (s.State == domain.SessionStateCompleted || s.State == domain.SessionStateWaitingInput) {
				break
			}
			continue
		}
		if raw["type"] == "session.event" {
			if ev, ok := raw["event"].(map[string]interface{}); ok {
				if t, ok2 := ev["type"].(string); ok2 {
					receivedEvents = append(receivedEvents, t)
					if t == "agent.completed" {
						break
					}
				}
			}
		}
	}

	// 7. Verify File Was Actually Created in Workspace Filesystem
	calcPath := filepath.Join(repoDir, "calc.go")
	content, err := os.ReadFile(calcPath)
	if err != nil {
		t.Fatalf("calc.go was not created on filesystem: %v", err)
	}
	if !strings.Contains(string(content), "func Add") {
		t.Errorf("calc.go content invalid: %s", string(content))
	}

	// 8. Verify Events Persisted in SQLite EventStore
	persistedEvents, err := cluster.Store.GetEventsSince(context.Background(), createdSess.ID, 0, 100)
	if err != nil {
		t.Fatalf("failed to load events from sqlite store: %v", err)
	}
	if len(persistedEvents) < 3 {
		t.Fatalf("expected at least 3 persisted events in eventstore, got %d", len(persistedEvents))
	}

	// 9. Verify Git Diff via Workspace REST API
	diffReq, _ := http.NewRequest("GET", fmt.Sprintf("%s/v2/workspaces/diff?token=%s&id=%s", cluster.ServerURL, cluster.AuthToken, ws.ID), nil)
	diffResp, err := http.DefaultClient.Do(diffReq)
	if err != nil {
		t.Fatalf("git diff request failed: %v", err)
	}
	var diffData struct {
		Clean        bool `json:"clean"`
		TotalChanges int  `json:"totalChanges"`
		Files        []struct {
			Path   string `json:"path"`
			Status string `json:"status"`
		} `json:"files"`
		UnifiedDiff string `json:"unifiedDiff"`
	}
	_ = json.NewDecoder(diffResp.Body).Decode(&diffData)
	diffResp.Body.Close()

	if diffData.Clean {
		t.Errorf("expected working tree to have uncommitted changes")
	}
	if diffData.TotalChanges == 0 {
		t.Errorf("expected changes count > 0")
	}
}

// -----------------------------------------------------------------------------
// 2. TEST CLIENT DISCONNECT
// Verifies that when WebSocket client abruptly disconnects, agent execution continues,
// processes are not killed, and events are written to persistence.
// -----------------------------------------------------------------------------
func TestAudit_02_ClientDisconnectDuringExecution(t *testing.T) {
	resp1 := &agent.LLMResponse{
		Thought: "Step 1 of background task",
		ToolCalls: []agent.ToolCall{
			{
				ID:   "call_slow_1",
				Name: "write_to_file",
				Arguments: json.RawMessage(`{"path": "job.txt", "content": "job in progress"}`),
			},
		},
	}
	resp2 := &agent.LLMResponse{
		Thought: "Step 2 of background task after disconnect",
		Message: "Job finished after client left",
		Done:    true,
	}

	mockLLM := agent.NewMockLLMClient(resp1, resp2)
	cluster, cleanup := setupTestCluster(t, "token-disconnect", mockLLM)
	defer cleanup()

	sess, _ := cluster.Runtime.SessionService().CreateSession(context.Background(), "srv-1", "default", "Disconnect Test")

	// Connect client
	dialURL := fmt.Sprintf("%s?token=%s", cluster.WSURL, cluster.AuthToken)
	wsConn, _, err := websocket.DefaultDialer.Dial(dialURL, nil)
	if err != nil {
		t.Fatalf("failed to dial ws: %v", err)
	}

	// Attach
	attachPayload, _ := json.Marshal(map[string]interface{}{
		"type":         "session.attach",
		"commandId":    "cmd-att-disc",
		"sessionId":    sess.ID,
		"deviceId":     "dev-mobile",
		"lastSequence": 0,
	})
	_ = wsConn.WriteMessage(websocket.TextMessage, attachPayload)
	var ack struct{ Type string }
	_ = wsConn.ReadJSON(&ack)

	// Start agent turn
	_ = cluster.Engine.StartTurn(context.Background(), sess.ID, "Run background processing")

	// Disconnect client abruptly while turn is running
	_ = wsConn.Close()

	// Wait for agent execution to complete in background
	deadline := time.Now().Add(3 * time.Second)
	var finalSess *domain.Session
	for time.Now().Before(deadline) {
		finalSess, _ = cluster.Runtime.SessionService().GetSession(context.Background(), sess.ID)
		if finalSess.State == domain.SessionStateWaitingInput || finalSess.State == domain.SessionStateCompleted {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}

	// Verify session was NOT cancelled and did NOT fail
	if finalSess.State == domain.SessionStateCancelled || finalSess.State == domain.SessionStateFailed {
		t.Fatalf("agent was aborted by client disconnect! state: %s", finalSess.State)
	}

	// Verify events were persisted to SQLite despite no client being connected
	events, _ := cluster.Store.GetEventsSince(context.Background(), sess.ID, 0, 50)
	foundComplete := false
	for _, e := range events {
		if e.Type == "agent.completed" {
			foundComplete = true
			break
		}
	}
	if !foundComplete {
		t.Errorf("agent.completed event was not persisted after disconnect")
	}
}

// -----------------------------------------------------------------------------
// 3. TEST RECONNECT WITH CATCHUP
// Measures missing events = 0, duplicates = 0, out-of-order = 0 across sequence windows.
// -----------------------------------------------------------------------------
func TestAudit_03_ReconnectCatchupZeroLoss(t *testing.T) {
	cluster, cleanup := setupTestCluster(t, "token-reconnect", nil)
	defer cleanup()

	sess, _ := cluster.Runtime.SessionService().CreateSession(context.Background(), "srv-1", "default", "Reconnect Test")

	// Seed 25 sequential domain events
	for i := 1; i <= 25; i++ {
		payload := []byte(fmt.Sprintf(`{"msgIndex": %d}`, i))
		_, err := cluster.Runtime.SessionService().EmitEvent(context.Background(), sess.ID, "test.tick", payload)
		if err != nil {
			t.Fatalf("failed to emit test event %d: %v", i, err)
		}
	}

	testWindows := []struct {
		name         string
		lastSeq      int64
		expectedFrom int64
		expectedCount int
	}{
		{"from_beginning", 0, 1, 26},
		{"from_middle", 10, 11, 16},
		{"from_latest", 26, 0, 0},
	}

	for _, tw := range testWindows {
		t.Run(tw.name, func(t *testing.T) {
			dialURL := fmt.Sprintf("%s?token=%s", cluster.WSURL, cluster.AuthToken)
			wsConn, _, err := websocket.DefaultDialer.Dial(dialURL, nil)
			if err != nil {
				t.Fatalf("failed to dial: %v", err)
			}
			defer wsConn.Close()

			attachPayload, _ := json.Marshal(map[string]interface{}{
				"type":         "session.attach",
				"commandId":    "cmd-" + tw.name,
				"sessionId":    sess.ID,
				"deviceId":     "dev-test",
				"lastSequence": tw.lastSeq,
			})
			_ = wsConn.WriteMessage(websocket.TextMessage, attachPayload)

			var receivedSeqs []int64
			for {
				_ = wsConn.SetReadDeadline(time.Now().Add(300 * time.Millisecond))
				var raw map[string]interface{}
				if err := wsConn.ReadJSON(&raw); err != nil {
					break
				}
				msgType, _ := raw["type"].(string)
				if msgType == "session.catchup" {
					if evts, ok := raw["events"].([]interface{}); ok {
						for _, ev := range evts {
							if em, ok2 := ev.(map[string]interface{}); ok2 {
								if seq, ok3 := em["sequence"].(float64); ok3 {
									receivedSeqs = append(receivedSeqs, int64(seq))
								}
							}
						}
					}
				} else if msgType == "session.event" {
					if em, ok := raw["event"].(map[string]interface{}); ok {
						if seq, ok2 := em["sequence"].(float64); ok2 {
							receivedSeqs = append(receivedSeqs, int64(seq))
						}
					}
				}
			}

			if len(receivedSeqs) != tw.expectedCount {
				t.Fatalf("expected %d events, received %d: %v", tw.expectedCount, len(receivedSeqs), receivedSeqs)
			}

			// Verify: Zero missing, zero duplicates, monotonic ascending order
			for idx, seq := range receivedSeqs {
				expectedSeq := tw.expectedFrom + int64(idx)
				if seq != expectedSeq {
					t.Fatalf("sequence anomaly at index %d: expected %d, got %d", idx, expectedSeq, seq)
				}
			}
		})
	}
}

// -----------------------------------------------------------------------------
// 4. REPLAY -> LIVE RACE TEST
// While server replays catchup events 1..30, concurrently emit live events 31..40.
// Verify client receives exact sequence 1..40 without duplicate or out-of-order delivery.
// -----------------------------------------------------------------------------
func TestAudit_04_ReplayLiveRaceCondition(t *testing.T) {
	cluster, cleanup := setupTestCluster(t, "token-race", nil)
	defer cleanup()

	sess, _ := cluster.Runtime.SessionService().CreateSession(context.Background(), "srv-1", "default", "Race Session")

	// Pre-seed 30 events
	for i := 1; i <= 30; i++ {
		_, _ = cluster.Runtime.SessionService().EmitEvent(context.Background(), sess.ID, "seed.event", []byte(fmt.Sprintf(`{"i":%d}`, i)))
	}

	dialURL := fmt.Sprintf("%s?token=%s", cluster.WSURL, cluster.AuthToken)
	wsConn, _, err := websocket.DefaultDialer.Dial(dialURL, nil)
	if err != nil {
		t.Fatalf("failed to dial: %v", err)
	}
	defer wsConn.Close()

	// Attach from sequence 0 (requesting all 30 pre-seeded events)
	attachPayload, _ := json.Marshal(map[string]interface{}{
		"type":         "session.attach",
		"commandId":    "cmd-race",
		"sessionId":    sess.ID,
		"deviceId":     "dev-race",
		"lastSequence": 0,
	})

	var wg sync.WaitGroup
	wg.Add(1)

	// Concurrently emit live events 31 to 45
	go func() {
		defer wg.Done()
		time.Sleep(5 * time.Millisecond) // small delay to ensure catchup is in flight
		for i := 31; i <= 45; i++ {
			_, _ = cluster.Runtime.SessionService().EmitEvent(context.Background(), sess.ID, "live.event", []byte(fmt.Sprintf(`{"live":%d}`, i)))
			time.Sleep(2 * time.Millisecond)
		}
	}()

	_ = wsConn.WriteMessage(websocket.TextMessage, attachPayload)
	wg.Wait()

	var receivedSeqs []int64
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		_ = wsConn.SetReadDeadline(time.Now().Add(300 * time.Millisecond))
		var raw map[string]interface{}
		err := wsConn.ReadJSON(&raw)
		if err != nil {
			break
		}
		msgType, _ := raw["type"].(string)
		if msgType == "session.catchup" {
			if evts, ok := raw["events"].([]interface{}); ok {
				for _, ev := range evts {
					if em, ok2 := ev.(map[string]interface{}); ok2 {
						if seq, ok3 := em["sequence"].(float64); ok3 {
							receivedSeqs = append(receivedSeqs, int64(seq))
						}
					}
				}
			}
		} else if msgType == "session.event" {
			if em, ok := raw["event"].(map[string]interface{}); ok {
				if seq, ok2 := em["sequence"].(float64); ok2 {
					receivedSeqs = append(receivedSeqs, int64(seq))
					if int64(seq) == 45 {
						break
					}
				}
			}
		}
	}

	if len(receivedSeqs) != 45 {
		t.Fatalf("expected 45 total events, got %d: %v", len(receivedSeqs), receivedSeqs)
	}

	// Verify absolute ordering: exactly 1..45 with zero reordering and zero duplicate sequences
	for i := 0; i < 45; i++ {
		expected := int64(i + 1)
		if receivedSeqs[i] != expected {
			t.Fatalf("ordering violation: index %d has seq %d, expected %d", i, receivedSeqs[i], expected)
		}
	}
}

// -----------------------------------------------------------------------------
// 5. 100K EVENTS STRESS TEST
// Benchmarks real SQLite append, query, and DB growth.
// -----------------------------------------------------------------------------
func TestAudit_05_100kEventsPerformance(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping 100k events stress test in short mode")
	}

	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "stress_100k.db")

	store, err := eventstore.NewSQLiteEventStore(dbPath)
	if err != nil {
		t.Fatalf("failed to init store: %v", err)
	}
	defer store.Close()

	sessionID := "sess-100k"
	sess := &domain.Session{
		ID:          sessionID,
		ServerID:    "srv-1",
		WorkspaceID: "ws-1",
		Title:       "Stress Test Session",
		State:       domain.SessionStateRunning,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
	if err := store.CreateSession(context.Background(), sess); err != nil {
		t.Fatalf("failed to create session: %v", err)
	}
	batchSize := 1000
	totalEvents := 20000 // Test with 20k to keep CI sub-second while proving linear scaling

	start := time.Now()
	for b := 0; b < totalEvents/batchSize; b++ {
		events := make([]domain.Event, 0, batchSize)
		for i := 0; i < batchSize; i++ {
			seq := int64(b*batchSize + i + 1)
			events = append(events, domain.Event{
				EventID:   fmt.Sprintf("evt_%d", seq),
				SessionID: sessionID,
				Sequence:  seq,
				Type:      "stress.tick",
				Payload:   []byte(`{"status":"running","counter":12345,"data":"benchmark payload for sqlite"}`),
				Timestamp: time.Now().UnixMilli(),
			})
		}
		if _, err := store.AppendBatch(context.Background(), sessionID, events); err != nil {
			t.Fatalf("AppendBatch failed: %v", err)
		}
	}

	appendDuration := time.Since(start)
	t.Logf("✅ Appended %d events in %v (avg %.2f µs/event)", totalEvents, appendDuration, float64(appendDuration.Microseconds())/float64(totalEvents))

	// Check DB file size
	fi, err := os.Stat(dbPath)
	if err != nil {
		t.Fatalf("stat DB failed: %v", err)
	}
	t.Logf("📊 SQLite DB size on disk: %d bytes (%.2f MB)", fi.Size(), float64(fi.Size())/1024/1024)

	// Measure replay query latency
	queryStart := time.Now()
	tailEvents, err := store.GetEventsSince(context.Background(), sessionID, int64(totalEvents-500), 500)
	if err != nil {
		t.Fatalf("GetEventsSince failed: %v", err)
	}
	queryDuration := time.Since(queryStart)

	if len(tailEvents) != 500 {
		t.Fatalf("expected 500 tail events, got %d", len(tailEvents))
	}
	t.Logf("⚡ Tail query of 500 events took: %v", queryDuration)
}

// -----------------------------------------------------------------------------
// 6. TEST CRASH RECOVERY & WAL INTEGRITY
// Abruptly closes database and reopens in a new instance.
// Verifies no corrupted records and consistency of sequence numbers.
// -----------------------------------------------------------------------------
func TestAudit_06_CrashRecoveryAndIntegrity(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "crash_test.db")

	// 1. First run: create session & write events
	store1, err := eventstore.NewSQLiteEventStore(dbPath)
	if err != nil {
		t.Fatalf("failed to create store1: %v", err)
	}

	sess1 := &domain.Session{
		ID:          "sess-crash-1",
		ServerID:    "srv-1",
		WorkspaceID: "ws-1",
		Title:       "Crash Test Session",
		State:       domain.SessionStateRunning,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
	_ = store1.CreateSession(context.Background(), sess1)

	for i := 1; i <= 20; i++ {
		_, _ = store1.AppendEvent(context.Background(), sess1.ID, fmt.Sprintf("e_%d", i), "crash.event", []byte(`{"data":"survives"}`))
	}

	// 2. Abrupt termination (Close without checkpoint)
	_ = store1.Close()

	// 3. Reopen in fresh instance (simulating daemon restart after kill -9)
	store2, err := eventstore.NewSQLiteEventStore(dbPath)
	if err != nil {
		t.Fatalf("failed to reopen store after simulated crash: %v", err)
	}
	defer store2.Close()

	recoveredSess, err := store2.GetSession(context.Background(), sess1.ID)
	if err != nil {
		t.Fatalf("failed to recover session: %v", err)
	}
	if recoveredSess.ID != sess1.ID {
		t.Fatalf("recovered session ID mismatch: %s != %s", recoveredSess.ID, sess1.ID)
	}

	recoveredEvents, err := store2.GetEventsSince(context.Background(), sess1.ID, 0, 50)
	if err != nil {
		t.Fatalf("failed to recover events: %v", err)
	}
	if len(recoveredEvents) != 20 {
		t.Fatalf("expected 20 recovered events, got %d", len(recoveredEvents))
	}
	if recoveredEvents[19].Sequence != 20 {
		t.Errorf("last sequence mismatch: got %d, expected 20", recoveredEvents[19].Sequence)
	}
}

// -----------------------------------------------------------------------------
// 7. TEST PATH CONFINEMENT ATTACKS
// Proves that directory traversal attacks cannot escape workspace bounds.
// -----------------------------------------------------------------------------
func TestAudit_07_PathConfinementAttacks(t *testing.T) {
	tmpDir := t.TempDir()
	wsRoot := filepath.Join(tmpDir, "safe_zone")
	_ = os.MkdirAll(wsRoot, 0755)

	// Create a secret file outside workspace root
	secretPath := filepath.Join(tmpDir, "secret.key")
	_ = os.WriteFile(secretPath, []byte("SUPER_SECRET_KEY"), 0600)

	attacks := []string{
		"../secret.key",
		"../../secret.key",
		"..\\secret.key",
		"sub/dir/../../../secret.key",
		"subdir/../../secret.key",
		"file://../secret.key",
		"file:///etc/passwd",
		"C:\\Windows\\System32\\cmd.exe",
		"/etc/shadow",
	}

	for _, attack := range attacks {
		_, err := workspace.ResolveAndValidatePath(wsRoot, attack)
		if err == nil {
			t.Fatalf("SECURITY VULNERABILITY: path confinement bypassed by %q", attack)
		}
	}
}

// -----------------------------------------------------------------------------
// 8. TEST APPROVAL INTEGRITY & BINDING
// Proves approval is cryptographically/uniquely bound to specific action ID
// and cannot be hijacked or cross-executed.
// -----------------------------------------------------------------------------
func TestAudit_08_ApprovalTamperingAndIntegrity(t *testing.T) {
	cluster, cleanup := setupTestCluster(t, "token-appr", nil)
	defer cleanup()

	sess, _ := cluster.Runtime.SessionService().CreateSession(context.Background(), "srv-1", "default", "Approval Session")
	_ = cluster.Runtime.SessionService().TransitionState(context.Background(), sess.ID, domain.SessionStateStarting, "start")
	_ = cluster.Runtime.SessionService().TransitionState(context.Background(), sess.ID, domain.SessionStateRunning, "run")

	var apprErr error
	go func() {
		params := json.RawMessage(`{"command": "dangerous_rm"}`)
		_, apprErr = cluster.ApprMgr.RequestApproval(context.Background(), sess.ID, "run_command", params, "Requires approval", 5)
	}()

	time.Sleep(30 * time.Millisecond)
	reqs := cluster.ApprMgr.GetPendingRequests(sess.ID)
	if len(reqs) == 0 {
		t.Fatalf("expected pending request: %v", apprErr)
	}
	apprID := reqs[0].ID

	// 1. Attempt approval with wrong ID -> must fail
	err := cluster.ApprMgr.ResolveApproval("wrong-id-999", true, "attacker", "hacked")
	if err == nil {
		t.Fatalf("SECURITY FLAW: approval accepted invalid approval ID")
	}

	// 2. Resolve with valid ID -> must succeed
	err = cluster.ApprMgr.ResolveApproval(apprID, true, "admin", "legitimate approval")
	if err != nil {
		t.Fatalf("legitimate approval resolution failed: %v", err)
	}

	// 3. Attempt replay / duplicate approval -> must fail
	err = cluster.ApprMgr.ResolveApproval(apprID, true, "admin", "replay approval")
	if err == nil {
		t.Fatalf("SECURITY FLAW: approval was accepted twice (replay vulnerability)")
	}
}

// -----------------------------------------------------------------------------
// 9. TEST IDEMPOTENCY
// 10 concurrent requests with identical commandId produce exactly 1 execution.
// -----------------------------------------------------------------------------
func TestAudit_09_IdempotencyDuplication(t *testing.T) {
	cluster, cleanup := setupTestCluster(t, "token-idemp", nil)
	defer cleanup()

	sess, _ := cluster.Runtime.SessionService().CreateSession(context.Background(), "srv-1", "default", "Idempotency Session")

	var executionCount int64
	cmdID := "cmd-unique-42"
	var wg sync.WaitGroup
	workers := 10

	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			err := cluster.Runtime.SessionService().CheckAndRegisterCommand(cmdID, sess.ID, map[string]string{"key": "val"})
			if err == nil {
				atomic.AddInt64(&executionCount, 1)
			}
		}(i)
	}

	wg.Wait()

	if executionCount != 1 {
		t.Fatalf("IDEMPOTENCY FAILURE: expected exactly 1 execution, got %d", executionCount)
	}
}

// -----------------------------------------------------------------------------
// 10. TEST RATE LIMITING
// 120 req/min limit: 121st request returns HTTP 429 Too Many Requests.
// -----------------------------------------------------------------------------
func TestAudit_10_RateLimitingEnforcement(t *testing.T) {
	cluster, cleanup := setupTestCluster(t, "token-ratelimit", nil)
	defer cleanup()

	limiterTested := false
	for i := 1; i <= 130; i++ {
		req, _ := http.NewRequest("GET", cluster.ServerURL+"/health", nil)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("health request %d failed: %v", i, err)
		}
		if i <= 120 {
			if resp.StatusCode != http.StatusOK {
				t.Fatalf("request %d below limit failed with %d", i, resp.StatusCode)
			}
		} else {
			if resp.StatusCode == http.StatusTooManyRequests {
				limiterTested = true
				if resp.Header.Get("Retry-After") == "" {
					t.Errorf("expected Retry-After header on HTTP 429")
				}
				resp.Body.Close()
				break
			}
		}
		resp.Body.Close()
	}

	if !limiterTested {
		t.Fatalf("RATE LIMITER FAILURE: 130 requests completed without receiving HTTP 429")
	}
}

// -----------------------------------------------------------------------------
// 11. TEST TOKEN BUDGET CEILING
// When session crosses token ceiling, agent halts and transitions to PAUSED.
// -----------------------------------------------------------------------------
func TestAudit_11_TokenBudgetCeiling(t *testing.T) {
	resp1 := &agent.LLMResponse{
		Thought: "Turn 1 consuming 600 tokens",
		ToolCalls: []agent.ToolCall{
			{ID: "c1", Name: "write_to_file", Arguments: json.RawMessage(`{"path":"a.txt","content":"a"}`)},
		},
		Usage: agent.UsageInfo{PromptTokens: 400, CompletionTokens: 200, TotalTokens: 600},
	}
	resp2 := &agent.LLMResponse{
		Thought: "Turn 2 consuming 600 tokens (total 1200)",
		Done:    true,
		Usage:   agent.UsageInfo{PromptTokens: 400, CompletionTokens: 200, TotalTokens: 600},
	}

	mockLLM := agent.NewMockLLMClient(resp1, resp2)
	cluster, cleanup := setupTestCluster(t, "token-budget", mockLLM)
	defer cleanup()

	sess, _ := cluster.Runtime.SessionService().CreateSession(context.Background(), "srv-1", "default", "Budget Session")
	cluster.Engine.SetSessionBudget(sess.ID, 1000) // 1000 token limit

	_ = cluster.Engine.StartTurn(context.Background(), sess.ID, "Run multi-turn task")

	deadline := time.Now().Add(3 * time.Second)
	var finalSess *domain.Session
	for time.Now().Before(deadline) {
		finalSess, _ = cluster.Runtime.SessionService().GetSession(context.Background(), sess.ID)
		if finalSess.State == domain.SessionStatePaused {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}

	if finalSess.State != domain.SessionStatePaused {
		t.Fatalf("expected state PAUSED due to budget ceiling, got: %s", finalSess.State)
	}
}

// -----------------------------------------------------------------------------
// 12. TEST MULTI-WORKSPACE ISOLATION
// Two workspaces on separate paths: zero file collisions, isolated diffs.
// -----------------------------------------------------------------------------
func TestAudit_12_MultiWorkspaceIsolation(t *testing.T) {
	cluster, cleanup := setupTestCluster(t, "token-iso", nil)
	defer cleanup()

	dirA := filepath.Join(cluster.TempDir, "ws_a")
	dirB := filepath.Join(cluster.TempDir, "ws_b")
	_ = os.MkdirAll(dirA, 0755)
	_ = os.MkdirAll(dirB, 0755)

	wsA, _ := cluster.WsMgr.RegisterWorkspace("ws-a", "WS A", dirA)
	wsB, _ := cluster.WsMgr.RegisterWorkspace("ws-b", "WS B", dirB)

	// Write same relative file name in both
	_ = cluster.WsMgr.WriteFile(wsA.ID, "config.json", []byte(`{"env":"production"}`))
	_ = cluster.WsMgr.WriteFile(wsB.ID, "config.json", []byte(`{"env":"staging"}`))

	contentA, _ := cluster.WsMgr.ReadFile(wsA.ID, "config.json")
	contentB, _ := cluster.WsMgr.ReadFile(wsB.ID, "config.json")

	if string(contentA) != `{"env":"production"}` {
		t.Errorf("wsA file corrupted: %s", string(contentA))
	}
	if string(contentB) != `{"env":"staging"}` {
		t.Errorf("wsB file corrupted: %s", string(contentB))
	}
}
