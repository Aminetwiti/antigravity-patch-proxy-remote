package gateway

import (
	"fmt"
	"math/rand"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/antigravity/remote-daemon/pkg/connectrpc"
	"github.com/gorilla/websocket"
)

// ─── Test de robustesse : malformed / types invalides ───

// TestWebSocketMalformedJSON — un JSON invalide ne doit pas couper la connexion,
// mais répondre "error" puis rester utilisable.
func TestWebSocketMalformedJSON(t *testing.T) {
	srv := newTestServer(&fakeRPCClient{})
	defer srv.Close()

	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	// Envoie des octets non-JSON.
	if err := client.conn.WriteMessage(websocket.TextMessage, []byte("{not json")); err != nil {
		t.Fatalf("Envoi malformed échoué: %v", err)
	}
	resp := client.recv(t)
	if resp["type"] != "error" {
		t.Fatalf("Attendu un message d'erreur, reçu %v", resp)
	}

	// La connexion doit rester vivante : heartbeat fonctionne encore.
	client.send(t, map[string]string{"type": "heartbeat", "requestId": "r2"})
	if resp := client.recv(t); resp["type"] != "response" {
		t.Fatalf("Heartbeat après malformed a échoué: %v", resp)
	}
}

// TestWebSocketPingKeepAlive — le keep-alive applicatif du mobile
// ({"type":"ping"} toutes les 20 s) reçoit un "pong" et la connexion reste
// utilisable ensuite (heartbeat fonctionne). C'est ce ping qui garde la
// connexion ouverte en arrière-plan : chaque frame reçue reset le read
// deadline (pongWait), donc une réponse n'est pas requise côté serveur,
// mais elle permet au client de mesurer la latence.
func TestWebSocketPingKeepAlive(t *testing.T) {
	srv := newTestServer(&fakeRPCClient{})
	defer srv.Close()

	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	client.send(t, map[string]string{"type": "ping", "requestId": "k1"})
	resp := client.recv(t)
	if resp["type"] != "pong" {
		t.Fatalf("Attendu un pong, reçu %v", resp)
	}
	if resp["requestId"] != "k1" {
		t.Fatalf("Le pong doit porter le requestId d'origine, reçu %v", resp["requestId"])
	}

	// La connexion doit rester vivante après le ping.
	client.send(t, map[string]string{"type": "heartbeat", "requestId": "k2"})
	if resp := client.recv(t); resp["type"] != "response" {
		t.Fatalf("Heartbeat après ping a échoué: %v", resp)
	}
}

// TestWebSocketUnknownAction — un type d'action inconnu renvoie une erreur
// mais ne coupe pas la connexion.
func TestWebSocketUnknownAction(t *testing.T) {
	srv := newTestServer(&fakeRPCClient{})
	defer srv.Close()

	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	client.send(t, map[string]string{"type": "fly_to_moon", "requestId": "rX"})
	resp := client.recv(t)
	if resp["type"] != "error" || resp["error"] == nil {
		t.Fatalf("Attendu erreur Unknown action, reçu %v", resp)
	}
}

// TestWebSocketCreateCascadeRequiresWorkspace — create_cascade sans workspace
// renvoie une erreur propre.
func TestWebSocketCreateCascadeRequiresWorkspace(t *testing.T) {
	srv := newTestServer(&fakeRPCClient{})
	defer srv.Close()

	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	client.send(t, map[string]string{"type": "create_cascade", "requestId": "rC"})
	resp := client.recv(t)
	if resp["error"] == nil {
		t.Fatalf("Attendu une erreur workspace manquant, reçu %v", resp)
	}
}

