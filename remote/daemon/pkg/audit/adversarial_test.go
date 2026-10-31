package audit_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/antigravity/remote-daemon/pkg/auth"
	"github.com/antigravity/remote-daemon/pkg/domain"
	"github.com/antigravity/remote-daemon/pkg/sandbox"
	"github.com/antigravity/remote-daemon/pkg/server"
	"github.com/antigravity/remote-daemon/pkg/tools"
	"github.com/gorilla/websocket"
)

// -----------------------------------------------------------------------------
// ADVERSARIAL TEST 1: STRICT SANDBOX FAILS CLOSED (BLK-01 REMEDIATION)
// Verifies that when Docker is unavailable and ModeStrict is active,
// execution FAILS CLOSED with ErrSandboxUnavailable rather than escaping to host.
// -----------------------------------------------------------------------------
func TestAdversarial_01_SilentDockerFallbackPrevented(t *testing.T) {
	sb := sandbox.NewDockerSandbox(sandbox.DockerSandboxConfig{
		Image: "nonexistent-image:latest",
		Mode:  sandbox.ModeStrict,
	})

	if !sb.IsAvailable() {
		tmpDir := t.TempDir()
		req := sandbox.ExecutionRequest{
			SessionID:   "sess-adv-1",
			WorkspaceID: "ws-adv-1",
			Directory:   tmpDir,
			CommandLine: "echo ESCAPED_TO_HOST",
		}

		res, err := sb.Execute(context.Background(), req, nil)
		if err == nil {
			t.Fatalf("expected sandbox execution to fail closed, but it succeeded! output: %s", res.Output)
		}

		if !errors.Is(err, sandbox.ErrSandboxUnavailable) && !strings.Contains(err.Error(), "sandbox is unavailable") {
			t.Fatalf("expected ErrSandboxUnavailable, got: %v", err)
		}

		if res != nil && strings.Contains(res.Output, "ESCAPED_TO_HOST") {
			t.Fatalf("SECURITY VIOLATION: command was executed on host system!")
		}

		t.Logf("PASS: ModeStrict failed closed with ErrSandboxUnavailable. Host execution strictly prevented.")
	} else {
		t.Skip("Docker daemon is active on this host; skipping offline fallback test")
	}
}

// -----------------------------------------------------------------------------
// ADVERSARIAL TEST 2: TERMINAL PERSISTENCE ACROSS DISCONNECT (HIGH-01 REMEDIATION)
// Verifies that when a WebSocket client disconnects from /v2/terminal,
// the underlying shell subprocess continues running and reconnecting clients
// receive backlogged output.
// -----------------------------------------------------------------------------
func TestAdversarial_02_TerminalDisconnectPersistsProcess(t *testing.T) {
	cluster, cleanup := setupTestCluster(t, "term-token", nil)
	defer cleanup()

	termHandler := server.NewTerminalHandler(cluster.WsMgr, cluster.AuthToken)
	ts := httptest.NewServer(termHandler)
	defer ts.Close()

	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "?token=" + cluster.AuthToken + "&sessionId=persist-sess-1"

	wsConn1, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("failed to dial terminal websocket: %v", err)
	}

	// Send an input command
	cmdMsg := map[string]string{
		"type": "stdin",
		"data": "echo PERSIST_MARKER\n",
	}
	_ = wsConn1.WriteJSON(cmdMsg)

	// Wait for echo output to appear on conn1
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		_ = wsConn1.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
		var msg struct {
			Type string `json:"type"`
			Data string `json:"data"`
		}
		if err := wsConn1.ReadJSON(&msg); err == nil && strings.Contains(msg.Data, "PERSIST_MARKER") {
			break
		}
	}

	// Disconnect client 1 - subprocess MUST remain alive
	_ = wsConn1.Close()
	time.Sleep(100 * time.Millisecond)

	// Client 2 connects to the SAME terminal session
	wsConn2, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("failed to reconnect to terminal websocket: %v", err)
	}
	defer wsConn2.Close()

	_ = wsConn2.SetReadDeadline(time.Now().Add(2 * time.Second))
	foundMarker := false
	for i := 0; i < 10; i++ {
		var msg struct {
			Type string `json:"type"`
			Data string `json:"data"`
		}
		if err := wsConn2.ReadJSON(&msg); err != nil {
			break
		}
		if strings.Contains(msg.Data, "PERSIST_MARKER") {
			foundMarker = true
			break
		}
	}

	if !foundMarker {
		t.Fatalf("expected to receive PERSIST_MARKER from reconnected terminal backlog")
	}
	t.Logf("PASS: Subprocess survived client disconnect; scrollback replayed to reconnected client.")
}

