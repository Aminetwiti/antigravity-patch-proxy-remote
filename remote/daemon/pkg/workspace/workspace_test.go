package workspace_test

import (
	"errors"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/antigravity/remote-daemon/pkg/workspace"
)

func TestWorkspaceManager_PathConfinement(t *testing.T) {
	mgr := workspace.NewManager()
	tmpDir := t.TempDir()

	ws, err := mgr.RegisterWorkspace("ws-test", "test-project", tmpDir)
	if err != nil {
		t.Fatalf("RegisterWorkspace failed: %v", err)
	}

	// 1. Valid subpath
	resolved, err := mgr.ResolvePath(ws.ID, "src/main.go")
	if err != nil {
		t.Fatalf("expected valid path resolution, got error: %v", err)
	}
	expected := filepath.Join(tmpDir, "src", "main.go")
	if resolved != expected {
		t.Fatalf("expected %s, got %s", expected, resolved)
	}

	// 2. Traversal rejection (..)
	_, err = mgr.ResolvePath(ws.ID, "../outside.txt")
	if !errors.Is(err, workspace.ErrPathOutsideRoot) {
		t.Fatalf("expected ErrPathOutsideRoot, got: %v", err)
	}

	// 3. Deep traversal rejection
	_, err = mgr.ResolvePath(ws.ID, "foo/bar/../../../../etc/passwd")
	if !errors.Is(err, workspace.ErrPathOutsideRoot) {
		t.Fatalf("expected ErrPathOutsideRoot for deep traversal, got: %v", err)
	}
}

func TestWorkspaceManager_FileReadWriteEdit(t *testing.T) {
	mgr := workspace.NewManager()
	tmpDir := t.TempDir()

	ws, err := mgr.RegisterWorkspace("ws-test", "test-project", tmpDir)
	if err != nil {
		t.Fatalf("RegisterWorkspace failed: %v", err)
	}

	// Write file
	content := []byte("hello world\nline 2\n")
	if err := mgr.WriteFile(ws.ID, "sub/hello.txt", content); err != nil {
		t.Fatalf("WriteFile failed: %v", err)
	}

	// Read file
	readData, err := mgr.ReadFile(ws.ID, "sub/hello.txt")
	if err != nil {
		t.Fatalf("ReadFile failed: %v", err)
	}
	if string(readData) != string(content) {
		t.Fatalf("content mismatch: got %q, expected %q", string(readData), string(content))
	}

	// Edit file
	if err := mgr.EditFile(ws.ID, "sub/hello.txt", "line 2", "line modified"); err != nil {
		t.Fatalf("EditFile failed: %v", err)
	}

	readEdited, err := mgr.ReadFile(ws.ID, "sub/hello.txt")
	if err != nil {
		t.Fatalf("ReadFile after edit failed: %v", err)
	}
	expected := "hello world\nline modified\n"
	if string(readEdited) != expected {
		t.Fatalf("edited content mismatch: got %q, expected %q", string(readEdited), expected)
	}

	// Edit with non-existent target should fail
	if err := mgr.EditFile(ws.ID, "sub/hello.txt", "non-existent", "fail"); !errors.Is(err, workspace.ErrTargetNotFound) {
		t.Fatalf("expected ErrTargetNotFound, got: %v", err)
	}
}

func TestWorkspaceManager_ListDirectory(t *testing.T) {
	mgr := workspace.NewManager()
	tmpDir := t.TempDir()

	ws, err := mgr.RegisterWorkspace("ws-test", "test-project", tmpDir)
	if err != nil {
		t.Fatalf("RegisterWorkspace failed: %v", err)
	}

	_ = mgr.WriteFile(ws.ID, "a.go", []byte("package a"))
	_ = mgr.WriteFile(ws.ID, "pkg/b.go", []byte("package b"))
	_ = mgr.WriteFile(ws.ID, ".git/HEAD", []byte("ref: refs/heads/main"))
	_ = mgr.WriteFile(ws.ID, "node_modules/dep/index.js", []byte("console.log()"))

	files, err := mgr.ListDirectory(ws.ID, "", 4)
	if err != nil {
		t.Fatalf("ListDirectory failed: %v", err)
	}

	for _, f := range files {
		if f.Name == ".git" || f.Name == "node_modules" {
			t.Fatalf("ignored directory was listed: %s", f.Name)
		}
	}

	// Should contain a.go and pkg/b.go
	foundA := false
	foundB := false
	for _, f := range files {
		if f.Name == "a.go" {
			foundA = true
		}
		if f.Name == "b.go" {
			foundB = true
		}
	}

	if !foundA || !foundB {
		t.Fatalf("expected a.go and b.go to be listed, foundA=%v, foundB=%v", foundA, foundB)
	}
}

