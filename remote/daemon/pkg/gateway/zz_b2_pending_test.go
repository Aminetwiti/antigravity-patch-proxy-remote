package gateway

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// B2 — tap-notification : un client peut ré-ouvrir une approbation en attente
// via get_pending_approval, même si le stream_delta d'origine est passé.
func TestB2PendingApprovalReopen(t *testing.T) {
	backend := &fakeRPCClient{streamDeltas: []string{`{"run_command":"npx jest","step_index":1,"trajectory_id":"123e4567-e89b-12d3-a456-426614174000"}`}}
	server := NewServer(backend, "")
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", server.HandleWebSocket)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	// 1. Un prompt émet une approbation → le daemon la marque en attente et
	//    pousse un événement approval_pending dédié (avec le contexte).
	client.send(t, map[string]string{
		"type": "send_prompt", "requestId": "r9",
		"cascadeId": "casc-1", "prompt": "travaille",
	})
	gotPending := false
	for {
		msg := client.recv(t)
		switch msg["type"] {
		case "approval_pending":
			gotPending = true
			data, _ := msg["data"].(map[string]interface{})
			if data == nil || data["callId"] == nil {
				t.Fatalf("approval_pending sans callId: %v", msg)
			}
		case "stream_end":
			if !gotPending {
				t.Fatal("approval_pending jamais émis avant stream_end")
			}
			if msg["data"].(map[string]interface{})["outcome"] != "approval" {
				t.Fatalf("outcome attendu approval: %v", msg)
			}
			goto done
		}
	}
done:

	// 2. Tap-notification (nouvelle connexion, comme une app relancée) :
	//    get_pending_approval renvoie le contexte complet pour soumettre.
	client2 := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client2.conn.Close()
	client2.send(t, map[string]string{
		"type": "get_pending_approval", "requestId": "g1", "cascadeId": "casc-1",
	})
	for {
		msg := client2.recv(t)
		if msg["type"] != "response" {
			continue
		}
		data, _ := msg["data"].(map[string]interface{})
		if data == nil {
			t.Fatalf("get_pending_approval sans data: %v", msg)
		}
		if data["cascadeId"] != "casc-1" {
			t.Fatalf("cascadeId erroné: %v", data)
		}
		if data["approvalType"] != "run_command" {
			t.Fatalf("approvalType erroné: %v", data)
		}
		if data["command"] != "npx jest" {
			t.Fatalf("command erroné: %v", data)
		}
		if data["trajectoryId"] != "123e4567-e89b-12d3-a456-426614174000" {
			t.Fatalf("trajectoryId erroné: %v", data)
		}
		if data["stepIndex"].(float64) != 1 {
			t.Fatalf("stepIndex erroné: %v", data)
		}
		break
	}

	// 3. Le client ré-ouvert soumet la décision → SubmitToolApproval.
	if err := client2.conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"submit_approval","requestId":"s1","cascadeId":"casc-1","callId":"c1","trajectoryId":"123e4567-e89b-12d3-a456-426614174000","stepIndex":1,"approvalType":"run_command","decision":"allow","command":"npx jest"}`)); err != nil {
		t.Fatalf("envoi submit_approval: %v", err)
	}
	for {
		msg := client2.recv(t)
		if msg["type"] != "response" {
			continue
		}
		break
	}
	got, ok := backend.lastApproval.(*submitApprovalCall)
	if !ok {
		t.Fatal("Aucun SubmitToolApproval enregistré")
	}
	if !got.confirm || got.cascadeID != "casc-1" {
		t.Fatalf("Décision mal transmise: %+v", got)
	}

	// 4. Après décision, get_pending_approval renvoie null (rien en attente).
	client2.send(t, map[string]string{
		"type": "get_pending_approval", "requestId": "g2", "cascadeId": "casc-1",
	})
	for {
		msg := client2.recv(t)
		if msg["type"] != "response" {
			continue
		}
		data, _ := msg["data"].(map[string]interface{})
		if data != nil {
			t.Fatalf("Approval encore en attente après décision: %v", data)
		}
		break
	}
}

// B2 — la réponse get_pending_approval est unary et corrélée par requestId.
func TestB2GetPendingApprovalResponseContract(t *testing.T) {
	server := NewServer(&fakeRPCClient{}, "")
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", server.HandleWebSocket)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	client.send(t, map[string]string{
		"type": "get_pending_approval", "requestId": "g1", "cascadeId": "inconnue",
	})
	msg := client.recv(t)
	if msg["type"] != "response" || msg["requestId"] != "g1" {
		t.Fatalf("Contrat unary violé: %v", msg)
	}
	data, _ := msg["data"].(map[string]interface{})
	if data != nil {
		t.Fatalf("Attendu null pour cascade inconnue: %v", data)
	}
}

// B2 — le push approval_pending porte expiresAt et est dédupliqué (pas de push
// quand la session auto-approuve : B3).
func TestB2ApprovalPendingNotEmittedWhenSessionApproved(t *testing.T) {
	backend := &loadRPCClient{streamDeltas: []string{`{"run_command":"npx jest","step_index":1,"trajectory_id":"123e4567-e89b-12d3-a456-426614174000"}`}}
	server := NewServer(backend, "")
	server.markSessionApproval("casc-1", "run_command") // B3 déjà actif
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
		if msg["type"] == "approval_pending" {
			t.Fatal("approval_pending émis alors que la session auto-approuve")
		}
		if msg["type"] == "stream_end" {
			break
		}
	}
	// L'auto-approbation B3 a bien soumis (confirm=true).
	got, ok := backend.lastApproval.(*submitApprovalCall)
	if !ok || !got.confirm {
		t.Fatalf("Auto-approbation B3 absente: %+v", backend.lastApproval)
	}
}

// B2 — l'expiration retire le pending : get_pending_approval renvoie null
// après approval_expired (sécurité téléphone perdu).
func TestB2PendingClearedOnExpiry(t *testing.T) {
	backend := &fakeRPCClient{streamDeltas: []string{`{"run_command":"npx jest","step_index":1,"trajectory_id":"123e4567-e89b-12d3-a456-426614174000"}`}}
	server := NewServer(backend, "")
	server.SetApprovalTimeout(80 * time.Millisecond)
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
		if msg["type"] == "approval_expired" {
			break
		}
	}

	client.send(t, map[string]string{
		"type": "get_pending_approval", "requestId": "g1", "cascadeId": "casc-1",
	})
	for {
		msg := client.recv(t)
		if msg["type"] != "response" {
			continue
		}
		data, _ := msg["data"].(map[string]interface{})
		if data != nil {
			t.Fatalf("Pending non nettoyé après expiration: %v", data)
		}
		break
	}
}

// B2 — la réponse get_pending_approval est unary et corrélée par requestId.
var _ = json.Marshal
