package gateway

// Couverture des 13 types de messages WS sans test direct (audit 2026-08-14) :
// submit_question_response, sync_session, get_session_history, upload_media,
// list_git_branches, list_git_worktrees, list_scheduled_tasks,
// trigger_scheduled_task, cancel_scheduled_task, call_mcp_tool,
// connect_mcp_server, refresh_mcp_oauth_token, stop_generation.
// Patterns réutilisés : fakeRPCClient, dialWS, newTestServer (websocket_test.go).

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// testUUID génère un UUID v4 aléatoire (RFC 4122) — les cascadeId sont validés
// en UUID strict côté serveur (fix path traversal).
func testUUID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	b[6] = (b[6] & 0x0f) | 0x40 // version 4
	b[8] = (b[8] & 0x3f) | 0x80 // variant 10
	h := hex.EncodeToString(b)
	return h[0:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:32]
}

// gitRun exécute une commande git via cmd.exe (nécessaire sur Windows PS5.1 :
// l'invocation directe de git branch/add/status depuis Go échoue avec un code
// d'erreur étrange tant que la sortie du pager est détournée — le wrapper cmd
// restaure le comportement normal, cf. tests manuels 2026-08-14).
func gitRun(dir string, args ...string) (string, error) {
	cmdArgs := append([]string{"-c", "safe.directory=*", "-c", "core.autocrlf=false"}, args...)
	cmd := exec.Command("git", cmdArgs...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	return strings.TrimSpace(string(out)), err
}

// captureClient : wrapper autour de RPCClient qui capture le texte des
// messages fire-and-forget (SendMessageStream) sans toucher au reste du
// contrat — l'interface embarquée fournit toutes les autres méthodes.
type captureClient struct {
	RPCClient
	capture func(text string)
}

func (c *captureClient) SendMessageStream(cascadeID, text string, onFrame func([]byte) error) error {
	c.capture(text)
	return c.RPCClient.SendMessageStream(cascadeID, text, onFrame)
}

// initTempGitRepo crée un dépôt git hermétique (t.TempDir) avec un commit et
// deux branches — pour list_git_branches / list_git_worktrees sans dépendre du
// workspace courant. Skip si git n'est pas installé ou inaccessible.
func initTempGitRepo(t *testing.T) string {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git non installé, test ignoré")
	}
	dir := t.TempDir()
	run := func(args ...string) string {
		t.Helper()
		out, err := gitRun(dir, args...)
		if err != nil {
			t.Skipf("git %v non supporté dans tempdir: %v (%s)", args, err, out)
		}
		return out
	}
	if _, err := gitRun(dir, "init", "-b", "main"); err != nil {
		run("init")
	}
	if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("x"), 0o644); err != nil {
		t.Fatalf("écriture f.txt: %v", err)
	}
	run("add", "-A")
	run("-c", "user.email=test@antigravity.local", "-c", "user.name=Test", "commit", "-m", "init")
	run("branch", "feature/x")
	return dir
}

// --- submit_question_response ---

// Sans approbation en attente : la réponse est envoyée au LS en fire-and-forget
// via SendMessageStream (aucune réponse unary — le flux du LS fait foi), puis
// le prochain prompt répond normalement (le canal n'est pas bloqué).
func TestGapSubmitQuestionResponseNoApproval(t *testing.T) {
	// Le fake capture lastPrompt dans SendMessageStream (fire-and-forget).
	backend := &fakeRPCClient{}
	srv := newTestServer(backend)
	defer srv.Close()

	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	client.sendRaw(t, `{"type":"submit_question_response","requestId":"q1","cascadeId":"casc-q","selectedAnswers":["Option A"],"customAnswer":"détail"}`)

	// La soumission part en goroutine : attente bornée du side-effect.
	deadline := time.Now().Add(2 * time.Second)
	for backend.lastPrompt == "" && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if backend.lastPrompt != "Option A (détail)" {
		t.Fatalf("SendMessageStream attendu avec réponse composée, reçu %q", backend.lastPrompt)
	}

	// Un prompt suivant fonctionne toujours (le canal de lecture est intact).
	client.send(t, map[string]string{
		"type": "send_prompt", "requestId": "r2",
		"cascadeId": "casc-q", "prompt": "suivant",
	})
	for {
		msg := client.recv(t)
		if msg["type"] == "stream_end" {
			break
		}
	}
}