func TestWorkspaceManager_SearchFiles(t *testing.T) {
	mgr := workspace.NewManager()
	tmpDir := t.TempDir()

	ws, err := mgr.RegisterWorkspace("ws-test", "test-project", tmpDir)
	if err != nil {
		t.Fatalf("RegisterWorkspace failed: %v", err)
	}

	_ = mgr.WriteFile(ws.ID, "src/server.go", []byte("package server\nfunc StartListener() {\n\t// listen port\n}\n"))
	_ = mgr.WriteFile(ws.ID, "README.md", []byte("# Project\nHow to StartListener:\nRun the command.\n"))

	results, err := mgr.SearchFiles(ws.ID, "StartListener", 10)
	if err != nil {
		t.Fatalf("SearchFiles failed: %v", err)
	}

	if len(results) != 2 {
		t.Fatalf("expected 2 search results, got %d", len(results))
	}

	if results[0].LineNumber != 2 {
		t.Errorf("expected line number 2 in server.go, got %d", results[0].LineNumber)
	}
}

func TestWorkspaceManager_GitDiffAndCommit(t *testing.T) {
	mgr := workspace.NewManager()
	tmpDir := t.TempDir()

	// Init git repository
	cmd := exec.Command("git", "init")
	cmd.Dir = tmpDir
	if err := cmd.Run(); err != nil {
		t.Skip("git not available in test environment")
	}

	exec.Command("git", "-C", tmpDir, "config", "user.name", "Tester").Run()
	exec.Command("git", "-C", tmpDir, "config", "user.email", "tester@example.com").Run()

	ws, err := mgr.RegisterWorkspace("ws-git", "git-test", tmpDir)
	if err != nil {
		t.Fatalf("RegisterWorkspace failed: %v", err)
	}

	// 1. Initial commit
	_ = mgr.WriteFile(ws.ID, "file1.txt", []byte("line 1\n"))
	_, err = mgr.Commit(ws.ID, "initial commit", "")
	if err != nil {
		t.Fatalf("initial commit failed: %v", err)
	}

	// Clean diff initially
	diff, err := mgr.Diff(ws.ID)
	if err != nil {
		t.Fatalf("Diff failed: %v", err)
	}
	if !diff.Clean || diff.TotalChanges != 0 {
		t.Errorf("expected clean diff, got changes=%d", diff.TotalChanges)
	}

	// 2. Modify and add a file
	_ = mgr.WriteFile(ws.ID, "file1.txt", []byte("line 1 modified\nline 2\n"))
	_ = mgr.WriteFile(ws.ID, "file2.txt", []byte("brand new file\n"))

	diff, err = mgr.Diff(ws.ID)
	if err != nil {
		t.Fatalf("Diff failed: %v", err)
	}
	if diff.Clean || diff.TotalChanges != 2 {
		t.Errorf("expected 2 changes, got %d (clean=%v)", diff.TotalChanges, diff.Clean)
	}
	if !strings.Contains(diff.UnifiedDiff, "line 1 modified") {
		t.Errorf("expected unified diff to contain modified line, got: %s", diff.UnifiedDiff)
	}

	// 3. Commit changes
	res, err := mgr.Commit(ws.ID, "second commit: update file1 and add file2", "Dev <dev@example.com>")
	if err != nil {
		t.Fatalf("Commit failed: %v", err)
	}
	if res.CommitHash == "" {
		t.Errorf("expected non-empty commit hash")
	}
	if res.Message != "second commit: update file1 and add file2" {
		t.Errorf("unexpected commit message: %s", res.Message)
	}

	// 4. Verify clean after commit
	diffAfter, err := mgr.Diff(ws.ID)
	if err != nil {
		t.Fatalf("Diff after commit failed: %v", err)
	}
	if !diffAfter.Clean || diffAfter.TotalChanges != 0 {
		t.Errorf("expected clean repository after commit, got changes=%d", diffAfter.TotalChanges)
	}
}
