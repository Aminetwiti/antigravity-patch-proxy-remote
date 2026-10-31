package gateway

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestResolveArtifactOnDisk_P1_ExactRegex(t *testing.T) {
	homeDir, _ := os.UserHomeDir()
	convoID := "test-convo-p1"
	dir := filepath.Join(homeDir, ".gemini", "antigravity", "brain", convoID)
	_ = os.MkdirAll(dir, 0755)
	defer os.RemoveAll(filepath.Join(homeDir, ".gemini", "antigravity", "brain", convoID))

	testFile := filepath.Join(dir, "my_implementation_plan.md")
	_ = os.WriteFile(testFile, []byte("# Plan"), 0644)

	res := ResolveArtifactOnDisk(convoID, "Check file my_implementation_plan.md please")
	if !res.Exists {
		t.Fatalf("attendu fichier trouvé via regex, mais exists=false")
	}
	if filepath.Base(res.ResolvedPath) != "my_implementation_plan.md" {
		t.Errorf("attendu my_implementation_plan.md, obtenu %s", filepath.Base(res.ResolvedPath))
	}
}

func TestResolveArtifactOnDisk_P2_AlphaNumNormalize(t *testing.T) {
	homeDir, _ := os.UserHomeDir()
	convoID := "test-convo-p2"
	dir := filepath.Join(homeDir, ".gemini", "antigravity", "brain", convoID)
	_ = os.MkdirAll(dir, 0755)
	defer os.RemoveAll(filepath.Join(homeDir, ".gemini", "antigravity", "brain", convoID))

	testFile := filepath.Join(dir, "architecture_v2.png")
	_ = os.WriteFile(testFile, []byte("fake png"), 0644)

	res := ResolveArtifactOnDisk(convoID, "Architecture - V2")
	if !res.Exists {
		t.Fatalf("attendu fichier trouvé via normalisation alphanumérique")
	}
	if !res.IsImage {
		t.Errorf("attendu IsImage=true pour architecture_v2.png")
	}
}

func TestResolveLatestUploadedMedia(t *testing.T) {
	homeDir, _ := os.UserHomeDir()
	convoID := "test-convo-media"
	mediaDir := filepath.Join(homeDir, ".gemini", "antigravity", "brain", convoID, ".user_uploaded")
	_ = os.MkdirAll(mediaDir, 0755)
	defer os.RemoveAll(filepath.Join(homeDir, ".gemini", "antigravity", "brain", convoID))

	f1 := filepath.Join(mediaDir, "media_old.jpg")
	_ = os.WriteFile(f1, []byte("old"), 0644)
	time.Sleep(20 * time.Millisecond)

	f2 := filepath.Join(mediaDir, "media_new.png")
	_ = os.WriteFile(f2, []byte("new"), 0644)

	res := ResolveLatestUploadedMedia(convoID)
	if !res.Exists {
		t.Fatalf("attendu média uploadé trouvé, obtenu exists=false")
	}
	if filepath.Base(res.ResolvedPath) != "media_new.png" {
		t.Errorf("attendu media_new.png (plus récent), obtenu %s", filepath.Base(res.ResolvedPath))
	}
}
