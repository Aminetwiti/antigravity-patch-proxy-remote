package gateway

import (
	"os"
	"path/filepath"
	"testing"
)

func TestResolveAndValidatePath(t *testing.T) {
	tempDir := t.TempDir()
	subDir := filepath.Join(tempDir, "src", "pkg")
	if err := os.MkdirAll(subDir, 0755); err != nil {
		t.Fatalf("mkdir failed: %v", err)
	}

	testFile := filepath.Join(subDir, "main.go")
	if err := os.WriteFile(testFile, []byte("package main"), 0644); err != nil {
		t.Fatalf("write file failed: %v", err)
	}

	// 1. Valid relative path
	resolved, err := ResolveAndValidatePath(tempDir, "src/pkg/main.go")
	if err != nil {
		t.Fatalf("expected valid path, got: %v", err)
	}
	if resolved != testFile {
		t.Errorf("expected %s, got %s", testFile, resolved)
	}

	// 2. Valid absolute path inside root
	resolved, err = ResolveAndValidatePath(tempDir, testFile)
	if err != nil {
		t.Fatalf("expected valid absolute path, got: %v", err)
	}
	if resolved != testFile {
		t.Errorf("expected %s, got %s", testFile, resolved)
	}

	// 3. Traversal rejection (../ outside root)
	_, err = ResolveAndValidatePath(tempDir, "../outside.txt")
	if err == nil {
		t.Errorf("expected traversal error, got nil")
	}

	// 4. Traversal rejection (../../etc/passwd style)
	_, err = ResolveAndValidatePath(tempDir, "src/../../..")
	if err == nil {
		t.Errorf("expected traversal escape error, got nil")
	}

	// 5. Empty root
	_, err = ResolveAndValidatePath("", "test.go")
	if err == nil {
		t.Errorf("expected empty root error, got nil")
	}
}

func TestNativeFSOperations(t *testing.T) {
	tempDir := t.TempDir()
	engine := NewNativeFSEngine()

	// 1. Write file
	content := []byte("hello native fs world\nline two of test\n")
	err := engine.WriteFileNative(tempDir, "test.txt", content)
	if err != nil {
		t.Fatalf("write failed: %v", err)
	}

	// 2. Read file
	readData, isBin, err := engine.ReadFileNative(tempDir, "test.txt")
	if err != nil {
		t.Fatalf("read failed: %v", err)
	}
	if isBin {
		t.Errorf("expected text, got binary")
	}
	if string(readData) != string(content) {
		t.Errorf("content mismatch: expected %q, got %q", string(content), string(readData))
	}

	// 3. List directory
	files, err := engine.ListDirectoryNative(tempDir, "", 0)
	if err != nil {
		t.Fatalf("list failed: %v", err)
	}
	if len(files) == 0 {
		t.Errorf("expected at least 1 file in list")
	}

	// 4. Search files
	searchResults, err := engine.SearchFilesNative(tempDir, "native")
	if err != nil {
		t.Fatalf("search failed: %v", err)
	}
	if len(searchResults) == 0 {
		t.Errorf("expected search match for 'native'")
	}
}
