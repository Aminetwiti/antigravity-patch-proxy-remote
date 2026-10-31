package gateway

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/gorilla/websocket"

	"github.com/antigravity/remote-daemon/pkg/discovery"
)

// fakeRPCClient est d├®j├á d├®fini dans websocket_test.go (m├¬me package) :
// on r├®utilise ses m├®thodes pour servir list_sessions.

// TestScope_SendPromptBlocked : un device pair├® avec allowedProjects ne peut
// pas envoyer de prompt sur un workspace hors scope (3.3).
func TestScope_SendPromptBlocked(t *testing.T) {
	ts, server := newTestServerWithGW(&fakeRPCClient{})
	defer ts.Close()

	server.SetSessionValidator(func(token string) (discovery.SessionInfo, bool) {
		return discovery.SessionInfo{
			DeviceID:        "phone-scoped",
			Name:            "Pixel",
			AllowedProjects: []string{"file:///C:/proj-a"},
		}, true
	})

	url := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws?token=abc"
	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatalf("Dial: %v", err)
	}
	defer conn.Close()

	// 1) Prompt sur workspace hors scope ÔåÆ erreur explicite, pas de stream.
	msg := fmt.Sprintf(`{"type":"send_prompt","requestId":"r1","cascadeId":"c1","workspaceUri":"file:///C:/proj-b","prompt":"bonjour"}`)
	if err := conn.WriteMessage(websocket.TextMessage, []byte(msg)); err != nil {
		t.Fatalf("Write: %v", err)
	}
	_, b, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	var out map[string]interface{}
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatalf("JSON invalide: %v (%s)", err, string(b))
	}
	if out["type"] != "response" || out["error"] == nil {
		t.Fatalf("Prompt hors scope doit etre refuse, recu: %v", out)
	}
	errStr := strings.ToLower(fmt.Sprint(out["error"]))
	if !strings.Contains(errStr, "autoris") && !strings.Contains(errStr, "non") {
		t.Fatalf("Erreur = %v, attendu refus de scope", out["error"])
	}

	// 2) Prompt sur workspace autoris├® ÔåÆ flux normal.
	msg2 := fmt.Sprintf(`{"type":"send_prompt","requestId":"r2","cascadeId":"c1","workspaceUri":"file:///C:/proj-a","prompt":"bonjour"}`)
	if err := conn.WriteMessage(websocket.TextMessage, []byte(msg2)); err != nil {
		t.Fatalf("Write: %v", err)
	}
	gotStart := false
	for i := 0; i < 5; i++ {
		_, b, err := conn.ReadMessage()
		if err != nil {
			t.Fatalf("Read: %v", err)
		}
		var m map[string]interface{}
		if err := json.Unmarshal(b, &m); err != nil {
			t.Fatalf("JSON invalide: %v (%s)", err, string(b))
		}
		if m["type"] == "stream_start" && m["requestId"] == "r2" {
			gotStart = true
			break
		}
		if m["type"] == "response" && m["requestId"] == "r2" && m["error"] != nil {
			t.Fatalf("Prompt autoris├® refus├®: %v", m["error"])
		}
	}
	if !gotStart {
		t.Fatalf("Prompt autoris├® doit produire stream_start")
	}
}

// TestScope_ListSessionsFiltered : un device scoped ne voit que ses projets
// et sessions dans list_sessions (3.3).
func TestScope_ListSessionsFiltered(t *testing.T) {
	ts, server := newTestServerWithGW(&fakeRPCClient{})
	defer ts.Close()

	server.SetSessionValidator(func(token string) (discovery.SessionInfo, bool) {
		return discovery.SessionInfo{
			DeviceID:        "phone-scoped",
			Name:            "Pixel",
			AllowedProjects: []string{"file:///C:/proj-a"},
		}, true
	})

	url := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws?token=abc"
	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatalf("Dial: %v", err)
	}
	defer conn.Close()

	if err := conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"list_sessions","requestId":"l1"}`)); err != nil {
		t.Fatalf("Write: %v", err)
	}
	_, b, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	var out struct {
		Type      string                 `json:"type"`
		RequestID string                 `json:"requestId"`
		Error     string                 `json:"error"`
		Data      map[string]interface{} `json:"data"`
	}
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatalf("JSON invalide: %v (%s)", err, string(b))
	}
	if out.Type != "response" || out.Error != "" {
		t.Fatalf("list_sessions en erreur: %+v", out)
	}
	// Sans donn├®es hub (fake vide), le fallback liste les projets locaux ÔÇö
	// on v├®rifie juste que le filtre ne casse pas et renvoie une map.
	if out.Data == nil {
		t.Fatalf("Data manquante: %+v", out)
	}
}