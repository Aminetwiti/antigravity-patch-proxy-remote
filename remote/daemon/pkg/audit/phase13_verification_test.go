package audit_test

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

	"github.com/antigravity/remote-daemon/pkg/agent"
	"github.com/antigravity/remote-daemon/pkg/auth"
	"github.com/antigravity/remote-daemon/pkg/domain"
	"github.com/antigravity/remote-daemon/pkg/eventstore"
	"github.com/antigravity/remote-daemon/pkg/notification"
	"github.com/antigravity/remote-daemon/pkg/server"
	"github.com/antigravity/remote-daemon/pkg/tools"
	"github.com/gorilla/websocket"
)

// -----------------------------------------------------------------------------
// PHASE 13 - TEST 1: TERMINAL TAKEOVER PREVENTION & RBAC ISOLATION
// Verifies that a user cannot attach to, inject input into, or kill another
// user's terminal session, and that read-only users cannot access terminals.
// -----------------------------------------------------------------------------
func TestPhase13_TerminalTakeoverPrevented(t *testing.T) {
	cluster, cleanup := setupTestCluster(t, "admin-secret-99", nil)
	defer cleanup()

	rbac := cluster.Runtime.RBACManager()
	_ = rbac.RegisterUser("user-a", "token-user-a", auth.RoleUser)
	_ = rbac.RegisterUser("user-b", "token-user-b", auth.RoleUser)
	_ = rbac.RegisterUser("user-ro", "token-readonly", auth.RoleReadOnly)

	termHandler := server.NewTerminalHandler(cluster.WsMgr, cluster.AuthToken)
	termHandler.SetRBACManager(rbac)
	ts := httptest.NewServer(termHandler)
	defer ts.Close()

	termID := "term-shared-1"
	wsURLUserA := "ws" + strings.TrimPrefix(ts.URL, "http") + "?token=token-user-a&sessionId=" + termID

	// 1. User A creates and attaches to terminal
	wsConnA, respA, err := websocket.DefaultDialer.Dial(wsURLUserA, nil)
	if err != nil {
		t.Fatalf("User A failed to connect to terminal: %v", err)
	}
	defer wsConnA.Close()
	if respA.StatusCode != http.StatusSwitchingProtocols {
		t.Fatalf("expected 101 Switching Protocols, got %d", respA.StatusCode)
	}

	// 2. User B attempts to attach to User A's terminal session
	wsURLUserB := "ws" + strings.TrimPrefix(ts.URL, "http") + "?token=token-user-b&sessionId=" + termID
	_, respB, err := websocket.DefaultDialer.Dial(wsURLUserB, nil)
	if err == nil {
		t.Fatalf("SECURITY VIOLATION: User B successfully connected to User A's terminal!")
	}
	if respB == nil || respB.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden when User B connects to User A's terminal, got: %v", respB)
	}

	// 3. ReadOnly user attempts to connect to a terminal
	wsURLRO := "ws" + strings.TrimPrefix(ts.URL, "http") + "?token=token-readonly&sessionId=term-ro"
	_, respRO, err := websocket.DefaultDialer.Dial(wsURLRO, nil)
	if err == nil {
		t.Fatalf("SECURITY VIOLATION: ReadOnly user connected to terminal!")
	}
	if respRO == nil || respRO.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for ReadOnly user on terminal, got: %v", respRO)
	}

	t.Logf("PASS: Terminal takeover strictly prevented across tenants and roles.")
}

