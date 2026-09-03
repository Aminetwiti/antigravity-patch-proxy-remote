package gateway

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/antigravity/remote-daemon/pkg/connectrpc"
	"github.com/gorilla/websocket"
)

func TestToWorkspaceURI(t *testing.T) {
	cases := map[string]string{
		`C:\Users\test\proj`:         "file:///C:/Users/test/proj",
		`C:/Users/test/proj`:         "file:///C:/Users/test/proj",
		"file:///C:/Users/test/proj": "file:///C:/Users/test/proj",
	}
	for in, want := range cases {
		if got := toWorkspaceURI(in); got != want {
			t.Errorf("toWorkspaceURI(%q) = %q, attendu %q", in, got, want)
		}
	}
}

// TestToOutgoing vérifie la conversion d'une réponse protobuf brute en JSON lisible.
func TestToOutgoing(t *testing.T) {
	// Frame protobuf : champ #1 length-delimited "casc-1" + champ #14 varint 190.
	buf := []byte{0x0a, 0x06, 'c', 'a', 's', 'c', '-', '1', 0x70, 0xbe, 0x01}
	out := toOutgoing(buf).(map[string]interface{})
	fields := out["fields"].([]map[string]interface{})
	if len(fields) != 2 {
		t.Fatalf("Attendu 2 champs, reçu %d", len(fields))
	}
	if fields[0]["text"] != "casc-1" {
		t.Errorf("Attendu text=casc-1, reçu %v", fields[0]["text"])
	}
	// toOutgoing stocke la valeur varint en uint64 ; comparer via la forme texte
	// pour rester insensible au type numérique exact.
	if fmt.Sprint(fields[1]["value"]) != "190" {
		t.Errorf("Attendu value=190, reçu %v", fields[1]["value"])
	}
}

// pbTextFrame construit une frame protobuf length-delimited champ #2 avec du texte.
func pbTextFrame(s string) []byte {
	buf := make([]byte, 2+len(s))
	buf[0] = 0x12
	buf[1] = byte(len(s))
	copy(buf[2:], s)
	return buf
}

// fakeRPCClient est un stub du backend LanguageServer (gRPC-Web).
type fakeRPCClient struct {
	streamDeltas []string // frames émises par SendMessageStream
	cascadesRaw  []byte   // réponse GetAllCascades (nil → défaut)
	quotaRaw     []byte   // réponse RetrieveUserQuotaSummary (nil → défaut)
	// lastApproval : dernier SubmitToolApproval reçu (vérifié par les tests
	// d'approbation : décision utilisateur ou auto-refus d'expiration).
	lastApproval interface{}
	// lastCommand : dernière slash commande routée (vérifié par le test
	// de routing send_command).
	lastCommand string
	// lastPrompt : dernier prompt envoyé au LS via SendMessageStream(…)
	// (vérifié par le test submit_question_response fire-and-forget).
	lastPrompt string
	// lastCascade : dernier CreateCascade reçu (vérifié par le test de
	// propagation du modèle mobile).
	lastCascade *createCascadeCall
	// lastDelete : dernier DeleteCascade reçu (vérifié par le test P0).
	lastDelete string
	// lastRead / lastWrite : derniers ReadFile / WriteFile reçus (tests P0).
	lastRead  string
	lastWrite *writeFileCall
	// modelsRaw : réponse ListModels (nil → défaut "ok").
	modelsRaw []byte
	// deleteErr : erreur simulée pour DeleteCascade (tests de refus).
	deleteErr error
	// trajectoryRaw / turnDiffRaw : réponses des RPC C9 (nil → défaut).
	trajectoryRaw []byte
	turnDiffRaw   []byte
	// lastTrajectory / lastTurnDiff : derniers appels C9 reçus (vérifiés
	// par zz_p1_trajectory_test.go).
	lastTrajectory *trajectoryCall
	lastTurnDiff   *turnDiffCall
	// vcsStateRaw : réponse GetVersionControlState simulée (nil = défaut).
	vcsStateRaw []byte
	// lastGitOp : dernier RPC git reçu (vérifié par les tests P2).
	lastGitOp *gitOpCall
	// lastSidecar : dernier RPC sidecar reçu (vérifié par les tests P2).
	lastSidecar *sidecarCall
}

// trajectoryCall capture les arguments du dernier GetCascadeTrajectory.
type trajectoryCall struct {
	cascadeID string
	verbosity uint64
}

// turnDiffCall capture les arguments du dernier GetTurnDiff.
type turnDiffCall struct {
	conversationID string
	stepIndex      int64
}

// gitOpCall capture les arguments du dernier RPC git (P2).
type gitOpCall struct {
	op           string
	workspaceURI string
	uris         []string
	message      string
	commitID     string
}

// sidecarCall capture les arguments du dernier RPC sidecar (P2).
type sidecarCall struct {
	op          string
	sidecarID   string
	logFileName string
	action      uint64
}

// writeFileCall capture les arguments du dernier WriteFile.
type writeFileCall struct {
	uri       string
	content   []byte
	overwrite bool
}

// createCascadeCall capture les arguments du dernier CreateCascade pour
// vérifier la propagation modelUID/modelEnum du mobile jusqu'au RPC.
type createCascadeCall struct {
	uri       string
	projectID string
	modelUID  string
	modelEnum uint64
}

func (f *fakeRPCClient) Heartbeat() ([]byte, error) {
	return connectrpc.Frame(pbTextFrame("ok")), nil
}

func (f *fakeRPCClient) CreateCascade(uri string, projectID string, modelUID string, modelEnum uint64) ([]byte, error) {
	f.lastCascade = &createCascadeCall{uri: uri, projectID: projectID, modelUID: modelUID, modelEnum: modelEnum}
	return connectrpc.Frame(pbCascadeFrame("casc-1")), nil
}

// pbCascadeFrame encode un champ protobuf #1 length-delimited (le format de la
// réponse CreateCascade réelle) — sans en-tête gRPC-Web ; Frame() l'ajoute.
func pbCascadeFrame(id string) []byte {
	buf := make([]byte, 2+len(id))
	buf[0] = 0x0A
	buf[1] = byte(len(id))
	copy(buf[2:], id)
	return buf
}

func (f *fakeRPCClient) GetAllCascades() ([]byte, error) {
	if f.cascadesRaw != nil {
		return f.cascadesRaw, nil
	}
	return connectrpc.Frame(pbTextFrame("sess")), nil
}

func (f *fakeRPCClient) SendMessage(cascadeID, text string) ([]byte, error) {
	return connectrpc.Frame(pbTextFrame("ok")), nil
}

func (f *fakeRPCClient) SendMessageStream(cascadeID, text string, onFrame func([]byte) error) error {
	f.lastPrompt = text
	return f.streamLoop(onFrame)
}

// SendMessageStreamModel : la sélection modèle du mobile est ignorée par le
// fake (le contrat testé est le streaming) - mêmes deltas que la variante.
func (f *fakeRPCClient) SendMessageStreamModel(cascadeID, text, modelUID string, modelEnum uint64, onFrame func([]byte) error, _ ...bool) error {
	f.lastPrompt = text
	return f.streamLoop(onFrame)
}

func (f *fakeRPCClient) SendMessageStreamModelWithMedia(cascadeID, text, modelUID string, modelEnum uint64, media []connectrpc.MediaAttachment, onFrame func([]byte) error, noTools ...bool) error {
	return f.SendMessageStreamModel(cascadeID, text, modelUID, modelEnum, onFrame, noTools...)
}

func (f *fakeRPCClient) streamLoop(onFrame func([]byte) error) error {
	for _, delta := range f.streamDeltas {
		if err := onFrame(f.approvalFrame(delta)); err != nil {
			return err
		}
	}
	return nil
}

// approvalFrame construit une frame protobuf identique à celle du vrai
// Language Server pour un événement d'approbation : un champ #1 length-delimited
// contenant les sous-champs de corrélation trajectory_id (#1) + step_index (#2)
// PUIS le blob JSON (run_command, …) (#3). Le parseur (event_parser.go) cherche
// le texte "run_command" et les sous-champs de corrélation DANS LE MÊME champ —
// c'est ainsi qu'il retrouve la cible de HandleCascadeUserInteraction.
func (f *fakeRPCClient) approvalFrame(delta string) []byte {
	if !strings.HasPrefix(strings.TrimSpace(delta), "{") {
		return pbTextFrame(delta)
	}
	blob := &protoWriter{}
	blob.string(1, "123e4567-e89b-12d3-a456-426614174000") // trajectory_id
	blob.varint(2, 1)                                      // step_index
	blob.bytes(3, []byte(delta))                           // blob JSON
	outer := &protoWriter{}
	outer.bytes(1, blob.buf)
	// Le vrai CallStream/splitFrames retire l'en-tête gRPC-Web (5 octets)
	// avant d'invoquer onFrame : le fake doit imiter ce contrat, sinon
	// ParseFrameEvents décode l'en-tête comme des champs fantômes et avale
	// le message (run_command jamais détecté → outcome=done).
	return outer.buf
}

