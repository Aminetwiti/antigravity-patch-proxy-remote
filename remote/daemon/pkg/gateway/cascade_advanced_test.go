package gateway

import (
	"strings"
	"testing"
)

func TestCascadeAdvancedRPCs(t *testing.T) {
	backend := &fakeRPCClient{}
	srv := newTestServer(backend)
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"
	client := dialWS(t, wsURL)
	defer client.conn.Close()

	// 1. Test get_revert_preview
	client.sendRaw(t, `{"type":"get_revert_preview","requestId":"r_prev","cascadeId":"casc-1","stepIndex":2}`)
	resp1 := client.recv(t)
	if resp1["requestId"] != "r_prev" {
		t.Fatalf("expected requestId r_prev, got %v", resp1)
	}

	// 2. Test revert_to_step
	client.sendRaw(t, `{"type":"revert_to_step","requestId":"r_rev","cascadeId":"casc-1","stepIndex":2}`)
	// Should broadcast cascade_reverted and reply with response
	var gotRevertedBroadcast bool
	for i := 0; i < 2; i++ {
		msg := client.recv(t)
		if msg["type"] == "cascade_reverted" {
			gotRevertedBroadcast = true
		} else if msg["type"] == "response" && msg["requestId"] == "r_rev" {
			// Response received
		}
	}
	if !gotRevertedBroadcast {
		t.Fatalf("expected cascade_reverted broadcast")
	}

	// 3. Test send_steps_to_background
	client.sendRaw(t, `{"type":"send_steps_to_background","requestId":"r_bg","conversationId":"casc-1","stepIndices":[1,2]}`)
	resp3 := client.recv(t)
	if resp3["requestId"] != "r_bg" {
		t.Fatalf("expected requestId r_bg, got %v", resp3)
	}

	// 4. Test skip_browser_subagent
	client.sendRaw(t, `{"type":"skip_browser_subagent","requestId":"r_skip","cascadeId":"casc-1","stepIndex":3}`)
	resp4 := client.recv(t)
	if resp4["requestId"] != "r_skip" {
		t.Fatalf("expected requestId r_skip, got %v", resp4)
	}

	// 5. Test get_quota_summary
	client.sendRaw(t, `{"type":"get_quota_summary","requestId":"r_quota"}`)
	resp5 := client.recv(t)
	if resp5["requestId"] != "r_quota" {
		t.Fatalf("expected requestId r_quota, got %v", resp5)
	}
}
