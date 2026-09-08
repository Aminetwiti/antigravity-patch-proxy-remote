package workspace

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func setupGitRepo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()

	runCmd := func(args ...string) {
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v failed: %s (%v)", args, string(out), err)
		}
	}

	runCmd("init")
	runCmd("config", "user.email", "test@example.com")
	runCmd("config", "user.name", "Test User")

	readme := filepath.Join(dir, "README.md")
	if err := os.WriteFile(readme, []byte("# Test Repo\n"), 0644); err != nil {
		t.Fatalf("failed to write README: %v", err)
	}

	runCmd("add", "README.md")
	runCmd("commit", "-m", "Initial commit")

	return dir
}

func TestWorkspaceManager_GitWorktreesAndBranches(t *testing.T) {
	// Skip if git is not available
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git executable not found, skipping worktree test")
	}

	repoDir := setupGitRepo(t)
	mgr := NewManager()

	ws, err := mgr.RegisterWorkspace("test_repo", "Test Repository", repoDir)
	if err != nil {
		t.Fatalf("failed to register workspace: %v", err)
	}

	// Test CurrentBranch
	branch, err := mgr.CurrentBranch(ws.ID)
	if err != nil {
		t.Fatalf("CurrentBranch failed: %v", err)
	}
	if branch != "master" && branch != "main" {
		t.Errorf("expected branch master or main, got %s", branch)
	}

	// Test ListBranches
	branches, err := mgr.ListBranches(ws.ID)
	if err != nil {
		t.Fatalf("ListBranches failed: %v", err)
	}
	if len(branches) == 0 {
		t.Fatalf("expected at least 1 branch, got 0")
	}

	// Test CreateWorktree
	wtBranch := "feat/session-test"
	wtWsID := "test_repo_wt"
	wtWs, err := mgr.CreateWorktree(ws.ID, wtBranch, wtWsID)
	if err != nil {
		t.Fatalf("CreateWorktree failed: %v", err)
	}

	if wtWs.ID != wtWsID {
		t.Errorf("expected worktree ID %s, got %s", wtWsID, wtWs.ID)
	}

	// Verify worktree has the README
	content, err := mgr.ReadFile(wtWs.ID, "README.md")
	if err != nil {
		t.Fatalf("ReadFile from worktree failed: %v", err)
	}
	if !strings.Contains(string(content), "Test Repo") {
		t.Errorf("unexpected content: %s", string(content))
	}

	// Verify worktree is listed
	found := false
	for _, w := range mgr.ListWorkspaces() {
		if w.ID == wtWsID {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("worktree not found in ListWorkspaces")
	}

	// Test RemoveWorktree
	if err := mgr.RemoveWorktree(wtWsID); err != nil {
		t.Fatalf("RemoveWorktree failed: %v", err)
	}

	// Verify removed
	if _, err := mgr.GetWorkspace(wtWsID); err != ErrWorkspaceNotFound {
		t.Errorf("expected ErrWorkspaceNotFound, got %v", err)
	}
}