// protoWriter : encodeur protobuf de test calqué sur connectrpc/writer
// (mêmes conventions de clé/varint/length-delimited) — sans dépendance.
type protoWriter struct {
	buf []byte
}

func (w *protoWriter) rawVarint(v uint64) {
	for v >= 0x80 {
		w.buf = append(w.buf, byte(v)|0x80)
		v >>= 7
	}
	w.buf = append(w.buf, byte(v))
}

func (w *protoWriter) key(n, wireType int) {
	w.rawVarint(uint64(n<<3 | wireType))
}

func (w *protoWriter) varint(n int, v uint64) {
	w.key(n, 0)
	w.rawVarint(v)
}

func (w *protoWriter) string(n int, s string) {
	w.bytes(n, []byte(s))
}

func (w *protoWriter) bytes(n int, b []byte) {
	w.key(n, 2)
	w.rawVarint(uint64(len(b)))
	w.buf = append(w.buf, b...)
}

func (f *fakeRPCClient) SubmitToolApproval(cascadeID, trajectoryID string, stepIndex uint32, oneofField int, oneofPayload []byte) ([]byte, error) {
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
	f.lastApproval = &submitApprovalCall{
		cascadeID:    cascadeID,
		trajectoryID: trajectoryID,
		stepIndex:    stepIndex,
		confirm:      confirm,
	}
	return connectrpc.Frame(pbTextFrame("ok")), nil
}

func (f *fakeRPCClient) SetBrowserOpenConversation(cascadeID string) ([]byte, error) {
	return connectrpc.Frame(pbTextFrame("ok")), nil
}

func (f *fakeRPCClient) SendCommand(commandText string) ([]byte, error) {
	f.lastCommand = commandText
	return connectrpc.Frame(pbTextFrame("cmd-ok")), nil
}

func (f *fakeRPCClient) ListModels() ([]byte, error) {
	if f.modelsRaw != nil {
		return f.modelsRaw, nil
	}
	return connectrpc.Frame(pbTextFrame("ok")), nil
}

func (f *fakeRPCClient) DeleteCascade(cascadeID string) ([]byte, error) {
	f.lastDelete = cascadeID
	if f.deleteErr != nil {
		return nil, f.deleteErr
	}
	return connectrpc.Frame(pbTextFrame("deleted")), nil
}

func (f *fakeRPCClient) ReadFile(uri string) ([]byte, error) {
	f.lastRead = uri
	return connectrpc.Frame(pbTextFrame("file-content")), nil
}

func (f *fakeRPCClient) WriteFile(uri string, content []byte, overwrite bool) ([]byte, error) {
	f.lastWrite = &writeFileCall{uri: uri, content: content, overwrite: overwrite}
	return connectrpc.Frame(pbTextFrame("written")), nil
}

func (f *fakeRPCClient) TrackWorkspace(workspacePath string) ([]byte, error) {
	return connectrpc.Frame(pbTextFrame("tracked")), nil
}

func (f *fakeRPCClient) UntrackWorkspace(workspacePath string) ([]byte, error) {
	return connectrpc.Frame(pbTextFrame("untracked")), nil
}

func (f *fakeRPCClient) GetCascadeTrajectory(cascadeID string, verbosity uint64) ([]byte, error) {
	f.lastTrajectory = &trajectoryCall{cascadeID: cascadeID, verbosity: verbosity}
	if f.trajectoryRaw != nil {
		return f.trajectoryRaw, nil
	}
	return connectrpc.Frame(pbTextFrame("traj")), nil
}

func (f *fakeRPCClient) GetTurnDiff(conversationID string, stepIndex int64) ([]byte, error) {
	f.lastTurnDiff = &turnDiffCall{conversationID: conversationID, stepIndex: stepIndex}
	if f.turnDiffRaw != nil {
		return f.turnDiffRaw, nil
	}
	return connectrpc.Frame(pbTextFrame("diff")), nil
}

func (f *fakeRPCClient) GetRevertPreview(cascadeID string, stepIndex int64) ([]byte, error) {
	return connectrpc.Frame(pbTextFrame("revert-preview")), nil
}

func (f *fakeRPCClient) RevertToCascadeStep(cascadeID string, stepIndex int64) error {
	return nil
}

func (f *fakeRPCClient) SendStepsToBackground(conversationID string, stepIndices []int64) error {
	return nil
}

func (f *fakeRPCClient) SkipBrowserSubagent(cascadeID string, stepIndex int64) error {
	return nil
}

func (f *fakeRPCClient) RetrieveUserQuotaSummary() ([]byte, error) {
	if f.quotaRaw != nil {
		return f.quotaRaw, nil
	}
	return connectrpc.Frame(pbTextFrame("quota-summary")), nil
}

func (f *fakeRPCClient) GetUserStatus() ([]byte, error) {
	return []byte(`{"user":{"name":"Test User","email":"test@antigravity.dev","plan":"pro"},"credits":{"available":100}}`), nil
}

func (f *fakeRPCClient) GetModelStatuses() ([]byte, error) {
	return []byte(`{"modelStatuses":[{"modelId":"MODEL_PLACEHOLDER_M37","status":"AVAILABLE"}]}`), nil
}

func (f *fakeRPCClient) GenerateCommitMessage() ([]byte, error) {
	return []byte(`{"commitMessage":"feat(remote): integrate quota gauges and commit generator"}`), nil
}

func (f *fakeRPCClient) ConvertTrajectoryToMarkdown(trajectoryID string) ([]byte, error) {
	return []byte("# Session Export\n\n- User: Hello\n- Assistant: Hi!"), nil
}

func (f *fakeRPCClient) CreateWorktree(branch, path string) ([]byte, error) {
	return []byte(`{"status":"created","branch":"` + branch + `"}`), nil
}

// --- Fakes RPC Git + Sidecar (P2) ---

// vcsStateRaw : réponse GetVersionControlState simulée (nil = défaut).
// Défaut : branche "main", 2 changements, pas de conflit.
func (f *fakeRPCClient) GetVersionControlState(workspacePath string) ([]byte, error) {
	if f.vcsStateRaw != nil {
		return f.vcsStateRaw, nil
	}
	st := &protoWriter{}
	st.string(2, "main")                                   // current_ref
	commit := &protoWriter{}
	commit.string(1, "abc123")
	author := &protoWriter{}
	author.string(1, "Test User")
	commit.bytes(4, author.buf)
	commit.varint(5, 1700000000000)
	msg := &protoWriter{}
	msg.string(1, "feat: test commit")
	commit.bytes(6, msg.buf)
	st.bytes(4, commit.buf)                                 // commits
	wd := &protoWriter{}
	wd.string(1, "file:///C:/repo/main.go")                // uri
	wd.varint(2, 2)                                        // MODIFIED
	st.bytes(5, wd.buf)
	wd2 := &protoWriter{}
	wd2.string(1, "file:///C:/repo/new.go")
	wd2.varint(2, 1)                                       // ADDED
	st.bytes(5, wd2.buf)
	stage := &protoWriter{}
	stage.string(1, "file:///C:/repo/staged.go")
	stage.varint(2, 1)
	st.bytes(7, stage.buf)
	conf := &protoWriter{}
	conf.varint(1, 0)                                      // pas de conflit
	st.bytes(6, conf.buf)
	st.varint(1, 4)                                        // vcs_type = GIT
	return connectrpc.Frame(st.buf), nil
}

func (f *fakeRPCClient) GitStage(workspaceURI string, uris []string) ([]byte, error) {
	f.lastGitOp = &gitOpCall{op: "stage", workspaceURI: workspaceURI, uris: uris}
	return connectrpc.Frame(pbTextFrame("staged")), nil
}

func (f *fakeRPCClient) GitUnstage(workspaceURI string, uris []string) ([]byte, error) {
	f.lastGitOp = &gitOpCall{op: "unstage", workspaceURI: workspaceURI, uris: uris}
	return connectrpc.Frame(pbTextFrame("unstaged")), nil
}

func (f *fakeRPCClient) GitCommit(workspaceURI, message string) ([]byte, error) {
	f.lastGitOp = &gitOpCall{op: "commit", workspaceURI: workspaceURI, message: message}
	commitResp := &protoWriter{}
	commitResp.string(1, "abc123")
	return connectrpc.Frame(commitResp.buf), nil
}

func (f *fakeRPCClient) GitDiscard(workspaceURI string, uris []string) ([]byte, error) {
	f.lastGitOp = &gitOpCall{op: "discard", workspaceURI: workspaceURI, uris: uris}
	return connectrpc.Frame(pbTextFrame("discarded")), nil
}

