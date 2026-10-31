package gateway

import (
	"encoding/base64"
	"fmt"
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
	// Le prompt texte reste propre pour l'affichage dans l'IDE (les vignettes sont fournies via protobuf / fichiers).
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

	// Prompt texte reste propre (sans injection de tag markdown brut)
	if !strings.Contains(backend.lastPrompt, "analyser cette image") || strings.Contains(backend.lastPrompt, "![") {
		t.Errorf("expected clean prompt containing 'analyser cette image' without raw markdown tag, got %q", backend.lastPrompt)
	}

	// 2. Envoi d'un prompt avec markdown tag ![name](file:///...)
	// Les tags markdown d'images sont nettoyés du texte pour que l'IDE n'affiche pas le code brut
	client.sendJSON(t, IncomingMessage{
		Type:      "send_prompt",
		RequestID: "req-media-2",
		CascadeID: "casc-1",
		Prompt:    "![screenshot.jpg](file:///C:/Users/test/screenshot.jpg)\n\nvoici mon texte",
	})
	_ = client.recv(t) // stream_start
	_ = client.recv(t) // stream_delta
	_ = client.recv(t) // stream_end

	if !strings.Contains(backend.lastPrompt, "voici mon texte") || strings.Contains(backend.lastPrompt, "![") {
		t.Errorf("expected clean prompt without raw markdown image tag, got %q", backend.lastPrompt)
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

	// Images filtrées du protobuf, métadonnées injectées dans le prompt
	if len(backend.lastMedia) != 0 {
		t.Fatalf("expected 0 media attachments (images filtered), got %d", len(backend.lastMedia))
	}
	if !strings.Contains(backend.lastPrompt, "analyser mon image") {
		t.Errorf("expected user text in prompt, got %q", backend.lastPrompt)
	}
	if !strings.Contains(backend.lastPrompt, "<ADDITIONAL_METADATA>") || !strings.Contains(backend.lastPrompt, "test_sample.png") {
		t.Errorf("expected ADDITIONAL_METADATA with test_sample.png in prompt, got %q", backend.lastPrompt)
	}
}

// ---------------------------------------------------------------------------
// Workflow complet : upload_media → send_prompt → images dans .user_uploaded/
// ---------------------------------------------------------------------------

// TestWorkflow_UploadThenSendPrompt vérifie le flux bout en bout :
// 1. Mobile → upload_media (cascade "source") → fichier sauvegardé
// 2. Mobile → send_prompt (cascade "target") avec URI de l'image
// 3. Le daemon doit copier l'image dans .user_uploaded/ de "target"
func TestWorkflow_UploadThenSendPrompt(t *testing.T) {
	// Étape 1 : simuler upload_media dans une cascade source
	sourceCascade := "cascade-source-" + testUUID()[:8]
	dummyPNG := []byte("fake png data for workflow test")
	b64 := base64.StdEncoding.EncodeToString(dummyPNG)

	srcPath, _, err := saveUploadedImage(sourceCascade, "photo.png", b64)
	if err != nil {
		t.Fatalf("saveUploadedImage failed: %v", err)
	}
	defer os.RemoveAll(filepath.Dir(filepath.Dir(srcPath))) // cleanup source cascade dir

	srcURI := "file:///" + filepath.ToSlash(srcPath)

	// Étape 2 : send_prompt vers une cascade cible différente
	targetCascade := "cascade-target-" + testUUID()[:8]
	backend := &mediaCapturingRPCClient{}
	srv := newTestServer(backend)
	defer srv.Close()

	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	client.sendJSON(t, IncomingMessage{
		Type:      "send_prompt",
		RequestID: "req-wf-1",
		CascadeID: targetCascade,
		Prompt:    "analyse cette photo",
		Media: []connectrpc.MediaAttachment{
			{
				URI:         srcURI,
				MimeType:    "image/png",
				Description: "photo.png",
				Base64Data:  b64,
			},
		},
	})
	_ = client.recv(t) // stream_start
	_ = client.recv(t) // stream_delta
	_ = client.recv(t) // stream_end

	// Étape 3 : vérifier que l'image existe dans .user_uploaded/ de la cascade cible
	home, _ := os.UserHomeDir()
	targetUploadDir := filepath.Join(home, ".gemini", "antigravity", "brain", targetCascade, ".user_uploaded")
	defer os.RemoveAll(filepath.Join(home, ".gemini", "antigravity", "brain", targetCascade))

	entries, errDir := os.ReadDir(targetUploadDir)
	if errDir != nil {
		t.Fatalf("target .user_uploaded/ directory not found: %v", errDir)
	}
	if len(entries) == 0 {
		t.Fatal("expected at least 1 image in target .user_uploaded/, got 0")
	}

	// Vérifier que le prompt contient le texte utilisateur et le bloc ADDITIONAL_METADATA
	if !strings.Contains(backend.lastPrompt, "analyse cette photo") {
		t.Errorf("prompt text missing, got %q", backend.lastPrompt)
	}
	if !strings.Contains(backend.lastPrompt, "<ADDITIONAL_METADATA>") {
		t.Errorf("expected ADDITIONAL_METADATA in prompt, got %q", backend.lastPrompt)
	}
	if !strings.Contains(backend.lastPrompt, targetCascade+"/.user_uploaded") {
		t.Errorf("expected target image path in ADDITIONAL_METADATA, got %q", backend.lastPrompt)
	}
}

// TestWorkflow_CrossCascadeImageCopy vérifie que quand une image existe
// dans la cascade A et que send_prompt cible la cascade B, l'image
// est automatiquement copiée dans .user_uploaded/ de B.
func TestWorkflow_CrossCascadeImageCopy(t *testing.T) {
	cascadeA := "cascade-a-" + testUUID()[:8]
	cascadeB := "cascade-b-" + testUUID()[:8]
	home, _ := os.UserHomeDir()
	defer os.RemoveAll(filepath.Join(home, ".gemini", "antigravity", "brain", cascadeA))
	defer os.RemoveAll(filepath.Join(home, ".gemini", "antigravity", "brain", cascadeB))

	// Upload dans cascade A
	imgData := []byte("cross cascade test image")
	b64 := base64.StdEncoding.EncodeToString(imgData)
	pathA, _, err := saveUploadedImage(cascadeA, "diagram.png", b64)
	if err != nil {
		t.Fatalf("saveUploadedImage cascade A failed: %v", err)
	}

	// Vérifier que le fichier est dans A
	if !strings.Contains(filepath.ToSlash(pathA), cascadeA) {
		t.Fatalf("image should be in cascade A dir, got %s", pathA)
	}

	// send_prompt vers cascade B avec URI pointant vers cascade A
	uriA := "file:///" + filepath.ToSlash(pathA)
	backend := &mediaCapturingRPCClient{}
	srv := newTestServer(backend)
	defer srv.Close()

	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	client.sendJSON(t, IncomingMessage{
		Type:      "send_prompt",
		RequestID: "req-cross-1",
		CascadeID: cascadeB,
		Prompt:    "regarde ce diagramme",
		Media: []connectrpc.MediaAttachment{
			{URI: uriA, MimeType: "image/png", Description: "diagram.png"},
		},
	})
	_ = client.recv(t) // stream_start
	_ = client.recv(t) // stream_delta
	_ = client.recv(t) // stream_end

	// L'image doit maintenant exister dans cascade B
	targetDir := filepath.Join(home, ".gemini", "antigravity", "brain", cascadeB, ".user_uploaded")
	entries, errDir := os.ReadDir(targetDir)
	if errDir != nil {
		t.Fatalf(".user_uploaded/ de cascade B non trouvé: %v", errDir)
	}
	found := false
	for _, e := range entries {
		if strings.Contains(e.Name(), "diagram") {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("diagram.png non trouvé dans cascade B .user_uploaded/, fichiers: %v", entries)
	}
}

// TestWorkflow_MultiImageCrossCascade vérifie que plusieurs images
// provenant de cascades différentes sont toutes copiées dans la cible.
func TestWorkflow_MultiImageCrossCascade(t *testing.T) {
	cascadeSrc := "cascade-multi-src-" + testUUID()[:8]
	cascadeTarget := "cascade-multi-tgt-" + testUUID()[:8]
	home, _ := os.UserHomeDir()
	defer os.RemoveAll(filepath.Join(home, ".gemini", "antigravity", "brain", cascadeSrc))
	defer os.RemoveAll(filepath.Join(home, ".gemini", "antigravity", "brain", cascadeTarget))

	// Créer 3 images dans la cascade source
	var media []connectrpc.MediaAttachment
	for i := 0; i < 3; i++ {
		name := fmt.Sprintf("img_%d.png", i)
		data := []byte(fmt.Sprintf("image content %d", i))
		b64 := base64.StdEncoding.EncodeToString(data)
		p, _, err := saveUploadedImage(cascadeSrc, name, b64)
		if err != nil {
			t.Fatalf("saveUploadedImage %s failed: %v", name, err)
		}
		media = append(media, connectrpc.MediaAttachment{
			URI:         "file:///" + filepath.ToSlash(p),
			MimeType:    "image/png",
			Description: name,
		})
	}

	backend := &mediaCapturingRPCClient{}
	srv := newTestServer(backend)
	defer srv.Close()

	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	client.sendJSON(t, IncomingMessage{
		Type:      "send_prompt",
		RequestID: "req-multi-1",
		CascadeID: cascadeTarget,
		Prompt:    "compare ces trois images",
		Media:     media,
	})
	_ = client.recv(t) // stream_start
	_ = client.recv(t) // stream_delta
	_ = client.recv(t) // stream_end

	// Les 3 images doivent exister dans la cascade cible
	targetDir := filepath.Join(home, ".gemini", "antigravity", "brain", cascadeTarget, ".user_uploaded")
	entries, err := os.ReadDir(targetDir)
	if err != nil {
		t.Fatalf(".user_uploaded/ de cascade target non trouvé: %v", err)
	}
	if len(entries) < 3 {
		names := make([]string, len(entries))
		for i, e := range entries {
			names[i] = e.Name()
		}
		t.Fatalf("attendu au moins 3 images dans cascade target, trouvé %d: %v", len(entries), names)
	}
}

// TestWorkflow_ImageAlreadyInCorrectCascade vérifie que si l'image
// est déjà dans le bon dossier .user_uploaded/ de la cascade cible,
// aucune copie inutile n'est effectuée (pas de fichier dupliqué).
func TestWorkflow_ImageAlreadyInCorrectCascade(t *testing.T) {
	cascade := "cascade-same-" + testUUID()[:8]
	home, _ := os.UserHomeDir()
	defer os.RemoveAll(filepath.Join(home, ".gemini", "antigravity", "brain", cascade))

	// Upload directement dans la bonne cascade
	data := []byte("already in correct place")
	b64 := base64.StdEncoding.EncodeToString(data)
	imgPath, _, err := saveUploadedImage(cascade, "correct.png", b64)
	if err != nil {
		t.Fatalf("saveUploadedImage failed: %v", err)
	}
	imgURI := "file:///" + filepath.ToSlash(imgPath)

	backend := &mediaCapturingRPCClient{}
	srv := newTestServer(backend)
	defer srv.Close()

	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	client.sendJSON(t, IncomingMessage{
		Type:      "send_prompt",
		RequestID: "req-same-1",
		CascadeID: cascade,
		Prompt:    "cette image est locale",
		Media: []connectrpc.MediaAttachment{
			{URI: imgURI, MimeType: "image/png", Description: "correct.png"},
		},
	})
	_ = client.recv(t) // stream_start
	_ = client.recv(t) // stream_delta
	_ = client.recv(t) // stream_end

	// Compter les fichiers : il ne doit y avoir qu'un seul exemplaire
	uploadDir := filepath.Join(home, ".gemini", "antigravity", "brain", cascade, ".user_uploaded")
	entries, _ := os.ReadDir(uploadDir)
	pngCount := 0
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".png") {
			pngCount++
		}
	}
	if pngCount != 1 {
		t.Errorf("attendu exactement 1 fichier PNG (pas de doublon), trouvé %d", pngCount)
	}
}