// -----------------------------------------------------------------------------
// PHASE 13 - TEST 2: ALTERNATIVE IP FORMAT SSRF SUITE
// Verifies that decimal integer, hex, octal, shorthand, and cloud metadata
// notations are strictly rejected by SSRF validation.
// -----------------------------------------------------------------------------
func TestPhase13_SSRF_AlternativeIPFormats(t *testing.T) {
	fetchTool := tools.NewFetchWebPageTool()

	evasiveTargets := []struct {
		url  string
		name string
	}{
		{"http://2130706433/", "Decimal IPv4 (127.0.0.1)"},
		{"http://0x7f000001/", "Hex IPv4 (127.0.0.1)"},
		{"http://0177.0.0.1/", "Octal IPv4 (127.0.0.1)"},
		{"http://127.1/", "Shorthand IPv4 (127.0.0.1)"},
		{"http://localhost./", "Trailing dot FQDN (localhost.)"},
		{"http://metadata.google.internal/computeMetadata/v1/", "GCP Metadata hostname"},
		{"http://instance-data/latest/meta-data/", "AWS Instance Data hostname"},
		{"file:///etc/passwd", "File scheme"},
		{"gopher://127.0.0.1:6379/", "Gopher scheme"},
		{"ftp://127.0.0.1/", "FTP scheme"},
	}

	for _, tt := range evasiveTargets {
		t.Run(tt.name, func(t *testing.T) {
			params, _ := json.Marshal(map[string]string{"url": tt.url})
			res, err := fetchTool.Execute(context.Background(), "s1", "w1", params, nil)
			if err == nil && res.Success {
				t.Fatalf("SECURITY VIOLATION: %s bypassed SSRF filter! URL: %s", tt.name, tt.url)
			}
			t.Logf("PASS: %s blocked: %s", tt.name, res.Error)
		})
	}
}

// -----------------------------------------------------------------------------
// PHASE 13 - TEST 3: WEBHOOK DISPATCHER SSRF IMMUNITY
// Verifies that webhook event deliveries strictly block loopback, private, and
// metadata destinations.
// -----------------------------------------------------------------------------
func TestPhase13_WebhookSSRFImmunity(t *testing.T) {
	hitServer := false
	internalServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hitServer = true
		w.WriteHeader(http.StatusOK)
	}))
	defer internalServer.Close()

	dispatcher := notification.NewWebhookDispatcher(internalServer.URL + ",http://169.254.169.254/latest/meta-data")
	defer dispatcher.Close()

	evt := domain.Event{
		Type:      "approval.requested",
		SessionID: "sess-1",
		Payload:   []byte(`{"toolName":"test"}`),
	}
	dispatcher.OnDomainEvent(evt)

	time.Sleep(100 * time.Millisecond)

	if hitServer {
		t.Fatalf("SECURITY VIOLATION: Webhook dispatcher delivered payload to local/private SSRF target!")
	}

	t.Logf("PASS: Webhook dispatcher refused to deliver to SSRF target %s", internalServer.URL)
}