// TestWebSocketCreateCascadeModelPropagation - le modèle sélectionné dans
// l'app mobile (modelUID) traverse le WebSocket jusqu'à CreateCascade ; en
// l'absence de sélection, le repli historique (190) est conservé.
func TestWebSocketCreateCascadeModelPropagation(t *testing.T) {
	t.Run("modelUID transmis", func(t *testing.T) {
		backend := &fakeRPCClient{}
		srv := newTestServer(backend)
		defer srv.Close()

		client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
		defer client.conn.Close()

		client.send(t, map[string]string{
			"type": "create_cascade", "requestId": "rM",
			"workspaceUri": "file:///C:/proj",
			"modelUID":     "gemini-3.1-pro-low",
		})
		resp := client.recv(t)
		if resp["error"] != nil {
			t.Fatalf("create_cascade a renvoyé une erreur: %v", resp["error"])
		}
		if backend.lastCascade == nil {
			t.Fatal("CreateCascade n'a jamais été appelé")
		}
		if backend.lastCascade.modelUID != "gemini-3.1-pro-low" {
			t.Errorf("Attendu modelUID=gemini-3.1-pro-low, reçu %q", backend.lastCascade.modelUID)
		}
		if backend.lastCascade.modelEnum != 0 {
			t.Errorf("Attendu modelEnum=0 (repli inactif quand UID présent), reçu %d", backend.lastCascade.modelEnum)
		}
	})

	t.Run("repli enum défaut (DefaultModelEnum)", func(t *testing.T) {
		backend := &fakeRPCClient{}
		srv := newTestServer(backend)
		defer srv.Close()

		client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
		defer client.conn.Close()

		client.send(t, map[string]string{
			"type": "create_cascade", "requestId": "rE",
			"workspaceUri": "file:///C:/proj",
		})
		resp := client.recv(t)
		if resp["error"] != nil {
			t.Fatalf("create_cascade a renvoyé une erreur: %v", resp["error"])
		}
		if backend.lastCascade == nil {
			t.Fatal("CreateCascade n'a jamais été appelé")
		}
		if backend.lastCascade.modelEnum != connectrpc.DefaultModelEnum {
			t.Errorf("Attendu repli modelEnum=%d, reçu %d", connectrpc.DefaultModelEnum, backend.lastCascade.modelEnum)
		}
		if backend.lastCascade.modelUID != "" {
			t.Errorf("Attendu modelUID vide (repli enum), reçu %q", backend.lastCascade.modelUID)
		}
	})
}

// ─── Test de concurrence : N clients simultanés ───

type loadRPCClient struct {
	heartbeats   atomic.Int64
	streamDeltas []string
	lastApproval interface{}
}

