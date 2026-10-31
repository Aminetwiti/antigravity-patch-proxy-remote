package gateway

import (
	"encoding/json"
	"fmt"
	"runtime"
	"strings"
	"testing"
	"time"
)

// ---------------------------------------------------------------------------
// Terminal PTY (P3) — tests d'intégration des bugs corrigés :
//  1. terminal_write/terminal_kill n'avaient AUCUN handler côté serveur →
//     le mobile recevait "Unknown action type" et AUCUNE commande ne
//     s'exécutait. (bug #1)
//  2. killAll() au disconnect tuait les sessions de TOUS les clients →
//     un téléphone qui se déconnecte coupait le shell d'un autre. (bug #2)
//  3. Une session dont le shell sort tout seul (exit) restait zombie dans
//     la map jusqu'à la déconnexion. (bug #3)
//
// NB : le owner d'une session est le *websocket.Conn CÔTÉ SERVEUR (unique par
// connexion). Les tests vérifient donc l'état via gw.terminals.sessions[id]
// (map interne) et non via le pointeur côté client.
// ---------------------------------------------------------------------------

// sendTerminalJSON envoie un message JSON propre (json.Marshal — évite les
// newlines littérales qui cassent le parseur serveur).
func sendTerminalJSON(t *testing.T, c *wsTestClient, payload map[string]interface{}) {
	t.Helper()
	b, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("Marshal échoué: %v", err)
	}
	if err := c.conn.WriteMessage(1, b); err != nil { // 1 = TextMessage
		t.Fatalf("Envoi WebSocket échoué: %v", err)
	}
}

// echoCmd : commande echo adaptée au shell du manager.
func echoCmd(t *testing.T, shell string) string {
	t.Helper()
	if strings.Contains(shell, "cmd") {
		return "echo PTY_TEST_MARKER\r\n"
	}
	return "echo PTY_TEST_MARKER\n"
}

// waitSessions attend que le manager ait exactement n sessions actives
// (timeout 5 s) — pour absorber l'asynchronisme des goroutines Wait/kill.
func waitSessions(t *testing.T, gw *Server, n int) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		gw.terminals.mu.Lock()
		cur := len(gw.terminals.sessions)
		gw.terminals.mu.Unlock()
		if cur == n || time.Now().After(deadline) {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func recvResponse(t *testing.T, client *wsTestClient, reqID string) map[string]interface{} {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		if time.Now().After(deadline) {
			t.Fatalf("Timeout en attente de réponse pour requestId=%s", reqID)
		}
		msg := client.recv(t)
		if msg["type"] == "response" && msg["requestId"] == reqID {
			return msg
		}
	}
}

func TestTerminalWriteHandlerWorks(t *testing.T) {
	srv, gw := newTestServerWithGW(&fakeRPCClient{})
	defer srv.Close()
	gw.SetAllowRemoteTerminal(true)

	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	// terminal_create → réponse {id}
	client.send(t, map[string]string{"type": "terminal_create", "requestId": "t1", "workspacePath": "."})
	resp := recvResponse(t, client, "t1")
	if resp["type"] != "response" || resp["error"] != nil {
		t.Fatalf("terminal_create a échoué: %v", resp)
	}
	id, _ := resp["data"].(map[string]interface{})["id"].(string)
	if id == "" {
		t.Fatalf("Pas d'id de terminal: %v", resp)
	}

	// terminal_write (clé `id`, comme le mobile l'envoie réellement) →
	// le handler EXISTE désormais et répond ok.
	sendTerminalJSON(t, client, map[string]interface{}{
		"type": "terminal_write", "requestId": "t2", "id": id, "input": echoCmd(t, gw.terminals.shellPath),
	})
	wr := recvResponse(t, client, "t2")
	if wr["type"] != "response" || wr["error"] != nil {
		t.Fatalf("terminal_write a échoué (bug #1) : %v", wr)
	}
	if wr["data"].(map[string]interface{})["status"] != "ok" {
		t.Fatalf("terminal_write status inattendu: %v", wr)
	}

	// La sortie du shell doit arriver en broadcast terminal_output (le
	// echo est poussé par la goroutine pump). Deadline courte : si rien
	// ne vient, le handler ne branchait pas stdin (bug #1).
	client.conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	defer client.conn.SetReadDeadline(time.Time{})
	gotMarker := false
	for {
		msg, err := client.recvSafe()
		if err != nil {
			break
		}
		if msg["type"] == "terminal_output" {
			if d, _ := msg["data"].(map[string]interface{})["data"].(string); strings.Contains(d, "PTY_TEST_MARKER") {
				gotMarker = true
				break
			}
		}
	}
	if !gotMarker {
		t.Fatalf("Aucune sortie echo reçue : le shell n'a pas exécuté l'entrée")
	}
}

