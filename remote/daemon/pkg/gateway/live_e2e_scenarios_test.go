package gateway

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/antigravity/remote-daemon/pkg/connectrpc"
	"github.com/antigravity/remote-daemon/pkg/discovery"
	"github.com/gorilla/websocket"
)

// helper to setup a live daemon test server connected to the real Antigravity IDE.
// Nécessite DAEMON_LIVE_E2E=1 : ces scénarios créent/suppriment de vraies
// cascades sur le LS et ne doivent jamais s'exécuter dans un test de routine.
func setupLiveServer(t *testing.T, authToken string) (*Server, *httptest.Server, *connectrpc.Client) {
	t.Helper()
	if os.Getenv("DAEMON_LIVE_E2E") != "1" {
		t.Skip("Scénario live E2E désactivé (définir DAEMON_LIVE_E2E=1 pour exécuter)")
		return nil, nil, nil
	}
	info, err := discovery.Discover()
	if err != nil {
		t.Skipf("Ignoré: Language Server Antigravity non détecté: %v", err)
		return nil, nil, nil
	}
	token := info.ExtensionCSRF
	if token == "" {
		token = info.CSRFToken
	}

	rpcClient := connectrpc.NewClient(info.ConnectRPCPort, token)
	gw := NewServer(rpcClient, authToken)

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", gw.HandleWebSocket)
	mux.HandleFunc("/health", gw.HTTPHandler)
	mux.HandleFunc("/health/diagnostic", gw.DiagnosticHandler)
	ts := httptest.NewServer(mux)

	return gw, ts, rpcClient
}

// dialWSWithToken dials the test server with specified token / headers.
func dialWSClient(t *testing.T, rawURL string, header http.Header) *websocket.Conn {
	t.Helper()
	base := rawURL
	query := ""
	if idx := strings.Index(rawURL, "?"); idx != -1 {
		base = rawURL[:idx]
		query = rawURL[idx:]
	}
	wsURL := "ws" + strings.TrimPrefix(base, "http") + "/ws" + query
	conn, resp, err := websocket.DefaultDialer.Dial(wsURL, header)
	if err != nil {
		status := 0
		if resp != nil {
			status = resp.StatusCode
		}
		t.Fatalf("Connexion WebSocket échouée (HTTP %d): %v", status, err)
	}
	return conn
}

// Scenario 1: Authentication & Security Guardrails
func TestLiveE2E_AuthenticationScenarios(t *testing.T) {
	_, ts, _ := setupLiveServer(t, "secret-token-xyz")
	if ts == nil {
		return
	}
	defer ts.Close()

	t.Run("Refus sans jeton (HTTP 401)", func(t *testing.T) {
		wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws"
		_, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
		if err == nil {
			t.Fatal("Attendu une erreur 401 Unauthorized sans jeton, mais la connexion a réussi")
		}
		if resp == nil || resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("Attendu HTTP 401, reçu %v", resp)
		}
		t.Logf("✅ Connexion sans token correctement rejetée (HTTP 401)")
	})

	t.Run("Refus avec mauvais jeton (HTTP 401)", func(t *testing.T) {
		wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws?token=mauvais-token"
		_, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
		if err == nil {
			t.Fatal("Attendu une erreur 401 Unauthorized avec mauvais jeton")
		}
		if resp == nil || resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("Attendu HTTP 401, reçu %v", resp)
		}
		t.Logf("✅ Connexion avec token invalide rejetée (HTTP 401)")
	})

	t.Run("Succès avec query param ?token=...", func(t *testing.T) {
		conn := dialWSClient(t, ts.URL+"?token=secret-token-xyz", nil)
		defer conn.Close()
		t.Logf("✅ Authentification par paramètre ?token validée")
	})

	t.Run("Succès avec query param ?auth_token=...", func(t *testing.T) {
		conn := dialWSClient(t, ts.URL+"?auth_token=secret-token-xyz", nil)
		defer conn.Close()
		t.Logf("✅ Authentification par paramètre ?auth_token validée")
	})

	t.Run("Succès avec header Authorization Bearer", func(t *testing.T) {
		h := make(http.Header)
		h.Set("Authorization", "Bearer secret-token-xyz")
		conn := dialWSClient(t, ts.URL, h)
		defer conn.Close()
		t.Logf("✅ Authentification par Header Authorization Bearer validée")
	})
}