func (l *loadRPCClient) Heartbeat() ([]byte, error) {
	l.heartbeats.Add(1)
	return connectrpc.Frame(pbTextFrame("ok")), nil
}
func (l *loadRPCClient) CreateCascade(uri string, projectID string, modelUID string, modelEnum uint64) ([]byte, error) {
	return connectrpc.Frame(pbTextFrame("casc-1")), nil
}
func (l *loadRPCClient) GetAllCascades() ([]byte, error) {
	return connectrpc.Frame(pbTextFrame("sess")), nil
}
func (l *loadRPCClient) SendMessageStream(cascadeID, text string, onFrame func([]byte) error) error {
	return l.streamLoop(onFrame)
}
func (l *loadRPCClient) SendMessageStreamModel(cascadeID, text, modelUID string, modelEnum uint64, onFrame func([]byte) error, noTools ...bool) error {
	return l.streamLoop(onFrame)
}
func (l *loadRPCClient) SendMessageStreamModelWithMedia(cascadeID, text, modelUID string, modelEnum uint64, media []connectrpc.MediaAttachment, onFrame func([]byte) error, noTools ...bool) error {
	return l.streamLoop(onFrame)
}
func (l *loadRPCClient) streamLoop(onFrame func([]byte) error) error {
	if len(l.streamDeltas) == 0 {
		return onFrame(pbTextFrame("ok"))
	}
	for _, delta := range l.streamDeltas {
		if err := onFrame((&fakeRPCClient{}).approvalFrame(delta)); err != nil {
			return err
		}
	}
	return nil
}
func (l *loadRPCClient) SubmitToolApproval(cascadeID, trajectoryID string, stepIndex uint32, oneofField int, oneofPayload []byte) ([]byte, error) {
	fields := connectrpc.DecodeFields(oneofPayload)
	confirm := false
	if len(fields) > 0 {
		if fields[0].WireType == 0 {
			confirm = fields[0].Varint == 1
		} else if fields[0].WireType == 2 {
			confirm = true
			for _, fld := range fields {
				if fld.Num == 2 && fld.Varint == 1 {
					confirm = false
				}
			}
		}
	}
	l.lastApproval = &submitApprovalCall{
		cascadeID:    cascadeID,
		trajectoryID: trajectoryID,
		stepIndex:    stepIndex,
		confirm:      confirm,
	}
	return connectrpc.Frame(pbTextFrame("ok")), nil
}
func (l *loadRPCClient) SetBrowserOpenConversation(cascadeID string) ([]byte, error) {
	return connectrpc.Frame(pbTextFrame("ok")), nil
}
func (l *loadRPCClient) SendCommand(commandText string) ([]byte, error) {
	return connectrpc.Frame(pbTextFrame("cmd-ok")), nil
}
func (l *loadRPCClient) ListModels() ([]byte, error) {
	return connectrpc.Frame(pbTextFrame("ok")), nil
}
func (l *loadRPCClient) DeleteCascade(cascadeID string) ([]byte, error) {
	return connectrpc.Frame(pbTextFrame("deleted")), nil
}
func (l *loadRPCClient) ReadFile(uri string) ([]byte, error) {
	return connectrpc.Frame(pbTextFrame("file")), nil
}
func (l *loadRPCClient) WriteFile(uri string, content []byte, overwrite bool) ([]byte, error) {
	return connectrpc.Frame(pbTextFrame("written")), nil
}
func (l *loadRPCClient) GetCascadeTrajectory(cascadeID string, verbosity uint64) ([]byte, error) {
	return connectrpc.Frame(pbTextFrame("traj")), nil
}
func (l *loadRPCClient) GetTurnDiff(conversationID string, stepIndex int64) ([]byte, error) {
	return connectrpc.Frame(pbTextFrame("diff")), nil
}
func (l *loadRPCClient) GetRevertPreview(cascadeID string, stepIndex int64) ([]byte, error) {
	return connectrpc.Frame(pbTextFrame("preview")), nil
}
func (l *loadRPCClient) RevertToCascadeStep(cascadeID string, stepIndex int64) error {
	return nil
}
func (l *loadRPCClient) SendStepsToBackground(conversationID string, stepIndices []int64) error {
	return nil
}
func (l *loadRPCClient) SkipBrowserSubagent(cascadeID string, stepIndex int64) error {
	return nil
}
func (l *loadRPCClient) RetrieveUserQuotaSummary() ([]byte, error) {
	return connectrpc.Frame(pbTextFrame("quota")), nil
}
func (l *loadRPCClient) GetDefinition(uri string, line, character int) ([]byte, error) {
	return []byte(`{"location":{"uri":"` + uri + `"}}`), nil
}
func (l *loadRPCClient) GetLintErrors(uri string) ([]byte, error) {
	return []byte(`{"diagnostics":[]}`), nil
}
func (l *loadRPCClient) GetCodeValidationStates(uri string) ([]byte, error) {
	return []byte(`{"validations":[{"uri":"` + uri + `","state":"valid"}]}`), nil
}
func (l *loadRPCClient) GetUserStatus() ([]byte, error) {
	return []byte(`{"status":"ok"}`), nil
}
func (l *loadRPCClient) GetModelStatuses() ([]byte, error) {
	return []byte(`{"modelStatuses":[]}`), nil
}
func (l *loadRPCClient) GenerateCommitMessage() ([]byte, error) {
	return []byte(`{"commitMessage":"test commit"}`), nil
}
func (l *loadRPCClient) ConvertTrajectoryToMarkdown(trajectoryID string) ([]byte, error) {
	return []byte("# Test Markdown"), nil
}
func (l *loadRPCClient) CreateWorktree(branch, path string) ([]byte, error) {
	return []byte(`{"status":"created"}`), nil
}
func (l *loadRPCClient) TrackWorkspace(workspacePath string) ([]byte, error) {
	return connectrpc.Frame(pbTextFrame("tracked")), nil
}
func (l *loadRPCClient) UntrackWorkspace(workspacePath string) ([]byte, error) {
	return connectrpc.Frame(pbTextFrame("untracked")), nil
}

