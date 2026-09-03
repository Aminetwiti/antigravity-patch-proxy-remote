package gateway

import (
	"strings"
	"testing"
)

func TestClipboardGetSetNative(t *testing.T) {
	testVal := "antigravity-sync-test-token-42"
	if err := SetClipboardText(testVal); err != nil {
		t.Skipf("clipboard non supporté dans cet environnement de test: %v", err)
	}

	got, err := GetClipboardText()
	if err != nil {
		t.Fatalf("GetClipboardText a échoué: %v", err)
	}

	if !strings.Contains(got, testVal) {
		t.Errorf("attendu que le presse-papier contienne %q, reçu %q", testVal, got)
	}
}

func TestClipboardWebSocketRPC(t *testing.T) {
	srv := newTestServer(&fakeRPCClient{})
	defer srv.Close()

	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	// 1. Envoyer clipboard.set
	client.sendJSON(t, map[string]interface{}{
		"type":      "clipboard.set",
		"requestId": "clip-set-1",
		"data": map[string]interface{}{
			"text": "deep-sync-token-999",
		},
	})

	var respSet map[string]interface{}
	for {
		msg := client.recv(t)
		if msg["requestId"] == "clip-set-1" {
			respSet = msg
			break
		}
	}
	if respSet["error"] != nil && respSet["error"] != "" {
		t.Skipf("clipboard non disponible sur cette machine: %v", respSet["error"])
	}

	// 2. Envoyer clipboard.get
	client.sendJSON(t, map[string]interface{}{
		"type":      "clipboard.get",
		"requestId": "clip-get-1",
	})

	var respGet map[string]interface{}
	for {
		msg := client.recv(t)
		if msg["requestId"] == "clip-get-1" {
			respGet = msg
			break
		}
	}

	data, _ := respGet["data"].(map[string]interface{})
	if data == nil || !strings.Contains(data["text"].(string), "deep-sync-token-999") {
		t.Errorf("attendu text 'deep-sync-token-999', reçu: %v", respGet)
	}
}

func TestIdeOpenFileValidation(t *testing.T) {
	srv := newTestServer(&fakeRPCClient{})
	defer srv.Close()

	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	// Cas erreur: filePath manquant
	client.sendJSON(t, map[string]interface{}{
		"type":      "ide.open_file",
		"requestId": "open-err-1",
	})

	var resp map[string]interface{}
	for {
		msg := client.recv(t)
		if msg["requestId"] == "open-err-1" {
			resp = msg
			break
		}
	}

	if resp["error"] == nil || !strings.Contains(resp["error"].(string), "filePath requis") {
		t.Errorf("attendu erreur 'filePath requis', reçu: %v", resp)
	}
}
