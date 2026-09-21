package workspace_test

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/antigravity/remote-daemon/pkg/workspace"
)

func TestAutoDiscoverWorkspaces(t *testing.T) {
	mgr := workspace.NewManager()
	tmpDir := t.TempDir()

	// Create child git repo 1: /tmpDir/repo-alpha
	repo1Dir := filepath.Join(tmpDir, "repo-alpha")
	if err := os.MkdirAll(repo1Dir, 0755); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("git", "init")
	cmd.Dir = repo1Dir
	if err := cmd.Run(); err != nil {
		t.Skipf("git not available: %v", err)
	}

	// Create child git repo 2 under projects/: /tmpDir/projects/repo-beta
	repo2Dir := filepath.Join(tmpDir, "projects", "repo-beta")
	if err := os.MkdirAll(repo2Dir, 0755); err != nil {
		t.Fatal(err)
	}
	cmd = exec.Command("git", "init")
	cmd.Dir = repo2Dir
	_ = cmd.Run()

	// Create a non-git directory that should NOT be registered
	nonGitDir := filepath.Join(tmpDir, "some-random-folder")
	_ = os.MkdirAll(nonGitDir, 0755)

	discovered, err := mgr.AutoDiscoverWorkspaces(tmpDir)
	if err != nil {
		t.Fatalf("AutoDiscoverWorkspaces failed: %v", err)
	}

	if len(discovered) < 2 {
		t.Fatalf("expected at least 2 discovered git repos, got %d", len(discovered))
	}

	// Verify both repo-alpha and repo-beta are accessible via GetWorkspace
	ws1, err := mgr.GetWorkspace("repo-alpha")
	if err != nil {
		t.Errorf("repo-alpha was not registered: %v", err)
	} else if ws1.Root != repo1Dir {
		t.Errorf("expected root %s, got %s", repo1Dir, ws1.Root)
	}

	ws2, err := mgr.GetWorkspace("repo-beta")
	if err != nil {
		t.Errorf("repo-beta was not registered: %v", err)
	} else if ws2.Root != repo2Dir {
		t.Errorf("expected root %s, got %s", repo2Dir, ws2.Root)
	}

	// Non-git folder should not be registered as a workspace
	if _, err := mgr.GetWorkspace("some-random-folder"); err == nil {
		t.Errorf("expected non-git folder NOT to be registered as workspace")
	}

	// Arbitrary absolute directory must NOT be auto-registered as a workspace
	if _, err := mgr.GetWorkspace(nonGitDir); err == nil {
		t.Fatalf("SECURITY VIOLATION: arbitrary host directory %q was auto-registered as a workspace!", nonGitDir)
	}
}

func TestResolveAndValidatePath_ProtectsSystemDatabase(t *testing.T) {
	tmpDir := t.TempDir()

	// Simulate system database files in workspace root
	dbFile := filepath.Join(tmpDir, "runtime.db")
	_ = os.WriteFile(dbFile, []byte("sqlite data"), 0644)

	// Attempting to resolve runtime.db must be denied!
	_, err := workspace.ResolveAndValidatePath(tmpDir, "runtime.db")
	if err == nil {
		t.Fatalf("SECURITY VIOLATION: ResolveAndValidatePath allowed access to runtime.db!")
	}
	if !strings.Contains(err.Error(), "access denied") {
		t.Errorf("expected access denied error, got: %v", err)
	}

	// Attempting memory.db must also be denied!
	_, err = workspace.ResolveAndValidatePath(tmpDir, "memory.db")
	if err == nil {
		t.Fatalf("SECURITY VIOLATION: ResolveAndValidatePath allowed access to memory.db!")
	}

	// Regular files should still resolve fine
	regularFile := filepath.Join(tmpDir, "main.go")
	_ = os.WriteFile(regularFile, []byte("package main"), 0644)
	resolved, err := workspace.ResolveAndValidatePath(tmpDir, "main.go")
	if err != nil {
		t.Fatalf("failed to resolve regular file: %v", err)
	}
	if resolved != regularFile {
		t.Errorf("expected %s, got %s", regularFile, resolved)
	}
}

func TestEnsureSessionWorktree_NonGitFallbackIsolation(t *testing.T) {
	mgr := workspace.NewManager()
	tmpDir := t.TempDir()

	// Register plain non-git workspace
	ws, err := mgr.RegisterWorkspace("plain-ws", "Plain Workspace", tmpDir)
	if err != nil {
		t.Fatal(err)
	}

	// Session A requests worktree
	sessA, err := mgr.EnsureSessionWorktree(ws.ID, "sess-A")
	if err != nil {
		t.Fatal(err)
	}

	// Session B requests worktree
	sessB, err := mgr.EnsureSessionWorktree(ws.ID, "sess-B")
	if err != nil {
		t.Fatal(err)
	}

	// Session A and Session B MUST NOT share the raw root directory!
	if sessA.Root == tmpDir {
		t.Fatalf("ISOLATION FAULT: sessA root fell back directly to raw container directory!")
	}
	if sessB.Root == tmpDir {
		t.Fatalf("ISOLATION FAULT: sessB root fell back directly to raw container directory!")
	}
	if sessA.Root == sessB.Root {
		t.Fatalf("ISOLATION FAULT: sessA and sessB share the same directory: %s", sessA.Root)
	}
}
