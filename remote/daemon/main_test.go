package main

import (
	"flag"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/antigravity/remote-daemon/pkg/connectrpc"
	"github.com/antigravity/remote-daemon/pkg/gateway"
)

// TestFlagDefaults — les flags du daemon ont des valeurs par défaut stables
// (port 8090, host 0.0.0.0, approval-timeout 5 min). Un changement accidentel
// du contrat de démarrage serait détecté ici.
func TestFlagDefaults(t *testing.T) {
	fs := flag.NewFlagSet("daemon", flag.ContinueOnError)
	var (
		listenPort         int
		host               string
		tunnelFlag         string
		authToken          string
		approvalTimeoutMin int
	)
	fs.IntVar(&listenPort, "port", 8090, "")
	fs.StringVar(&host, "host", "127.0.0.1", "")
	fs.StringVar(&tunnelFlag, "tunnel", "", "")
	fs.StringVar(&authToken, "auth-token", "", "")
	fs.IntVar(&approvalTimeoutMin, "approval-timeout", 5, "")
	if err := fs.Parse([]string{}); err != nil {
		t.Fatalf("parse: %v", err)
	}
	if listenPort != 8090 || host != "127.0.0.1" || tunnelFlag != "" || authToken != "" || approvalTimeoutMin != 5 {
		t.Fatalf("défauts inattendus: port=%d host=%q tunnel=%q token=%q timeout=%d",
			listenPort, host, tunnelFlag, authToken, approvalTimeoutMin)
	}

	// Parse de flags explicites (--port 9999 --tunnel cloudflare --auth-token x).
	fs2 := flag.NewFlagSet("daemon", flag.ContinueOnError)
	var p2 int
	var t2, a2 string
	fs2.IntVar(&p2, "port", 8090, "")
	fs2.StringVar(&t2, "tunnel", "", "")
	fs2.StringVar(&a2, "auth-token", "", "")
	if err := fs2.Parse([]string{"--port", "9999", "--tunnel", "cloudflare", "--auth-token", "x"}); err != nil {
		t.Fatalf("parse: %v", err)
	}
	if p2 != 9999 || t2 != "cloudflare" || a2 != "x" {
		t.Fatalf("parse explicite inattendu: port=%d tunnel=%q token=%q", p2, t2, a2)
	}
}

// TestMaskToken — le helper masque les jetons longs et laisse passer les
// jetons courts sans paniquer.
func TestMaskToken(t *testing.T) {
	if got := maskToken("abcdefghijklmnop"); got != "abcdefghij" {
		t.Fatalf("maskToken(long) = %q, attendu préfixe 10", got)
	}
	if got := maskToken("short"); got != "short" {
		t.Fatalf("maskToken(court) = %q, attendu inchangé", got)
	}
	if got := maskToken(""); got != "" {
		t.Fatalf("maskToken(vide) = %q, attendu vide", got)
	}
}