// Avec approbation ask_question en attente : la réponse est soumise via
// SubmitToolApproval (le daemon résout l'approbation avant de répondre).
func TestGapSubmitQuestionResponseWithApproval(t *testing.T) {
	backend := &fakeRPCClient{streamDeltas: []string{
		`{"ask_question":"Voulez-vous continuer ?","step_index":1,"trajectory_id":"123e4567-e89b-12d3-a456-426614174000"}`,
	}}
	srv := newTestServer(backend)
	defer srv.Close()

	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	// 1. Un prompt émet une demande ask_question → l'événement arrive en
	//    stream_delta avec kind=approval_required (pas de message
	//    approval_pending dédié dans le protocole).
	client.send(t, map[string]string{
		"type": "send_prompt", "requestId": "r1",
		"cascadeId": "casc-q", "prompt": "question ?",
	})
	var approvalType string
	for {
		msg := client.recv(t)
		if msg["type"] == "stream_end" {
			t.Fatalf("demande d'approbation jamais émise: %v", msg)
		}
		if msg["type"] != "stream_delta" {
			continue
		}
		data, _ := msg["data"].(map[string]interface{})
		evts, _ := data["events"].([]interface{})
		if len(evts) == 0 {
			continue
		}
		ev0, _ := evts[0].(map[string]interface{})
		if ev0 == nil || ev0["kind"] != "approval_required" {
			continue
		}
		approvalType, _ = ev0["tool"].(string)
		break
	}
	if approvalType != "ask_question" {
		t.Fatalf("approbation ask_question attendue, reçu tool=%q", approvalType)
	}

	// 2. L'utilisateur répond via submit_question_response. La réponse unary
	//    arrive APRÈS le stream_end(outcome=approval) écrit par le goroutine
	//    du stream — on draine jusqu'à la réponse q2.
	client.sendRaw(t, `{"type":"submit_question_response","requestId":"q2","cascadeId":"casc-q","trajectoryId":"123e4567-e89b-12d3-a456-426614174000","stepIndex":1,"selectedAnswers":["Oui"]}`)
	var msg map[string]interface{}
	for {
		msg = client.recv(t)
		if msg["requestId"] == "q2" {
			break
		}
		// stream_end(approval), approval_pending, approval_resolved et sessions_updated sont attendus ici.
		if msg["type"] != "stream_end" && msg["type"] != "approval_pending" && msg["type"] != "approval_resolved" && msg["type"] != "sessions_updated" {
			t.Fatalf("message inattendu avant réponse q2: %v", msg)
		}
	}
	if msg["type"] != "response" || msg["error"] != nil {
		t.Fatalf("réponse inattendue: %v", msg)
	}
	call, ok := backend.lastApproval.(*submitApprovalCall)
	if !ok {
		t.Fatalf("SubmitToolApproval jamais appelé: %v", backend.lastApproval)
	}
	if !call.confirm || call.trajectoryID != "123e4567-e89b-12d3-a456-426614174000" {
		t.Fatalf("approbation soumise invalide: %+v", call)
	}
}

// Sans cascadeId → erreur explicite.
func TestGapSubmitQuestionResponseMissingCascade(t *testing.T) {
	srv := newTestServer(&fakeRPCClient{})
	defer srv.Close()

	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	client.sendRaw(t, `{"type":"submit_question_response","requestId":"q3"}`)
	msg := client.recv(t)
	if msg["type"] != "response" || msg["error"] == nil {
		t.Fatalf("erreur cascadeId requise attendue: %v", msg)
	}
}

// --- sync_session (StepRecovery) ---

// Après un stream, sync_session avec lastStepIndex=0 renvoie les deltas manqués
// (sync_catchup) + le stepIndex courant.
func TestGapSyncSessionCatchup(t *testing.T) {
	backend := &fakeRPCClient{streamDeltas: []string{"hello", " world"}}
	srv := newTestServer(backend)
	defer srv.Close()

	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	// Remplit le buffer StepRecovery avec 1 delta (stepIndex=1).
	client.send(t, map[string]string{
		"type": "send_prompt", "requestId": "r1",
		"cascadeId": "casc-sync", "prompt": "test",
	})
	deltaCount := 0
	for {
		msg := client.recv(t)
		if msg["type"] == "stream_delta" {
			deltaCount++
		}
		if msg["type"] == "stream_end" {
			break
		}
	}
	if deltaCount == 0 {
		t.Fatal("aucun delta streamé")
	}

	// Reconnexion simulée : demande des événements manqués depuis 0.
	client.sendRaw(t, `{"type":"sync_session","requestId":"s1","cascadeId":"casc-sync","lastStepIndex":0}`)
	msg := client.recv(t)
	if msg["type"] != "sync_catchup" || msg["requestId"] != "s1" {
		t.Fatalf("sync_catchup attendu: %v", msg)
	}
	data, _ := msg["data"].(map[string]interface{})
	missed, _ := data["missedEvents"].([]interface{})
	if len(missed) == 0 {
		t.Fatalf("missedEvents attendus: %v", data)
	}
	cur, _ := data["currentStepIndex"].(float64)
	if cur != float64(deltaCount) {
		t.Fatalf("currentStepIndex=%v attendu %d: %v", cur, deltaCount, data)
	}
}

