package cdp

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

func TestCDPClient_CaptureScreenshot(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()

		for {
			var req RPCRequest
			if err := conn.ReadJSON(&req); err != nil {
				return
			}

			if req.Method == "Page.captureScreenshot" {
				resp := RPCResponse{
					ID:     req.ID,
					Result: []byte(`{"data":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="}`),
				}
				_ = conn.WriteJSON(resp)
			}
		}
	}))
	defer s.Close()

	wsURL := "ws" + strings.TrimPrefix(s.URL, "http")

	client, err := Dial(wsURL, 1*time.Second)
	if err != nil {
		t.Fatalf("Dial failed: %v", err)
	}
	defer client.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	data, err := client.CaptureScreenshot(ctx, "png", 0)
	if err != nil {
		t.Fatalf("CaptureScreenshot failed: %v", err)
	}

	if !strings.HasPrefix(data, "iVBOR") {
		t.Errorf("CaptureScreenshot returned unexpected data prefix: %s", data)
	}
}

func TestCDPClient_ErrorHandling(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()

		var req RPCRequest
		if err := conn.ReadJSON(&req); err != nil {
			return
		}

		resp := RPCResponse{
			ID: req.ID,
			Error: &RPCError{
				Code:    -32601,
				Message: "Method not found",
			},
		}
		_ = conn.WriteJSON(resp)
	}))
	defer s.Close()

	wsURL := "ws" + strings.TrimPrefix(s.URL, "http")

	client, err := Dial(wsURL, 1*time.Second)
	if err != nil {
		t.Fatalf("Dial failed: %v", err)
	}
	defer client.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	_, err = client.Call(ctx, "Invalid.method", nil)
	if err == nil {
		t.Fatalf("Call should have failed with RPCError")
	}

	if !strings.Contains(err.Error(), "Method not found") {
		t.Errorf("unexpected error string: %v", err)
	}
}
