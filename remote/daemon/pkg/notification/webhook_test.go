package notification

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/antigravity/remote-daemon/pkg/domain"
)

func TestWebhookDispatcher_GenericAndFiltering(t *testing.T) {
	var receivedCount int32
	var lastReceivedBody []byte

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&receivedCount, 1)
		b, _ := io.ReadAll(r.Body)
		lastReceivedBody = b
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	d := NewWebhookDispatcher(server.URL)
	d.SetClientForTesting(http.DefaultClient, true)
	defer d.Close()

	// 1. Send ignored event (e.g. transcript.chunk)
	d.OnDomainEvent(domain.Event{
		SessionID: "sess-1",
		Type:      "transcript.chunk",
		Timestamp: time.Now().UnixMilli(),
		Payload:   json.RawMessage(`{"chunk":"hello"}`),
	})

	time.Sleep(50 * time.Millisecond)
	if atomic.LoadInt32(&receivedCount) != 0 {
		t.Fatalf("expected 0 events dispatched for transcript.chunk, got %d", receivedCount)
	}

	// 2. Send approval.requested
	approvalPayload, _ := json.Marshal(map[string]interface{}{
		"id":         "appr-123",
		"toolName":   "execute_command",
		"reason":     "Need to run npm install",
		"parameters": map[string]string{"command": "npm install"},
	})
	d.OnDomainEvent(domain.Event{
		SessionID: "sess-1",
		Type:      "approval.requested",
		Timestamp: time.Now().UnixMilli(),
		Payload:   approvalPayload,
	})

	time.Sleep(100 * time.Millisecond)
	if atomic.LoadInt32(&receivedCount) != 1 {
		t.Fatalf("expected 1 event dispatched, got %d", receivedCount)
	}

	var parsed map[string]interface{}
	if err := json.Unmarshal(lastReceivedBody, &parsed); err != nil {
		t.Fatalf("failed to unmarshal webhook body: %v", err)
	}
	if parsed["event"] != "approval.requested" {
		t.Errorf("expected event 'approval.requested', got %v", parsed["event"])
	}
}

func TestWebhookDispatcher_DiscordAndSlackFormats(t *testing.T) {
	var discordReceived, slackReceived int32

	discordServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&discordReceived, 1)
		var p map[string]interface{}
		_ = json.NewDecoder(r.Body).Decode(&p)
		if embeds, ok := p["embeds"].([]interface{}); !ok || len(embeds) == 0 {
			t.Errorf("expected discord payload to have embeds, got: %v", p)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer discordServer.Close()

	slackServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&slackReceived, 1)
		var p map[string]interface{}
		_ = json.NewDecoder(r.Body).Decode(&p)
		if text, ok := p["text"].(string); !ok || text == "" {
			t.Errorf("expected slack payload to have text, got: %v", p)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer slackServer.Close()

	// Pretend URL includes discord/slack paths
	d := NewWebhookDispatcher(discordServer.URL + "/api/webhooks/123," + slackServer.URL + "/services/hooks.slack.com/123")
	d.SetClientForTesting(http.DefaultClient, true)
	defer d.Close()

	statePayload, _ := json.Marshal(map[string]interface{}{
		"state":  "COMPLETED",
		"reason": "All subagents finished task",
	})
	d.OnDomainEvent(domain.Event{
		SessionID: "sess-discord-test",
		Type:      "session.state_changed",
		Timestamp: time.Now().UnixMilli(),
		Payload:   statePayload,
	})

	time.Sleep(150 * time.Millisecond)
	if atomic.LoadInt32(&discordReceived) != 1 {
		t.Errorf("expected 1 discord webhook call, got %d", discordReceived)
	}
	if atomic.LoadInt32(&slackReceived) != 1 {
		t.Errorf("expected 1 slack webhook call, got %d", slackReceived)
	}
}

func TestWebhookDispatcher_SSRFBlocked(t *testing.T) {
	var receivedCount int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&receivedCount, 1)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	// Dispatcher configured with default SSRF-protected client (allowLocal=false)
	d := NewWebhookDispatcher(server.URL + ",http://169.254.169.254/webhook,http://localhost:8080/hook")
	defer d.Close()

	d.OnDomainEvent(domain.Event{
		SessionID: "sess-ssrf-test",
		Type:      "session.state_changed",
		Timestamp: time.Now().UnixMilli(),
		Payload:   json.RawMessage(`{"state":"COMPLETED","reason":"testing"}`),
	})

	time.Sleep(100 * time.Millisecond)
	if atomic.LoadInt32(&receivedCount) != 0 {
		t.Fatalf("SECURITY VIOLATION: Webhook dispatched request to loopback server! count=%d", receivedCount)
	}
}
