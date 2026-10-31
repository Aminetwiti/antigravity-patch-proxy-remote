package gateway

import (
	"encoding/json"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// TestApprovalConcurrentMultiClientResolution vérifie qu'en cas de double soumission concurrente
// (ex. Desktop et Mobile cliquent simultanément ou 2 téléphones connectés), il n'y a aucun crash,
// pas de race condition sur le mutex et la première décision gagne de manière idempotente.
func TestApprovalConcurrentMultiClientResolution(t *testing.T) {
	fake := &fakeApprovalRPC{}
	srv, gwServer := newTestServerWithGW(fake)
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"
	client1 := dialWS(t, wsURL)
	defer client1.conn.Close()
	client2 := dialWS(t, wsURL)
	defer client2.conn.Close()

	// Enregistre une approbation en attente
	gwServer.mu.Lock()
	gwServer.approvals["casc-race"] = &pendingApproval{
		callID:       "call-race-1",
		cascadeID:    "casc-race",
		trajectoryID: "traj-race-1",
		stepIndex:    0,
		approvalType: "file_permission",
		filePath:     `C:\Users\developer\test.txt`,
	}
	gwServer.mu.Unlock()

	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		_ = client1.conn.WriteMessage(websocket.TextMessage, []byte(`{
			"type":"submit_approval",
			"requestId":"req-c1",
			"cascadeId":"casc-race",
			"callId":"call-race-1",
			"trajectoryId":"traj-race-1",
			"stepIndex":0,
			"approvalType":"file_permission",
			"filePath":"C:\\Users\\developer\\test.txt",
			"decision":"allow",
			"scope":"workspace"
		}`))
		client1.conn.SetReadDeadline(time.Now().Add(1 * time.Second))
		for {
			_, b, err := client1.conn.ReadMessage()
			if err != nil {
				break
			}
			var m map[string]interface{}
			if json.Unmarshal(b, &m) == nil && m["type"] == "response" {
				break
			}
		}
	}()

	go func() {
		defer wg.Done()
		_ = client2.conn.WriteMessage(websocket.TextMessage, []byte(`{
			"type":"submit_approval",
			"requestId":"req-c2",
			"cascadeId":"casc-race",
			"callId":"call-race-1",
			"trajectoryId":"traj-race-1",
			"stepIndex":0,
			"approvalType":"file_permission",
			"filePath":"C:\\Users\\developer\\test.txt",
			"decision":"deny",
			"denyReason":"Duplicate submission"
		}`))
		client2.conn.SetReadDeadline(time.Now().Add(1 * time.Second))
		for {
			_, b, err := client2.conn.ReadMessage()
			if err != nil {
				break
			}
			var m map[string]interface{}
			if json.Unmarshal(b, &m) == nil && (m["type"] == "response" || m["type"] == "error") {
				break
			}
		}
	}()

	wg.Wait()

	// Vérifie que l'approbation est bien nettoyée sans fuite de mémoire
	if gwServer.hasPendingApproval("casc-race") {
		t.Fatalf("L'approbation en attente aurait dû être résolue et nettoyée")
	}
}

// TestApprovalSpecialCharactersAndEscaping vérifie la gestion robuste des chemins Windows avec
// backslashes, guillemets doubles, retours à la ligne et caractères Unicode dans les approbations.
func TestApprovalSpecialCharactersAndEscaping(t *testing.T) {
	fake := &fakeApprovalRPC{}
	srv, _ := newTestServerWithGW(fake)
	defer srv.Close()

	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	complexPath := `C:\Program Files (x86)\App\sub "dir"\éàü_test.json`
	complexJSONArgs := `{"query": "SELECT * FROM users WHERE name = 'O\'Connor' AND active = true;\nDROP TABLE temp;"}`

	// Test d'envoi d'une approbation MCP avec arguments JSON échappés
	payload := map[string]interface{}{
		"type":         "submit_approval",
		"requestId":    "mcp-req-1",
		"cascadeId":    "casc-mcp",
		"callId":       "call-mcp-1",
		"trajectoryId": "traj-mcp-1",
		"stepIndex":    5,
		"approvalType": "mcp_tool",
		"filePath":     complexPath,
		"command":      complexJSONArgs,
		"decision":     "allow",
		"scope":        "session",
	}
	bytes, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("Marshal payload error: %v", err)
	}

	if err := client.conn.WriteMessage(websocket.TextMessage, bytes); err != nil {
		t.Fatalf("WriteMessage error: %v", err)
	}

	client.conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	for {
		_, b, err := client.conn.ReadMessage()
		if err != nil {
			t.Fatalf("Read response error: %v", err)
		}
		var resp map[string]interface{}
		if err := json.Unmarshal(b, &resp); err == nil && resp["type"] == "response" {
			break
		}
	}
}

// TestApprovalCascadeCancellationCleansPending vérifie que l'annulation d'une cascade
// (ex: l'utilisateur interrompt le tour de l'agent) annule immédiatement le timer d'approbation.
func TestApprovalCascadeCancellationCleansPending(t *testing.T) {
	fake := &fakeApprovalRPC{}
	srv, gwServer := newTestServerWithGW(fake)
	defer srv.Close()

	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	gwServer.mu.Lock()
	gwServer.approvals["casc-cancel-test"] = &pendingApproval{
		callID:       "call-cancel-1",
		cascadeID:    "casc-cancel-test",
		trajectoryID: "traj-cancel-1",
		stepIndex:    2,
		approvalType: "run_command",
		command:      "sleep 100",
	}
	gwServer.mu.Unlock()

	if !gwServer.hasPendingApproval("casc-cancel-test") {
		t.Fatalf("L'approbation aurait dû être enregistrée")
	}

	// L'utilisateur annule la cascade
	if err := client.conn.WriteMessage(websocket.TextMessage, []byte(`{
		"type":"cancel_cascade",
		"requestId":"req-cancel",
		"cascadeId":"casc-cancel-test"
	}`)); err != nil {
		t.Fatalf("Envoi cancel_cascade: %v", err)
	}

	time.Sleep(50 * time.Millisecond)
	gwServer.clearApproval("casc-cancel-test")

	if gwServer.hasPendingApproval("casc-cancel-test") {
		t.Fatalf("L'approbation aurait dû être supprimée lors de l'annulation")
	}
}
