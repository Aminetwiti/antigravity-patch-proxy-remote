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

func TestWorkspaceManager_PullAndPush(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git executable not found, skipping sync test")
	}

	tmpDir := t.TempDir()
	bareDir := filepath.Join(tmpDir, "bare.git")
	repo1Dir := filepath.Join(tmpDir, "repo1")
	repo2Dir := filepath.Join(tmpDir, "repo2")

	// 1. Init bare repo
	cmd := exec.Command("git", "init", "--bare", bareDir)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git init bare failed: %s (%v)", string(out), err)
	}

	// 2. Clone repo1
	cmd = exec.Command("git", "clone", bareDir, repo1Dir)
	_ = cmd.Run()

	// Configure repo1 and initial commit
	runIn := func(dir string, args ...string) {
		c := exec.Command("git", args...)
		c.Dir = dir
		if out, err := c.CombinedOutput(); err != nil {
			t.Fatalf("git %v in %s failed: %s (%v)", args, dir, string(out), err)
		}
	}
	runIn(repo1Dir, "config", "user.email", "dev@example.com")
	runIn(repo1Dir, "config", "user.name", "Dev Sync")
	runIn(repo1Dir, "branch", "-M", "main")

	_ = os.WriteFile(filepath.Join(repo1Dir, "initial.txt"), []byte("seed"), 0644)
	runIn(repo1Dir, "add", "initial.txt")
	runIn(repo1Dir, "commit", "-m", "Seed commit")
	runIn(repo1Dir, "push", "origin", "HEAD:main")

	// 3. Clone repo2 from bare
	cmd = exec.Command("git", "clone", "-b", "main", bareDir, repo2Dir)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("clone repo2 failed: %s (%v)", string(out), err)
	}
	runIn(repo2Dir, "config", "user.email", "dev2@example.com")
	runIn(repo2Dir, "config", "user.name", "Dev2 Sync")

	mgr := NewManager()
	ws1, err := mgr.RegisterWorkspace("ws1", "Repo 1", repo1Dir)
	if err != nil {
		t.Fatalf("register ws1 failed: %v", err)
	}
	ws2, err := mgr.RegisterWorkspace("ws2", "Repo 2", repo2Dir)
	if err != nil {
		t.Fatalf("register ws2 failed: %v", err)
	}

	// 4. In repo1: write new file and commit
	if err := mgr.WriteFile(ws1.ID, "feature.txt", []byte("sync content 123")); err != nil {
		t.Fatalf("WriteFile failed: %v", err)
	}
	if _, err := mgr.Commit(ws1.ID, "Add feature file", "Dev <dev@example.com>"); err != nil {
		t.Fatalf("Commit failed: %v", err)
	}

	// 5. Push from ws1
	pushRes, err := mgr.Push(ws1.ID, "origin", "main")
	if err != nil {
		t.Fatalf("Push failed: %v", err)
	}
	if !pushRes.Success {
		t.Errorf("expected push success")
	}

	// 6. Pull in ws2
	pullRes, err := mgr.Pull(ws2.ID, "origin", "main")
	if err != nil {
		t.Fatalf("Pull failed: %v", err)
	}
	if !pullRes.Success {
		t.Errorf("expected pull success")
	}

	// 7. Verify ws2 now contains feature.txt with expected content
	content, err := mgr.ReadFile(ws2.ID, "feature.txt")
	if err != nil {
		t.Fatalf("expected feature.txt to exist in ws2 after pull: %v", err)
	}
	if string(content) != "sync content 123" {
		t.Errorf("expected content 'sync content 123', got %q", string(content))
	}
}

func TestWorkspaceManager_CreateShadowWorktree(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git executable not found, skipping shadow worktree test")
	}

	repoDir := setupGitRepo(t)
	mgr := NewManager()

	ws, err := mgr.RegisterWorkspace("main_repo", "Main Repo", repoDir)
	if err != nil {
		t.Fatalf("failed to register workspace: %v", err)
	}

	sessionID := "sess-abc-123"
	shadowWs, cleanup, err := mgr.CreateShadowWorktree(ws.ID, sessionID)
	if err != nil {
		t.Fatalf("CreateShadowWorktree failed: %v", err)
	}
	defer cleanup()

	if !strings.Contains(shadowWs.ID, "shadow_") {
		t.Errorf("expected shadowWs.ID to contain 'shadow_', got %s", shadowWs.ID)
	}

	// Verify shadow worktree has README.md
	content, err := mgr.ReadFile(shadowWs.ID, "README.md")
	if err != nil {
		t.Fatalf("failed to read README.md from shadow worktree: %v", err)
	}
	if !strings.Contains(string(content), "Test Repo") {
		t.Errorf("unexpected content in shadow worktree: %s", string(content))
	}

	// Modify file in shadow worktree
	if err := mgr.WriteFile(shadowWs.ID, "isolated.txt", []byte("only in shadow")); err != nil {
		t.Fatalf("failed to write file in shadow worktree: %v", err)
	}

	// Verify main workspace does NOT have isolated.txt (true isolation)
	if _, err := mgr.ReadFile(ws.ID, "isolated.txt"); err == nil {
		t.Errorf("expected isolated.txt to NOT exist in main workspace, but it was found")
	}
}