// TestTerminalOwnerScopedKill : le killAll global tuait les sessions de tous
// les clients. Chaque session appartient désormais à SON client : la
// déconnexion du client A ne doit PAS tuer la session du client B.
func TestTerminalOwnerScopedKill(t *testing.T) {
	srv, gw := newTestServerWithGW(&fakeRPCClient{})
	defer srv.Close()
	gw.SetAllowRemoteTerminal(true)

	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"
	clientA := dialWS(t, url)
	defer clientA.conn.Close()
	clientB := dialWS(t, url)
	defer clientB.conn.Close()

	// A crée une session.
	clientA.send(t, map[string]string{"type": "terminal_create", "requestId": "a1", "workspacePath": "."})
	resp := clientA.recv(t)
	idA, _ := resp["data"].(map[string]interface{})["id"].(string)
	if idA == "" {
		t.Fatalf("Pas d'id pour A: %v", resp)
	}
	waitSessions(t, gw, 1)

	// A se déconnecte (fermeture propre du socket).
	clientA.conn.Close()
	// Laisse le defer HandleWebSocket s'exécuter (killAllFor du client A).
	waitSessions(t, gw, 0)

	// … et celle de B (créée APRÈS) existe toujours : la déconnexion de A
	// n'a tué que SES sessions.
	clientB.send(t, map[string]string{"type": "terminal_create", "requestId": "b1", "workspacePath": "."})
	respB := clientB.recv(t)
	idB, _ := respB["data"].(map[string]interface{})["id"].(string)
	if idB == "" {
		t.Fatalf("Pas d'id pour B: %v", respB)
	}
	waitSessions(t, gw, 1)
	gw.terminals.mu.Lock()
	_, alive := gw.terminals.sessions[idB]
	gw.terminals.mu.Unlock()
	if !alive {
		t.Fatalf("La session de B (%s) aurait dû survivre à la déconnexion de A", idB)
	}
	_ = idA
}

// TestTerminalOwnerCannotWriteForeign : le owner-scoping interdit à un client
// d'écrire dans la session d'un autre (shell sur le PC hôte = surface sensible).
func TestTerminalOwnerCannotWriteForeign(t *testing.T) {
	srv, gw := newTestServerWithGW(&fakeRPCClient{})
	defer srv.Close()
	gw.SetAllowRemoteTerminal(true)

	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"
	clientA := dialWS(t, url)
	defer clientA.conn.Close()
	clientB := dialWS(t, url)
	defer clientB.conn.Close()

	clientA.send(t, map[string]string{"type": "terminal_create", "requestId": "a1", "workspacePath": "."})
	resp := clientA.recv(t)
	idA, _ := resp["data"].(map[string]interface{})["id"].(string)
	if idA == "" {
		t.Fatalf("Pas d'id pour A: %v", resp)
	}

	// B tente d'écrire dans la session de A → refus explicite.
	sendTerminalJSON(t, clientB, map[string]interface{}{
		"type": "terminal_write", "requestId": "b2", "id": idA, "input": "ls\n",
	})
	wr := clientB.recv(t)
	if wr["type"] != "response" || wr["error"] == nil {
		t.Fatalf("B aurait dû être refusé sur la session de A: %v", wr)
	}
	if !strings.Contains(wr["error"].(string), "non poss") {
		t.Fatalf("Refus attendu 'non possédé', reçu: %v", wr["error"])
	}
}