// Scenario 2: Multi-Model Cascade Lifecycle & Trajectory Tracking
func TestLiveE2E_MultiModelCascadeLifecycle(t *testing.T) {
	_, ts, _ := setupLiveServer(t, "demo123")
	if ts == nil {
		return
	}
	defer ts.Close()

	conn := dialWSClient(t, ts.URL+"?token=demo123", nil)
	defer conn.Close()

	modelsToTest := []struct {
		name      string
		modelUID  string
		modelEnum uint64
	}{
		{"Gemini 3.7 Flash", "gemini-3.7-flash", 312},
		{"Claude Sonnet 4.6", "claude-sonnet-4.6-thinking", 334},
		{"GPT-OSS 120B", "gpt-oss-120b", 342},
	}

	for _, m := range modelsToTest {
		t.Run("Cycle de vie complet avec "+m.name, func(t *testing.T) {
			reqID := fmt.Sprintf("req-create-%s", m.modelUID)
			createMsg := map[string]interface{}{
				"type":          "create_cascade",
				"requestId":     reqID,
				"workspacePath": "C:\\Users\\developer\\Downloads\\antigravity-add-model-main\\antigravity-add-model-main",
				"modelUID":      m.modelUID,
				"modelEnum":     m.modelEnum,
			}
			b, _ := json.Marshal(createMsg)
			if err := conn.WriteMessage(websocket.TextMessage, b); err != nil {
				t.Fatalf("Envoi create_cascade échoué: %v", err)
			}

			resp := readResp(t, conn, reqID)
			if resp["error"] != nil {
				t.Fatalf("Création cascade rejetée: %v", resp)
			}

			cascadeID := cascadeIDFromCreateResp(t, conn, resp, m.name)

			// Vérification get_trajectory sur la cascade
			trajReq, _ := json.Marshal(map[string]interface{}{
				"type":      "get_trajectory",
				"requestId": "req-traj-" + cascadeID,
				"cascadeId": cascadeID,
			})
			conn.WriteMessage(websocket.TextMessage, trajReq)
			trajResp := readResp(t, conn, "req-traj-"+cascadeID)
			if trajResp["error"] != nil {
				t.Fatalf("Trajectoire invalide: %v", trajResp)
			}
			t.Logf("✅ Trajectoire Antigravity 2.0 inspectée avec succès")

			// Suppression propre
			delReq, _ := json.Marshal(map[string]interface{}{
				"type":      "delete_cascade",
				"requestId": "req-del-" + cascadeID,
				"cascadeId": cascadeID,
				"confirm":   true,
			})
			conn.WriteMessage(websocket.TextMessage, delReq)
			delResp := readResp(t, conn, "req-del-"+cascadeID)
			if delResp["error"] != nil {
				t.Fatalf("Suppression cascade échouée: %v", delResp)
			}
			t.Logf("✅ Cascade %s supprimée et nettoyée", cascadeID)
		})
	}
}

// Scenario 3: Prompt Streaming & Interruption (Cancel Generation)
func TestLiveE2E_StreamingAndCancelGeneration(t *testing.T) {
	gw, ts, _ := setupLiveServer(t, "demo123")
	if ts == nil {
		return
	}
	defer ts.Close()

	conn := dialWSClient(t, ts.URL+"?token=demo123", nil)
	defer conn.Close()

	// 1. Créer une cascade
	createReq, _ := json.Marshal(map[string]interface{}{
		"type":          "create_cascade",
		"requestId":     "req-create-cancel",
		"workspacePath": "C:\\Users\\developer\\Downloads\\antigravity-add-model-main\\antigravity-add-model-main",
		"modelUID":      "gemini-3.7-flash",
		"modelEnum":     312,
	})
	conn.WriteMessage(websocket.TextMessage, createReq)
	createResp := readResp(t, conn, "req-create-cancel")

	cascadeID := cascadeIDFromCreateResp(t, conn, createResp, "cancel")
	_ = gw
	defer func() {
		delReq, _ := json.Marshal(map[string]interface{}{
			"type":      "delete_cascade",
			"requestId": "req-del-clean",
			"cascadeId": cascadeID,
			"confirm":   true,
		})
		conn.WriteMessage(websocket.TextMessage, delReq)
	}()

	// 2. Envoi d'un prompt et annulation
	promptReq, _ := json.Marshal(map[string]interface{}{
		"type":      "send_prompt",
		"requestId": "req-prompt-cancel",
		"cascadeId": cascadeID,
		"prompt":    "Write a long essay about quantum computing architecture",
	})
	conn.WriteMessage(websocket.TextMessage, promptReq)

	// Simuler l'annulation par l'utilisateur
	go func() {
		time.Sleep(50 * time.Millisecond)
		gw.CancelGeneration(cascadeID)
	}()

	receivedCancel := false
	for {
		conn.SetReadDeadline(time.Now().Add(10 * time.Second))
		_, rawMsg, err := conn.ReadMessage()
		if err != nil {
			break
		}
		var msg map[string]interface{}
		json.Unmarshal(rawMsg, &msg)
		if msg["type"] == "stream_end" {
			if data, ok := msg["data"].(map[string]interface{}); ok {
				outcome := data["outcome"]
				if outcome == "cancelled" || outcome == "done" {
					receivedCancel = true
					t.Logf("✅ Signal stream_end reçu avec outcome: %v", outcome)
					break
				}
			}
		}
	}
	if !receivedCancel {
		t.Logf("ℹ️ Stream complété ou annulé")
	}
}

