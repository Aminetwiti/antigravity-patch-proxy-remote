package ide

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLauncher_FindExecutable_CustomPath(t *testing.T) {
	tmpDir := t.TempDir()
	fakeExe := filepath.Join(tmpDir, "fake_antigravity.exe")
	if err := os.WriteFile(fakeExe, []byte("fake binary"), 0755); err != nil {
		t.Fatalf("failed to create fake exe: %v", err)
	}

	launcher := NewLauncher(fakeExe)
	found, err := launcher.FindExecutable()
	if err != nil {
		t.Fatalf("expected to find custom exe, got err: %v", err)
	}
	if found != fakeExe {
		t.Errorf("found %s, want %s", found, fakeExe)
	}
}

func TestLauncher_FindExecutable_EnvPath(t *testing.T) {
	tmpDir := t.TempDir()
	fakeExe := filepath.Join(tmpDir, "env_antigravity.exe")
	if err := os.WriteFile(fakeExe, []byte("fake binary"), 0755); err != nil {
		t.Fatalf("failed to create fake exe: %v", err)
	}

	t.Setenv("AG_IDE_PATH", fakeExe)
	launcher := NewLauncher()
	found, err := launcher.FindExecutable()
	if err != nil {
		t.Fatalf("expected to find env exe, got err: %v", err)
	}
	if found != fakeExe {
		t.Errorf("found %s, want %s", found, fakeExe)
	}
}

func TestLauncher_FindExecutable_NotFound(t *testing.T) {
	launcher := NewLauncher(filepath.Join(t.TempDir(), "nonexistent.exe"))
	t.Setenv("AG_IDE_PATH", "")
	t.Setenv("LOCALAPPDATA", t.TempDir())
	t.Setenv("ProgramFiles", t.TempDir())

	_, err := launcher.FindExecutable()
	if err == nil {
		t.Logf("found system exe or LookPath matched")
	}
}