// TestTerminalSpontaneousExitCleansUp : une session dont le shell sort tout
// seul (commande exit) doit être retirée de la map — sinon zombie jusqu'à la
// déconnexion (fuite de processus/goroutines).
func TestTerminalSpontaneousExitCleansUp(t *testing.T) {
	srv, gw := newTestServerWithGW(&fakeRPCClient{})
	defer srv.Close()
	gw.SetAllowRemoteTerminal(true)

	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	client.send(t, map[string]string{"type": "terminal_create", "requestId": "t1", "workspacePath": "."})
	resp := client.recv(t)
	id, _ := resp["data"].(map[string]interface{})["id"].(string)
	if id == "" {
		t.Fatalf("Pas d'id: %v", resp)
	}
	waitSessions(t, gw, 1)

	// Commande exit (Windows: exit\r\n ; Unix: exit\n).
	exit := "exit\n"
	if runtime.GOOS == "windows" {
		exit = "exit\r\n"
	}

	sendTerminalJSON(t, client, map[string]interface{}{
		"type": "terminal_write", "requestId": "t2", "id": id, "input": exit,
	})
	_ = client.recv(t) // consume response to terminal_write

	// Le shell sort → la goroutine Wait retire la session de la map.
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		gw.terminals.mu.Lock()
		_, still := gw.terminals.sessions[id]
		gw.terminals.mu.Unlock()
		if !still {
			break
		}
		_ = client.conn.SetReadDeadline(time.Now().Add(100 * time.Millisecond))
		_, _ = client.recvSafe()
		time.Sleep(50 * time.Millisecond)
	}
	gw.terminals.mu.Lock()
	_, still := gw.terminals.sessions[id]
	gw.terminals.mu.Unlock()
	if still {
		t.Fatalf("Session sortie spontanément toujours dans la map (bug #3)")
	}
}

// TestTerminalIDAltParsing : le mobile envoie la clé `id` — elle doit être
// parsée dans TerminalIDAlt (backward-compat).
func TestTerminalIDAltParsing(t *testing.T) {
	var msg IncomingMessage
	if err := json.Unmarshal([]byte(`{"type":"terminal_write","id":"pty-1","input":"ls"}`), &msg); err != nil {
		t.Fatalf("Unmarshal échoué: %v", err)
	}
	if msg.TerminalIDAlt != "pty-1" || msg.Input != "ls" {
		t.Fatalf("Parsing TerminalIDAlt échoué: %+v", msg)
	}
}

// TestTerminalCreateForbiddenWithoutPermission (VULN-01) : sans flag serveur
// allowRemoteTerminal ni statut Admin, terminal_create doit être rejeté.
func TestTerminalCreateForbiddenWithoutPermission(t *testing.T) {
	srv, gw := newTestServerWithGW(&fakeRPCClient{})
	defer srv.Close()
	// allowRemoteTerminal est false par défaut

	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	client.send(t, map[string]string{"type": "terminal_create", "requestId": "deny1", "workspacePath": "."})
	resp := recvResponse(t, client, "deny1")
	if resp["error"] == nil {
		t.Fatalf("terminal_create aurait dû être rejeté sans permission: %v", resp)
	}
	errStr, _ := resp["error"].(string)
	if !strings.Contains(errStr, "accès refusé") {
		t.Fatalf("Message d'erreur inattendu: %q", errStr)
	}
	gw.terminals.mu.Lock()
	sessCount := len(gw.terminals.sessions)
	gw.terminals.mu.Unlock()
	if sessCount != 0 {
		t.Fatalf("Aucune session terminal ne devrait être créée: count=%d", sessCount)
	}
}


var _ = fmt.Sprintf // garde-import si les cas changent