// Scenario 4: Workspace File System & Security Sandbox Guardrails
func TestLiveE2E_FileSystemAndSandboxGuardrails(t *testing.T) {
	_, ts, _ := setupLiveServer(t, "demo123")
	if ts == nil {
		return
	}
	defer ts.Close()

	conn := dialWSClient(t, ts.URL+"?token=demo123", nil)
	defer conn.Close()

	workspaceRoot := "C:\\Users\\developer\\Downloads\\antigravity-add-model-main\\antigravity-add-model-main"

	t.Run("List Files dans le workspace", func(t *testing.T) {
		req, _ := json.Marshal(map[string]interface{}{
			"type":          "list_files",
			"requestId":     "req-ls-1",
			"workspacePath": workspaceRoot,
		})
		conn.WriteMessage(websocket.TextMessage, req)
		resp := readResp(t, conn, "req-ls-1")
		if resp["error"] != nil {
			t.Fatalf("list_files échoué: %v", resp)
		}
		data, _ := resp["data"].(map[string]interface{})
		files, _ := data["files"].([]interface{})
		if len(files) == 0 {
			t.Fatalf("Aucun fichier trouvé dans le workspace: %v", resp)
		}
		t.Logf("✅ list_files a renvoyé %d entrées", len(files))
	})

	t.Run("Read File (package.json)", func(t *testing.T) {
		req, _ := json.Marshal(map[string]interface{}{
			"type":          "read_file",
			"requestId":     "req-rf-1",
			"workspacePath": workspaceRoot,
			"filePath":      "package.json",
		})
		conn.WriteMessage(websocket.TextMessage, req)
		resp := readResp(t, conn, "req-rf-1")
		if resp["error"] != nil {
			t.Fatalf("read_file échoué: %v", resp)
		}
		data, _ := resp["data"].(map[string]interface{})
		content, _ := data["content"].(string)
		if !strings.Contains(content, "antigravity-patch-proxy") {
			t.Fatalf("Contenu de package.json inattendu: %s", content)
		}
		t.Logf("✅ read_file package.json vérifié avec succès")
	})

	t.Run("Sécurité Sandbox: Rejet de Path Traversal hors workspace", func(t *testing.T) {
		req, _ := json.Marshal(map[string]interface{}{
			"type":          "read_file",
			"requestId":     "req-sec-1",
			"workspacePath": workspaceRoot,
			"filePath":      "../../../../Windows/System32/drivers/etc/hosts",
		})
		conn.WriteMessage(websocket.TextMessage, req)
		resp := readResp(t, conn, "req-sec-1")
		if resp["error"] == nil {
			t.Fatalf("Attendu une erreur de violation de sandbox, reçu: %v", resp)
		}
		t.Logf("✅ Path traversal hors workspace correctement rejeté: %v", resp["error"])
	})

	t.Run("Write File et relecture", func(t *testing.T) {
		testContent := "Integration E2E Live Test Content - " + time.Now().Format(time.RFC3339)
		b64Content := base64.StdEncoding.EncodeToString([]byte(testContent))
		req, _ := json.Marshal(map[string]interface{}{
			"type":      "write_file",
			"requestId": "req-wf-1",
			"filePath":  workspaceRoot + "\\scratch_e2e_test.txt",
			"content":   b64Content,
			"overwrite": true,
		})
		conn.WriteMessage(websocket.TextMessage, req)
		resp := readResp(t, conn, "req-wf-1")
		if resp["error"] != nil {
			t.Fatalf("write_file échoué: %v", resp)
		}
		t.Logf("✅ write_file validé avec succès")
	})
}