func (f *fakeRPCClient) GetCommitDetails(workspaceURI, commitID string) ([]byte, error) {
	f.lastGitOp = &gitOpCall{op: "commit_details", workspaceURI: workspaceURI, commitID: commitID}
	details := &protoWriter{}
	details.string(1, commitID)
	file := &protoWriter{}
	file.string(1, "file:///C:/repo/main.go")
	file.varint(2, 2)
	details.bytes(2, file.buf)
	return connectrpc.Frame(details.buf), nil
}

func (f *fakeRPCClient) ListSidecarLogFiles(sidecarID string) ([]byte, error) {
	f.lastSidecar = &sidecarCall{op: "list_logs", sidecarID: sidecarID}
	list := &protoWriter{}
	list.string(1, "server.log")
	list.string(1, "agent.log")
	return connectrpc.Frame(list.buf), nil
}

func (f *fakeRPCClient) GetSidecarLogs(sidecarID, logFileName string) ([]byte, error) {
	f.lastSidecar = &sidecarCall{op: "get_logs", sidecarID: sidecarID, logFileName: logFileName}
	return connectrpc.Frame(pbTextFrame("log-content-line-1\nlog-content-line-2")), nil
}

func (f *fakeRPCClient) ManageSidecar(sidecarID string, action uint64) ([]byte, error) {
	f.lastSidecar = &sidecarCall{op: "manage", sidecarID: sidecarID, action: action}
	return connectrpc.Frame(pbTextFrame("managed")), nil
}

func (f *fakeRPCClient) GetLintErrors(uri string) ([]byte, error) {
	return []byte(`{"diagnostics":[{"uri":"` + uri + `","severity":1,"message":"unused variable"}]}`), nil
}

func (f *fakeRPCClient) GetDefinition(uri string, line, character int) ([]byte, error) {
	return []byte(`{"location":{"uri":"` + uri + `","line":` + itoa(line) + `,"character":` + itoa(character) + `}}`), nil
}

func (f *fakeRPCClient) GetCodeValidationStates(uri string) ([]byte, error) {
	return []byte(`{"validations":[{"uri":"` + uri + `","state":"valid"}]}`), nil
}

func (f *fakeRPCClient) StartBattleMode(workspaceURI, prompt, modelUIDA string, modelEnumA uint64, modelUIDB string, modelEnumB uint64) ([]byte, error) {
	return connectrpc.Frame(pbTextFrame("battle-started")), nil
}

func (f *fakeRPCClient) GetBattleWorktreeDiff(workspaceURI string) ([]byte, error) {
	return connectrpc.Frame(pbTextFrame("battle-diff")), nil
}

func (f *fakeRPCClient) EliminateBattleArm(armID string) ([]byte, error) {
	return connectrpc.Frame(pbTextFrame("arm-eliminated")), nil
}

func (f *fakeRPCClient) EndBattleMode(winningArmID string, mergeStrategy uint64) ([]byte, error) {
	return connectrpc.Frame(pbTextFrame("battle-ended")), nil
}

func (f *fakeRPCClient) DumpFlightRecorder() ([]byte, error) {
	return connectrpc.Frame([]byte("fake-trace-data")), nil
}

func (f *fakeRPCClient) RefreshMcpServers() ([]byte, error) {
	return connectrpc.Frame(pbTextFrame("mcp-refreshed")), nil
}

func (f *fakeRPCClient) CompleteMcpOAuth(serverID, authCode string) ([]byte, error) {
	return connectrpc.Frame(pbTextFrame("oauth-completed")), nil
}

func (f *fakeRPCClient) DisconnectMcpOAuth(serverID string) ([]byte, error) {
	return connectrpc.Frame(pbTextFrame("oauth-disconnected")), nil
}

func (f *fakeRPCClient) HybridSearch(query, workspaceURI string, limit uint32) ([]byte, error) {
	return connectrpc.Frame(pbTextFrame("search-results")), nil
}

func (f *fakeRPCClient) SearchCode(query, workspaceURI string, maxResults, linesContext int32) ([]byte, error) {
	return connectrpc.Frame(pbTextFrame("code-search-results")), nil
}

func (f *fakeRPCClient) CheckoutWorktree(worktreeDirURI, targetWorkspaceURI string, deleteAfterCheckout bool, mergeStrategy uint64) ([]byte, error) {
	return connectrpc.Frame(pbTextFrame("worktree-checked-out")), nil
}

func (f *fakeRPCClient) CancelCascadeInvocation(cascadeID string, killBackgroundTasks bool) ([]byte, error) {
	return connectrpc.Frame(pbTextFrame("cancelled")), nil
}

func (f *fakeRPCClient) ForceStopCascadeTree(cascadeID string) ([]byte, error) {
	return connectrpc.Frame(pbTextFrame("force-stopped")), nil
}

func (f *fakeRPCClient) CancelCascadeSteps(cascadeID string, stepIndices []uint32) ([]byte, error) {
	return connectrpc.Frame(pbTextFrame("steps-cancelled")), nil
}




// --- Tests WebSocket ---

type wsTestClient struct {
	conn *websocket.Conn
}

func dialWS(t *testing.T, url string) *wsTestClient {
	t.Helper()
	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatalf("Dial WebSocket échoué: %v", err)
	}
	return &wsTestClient{conn: conn}
}

func (c *wsTestClient) send(t *testing.T, msg map[string]string) {
	t.Helper()
	b, _ := json.Marshal(msg)
	if err := c.conn.WriteMessage(websocket.TextMessage, b); err != nil {
		t.Fatalf("Envoi WebSocket échoué: %v", err)
	}
}

func (c *wsTestClient) sendJSON(t *testing.T, msg interface{}) {
	t.Helper()
	b, _ := json.Marshal(msg)
	if err := c.conn.WriteMessage(websocket.TextMessage, b); err != nil {
		t.Fatalf("Envoi WebSocket échoué: %v", err)
	}
}

// sendRaw envoie un message JSON brut (champs data, nombres, …) sans passer
// par le typage map[string]string de send.
func (c *wsTestClient) sendRaw(t *testing.T, raw string) {
	t.Helper()
	if err := c.conn.WriteMessage(websocket.TextMessage, []byte(raw)); err != nil {
		t.Fatalf("Envoi WebSocket échoué: %v", err)
	}
}

func (c *wsTestClient) recv(t *testing.T) map[string]interface{} {
	t.Helper()
	_ = c.conn.SetReadDeadline(time.Now().Add(10 * time.Second))
	_, b, err := c.conn.ReadMessage()
	if err != nil {
		t.Fatalf("Réception WebSocket échouée: %v", err)
	}
	var out map[string]interface{}
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatalf("JSON invalide: %v (%s)", err, string(b))
	}
	return out
}

