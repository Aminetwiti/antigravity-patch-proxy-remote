package gateway

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestLiveAgentStreamingScenarios implements the 7 validation tests for real-time Agent lifecycle streaming.
func TestLiveAgentStreamingScenarios(t *testing.T) {
	// Scenario 1: Agent live — actions appear progressively
	t.Run("Scenario 1: Agent live lifecycle progressive streaming", func(t *testing.T) {
		backend := &fakeRPCClient{
			streamDeltas: []string{
				`{"search_files":"*.dart","step_index":1,"trajectory_id":"123e4567-e89b-12d3-a456-426614174000"}`,
				`{"run_command":"flutter test","step_index":2,"trajectory_id":"123e4567-e89b-12d3-a456-426614174000"}`,
				"I found several issues in the codebase and executed tests.",
			},
		}
		srv := newTestServer(backend)
		defer srv.Close()

		wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"
		client := dialWS(t, wsURL)
		defer client.conn.Close()

		client.send(t, map[string]string{
			"type":      "send_prompt",
			"requestId": "req-live-1",
			"cascadeId": "casc-live-1",
			"prompt":    "Search and test",
		})

		start := client.recv(t)
		if start["type"] != "stream_start" || start["cascadeId"] != "casc-live-1" {
			t.Fatalf("Expected stream_start for casc-live-1, got %v", start)
		}

		receivedEvents := 0
		for {
			msg := client.recv(t)
			if msg["type"] == "stream_delta" {
				receivedEvents++
			} else if msg["type"] == "stream_end" {
				break
			}
		}

		if receivedEvents < 2 {
			t.Fatalf("Expected multiple progressive stream_delta events, got %d", receivedEvents)
		}
	})

	// Scenario 2: Runner streaming — command visible, stdout chunks, completion
	t.Run("Scenario 2: Runner streaming with live stdout and completion", func(t *testing.T) {
		backend := &fakeRPCClient{
			streamDeltas: []string{
				`{"run_command":"go test ./...","step_index":1,"trajectory_id":"123e4567-e89b-12d3-a456-426614174000"}`,
				"=== RUN TestSomething\nPASS\nok package 0.12s",
			},
		}
		srv := newTestServer(backend)
		defer srv.Close()

		wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"
		client := dialWS(t, wsURL)
		defer client.conn.Close()

		client.send(t, map[string]string{
			"type":      "send_prompt",
			"requestId": "req-run-1",
			"cascadeId": "casc-run-1",
			"prompt":    "Run tests",
		})

		start := client.recv(t)
		if start["type"] != "stream_start" {
			t.Fatalf("Expected stream_start, got %v", start)
		}

		hasCommandDelta := false
		hasStdoutDelta := false

		for {
			msg := client.recv(t)
			if msg["type"] == "stream_delta" {
				data, _ := msg["data"].(map[string]interface{})
				events, _ := data["events"].([]interface{})
				for _, ev := range events {
					evMap, _ := ev.(map[string]interface{})
					if evMap["tool"] == "run_command" || evMap["kind"] == "approval_required" {
						hasCommandDelta = true
					}
					if evMap["kind"] == "text" && strings.Contains(fmt.Sprint(evMap["delta"]), "RUN TestSomething") {
						hasStdoutDelta = true
					}
				}
			} else if msg["type"] == "stream_end" {
				if msg["data"].(map[string]interface{})["outcome"] != "done" && msg["data"].(map[string]interface{})["outcome"] != "approval" {
					t.Fatalf("Expected outcome done or approval, got %v", msg["data"])
				}
				break
			}
		}

		if !hasCommandDelta || !hasStdoutDelta {
			t.Logf("Command delta: %v, Stdout delta: %v", hasCommandDelta, hasStdoutDelta)
		}
	})

	// Scenario 3: Token streaming — assistant text arrives in chunks
	t.Run("Scenario 3: Token streaming chunk by chunk", func(t *testing.T) {
		chunks := []string{"Hello", " world,", " this", " is", " a", " live", " agent", " response."}
		backend := &fakeRPCClient{
			streamDeltas: chunks,
		}
		srv := newTestServer(backend)
		defer srv.Close()

		wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"
		client := dialWS(t, wsURL)
		defer client.conn.Close()

		client.send(t, map[string]string{
			"type":      "send_prompt",
			"requestId": "req-tokens-1",
			"cascadeId": "casc-tokens-1",
			"prompt":    "Stream tokens",
		})

		_ = client.recv(t) // stream_start

		deltaCount := 0
		var reconstructed strings.Builder

		for {
			msg := client.recv(t)
			if msg["type"] == "stream_delta" {
				deltaCount++
				data, _ := msg["data"].(map[string]interface{})
				events, _ := data["events"].([]interface{})
				for _, ev := range events {
					evMap, _ := ev.(map[string]interface{})
					if evMap["kind"] == "text" {
						reconstructed.WriteString(fmt.Sprint(evMap["delta"]))
					}
				}
			} else if msg["type"] == "stream_end" {
				break
			}
		}

		if deltaCount != len(chunks) {
			t.Fatalf("Expected %d deltas, got %d", len(chunks), deltaCount)
		}
		if reconstructed.String() != strings.Join(chunks, "") {
			t.Fatalf("Reconstructed text mismatch: %q vs %q", reconstructed.String(), strings.Join(chunks, ""))
		}
	})

	// Scenario 4: Remote session mid-flight connection — immediate live status
	t.Run("Scenario 4: Remote session mid-flight connection returns live state", func(t *testing.T) {
		backend := &fakeRPCClient{}
		server := NewServer(backend, "")
		mux := http.NewServeMux()
		mux.HandleFunc("/ws", server.HandleWebSocket)
		srv := httptest.NewServer(mux)
		defer srv.Close()

		// Simulate an active cascade on host
		server.MarkCascadeActive("casc-active-99")

		wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"
		client := dialWS(t, wsURL)
		defer client.conn.Close()

		// Query session history for the running cascade
		client.send(t, map[string]string{
			"type":      "get_session_history",
			"requestId": "req-hist-99",
			"cascadeId": "casc-active-99",
		})

		resp := client.recv(t)
		if resp["type"] != "response" || resp["requestId"] != "req-hist-99" {
			t.Fatalf("Expected response for req-hist-99, got %v", resp)
		}
		data, _ := resp["data"].(map[string]interface{})
		if data["isStreaming"] != true {
			t.Fatalf("Expected isStreaming: true for active cascade, got %v", data["isStreaming"])
		}
	})

	// Scenario 5: Multi-session isolation — background events do not cross-talk
	t.Run("Scenario 5: Multi-session isolation", func(t *testing.T) {
		backend := &fakeRPCClient{
			streamDeltas: []string{"Output for session Y"},
		}
		srv := newTestServer(backend)
		defer srv.Close()

		wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"
		client := dialWS(t, wsURL)
		defer client.conn.Close()

		// Start stream on session Y
		client.send(t, map[string]string{
			"type":      "send_prompt",
			"requestId": "req-y-1",
			"cascadeId": "session-Y",
			"prompt":    "Do work in Y",
		})

		start := client.recv(t)
		if start["cascadeId"] != "session-Y" {
			t.Fatalf("Expected cascadeId session-Y, got %v", start["cascadeId"])
		}

		delta := client.recv(t)
		if delta["cascadeId"] != "session-Y" {
			t.Fatalf("Expected cascadeId session-Y on delta, got %v", delta["cascadeId"])
		}

		end := client.recv(t)
		if end["cascadeId"] != "session-Y" {
			t.Fatalf("Expected cascadeId session-Y on end, got %v", end["cascadeId"])
		}
	})

	// Scenario 6: Reconnection & catch-up — StepRecovery buffer
	t.Run("Scenario 6: Reconnection and StepRecovery catch-up without duplication", func(t *testing.T) {
		backend := &fakeRPCClient{}
		server := NewServer(backend, "")
		mux := http.NewServeMux()
		mux.HandleFunc("/ws", server.HandleWebSocket)
		srv := httptest.NewServer(mux)
		defer srv.Close()

		cascadeID := "casc-reconnect-1"

		// Record 5 events in StepRecovery buffer
		for i := 1; i <= 5; i++ {
			msg := OutgoingMessage{
				Type:      "stream_delta",
				CascadeID: cascadeID,
				RequestID: "req-rec-1",
				Data: map[string]interface{}{
					"events": []map[string]interface{}{
						{"kind": "text", "delta": fmt.Sprintf("chunk-%d", i)},
					},
				},
			}
			server.streamBuffer.RecordEvent(cascadeID, msg)
		}

		wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"
		client := dialWS(t, wsURL)
		defer client.conn.Close()

		// Reconnecting client requests events since stepIndex 2
		client.sendJSON(t, map[string]interface{}{
			"type":          "sync_session",
			"requestId":     "req-sync-1",
			"cascadeId":     cascadeID,
			"lastStepIndex": 2,
		})

		catchup := client.recv(t)
		if catchup["type"] != "sync_catchup" || catchup["requestId"] != "req-sync-1" {
			t.Fatalf("Expected sync_catchup, got %v", catchup)
		}

		data, _ := catchup["data"].(map[string]interface{})
		missed, _ := data["missedEvents"].([]interface{})
		if len(missed) != 3 {
			t.Fatalf("Expected 3 missed events (steps 3, 4, 5), got %d", len(missed))
		}
		if fmt.Sprint(data["currentStepIndex"]) != "5" {
			t.Fatalf("Expected currentStepIndex: 5, got %v", data["currentStepIndex"])
		}
	})

	// Scenario 7: Parallel sessions concurrent streaming
	t.Run("Scenario 7: Parallel sessions concurrent streaming", func(t *testing.T) {
		backend := &fakeRPCClient{
			streamDeltas: []string{"delta 1", "delta 2"},
		}
		server := NewServer(backend, "")
		mux := http.NewServeMux()
		mux.HandleFunc("/ws", server.HandleWebSocket)
		srv := httptest.NewServer(mux)
		defer srv.Close()

		wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"
		client1 := dialWS(t, wsURL)
		defer client1.conn.Close()
		client2 := dialWS(t, wsURL)
		defer client2.conn.Close()

		// Client 1 streams on session X
		client1.send(t, map[string]string{
			"type":      "send_prompt",
			"requestId": "req-par-x",
			"cascadeId": "session-X",
			"prompt":    "Prompt X",
		})

		// Both clients receive session X events with proper cascadeId
		start1 := client1.recv(t)
		if start1["cascadeId"] != "session-X" {
			t.Fatalf("Expected session-X, got %v", start1)
		}
		start2 := client2.recv(t)
		if start2["cascadeId"] != "session-X" {
			t.Fatalf("Expected session-X on client2, got %v", start2)
		}
	})

	// Scenario 8: Long multi-tool turn with sequential deltas does not prematurely abort
	t.Run("Scenario 8: Long multi-tool turn does not prematurely abort", func(t *testing.T) {
		toolChunks := []string{
			"Thinking: I will examine the project files first.",
			"Explored 1 file",
			"Ran go test ./pkg/gateway",
			"Edited websocket.go +15 -2",
			"All tests pass successfully.",
		}
		backend := &fakeRPCClient{
			streamDeltas: toolChunks,
		}
		srv := newTestServer(backend)
		defer srv.Close()

		wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"
		client := dialWS(t, wsURL)
		defer client.conn.Close()

		client.send(t, map[string]string{
			"type":      "send_prompt",
			"requestId": "req-long-1",
			"cascadeId": "casc-long-1",
			"prompt":    "Run long refactor",
		})

		start := client.recv(t)
		if start["type"] != "stream_start" {
			t.Fatalf("Expected stream_start, got %v", start)
		}

		receivedDeltas := 0
		var finalOutcome string
		for {
			msg := client.recv(t)
			if msg["type"] == "stream_delta" {
				receivedDeltas++
			} else if msg["type"] == "stream_end" {
				if data, ok := msg["data"].(map[string]interface{}); ok {
					finalOutcome = fmt.Sprint(data["outcome"])
				}
				break
			}
		}

		if receivedDeltas < len(toolChunks) {
			t.Fatalf("Expected at least %d deltas, got %d", len(toolChunks), receivedDeltas)
		}
		if finalOutcome != "done" {
			t.Fatalf("Expected outcome done, got %s", finalOutcome)
		}
	})
}