// -----------------------------------------------------------------------------
// ADVERSARIAL TEST 3: SSRF PROTECTION IN fetch_web_page (BLK-02 REMEDIATION)
// Verifies that FetchWebPageTool strictly blocks access to loopback, private RFC1918,
// and cloud metadata IP ranges.
// -----------------------------------------------------------------------------
func TestAdversarial_03_SSRFBlocked(t *testing.T) {
	internalServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		w.Write([]byte("INTERNAL_METADATA_SECRET: role=admin, private_key=SECRET123"))
	}))
	defer internalServer.Close()

	fetchTool := tools.NewFetchWebPageTool()

	params, _ := json.Marshal(map[string]string{
		"url": internalServer.URL,
	})

	res, err := fetchTool.Execute(context.Background(), "s1", "w1", params, nil)
	if err == nil && res.Success {
		t.Fatalf("SECURITY VIOLATION: SSRF attack succeeded! Output: %s", res.Output)
	}

	if res != nil && strings.Contains(res.Output, "INTERNAL_METADATA_SECRET") {
		t.Fatalf("SECURITY VIOLATION: Internal secret was leaked via SSRF!")
	}

	t.Logf("PASS: SSRF request to %s was correctly blocked: %s", internalServer.URL, res.Error)
}

// -----------------------------------------------------------------------------
// ADVERSARIAL TEST 4: RATE LIMITING ANTI-SPOOFING (HIGH-02 REMEDIATION)
// Verifies that spoofing X-Forwarded-For headers does NOT bypass rate limiting.
// -----------------------------------------------------------------------------
func TestAdversarial_04_RateLimitingAntiSpoofing(t *testing.T) {
	cluster, cleanup := setupTestCluster(t, "rate-token", nil)
	defer cleanup()

	blocked := false
	for i := 1; i <= 150; i++ {
		req, _ := http.NewRequest("GET", cluster.ServerURL+"/health", nil)
		// Attacker attempts to bypass rate limiting by rotating X-Forwarded-For
		req.Header.Set("X-Forwarded-For", fmt.Sprintf("198.51.100.%d", i))

		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("request failed: %v", err)
		}
		if resp.StatusCode == http.StatusTooManyRequests {
			blocked = true
			resp.Body.Close()
			break
		}
		resp.Body.Close()
	}

	if !blocked {
		t.Fatalf("SECURITY VIOLATION: Rate limiter was bypassed using spoofed X-Forwarded-For headers!")
	}

	t.Logf("PASS: Spoofed X-Forwarded-For headers ignored from untrusted peer. Rate limiter enforced.")
}