// recvSafe lit un message SANS faire échouer le test si la deadline expire
// (deadline non lue) : utilisé pour observer des broadcasts asynchrones
// (devices_updated) sans introduire de course dans le test.
func (c *wsTestClient) recvSafe() (map[string]interface{}, error) {
	_ = c.conn.SetReadDeadline(time.Now().Add(1 * time.Second))
	_, b, err := c.conn.ReadMessage()
	if err != nil {
		return nil, err
	}
	var out map[string]interface{}
	if err := json.Unmarshal(b, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// recvWithRetry lit un message en réessayant jusqu'à ce que le timeout total
// soit atteint. Utile pour les broadcasts asynchrones qui peuvent être
// retardés par la charge du scheduler lors de tests parallèles.
func (c *wsTestClient) recvWithRetry(t *testing.T, timeout time.Duration, retries int) (map[string]interface{}, error) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for i := 0; i < retries; i++ {
		remaining := time.Until(deadline)
		if remaining <= 0 {
			break
		}
		_ = c.conn.SetReadDeadline(time.Now().Add(remaining))
		_, b, err := c.conn.ReadMessage()
		if err == nil {
			var out map[string]interface{}
			if err := json.Unmarshal(b, &out); err == nil {
				return out, nil
			}
		}
		if i < retries-1 {
			time.Sleep(100 * time.Millisecond)
		}
	}
	return nil, fmt.Errorf("timeout après %v et %d tentatives", timeout, retries)
}

func newTestServer(client RPCClient) *httptest.Server {
	ts, _ := newTestServerWithGW(client)
	return ts
}

func newTestServerWithGW(client RPCClient) (*httptest.Server, *Server) {
	server := NewServer(client, "")
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", server.HandleWebSocket)
	return httptest.NewServer(mux), server
}

// TestWebSocketHeartbeat — cycle heartbeat complet via WebSocket.
func TestWebSocketHeartbeat(t *testing.T) {
	srv := newTestServer(&fakeRPCClient{})
	defer srv.Close()

	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	client.send(t, map[string]string{"type": "heartbeat", "requestId": "r1"})
	resp := client.recv(t)
	if resp["type"] != "response" || resp["requestId"] != "r1" {
		t.Fatalf("Réponse inattendue: %v", resp)
	}
	if resp["error"] != nil {
		t.Fatalf("Heartbeat a renvoyé une erreur: %v", resp["error"])
	}
}

// TestWebSocketSendPromptStream — test d'intégration du flux complet :
// stream_start → stream_delta (2 frames) → stream_end.
func TestWebSocketSendPromptStream(t *testing.T) {
	srv := newTestServer(&fakeRPCClient{streamDeltas: []string{"hello", " world"}})
	defer srv.Close()

	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	client.send(t, map[string]string{
		"type": "send_prompt", "requestId": "r9",
		"cascadeId": "casc-1", "prompt": "écris du code",
	})

	// 1. stream_start
	start := client.recv(t)
	if start["type"] != "stream_start" || start["requestId"] != "r9" {
		t.Fatalf("Attendu stream_start, reçu %v", start)
	}

	// 2. deux stream_delta
	gotDeltas := 0
	for gotDeltas < 2 {
		msg := client.recv(t)
		if msg["type"] == "stream_delta" {
			gotDeltas++
		} else if msg["type"] == "stream_end" {
			t.Fatalf("stream_end prématuré, deltas reçus: %d", gotDeltas)
		}
	}
	if gotDeltas != 2 {
		t.Fatalf("Attendu 2 stream_delta, reçu %d", gotDeltas)
	}

	// 3. stream_end
	end := client.recv(t)
	if end["type"] != "stream_end" || end["error"] != nil {
		t.Fatalf("Attendu stream_end sans erreur, reçu %v", end)
	}
}

// TestWebSocketStreamEndOutcome — le daemon enrichit stream_end d'un
// outcome structuré : "done" en succès, "approval" quand une frame a porté
// une demande d'approbation, "error" quand le backend échoue. Le mobile
// s'en sert pour notifier la fin de tâche (task done / action requise).
func TestWebSocketStreamEndOutcome(t *testing.T) {
	t.Run("success => done", func(t *testing.T) {
		srv := newTestServer(&fakeRPCClient{streamDeltas: []string{"ok"}})
		defer srv.Close()
		client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
		defer client.conn.Close()
		client.send(t, map[string]string{
			"type": "send_prompt", "requestId": "r9",
			"cascadeId": "casc-1", "prompt": "travaille",
		})
		for {
			msg := client.recv(t)
			if msg["type"] != "stream_end" {
				continue
			}
			data, _ := msg["data"].(map[string]interface{})
			if data == nil || data["outcome"] != "done" {
				t.Fatalf("Attendu outcome=done, reçu %v", msg)
			}
			return
		}
	})

	t.Run("approval frame => approval", func(t *testing.T) {
		// La frame porte run_command → ParseFrameEvents émet
		// EventKindApprovalRequired → le gateway classe stream_end "approval".
		srv := newTestServer(&fakeRPCClient{streamDeltas: []string{`{"run_command":"npx jest","step_index":1,"trajectory_id":"123e4567-e89b-12d3-a456-426614174000"}`}})
		defer srv.Close()
		client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
		defer client.conn.Close()
		client.send(t, map[string]string{
			"type": "send_prompt", "requestId": "r9",
			"cascadeId": "casc-1", "prompt": "travaille",
		})
		for {
			msg := client.recv(t)
			if msg["type"] != "stream_end" {
				continue
			}
			data, _ := msg["data"].(map[string]interface{})
			if data == nil || data["outcome"] != "approval" {
				t.Fatalf("Attendu outcome=approval (frame run_command), reçu %v", msg)
			}
			return
		}
	})
}

// TestWebSocketSendPromptMissingFields — validation des champs requis.
func TestWebSocketSendPromptMissingFields(t *testing.T) {
	srv := newTestServer(&fakeRPCClient{})
	defer srv.Close()

	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	client.send(t, map[string]string{"type": "send_prompt", "requestId": "r2", "cascadeId": "casc-1"})
	resp := client.recv(t)
	if resp["error"] == nil {
		t.Fatalf("Attendu une erreur pour prompt manquant, reçu %v", resp)
	}
}

// TestWebSocketAuth — rejet des connexions sans token quand AuthToken est défini.
func TestWebSocketAuth(t *testing.T) {
	server := NewServer(&fakeRPCClient{}, "secret123")
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", server.HandleWebSocket)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	// Sans token → 401
	_, resp, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http")+"/ws", nil)
	if err == nil {
		resp.Body.Close()
		t.Fatal("Attendu une erreur de connexion sans token")
	}
	if resp != nil && resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("Attendu 401, reçu %d", resp.StatusCode)
	}

	// Avec token en query → connexion réussie
	conn, _, err := websocket.DefaultDialer.Dial(
		"ws"+strings.TrimPrefix(srv.URL, "http")+"/ws?token=secret123", nil)
	if err != nil {
		t.Fatalf("Connexion avec token valide échouée: %v", err)
	}
	conn.Close()
}

// TestWebSocketReadLimit — un message > 1 Mo doit être rejeté sans crash :
// le serveur ferme la connexion, le client reçoit une erreur de lecture.
func TestWebSocketReadLimit(t *testing.T) {
	srv := newTestServer(&fakeRPCClient{})
	defer srv.Close()

	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	big := strings.Repeat("A", maxWSMessageSize+1024)
	if err := client.conn.WriteMessage(websocket.TextMessage, []byte(big)); err != nil {
		t.Fatalf("envoi du gros message échoué: %v", err)
	}

	// La prochaine lecture doit échouer (connexion fermée par le serveur).
	_, _, err := client.conn.ReadMessage()
	if err == nil {
		t.Fatal("Attendu une erreur de lecture après dépassement du read limit")
	}
}

// TestWebSocketCheckOrigin — un navigateur web avec un Origin arbitraire
// doit être rejeté (CSWSH), tandis qu'un client natif sans Origin passe.
func TestWebSocketCheckOrigin(t *testing.T) {
	srv := newTestServer(&fakeRPCClient{})
	defer srv.Close()
	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"

	// Origin malveillant → refusé
	_, resp, err := websocket.DefaultDialer.Dial(wsURL, http.Header{"Origin": []string{"https://evil.example.com"}})
	if err == nil {
		resp.Body.Close()
		t.Fatal("Attendu un rejet pour Origin malveillant")
	}

	// Origin localhost → accepté
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, http.Header{"Origin": []string{"http://localhost:3000"}})
	if err != nil {
		t.Fatalf("Origin localhost refusé à tort: %v", err)
	}
	conn.Close()
}

// trajectoryFrame construit une réponse GetAllCascadeTrajectories contenant
// UNE trajectoire structurée (champ 1 : cascade_id UUID de 36 octets + status).
func trajectoryFrame(uuid string) []byte {
	inner := append([]byte{0x0a, 0x24}, []byte(uuid)...) // field 1: cascade_id
	inner = append(inner, 0x12, 0x0c)                     // field 2: title (length 12)
	inner = append(inner, []byte("Test Session")...)
	inner = append(inner, 0xb0, 0x01, 0x04)              // field 22: varint 4 (READY)
	outer := append([]byte{0x0a, byte(len(inner))}, inner...)
	return connectrpc.Frame(outer)
}