// --- Stubs RPC Git + Sidecar (P2) pour loadRPCClient ---
func (l *loadRPCClient) GetVersionControlState(workspacePath string) ([]byte, error) {
	return connectrpc.Frame(pbTextFrame("vcs")), nil
}
func (l *loadRPCClient) GitStage(workspaceURI string, uris []string) ([]byte, error) {
	return connectrpc.Frame(pbTextFrame("staged")), nil
}
func (l *loadRPCClient) GitUnstage(workspaceURI string, uris []string) ([]byte, error) {
	return connectrpc.Frame(pbTextFrame("unstaged")), nil
}
func (l *loadRPCClient) GitDiscard(workspaceURI string, uris []string) ([]byte, error) {
	return connectrpc.Frame(pbTextFrame("discarded")), nil
}
func (l *loadRPCClient) GitCommit(workspaceURI, message string) ([]byte, error) {
	return connectrpc.Frame(pbTextFrame("committed")), nil
}
func (l *loadRPCClient) GetCommitDetails(workspaceURI, commitID string) ([]byte, error) {
	return connectrpc.Frame(pbTextFrame("details")), nil
}
func (l *loadRPCClient) ListSidecarLogFiles(sidecarID string) ([]byte, error) {
	return connectrpc.Frame(pbTextFrame("logs")), nil
}
func (l *loadRPCClient) GetSidecarLogs(sidecarID, logFileName string) ([]byte, error) {
	return connectrpc.Frame(pbTextFrame("log-content")), nil
}
func (l *loadRPCClient) ManageSidecar(sidecarID string, action uint64) ([]byte, error) {
	return connectrpc.Frame(pbTextFrame("managed")), nil
}
func (l *loadRPCClient) StartBattleMode(workspaceURI, prompt, modelUIDA string, modelEnumA uint64, modelUIDB string, modelEnumB uint64) ([]byte, error) {
	return connectrpc.Frame(pbTextFrame("battle-started")), nil
}
func (l *loadRPCClient) GetBattleWorktreeDiff(workspaceURI string) ([]byte, error) {
	return connectrpc.Frame(pbTextFrame("battle-diff")), nil
}
func (l *loadRPCClient) EliminateBattleArm(armID string) ([]byte, error) {
	return connectrpc.Frame(pbTextFrame("arm-eliminated")), nil
}
func (l *loadRPCClient) EndBattleMode(winningArmID string, mergeStrategy uint64) ([]byte, error) {
	return connectrpc.Frame(pbTextFrame("battle-ended")), nil
}
func (l *loadRPCClient) DumpFlightRecorder() ([]byte, error) {
	return connectrpc.Frame([]byte("fake-trace")), nil
}
func (l *loadRPCClient) RefreshMcpServers() ([]byte, error) {
	return connectrpc.Frame(pbTextFrame("mcp-refreshed")), nil
}
func (l *loadRPCClient) CompleteMcpOAuth(serverID, authCode string) ([]byte, error) {
	return connectrpc.Frame(pbTextFrame("oauth-completed")), nil
}
func (l *loadRPCClient) DisconnectMcpOAuth(serverID string) ([]byte, error) {
	return connectrpc.Frame(pbTextFrame("oauth-disconnected")), nil
}
func (l *loadRPCClient) HybridSearch(query, workspaceURI string, limit uint32) ([]byte, error) {
	return connectrpc.Frame(pbTextFrame("search-results")), nil
}
func (l *loadRPCClient) SearchCode(query, workspaceURI string, maxResults, linesContext int32) ([]byte, error) {
	return connectrpc.Frame(pbTextFrame("code-search")), nil
}
func (l *loadRPCClient) CheckoutWorktree(worktreeDirURI, targetWorkspaceURI string, deleteAfterCheckout bool, mergeStrategy uint64) ([]byte, error) {
	return connectrpc.Frame(pbTextFrame("worktree-checked-out")), nil
}
func (l *loadRPCClient) CancelCascadeInvocation(cascadeID string, killBackgroundTasks bool) ([]byte, error) {
	return connectrpc.Frame(pbTextFrame("cancelled")), nil
}
func (l *loadRPCClient) ForceStopCascadeTree(cascadeID string) ([]byte, error) {
	return connectrpc.Frame(pbTextFrame("force-stopped")), nil
}
func (l *loadRPCClient) CancelCascadeSteps(cascadeID string, stepIndices []uint32) ([]byte, error) {
	return connectrpc.Frame(pbTextFrame("steps-cancelled")), nil
}



// TestWebSocketConcurrentClients — 20 clients en parallèle, 30 messages chacun :
// aucun message ne doit être perdu ni mélangé (chaque réponse doit porter
// son requestId).
func TestWebSocketConcurrentClients(t *testing.T) {
	if testing.Short() {
		t.Skip("test de charge, sauté en mode -short")
	}
	backend := &loadRPCClient{}
	srv := newTestServer(backend)
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"
	const clients = 20
	const perClient = 30

	var wg sync.WaitGroup
	errCh := make(chan error, clients)
	for c := 0; c < clients; c++ {
		wg.Add(1)
		go func(c int) {
			defer wg.Done()
			conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
			if err != nil {
				errCh <- fmt.Errorf("client %d: dial: %w", c, err)
				return
			}
			defer conn.Close()

			for i := 0; i < perClient; i++ {
				rid := fmt.Sprintf("r-%d-%d", c, i)
				if err := conn.WriteJSON(map[string]string{"type": "heartbeat", "requestId": rid}); err != nil {
					errCh <- fmt.Errorf("client %d msg %d: send: %w", c, i, err)
					return
				}
				var out map[string]interface{}
				if err := conn.ReadJSON(&out); err != nil {
					errCh <- fmt.Errorf("client %d msg %d: recv: %w", c, i, err)
					return
				}
				if out["requestId"] != rid || out["type"] != "response" {
					errCh <- fmt.Errorf("client %d msg %d: réponse croisée! reçu requestId=%v", c, i, out["requestId"])
					return
				}
			}
		}(c)
	}
	wg.Wait()
	close(errCh)
	for err := range errCh {
		t.Error(err)
	}
	if got := backend.heartbeats.Load(); got != clients*perClient {
		t.Fatalf("Attendu %d heartbeats backend, reçu %d", clients*perClient, got)
	}
}

