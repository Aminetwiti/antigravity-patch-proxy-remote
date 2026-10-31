package gateway

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestCleanExpiredScratchFiles(t *testing.T) {
	tmpHome, err := os.MkdirTemp("", "ag_test_home_*")
	if err != nil {
		t.Fatalf("failed to create tmp dir: %v", err)
	}
	defer os.RemoveAll(tmpHome)

	// Mock UserHomeDir (HOME on Unix/macOS, USERPROFILE on Windows)
	origHome := os.Getenv("HOME")
	origUserProfile := os.Getenv("USERPROFILE")
	os.Setenv("HOME", tmpHome)
	os.Setenv("USERPROFILE", tmpHome)
	defer func() {
		os.Setenv("HOME", origHome)
		os.Setenv("USERPROFILE", origUserProfile)
	}()

	cascadeID := "11111111-2222-3333-4444-555555555555"
	scratchDir := filepath.Join(tmpHome, ".gemini", "antigravity", "brain", cascadeID, "scratch")
	if err := os.MkdirAll(scratchDir, 0755); err != nil {
		t.Fatalf("failed to create scratch dir: %v", err)
	}

	// Créer un vieux fichier upload (> 10 jours)
	oldFile := filepath.Join(scratchDir, "upload_old.png")
	if err := os.WriteFile(oldFile, []byte("old_data"), 0644); err != nil {
		t.Fatalf("failed to write old file: %v", err)
	}
	tenDaysAgo := time.Now().Add(-10 * 24 * time.Hour)
	_ = os.Chtimes(oldFile, tenDaysAgo, tenDaysAgo)

	// Créer un fichier upload récent (< 1 jour)
	recentFile := filepath.Join(scratchDir, "upload_recent.png")
	if err := os.WriteFile(recentFile, []byte("recent_data"), 0644); err != nil {
		t.Fatalf("failed to write recent file: %v", err)
	}

	// Créer un fichier utilisateur sans préfixe upload_
	userFile := filepath.Join(scratchDir, "notes.txt")
	if err := os.WriteFile(userFile, []byte("keep_me"), 0644); err != nil {
		t.Fatalf("failed to write user file: %v", err)
	}
	_ = os.Chtimes(userFile, tenDaysAgo, tenDaysAgo)

	// Exécuter le nettoyage avec maxAge de 7 jours
	deleted, err := CleanExpiredScratchFiles(cascadeID, 7*24*time.Hour)
	if err != nil {
		t.Fatalf("CleanExpiredScratchFiles failed: %v", err)
	}

	if deleted != 1 {
		t.Errorf("expected 1 file deleted, got %d", deleted)
	}

	if _, err := os.Stat(oldFile); !os.IsNotExist(err) {
		t.Errorf("oldFile should have been deleted")
	}

	if _, err := os.Stat(recentFile); err != nil {
		t.Errorf("recentFile should not have been deleted: %v", err)
	}

	if _, err := os.Stat(userFile); err != nil {
		t.Errorf("userFile without upload_ prefix should not have been deleted: %v", err)
	}
}