func TestWorkspaceManager_PromoteShadowWorktree(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git executable not found, skipping promote shadow worktree test")
	}

	repoDir := setupGitRepo(t)
	mgr := NewManager()

	ws, err := mgr.RegisterWorkspace("main_repo", "Main Repo", repoDir)
	if err != nil {
		t.Fatalf("failed to register workspace: %v", err)
	}

	sessionID := "sess-promote-123"
	shadowWs, _, err := mgr.CreateShadowWorktree(ws.ID, sessionID)
	if err != nil {
		t.Fatalf("CreateShadowWorktree failed: %v", err)
	}

	// In shadow worktree, add a new feature file
	if err := mgr.WriteFile(shadowWs.ID, "feature.go", []byte("package main\n\nfunc Feature() {}\n")); err != nil {
		t.Fatalf("failed to write feature.go: %v", err)
	}

	// Promote shadow worktree back to main workspace
	res, err := mgr.PromoteShadowWorktree(ws.ID, sessionID, "Add Feature from Agent", "Agent <agent@ai>")
	if err != nil {
		t.Fatalf("PromoteShadowWorktree failed: %v", err)
	}

	if !res.Success {
		t.Errorf("expected promote to succeed")
	}
	if res.CommitHash == "" {
		t.Errorf("expected valid commit hash")
	}

	// Verify feature.go is now present in main workspace
	mainContent, err := mgr.ReadFile(ws.ID, "feature.go")
	if err != nil {
		t.Fatalf("expected feature.go to exist in main workspace: %v", err)
	}
	if !strings.Contains(string(mainContent), "func Feature()") {
		t.Errorf("unexpected content in main workspace feature.go: %s", string(mainContent))
	}

	// Verify shadow worktree is unregistered and cleaned up
	if _, err := mgr.GetWorkspace(shadowWs.ID); err == nil {
		t.Errorf("expected shadow workspace to be unregistered")
	}
}

func TestWorkspaceManager_DiscardShadowWorktree(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git executable not found, skipping discard shadow worktree test")
	}

	repoDir := setupGitRepo(t)
	mgr := NewManager()

	ws, err := mgr.RegisterWorkspace("main_repo", "Main Repo", repoDir)
	if err != nil {
		t.Fatalf("failed to register workspace: %v", err)
	}

	sessionID := "sess-discard-456"
	shadowWs, _, err := mgr.CreateShadowWorktree(ws.ID, sessionID)
	if err != nil {
		t.Fatalf("CreateShadowWorktree failed: %v", err)
	}

	// In shadow worktree, write unwanted file
	if err := mgr.WriteFile(shadowWs.ID, "unwanted.tmp", []byte("trash")); err != nil {
		t.Fatalf("failed to write unwanted file: %v", err)
	}

	// Discard shadow worktree
	if err := mgr.DiscardShadowWorktree(ws.ID, sessionID); err != nil {
		t.Fatalf("DiscardShadowWorktree failed: %v", err)
	}

	// Verify main workspace does NOT have unwanted.tmp
	if _, err := mgr.ReadFile(ws.ID, "unwanted.tmp"); err == nil {
		t.Errorf("unwanted.tmp should not exist in main workspace")
	}

	// Verify shadow workspace is gone
	if _, err := mgr.GetWorkspace(shadowWs.ID); err == nil {
		t.Errorf("expected shadow workspace to be unregistered")
	}
}

func TestWorkspaceManager_DetectStaleBase(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git executable not found, skipping detect stale base test")
	}

	repoDir := setupGitRepo(t)
	mgr := NewManager()

	ws, err := mgr.RegisterWorkspace("main_repo", "Main Repo", repoDir)
	if err != nil {
		t.Fatalf("failed to register workspace: %v", err)
	}

	// 1. Initial commit SHA
	cmd := exec.Command("git", "rev-parse", "HEAD")
	cmd.Dir = repoDir
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("git rev-parse HEAD failed: %v", err)
	}
	initialSHA := strings.TrimSpace(string(out))

	// Not stale when compared to current HEAD
	stale, cur, err := mgr.DetectStaleBase(ws.ID, initialSHA)
	if err != nil {
		t.Fatalf("DetectStaleBase failed: %v", err)
	}
	if stale {
		t.Errorf("expected not stale, got stale=true (current: %s, base: %s)", cur, initialSHA)
	}

	// 2. Make a new commit
	if err := mgr.WriteFile(ws.ID, "feature.txt", []byte("new feature")); err != nil {
		t.Fatalf("WriteFile failed: %v", err)
	}
	commitRes, err := mgr.Commit(ws.ID, "Add feature", "Tester <test@example.com>")
	if err != nil {
		t.Fatalf("Commit failed: %v", err)
	}

	// Now initialSHA is stale compared to new HEAD
	staleAfter, curAfter, err := mgr.DetectStaleBase(ws.ID, initialSHA)
	if err != nil {
		t.Fatalf("DetectStaleBase failed after commit: %v", err)
	}
	if !staleAfter {
		t.Errorf("expected stale=true, got false (current: %s, base: %s)", curAfter, initialSHA)
	}
	if curAfter != commitRes.CommitHash {
		t.Errorf("expected current commit %s, got %s", commitRes.CommitHash, curAfter)
	}

	// 3. Test Push guarded by expectedBaseCommit
	_, pushErr := mgr.Push(ws.ID, "origin", "main", initialSHA)
	if pushErr == nil {
		t.Fatalf("expected Push to fail with stale base error, got nil")
	}
	if !strings.Contains(pushErr.Error(), "stale base detected") {
		t.Errorf("expected 'stale base detected' error, got: %v", pushErr)
	}
}
