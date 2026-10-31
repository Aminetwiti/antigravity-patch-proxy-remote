package workspace

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestFormatAuthenticatedURL(t *testing.T) {
	tests := []struct {
		name     string
		rawURL   string
		token    string
		expected string
	}{
		{
			name:     "No token",
			rawURL:   "https://github.com/myorg/myrepo.git",
			token:    "",
			expected: "https://github.com/myorg/myrepo.git",
		},
		{
			name:     "HTTPS URL with token",
			rawURL:   "https://github.com/myorg/myrepo.git",
			token:    "ghp_secrettoken123",
			expected: "https://x-access-token:ghp_secrettoken123@github.com/myorg/myrepo.git",
		},
		{
			name:     "SSH URL with token ignored",
			rawURL:   "git@github.com:myorg/myrepo.git",
			token:    "ghp_secrettoken123",
			expected: "git@github.com:myorg/myrepo.git",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := FormatAuthenticatedURL(tt.rawURL, tt.token)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tt.expected {
				t.Errorf("got %q, want %q", got, tt.expected)
			}
		})
	}
}

func TestCloneLocalBareRepository(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "git_clone_test_*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	bareDir := filepath.Join(tempDir, "bare.git")
	targetDir := filepath.Join(tempDir, "cloned_repo")

	// 1. Create a bare local repository for testing
	if out, err := exec.Command("git", "init", "--bare", bareDir).CombinedOutput(); err != nil {
		t.Fatalf("failed to init bare repo: %s (%v)", string(out), err)
	}

	// Create initial commit in a temp repo to push to bare
	srcDir := filepath.Join(tempDir, "src")
	_ = os.MkdirAll(srcDir, 0755)
	_ = exec.Command("git", "init", srcDir).Run()
	_ = exec.Command("git", "-C", srcDir, "config", "user.email", "test@test.com").Run()
	_ = exec.Command("git", "-C", srcDir, "config", "user.name", "Test").Run()
	_ = os.WriteFile(filepath.Join(srcDir, "README.md"), []byte("# Test Repo"), 0644)
	_ = exec.Command("git", "-C", srcDir, "add", ".").Run()
	_ = exec.Command("git", "-C", srcDir, "commit", "-m", "Initial commit").Run()
	_ = exec.Command("git", "-C", srcDir, "push", bareDir, "HEAD:main").Run()

	mgr := NewManager()
	ctx := context.Background()

	opts := GitCloneOptions{
		RepoURL:     bareDir,
		Branch:      "main",
		TargetDir:   targetDir,
		WorkspaceID: "test-workspace-clone",
		Depth:       1,
	}

	res, err := mgr.Clone(ctx, opts)
	if err != nil {
		t.Fatalf("Clone failed: %v", err)
	}

	if !res.Success {
		t.Fatalf("expected success, got message: %s", res.Message)
	}
	if res.WorkspaceID != "test-workspace-clone" {
		t.Errorf("got workspace ID %s, want test-workspace-clone", res.WorkspaceID)
	}

	// Verify workspace registration and file read
	ws, err := mgr.GetWorkspace("test-workspace-clone")
	if err != nil {
		t.Fatalf("failed to get workspace: %v", err)
	}
	if ws.Root != targetDir {
		t.Errorf("got root %s, want %s", ws.Root, targetDir)
	}

	content, err := mgr.ReadFile("test-workspace-clone", "README.md")
	if err != nil {
		t.Fatalf("failed to read README.md: %v", err)
	}
	if string(content) != "# Test Repo" {
		t.Errorf("got content %q, want '# Test Repo'", string(content))
	}
}