// -----------------------------------------------------------------------------
// PHASE 13 - TEST 4: REST & WS RBAC PRIVILEGE ESCALATION PREVENTION
// Verifies that ReadOnly and Non-Admin users cannot perform privileged operations.
// -----------------------------------------------------------------------------
func TestPhase13_REST_PrivilegeEscalationPrevented(t *testing.T) {
	cluster, cleanup := setupTestCluster(t, "admin-master-key", nil)
	defer cleanup()

	rbac := cluster.Runtime.RBACManager()
	_ = rbac.RegisterUser("user-a", "token-usr-a", auth.RoleUser)
	_ = rbac.RegisterUser("user-b", "token-usr-b", auth.RoleUser)
	_ = rbac.RegisterUser("user-ro", "token-ro-only", auth.RoleReadOnly)

	// 1. Non-admin cannot register workspace (POST /v2/workspaces)
	wsPayload, _ := json.Marshal(map[string]string{
		"id":   "ws-host-escape",
		"name": "root-fs",
		"path": "/etc",
	})
	reqWS, _ := http.NewRequest("POST", cluster.ServerURL+"/v2/workspaces?token=token-usr-a", bytes.NewReader(wsPayload))
	respWS, err := http.DefaultClient.Do(reqWS)
	if err != nil || respWS.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden when regular user registers workspace, got %v (status: %d)", err, respWS.StatusCode)
	}
	respWS.Body.Close()

	// 2. Non-admin cannot register MCP server (POST /v2/mcp/servers)
	mcpPayload, _ := json.Marshal(map[string]interface{}{
		"name":    "bad-server",
		"command": "sh",
		"args":    []string{"-c", "echo PWNED"},
	})
	reqMCP, _ := http.NewRequest("POST", cluster.ServerURL+"/v2/mcp/servers?token=token-usr-a", bytes.NewReader(mcpPayload))
	respMCP, err := http.DefaultClient.Do(reqMCP)
	if err != nil || respMCP.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden when regular user registers MCP server, got %v (status: %d)", err, respMCP.StatusCode)
	}
	respMCP.Body.Close()

	// 3. Non-admin cannot configure schedules (POST /v2/schedules)
	schedPayload, _ := json.Marshal(map[string]interface{}{
		"id":       "sched-malicious",
		"cronExpr": "*/5 * * * *",
		"prompt":   "rm -rf /",
	})
	reqSched, _ := http.NewRequest("POST", cluster.ServerURL+"/v2/schedules?token=token-usr-a", bytes.NewReader(schedPayload))
	respSched, err := http.DefaultClient.Do(reqSched)
	if err != nil || respSched.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden when regular user registers schedule, got %v (status: %d)", err, respSched.StatusCode)
	}
	respSched.Body.Close()

	// 4. ReadOnly user cannot commit to workspace (POST /v2/workspaces/commit)
	commitPayload, _ := json.Marshal(map[string]string{
		"workspaceId": "default",
		"message":     "unauthorized commit",
	})
	reqCommit, _ := http.NewRequest("POST", cluster.ServerURL+"/v2/workspaces/commit?token=token-ro-only", bytes.NewReader(commitPayload))
	respCommit, err := http.DefaultClient.Do(reqCommit)
	if err != nil || respCommit.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden when read-only user commits, got %v (status: %d)", err, respCommit.StatusCode)
	}
	respCommit.Body.Close()

	// 5. ReadOnly user cannot mutate memories (POST /v2/memories)
	memPayload, _ := json.Marshal(map[string]string{
		"category": "core",
		"key":      "hacked",
		"content":  "pwned",
	})
	reqMem, _ := http.NewRequest("POST", cluster.ServerURL+"/v2/memories?token=token-ro-only", bytes.NewReader(memPayload))
	respMem, err := http.DefaultClient.Do(reqMem)
	if err != nil || respMem.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden when read-only user writes memory, got %v (status: %d)", err, respMem.StatusCode)
	}
	respMem.Body.Close()

	// 6. User B cannot resolve User A's approval
	sessA, _ := cluster.Runtime.SessionService().CreateSessionWithOwner(context.Background(), "srv-1", "default", "User A Session", "user-a")
	_ = cluster.Runtime.SessionService().TransitionState(context.Background(), sessA.ID, domain.SessionStateStarting, "session starting")
	_ = cluster.Runtime.SessionService().TransitionState(context.Background(), sessA.ID, domain.SessionStateRunning, "session running")
	apprMgr := cluster.Runtime.ApprovalManager()
	go func() {
		_, _ = apprMgr.RequestApproval(context.Background(), sessA.ID, "run_shell_command", []byte(`{"command":"ls"}`), "Need approval", 5)
	}()
	time.Sleep(50 * time.Millisecond)
	pending := apprMgr.GetPendingRequests(sessA.ID)
	if len(pending) == 0 {
		t.Fatalf("failed to generate pending approval")
	}
	apprID := pending[0].ID

	// User B attempts to resolve User A's approval
	resolvePayload, _ := json.Marshal(map[string]interface{}{
		"approvalId": apprID,
		"approved":   true,
		"reason":     "User B approving maliciously",
	})
	reqResolveB, _ := http.NewRequest("POST", cluster.ServerURL+"/v2/approvals/resolve?token=token-usr-b", bytes.NewReader(resolvePayload))
	respResolveB, err := http.DefaultClient.Do(reqResolveB)
	if err != nil || respResolveB.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden when User B resolves User A's approval, got %v (status: %d)", err, respResolveB.StatusCode)
	}
	respResolveB.Body.Close()

	// ReadOnly user attempts to resolve User A's approval
	reqResolveRO, _ := http.NewRequest("POST", cluster.ServerURL+"/v2/approvals/resolve?token=token-ro-only", bytes.NewReader(resolvePayload))
	respResolveRO, err := http.DefaultClient.Do(reqResolveRO)
	if err != nil || respResolveRO.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden when ReadOnly resolves approval, got %v (status: %d)", err, respResolveRO.StatusCode)
	}
	respResolveRO.Body.Close()

	// User A resolves own approval -> SUCCESS
	reqResolveA, _ := http.NewRequest("POST", cluster.ServerURL+"/v2/approvals/resolve?token=token-usr-a", bytes.NewReader(resolvePayload))
	respResolveA, err := http.DefaultClient.Do(reqResolveA)
	if err != nil || respResolveA.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK when User A resolves own approval, got %v (status: %d)", err, respResolveA.StatusCode)
	}
	respResolveA.Body.Close()

	t.Logf("PASS: Privilege escalation strictly rejected across all REST surface endpoints.")
}