// Sans cascadeId → erreur.
func TestGapSyncSessionMissingCascade(t *testing.T) {
	srv := newTestServer(&fakeRPCClient{})
	defer srv.Close()

	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	client.sendRaw(t, `{"type":"sync_session","requestId":"s2"}`)
	msg := client.recv(t)
	if msg["type"] != "response" || msg["error"] == nil {
		t.Fatalf("erreur cascadeId requise attendue: %v", msg)
	}
}

// --- get_session_history ---

// Cascade sans transcript local → historique vide (jamais une erreur).
func TestGapGetSessionHistoryEmpty(t *testing.T) {
	srv := newTestServer(&fakeRPCClient{})
	defer srv.Close()

	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	client.send(t, map[string]string{
		"type": "get_session_history", "requestId": "h1", "cascadeId": "casc-inconnue-xyz",
	})
	msg := client.recv(t)
	if msg["type"] != "response" || msg["error"] != nil {
		t.Fatalf("réponse inattendue: %v", msg)
	}
	data, _ := msg["data"].(map[string]interface{})
	if msgs, ok := data["messages"].([]interface{}); !ok || len(msgs) != 0 {
		t.Fatalf("messages vide attendu: %v", data)
	}
}

// Sans cascadeId → erreur.
func TestGapGetSessionHistoryMissingCascade(t *testing.T) {
	srv := newTestServer(&fakeRPCClient{})
	defer srv.Close()

	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	client.sendRaw(t, `{"type":"get_session_history","requestId":"h2"}`)
	msg := client.recv(t)
	if msg["type"] != "response" || msg["error"] == nil {
		t.Fatalf("erreur cascadeId is required attendue: %v", msg)
	}
}

// --- upload_media ---

// Un média base64 est écrit dans le scratch de la cascade et référencé en
// markdown. Le fichier est nettoyé après le test.
func TestGapUploadMedia(t *testing.T) {
	srv := newTestServer(&fakeRPCClient{})
	defer srv.Close()

	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	// UUID v4 strict exigé (fix path traversal : un cascadeId non-UUID est rejeté).
	cid := testUUID()
	b64 := base64.StdEncoding.EncodeToString([]byte("fake image bytes"))
	req, _ := json.Marshal(map[string]interface{}{
		"type": "upload_media", "requestId": "u1",
		"cascadeId": cid, "fileName": "photo.png", "base64Data": b64,
	})
	if err := client.conn.WriteMessage(1, req); err != nil {
		t.Fatalf("envoi upload_media: %v", err)
	}
	msg := client.recv(t)
	if msg["type"] != "response" || msg["error"] != nil {
		t.Fatalf("réponse inattendue: %v", msg)
	}
	data, _ := msg["data"].(map[string]interface{})
	filePath, _ := data["filePath"].(string)
	mdRef, _ := data["markdownRef"].(string)
	if filePath == "" || !strings.HasPrefix(mdRef, "![Uploaded Image](file:///") {
		t.Fatalf("upload invalide: %v", data)
	}
	if _, err := os.Stat(filePath); err != nil {
		t.Fatalf("fichier uploadé introuvable: %v", err)
	}
	os.Remove(filePath)

	// Sans base64Data → erreur.
	client.sendRaw(t, `{"type":"upload_media","requestId":"u2","cascadeId":"casc-x"}`)
	msg2 := client.recv(t)
	if msg2["type"] != "response" || msg2["error"] == nil {
		t.Fatalf("erreur base64Data requise attendue: %v", msg2)
	}
}

// --- list_git_branches / list_git_worktrees ---