// ─── Test de robustesse : payloads aléatoires (proto random walk) ───

// toOutgoing ne doit jamais paniquer, quelle que soit l'entrée binaire.
func TestToOutgoingNeverPanics(t *testing.T) {
	r := rand.New(rand.NewSource(42))
	for i := 0; i < 2000; i++ {
		raw := make([]byte, r.Intn(128))
		r.Read(raw)
		func() {
			defer func() {
				if p := recover(); p != nil {
					t.Fatalf("toOutgoing a paniqué sur %v: %v", raw, p)
				}
			}()
			_ = toOutgoing(raw)
		}()
	}
}

// TestWorkspaceURIRoundTrip — un chemin Windows → URI → même chemin.
func TestWorkspaceURIRoundTrip(t *testing.T) {
	uri := toWorkspaceURI(`C:\Users\amine\Downloads\projet`)
	if uri != "file:///C:/Users/amine/Downloads/projet" {
		t.Fatalf("URI inattendue: %s", uri)
	}
}

// ─── Test de charge : débit maximal du gateway WebSocket ───

// BenchmarkGatewayHeartbeat mesure le débit d'un cycle heartbeat complet
// (aller-retour WebSocket + décodage protobuf côté serveur).
func BenchmarkGatewayHeartbeat(b *testing.B) {
	backend := &loadRPCClient{}
	srv := newTestServer(backend)
	defer srv.Close()

	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http")+"/ws", nil)
	if err != nil {
		b.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		rid := fmt.Sprintf("r-%d", i)
		if err := conn.WriteJSON(map[string]string{"type": "heartbeat", "requestId": rid}); err != nil {
			b.Fatal(err)
		}
		var out map[string]interface{}
		if err := conn.ReadJSON(&out); err != nil {
			b.Fatal(err)
		}
		if out["requestId"] != rid {
			b.Fatalf("réponse croisée: %v", out["requestId"])
		}
	}
}

// TestWebSocketStreamBackpressure — quand onFrame renvoie une erreur,
// le gateway doit propager stream_end avec erreur et terminer proprement.
type failingStreamClient struct {
	fakeRPCClient
}

func (f *failingStreamClient) SendMessageStream(cascadeID, text string, onFrame func([]byte) error) error {
	_ = onFrame(connectrpc.Frame(pbTextFrame("hello")))
	return fmt.Errorf("stream interrompu par le backend")
}
func (f *failingStreamClient) SendMessageStreamModel(cascadeID, text, modelUID string, modelEnum uint64, onFrame func([]byte) error, noTools ...bool) error {
	return f.SendMessageStream(cascadeID, text, onFrame)
}
func (f *failingStreamClient) SendMessageStreamModelWithMedia(cascadeID, text, modelUID string, modelEnum uint64, media []connectrpc.MediaAttachment, onFrame func([]byte) error, noTools ...bool) error {
	return f.SendMessageStream(cascadeID, text, onFrame)
}
func (f *failingStreamClient) TrackWorkspace(workspacePath string) ([]byte, error) {
	return connectrpc.Frame(pbTextFrame("tracked")), nil
}
func (f *failingStreamClient) UntrackWorkspace(workspacePath string) ([]byte, error) {
	return connectrpc.Frame(pbTextFrame("untracked")), nil
}

func TestWebSocketStreamBackendError(t *testing.T) {
	srv := newTestServer(&failingStreamClient{})
	defer srv.Close()

	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	client.send(t, map[string]string{
		"type": "send_prompt", "requestId": "rE",
		"cascadeId": "casc-1", "prompt": "provoque une erreur",
	})

	// stream_start puis stream_end avec erreur (le delta peut arriver avant).
	gotStart, gotEnd := false, false
	deadline := time.Now().Add(5 * time.Second)
	for !gotEnd && time.Now().Before(deadline) {
		msg := client.recv(t)
		switch msg["type"] {
		case "stream_start":
			gotStart = true
		case "stream_delta":
			// OK, toléré
		case "stream_end":
			if msg["error"] == nil {
				t.Fatalf("Attendu stream_end avec erreur, reçu %v", msg)
			}
			gotEnd = true
		}
	}
	if !gotStart || !gotEnd {
		t.Fatalf("Flux incomplet: start=%v end=%v", gotStart, gotEnd)
	}
}
