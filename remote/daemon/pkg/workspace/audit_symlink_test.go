package workspace_test

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/antigravity/remote-daemon/pkg/workspace"
)

func TestAudit_SymlinkEscape_MustBeDenied(t *testing.T) {
	mgr := workspace.NewManager()
	tmpDir := t.TempDir()

	wsDirA := filepath.Join(tmpDir, "ws_a")
	wsDirB := filepath.Join(tmpDir, "ws_b")
	_ = os.MkdirAll(wsDirA, 0755)
	_ = os.MkdirAll(wsDirB, 0755)

	wsA, err := mgr.RegisterWorkspace("ws-a", "Workspace A", wsDirA)
	if err != nil {
		t.Fatalf("RegisterWorkspace ws-a failed: %v", err)
	}
	_, err = mgr.RegisterWorkspace("ws-b", "Workspace B", wsDirB)
	if err != nil {
		t.Fatalf("RegisterWorkspace ws-b failed: %v", err)
	}

	secretFileB := filepath.Join(wsDirB, "secret.key")
	_ = os.WriteFile(secretFileB, []byte("SUPER_SECRET_TENANT_B_KEY"), 0600)

	symlinkPath := filepath.Join(wsDirA, "leak_to_b")
	err = os.Symlink(wsDirB, symlinkPath)
	if err != nil {
		t.Skipf("symlink creation not supported in this environment: %v", err)
	}

	_, err = mgr.ReadFile(wsA.ID, "leak_to_b/secret.key")
	if err == nil {
		t.Fatalf("SECURITY VIOLATION: ReadFile through symlink succeeded! Agent escaped Workspace A into Workspace B!")
	}
	if !errors.Is(err, workspace.ErrPathOutsideRoot) && !strings.Contains(err.Error(), "access denied") {
		t.Fatalf("expected ErrPathOutsideRoot, got: %v", err)
	}

	err = mgr.WriteFile(wsA.ID, "leak_to_b/hacked.txt", []byte("MALICIOUS_OVERWRITE"))
	if err == nil {
		t.Fatalf("SECURITY VIOLATION: WriteFile through symlink succeeded! Agent mutated Workspace B!")
	}

	err = mgr.EditFile(wsA.ID, "leak_to_b/secret.key", "SUPER_SECRET", "MUTATED")
	if err == nil {
		t.Fatalf("SECURITY VIOLATION: EditFile through symlink succeeded! Agent modified Workspace B!")
	}
}
