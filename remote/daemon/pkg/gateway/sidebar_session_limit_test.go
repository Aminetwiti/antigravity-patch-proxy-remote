package gateway

import (
	"fmt"
	"strings"
	"testing"

	"github.com/antigravity/remote-daemon/pkg/connectrpc"
	"github.com/gorilla/websocket"
)

func TestSessionsOut_SidebarLimitVsAllSessions(t *testing.T) {
	srv := &Server{
		activeCascades: make(map[string]bool),
	}

	// Build raw gRPC frame containing 10 sessions
	var combinedInner []byte
	var firstUUID string
	for i := 1; i <= 10; i++ {
		uuid := fmt.Sprintf("11111111-2222-3333-4444-5555555555%02d", i)
		if i == 1 {
			firstUUID = uuid
		}
		inner := append([]byte{0x0a, 0x24}, []byte(uuid)...) // field 1: cascade_id
		title := fmt.Sprintf("Session Item %02d", i)
		inner = append(inner, 0x12, byte(len(title)))
		inner = append(inner, []byte(title)...)
		inner = append(inner, 0xb0, 0x01, 0x04) // field 22: varint 4 (READY)
		outer := append([]byte{0x0a, byte(len(inner))}, inner...)
		combinedInner = append(combinedInner, outer...)
	}
	raw := connectrpc.Frame(combinedInner)

	// 1. Sidebar limit: sessionsOutWithLimit(raw, 6)
	limitedOut := srv.sessionsOutWithLimit(raw, 6).(map[string]interface{})
	limitedSessions := limitedOut["sessions"].([]map[string]interface{})

	if len(limitedSessions) > 6 {
		t.Fatalf("expected at most 6 sessions in sidebar, got %d", len(limitedSessions))
	}

	// 2. All sessions (Conversation History): allSessionsOut(raw)
	allOut := srv.allSessionsOut(raw).(map[string]interface{})
	allSessions := allOut["sessions"].([]map[string]interface{})

	if len(allSessions) != 10 {
		t.Fatalf("expected all 10 sessions in conversation history, got %d", len(allSessions))
	}
	_ = firstUUID
}

func TestWebSocket_ListAllSessionsRPC(t *testing.T) {
	ts, _ := newTestServerWithGW(&fakeRPCClient{})
	defer ts.Close()

	u := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws"
	conn, _, err := websocket.DefaultDialer.Dial(u, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	// Send list_all_sessions
	req := map[string]string{
		"type":      "list_all_sessions",
		"requestId": "req-all-1",
	}
	if err := conn.WriteJSON(req); err != nil {
		t.Fatalf("write: %v", err)
	}

	var resp struct {
		Type      string                 `json:"type"`
		RequestID string                 `json:"requestId"`
		Data      map[string]interface{} `json:"data"`
	}
	if err := conn.ReadJSON(&resp); err != nil {
		t.Fatalf("read: %v", err)
	}

	if resp.RequestID != "req-all-1" {
		t.Fatalf("expected requestId req-all-1, got %s", resp.RequestID)
	}
	if resp.Data == nil || resp.Data["projects"] == nil {
		t.Fatalf("expected valid data payload with projects")
	}
}