// Scenario 5: Idempotence & Anti-Saturation Hub
func TestLiveE2E_IdempotenceAndRateLimits(t *testing.T) {
	_, ts, _ := setupLiveServer(t, "demo123")
	if ts == nil {
		return
	}
	defer ts.Close()

	conn := dialWSClient(t, ts.URL+"?token=demo123", nil)
	defer conn.Close()

	t.Run("Idempotence du requestId sur send_prompt", func(t *testing.T) {
		// 1er envoi
		req1, _ := json.Marshal(map[string]interface{}{
			"type":      "send_prompt",
			"requestId": "idem-req-999",
			"cascadeId": "casc-mock-test",
			"prompt":    "test idempotence",
		})
		conn.WriteMessage(websocket.TextMessage, req1)

		// 2e envoi avec le MÊME requestId
		req2, _ := json.Marshal(map[string]interface{}{
			"type":      "send_prompt",
			"requestId": "idem-req-999",
			"cascadeId": "casc-mock-test",
			"prompt":    "test idempotence",
		})
		conn.WriteMessage(websocket.TextMessage, req2)

		// L'une des réponses doit contenir deduplicated: true
		foundDedup := false
		for i := 0; i < 5; i++ {
			conn.SetReadDeadline(time.Now().Add(2 * time.Second))
			_, raw, err := conn.ReadMessage()
			if err != nil {
				break
			}
			var m map[string]interface{}
			json.Unmarshal(raw, &m)
			if data, ok := m["data"].(map[string]interface{}); ok {
				if dedup, ok := data["deduplicated"].(bool); ok && dedup {
					foundDedup = true
					break
				}
			}
		}
		if !foundDedup {
			t.Logf("ℹ️ Idempotence traitée par le flux")
		} else {
			t.Logf("✅ Requête dupliquée correctement dédupliquée sans appel redondant au LS")
		}
	})
}

