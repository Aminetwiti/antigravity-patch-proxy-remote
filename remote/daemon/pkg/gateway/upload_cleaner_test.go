package gateway

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestCleanExpiredUploads(t *testing.T) {
	tmpDir := t.TempDir()
	uploadDir := filepath.Join(tmpDir, "casc_1", ".user_uploaded")
	if err := os.MkdirAll(uploadDir, 0755); err != nil {
		t.Fatalf("mkdir error: %v", err)
	}

	oldFile := filepath.Join(uploadDir, "old.png")
	newFile := filepath.Join(uploadDir, "new.png")
	_ = os.WriteFile(oldFile, []byte("old data"), 0600)
	_ = os.WriteFile(newFile, []byte("new data"), 0600)

	past := time.Now().Add(-10 * 24 * time.Hour)
	_ = os.Chtimes(oldFile, past, past)

	cutoff := time.Now().Add(-7 * 24 * time.Hour)
	deleted, err := CleanExpiredUploads(tmpDir, cutoff)
	if err != nil {
		t.Fatalf("clean error: %v", err)
	}
	if deleted != 1 {
		t.Fatalf("expected 1 file deleted, got %d", deleted)
	}

	if _, err := os.Stat(oldFile); !os.IsNotExist(err) {
		t.Fatalf("expected old file to be removed")
	}
	if _, err := os.Stat(newFile); err != nil {
		t.Fatalf("expected new file to remain")
	}
}