func TestGapListGitBranches(t *testing.T) {
	dir := initTempGitRepo(t)
	srv := newTestServer(&fakeRPCClient{})
	defer srv.Close()

	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	req, _ := json.Marshal(map[string]interface{}{
		"type": "list_git_branches", "requestId": "b1", "workspacePath": dir,
	})
	if err := client.conn.WriteMessage(1, req); err != nil {
		t.Fatalf("envoi list_git_branches: %v", err)
	}
	msg := client.recv(t)
	if msg["type"] != "response" || msg["error"] != nil {
		t.Fatalf("réponse inattendue: %v", msg)
	}
	data, _ := msg["data"].(map[string]interface{})
	branches, _ := data["branches"].([]interface{})
	joined := strings.Join(toStrings(branches), " ")
	if !strings.Contains(joined, "main") || !strings.Contains(joined, "feature/x") {
		t.Fatalf("branches attendues main + feature/x, reçu: %v", branches)
	}
}

func TestGapListGitWorktrees(t *testing.T) {
	dir := initTempGitRepo(t)
	srv := newTestServer(&fakeRPCClient{})
	defer srv.Close()

	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	req, _ := json.Marshal(map[string]interface{}{
		"type": "list_git_worktrees", "requestId": "w1", "workspacePath": dir,
	})
	if err := client.conn.WriteMessage(1, req); err != nil {
		t.Fatalf("envoi list_git_worktrees: %v", err)
	}
	msg := client.recv(t)
	if msg["type"] != "response" || msg["error"] != nil {
		t.Fatalf("réponse inattendue: %v", msg)
	}
	data, _ := msg["data"].(map[string]interface{})
	wts, _ := data["worktrees"].([]interface{})
	if len(wts) == 0 {
		t.Fatalf("au moins le worktree principal attendu: %v", data)
	}
	first, _ := wts[0].(map[string]interface{})
	if first == nil || first["path"] == nil || first["branch"] == nil {
		t.Fatalf("worktree incomplet: %v", wts[0])
	}
}