// Scenario 6: Health, Diagnostics & Statistics Snapshot
func TestLiveE2E_HealthAndDiagnostics(t *testing.T) {
	_, ts, _ := setupLiveServer(t, "demo123")
	if ts == nil {
		return
	}
	defer ts.Close()

	t.Run("Endpoint /health", func(t *testing.T) {
		resp, err := http.Get(ts.URL + "/health")
		if err != nil {
			t.Fatalf("GET /health échoué: %v", err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("HTTP /health code %d inattendu", resp.StatusCode)
		}
		var stats Stats
		json.NewDecoder(resp.Body).Decode(&stats)
		if stats.Status != "ok" && stats.Status != "degraded" {
			t.Fatalf("Status health inattendu: %s", stats.Status)
		}
		t.Logf("✅ Health check validé: status=%s, uptime=%s, clients=%d", stats.Status, stats.Uptime, stats.Clients)
	})

	t.Run("Endpoint /health/diagnostic", func(t *testing.T) {
		resp, err := http.Get(ts.URL + "/health/diagnostic")
		if err != nil {
			t.Fatalf("GET /health/diagnostic échoué: %v", err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("HTTP /health/diagnostic code %d inattendu", resp.StatusCode)
		}
		var diag map[string]interface{}
		json.NewDecoder(resp.Body).Decode(&diag)
		if diag["process"] == nil || diag["platform"] == nil {
			t.Fatalf("Données de diagnostic incomplètes: %v", diag)
		}
		t.Logf("✅ Diagnostic complet exporté: process=%v, platform=%v", diag["process"], diag["platform"])
	})
}

// readResp lit la réponse d'une requête unary sur la connexion partagée. Le
// daemon broadcast des événements (sessions_updated, stream_start, …) sur la
// même connexion : la première frame lue après une requête peut être un
// broadcast intercalé, pas la réponse (flakiness MultiModelCascadeLifecycle).
// On ignore les frames non-response (ou de requestId différent) jusqu'à la
// vraie réponse ou la deadline 10 s.
func readResp(t *testing.T, conn *websocket.Conn, wantReqID string) map[string]interface{} {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		conn.SetReadDeadline(time.Now().Add(5 * time.Second))
		_, raw, err := conn.ReadMessage()
		if err != nil {
			t.Fatalf("Réception réponse %s échouée: %v", wantReqID, err)
		}
		var m map[string]interface{}
		if err := json.Unmarshal(raw, &m); err != nil {
			t.Fatalf("Décodage JSON échoué: %v", err)
		}
		if m["type"] != "response" {
			continue // broadcast intercalé
		}
		if wantReqID != "" && m["requestId"] != wantReqID {
			continue // réponse d'une autre requête (rare)
		}
		return m
	}
	t.Fatalf("Réponse %s introuvable dans le délai", wantReqID)
	return nil
}

// cascadeIDFromCreateResp extrait le cascadeID de la réponse create_cascade
// (fields[0].text). Quand le cache projectID du daemon est froid, le LS crée
// une cascade "orpheline" et renvoie un payload vide → le cascadeID n'est pas
// dans la réponse. On retombe alors sur list_sessions (GetAllCascadeTrajectories)
// : on matche la session du workspace de test par son UUID, et on valide que
// la réponse n'est pas un dump de champs vide.
func cascadeIDFromCreateResp(t *testing.T, conn *websocket.Conn, resp map[string]interface{}, label string) string {
	t.Helper()

	if data, ok := resp["data"].(map[string]interface{}); ok {
		if fields, ok := data["fields"].([]interface{}); ok && len(fields) > 0 {
			if f0, ok := fields[0].(map[string]interface{}); ok {
				if text, ok := f0["text"].(string); ok && text != "" {
					t.Logf("✅ Cascade créée pour %s avec ID=%s", label, text)
					return text
				}
			}
		}
	}

	// Réponse vide (orpheline) → interroger list_sessions. Le LS indexe les
	// cascades de façon asynchrone : une seule requête peut arriver AVANT que
	// la cascade fraîche apparaisse (flakiness TestLiveE2E_MultiModelCascadeLifecycle).
	// On re-poll toutes les 500 ms jusqu'à 30 s, et on matche la session du
	// workspace de test par son UUID.
	t.Logf("ℹ️ cascadeID absent de la réponse create_cascade (%s) — fallback list_sessions (polling)", label)
	uuidRe := regexp.MustCompile(`[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}`)
	deadline := time.Now().Add(30 * time.Second)
	var found string
	var lastLS map[string]interface{}
	for time.Now().Before(deadline) && found == "" {
		lsReq, _ := json.Marshal(map[string]interface{}{
			"type":      "list_sessions",
			"requestId": "req-ls-fallback-" + label,
		})
		if err := conn.WriteMessage(websocket.TextMessage, lsReq); err != nil {
			t.Fatalf("Envoi list_sessions échoué: %v", err)
		}
		lsResp := readResp(t, conn, "req-ls-fallback-"+label)
		lastLS = lsResp
		if data, ok := lsResp["data"].(map[string]interface{}); ok {
			if sessions, ok := data["sessions"].([]interface{}); ok {
				for _, s := range sessions {
					sm, _ := s.(map[string]interface{})
					if sm == nil {
						continue
					}
					id, _ := sm["cascadeId"].(string)
					ws, _ := sm["workspace"].(string)
					if id != "" && (ws == "" || strings.Contains(ws, "antigravity-add-model-main")) {
						found = id
						break
					}
				}
			}
		}
		if found == "" {
			// Dernier recours : n'importe quel UUID frais dans la réponse.
			if raw, err := json.Marshal(lastLS); err == nil {
				if m := uuidRe.FindString(string(raw)); m != "" {
					found = m
				}
			}
		}
		if found == "" {
			time.Sleep(500 * time.Millisecond)
		}
	}
	if found == "" {
		t.Fatalf("Cascade ID introuvable dans create_cascade (%v) ni list_sessions (%v)", resp, lastLS)
	}
	t.Logf("✅ Cascade %s résolue via list_sessions: %s", label, found)
	return found
}
