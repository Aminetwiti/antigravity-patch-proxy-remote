package workspace

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestAutonomousLifecycle_ParseGitHubOwnerRepo(t *testing.T) {
	cases := []struct {
		url       string
		wantOwner string
		wantRepo  string
	}{
		{
			url:       "https://github.com/Aminetwiti/antigravity-add-model-main.git",
			wantOwner: "Aminetwiti",
			wantRepo:  "antigravity-add-model-main",
		},
		{
			url:       "git@github.com:Aminetwiti/antigravity-patch-proxy-remote.git",
			wantOwner: "Aminetwiti",
			wantRepo:  "antigravity-patch-proxy-remote",
		},
		{
			url:       "https://github.com/torvalds/linux",
			wantOwner: "torvalds",
			wantRepo:  "linux",
		},
		{
			url:       "invalid-url",
			wantOwner: "",
			wantRepo:  "",
		},
	}

	for _, c := range cases {
		owner, repo := parseGitHubOwnerRepo(c.url)
		if owner != c.wantOwner || repo != c.wantRepo {
			t.Errorf("parseGitHubOwnerRepo(%q) = (%q, %q); want (%q, %q)", c.url, owner, repo, c.wantOwner, c.wantRepo)
		}
	}
}

func TestAutonomousLifecycle_VerifyProject_Go(t *testing.T) {
	mgr := NewManager()
	tmpDir := t.TempDir()

	// Write minimal go.mod and a passing test
	goMod := "module example.com/testmod\n\ngo 1.25\n"
	if err := os.WriteFile(filepath.Join(tmpDir, "go.mod"), []byte(goMod), 0644); err != nil {
		t.Fatalf("failed to write go.mod: %v", err)
	}
	testCode := "package testmod\n\nimport \"testing\"\n\nfunc TestPass(t *testing.T) {}\n"
	if err := os.WriteFile(filepath.Join(tmpDir, "pass_test.go"), []byte(testCode), 0644); err != nil {
		t.Fatalf("failed to write test: %v", err)
	}

	ws, err := mgr.RegisterWorkspace("test_mod", "Test Module", tmpDir)
	if err != nil {
		t.Fatalf("RegisterWorkspace failed: %v", err)
	}

	res, err := mgr.VerifyProject(ws.ID, 30*time.Second)
	if err != nil {
		t.Fatalf("VerifyProject failed: %v", err)
	}

	if res.ProjectType != "go" {
		t.Errorf("expected ProjectType 'go', got %q", res.ProjectType)
	}
	if !res.Passed {
		t.Errorf("expected VerifyProject to pass, output: %s, error: %s", res.Output, res.Error)
	}
}

func TestAutonomousLifecycle_VerifyProject_Unknown(t *testing.T) {
	mgr := NewManager()
	tmpDir := t.TempDir()

	ws, err := mgr.RegisterWorkspace("empty_ws", "Empty WS", tmpDir)
	if err != nil {
		t.Fatalf("RegisterWorkspace failed: %v", err)
	}

	res, err := mgr.VerifyProject(ws.ID, 5*time.Second)
	if err != nil {
		t.Fatalf("VerifyProject failed: %v", err)
	}

	if res.ProjectType != "unknown" {
		t.Errorf("expected ProjectType 'unknown', got %q", res.ProjectType)
	}
	if !res.Passed {
		t.Errorf("expected VerifyProject to pass on unrecognized runner")
	}
}

