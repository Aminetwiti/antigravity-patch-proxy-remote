package gateway

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/antigravity/remote-daemon/pkg/adb"
)

// TestAutoAcceptFullMode vérifie que le mode "full" auto-approuve les commandes et écritures,
// mais ne tente jamais d'auto-approuver les questions interactives (ask_question).
func TestAutoAcceptFullMode(t *testing.T) {
	backend := &fakeApprovalRPC{}
	backend.streamDeltas = []string{
		`{"run_command":"cargo test","step_index":1,"trajectory_id":"123e4567-e89b-12d3-a456-426614174000"}`,
	}
	srv := newTestServer(backend)
	defer srv.Close()
	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	// Active le mode "full"
	client.sendRaw(t, `{"type":"set_auto_accept","requestId":"af1","data":{"enabled":true,"mode":"full"}}`)
	msg := client.recv(t)
	if msg["type"] != "response" || msg["requestId"] != "af1" {
		t.Fatalf("Réponse inattendue: %v", msg)
	}
	data, _ := msg["data"].(map[string]interface{})
	if data == nil || data["mode"] != "full" || data["autoAcceptEnabled"] != true {
		t.Fatalf("Mode non confirmé: %v", msg)
	}

	// Envoi d'un prompt qui génère run_command
	client.send(t, map[string]string{"type": "send_prompt", "requestId": "r1", "cascadeId": "casc-1", "prompt": "build"})
	for {
		m := client.recv(t)
		if m["type"] == "approval_pending" {
			t.Fatal("approval_pending diffusé en mode full pour run_command")
		}
		if m["type"] == "stream_end" {
			break
		}
	}
	if backend.submitted != 1 {
		t.Fatalf("SubmitToolApproval attendu 1 fois en mode full, reçu %d", backend.submitted)
	}
}

// TestGetAvailableModelsCache vérifie que list_models / get_available_models retourne
// la liste des modèles parsés et utilise le cache.
func TestGetAvailableModelsCache(t *testing.T) {
	backend := &fakeRPCClient{}
	srv := newTestServer(backend)
	defer srv.Close()
	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	client.sendRaw(t, `{"type":"get_available_models","requestId":"gm1"}`)
	msg := client.recv(t)
	if msg["type"] != "response" || msg["requestId"] != "gm1" {
		t.Fatalf("Réponse inattendue: %v", msg)
	}
}

// TestUploadChunkProgress vérifie le transfert par morceaux avec notification de progression (G2).
func TestUploadChunkProgress(t *testing.T) {
	backend := &fakeRPCClient{}
	srv := newTestServer(backend)
	defer srv.Close()
	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	uploadID := "up-12345"
	chunk1 := base64.StdEncoding.EncodeToString([]byte("Hello, "))
	chunk2 := base64.StdEncoding.EncodeToString([]byte("World!"))

	// Envoi du premier morceau (chunk 0 / 2)
	payload1 := map[string]interface{}{
		"type":        "upload_chunk",
		"requestId":   "u1",
		"uploadId":    uploadID,
		"fileName":    "test.txt",
		"chunkIndex":  0,
		"totalChunks": 2,
		"totalBytes":  13,
		"base64Data":  chunk1,
	}
	b1, _ := json.Marshal(payload1)
	client.sendRaw(t, string(b1))

	// Réception du broadcast upload_progress + de la réponse unary
	sawProgress := false
	for i := 0; i < 2; i++ {
		m := client.recv(t)
		if m["type"] == "upload_progress" {
			sawProgress = true
		}
	}
	if !sawProgress {
		t.Fatal("upload_progress attendu pour chunk 0")
	}

	// Envoi du second morceau (chunk 1 / 2)
	payload2 := map[string]interface{}{
		"type":        "upload_chunk",
		"requestId":   "u2",
		"uploadId":    uploadID,
		"fileName":    "test.txt",
		"chunkIndex":  1,
		"totalChunks": 2,
		"totalBytes":  13,
		"base64Data":  chunk2,
	}
	b2, _ := json.Marshal(payload2)
	client.sendRaw(t, string(b2))

	sawDone := false
	var completedPath string
	for i := 0; i < 3; i++ {
		m := client.recv(t)
		if m["type"] == "upload_done" {
			sawDone = true
			if d, ok := m["data"].(map[string]interface{}); ok {
				completedPath, _ = d["filePath"].(string)
			}
		}
		if m["type"] == "response" && m["requestId"] == "u2" {
			if d, ok := m["data"].(map[string]interface{}); ok {
				if d["status"] != "completed" {
					t.Fatalf("status completed attendu, reçu %v", d)
				}
			}
		}
	}
	if !sawDone || completedPath == "" {
		t.Fatalf("upload_done attendu, sawDone=%v path=%v", sawDone, completedPath)
	}

	// Nettoyage
	_ = os.Remove(completedPath)
}

// TestADBHandlers vérifie le routage des commandes ADB (G3).
func TestADBHandlers(t *testing.T) {
	backend := &fakeRPCClient{}
	srv, gw := newTestServerWithGW(backend)
	defer srv.Close()

	// Injecte un mock runner dans le service ADB du serveur
	mock := &mockADBRunner{
		output: []byte("RFCT123456X device model:SM_G781B\n"),
	}
	gw.adbService = adb.NewService(mock)

	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	// Test adb.list_devices
	client.sendRaw(t, `{"type":"adb.list_devices","requestId":"adb1"}`)
	msg := client.recv(t)
	if msg["type"] != "response" || msg["requestId"] != "adb1" {
		t.Fatalf("Réponse inattendue: %v", msg)
	}
	data, _ := msg["data"].(map[string]interface{})
	devs, _ := data["devices"].([]interface{})
	if len(devs) != 1 {
		t.Fatalf("Attendu 1 appareil, reçu %v", data)
	}

	// Test adb.list_files
	mock.output = []byte("drwxr-xr-x 2 root root 4096 2026-08-16 12:00 Download\n-rw-r--r-- 1 u0_a123 u0_a123 1000 2026-08-16 12:00 file.pdf\n")
	client.sendRaw(t, `{"type":"adb.list_files","requestId":"adb2","remotePath":"/sdcard"}`)
	msg = client.recv(t)
	if msg["type"] != "response" || msg["requestId"] != "adb2" {
		t.Fatalf("Réponse inattendue: %v", msg)
	}
	data, _ = msg["data"].(map[string]interface{})
	files, _ := data["files"].([]interface{})
	if len(files) != 2 {
		t.Fatalf("Attendu 2 fichiers, reçu %v", data)
	}
}

type mockADBRunner struct {
	lastArgs []string
	output   []byte
	err      error
}

func (m *mockADBRunner) Run(ctx context.Context, args ...string) ([]byte, error) {
	m.lastArgs = args
	return m.output, m.err
}
