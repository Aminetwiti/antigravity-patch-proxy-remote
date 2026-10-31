package gateway

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/antigravity/remote-daemon/pkg/connectrpc"
)

// --- Helpers locaux ---

// gwTestServer démarre un serveur de test et retourne (server, gateway, fake).
func gwTestServer(t *testing.T, f *fakeRPCClient) (string, *Server, *fakeRPCClient) {
	t.Helper()
	if f == nil {
		f = &fakeRPCClient{}
	}
	ts, gw := newTestServerWithGW(f)
	t.Cleanup(ts.Close)
	return ts.URL, gw, f
}

// gwSend envoie un message JSON brut et attend la réponse associée.
func gwSend(t *testing.T, url, raw string) map[string]interface{} {
	t.Helper()
	client := dialWS(t, "ws"+strings.TrimPrefix(url, "http")+"/ws")
	defer client.conn.Close()
	client.sendRaw(t, raw)
	for {
		msg := client.recv(t)
		if msg["requestId"] != nil {
			return msg
		}
	}
}

// --- Tests VCS (git_state) ---

func TestGatewayGitState(t *testing.T) {
	url, _, _ := gwTestServer(t, nil)
	resp := gwSend(t, url, `{"type":"git_state","requestId":"req-git-state","workspacePath":"C:\\repo"}`)
	if resp["error"] != nil {
		t.Fatalf("git_state error: %v", resp["error"])
	}
	data, _ := resp["data"].(map[string]interface{})
	if data == nil {
		t.Fatalf("git_state data nil, response=%v", resp)
	}
	if data["currentRef"] != "main" {
		t.Errorf("currentRef = %v, want main", data["currentRef"])
	}
	if data["vcsType"] != "GIT" {
		t.Errorf("vcsType = %v, want GIT", data["vcsType"])
	}
	wd, _ := data["workingDirectoryChanges"].([]interface{})
	if len(wd) != 2 {
		t.Fatalf("workingDirectoryChanges len = %d, want 2", len(wd))
	}
	staged, _ := data["stagedChanges"].([]interface{})
	if len(staged) != 1 {
		t.Errorf("stagedChanges len = %d, want 1", len(staged))
	}
	commits, _ := data["commits"].([]interface{})
	if len(commits) != 1 {
		t.Fatalf("commits len = %d, want 1", len(commits))
	}
	first := commits[0].(map[string]interface{})
	if first["id"] != "abc123" {
		t.Errorf("commit id = %v, want abc123", first["id"])
	}
	if first["subject"] != "feat: test commit" {
		t.Errorf("commit subject = %v", first["subject"])
	}
	if inConflict, _ := data["inConflict"].(bool); inConflict {
		t.Errorf("inConflict = true, want false")
	}
}

func TestGatewayGitStateMissingPath(t *testing.T) {
	url, _, _ := gwTestServer(t, nil)
	resp := gwSend(t, url, `{"type":"git_state","requestId":"req-git-missing"}`)
	if resp["error"] == nil {
		t.Fatal("git_state sans workspacePath devrait échouer")
	}
	if !strings.Contains(resp["error"].(string), "workspacePath") {
		t.Errorf("erreur = %v, veut mentionner workspacePath", resp["error"])
	}
}

// --- Tests Git mutations ---

func TestGatewayGitStage(t *testing.T) {
	url, _, f := gwTestServer(t, nil)
	resp := gwSend(t, url, `{"type":"git_stage","requestId":"req-stage","workspacePath":"C:\\repo","data":{"uris":["file:///C:/repo/main.go","file:///C:/repo/new.go"]}}`)
	if resp["error"] != nil {
		t.Fatalf("git_stage error: %v", resp["error"])
	}
	data, _ := resp["data"].(map[string]interface{})
	if data["status"] != "staged" {
		t.Fatalf("status = %v, want staged", data["status"])
	}
	if f.lastGitOp == nil || f.lastGitOp.op != "stage" {
		t.Fatalf("lastGitOp = %+v, want stage", f.lastGitOp)
	}
	if f.lastGitOp.workspaceURI != "file:///C:/repo" {
		t.Errorf("workspaceURI = %q, want file:///C:/repo", f.lastGitOp.workspaceURI)
	}
	if len(f.lastGitOp.uris) != 2 {
		t.Errorf("uris len = %d, want 2", len(f.lastGitOp.uris))
	}
}

