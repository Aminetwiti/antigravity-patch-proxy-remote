package gateway

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/antigravity/remote-daemon/pkg/connectrpc"
)

func TestSaveUploadedImage(t *testing.T) {
	dummyContent := "fake png image content for test"
	b64 := base64.StdEncoding.EncodeToString([]byte(dummyContent))
	cascadeID := testUUID()

	filePath, mdRef, err := saveUploadedImage(cascadeID, "screenshot.png", b64)
	if err != nil {
		t.Fatalf("unexpected error saving uploaded image: %v", err)
	}
	defer os.Remove(filePath)

	if !strings.HasPrefix(mdRef, "![Uploaded Image](file:///") {
		t.Fatalf("unexpected markdown reference format: %s", mdRef)
	}

	readBytes, err := os.ReadFile(filePath)
	if err != nil {
		t.Fatalf("failed to read written file: %v", err)
	}
	if string(readBytes) != dummyContent {
		t.Fatalf("expected content %q, got %q", dummyContent, string(readBytes))
	}
}

func TestSaveUploadedImage_DataUrlPrefix(t *testing.T) {
	dummyContent := "jpeg binary data"
	b64 := "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString([]byte(dummyContent))
	cascadeID := testUUID()

	filePath, _, err := saveUploadedImage(cascadeID, "photo.jpg", b64)
	if err != nil {
		t.Fatalf("unexpected error saving uploaded image with data url: %v", err)
	}
	defer os.Remove(filePath)

	if !strings.HasSuffix(filePath, ".png") {
		t.Fatalf("expected .png extension (transcoded), got %s", filePath)
	}
}

func TestSaveUploadedImage_Validation(t *testing.T) {
	if _, _, err := saveUploadedImage("", "test.png", "abc"); err == nil {
		t.Fatal("expected error on empty cascadeId")
	}
	if _, _, err := saveUploadedImage(testUUID(), "test.png", ""); err == nil {
		t.Fatal("expected error on empty base64Data")
	}
	// Path traversal : un cascadeId malveillant (ex. ../../evil, /etc, \windows) doit être rejeté.
	if _, _, err := saveUploadedImage("../../evil", "test.png", "abc"); err == nil {
		t.Fatal("expected error on path traversal cascadeId")
	}
	if _, _, err := saveUploadedImage("/etc/passwd", "test.png", "abc"); err == nil {
		t.Fatal("expected error on absolute path cascadeId")
	}

	// Safe session IDs (non-UUID mais sûrs, ex: cascade-12345, s3, casc-x) doivent être acceptés.
	b64 := base64.StdEncoding.EncodeToString([]byte("test content"))
	filePath, _, err := saveUploadedImage("cascade-1787194458484", "test.png", b64)
	if err != nil {
		t.Fatalf("expected safe session ID to be accepted: %v", err)
	}
	defer os.Remove(filePath)
}

func TestReadFile_UploadedImageLeadingSlash(t *testing.T) {
	dummyContent := "image binary payload"
	b64 := base64.StdEncoding.EncodeToString([]byte(dummyContent))
	cascadeID := "cascade-img-test"

	filePath, _, err := saveUploadedImage(cascadeID, "photo_1787194458484.jpg", b64)
	if err != nil {
		t.Fatalf("failed to save test image: %v", err)
	}
	defer os.Remove(filePath)

	bDir := findBrainDir(cascadeID)
	if bDir == "" {
		t.Skip("brain directory not available in test environment")
	}

	cleanPath := "/photo_1787194458484.png"
	relCleanPath := strings.TrimLeft(cleanPath, "/\\")
	baseFileName := "photo_1787194458484.png"

	candidates := []string{
		filePath,
		filepath.Join(bDir, relCleanPath),
		filepath.Join(bDir, ".user_uploaded", relCleanPath),
		filepath.Join(bDir, "scratch", relCleanPath),
		filepath.Join(bDir, ".user_uploaded", baseFileName),
		filepath.Join(bDir, "scratch", baseFileName),
	}

	found := false
	for _, cand := range candidates {
		if content, errRead := os.ReadFile(cand); errRead == nil {
			if string(content) == dummyContent {
				found = true
				break
			}
		}
	}
	if !found {
		t.Fatal("failed to find uploaded image using candidates with leading slash")
	}
}

type mediaCapturingRPCClient struct {
	fakeRPCClient
	lastMedia   []connectrpc.MediaAttachment
	lastPrompt  string
	lastModel   string
}