// -----------------------------------------------------------------------------
// ADVERSARIAL TEST 5: MULTI-USER RBAC & TENANCY (BLK-03 REMEDIATION)
// Verifies that User B cannot list or mutate User A's private sessions.
// -----------------------------------------------------------------------------
func TestAdversarial_05_RBACIsolation(t *testing.T) {
	cluster, cleanup := setupTestCluster(t, "admin-token", nil)
	defer cleanup()

	// Configure RBAC with Admin and two Users
	rbac := auth.NewRBACManager("admin-token")
	_ = rbac.RegisterUser("user-a", "token-user-a", auth.RoleUser)
	_ = rbac.RegisterUser("user-b", "token-user-b", auth.RoleUser)

	handler := server.NewMuxWithRBAC(cluster.Runtime, cluster.WsMgr, rbac)
	ts := httptest.NewServer(handler)
	defer ts.Close()

	// User A creates a private session
	createBody := []byte(`{"title":"User A Confidential Work","workspaceId":"default"}`)
	reqA, _ := http.NewRequest("POST", ts.URL+"/v2/sessions?token=token-user-a", bytes.NewReader(createBody))
	respA, err := http.DefaultClient.Do(reqA)
	if err != nil || respA.StatusCode != http.StatusCreated {
		t.Fatalf("failed creating session for User A: code=%d err=%v", respA.StatusCode, err)
	}
	var sessA domain.Session
	_ = json.NewDecoder(respA.Body).Decode(&sessA)
	respA.Body.Close()

	// User B tries to list sessions
	reqB, _ := http.NewRequest("GET", ts.URL+"/v2/sessions?token=token-user-b", nil)
	respB, err := http.DefaultClient.Do(reqB)
	if err != nil || respB.StatusCode != http.StatusOK {
		t.Fatalf("failed listing sessions for User B: code=%d err=%v", respB.StatusCode, err)
	}
	var listB struct {
		Sessions []domain.Session `json:"sessions"`
	}
	_ = json.NewDecoder(respB.Body).Decode(&listB)
	respB.Body.Close()

	for _, s := range listB.Sessions {
		if s.ID == sessA.ID {
			t.Fatalf("SECURITY VIOLATION: User B was able to see User A's private session %s!", s.ID)
		}
	}

	// User B tries to rollback User A's session -> must be 403 Forbidden
	rollbackReq, _ := http.NewRequest("POST", ts.URL+"/v2/sessions/rollback?sessionId="+sessA.ID+"&token=token-user-b", nil)
	respRB, err := http.DefaultClient.Do(rollbackReq)
	if err != nil {
		t.Fatalf("rollback request failed: %v", err)
	}
	defer respRB.Body.Close()

	if respRB.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden on cross-tenant rollback, got %d", respRB.StatusCode)
	}

	t.Logf("PASS: RBAC properly isolated User A's session from User B for both listing and mutation.")
}

// -----------------------------------------------------------------------------
// ADVERSARIAL TEST 6: SECRET REDACTION IN EXPORT (HIGH-04 REMEDIATION)
// Verifies that session exports redact API keys, bearer tokens, and credentials.
// -----------------------------------------------------------------------------
func TestAdversarial_06_SecretLeakRedactedInSessionExport(t *testing.T) {
	cluster, cleanup := setupTestCluster(t, "token-exp", nil)
	defer cleanup()

	sess, _ := cluster.Runtime.SessionService().CreateSession(context.Background(), "srv-1", "default", "Secret Test")

	canarySecret := "sk-live-CANARY_SECRET_API_KEY_998877"
	toolResult := []byte(fmt.Sprintf(`{"success": true, "output":"Fetched AWS key: %s"}`, canarySecret))
	_, _ = cluster.Store.AppendEvent(context.Background(), sess.ID, "tr-1", "tool.result", toolResult)

	export, err := server.BuildSessionExport(context.Background(), cluster.Store, sess.ID)
	if err != nil {
		t.Fatalf("BuildSessionExport failed: %v", err)
	}

	md := server.FormatSessionMarkdown(export)
	if strings.Contains(md, canarySecret) {
		t.Fatalf("SECURITY VIOLATION: canary secret was not redacted in Markdown export!")
	}

	jsonBytes, _ := json.Marshal(export)
	if strings.Contains(string(jsonBytes), canarySecret) {
		t.Fatalf("SECURITY VIOLATION: canary secret was not redacted in JSON export!")
	}

	t.Logf("PASS: Canary secrets successfully sanitized with [REDACTED_API_KEY].")
}