func TestGatewayGitStageMissingUris(t *testing.T) {
	url, _, _ := gwTestServer(t, nil)
	resp := gwSend(t, url, `{"type":"git_stage","requestId":"req-stage-nouri","workspacePath":"C:\\repo"}`)
	if resp["error"] == nil {
		t.Fatal("git_stage sans uris devrait échouer")
	}
}

func TestGatewayGitCommit(t *testing.T) {
	url, _, f := gwTestServer(t, nil)
	resp := gwSend(t, url, `{"type":"git_commit","requestId":"req-commit","workspacePath":"C:\\repo","data":{"message":"feat: mobile commit"}}`)
	if resp["error"] != nil {
		t.Fatalf("git_commit error: %v", resp["error"])
	}
	data, _ := resp["data"].(map[string]interface{})
	if data["status"] != "committed" {
		t.Fatalf("status = %v, want committed", data["status"])
	}
	if f.lastGitOp == nil || f.lastGitOp.op != "commit" {
		t.Fatalf("lastGitOp = %+v, want commit", f.lastGitOp)
	}
	if f.lastGitOp.message != "feat: mobile commit" {
		t.Errorf("message = %q, want feat: mobile commit", f.lastGitOp.message)
	}
}

func TestGatewayGitCommitMissingMessage(t *testing.T) {
	url, _, _ := gwTestServer(t, nil)
	resp := gwSend(t, url, `{"type":"git_commit","requestId":"req-commit-nomsg","workspacePath":"C:\\repo"}`)
	if resp["error"] == nil {
		t.Fatal("git_commit sans message devrait échouer")
	}
}

func TestGatewayGitDiscardRequiresConfirm(t *testing.T) {
	url, _, f := gwTestServer(t, nil)
	resp := gwSend(t, url, `{"type":"git_discard","requestId":"req-discard-noconfirm","workspacePath":"C:\\repo","data":{"uris":["file:///C:/repo/main.go"]}}`)
	if resp["error"] == nil {
		t.Fatal("git_discard sans confirm devrait échouer")
	}
	if f.lastGitOp != nil {
		t.Fatalf("RPC appelé sans confirmation : %+v", f.lastGitOp)
	}
}

func TestGatewayGitDiscardWithConfirm(t *testing.T) {
	url, _, f := gwTestServer(t, nil)
	resp := gwSend(t, url, `{"type":"git_discard","requestId":"req-discard-confirm","workspacePath":"C:\\repo","confirm":true,"data":{"uris":["file:///C:/repo/main.go"]}}`)
	if resp["error"] != nil {
		t.Fatalf("git_discard error: %v", resp["error"])
	}
	data, _ := resp["data"].(map[string]interface{})
	if data["status"] != "discarded" {
		t.Fatalf("status = %v, want discarded", data["status"])
	}
	if f.lastGitOp == nil || f.lastGitOp.op != "discard" {
		t.Fatalf("lastGitOp = %+v, want discard", f.lastGitOp)
	}
}

func TestGatewayGitCommitDetails(t *testing.T) {
	url, _, f := gwTestServer(t, nil)
	resp := gwSend(t, url, `{"type":"git_commit_details","requestId":"req-details","workspacePath":"C:\\repo","commitId":"abc123"}`)
	if resp["error"] != nil {
		t.Fatalf("git_commit_details error: %v", resp["error"])
	}
	if f.lastGitOp == nil || f.lastGitOp.op != "commit_details" {
		t.Fatalf("lastGitOp = %+v, want commit_details", f.lastGitOp)
	}
	if f.lastGitOp.commitID != "abc123" {
		t.Errorf("commitID = %q, want abc123", f.lastGitOp.commitID)
	}
}

// --- Tests Sidecar ---