func (m *mediaCapturingRPCClient) SendMessageStreamModelWithMedia(cascadeID, text, modelUID string, modelEnum uint64, media []connectrpc.MediaAttachment, onFrame func([]byte) error, noTools ...bool) error {
	m.lastPrompt = text
	m.lastMedia = media
	m.lastModel = modelUID
	return onFrame(pbTextFrame("delta-response"))
}

func TestSendPrompt_MediaAttachmentsAndCleanPrompt(t *testing.T) {
	backend := &mediaCapturingRPCClient{}
	srv := newTestServer(backend)
	defer srv.Close()

	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	// 1. Envoi d'un prompt avec pièces jointes structurées media (image/png)
	// Le LS rejette les images inline dans le protobuf → elles sont filtrées
	// silencieusement (déjà sur disque dans .user_uploaded/, le LS les découvre
	// automatiquement). Le prompt texte reste propre.
	client.sendJSON(t, IncomingMessage{
		Type:      "send_prompt",
		RequestID: "req-media-1",
		CascadeID: "casc-1",
		Prompt:    "analyser cette image",
		Media: []connectrpc.MediaAttachment{
			{
				URI:         "file:///C:/test/path/photo.png",
				MimeType:    "image/png",
				Description: "photo.png",
			},
		},
	})
	_ = client.recv(t) // stream_start
	_ = client.recv(t) // stream_delta
	_ = client.recv(t) // stream_end

	// Prompt texte contient le tag markdown image pour que l'IDE l'affiche
	if !strings.Contains(backend.lastPrompt, "analyser cette image") || !strings.Contains(backend.lastPrompt, "photo.png") {
		t.Errorf("expected prompt containing 'analyser cette image' and image markdown, got %q", backend.lastPrompt)
	}
	// Images filtrées du protobuf
	if len(backend.lastMedia) != 0 {
		t.Fatalf("expected 0 media attachments (images filtered), got %d", len(backend.lastMedia))
	}

	// 2. Envoi d'un prompt avec markdown tag ![name](file:///...)
	// Les refs markdown sont préservées dans le texte pour affichage dans l'IDE
	client.sendJSON(t, IncomingMessage{
		Type:      "send_prompt",
		RequestID: "req-media-2",
		CascadeID: "casc-1",
		Prompt:    "![screenshot.jpg](file:///C:/Users/test/screenshot.jpg)\n\nvoici mon texte",
	})
	_ = client.recv(t) // stream_start
	_ = client.recv(t) // stream_delta
	_ = client.recv(t) // stream_end

	if !strings.Contains(backend.lastPrompt, "voici mon texte") || !strings.Contains(backend.lastPrompt, "screenshot.jpg") {
		t.Errorf("expected prompt to contain 'voici mon texte' and image tag, got %q", backend.lastPrompt)
	}
	if len(backend.lastMedia) != 0 {
		t.Fatalf("expected 0 media attachments (images filtered), got %d", len(backend.lastMedia))
	}
}

func TestSendPrompt_MediaFileAutoRead(t *testing.T) {
	// Créer un fichier image temporaire
	tmpDir := t.TempDir()
	imgFile := filepath.Join(tmpDir, "test_sample.png")
	dummyBytes := []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDRtest_data")
	if err := os.WriteFile(imgFile, dummyBytes, 0644); err != nil {
		t.Fatalf("failed to create temp test image: %v", err)
	}

	backend := &mediaCapturingRPCClient{}
	srv := newTestServer(backend)
	defer srv.Close()

	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	fileURI := "file:///" + filepath.ToSlash(imgFile)
	client.sendJSON(t, IncomingMessage{
		Type:      "send_prompt",
		RequestID: "req-autoread-1",
		CascadeID: "casc-1",
		Prompt:    "analyser mon image",
		Media: []connectrpc.MediaAttachment{
			{
				URI:         fileURI,
				Description: "test_sample.png",
			},
		},
	})
	_ = client.recv(t) // stream_start
	_ = client.recv(t) // stream_delta
	_ = client.recv(t) // stream_end

	// Images filtrées du protobuf, prompt propre
	if len(backend.lastMedia) != 0 {
		t.Fatalf("expected 0 media attachments (images filtered), got %d", len(backend.lastMedia))
	}
	if !strings.Contains(backend.lastPrompt, "analyser mon image") {
		t.Errorf("expected user text in prompt, got %q", backend.lastPrompt)
	}
}



