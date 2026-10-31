package gateway

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gorilla/websocket"
)

// C7-B — le gateway enrichit les frames stream_delta / stream_end /
// approval_pending d'un booléen hostActive (idle detection du PC hôte).
// Le mobile s'en sert pour ne PAS sonner quand l'utilisateur est déjà devant
// le PC. Sur non-Windows le stub renvoie false — le contrat testé ici est la
// PRÉSENCE du champ (le mobile lit hostActive == true pour supprimer).
func TestC7HostActivePresentOnFrames(t *testing.T) {
	backend := &fakeRPCClient{streamDeltas: []string{`{"run_command":"npx jest","step_index":1,"trajectory_id":"123e4567-e89b-12d3-a456-426614174000"}`}}
	server := NewServer(backend, "")
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", server.HandleWebSocket)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	client.send(t, map[string]string{
		"type": "send_prompt", "requestId": "r9",
		"cascadeId": "casc-1", "prompt": "travaille",
	})

	gotPending := false
	gotDelta := false
	for {
		msg := client.recv(t)
		switch msg["type"] {
		case "approval_pending":
			gotPending = true
			data, _ := msg["data"].(map[string]interface{})
			if data == nil {
				t.Fatalf("approval_pending sans data: %v", msg)
			}
			if _, ok := data["hostActive"]; !ok {
				t.Fatalf("approval_pending sans hostActive: %v", msg)
			}
		case "stream_delta":
			gotDelta = true
			data, _ := msg["data"].(map[string]interface{})
			if data == nil {
				t.Fatalf("stream_delta sans data: %v", msg)
			}
			if _, ok := data["hostActive"]; !ok {
				t.Fatalf("stream_delta sans hostActive: %v", msg)
			}
		case "stream_end":
			data, _ := msg["data"].(map[string]interface{})
			if data == nil {
				t.Fatalf("stream_end sans data: %v", msg)
			}
			if _, ok := data["hostActive"]; !ok {
				t.Fatalf("stream_end sans hostActive: %v", msg)
			}
			if !gotPending || !gotDelta {
				t.Fatalf("frames manquantes (pending=%v delta=%v)", gotPending, gotDelta)
			}
			return
		}
	}
}

// Le champ hostActive doit rester un booléen JSON strict (jamais de chaîne).
func TestC7HostActiveIsBool(t *testing.T) {
	backend := &fakeRPCClient{streamDeltas: []string{"ok"}}
	server := NewServer(backend, "")
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", server.HandleWebSocket)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	client.send(t, map[string]string{
		"type": "send_prompt", "requestId": "r9",
		"cascadeId": "casc-1", "prompt": "travaille",
	})
	for {
		msg := client.recv(t)
		if msg["type"] != "stream_delta" {
			continue
		}
		data, _ := msg["data"].(map[string]interface{})
		if data == nil {
			t.Fatalf("stream_delta sans data: %v", msg)
		}
		// Le JSON décodé : bool → bool ; une chaîne "true" casserait le mobile
		// (hostActive == true exige un vrai booléen).
		if _, ok := data["hostActive"].(bool); !ok {
			t.Fatalf("hostActive n'est pas un booléen: %v", data["hostActive"])
		}
		return
	}
}

// Dummy pour l'import websocket (dialWS l'utilise déjà dans le package).
var _ = websocket.TextMessage
