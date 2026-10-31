package gateway

import (
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gorilla/websocket"
)

// TestSecurityRemediation_ReadFile_TraversalRejection vérifie que les chemins relatifs
// tentant de s'échapper du dossier de session sont strictement rejetés (VULN-01).
func TestSecurityRemediation_ReadFile_TraversalRejection(t *testing.T) {
	tmpDir := t.TempDir()
	secretFile := filepath.Join(tmpDir, "secret.txt")
	_ = os.WriteFile(secretFile, []byte("super-secret-system-data"), 0644)

	s := NewServer(nil, "test-auth-token")
	ts := httptest.NewServer(http.HandlerFunc(s.HandleWebSocket))
	defer ts.Close()

	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws?token=test-auth-token"
	ws, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("Connexion WebSocket échouée: %v", err)
	}
	defer ws.Close()

	// Tentative de lecture traversante
	traversalPath := filepath.Join("..", "..", "..", "..", "..", secretFile)
	req := IncomingMessage{
		Type:      "read_file",
		RequestID: "req-sec-1",
		FilePath:  traversalPath,
	}

	if err := ws.WriteJSON(req); err != nil {
		t.Fatalf("Écriture WS échouée: %v", err)
	}

	var resp OutgoingMessage
	if err := ws.ReadJSON(&resp); err != nil {
		t.Fatalf("Lecture réponse WS échouée: %v", err)
	}

	// Doit explicitement rejeter la tentative (Erreur non vide) et ne JAMAIS renvoyer le contenu secret
	if resp.Error == "" {
		t.Fatalf("FAILLE DE SÉCURITÉ : La tentative de Directory Traversal n'a retourné aucune erreur")
	}
	if resp.Data != nil {
		if dataMap, ok := resp.Data.(map[string]interface{}); ok {
			if content, ok := dataMap["content"].(string); ok && strings.Contains(content, "super-secret-system-data") {
				t.Fatalf("FAILLE DE SÉCURITÉ : Fichier secret lu via Directory Traversal !")
			}
		}
	}
}

// TestSecurityRemediation_UploadMemoryBounds vérifie que les uploads partiels
// dépassant les limites mémoire sont rejetés (VULN-10).
func TestSecurityRemediation_UploadMemoryBounds(t *testing.T) {
	s := NewServer(nil, "test-auth-token")
	// Pré-remplir l'état pour simuler un upload atteignant 50 Mo
	s.uploadChunks["overflow-test-upload"] = &uploadChunkState{
		id:          "overflow-test-upload",
		received:    50 << 20,
		totalBytes:  100 << 20,
		totalChunks: 200,
		chunks:      make(map[int][]byte),
	}

	ts := httptest.NewServer(http.HandlerFunc(s.HandleWebSocket))
	defer ts.Close()

	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws?token=test-auth-token"
	ws, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("Connexion WebSocket échouée: %v", err)
	}
	defer ws.Close()

	// Envoi d'un chunk de 50 Ko
	chunkData := make([]byte, 50*1024)
	b64Chunk := base64.StdEncoding.EncodeToString(chunkData)

	req := IncomingMessage{
		Type:        "upload_chunk",
		RequestID:   "req-sec-upload",
		UploadID:    "overflow-test-upload",
		ChunkIndex:  1,
		TotalChunks: 200,
		TotalBytes:  100 << 20,
		Base64Data:  b64Chunk,
	}

	if err := ws.WriteJSON(req); err != nil {
		t.Fatalf("Écriture WS upload échouée: %v", err)
	}

	var resp OutgoingMessage
	if err := ws.ReadJSON(&resp); err != nil {
		t.Fatalf("Lecture réponse upload échouée: %v", err)
	}

	if !strings.Contains(resp.Error, "dépassée") {
		t.Fatalf("Attendu rejet de mémoire dépassée, reçu: %v", resp.Error)
	}
}
