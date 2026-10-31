package gateway

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/antigravity/remote-daemon/pkg/connectrpc"
	"github.com/gorilla/websocket"
)

type slowCancelRPCClient struct {
	fakeRPCClient
	blockFrame chan struct{}
}

func (s *slowCancelRPCClient) SendMessageStream(cascadeID, text string, onFrame func([]byte) error) error {
	return s.slowStream(onFrame)
}

// SendMessageStreamModel : le daemon dispatch par type-assertion sur cette
// variante quand elle existe — le fake doit la surcharger aussi, sinon le
// comportement bloquant est contourné et le test de cancellation devient
// inopérant (outcome=done au lieu de cancelled).
func (s *slowCancelRPCClient) SendMessageStreamModel(cascadeID, text, modelUID string, modelEnum uint64, onFrame func([]byte) error, noTools ...bool) error {
	return s.slowStream(onFrame)
}

func (s *slowCancelRPCClient) SendMessageStreamModelWithMedia(cascadeID, text, modelUID string, modelEnum uint64, media []connectrpc.MediaAttachment, onFrame func([]byte) error, noTools ...bool) error {
	return s.slowStream(onFrame)
}

func (s *slowCancelRPCClient) GetCascadeTrajectory(cascadeID string, verbosity uint64) ([]byte, error) {
	return s.fakeRPCClient.GetCascadeTrajectory(cascadeID, verbosity)
}

func (s *slowCancelRPCClient) slowStream(onFrame func([]byte) error) error {
	// First frame
	if err := onFrame(pbTextFrame("delta-1")); err != nil {
		return err
	}
	<-s.blockFrame
	// Second frame should fail if cancelled
	if err := onFrame(pbTextFrame("delta-2")); err != nil {
		return err
	}
	return nil
}

func TestCancelGeneration(t *testing.T) {
	rpc := &slowCancelRPCClient{
		blockFrame: make(chan struct{}),
	}
	srv := newTestServer(rpc)
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"
	ws, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial error: %v", err)
	}
	defer ws.Close()

	// 1. Start send_prompt
	sendMsg := IncomingMessage{
		Type:      "send_prompt",
		RequestID: "req_p1",
		CascadeID: "casc-cancel",
		Prompt:    "hello long task",
	}
	rawSend, _ := json.Marshal(sendMsg)
	if err := ws.WriteMessage(websocket.TextMessage, rawSend); err != nil {
		t.Fatalf("write send_prompt error: %v", err)
	}

	// Read stream_start
	ws.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, msgBytes, err := ws.ReadMessage()
	if err != nil {
		t.Fatalf("read stream_start error: %v", err)
	}
	var startMsg OutgoingMessage
	_ = json.Unmarshal(msgBytes, &startMsg)
	if startMsg.Type != "stream_start" {
		t.Fatalf("expected stream_start, got %s", startMsg.Type)
	}

	// 2. Send cancel_generation
	cancelMsg := IncomingMessage{
		Type:      "cancel_generation",
		RequestID: "req_c1",
		CascadeID: "casc-cancel",
	}
	rawCancel, _ := json.Marshal(cancelMsg)
	if err := ws.WriteMessage(websocket.TextMessage, rawCancel); err != nil {
		t.Fatalf("write cancel error: %v", err)
	}

	// Wait for the cancellation response before unblocking the RPC stream
	gotCancelledResponse := false
	gotStreamEnd := false
	for {
		ws.SetReadDeadline(time.Now().Add(2 * time.Second))
		_, mBytes, err := ws.ReadMessage()
		if err != nil {
			t.Fatalf("failed to read response to cancel_generation: %v", err)
		}
		var out OutgoingMessage
		json.Unmarshal(mBytes, &out)
		if out.Type == "stream_end" {
			gotStreamEnd = true
			data, _ := out.Data.(map[string]interface{})
			if data != nil && data["outcome"] != "cancelled" {
				t.Errorf("expected outcome cancelled, got %v", data["outcome"])
			}
		}
		if out.Type == "response" && out.RequestID == "req_c1" {
			gotCancelledResponse = true
			break
		}
	}

	// Unblock RPC streamer
	close(rpc.blockFrame)

	if !gotCancelledResponse {
		t.Errorf("expected cancel_generation response")
	}
	if !gotStreamEnd {
		t.Errorf("expected stream_end with outcome=cancelled")
	}
}
