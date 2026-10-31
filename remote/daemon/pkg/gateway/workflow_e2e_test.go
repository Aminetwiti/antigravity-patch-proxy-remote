package gateway

import (
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// recvUntil lit les messages jusqu'à en trouver un du type demandé
// (deadline de sécurité : un régression qui ne produit plus de message
// échoue au lieu de bloquer la suite des tests).
func recvUntil(t *testing.T, c *wsTestClient, msgType string) map[string]interface{} {
	t.Helper()
	c.conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	defer c.conn.SetReadDeadline(time.Time{})
	for {
		msg := c.recv(t)
		if msg["type"] == msgType {
			return msg
		}
	}
}

// TestWorkflowCreateCascadeSendPromptApprovalCompletion — test d'intégration
// du workflow COMPLET côté gateway, sans IDE réel (fake RPC) :
//
//	create_cascade → send_prompt (stream_start + stream_delta +
//	approval_pending) → get_pending_approval (reprise tap-notification) →
//	submit_approval (allow, scope=session) → second prompt auto-approuvé →
//	stream_end outcome=done (validation de complétion).
func TestWorkflowCreateCascadeSendPromptApprovalCompletion(t *testing.T) {
	backend := &fakeApprovalRPC{}
	backend.streamDeltas = []string{`{"run_command":"npx jest","step_index":1,"trajectory_id":"123e4567-e89b-12d3-a456-426614174000"}`}
	ts, _ := newTestServerWithGW(backend)
	defer ts.Close()

	client := dialWS(t, "ws"+strings.TrimPrefix(ts.URL, "http")+"/ws")
	defer client.conn.Close()

	// --- Étape 1 : CreateCascade (workspacePath → URI propagée au RPC) ---
	client.send(t, map[string]string{
		"type": "create_cascade", "requestId": "c1",
		"workspacePath": "C:/Users/test/proj",
	})
	createResp := recvUntil(t, client, "response")
	if createResp["error"] != nil {
		t.Fatalf("create_cascade a échoué: %v", createResp)
	}
	// cascadeId : la réponse est un dump de champs décodés (toOutgoing).
	// NOTE: json.Unmarshal produit []interface{} pour les tableaux — on
	// itère sur des éléments typés individuellement.
	data, _ := createResp["data"].(map[string]interface{})
	fieldsRaw, _ := data["fields"].([]interface{})
	found := false
	for _, fr := range fieldsRaw {
		f, _ := fr.(map[string]interface{})
		if f["text"] == "casc-1" {
			found = true
			break
		}
	}
	if len(fieldsRaw) == 0 || !found {
		t.Fatalf("cascadeId inattendu dans la réponse: %v", createResp)
	}
	if backend.lastCascade == nil || backend.lastCascade.uri != "file:///C:/Users/test/proj" {
		t.Fatalf("CreateCascade jamais appelé ou URI erronée: %+v", backend.lastCascade)
	}

	// --- Étape 2 : send_prompt → le LS émet une demande d'approbation ---
	client.send(t, map[string]string{
		"type": "send_prompt", "requestId": "p1",
		"cascadeId": "casc-1", "prompt": "travaille",
	})
	gotStart, gotPending, gotDelta, gotEnd := false, false, false, false
	for !gotEnd {
		msg := client.recv(t)
		switch msg["type"] {
		case "stream_start":
			gotStart = true
		case "approval_pending":
			gotPending = true
			pd, _ := msg["data"].(map[string]interface{})
			if pd == nil || pd["callId"] == nil || pd["cascadeId"] != "casc-1" {
				t.Fatalf("approval_pending sans contexte: %v", msg)
			}
		case "stream_delta":
			gotDelta = true
		case "stream_end":
			gotEnd = true
			ed, _ := msg["data"].(map[string]interface{})
			if ed == nil || ed["outcome"] != "approval" {
				t.Fatalf("outcome attendu approval, reçu %v", msg)
			}
		}
	}
	if !gotStart || !gotPending || !gotDelta {
		t.Fatalf("séquence incomplète: start=%v pending=%v delta=%v", gotStart, gotPending, gotDelta)
	}

	// --- Étape 3 : get_pending_approval (contexte stable pour tap-notification) ---
	client.send(t, map[string]string{
		"type": "get_pending_approval", "requestId": "g1", "cascadeId": "casc-1",
	})
	pResp := recvUntil(t, client, "response")
	pd, _ := pResp["data"].(map[string]interface{})
	if pd == nil || pd["approvalType"] != "run_command" || pd["command"] != "npx jest" {
		t.Fatalf("get_pending_approval contexte erroné: %v", pResp)
	}
	if pd["trajectoryId"] != "123e4567-e89b-12d3-a456-426614174000" {
		t.Fatalf("trajectoryId erroné: %v", pd)
	}

	// --- Étape 4 : submit_approval (allow, scope=session) ---
	// stepIndex est un entier : le helper send (map[string]string) le
	// sérialiserait en chaîne et le serveur le rejetterait — JSON brut.
	if err := client.conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"submit_approval","requestId":"s1","cascadeId":"casc-1","trajectoryId":"123e4567-e89b-12d3-a456-426614174000","stepIndex":1,"approvalType":"run_command","decision":"allow","command":"npx jest","scope":"session"}`)); err != nil {
		t.Fatalf("envoi submit_approval: %v", err)
	}
	sResp := recvUntil(t, client, "response")
	if sResp["error"] != nil {
		t.Fatalf("submit_approval a échoué: %v", sResp)
	}
	got, ok := backend.lastApproval.(*submitApprovalCall)
	if !ok || !got.confirm || got.cascadeID != "casc-1" {
		t.Fatalf("décision mal transmise: %+v", backend.lastApproval)
	}

	// --- Étape 5 : second prompt — scope=session → auto-approuvé, outcome=done ---
	client.send(t, map[string]string{
		"type": "send_prompt", "requestId": "p2",
		"cascadeId": "casc-1", "prompt": "continue",
	})
	gotPending2 := false
	for {
		msg := client.recv(t)
		if msg["type"] == "approval_pending" {
			gotPending2 = true
		}
		if msg["type"] == "stream_end" {
			ed, _ := msg["data"].(map[string]interface{})
			if ed == nil || ed["outcome"] != "done" {
				t.Fatalf("outcome attendu done, reçu %v", msg)
			}
			break
		}
	}
	if gotPending2 {
		t.Fatal("approbation redemandée malgré scope=session")
	}
	// 1 décision utilisateur + 1 auto-approbation du second prompt.
	if backend.submitted != 2 {
		t.Fatalf("SubmitToolApproval appelé %d fois, attendu 2", backend.submitted)
	}

	// --- Étape 6 : idempotence C1 — le même requestId ne rejoue pas le tour ---
	client.send(t, map[string]string{
		"type": "send_prompt", "requestId": "p1",
		"cascadeId": "casc-1", "prompt": "travaille",
	})
	dedup := recvUntil(t, client, "response")
	dd, _ := dedup["data"].(map[string]interface{})
	if dd == nil || dd["deduplicated"] != true {
		t.Fatalf("retransmission p1 non dédupliquée: %v", dedup)
	}
}

// TestWorkflowSubmitApprovalDeny — variante du workflow : l'utilisateur
// refuse (decision=deny) → SubmitToolApproval avec confirm=false.
func TestWorkflowSubmitApprovalDeny(t *testing.T) {
	backend := &fakeApprovalRPC{}
	backend.streamDeltas = []string{`{"run_command":"rm -rf /tmp/x","step_index":2,"trajectory_id":"123e4567-e89b-12d3-a456-426614174000"}`}
	ts, _ := newTestServerWithGW(backend)
	defer ts.Close()

	client := dialWS(t, "ws"+strings.TrimPrefix(ts.URL, "http")+"/ws")
	defer client.conn.Close()

	client.send(t, map[string]string{
		"type": "send_prompt", "requestId": "p1",
		"cascadeId": "casc-1", "prompt": "supprime",
	})
	// Consomme jusqu'à stream_end (outcome=approval).
	for {
		msg := client.recv(t)
		if msg["type"] == "stream_end" {
			break
		}
	}

	if err := client.conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"submit_approval","requestId":"s1","cascadeId":"casc-1","trajectoryId":"123e4567-e89b-12d3-a456-426614174000","stepIndex":2,"approvalType":"run_command","decision":"deny","command":"rm -rf /tmp/x"}`)); err != nil {
		t.Fatalf("envoi submit_approval: %v", err)
	}
	recvUntil(t, client, "response")

	got, ok := backend.lastApproval.(*submitApprovalCall)
	if !ok {
		t.Fatal("Aucun SubmitToolApproval enregistré")
	}
	if got.confirm {
		t.Fatalf("decision=deny attendu confirm=false, reçu %+v", got)
	}
	if got.stepIndex != 2 || got.trajectoryID != "123e4567-e89b-12d3-a456-426614174000" {
		t.Fatalf("cible d'approbation erronée: %+v", got)
	}

	// Après refus, rien n'est en attente.
	client.send(t, map[string]string{
		"type": "get_pending_approval", "requestId": "g2", "cascadeId": "casc-1",
	})
	gResp := recvUntil(t, client, "response")
	gd, _ := gResp["data"].(map[string]interface{})
	if gd != nil {
		t.Fatalf("approbation encore en attente après refus: %v", gResp)
	}
}