func TestAutonomousLifecycle_PruneStaleWorktrees(t *testing.T) {
	mgr := NewManager()
	tmpDir := t.TempDir()

	ws, err := mgr.RegisterWorkspace("base", "Base", tmpDir)
	if err != nil {
		t.Fatalf("RegisterWorkspace failed: %v", err)
	}

	// Create mock stale worktree folder
	wtDir := filepath.Join(ws.Root, ".antigravity", "worktrees", "shadow_old_sess")
	if err := os.MkdirAll(wtDir, 0755); err != nil {
		t.Fatalf("MkdirAll failed: %v", err)
	}

	// Artificially age the directory
	oldTime := time.Now().Add(-48 * time.Hour)
	_ = os.Chtimes(wtDir, oldTime, oldTime)

	// Create mock fresh worktree folder
	freshDir := filepath.Join(ws.Root, ".antigravity", "worktrees", "shadow_fresh_sess")
	if err := os.MkdirAll(freshDir, 0755); err != nil {
		t.Fatalf("MkdirAll failed: %v", err)
	}

	pruneRes, err := mgr.PruneStaleWorktrees(24 * time.Hour)
	if err != nil {
		t.Fatalf("PruneStaleWorktrees failed: %v", err)
	}

	if pruneRes.PrunedCount < 1 {
		t.Errorf("expected at least 1 pruned worktree, got %d", pruneRes.PrunedCount)
	}

	// Verify old dir was removed
	if _, err := os.Stat(wtDir); !os.IsNotExist(err) {
		t.Errorf("expected old worktree to be removed, but it still exists")
	}

	// Verify fresh dir remains
	if _, err := os.Stat(freshDir); os.IsNotExist(err) {
		t.Errorf("expected fresh worktree to remain, but it was deleted")
	}
}

func TestAutonomousLifecycle_CloneWorkspace_Validation(t *testing.T) {
	mgr := NewManager()

	// Empty URL should fail
	if _, err := mgr.CloneWorkspace("", "", "test"); err == nil {
		t.Errorf("expected error on empty repoURL")
	}

	// If directory exists, should register cleanly
	tmpDir := t.TempDir()
	gitDir := filepath.Join(tmpDir, ".git")
	_ = os.MkdirAll(gitDir, 0755)

	_, err := mgr.RegisterWorkspace("default", "Default", filepath.Dir(tmpDir))
	if err != nil {
		t.Fatalf("failed to register default: %v", err)
	}

	ws, err := mgr.CloneWorkspace("https://github.com/example/repo.git", "", filepath.Base(tmpDir))
	if err != nil {
		t.Fatalf("CloneWorkspace on existing directory failed: %v", err)
	}
	if ws == nil || ws.Root != tmpDir {
		t.Errorf("expected registered ws root %q, got %+v", tmpDir, ws)
	}
}

func TestAutonomousLifecycle_CreatePullRequest(t *testing.T) {
	mgr := NewManager()
	tmpDir := t.TempDir()

	// Initialize git repo
	exec.Command("git", "-C", tmpDir, "init", "-b", "main").Run()
	exec.Command("git", "-C", tmpDir, "config", "user.name", "Test Agent").Run()
	exec.Command("git", "-C", tmpDir, "config", "user.email", "agent@test.local").Run()
	exec.Command("git", "-C", tmpDir, "remote", "add", "origin", "https://github.com/Aminetwiti/test-repo.git").Run()

	testFile := filepath.Join(tmpDir, "README.md")
	os.WriteFile(testFile, []byte("# Test Repo\n"), 0644)
	exec.Command("git", "-C", tmpDir, "add", "-A").Run()
	exec.Command("git", "-C", tmpDir, "commit", "-m", "initial commit").Run()

	ws, err := mgr.RegisterWorkspace("test_pr_ws", "Test PR WS", tmpDir)
	if err != nil {
		t.Fatalf("RegisterWorkspace failed: %v", err)
	}

	res, err := mgr.CreatePullRequest(ws.ID, "sess-pr-123", "Feature Title", "Feature Description")
	if err != nil {
		t.Fatalf("CreatePullRequest failed: %v", err)
	}

	if res.Branch != "agent/shadow_sess_pr_123" {
		t.Errorf("expected branch 'agent/shadow_sess_pr_123', got %q", res.Branch)
	}
	if res.URL == "" {
		t.Errorf("expected non-empty comparison or PR URL")
	}
}