// TestWorkflow_MobileFullRoundTrip simule le flux mobile complet :
// 1. upload_media via WebSocket RPC (comme le fait ChatInputBar)
// 2. send_prompt avec markdown ![name](file:///...) dans le texte
// 3. Vérifier : prompt nettoyé + image dans .user_uploaded/ de la cible
func TestWorkflow_MobileFullRoundTrip(t *testing.T) {
	backend := &mediaCapturingRPCClient{}
	srv := newTestServer(backend)
	defer srv.Close()

	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	home, _ := os.UserHomeDir()
	cascade := "cascade-mobile-" + testUUID()[:8]
	defer os.RemoveAll(filepath.Join(home, ".gemini", "antigravity", "brain", cascade))

	// Étape 1 : upload_media (simule le mobile qui appelle api.uploadMedia)
	imgContent := []byte("mobile camera photo")
	imgB64 := base64.StdEncoding.EncodeToString(imgContent)
	client.sendJSON(t, IncomingMessage{
		Type:       "upload_media",
		RequestID:  "req-upload-1",
		CascadeID:  cascade,
		Base64Data: imgB64,
		FileName:   "photo_camera.png",
	})
	uploadResp := client.recv(t)
	if uploadResp["error"] != nil {
		t.Fatalf("upload_media failed: %v", uploadResp["error"])
	}
	data, _ := uploadResp["data"].(map[string]interface{})
	filePath, _ := data["filePath"].(string)
	if filePath == "" {
		t.Fatal("upload_media did not return filePath")
	}

	// Étape 2 : send_prompt avec le tag markdown (comme le mobile le fait)
	fileURI := filepath.ToSlash(filePath)
	if !strings.HasPrefix(fileURI, "file:///") {
		if strings.HasPrefix(fileURI, "/") {
			fileURI = "file://" + fileURI
		} else {
			fileURI = "file:///" + fileURI
		}
	}
	promptWithMarkdown := fmt.Sprintf("![photo_camera.png](%s)\n\nqu'est-ce que tu vois sur cette photo", fileURI)

	client.sendJSON(t, IncomingMessage{
		Type:      "send_prompt",
		RequestID: "req-mobile-1",
		CascadeID: cascade,
		Prompt:    promptWithMarkdown,
	})
	_ = client.recv(t) // stream_start
	_ = client.recv(t) // stream_delta
	_ = client.recv(t) // stream_end

	// Vérification 1 : le prompt est nettoyé (pas de markdown brut)
	if strings.Contains(backend.lastPrompt, "![") {
		t.Errorf("prompt should be cleaned of markdown image tags, got %q", backend.lastPrompt)
	}
	if !strings.Contains(backend.lastPrompt, "qu'est-ce que tu vois sur cette photo") {
		t.Errorf("user text missing from prompt, got %q", backend.lastPrompt)
	}

	// Vérification 2 : l'image existe dans .user_uploaded/ de la cascade
	uploadDir := filepath.Join(home, ".gemini", "antigravity", "brain", cascade, ".user_uploaded")
	entries, errDir := os.ReadDir(uploadDir)
	if errDir != nil {
		t.Fatalf(".user_uploaded/ not found: %v", errDir)
	}
	found := false
	for _, e := range entries {
		if strings.Contains(e.Name(), "photo_camera") {
			found = true
			// Vérifier le contenu
			content, _ := os.ReadFile(filepath.Join(uploadDir, e.Name()))
			if len(content) == 0 {
				t.Error("image file is empty")
			}
			break
		}
	}
	if !found {
		names := make([]string, len(entries))
		for i, e := range entries {
			names[i] = e.Name()
		}
		t.Errorf("photo_camera.png not found in .user_uploaded/, files: %v", names)
	}
}