// TestWebSocketGetContextReal — get_context compte les artefacts réels depuis
// la réponse GetAllCascadeTrajectories (plus de mock en dur).
func TestWebSocketGetContextReal(t *testing.T) {
	// Cascade de test isolée : un ID UUID (36 octets) est requis —
	// trajectoryFrame encode cascade_id avec une longueur fixe de 36 et
	// uuidRe conditionne le parsing structuré. Un ID unique évite aussi de
	// collisionner avec une vraie session utilisateur.
	n := time.Now().UnixNano()
	cascadeID := fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", uint32(n), uint16(n>>32), uint16(n>>48), uint16(n>>16), uint64(n)&0xFFFFFFFFFFFF)
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	transcriptDir := filepath.Join(home, ".gemini", "antigravity-ide", "brain", cascadeID, ".system_generated", "logs")
	if err := os.MkdirAll(transcriptDir, 0o755); err != nil {
		t.Fatal(err)
	}
	// filePathsIn n'extrait que les chemins C:/… ou file:///C:/… (slashs
	// avant) — filepath.Join produit des backslashes sur Windows, donc on
	// convertit explicitement.
	artifactPath := "file:///" + filepath.ToSlash(filepath.Join(home, ".gemini", "antigravity-ide", "brain", cascadeID, "artifact_1.md"))
	line := fmt.Sprintf(`{"type":"CODE_ACTION","content":"Created file %s with requested content."}`, artifactPath)
	if err := os.WriteFile(filepath.Join(transcriptDir, "transcript.jsonl"), []byte(line+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(filepath.Join(home, ".gemini", "antigravity-ide", "brain", cascadeID))

	srv := newTestServer(&fakeRPCClient{cascadesRaw: trajectoryFrame(cascadeID)})
	defer srv.Close()

	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	client.send(t, map[string]string{"type": "get_context", "requestId": "ctx1"})
	resp := client.recv(t)
	if resp["error"] != nil {
		t.Fatalf("get_context a renvoyé une erreur: %v", resp["error"])
	}
	data, ok := resp["data"].(map[string]interface{})
	if !ok {
		t.Fatalf("data manquant ou invalide: %v", resp)
	}
	// 1 trajectoire réelle → artifactsCount = 1 (plus de mock en dur 2).
	if artifacts, ok := data["artifactsCount"].(float64); !ok || artifacts != 1 {
		t.Fatalf("artifactsCount attendu 1, reçu %v", data["artifactsCount"])
	}
	// Les anciens mocks en dur (1/3/2) ne doivent plus apparaître.
	if data["subagentsCount"].(float64) == 1 && data["filesChangedCount"].(float64) == 3 {
		t.Fatalf("statistiques mock en dur encore présentes: %v", data)
	}

	// Test get_context scoped specifically with cascadeId
	client.send(t, map[string]string{"type": "get_context", "requestId": "ctx2", "cascadeId": cascadeID})
	respScoped := client.recv(t)
	if respScoped["error"] != nil {
		t.Fatalf("get_context scoped a renvoyé une erreur: %v", respScoped["error"])
	}
	dataScoped, ok := respScoped["data"].(map[string]interface{})
	if !ok || dataScoped["cascadeId"] != cascadeID {
		t.Fatalf("dataScoped invalide: %v", respScoped)
	}

	// Test list_artifacts for the session
	client.send(t, map[string]string{"type": "list_artifacts", "requestId": "art1", "cascadeId": cascadeID})
	respArt := client.recv(t)
	if respArt["error"] != nil {
		t.Fatalf("list_artifacts a renvoyé une erreur: %v", respArt["error"])
	}
	dataArt, ok := respArt["data"].(map[string]interface{})
	if !ok || dataArt["cascadeId"] != cascadeID {
		t.Fatalf("dataArt invalide: %v", respArt)
	}

	// Test list_uploads for the session
	client.send(t, map[string]string{"type": "list_uploads", "requestId": "up1", "cascadeId": cascadeID})
	respUp := client.recv(t)
	if respUp["error"] != nil {
		t.Fatalf("list_uploads a renvoyé une erreur: %v", respUp["error"])
	}
	dataUp, ok := respUp["data"].(map[string]interface{})
	if !ok || dataUp["cascadeId"] != cascadeID {
		t.Fatalf("dataUp invalide: %v", respUp)
	}
}
func TestWebSocketStreamBroadcastMultiClient(t *testing.T) {
	srv := newTestServer(&fakeRPCClient{streamDeltas: []string{"hello", " world"}})
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"
	emitter := dialWS(t, wsURL)
	defer emitter.conn.Close()
	observer := dialWS(t, wsURL)
	defer observer.conn.Close()

	// Le prompt est envoyé depuis le premier client seulement.
	emitter.send(t, map[string]string{
		"type": "send_prompt", "requestId": "r9",
		"cascadeId": "casc-1", "prompt": "écris du code",
	})

	for _, c := range []*wsTestClient{emitter, observer} {
		// 1. stream_start
		start := c.recv(t)
		if start["type"] != "stream_start" || start["requestId"] != "r9" {
			t.Fatalf("Attendu stream_start, reçu %v", start)
		}

		// 2. deux stream_delta
		gotDeltas := 0
		for gotDeltas < 2 {
			msg := c.recv(t)
			if msg["type"] == "stream_delta" {
				gotDeltas++
			} else if msg["type"] == "stream_end" {
				t.Fatalf("stream_end prématuré, deltas reçus: %d", gotDeltas)
			}
		}
		if gotDeltas != 2 {
			t.Fatalf("Attendu 2 stream_delta, reçu %d", gotDeltas)
		}

		// 3. stream_end
		end := c.recv(t)
		if end["type"] != "stream_end" || end["error"] != nil {
			t.Fatalf("Attendu stream_end sans erreur, reçu %v", end)
		}
	}
}

// TestWebSocketApprovalExpiry — Phase 6 : une approbation sans réponse dans
// le délai (approvalTimeout) est auto-refusée côté daemon (deny = sécurité :
// téléphone perdu) puis broadcast approval_expired pour nettoyer les cartes.
func TestWebSocketApprovalExpiry(t *testing.T) {
	t.Run("timeout => auto-deny + approval_expired", func(t *testing.T) {
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

		// Consomme stream_start, stream_delta, stream_end et attend approval_expired
		var expired map[string]interface{}
		for i := 0; i < 10; i++ {
			msg := client.recv(t)
			if msg["type"] == "approval_expired" {
				expired = msg
				break
			}
		}
		if expired == nil {
			t.Fatal("Attendu approval_expired après expiration")
		}
		data, _ := expired["data"].(map[string]interface{})
		if data == nil || data["cascadeId"] != "casc-1" {
			t.Fatalf("approval_expired data invalide: %v", expired)
		}

		// Auto-refus : SubmitToolApproval avec confirm=false (deny).
		got, ok := backend.lastApproval.(*submitApprovalCall)
		if !ok {
			t.Fatalf("Aucun SubmitToolApproval d'auto-refus enregistré")
		}
		if got.confirm {
			t.Fatalf("Auto-refus attendu avec confirm=false, reçu confirm=%v", got.confirm)
		}
		if got.cascadeID != "casc-1" || got.stepIndex != 1 || got.trajectoryID != "123e4567-e89b-12d3-a456-426614174000" {
			t.Fatalf("Auto-refus cible erronée: %+v", got)
		}
	})

	t.Run("submit before timeout => no expiry", func(t *testing.T) {
		backend := &fakeRPCClient{streamDeltas: []string{`{"run_command":"npx jest","step_index":1,"trajectory_id":"123e4567-e89b-12d3-a456-426614174000"}`}}
		server := NewServer(backend, "")
		server.SetApprovalTimeout(150 * time.Millisecond)
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
			if msg["type"] == "stream_end" {
				break
			}
		}

		// L'utilisateur répond avant le timeout → pas d'expiration.
		// NOTE: envoi en JSON brut — le helper `send` (map[string]string)
		// sérialiserait stepIndex en chaîne, que le serveur rejette
		// (int64 strict, validation à la frontière de confiance) → le test
		// attendrait un "response" qui ne viendrait jamais.
		if err := client.conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"submit_approval","requestId":"r10","cascadeId":"casc-1","trajectoryId":"123e4567-e89b-12d3-a456-426614174000","stepIndex":1,"approvalType":"run_command","decision":"allow","command":"npx jest"}`)); err != nil {
			t.Fatalf("envoi submit_approval: %v", err)
		}
		// réponse unary
		for {
			msg := client.recv(t)
			if msg["type"] == "response" {
				break
			}
		}

		// Attendre au-delà du timeout : aucun approval_expired ne doit arriver.
		// approval_resolved est un broadcast légitime — on l'accepte.
		time.Sleep(200 * time.Millisecond)
		deadline := time.Now().Add(150 * time.Millisecond)
		for {
			client.conn.SetReadDeadline(deadline)
			_, rawMsg, err := client.conn.ReadMessage()
			if err != nil {
				break // timeout atteint = OK, pas d'approval_expired
			}
			var m map[string]interface{}
			if json.Unmarshal(rawMsg, &m) == nil && m["type"] == "approval_expired" {
				t.Fatalf("approval_expired reçu alors que submit_approval avait été envoyé avant le timeout")
			}
		}
	})

	t.Run("stale submit après expiration => refus + aucun RPC", func(t *testing.T) {
		backend := &fakeApprovalRPC{}
		backend.streamDeltas = []string{`{"run_command":"npx jest","step_index":1,"trajectory_id":"123e4567-e89b-12d3-a456-426614174000"}`}
		server := NewServer(backend, "")
		server.SetApprovalTimeout(60 * time.Millisecond)
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
			if msg["type"] == "stream_end" {
				break
			}
		}

		// Le timer expire → approval_expired (auto-refus parti).
		for {
			msg := client.recv(t)
			if msg["type"] == "approval_expired" {
				break
			}
		}
		backend.submitted = 0

		// L'utilisateur tappe « allow » APRÈS expiration (carte expirée en
		// lecture seule, ou double-tap réseau) : le daemon doit refuser sans
		// contacter le LS — la commande a déjà été auto-refusée.
		if err := client.conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"submit_approval","requestId":"r11","cascadeId":"casc-1","trajectoryId":"123e4567-e89b-12d3-a456-426614174000","stepIndex":1,"approvalType":"run_command","decision":"allow","command":"npx jest"}`)); err != nil {
			t.Fatalf("envoi submit_approval: %v", err)
		}
		got := client.recv(t)
		if got["type"] != "error" || got["error"] == nil {
			t.Fatalf("Attendu error 'approval expired', reçu %v", got)
		}
		if errStr, _ := got["error"].(string); !strings.Contains(errStr, "expired") {
			t.Fatalf("Erreur inattendue: %v", errStr)
		}
		if backend.submitted != 0 {
			t.Fatalf("SubmitToolApproval appelé %d fois après expiration, attendu 0 (garde de fraîcheur)", backend.submitted)
		}
	})

	t.Run("stale question response après expiration => refus + aucun RPC", func(t *testing.T) {
		backend := &fakeApprovalRPC{}
		backend.streamDeltas = []string{`{"ask_question":"Voulez-vous continuer ?","step_index":1,"trajectory_id":"123e4567-e89b-12d3-a456-426614174000"}`}
		server := NewServer(backend, "")
		server.SetApprovalTimeout(60 * time.Millisecond)
		mux := http.NewServeMux()
		mux.HandleFunc("/ws", server.HandleWebSocket)
		srv := httptest.NewServer(mux)
		defer srv.Close()

		client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
		defer client.conn.Close()

		client.send(t, map[string]string{
			"type": "send_prompt", "requestId": "r9",
			"cascadeId": "casc-1", "prompt": "question ?",
		})
		for {
			msg := client.recv(t)
			if msg["type"] == "stream_end" {
				break
			}
		}

		// Le timer expire → approval_expired (auto-refus parti).
		for {
			msg := client.recv(t)
			if msg["type"] == "approval_expired" {
				break
			}
		}
		backend.submitted = 0

		// Réponse tardive : même protection que submit_approval — la question
		// a été auto-refusée, un « Oui » arrivé après coup serait un faux
		// consentement. Refus sans contact RPC.
		if err := client.conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"submit_question_response","requestId":"r12","cascadeId":"casc-1","trajectoryId":"123e4567-e89b-12d3-a456-426614174000","stepIndex":1,"selectedAnswers":["Oui"]}`)); err != nil {
			t.Fatalf("envoi submit_question_response: %v", err)
		}
		got := client.recv(t)
		if got["type"] != "response" || got["error"] == nil {
			t.Fatalf("Attendu error 'approval expired', reçu %v", got)
		}
		if errStr, _ := got["error"].(string); !strings.Contains(errStr, "expired") {
			t.Fatalf("Erreur inattendue: %v", errStr)
		}
		if backend.submitted != 0 {
			t.Fatalf("SubmitToolApproval appelé %d fois après expiration, attendu 0 (garde de fraîcheur)", backend.submitted)
		}
	})
}

type submitApprovalCall struct {
	cascadeID    string
	trajectoryID string
	stepIndex    uint32
	confirm      bool
}

// TestWebSocketSendCommand — route une slash commande vers le backend.
func TestWebSocketSendCommand(t *testing.T) {
	backend := &fakeRPCClient{}
	srv := newTestServer(backend)
	defer srv.Close()
	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	client.send(t, map[string]string{"type": "send_command", "requestId": "r1", "command": "/model gemini-3-pro"})
	msg := client.recv(t)
	if msg["type"] != "response" || msg["requestId"] != "r1" {
		t.Fatalf("Réponse inattendue: %v", msg)
	}
	if backend.lastCommand != "/model gemini-3-pro" {
		t.Fatalf("Commande non routée: %q", backend.lastCommand)
	}
}

// TestWebSocketSendCommandMissingArg — send_command sans command → erreur.
func TestWebSocketSendCommandMissingArg(t *testing.T) {
	srv := newTestServer(&fakeRPCClient{})
	defer srv.Close()
	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	client.send(t, map[string]string{"type": "send_command", "requestId": "r2"})
	msg := client.recv(t)
	if msg["type"] != "response" || msg["error"] == "" {
		t.Fatalf("Attendu une erreur command manquante, reçu %v", msg)
	}
}

// ─── Tests P0 : list_models / delete_cascade / read_file / write_file ───

// TestWebSocketListModels — list_models parse GetAvailableModelsResponse et
// renvoie une liste structurée (pas un dump binaire).
func TestWebSocketListModels(t *testing.T) {
	// Réponse réaliste construite avec le writer de test.
	details := &protoWriter{}
	details.string(1, "Claude 3.7 Sonnet")
	details.varint(2, 1) // supports_images
	details.varint(3, 1) // supports_thinking
	details.varint(6, 1) // recommended
	entry := &protoWriter{}
	entry.string(1, "claude-3-7-sonnet")
	entry.bytes(2, details.buf)
	fetch := &protoWriter{}
	fetch.bytes(1, entry.buf)
	outer := &protoWriter{}
	outer.bytes(1, fetch.buf)

	backend := &fakeRPCClient{modelsRaw: connectrpc.Frame(outer.buf)}
	srv := newTestServer(backend)
	defer srv.Close()
	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	client.send(t, map[string]string{"type": "list_models", "requestId": "rM"})
	msg := client.recv(t)
	if msg["type"] != "response" || msg["requestId"] != "rM" {
		t.Fatalf("Réponse inattendue: %v", msg)
	}
	data, ok := msg["data"].(map[string]interface{})
	if !ok {
		t.Fatalf("data manquant: %v", msg)
	}
	models, ok := data["models"].([]interface{})
	if !ok || len(models) != 1 {
		t.Fatalf("attendu 1 modèle, reçu %v", data)
	}
	first, ok := models[0].(map[string]interface{})
	if !ok || first["modelId"] != "claude-3-7-sonnet" || first["displayName"] != "Claude 3.7 Sonnet" {
		t.Fatalf("modèle mal décodé: %v", models[0])
	}
	if first["supportsThinking"] != true || first["recommended"] != true {
		t.Fatalf("flags mal décodés: %v", first)
	}
}

// TestWebSocketDeleteCascade — confirmation requise, purge d'état après succès.
func TestWebSocketDeleteCascade(t *testing.T) {
	backend := &fakeRPCClient{}
	srv := newTestServer(backend)
	defer srv.Close()
	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	// 1. Sans confirm → refus (aucun appel RPC).
	client.send(t, map[string]string{"type": "delete_cascade", "requestId": "rD1", "cascadeId": "casc-9"})
	msg := client.recv(t)
	if msg["type"] != "response" || msg["error"] == "" {
		t.Fatalf("Attendu refus confirmation, reçu %v", msg)
	}
	if backend.lastDelete != "" {
		t.Fatalf("DeleteCascade ne devrait pas être appelé sans confirmation")
	}

	// 2. Avec confirm → RPC appelé + réponse OK + broadcast sessions_updated.
	client.send(t, map[string]string{"type": "delete_cascade", "requestId": "rD2", "cascadeId": "casc-9", "confirm": "true"})
	msg = client.recv(t)
	if msg["type"] != "response" || msg["requestId"] != "rD2" || msg["error"] != nil {
		t.Fatalf("Réponse inattendue: %v", msg)
	}
	if backend.lastDelete != "casc-9" {
		t.Fatalf("DeleteCascade appelé avec %q, attendu casc-9", backend.lastDelete)
	}

	// 3. Le broadcast sessions_updated arrive APRÈS la réponse unary : les autres
	//    surfaces (téléphones, PC) voient la suppression immédiatement.
	broadcast := client.recv(t)
	if broadcast["type"] != "sessions_updated" {
		t.Fatalf("Attendu broadcast sessions_updated après suppression, reçu %v", broadcast)
	}
}

// TestWebSocketDeleteCascadePurgesState — après succès, le buffer StepRecovery
// et l'approbation en attente sont purgés (pas de fantôme sur get_pending_approval).
func TestWebSocketDeleteCascadePurgesState(t *testing.T) {
	backend := &fakeRPCClient{}
	srv := NewServer(backend, "")

	// Simule un stream en cours + approbation posée.
	srv.MarkCascadeActive("casc-9")
	srv.streamBuffer.RecordEvent("casc-9", OutgoingMessage{Type: "delta", Data: "old"})
	srv.MarkApprovalPending("casc-9", connectrpc.StreamEvent{CallID: "c1", TrajectoryID: "t1", StepIndex: 1, Tool: "run_command"})
	srv.markSessionApproval("casc-9", "run_command")

	srv.purgeCascadeState("casc-9")

	// GetEventsSince sur cascade purgée → (nil, 0) : aucun événement résiduel.
	evts, seq := srv.streamBuffer.GetEventsSince("casc-9", 0)
	if len(evts) != 0 || seq != 0 {
		t.Fatalf("buffer non purgé: %d événements, seq=%d", len(evts), seq)
	}
	if srv.hasPendingApproval("casc-9") {
		t.Fatal("approbation devrait être purgée")
	}
	if srv.hasSessionApproval("casc-9", "run_command") {
		t.Fatal("sessionApproval devrait être purgée")
	}
	srv.mu.Lock()
	active := srv.activeCascades["casc-9"]
	srv.mu.Unlock()
	if active {
		t.Fatal("activeCascades devrait être purgé")
	}
}

// TestWebSocketReadFile — read_file lit un fichier dans ~/.gemini (toujours autorisé).
func TestWebSocketReadFile(t *testing.T) {
	home, _ := os.UserHomeDir()
	// Créer un fichier temporaire dans ~/.gemini (zone toujours autorisée)
	tmpFile, err := os.CreateTemp(filepath.Join(home, ".gemini"), "test_read_*.txt")
	if err != nil {
		t.Skip("impossible de créer le fichier temp dans ~/.gemini:", err)
	}
	defer os.Remove(tmpFile.Name())
	_ = os.WriteFile(tmpFile.Name(), []byte("hello test"), 0644)
	tmpFile.Close()

	srv := newTestServer(&fakeRPCClient{})
	defer srv.Close()
	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	client.send(t, map[string]string{"type": "read_file", "requestId": "rR", "filePath": tmpFile.Name()})
	msg := client.recv(t)
	if msg["type"] != "response" || msg["error"] != nil {
		t.Fatalf("Réponse inattendue: %v", msg)
	}
}

// TestWebSocketReadFileMissingPath — read_file sans filePath → erreur.
func TestWebSocketReadFileMissingPath(t *testing.T) {
	srv := newTestServer(&fakeRPCClient{})
	defer srv.Close()
	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	client.send(t, map[string]string{"type": "read_file", "requestId": "rR2"})
	msg := client.recv(t)
	if msg["type"] != "response" || msg["error"] == nil {
		t.Fatalf("Attendu erreur filePath manquant, reçu %v", msg)
	}
}

// TestWebSocketWriteFile — write_file décode base64 et route vers WriteFile.
func TestWebSocketWriteFile(t *testing.T) {
	backend := &fakeRPCClient{}
	srv := newTestServer(backend)
	defer srv.Close()
	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	content := base64.StdEncoding.EncodeToString([]byte("package main\n"))
	payload := map[string]interface{}{
		"type":      "write_file",
		"requestId": "rW",
		"filePath":  `C:\Users\test\proj\main.go`,
		"content":   content,
		"overwrite": true,
	}
	b, _ := json.Marshal(payload)
	if err := client.conn.WriteMessage(websocket.TextMessage, b); err != nil {
		t.Fatalf("envoi write_file: %v", err)
	}
	msg := client.recv(t)
	if msg["type"] != "response" || msg["error"] != nil {
		t.Fatalf("Réponse inattendue: %v", msg)
	}
	if backend.lastWrite == nil {
		t.Fatal("WriteFile non appelé")
	}
	if backend.lastWrite.uri != "file:///C:/Users/test/proj/main.go" {
		t.Fatalf("WriteFile uri = %q", backend.lastWrite.uri)
	}
	if string(backend.lastWrite.content) != "package main\n" {
		t.Fatalf("WriteFile content = %q", backend.lastWrite.content)
	}
	if !backend.lastWrite.overwrite {
		t.Fatal("WriteFile overwrite devrait être true")
	}
}

// TestWebSocketWriteFileInvalidBase64 — content non-base64 → erreur, pas d'appel RPC.
func TestWebSocketWriteFileInvalidBase64(t *testing.T) {
	backend := &fakeRPCClient{}
	srv := newTestServer(backend)
	defer srv.Close()
	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	client.send(t, map[string]string{"type": "write_file", "requestId": "rW2", "filePath": "C:/x/y.go", "content": "%%%not-base64%%%"})
	msg := client.recv(t)
	if msg["type"] != "response" || msg["error"] == "" {
		t.Fatalf("Attendu erreur base64, reçu %v", msg)
	}
}

// TestWebSocketSetApprovalTimeout — chaîne Settings mobile → daemon :
// le message WS "set_approval_timeout" met à jour approvalTimeout ET
// la réponse confirme la valeur. La mise à jour est ensuite visible via
// l'expiration d'une approbation (auto-refus après le nouveau délai).
func TestWebSocketSetApprovalTimeout(t *testing.T) {
	t.Run("minutes valides => réponse + timer mis à jour", func(t *testing.T) {
		backend := &fakeRPCClient{streamDeltas: []string{`{"run_command":"npx jest","step_index":1,"trajectory_id":"123e4567-e89b-12d3-a456-426614174000"}`}}
		ts, gw := newTestServerWithGW(backend)
		defer ts.Close()
		client := dialWS(t, "ws"+strings.TrimPrefix(ts.URL, "http")+"/ws")
		defer client.conn.Close()

		// Mise à jour du délai (30 min, format JSON nombre flottant).
		client.sendRaw(t, `{"type":"set_approval_timeout","requestId":"t1","data":{"minutes":30}}`)
		msg := client.recv(t)
		if msg["type"] != "response" || msg["requestId"] != "t1" {
			t.Fatalf("Réponse inattendue: %v", msg)
		}
		data, _ := msg["data"].(map[string]interface{})
		if data == nil || data["approvalTimeoutMinutes"] != float64(30) {
			t.Fatalf("Réponse sans confirmation du délai: %v", msg)
		}

		// Le délai est réellement appliqué : une approbation reçue ensuite
		// expire après 80 ms (au lieu des 5 min par défaut).
		gw.SetApprovalTimeout(80 * time.Millisecond)

		client.send(t, map[string]string{"type": "send_prompt", "requestId": "r9", "cascadeId": "casc-1", "prompt": "travaille"})
		for {
			m := client.recv(t)
			if m["type"] == "stream_end" {
				break
			}
		}

		expired := client.recv(t)
		if expired["type"] != "approval_expired" {
			t.Fatalf("Attendu approval_expired après expiration rapide, reçu %v", expired)
		}
	})

	t.Run("minutes invalides => erreur", func(t *testing.T) {
		srv := newTestServer(&fakeRPCClient{})
		defer srv.Close()
		client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
		defer client.conn.Close()

		client.sendRaw(t, `{"type":"set_approval_timeout","requestId":"t2","data":{"minutes":-5}}`)
		msg := client.recv(t)
		if msg["type"] != "response" || msg["error"] == "" {
			t.Fatalf("Attendu une erreur minutes invalides, reçu %v", msg)
		}
	})
}

// TestWebSocketSetAutoAccept — chaîne Settings mobile → daemon :
// le message WS "set_auto_accept" met à jour le flag autoAcceptEnabled ET
// la réponse confirme la valeur. Seules les actions read-only sont
// auto-approuvées (SubmitToolApproval confirm=true) ; les écritures restent
// soumises à l'approbation utilisateur.
func TestWebSocketSetAutoAccept(t *testing.T) {
	t.Run("enable => read-only auto-approuvé sans approval_pending", func(t *testing.T) {
		backend := &fakeApprovalRPC{}
		backend.streamDeltas = []string{
			`{"read_file":"src/main.dart","step_index":1,"trajectory_id":"123e4567-e89b-12d3-a456-426614174000"}`,
		}
		srv := newTestServer(backend)
		defer srv.Close()
		client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
		defer client.conn.Close()

		// Active l'auto-accept via le message WS (comme le toggle mobile).
		client.sendRaw(t, `{"type":"set_auto_accept","requestId":"aa1","data":{"enabled":true}}`)
		msg := client.recv(t)
		if msg["type"] != "response" || msg["requestId"] != "aa1" {
			t.Fatalf("Réponse inattendue: %v", msg)
		}
		data, _ := msg["data"].(map[string]interface{})
		if data == nil || data["autoAcceptEnabled"] != true {
			t.Fatalf("Réponse sans confirmation du flag: %v", msg)
		}

		client.send(t, map[string]string{"type": "send_prompt", "requestId": "r9", "cascadeId": "casc-1", "prompt": "travaille"})
		var sawPending bool
		for {
			m := client.recv(t)
			if m["type"] == "approval_pending" {
				sawPending = true
			}
			if m["type"] == "stream_end" {
				break
			}
		}
		if sawPending {
			t.Fatal("approval_pending diffusé alors que read_file était auto-approuvé")
		}

		got, ok := backend.lastApproval.(*submitApprovalCall)
		if !ok {
			t.Fatalf("Aucun SubmitToolApproval enregistré: %v", backend.lastApproval)
		}
		if !got.confirm {
			t.Fatalf("Auto-approbation attendue confirm=true, reçu confirm=%v", got.confirm)
		}
		if backend.submitted != 1 {
			t.Fatalf("SubmitToolApproval appelé %d fois, attendu 1", backend.submitted)
		}
	})

	t.Run("enable => écriture jamais auto-approuvée", func(t *testing.T) {
		backend := &fakeApprovalRPC{}
		backend.streamDeltas = []string{
			`{"write_to_file":"src/main.dart","step_index":1,"trajectory_id":"123e4567-e89b-12d3-a456-426614174000"}`,
		}
		srv := newTestServer(backend)
		defer srv.Close()
		client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
		defer client.conn.Close()

		client.sendRaw(t, `{"type":"set_auto_accept","requestId":"aa2","data":{"enabled":true}}`)
		if msg := client.recv(t); msg["type"] != "response" || msg["error"] != nil {
			t.Fatalf("Réponse inattendue: %v", msg)
		}

		client.send(t, map[string]string{"type": "send_prompt", "requestId": "r9", "cascadeId": "casc-1", "prompt": "travaille"})
		var sawPending bool
		for {
			m := client.recv(t)
			if m["type"] == "approval_pending" {
				sawPending = true
			}
			if m["type"] == "stream_end" {
				if !sawPending {
					t.Fatal("approval_pending jamais émis pour write_to_file (non read-only)")
				}
				break
			}
		}
		if backend.submitted != 0 {
			t.Fatalf("SubmitToolApproval appelé %d fois, attendu 0 (écriture jamais auto-approuvée)", backend.submitted)
		}
	})

	t.Run("disable => read-only reste en attente", func(t *testing.T) {
		backend := &fakeApprovalRPC{}
		backend.streamDeltas = []string{
			`{"read_file":"src/main.dart","step_index":1,"trajectory_id":"123e4567-e89b-12d3-a456-426614174000"}`,
		}
		srv := newTestServer(backend)
		defer srv.Close()
		client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
		defer client.conn.Close()

		// Désactive (valeur par défaut) : aucune auto-approbation.
		client.sendRaw(t, `{"type":"set_auto_accept","requestId":"aa3","data":{"enabled":false}}`)
		if msg := client.recv(t); msg["type"] != "response" || msg["error"] != nil {
			t.Fatalf("Réponse inattendue: %v", msg)
		}

		client.send(t, map[string]string{"type": "send_prompt", "requestId": "r9", "cascadeId": "casc-1", "prompt": "travaille"})
		var sawPending bool
		for {
			m := client.recv(t)
			if m["type"] == "approval_pending" {
				sawPending = true
			}
			if m["type"] == "stream_end" {
				if !sawPending {
					t.Fatal("approval_pending jamais émis (read-only non auto-approuvé)")
				}
				break
			}
		}
		if backend.submitted != 0 {
			t.Fatalf("SubmitToolApproval appelé %d fois, attendu 0 (auto-accept désactivé)", backend.submitted)
		}
	})
}

// TestWebSocketGetQuotaSummary vérifie que get_quota_summary renvoie les 4
// pourcentages décodés depuis la réponse protobuf brute (et non le protobuf).
func TestWebSocketGetQuotaSummary(t *testing.T) {
	backend := &fakeRPCClient{
		quotaRaw: quotaFrame(t, map[string]float32{
			"gemini-weekly": 0.42,
			"gemini-5h":     0.68,
			"3p-weekly":     0.10,
			"3p-5h":         0.95,
		}),
	}
	srv := newTestServer(backend)
	defer srv.Close()
	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	client.send(t, map[string]string{"type": "get_quota_summary", "requestId": "rQ1"})
	msg := client.recv(t)
	if msg["type"] != "response" || msg["requestId"] != "rQ1" {
		t.Fatalf("Réponse inattendue: %v", msg)
	}
	data, ok := msg["data"].(map[string]interface{})
	if !ok {
		t.Fatalf("Données quota manquantes: %v", msg)
	}
	expected := map[string]int{"weeklyPercent": 42, "fiveHourPercent": 68, "weeklyPercentClaude": 10, "fiveHourPercentClaude": 95}
	for k, want := range expected {
		got, _ := data[k].(float64)
		if int(got) != want {
			t.Errorf("%s = %v, attendu %d", k, data[k], want)
		}
	}
}

// quotaFrame construit une réponse protobuf synthétique de quota (voir
// connectrpc.ParseQuotaSummary pour le format attendu).
func quotaFrame(t *testing.T, values map[string]float32) []byte {
	t.Helper()
	var buf []byte
	for key, v := range values {
		buf = append(buf, 0x0A, byte(len(key)))
		buf = append(buf, key...)
		buf = append(buf, 0x25)
		bits := math.Float32bits(v)
		buf = append(buf, byte(bits), byte(bits>>8), byte(bits>>16), byte(bits>>24))
	}
	return buf
}

// TestWebSocketGetUserStatus vérifie la récupération du statut utilisateur.
func TestWebSocketGetUserStatus(t *testing.T) {
	backend := &fakeRPCClient{}
	srv := newTestServer(backend)
	defer srv.Close()
	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	client.send(t, map[string]string{"type": "get_user_status", "requestId": "rUsr1"})
	msg := client.recv(t)
	if msg["type"] != "response" || msg["requestId"] != "rUsr1" {
		t.Fatalf("Réponse inattendue: %v", msg)
	}
	data, ok := msg["data"].(map[string]interface{})
	if !ok || data["user"] == nil {
		t.Fatalf("Données de statut utilisateur manquantes: %v", msg)
	}
}

// TestWebSocketGetModelStatuses vérifie la récupération des statuts modèles.
func TestWebSocketGetModelStatuses(t *testing.T) {
	backend := &fakeRPCClient{}
	srv := newTestServer(backend)
	defer srv.Close()
	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	client.send(t, map[string]string{"type": "get_model_statuses", "requestId": "rM1"})
	msg := client.recv(t)
	if msg["type"] != "response" || msg["requestId"] != "rM1" {
		t.Fatalf("Réponse inattendue: %v", msg)
	}
	data, ok := msg["data"].(map[string]interface{})
	if !ok || data["modelStatuses"] == nil {
		t.Fatalf("Statuts modèles manquants: %v", msg)
	}
}

// TestWebSocketGenerateCommitMessage vérifie la génération de commit IA.
func TestWebSocketGenerateCommitMessage(t *testing.T) {
	backend := &fakeRPCClient{}
	srv := newTestServer(backend)
	defer srv.Close()
	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	client.send(t, map[string]string{"type": "generate_commit_message", "requestId": "rCm1"})
	msg := client.recv(t)
	if msg["type"] != "response" || msg["requestId"] != "rCm1" {
		t.Fatalf("Réponse inattendue: %v", msg)
	}
	data, ok := msg["data"].(map[string]interface{})
	if !ok || data["commitMessage"] == nil {
		t.Fatalf("Message de commit manquant: %v", msg)
	}
}

// TestWebSocketExportMarkdown vérifie l'export de trajectoire en Markdown.
func TestWebSocketExportMarkdown(t *testing.T) {
	backend := &fakeRPCClient{}
	srv := newTestServer(backend)
	defer srv.Close()
	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	client.send(t, map[string]string{"type": "export_markdown", "requestId": "rMd1", "cascadeId": "casc-1"})
	msg := client.recv(t)
	if msg["type"] != "response" || msg["requestId"] != "rMd1" {
		t.Fatalf("Réponse inattendue: %v", msg)
	}
	if msg["data"] == nil {
		t.Fatalf("Données markdown manquantes: %v", msg)
	}
}

// TestWebSocketCreateWorktree vérifie la création de worktree.
func TestWebSocketCreateWorktree(t *testing.T) {
	backend := &fakeRPCClient{}
	srv := newTestServer(backend)
	defer srv.Close()
	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	client.send(t, map[string]string{"type": "create_worktree", "requestId": "rWt1", "command": "feature/new-branch"})
	msg := client.recv(t)
	if msg["type"] != "response" || msg["requestId"] != "rWt1" {
		t.Fatalf("Réponse inattendue: %v", msg)
	}
}

// TestIsSessionActivelyRunningDoesNotTimeoutAt1800ms vérifie qu'une session avec statut RUNNING
// ne repasse pas prématurément à faux après 1800ms d'inactivité disque (ex: test unitaire ou thinking en cours).
func TestIsSessionActivelyRunningDoesNotTimeoutAt1800ms(t *testing.T) {
	srv := &Server{
		jetboxSummaries: map[string]connectrpc.JetboxSummary{
			"casc-running": {CascadeID: "casc-running", Status: "CASCADE_STATUS_RUNNING"},
		},
		runningTasks: newRunningTaskManager(),
	}

	if !srv.isSessionActivelyRunning("casc-running") {
		t.Fatal("attendu isSessionActivelyRunning=true pour une session RUNNING")
	}

	// Même avec une tâche enregistrée, elle reste active
	srv.runningTasks.startTask("task-1", "php vendor/bin/phpunit", "casc-running", nil)
	if !srv.isSessionActivelyRunning("casc-running") {
		t.Fatal("attendu isSessionActivelyRunning=true lorsqu'une commande est en cours")
	}

	// Quand Jetbox passe à READY et aucune tâche n'est en cours, elle n'est plus active
	srv.runningTasks.finishTask("task-1", "completed")
	srv.mu.Lock()
	sum := srv.jetboxSummaries["casc-running"]
	sum.Status = "CASCADE_STATUS_READY"
	srv.jetboxSummaries["casc-running"] = sum
	srv.mu.Unlock()

	if srv.isSessionActivelyRunning("casc-running") {
		t.Fatal("attendu isSessionActivelyRunning=false quand la session passe à READY")
	}
}