// TestHealthHandler — /health répond 200 avec un snapshot JSON exploitable.
// Le chemin 503/degraded (stream en échec) est couvert par TestStatsHealth
// dans pkg/gateway — ici on ne vérifie que le câblage du handler.
func TestHealthHandler(t *testing.T) {
	srv := gateway.NewServer(&stubRPC{}, "")
	rec := httptest.NewRecorder()
	srv.HTTPHandler(rec, httptest.NewRequest(http.MethodGet, "/health", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("/health: code %d, attendu 200", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, "\"status\":\"ok\"") {
		t.Fatalf("/health: corps inattendu %q", body)
	}
}

// TestDiagnosticHandler — /health/diagnostic répond 200 avec un corps JSON.
func TestDiagnosticHandler(t *testing.T) {
	srv := gateway.NewServer(&stubRPC{}, "")
	rec := httptest.NewRecorder()
	srv.DiagnosticHandler(rec, httptest.NewRequest(http.MethodGet, "/health/diagnostic", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("diagnostic: code %d, attendu 200", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "\"process\"") {
		t.Fatalf("diagnostic: corps inattendu %q", rec.Body.String())
	}
}

// stubRPC : RPCClient minimal — suffisant pour /health et /health/diagnostic
// (Stats() enregistre l'échec → degraded) sans toucher au vrai language_server.
// Exposé sous ce nom (test main) pour rester lisible ; alias conservé pour les
// tests qui référencent encore failingRPC.
type stubRPC struct{}
type failingRPC = stubRPC

func (f *stubRPC) Heartbeat() ([]byte, error) { return nil, errFailing }

func (f *failingRPC) CreateCascade(uri string, projectID string, modelUID string, modelEnum uint64) ([]byte, error) {
	return nil, errFailing
}

func (f *failingRPC) GetAllCascades() ([]byte, error) { return nil, errFailing }

func (f *failingRPC) SendMessageStream(cascadeID, text string, onFrame func([]byte) error) error {
	return errFailing
}

func (f *failingRPC) SendMessageStreamModel(cascadeID, text, modelUID string, modelEnum uint64, onFrame func([]byte) error, noTools ...bool) error {
	return errFailing
}

func (f *failingRPC) SendMessageStreamModelWithMedia(cascadeID, text, modelUID string, modelEnum uint64, media []connectrpc.MediaAttachment, onFrame func([]byte) error, noTools ...bool) error {
	return errFailing
}

func (f *failingRPC) SubmitToolApproval(cascadeID, trajectoryID string, stepIndex uint32, oneofField int, oneofPayload []byte) ([]byte, error) {
	return nil, errFailing
}

func (f *failingRPC) SetBrowserOpenConversation(cascadeID string) ([]byte, error) {
	return nil, errFailing
}

func (f *failingRPC) SendCommand(commandText string) ([]byte, error) { return nil, errFailing }

func (f *failingRPC) ListModels() ([]byte, error) { return nil, errFailing }

func (f *failingRPC) DeleteCascade(cascadeID string) ([]byte, error) { return nil, errFailing }

func (f *failingRPC) ReadFile(uri string) ([]byte, error) { return nil, errFailing }

func (f *failingRPC) WriteFile(uri string, content []byte, overwrite bool) ([]byte, error) {
	return nil, errFailing
}

func (f *failingRPC) TrackWorkspace(workspacePath string) ([]byte, error) { return nil, errFailing }

func (f *failingRPC) UntrackWorkspace(workspacePath string) ([]byte, error) { return nil, errFailing }

func (f *failingRPC) GetCascadeTrajectory(cascadeID string, verbosity uint64) ([]byte, error) {
	return nil, errFailing
}

func (f *failingRPC) GetTurnDiff(conversationID string, stepIndex int64) ([]byte, error) {
	return nil, errFailing
}

func (f *failingRPC) GetRevertPreview(cascadeID string, stepIndex int64) ([]byte, error) {
	return nil, errFailing
}

func (f *failingRPC) RevertToCascadeStep(cascadeID string, stepIndex int64) error { return errFailing }

func (f *failingRPC) SendStepsToBackground(conversationID string, stepIndices []int64) error {
	return errFailing
}

func (f *failingRPC) SkipBrowserSubagent(cascadeID string, stepIndex int64) error { return errFailing }

func (f *failingRPC) RetrieveUserQuotaSummary() ([]byte, error) { return nil, errFailing }

func (f *failingRPC) GetUserStatus() ([]byte, error) { return nil, errFailing }

func (f *failingRPC) GetModelStatuses() ([]byte, error) { return nil, errFailing }

func (f *failingRPC) GenerateCommitMessage() ([]byte, error) { return nil, errFailing }

func (f *failingRPC) ConvertTrajectoryToMarkdown(trajectoryID string) ([]byte, error) {
	return nil, errFailing
}

func (f *failingRPC) CreateWorktree(branch, path string) ([]byte, error) { return nil, errFailing }

func (f *failingRPC) GetLintErrors(uri string) ([]byte, error) { return nil, errFailing }

func (f *failingRPC) GetDefinition(uri string, line, character int) ([]byte, error) {
	return nil, errFailing
}

func (f *failingRPC) GetCodeValidationStates(uri string) ([]byte, error) { return nil, errFailing }

func (f *failingRPC) GetVersionControlState(workspacePath string) ([]byte, error) {
	return nil, errFailing
}

func (f *failingRPC) GitStage(workspaceURI string, uris []string) ([]byte, error) {
	return nil, errFailing
}

func (f *failingRPC) GitUnstage(workspaceURI string, uris []string) ([]byte, error) {
	return nil, errFailing
}

func (f *failingRPC) GitDiscard(workspaceURI string, uris []string) ([]byte, error) {
	return nil, errFailing
}

func (f *failingRPC) GitCommit(workspaceURI, message string) ([]byte, error) { return nil, errFailing }

func (f *failingRPC) GetCommitDetails(workspaceURI, commitID string) ([]byte, error) {
	return nil, errFailing
}

func (f *failingRPC) ListSidecarLogFiles(sidecarID string) ([]byte, error) { return nil, errFailing }

func (f *failingRPC) GetSidecarLogs(sidecarID, logFileName string) ([]byte, error) {
	return nil, errFailing
}

func (f *failingRPC) ManageSidecar(sidecarID string, action uint64) ([]byte, error) {
	return nil, errFailing
}

func (f *failingRPC) StartBattleMode(workspaceURI, prompt, modelUIDA string, modelEnumA uint64, modelUIDB string, modelEnumB uint64) ([]byte, error) {
	return nil, errFailing
}

func (f *failingRPC) GetBattleWorktreeDiff(workspaceURI string) ([]byte, error) {
	return nil, errFailing
}

func (f *failingRPC) EliminateBattleArm(armID string) ([]byte, error) { return nil, errFailing }

func (f *failingRPC) EndBattleMode(winningArmID string, mergeStrategy uint64) ([]byte, error) {
	return nil, errFailing
}

func (f *failingRPC) DumpFlightRecorder() ([]byte, error) { return nil, errFailing }

func (f *failingRPC) RefreshMcpServers() ([]byte, error) { return nil, errFailing }

func (f *failingRPC) CompleteMcpOAuth(serverID, authCode string) ([]byte, error) {
	return nil, errFailing
}

func (f *failingRPC) DisconnectMcpOAuth(serverID string) ([]byte, error) { return nil, errFailing }

func (f *failingRPC) HybridSearch(query, workspaceURI string, limit uint32) ([]byte, error) {
	return nil, errFailing
}

func (f *failingRPC) SearchCode(query, workspaceURI string, maxResults, linesContext int32) ([]byte, error) {
	return nil, errFailing
}

func (f *failingRPC) CheckoutWorktree(worktreeDirURI, targetWorkspaceURI string, deleteAfterCheckout bool, mergeStrategy uint64) ([]byte, error) {
	return nil, errFailing
}

func (f *failingRPC) CancelCascadeInvocation(cascadeID string, killBackgroundTasks bool) ([]byte, error) {
	return nil, errFailing
}

func (f *failingRPC) ForceStopCascadeTree(cascadeID string) ([]byte, error) {
	return nil, errFailing
}

func (f *failingRPC) CancelCascadeSteps(cascadeID string, stepIndices []uint32) ([]byte, error) {
	return nil, errFailing
}

// errFailing : erreur sentinelle.
var errFailing = &failingError{}

type failingError struct{}

func (e *failingError) Error() string { return "rpc failed" }

var _ gateway.RPCClient = (*failingRPC)(nil)
