package tools_test

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"testing"

	"github.com/antigravity/remote-daemon/pkg/tools"
	"github.com/antigravity/remote-daemon/pkg/workspace"
)

func setupTestTools(t *testing.T) (*tools.Registry, *workspace.Manager, string) {
	wsMgr := workspace.NewManager()
	tmpDir := t.TempDir()

	ws, err := wsMgr.RegisterWorkspace("ws-tools", "tools-test", tmpDir)
	if err != nil {
		t.Fatalf("RegisterWorkspace failed: %v", err)
	}

	reg := tools.NewRegistry(wsMgr, false)
	return reg, wsMgr, ws.ID
}

func TestRegistry_RegistrationAndListing(t *testing.T) {
	reg, _, _ := setupTestTools(t)

	toolList := reg.ListTools()
	if len(toolList) < 6 {
		t.Fatalf("expected at least 6 default tools, got %d", len(toolList))
	}

	expected := map[string]bool{
		"run_command":          false,
		"view_file":            false,
		"write_to_file":        false,
		"replace_file_content": false,
		"list_dir":             false,
		"grep_search":          false,
	}

	for _, tl := range toolList {
		if _, ok := expected[tl.Name]; ok {
			expected[tl.Name] = true
		}
	}

	for name, found := range expected {
		if !found {
			t.Errorf("tool %s not registered in ListTools", name)
		}
	}
}

func TestRegistry_RunCommand_LiveStreaming(t *testing.T) {
	reg, _, wsID := setupTestTools(t)
	ctx := context.Background()

	var chunks []string
	var mu sync.Mutex

	onChunk := func(c []byte) {
		mu.Lock()
		chunks = append(chunks, string(c))
		mu.Unlock()
	}

	params := json.RawMessage(`{"command": "echo hello_antigravity"}`)
	res, err := reg.Execute(ctx, "s1", wsID, "run_command", params, onChunk)
	if err != nil {
		t.Fatalf("Execute run_command failed: %v", err)
	}

	if !res.Success {
		t.Fatalf("expected command success, got exitCode=%d error=%s", res.ExitCode, res.Error)
	}

	if !strings.Contains(res.Output, "hello_antigravity") {
		t.Fatalf("expected 'hello_antigravity' in output, got: %q", res.Output)
	}

	mu.Lock()
	chunkLen := len(chunks)
	mu.Unlock()
	if chunkLen == 0 {
		t.Fatalf("expected at least 1 output chunk streamed via onChunk")
	}
}

func TestRegistry_FileOperations(t *testing.T) {
	reg, _, wsID := setupTestTools(t)
	ctx := context.Background()

	// 1. write_to_file
	writeParams := json.RawMessage(`{"path": "pkg/calc.go", "content": "package pkg\n\nfunc Add(a, b int) int {\n\treturn a + b\n}\n"}`)
	wRes, err := reg.Execute(ctx, "s1", wsID, "write_to_file", writeParams, nil)
	if err != nil || !wRes.Success {
		t.Fatalf("write_to_file failed: %v, res: %+v", err, wRes)
	}

	// 2. view_file
	viewParams := json.RawMessage(`{"path": "pkg/calc.go", "startLine": 3, "endLine": 4}`)
	vRes, err := reg.Execute(ctx, "s1", wsID, "view_file", viewParams, nil)
	if err != nil || !vRes.Success {
		t.Fatalf("view_file failed: %v, res: %+v", err, vRes)
	}
	if !strings.Contains(vRes.Output, "func Add") {
		t.Fatalf("expected 'func Add' in view output, got: %q", vRes.Output)
	}

	// 3. replace_file_content
	editParams := json.RawMessage(`{"path": "pkg/calc.go", "target": "return a + b", "replacement": "return a + b + 0"}`)
	eRes, err := reg.Execute(ctx, "s1", wsID, "replace_file_content", editParams, nil)
	if err != nil || !eRes.Success {
		t.Fatalf("replace_file_content failed: %v, res: %+v", err, eRes)
	}

	// 4. grep_search
	grepParams := json.RawMessage(`{"query": "return a + b + 0"}`)
	gRes, err := reg.Execute(ctx, "s1", wsID, "grep_search", grepParams, nil)
	if err != nil || !gRes.Success {
		t.Fatalf("grep_search failed: %v, res: %+v", err, gRes)
	}
	if !strings.Contains(gRes.Output, "pkg/calc.go:4:") {
		t.Fatalf("expected match at pkg/calc.go line 4, got: %q", gRes.Output)
	}

	// 5. list_dir
	listParams := json.RawMessage(`{"depth": 2}`)
	lRes, err := reg.Execute(ctx, "s1", wsID, "list_dir", listParams, nil)
	if err != nil || !lRes.Success {
		t.Fatalf("list_dir failed: %v, res: %+v", err, lRes)
	}
	if !strings.Contains(lRes.Output, "calc.go") {
		t.Fatalf("expected calc.go in directory listing, got: %q", lRes.Output)
	}
}

func TestRegistry_ApprovalGating(t *testing.T) {
	wsMgr := workspace.NewManager()
	tmpDir := t.TempDir()
	_, _ = wsMgr.RegisterWorkspace("ws", "test", tmpDir)

	regGated := tools.NewRegistry(wsMgr, false)
	regAuto := tools.NewRegistry(wsMgr, true)

	// Safe read tool view_file -> requires approval = false
	if regGated.NeedsApproval("view_file", json.RawMessage(`{}`)) {
		t.Errorf("view_file should not require approval")
	}

	// Mutating tool write_to_file -> requires approval = true in gated mode
	if !regGated.NeedsApproval("write_to_file", json.RawMessage(`{}`)) {
		t.Errorf("write_to_file must require approval in gated mode")
	}

	// In auto-approve mode -> requires approval = false always
	if regAuto.NeedsApproval("write_to_file", json.RawMessage(`{}`)) {
		t.Errorf("write_to_file should not require approval in auto-approve mode")
	}
}