func TestGatewaySidecarLogs(t *testing.T) {
	url, _, f := gwTestServer(t, nil)
	resp := gwSend(t, url, `{"type":"list_sidecar_log_files","requestId":"req-list","sidecarId":"sc-1"}`)
	if resp["error"] != nil {
		t.Fatalf("list_sidecar_log_files error: %v", resp["error"])
	}
	if f.lastSidecar == nil || f.lastSidecar.op != "list_logs" {
		t.Fatalf("lastSidecar = %+v, want list_logs", f.lastSidecar)
	}
	if f.lastSidecar.sidecarID != "sc-1" {
		t.Errorf("sidecarID = %q, want sc-1", f.lastSidecar.sidecarID)
	}

	resp = gwSend(t, url, `{"type":"get_sidecar_logs","requestId":"req-get","sidecarId":"sc-1","logFileName":"server.log"}`)
	if resp["error"] != nil {
		t.Fatalf("get_sidecar_logs error: %v", resp["error"])
	}
	if f.lastSidecar == nil || f.lastSidecar.op != "get_logs" {
		t.Fatalf("lastSidecar = %+v, want get_logs", f.lastSidecar)
	}
	if f.lastSidecar.logFileName != "server.log" {
		t.Errorf("logFileName = %q, want server.log", f.lastSidecar.logFileName)
	}
}

func TestGatewaySidecarMissingID(t *testing.T) {
	url, _, _ := gwTestServer(t, nil)
	resp := gwSend(t, url, `{"type":"list_sidecar_log_files","requestId":"req-noid"}`)
	if resp["error"] == nil {
		t.Fatal("list_sidecar_log_files sans sidecarId devrait échouer")
	}
}

func TestGatewayManageSidecar(t *testing.T) {
	url, _, f := gwTestServer(t, nil)
	resp := gwSend(t, url, `{"type":"manage_sidecar","requestId":"req-manage","sidecarId":"sc-1","data":{"action":3}}`)
	if resp["error"] != nil {
		t.Fatalf("manage_sidecar error: %v", resp["error"])
	}
	if f.lastSidecar == nil || f.lastSidecar.op != "manage" {
		t.Fatalf("lastSidecar = %+v, want manage", f.lastSidecar)
	}
	if f.lastSidecar.action != 3 {
		t.Errorf("action = %d, want 3", f.lastSidecar.action)
	}
}

func TestGatewayManageSidecarDefaultAction(t *testing.T) {
	url, _, f := gwTestServer(t, nil)
	resp := gwSend(t, url, `{"type":"manage_sidecar","requestId":"req-manage-def","sidecarId":"sc-1"}`)
	if resp["error"] != nil {
		t.Fatalf("manage_sidecar error: %v", resp["error"])
	}
	if f.lastSidecar == nil || f.lastSidecar.action != 2 {
		t.Fatalf("action par défaut = %+v, want 2 (stop)", f.lastSidecar)
	}
}

// --- Tests parseur VCS (paquet connectrpc, via gateway) ---

func TestVcsStateToJSONConflict(t *testing.T) {
	st := &protoWriter{}
	st.string(2, "feature")
	conf := &protoWriter{}
	conf.varint(1, 1) // in_conflict = true
	cf := &protoWriter{}
	cf.string(1, "file:///C:/repo/main.go")
	conf.bytes(3, cf.buf)
	st.bytes(6, conf.buf)
	st.varint(1, 4) // GIT

	out := connectrpc.VcsStateToJSON(connectrpc.Frame(st.buf))
	if out == nil {
		t.Fatal("VcsStateToJSON nil pour un état valide")
	}
	// Le gateway sérialise la struct en JSON (writeJSON) : vérifier le contrat réel.
	b, err := json.Marshal(out)
	if err != nil {
		t.Fatalf("Marshal VcsWorkspaceState: %v", err)
	}
	var m map[string]interface{}
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if m["inConflict"] != true {
		t.Errorf("inConflict = %v, want true", m["inConflict"])
	}
	conflicts, _ := m["conflicts"].([]interface{})
	if len(conflicts) != 1 {
		t.Fatalf("conflicts len = %d, want 1", len(conflicts))
	}
}

func TestVcsTimestamp(t *testing.T) {
	tt := connectrpc.GitTimestampTime(1700000000000)
	if tt.UTC().Year() != 2023 {
		t.Errorf("année = %d, want 2023", tt.UTC().Year())
	}
	if !connectrpc.GitTimestampTime(0).IsZero() {
		t.Error("timestamp 0 doit être zero")
	}
	// Garde anti-panic sur les timestamps absurdes.
	if !connectrpc.GitTimestampTime(-5).IsZero() {
		t.Error("timestamp négatif doit être zero")
	}
}

var _ = time.Now // garde import time
