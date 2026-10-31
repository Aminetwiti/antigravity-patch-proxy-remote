package gateway

import (
	"strings"
	"testing"

	"github.com/antigravity/remote-daemon/pkg/connectrpc"
)

// TestWebSocketRPCsCoverage teste l'ensemble des handlers RPC WebSocket auparavant
// orphelins (Colosseum, Diagnostics, LSP, MCP OAuth, RAG, Session active, NoTools).
func TestWebSocketRPCsCoverage(t *testing.T) {
	backend := &fakeRPCClient{}
	srv, gw := newTestServerWithGW(backend)
	defer srv.Close()
	_ = gw

	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	// 1. Colosseum: start_battle_mode
	client.sendJSON(t, map[string]interface{}{
		"type":          "start_battle_mode",
		"requestId":     "req-bat-1",
		"workspacePath": "C:/repo",
		"prompt":        "implement sort",
		"modelUIDA":     "m1",
		"modelEnumA":    1,
		"modelUIDB":     "m2",
		"modelEnumB":    2,
	})
	resp := client.recv(t)
	if resp["requestId"] != "req-bat-1" || resp["type"] != "response" {
		t.Fatalf("start_battle_mode failed: %v", resp)
	}

	// 2. Colosseum: get_battle_diff
	client.sendJSON(t, map[string]interface{}{
		"type":          "get_battle_diff",
		"requestId":     "req-bat-2",
		"workspacePath": "C:/repo",
	})
	resp = client.recv(t)
	if resp["requestId"] != "req-bat-2" || resp["type"] != "response" {
		t.Fatalf("get_battle_diff failed: %v", resp)
	}

	// 3. Colosseum: eliminate_battle_arm (succès + validation)
	client.sendJSON(t, map[string]interface{}{
		"type":      "eliminate_battle_arm",
		"requestId": "req-bat-3-err",
	})
	resp = client.recv(t)
	if resp["error"] == nil {
		t.Fatalf("eliminate_battle_arm sans armId aurait dû échouer: %v", resp)
	}

	client.sendJSON(t, map[string]interface{}{
		"type":      "eliminate_battle_arm",
		"requestId": "req-bat-3",
		"armId":     "arm_a",
	})
	resp = client.recv(t)
	if resp["requestId"] != "req-bat-3" || resp["type"] != "response" {
		t.Fatalf("eliminate_battle_arm failed: %v", resp)
	}

	// 4. Colosseum: end_battle_mode (succès + validation)
	client.sendJSON(t, map[string]interface{}{
		"type":      "end_battle_mode",
		"requestId": "req-bat-4-err",
	})
	resp = client.recv(t)
	if resp["error"] == nil {
		t.Fatalf("end_battle_mode sans winningArmId aurait dû échouer: %v", resp)
	}

	client.sendJSON(t, map[string]interface{}{
		"type":          "end_battle_mode",
		"requestId":     "req-bat-4",
		"winningArmId":  "arm_b",
		"mergeStrategy": 1,
	})
	resp = client.recv(t)
	if resp["requestId"] != "req-bat-4" || resp["type"] != "response" {
		t.Fatalf("end_battle_mode failed: %v", resp)
	}

	// 5. Diagnostics: dump_flight_recorder
	client.sendJSON(t, map[string]interface{}{
		"type":      "dump_flight_recorder",
		"requestId": "req-diag-1",
	})
	resp = client.recv(t)
	if resp["requestId"] != "req-diag-1" || resp["type"] != "response" {
		t.Fatalf("dump_flight_recorder failed: %v", resp)
	}

	// 6. MCP OAuth: refresh, complete, disconnect
	client.sendJSON(t, map[string]interface{}{
		"type":      "refresh_mcp_servers",
		"requestId": "req-mcp-1",
	})
	resp = client.recv(t)
	if resp["requestId"] != "req-mcp-1" {
		t.Fatalf("refresh_mcp_servers failed: %v", resp)
	}

	client.sendJSON(t, map[string]interface{}{
		"type":      "complete_mcp_oauth",
		"requestId": "req-mcp-2",
		"serverId":  "srv-test",
		"authCode":  "code-123",
	})
	resp = client.recv(t)
	if resp["requestId"] != "req-mcp-2" {
		t.Fatalf("complete_mcp_oauth failed: %v", resp)
	}

	client.sendJSON(t, map[string]interface{}{
		"type":      "disconnect_mcp_oauth",
		"requestId": "req-mcp-3",
		"serverId":  "srv-test",
	})
	resp = client.recv(t)
	if resp["requestId"] != "req-mcp-3" {
		t.Fatalf("disconnect_mcp_oauth failed: %v", resp)
	}

	// 7. RAG: hybrid_search
	client.sendJSON(t, map[string]interface{}{
		"type":          "rag.hybrid_search",
		"requestId":     "req-rag-1",
		"query":         "authentication handler",
		"workspacePath": "C:/repo",
		"limit":         10,
	})
	resp = client.recv(t)
	if resp["requestId"] != "req-rag-1" {
		t.Fatalf("hybrid_search failed: %v", resp)
	}

	// 8. LSP: get_definition & get_code_validation
	client.sendJSON(t, map[string]interface{}{
		"type":      "get_definition",
		"requestId": "req-lsp-1",
		"filePath":  "main.go",
		"line":      10,
		"column":    5,
	})
	resp = client.recv(t)
	if resp["requestId"] != "req-lsp-1" {
		t.Fatalf("get_definition failed: %v", resp)
	}

	client.sendJSON(t, map[string]interface{}{
		"type":      "get_code_validation",
		"requestId": "req-lsp-2",
		"filePath":  "main.go",
	})
	resp = client.recv(t)
	if resp["requestId"] != "req-lsp-2" {
		t.Fatalf("get_code_validation failed: %v", resp)
	}

	// 9. Session: get_active_session
	gw.mu.Lock()
	if gw.jetboxSummaries == nil {
		gw.jetboxSummaries = make(map[string]connectrpc.JetboxSummary)
	}
	gw.focusedCascadeID = "casc-cov-1"
	gw.jetboxSummaries["casc-cov-1"] = connectrpc.JetboxSummary{
		CascadeID: "casc-cov-1",
		Title:     "Test Session",
		Workspace: "C:/repo",
		Status:    "active",
	}
	gw.mu.Unlock()
	client.sendJSON(t, map[string]interface{}{
		"type":      "get_active_session",
		"requestId": "req-sess-1",
	})
	resp = client.recv(t)
	if resp["requestId"] != "req-sess-1" {
		t.Fatalf("get_active_session failed: %v", resp)
	}

	// 10. no_tools mode toggle
	client.sendJSON(t, map[string]interface{}{
		"type":      "set_no_tools",
		"requestId": "req-nt-1",
		"enabled":   true,
	})
	resp = client.recv(t)
	if resp["requestId"] != "req-nt-1" {
		t.Fatalf("set_no_tools failed: %v", resp)
	}
}
