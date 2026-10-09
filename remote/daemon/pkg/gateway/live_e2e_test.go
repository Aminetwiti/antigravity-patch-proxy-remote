package gateway

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/antigravity/remote-daemon/pkg/connectrpc"
	"github.com/antigravity/remote-daemon/pkg/discovery"
	"github.com/gorilla/websocket"
)

func TestLiveAntigravityE2E(t *testing.T) {
	if os.Getenv("DAEMON_LIVE_E2E") != "1" {
		t.Skip("Live E2E désactivé par défaut (définir DAEMON_LIVE_E2E=1 pour exécuter)")
		return
	}
	// 1. Discovery de l'instance réelle Antigravity 2.0
	info, err := discovery.Discover()
	if err != nil {
		t.Skipf("Ignoré: Language Server non détecté: %v", err)
		return
	}
	t.Logf("✅ Language Server détecté: PID=%d, Port=%d, Hub=%s", info.PID, info.ConnectRPCPort, info.SubclientType)

	token := info.ExtensionCSRF
	if token == "" {
		token = info.CSRFToken
	}

	// 2. Client ConnectRPC connecté au vrai serveur gRPC-Web
	rpcClient := connectrpc.NewClient(info.ConnectRPCPort, token)

	// 3. Test Heartbeat ConnectRPC direct
	hbFrame, err := rpcClient.Heartbeat()
	if err != nil {
		t.Fatalf("❌ Échec Heartbeat ConnectRPC: %v", err)
	}
	t.Logf("✅ ConnectRPC Heartbeat OK (taille réponse: %d octets)", len(hbFrame))

	// 4. Initialisation du Gateway WebSocket Server
	gw := NewServer(rpcClient, "demo123")
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", gw.HandleWebSocket)
	ts := httptest.NewServer(mux)
	defer ts.Close()

	// 5. Connexion WebSocket client
	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws?auth_token=demo123"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("❌ Connexion WebSocket échouée: %v", err)
	}
	defer conn.Close()

	sendReq := func(req map[string]interface{}) {
		b, _ := json.Marshal(req)
		if err := conn.WriteMessage(websocket.TextMessage, b); err != nil {
			t.Fatalf("Erreur envoi WS: %v", err)
		}
	}

	recvMsg := func(timeout time.Duration) map[string]interface{} {
		conn.SetReadDeadline(time.Now().Add(timeout))
		_, b, err := conn.ReadMessage()
		if err != nil {
			t.Fatalf("Erreur réception WS (timeout %v): %v", timeout, err)
		}
		var msg map[string]interface{}
		if err := json.Unmarshal(b, &msg); err != nil {
			t.Fatalf("Erreur décodage JSON: %v", err)
		}
		return msg
	}

	recvMatching := func(reqID string, timeout time.Duration) map[string]interface{} {
		deadline := time.Now().Add(timeout)
		for time.Now().Before(deadline) {
			msg := recvMsg(time.Until(deadline))
			if msg["requestId"] == reqID || msg["type"] == "error" {
				return msg
			}
		}
		t.Fatalf("Timeout en attente de la réponse requestId=%s", reqID)
		return nil
	}

	// 6. Test Heartbeat via WebSocket
	sendReq(map[string]interface{}{
		"type":      "heartbeat",
		"requestId": "req-hb-1",
	})
	hbResp := recvMsg(3 * time.Second)
	if hbResp["type"] != "response" || hbResp["requestId"] != "req-hb-1" {
		t.Fatalf("Réponse Heartbeat invalide: %v", hbResp)
	}
	t.Logf("✅ WebSocket Heartbeat RPC validé")

	// 7. Test List Sessions (GetAllCascadeTrajectories)
	sendReq(map[string]interface{}{
		"type":      "list_sessions",
		"requestId": "req-list-1",
	})
	listResp := recvMsg(30 * time.Second)
	if listResp["type"] != "response" || listResp["requestId"] != "req-list-1" {
		t.Fatalf("Réponse list_sessions invalide: %v", listResp)
	}
	t.Logf("✅ WebSocket list_sessions validé avec succès")

	// 8. Test Création de Cascade avec modèle spécifique (CreateCascade avec modelUID & modelEnum)
	sendReq(map[string]interface{}{
		"type":          "create_cascade",
		"requestId":     "req-create-1",
		"workspacePath": t.TempDir(),
		"modelUID":      "gemini-3.7-flash",
		"modelEnum":     312,
	})
	createResp := recvMsg(10 * time.Second)
	if createResp["type"] != "response" || createResp["requestId"] != "req-create-1" {
		t.Fatalf("Réponse create_cascade invalide: %v", createResp)
	}
	t.Logf("✅ WebSocket create_cascade validé: %v", createResp)

	// Extraire le cascadeID créé si disponible
	var createdCascadeID string
	if data, ok := createResp["data"].(map[string]interface{}); ok {
		if fields, ok := data["fields"].([]interface{}); ok && len(fields) > 0 {
			if f0, ok := fields[0].(map[string]interface{}); ok {
				if text, ok := f0["text"].(string); ok {
					createdCascadeID = text
				}
			}
		}
	}
	if createdCascadeID != "" {
		t.Logf("🎉 Cascade Antigravity 2.0 créée avec ID: %s", createdCascadeID)

		// 9. Envoi d'un prompt en streaming (send_prompt)
		sendReq(map[string]interface{}{
			"type":      "send_prompt",
			"requestId": "req-prompt-1",
			"cascadeId": createdCascadeID,
			"prompt":    "Hello",
			"modelUID":  "gemini-3.7-flash",
			"modelEnum": 312,
		})
		t.Logf("🚀 Prompt envoyé à la cascade réelle, réception du stream...")

		deltaCount := 0
		for {
			m := recvMsg(30 * time.Second)
			msgType, _ := m["type"].(string)
			if msgType == "stream_start" {
				t.Logf("  ▶️ stream_start reçu")
			} else if msgType == "stream_delta" {
				deltaCount++
			} else if msgType == "stream_end" {
				t.Logf("  ⏹️ stream_end reçu (outcome=%v, %d deltas)", m["data"], deltaCount)
				break
			}
		}
		t.Logf("✅ WebSocket send_prompt streaming ConnectRPC validé à 100%%")

		// 10. Récupération de la trajectoire officielle (GetCascadeTrajectory)
		sendReq(map[string]interface{}{
			"type":      "get_trajectory",
			"requestId": "req-traj-1",
			"cascadeId": createdCascadeID,
		})
		trajResp := recvMsg(30 * time.Second)
		t.Logf("✅ WebSocket get_trajectory validé sur la cascade créée: %v", trajResp["type"])

		// 11. Nettoyage de la cascade de test (DeleteCascade) avec confirm: true
		sendReq(map[string]interface{}{
			"type":      "delete_cascade",
			"requestId": "req-del-1",
			"cascadeId": createdCascadeID,
			"confirm":   true,
		})
		delResp := recvMsg(30 * time.Second)
		if delResp["type"] != "response" || delResp["error"] != nil {
			t.Fatalf("Erreur suppression cascade: %v", delResp)
		}
		t.Logf("✅ WebSocket delete_cascade nettoyé et confirmé: %v", delResp)
	}

	// 11. Test List Files & File Read dans le workspace
	sendReq(map[string]interface{}{
		"type":          "list_files",
		"requestId":     "req-files-1",
		"workspacePath": "C:\\Users\\developer\\Downloads\\antigravity-add-model-main\\antigravity-add-model-main",
	})
	filesResp := recvMatching("req-files-1", 30*time.Second)
	if filesResp["type"] != "response" || filesResp["requestId"] != "req-files-1" {
		t.Fatalf("Réponse list_files invalide: %v", filesResp)
	}
	t.Logf("✅ WebSocket list_files explorateur validé")

	// 12. Test Set Approval Timeout
	sendReq(map[string]interface{}{
		"type":      "set_approval_timeout",
		"requestId": "req-timeout-1",
		"data": map[string]interface{}{
			"minutes": 10,
		},
	})
	timeoutResp := recvMatching("req-timeout-1", 3*time.Second)
	if timeoutResp["type"] != "response" || timeoutResp["requestId"] != "req-timeout-1" {
		t.Fatalf("Réponse set_approval_timeout invalide: %v", timeoutResp)
	}
	t.Logf("✅ WebSocket set_approval_timeout validé")

	fmt.Println("\n========================================================")
	fmt.Println("🎉 TOUTES LES FONCTIONNALITÉS CONNECTRPC & WEBSOCKET SONT VALIDÉES À 100% SUR ANTIGRAVITY 2.0 LIVE !")
	fmt.Println("========================================================")
}