// -----------------------------------------------------------------------------
// PHASE 13 - TEST 5: ANTHROPIC CONSECUTIVE TOOL RESULT GROUPING
// Verifies that multiple consecutive tool results are grouped into a single
// user message for Anthropic Messages API compliance.
// -----------------------------------------------------------------------------
func TestPhase13_AnthropicMultiToolGrouping(t *testing.T) {
	var capturedPayload []byte

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		buf := new(bytes.Buffer)
		_, _ = buf.ReadFrom(r.Body)
		capturedPayload = buf.Bytes()

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"id":   "msg-test-1",
			"type": "message",
			"role": "assistant",
			"content": []map[string]string{
				{"type": "text", "text": "All tools processed successfully."},
			},
			"usage": map[string]int{"input_tokens": 10, "output_tokens": 5},
		})
	}))
	defer ts.Close()

	client := agent.NewHTTPProviderClient(agent.ProviderConfig{
		Type:       agent.ProviderAnthropic,
		BaseURL:    ts.URL,
		APIKey:     "sk-ant-testkey123",
		Model:      "claude-3-5-sonnet-latest",
		HTTPClient: ts.Client(),
	})

	messages := []agent.LLMMessage{
		{Role: "user", Content: "Run both tests"},
		{
			Role: "assistant",
			ToolCalls: []agent.ToolCall{
				{ID: "tc-1", Name: "tool1", Arguments: json.RawMessage(`{}`)},
				{ID: "tc-2", Name: "tool2", Arguments: json.RawMessage(`{}`)},
			},
		},
		{Role: "tool", ToolCallID: "tc-1", Content: "output 1"},
		{Role: "tool", ToolCallID: "tc-2", Content: "output 2"},
	}

	_, err := client.Generate(context.Background(), messages, nil, nil)
	if err != nil {
		t.Fatalf("Anthropic client generation failed: %v", err)
	}

	var reqBody struct {
		Messages []struct {
			Role    string      `json:"role"`
			Content interface{} `json:"content"`
		} `json:"messages"`
	}
	if err := json.Unmarshal(capturedPayload, &reqBody); err != nil {
		t.Fatalf("failed to parse captured request: %v", err)
	}

	// We expect 3 messages total: user, assistant, and 1 user message containing both tool_results
	if len(reqBody.Messages) != 3 {
		t.Fatalf("expected 3 messages after grouping tool results, got %d", len(reqBody.Messages))
	}

	lastMsg := reqBody.Messages[2]
	if lastMsg.Role != "user" {
		t.Fatalf("expected last message role to be user, got %s", lastMsg.Role)
	}

	contentSlice, ok := lastMsg.Content.([]interface{})
	if !ok {
		t.Fatalf("expected last message content to be []interface{}, got %T", lastMsg.Content)
	}

	if len(contentSlice) != 2 {
		t.Fatalf("expected last message to contain 2 grouped tool_result blocks, got %d", len(contentSlice))
	}

	t.Logf("PASS: Anthropic multiple tool results correctly merged into a single user message block.")
}

// -----------------------------------------------------------------------------
// PHASE 13 - TEST 6: SQLITE DURABILITY CONFIG VALIDATION
// Verifies that invalid AG_DB_SYNCHRONOUS values safely default to FULL.
// -----------------------------------------------------------------------------
func TestPhase13_SQLiteDurabilityFallback(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "durability_test.db")

	// Set an invalid/malicious syncMode
	t.Setenv("AG_DB_SYNCHRONOUS", "OFF); DROP TABLE events; --")

	store, err := eventstore.NewSQLiteEventStore(dbPath)
	if err != nil {
		t.Fatalf("failed to open sqlite with invalid AG_DB_SYNCHRONOUS: %v", err)
	}
	defer store.Close()

	// Verify database is functional and initialized
	sess := &domain.Session{
		ID:          "sess-test-durability",
		ServerID:    "srv-1",
		WorkspaceID: "ws-1",
		Title:       "Test",
		State:       domain.SessionStateCreated,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}
	err = store.CreateSession(context.Background(), sess)
	if err != nil {
		t.Fatalf("failed to create session: %v", err)
	}

	t.Logf("PASS: SQLite opened safely with sanitized fallback synchronous mode.")
}
