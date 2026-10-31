package gateway

import (
	"strings"
	"testing"
	"time"

	"github.com/antigravity/remote-daemon/pkg/connectrpc"
)

// TestSessionActionsMatrix_AllScenarios teste l'ensemble exhaustif des actions sur les sessions :
// 1. Création (new_conversation / create_cascade)
// 2. Renommage (rename_cascade / rename_session)
// 3. Suppression sans confirmation (doit échouer)
// 4. Suppression confirmée (doit purger l'état et diffuser session_deleted + sessions_updated)
// 5. Synchronisation de suppression déclenchée depuis le Desktop (Jetbox Stream Deletes)
func TestSessionActionsMatrix_AllScenarios(t *testing.T) {
	ts, gw := newTestServerWithGW(&fakeRPCClient{})
	defer ts.Close()

	jetbox := newFakeJetboxStreamer()
	defer jetbox.closeStream()
	gw.RunJetboxSubscription(jetbox)

	client := dialWS(t, "ws"+strings.TrimPrefix(ts.URL, "http")+"/ws")
	defer client.conn.Close()
	time.Sleep(50 * time.Millisecond)

	// Ingestion initiale de 3 sessions
	now := time.Now()
	jetbox.push(map[string]connectrpc.JetboxSummary{
		"session-alpha": {
			CascadeID: "session-alpha",
			Title:     "Audit Synchronisation",
			Workspace: "c:/projects/main",
			Status:    "CASCADE_STATUS_READY",
			UpdatedAt: now.Add(-5 * time.Minute),
		},
		"session-beta": {
			CascadeID: "session-beta",
			Title:     "Debug HTTP Errors",
			Workspace: "c:/projects/main",
			Status:    "CASCADE_STATUS_READY",
			UpdatedAt: now.Add(-2 * time.Minute),
		},
		"session-gamma": {
			CascadeID: "session-gamma",
			Title:     "Performance Flutter",
			Workspace: "c:/projects/main",
			Status:    "CASCADE_STATUS_READY",
			UpdatedAt: now,
		},
	}, nil)

	// Attente du snapshot
	time.Sleep(50 * time.Millisecond)

	// Scénario 1 : Renommage de session-alpha
	t.Run("Scenario 1: Rename Session", func(t *testing.T) {
		client.sendJSON(t, map[string]interface{}{
			"type":      "rename_cascade",
			"requestId": "req-rename-1",
			"cascadeId": "session-alpha",
			"title":     "Audit Synchronisation Complet",
		})
		resp := client.recv(t)
		for resp["type"] != "response" || resp["requestId"] != "req-rename-1" {
			resp = client.recv(t)
		}
		if resp["error"] != nil {
			t.Fatalf("rename_cascade échoué: %v", resp["error"])
		}

		// Vérification sur list_sessions
		client.sendJSON(t, map[string]interface{}{"type": "list_sessions", "requestId": "req-list-1"})
		listResp := client.recv(t)
		for listResp["type"] != "response" || listResp["requestId"] != "req-list-1" {
			listResp = client.recv(t)
		}
		data := listResp["data"].(map[string]interface{})
		sessions := data["sessions"].([]interface{})
		var found bool
		for _, s := range sessions {
			sm := s.(map[string]interface{})
			if sm["cascadeId"] == "session-alpha" {
				found = true
				if sm["title"] != "Audit Synchronisation Complet" {
					t.Fatalf("titre non mis à jour, reçu: %v", sm["title"])
				}
			}
		}
		if !found {
			t.Fatal("session-alpha introuvable après renommage")
		}
	})

	// Scénario 2 : Suppression sans confirmation (doit être refusée)
	t.Run("Scenario 2: Delete Session Unconfirmed Rejected", func(t *testing.T) {
		client.sendJSON(t, map[string]interface{}{
			"type":      "delete_session",
			"requestId": "req-del-unconf",
			"cascadeId": "session-beta",
		})
		resp := client.recv(t)
		for resp["type"] != "response" || resp["requestId"] != "req-del-unconf" {
			resp = client.recv(t)
		}
		if resp["error"] == nil {
			t.Fatal("delete_session sans confirmation aurait dû renvoyer une erreur")
		}
		if !strings.Contains(resp["error"].(string), "confirmation") {
			t.Fatalf("erreur inattendue: %v", resp["error"])
		}
	})

	// Scénario 3 : Suppression confirmée depuis le client mobile
	t.Run("Scenario 3: Delete Session Confirmed Broadcasts Deletion", func(t *testing.T) {
		client.sendJSON(t, map[string]interface{}{
			"type":      "delete_session",
			"requestId": "req-del-conf",
			"cascadeId": "session-beta",
			"confirm":   true,
		})

		var gotResponse bool
		var gotSessionsUpdated bool
		for i := 0; i < 15; i++ {
			msg := client.recv(t)
			if msg["type"] == "response" && msg["requestId"] == "req-del-conf" {
				if msg["error"] != nil {
					t.Fatalf("delete_session échoué: %v", msg["error"])
				}
				gotResponse = true
			}
			if msg["type"] == "sessions_updated" {
				gotSessionsUpdated = true
				data := msg["data"].(map[string]interface{})
				sessions := data["sessions"].([]interface{})
				for _, s := range sessions {
					sm := s.(map[string]interface{})
					if sm["cascadeId"] == "session-beta" {
						t.Fatal("session-beta encore présente dans sessions_updated après delete")
					}
				}
			}
			if gotResponse && gotSessionsUpdated {
				break
			}
		}
		if !gotResponse {
			t.Fatal("réponse delete_session non reçue")
		}
		if !gotSessionsUpdated {
			t.Fatal("sessions_updated non reçu après suppression confirmée")
		}
	})

	// Scénario 4 : Suppression en direct depuis le Desktop IDE (reçue via Jetbox Stream Deletes)
	t.Run("Scenario 4: Desktop Delete Stream Sync to Mobile", func(t *testing.T) {
		// Le Desktop supprime session-gamma
		jetbox.push(nil, []string{"session-gamma"})

		var gotDeletedEvent bool
		var gotUpdatedList bool
		for i := 0; i < 15; i++ {
			msg := client.recv(t)
			if msg["type"] == "session_deleted" && msg["cascadeId"] == "session-gamma" {
				gotDeletedEvent = true
			}
			if msg["type"] == "sessions_updated" {
				gotUpdatedList = true
				data := msg["data"].(map[string]interface{})
				sessions := data["sessions"].([]interface{})
				for _, s := range sessions {
					sm := s.(map[string]interface{})
					if sm["cascadeId"] == "session-gamma" {
						t.Fatal("session-gamma encore présente après suppression Desktop")
					}
				}
			}
			if gotDeletedEvent && gotUpdatedList {
				break
			}
		}

		if !gotDeletedEvent {
			t.Fatal("événement session_deleted non émis lors de la suppression Desktop")
		}
		if !gotUpdatedList {
			t.Fatal("événement sessions_updated non émis lors de la suppression Desktop")
		}
	})

	// Scénario 5 : Création / New Conversation
	t.Run("Scenario 5: New Conversation Initialization", func(t *testing.T) {
		client.sendJSON(t, map[string]interface{}{
			"type":      "new_conversation",
			"requestId": "req-new-1",
			"data": map[string]interface{}{
				"workspacePath": "c:/projects/main",
				"title":         "Nouvelle session de test",
			},
		})
		resp := client.recv(t)
		for resp["type"] != "response" || resp["requestId"] != "req-new-1" {
			resp = client.recv(t)
		}
		if resp["error"] != nil {
			t.Fatalf("new_conversation échoué: %v", resp["error"])
		}
		data := resp["data"].(map[string]interface{})
		newID, _ := data["cascadeId"].(string)
		if newID == "" {
			t.Fatal("cascadeId vide après new_conversation")
		}
	})
}
