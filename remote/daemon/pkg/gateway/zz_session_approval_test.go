package gateway

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/antigravity/remote-daemon/pkg/connectrpc"
	"github.com/gorilla/websocket"
)

// fakeApprovalRPC étend fakeRPCClient pour compter les soumissions
// SubmitToolApproval (auto-approbation B3).
type fakeApprovalRPC struct {
	fakeRPCClient
	submitted int
	lastTool  string
}

func (f *fakeApprovalRPC) SubmitToolApproval(cascadeID, trajectoryID string, stepIndex uint32, oneofField int, oneofPayload []byte) ([]byte, error) {
	f.submitted++
	// Miroir de fakeRPCClient.SubmitToolApproval : les tests de workflow
	// vérifient aussi la décision transmise (confirm, cible), pas seulement
	// le compteur d'appels.
	f.lastApproval = &submitApprovalCall{
		cascadeID:    cascadeID,
		trajectoryID: trajectoryID,
		stepIndex:    stepIndex,
		confirm:      connectrpc.DecodeFields(oneofPayload)[0].Varint == 1,
	}
	return connectrpc.Frame(pbTextFrame("ok")), nil
}

// approvalEventFrame construit une frame protobuf dont ParseFrameEvents
// extrait un événement EventKindApprovalRequired. Le blob contient le texte
// « run_command » (détection du parseur) ET un UUID de 36 octets (corrélation
// trajectoryId pour l'auto-approbation SubmitToolApproval).
func approvalEventFrame(tool string) []byte {
	blob := tool + " 123e4567-e89b-12d3-a456-426614174000"
	buf := make([]byte, 2+len(blob))
	buf[0] = 0x0a // champ #1 length-delimited (test event_parser)
	buf[1] = byte(len(blob))
	copy(buf[2:], blob)
	return connectrpc.Frame(buf)
}

// TestSessionApprovalAutoApproves vérifie le comportement B3 :
// après un « scope=session » (toujours autoriser), une demande
// d'approbation du même type est auto-approuvée sans passer par le client.
func TestSessionApprovalAutoApproves(t *testing.T) {
	fake := &fakeApprovalRPC{}
	// Même format que TestWebSocketStreamEndOutcome : le fake enveloppe la
	// frame dans pbTextFrame, et ParseFrameEvents y détecte run_command + UUID.
	fake.streamDeltas = []string{`{"run_command":"npx jest","step_index":1,"trajectory_id":"123e4567-e89b-12d3-a456-426614174000"}`}
	srv := newTestServer(fake)
	defer srv.Close()

	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	// 1. L'utilisateur choisit « toujours autoriser run_command pour la session ».
	if err := client.conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"submit_approval","requestId":"a1","cascadeId":"casc-1","callId":"call-1","trajectoryId":"123e4567-e89b-12d3-a456-426614174000","stepIndex":0,"approvalType":"run_command","decision":"allow","scope":"session"}`)); err != nil {
		t.Fatalf("envoi submit_approval: %v", err)
	}
	// La réponse unary arrive APRÈS le marquage session (handleAction marque
	// avant d'écrire la réponse) : la lire garantit que le serveur a bien
	// enregistré l'auto-approbation avant le prompt suivant — aucun sleep.
	// The server sends the unary "response" and then broadcasts
	// "approval_resolved" + "sessions_updated" to all clients (including us).
	// Under load the broadcast can arrive first, so drain until we see "response".
	client.conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	for {
		_, b, err := client.conn.ReadMessage()
		if err != nil {
			t.Fatalf("réponse submit_approval: %v", err)
		}
		var resp map[string]interface{}
		if err := json.Unmarshal(b, &resp); err != nil {
			continue
		}
		if resp["type"] == "response" {
			break // success — server has registered the session approval
		}
		// broadcast frame (approval_resolved / sessions_updated) — skip
	}
	client.conn.SetReadDeadline(time.Time{})

	// 2. Un nouveau prompt émet une demande d'approbation run_command :
	//    elle doit être auto-approuvée (submitted == 1).
	if err := client.conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"send_prompt","requestId":"r2","cascadeId":"casc-1","prompt":"fais qqch"}`)); err != nil {
		t.Fatalf("envoi send_prompt: %v", err)
	}

	client.conn.SetReadDeadline(time.Now().Add(10 * time.Second))
	for {
		_, b, err := client.conn.ReadMessage()
		if err != nil {
			t.Fatalf("lecture stream: %v", err)
		}
		var m map[string]interface{}
		if err := json.Unmarshal(b, &m); err != nil {
			continue
		}
		// L'événement run_command diffusé (stream_delta) EST la preuve que
		// l'auto-approbation a fonctionné : le daemon l'a vu et l'a soumise
		// AVANT de diffuser ce delta.
		if m["type"] == "stream_delta" {
			if d, ok := m["data"].(map[string]interface{}); ok {
				if evs, ok := d["events"].([]interface{}); ok && len(evs) > 0 {
					break
				}
			}
		}
	}
	// 1 appel = la décision utilisateur (scope session) + 1 appel = l'auto-
	// approbation automatique du prompt suivant : total 2.
	if fake.submitted != 2 {
		t.Fatalf("SubmitToolApproval appelé %d fois, attendu 2 (1 décision + 1 auto-approbation)", fake.submitted)
	}
}

// TestSessionApprovalOnceNeedsClient vérifie qu'un scope « once » ne
// déclenche PAS d'auto-approbation : la demande reste visible du client.
func TestSessionApprovalOnceNeedsClient(t *testing.T) {
	fake := &fakeApprovalRPC{}
	fake.streamDeltas = []string{`{"run_command":"npx jest","step_index":1,"trajectory_id":"123e4567-e89b-12d3-a456-426614174000"}`}
	srv := newTestServer(fake)
	defer srv.Close()

	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	if err := client.conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"send_prompt","requestId":"r1","cascadeId":"casc-2","prompt":"fais qqch"}`)); err != nil {
		t.Fatalf("envoi send_prompt: %v", err)
	}

	var sawApproval bool
	for {
		_, b, err := client.conn.ReadMessage()
		if err != nil {
			t.Fatalf("lecture stream: %v", err)
		}
		var m map[string]interface{}
		if err := json.Unmarshal(b, &m); err != nil {
			continue
		}
		if m["type"] == "stream_delta" {
			if d, ok := m["data"].(map[string]interface{}); ok {
				if evs, ok := d["events"].([]interface{}); ok && len(evs) > 0 {
					sawApproval = true
				}
			}
		}
		if m["type"] == "stream_end" {
			break
		}
	}
	if fake.submitted != 0 {
		t.Fatalf("SubmitToolApproval appelé %d fois, attendu 0 (scope once)", fake.submitted)
	}
	if !sawApproval {
		t.Fatal("aucun événement d'approbation diffusé au client (scope once)")
	}
}