func toStrings(in []interface{}) []string {
	out := make([]string, 0, len(in))
	for _, v := range in {
		if s, ok := v.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

// --- list_scheduled_tasks / trigger / cancel ---

func TestGapScheduledTasks(t *testing.T) {
	srv := newTestServer(&fakeRPCClient{})
	defer srv.Close()

	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	// Liste (vide par défaut — le daemon ne crée pas de tâches).
	client.send(t, map[string]string{"type": "list_scheduled_tasks", "requestId": "t1"})
	msg := client.recv(t)
	if msg["type"] != "response" || msg["error"] != nil {
		t.Fatalf("réponse inattendue: %v", msg)
	}
	if data, _ := msg["data"].(map[string]interface{}); data["tasks"] == nil {
		t.Fatalf("data.tasks attendu: %v", msg)
	}

	// Déclenchement : refus explicite (aucun moteur cron dans le daemon —
	// plus de mock "done" en production).
	client.send(t, map[string]string{"type": "trigger_scheduled_task", "requestId": "t2", "taskId": "cron-1"})
	msg2 := client.recv(t)
	if msg2["type"] != "response" || msg2["error"] == nil {
		t.Fatalf("trigger attendu avec erreur explicite (cron non implémenté): %v", msg2)
	}

	// Annulation : ack immédiat — le handler diffuse d'abord
	// scheduled_task_deleted (broadcast), puis répond en unary.
	client.send(t, map[string]string{"type": "cancel_scheduled_task", "requestId": "t3", "taskId": "cron-2"})
	first := client.recv(t)
	if first["type"] != "scheduled_task_deleted" {
		t.Fatalf("broadcast attendu en premier: %v", first)
	}
	msg3 := client.recv(t)
	data3, _ := msg3["data"].(map[string]interface{})
	if msg3["type"] != "response" || data3 == nil || data3["status"] != "cancelled" || data3["taskId"] != "cron-2" {
		t.Fatalf("cancel inattendu: %v", msg3)
	}
}

// --- call_mcp_tool / connect_mcp_server / refresh_mcp_oauth_token ---

// Le daemon relaie vers le proxy MCP desktop (127.0.0.1:50999) qui n'existe
// pas forcément en test. Contrat vérifié : (a) serverName manquant → erreur
// explicite (déterministe), (b) sinon → réponse unary avec soit une erreur du
// proxy (injoignable / 4xx), soit des données JSON relayées.
func TestGapMcpActions(t *testing.T) {
	srv := newTestServer(&fakeRPCClient{})
	defer srv.Close()

	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	// (a) serverName requis — chemin 100% déterministe, sans proxy.
	for _, typ := range []string{"call_mcp_tool", "connect_mcp_server", "refresh_mcp_oauth_token"} {
		req, _ := json.Marshal(map[string]interface{}{"type": typ, "requestId": "m-" + typ})
		if err := client.conn.WriteMessage(1, req); err != nil {
			t.Fatalf("envoi %s: %v", typ, err)
		}
		msg := client.recv(t)
		if msg["type"] != "response" || msg["error"] == nil {
			t.Fatalf("%s sans serverName: erreur attendue, reçu %v", typ, msg)
		}
		if !strings.Contains(msg["error"].(string), "serverName") {
			t.Fatalf("%s: erreur inattendue: %v", typ, msg["error"])
		}
	}

	// (b) avec serverName : le proxy répond OU est injoignable — les deux
	// sont des réponses valides (le mobile affiche l'erreur du proxy).
	req, _ := json.Marshal(map[string]interface{}{
		"type": "call_mcp_tool", "requestId": "m-tool",
		"serverName": "filesystem", "toolName": "list",
	})
	if err := client.conn.WriteMessage(1, req); err != nil {
		t.Fatalf("envoi call_mcp_tool: %v", err)
	}
	msg := client.recv(t)
	if msg["type"] != "response" || msg["requestId"] != "m-tool" {
		t.Fatalf("réponse unary attendue: %v", msg)
	}
	if msg["error"] == nil && msg["data"] == nil {
		t.Fatalf("erreur OU data attendus: %v", msg)
	}

	// (c) list_mcp_servers : listing sans serverName — la réponse du proxy
	// (ou son indisponibilité) est relayée telle quelle.
	reqList, _ := json.Marshal(map[string]interface{}{
		"type": "list_mcp_servers", "requestId": "m-list",
	})
	if err := client.conn.WriteMessage(1, reqList); err != nil {
		t.Fatalf("envoi list_mcp_servers: %v", err)
	}
	msgList := client.recv(t)
	if msgList["type"] != "response" || msgList["requestId"] != "m-list" {
		t.Fatalf("réponse unary attendue pour list_mcp_servers: %v", msgList)
	}
	if msgList["error"] == nil && msgList["data"] == nil {
		t.Fatalf("erreur OU data attendus pour list_mcp_servers: %v", msgList)
	}
}

// --- stop_generation (alias cancel_generation) ---

func TestGapStopGeneration(t *testing.T) {
	srv := newTestServer(&fakeRPCClient{})
	defer srv.Close()

	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	client.send(t, map[string]string{"type": "stop_generation", "requestId": "g1", "cascadeId": "casc-stop"})
	gotStreamEnd := false
	gotResponse := false
	for i := 0; i < 5; i++ {
		m := client.recv(t)
		if m["type"] == "stream_end" {
			gotStreamEnd = true
			if data, _ := m["data"].(map[string]interface{}); data == nil || data["outcome"] != "cancelled" {
				t.Fatalf("outcome=cancelled attendu: %v", m)
			}
		}
		if m["type"] == "response" && m["requestId"] == "g1" {
			gotResponse = true
			data, _ := m["data"].(map[string]interface{})
			if data == nil || data["status"] != "cancelled" {
				t.Fatalf("réponse cancelled attendue: %v", m)
			}
			break
		}
	}
	if !gotStreamEnd || !gotResponse {
		t.Fatalf("stream_end et réponse attendus (gotStreamEnd=%v, gotResponse=%v)", gotStreamEnd, gotResponse)
	}

	// Sans cascadeId → erreur.
	client.send(t, map[string]string{"type": "stop_generation", "requestId": "g2"})
	msg2 := client.recv(t)
	if msg2["type"] != "response" || msg2["error"] == nil {
		t.Fatalf("erreur cascadeId requise attendue: %v", msg2)
	}
}

// --- type inconnu → erreur explicite (frontière de protocole) ---

func TestGapUnknownActionType(t *testing.T) {
	srv := newTestServer(&fakeRPCClient{})
	defer srv.Close()

	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	client.send(t, map[string]string{"type": "action_inconnue", "requestId": "x1"})
	msg := client.recv(t)
	if msg["type"] != "error" || !strings.Contains(msg["error"].(string), "Unknown action type") {
		t.Fatalf("erreur Unknown action type attendue: %v", msg)
	}
}

// --- ping → pong (keep-alive applicatif, latence mesurable) ---

func TestGapPingPong(t *testing.T) {
	srv := newTestServer(&fakeRPCClient{})
	defer srv.Close()

	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	client.send(t, map[string]string{"type": "ping", "requestId": "p1"})
	msg := client.recv(t)
	if msg["type"] != "pong" || msg["requestId"] != "p1" {
		t.Fatalf("pong attendu: %v", msg)
	}
	if data, _ := msg["data"].(map[string]interface{}); data["ts"] == nil {
		t.Fatalf("data.ts (timestamp) attendu: %v", msg)
	}
}

// --- Origine : vérifie que checkOrigin accepte les clients natifs et rejette
// les navigateurs arbitraires (CSWSH). ---

func TestGapCheckOrigin(t *testing.T) {
	req, _ := http.NewRequest("GET", "http://127.0.0.1:8090/ws", nil)
	if !checkOrigin(req) {
		t.Error("Origin absent (client natif) doit être accepté")
	}
	req.Header.Set("Origin", "http://192.168.1.42:3000")
	if !checkOrigin(req) {
		t.Error("Origin LAN privé doit être accepté")
	}
	req.Header.Set("Origin", "https://evil.example.com")
	if checkOrigin(req) {
		t.Error("Origin arbitraire doit être rejeté (CSWSH)")
	}
	req.Header.Set("Origin", "https://abc.trycloudflare.com")
	if !checkOrigin(req) {
		t.Error("Origin tunnel Cloudflare doit être accepté")
	}
}

// --- sessionsOut (filtre Antigravity 2.0) ---

// sessionsOut exclut archived/killed/subagent et trie par updatedAt décroissant.
// Le fallback local ne s'applique qu'en l'absence totale de trajectoires.
func TestGapListSessionsOut(t *testing.T) {
	// Mini-encodeur protobuf local (le writer de connectrpc n'est pas exporté).
	type pbw struct{ b []byte }
	varint := func(v uint64) []byte {
		var out []byte
		for v >= 0x80 {
			out = append(out, byte(v)|0x80)
			v >>= 7
		}
		return append(out, byte(v))
	}
	key := func(n, wt int) []byte { return varint(uint64(n<<3 | wt)) }
	u64 := func(n int, v uint64) []byte { return append(key(n, 0), varint(v)...) }
	str := func(n int, s string) []byte {
		return append(append(key(n, 2), varint(uint64(len(s)))...), s...)
	}
	bytes := func(n int, b []byte) []byte {
		return append(append(key(n, 2), varint(uint64(len(b)))...), b...)
	}

	type tc struct {
		name   string
		frame  func() []byte
		expect int
	}
	cases := []tc{
		{
			name: "filtre archived/killed/subagent",
			frame: func() []byte {
				var raw []byte
				// 5 sessions : 2 READY conservées, 1 archived, 1 killed,
				// 1 source=16 (subagent).
				for _, s := range []struct {
					id       string
					archived bool
					killed   bool
					source   uint64
				}{
					{"11111111-1111-4111-8111-111111111111", false, false, 1},
					{"22222222-2222-4222-8222-222222222222", true, false, 1},
					{"33333333-3333-4333-8333-333333333333", false, true, 1},
					{"44444444-4444-4444-8444-444444444444", false, false, 16},
					{"55555555-5555-4555-8555-555555555555", false, false, 1},
				} {
					var blob []byte
					blob = append(blob, str(1, s.id)...)
					blob = append(blob, str(2, "titre session")...)
					blob = append(blob, u64(3, 1700000000)...) // timestamp secondes
					blob = append(blob, u64(22, 4)...)         // CASCADE_STATUS_READY
					blob = append(blob, u64(20, s.source)...)
					if s.archived {
						blob = append(blob, bytes(15, u64(4, 1))...) // annotations.archived
					}
					if s.killed {
						blob = append(blob, u64(23, 1)...)
					}
					raw = append(raw, bytes(1, blob)...)
				}
				return raw
			},
			expect: 2,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			out := sessionsOut(c.frame())
			data, _ := out.(map[string]interface{})
			sessions, _ := data["sessions"].([]map[string]interface{})
			if len(sessions) != c.expect {
				t.Fatalf("attendu %d sessions après filtre, reçu %d: %v", c.expect, len(sessions), data)
			}
		})
	}

	// Réponse vide → clé sessions présente (jamais nil) + fallback local si dispo.
	out := sessionsOut([]byte{})
	data, _ := out.(map[string]interface{})
	if sessions, ok := data["sessions"].([]map[string]interface{}); !ok || sessions == nil {
		t.Fatalf("sessions vide attendu (jamais nil): %v", data)
	}
}
