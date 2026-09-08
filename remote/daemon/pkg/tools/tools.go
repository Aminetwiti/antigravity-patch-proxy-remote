package tools

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/antigravity/remote-daemon/pkg/workspace"
)

var (
	ErrToolNotFound = errors.New("tool not found")
)

type ToolResult struct {
	Success  bool   `json:"success"`
	Output   string `json:"output,omitempty"`
	Error    string `json:"error,omitempty"`
	ExitCode int    `json:"exitCode"`
}

type ToolDefinition struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	Parameters  map[string]interface{} `json:"parameters"`
}

type Tool interface {
	Name() string
	Description() string
	ParametersSchema() map[string]interface{}
	RequiresApproval(params json.RawMessage) bool
	Execute(ctx context.Context, sessionID, workspaceID string, params json.RawMessage, onChunk func(chunk []byte)) (*ToolResult, error)
}

type Registry struct {
	mu         sync.RWMutex
	tools      map[string]Tool
	wsMgr      *workspace.Manager
	autoApprove bool
}

func NewRegistry(wsMgr *workspace.Manager, autoApprove bool) *Registry {
	r := &Registry{
		tools:       make(map[string]Tool),
		wsMgr:       wsMgr,
		autoApprove: autoApprove,
	}
	r.registerDefaults()
	return r
}

func (r *Registry) RegisterTool(t Tool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.tools[t.Name()] = t
}

func (r *Registry) GetTool(name string) (Tool, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	t, ok := r.tools[name]
	return t, ok
}

func (r *Registry) ListTools() []ToolDefinition {
	r.mu.RLock()
	defer r.mu.RUnlock()

	defs := make([]ToolDefinition, 0, len(r.tools))
	for _, t := range r.tools {
		defs = append(defs, ToolDefinition{
			Name:        t.Name(),
			Description: t.Description(),
			Parameters:  t.ParametersSchema(),
		})
	}
	return defs
}

func (r *Registry) NeedsApproval(name string, params json.RawMessage) bool {
	if r.autoApprove {
		return false
	}
	t, ok := r.GetTool(name)
	if !ok {
		return false
	}
	return t.RequiresApproval(params)
}

func (r *Registry) Execute(ctx context.Context, sessionID, workspaceID, toolName string, params json.RawMessage, onChunk func(chunk []byte)) (*ToolResult, error) {
	t, ok := r.GetTool(toolName)
	if !ok {
		return nil, fmt.Errorf("%w: %s", ErrToolNotFound, toolName)
	}
	return t.Execute(ctx, sessionID, workspaceID, params, onChunk)
}

func (r *Registry) registerDefaults() {
	r.tools["run_command"] = &RunCommandTool{wsMgr: r.wsMgr}
	r.tools["view_file"] = &ViewFileTool{wsMgr: r.wsMgr}
	r.tools["write_to_file"] = &WriteFileTool{wsMgr: r.wsMgr}
	r.tools["replace_file_content"] = &ReplaceFileContentTool{wsMgr: r.wsMgr}
	r.tools["list_dir"] = &ListDirTool{wsMgr: r.wsMgr}
	r.tools["grep_search"] = &GrepSearchTool{wsMgr: r.wsMgr}
}

// -----------------------------------------------------------------------------
// Built-in Tool: run_command
// -----------------------------------------------------------------------------

type RunCommandTool struct {
	wsMgr *workspace.Manager
}

type RunCommandParams struct {
	CommandLine string `json:"command"`
	Cwd         string `json:"cwd,omitempty"`
	TimeoutSec  int    `json:"timeoutSec,omitempty"`
}

func (t *RunCommandTool) Name() string { return "run_command" }
func (t *RunCommandTool) Description() string {
	return "Executes a shell command in the session workspace directory, streaming live outputs."
}

func (t *RunCommandTool) ParametersSchema() map[string]interface{} {
	return map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"command": map[string]interface{}{"type": "string", "description": "The command line string to execute."},
			"cwd":     map[string]interface{}{"type": "string", "description": "Optional relative subdirectory inside workspace."},
			"timeoutSec": map[string]interface{}{"type": "integer", "description": "Optional command timeout in seconds (default: 120)."},
		},
		"required": []string{"command"},
	}
}

func (t *RunCommandTool) RequiresApproval(params json.RawMessage) bool {
	var p RunCommandParams
	if err := json.Unmarshal(params, &p); err != nil {
		return true
	}
	cmd := strings.TrimSpace(p.CommandLine)
	// Safe read-only inspections can bypass approval if desired
	if strings.HasPrefix(cmd, "git status") || strings.HasPrefix(cmd, "pwd") || strings.HasPrefix(cmd, "echo ") {
		return false
	}
	return true
}

func (t *RunCommandTool) Execute(ctx context.Context, sessionID, workspaceID string, params json.RawMessage, onChunk func(chunk []byte)) (*ToolResult, error) {
	var p RunCommandParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, fmt.Errorf("invalid parameters for run_command: %w", err)
	}

	wsDir, err := t.wsMgr.ResolvePath(workspaceID, p.Cwd)
	if err != nil {
		return nil, err
	}

	timeout := 120 * time.Second
	if p.TimeoutSec > 0 {
		timeout = time.Duration(p.TimeoutSec) * time.Second
	}

	cmdCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.CommandContext(cmdCtx, "cmd.exe", "/c", p.CommandLine)
	} else {
		cmd = exec.CommandContext(cmdCtx, "sh", "-c", p.CommandLine)
	}
	cmd.Dir = wsDir

	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		return nil, err
	}

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("failed to start command: %w", err)
	}

	var outputBuf strings.Builder
	var mu sync.Mutex

	streamReader := func(r io.Reader) {
		buf := make([]byte, 1024)
		for {
			n, readErr := r.Read(buf)
			if n > 0 {
				chunk := buf[:n]
				mu.Lock()
				outputBuf.Write(chunk)
				mu.Unlock()
				if onChunk != nil {
					onChunk(chunk)
				}
			}
			if readErr != nil {
				break
			}
		}
	}

	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); streamReader(stdoutPipe) }()
	go func() { defer wg.Done(); streamReader(stderrPipe) }()

	wg.Wait()
	waitErr := cmd.Wait()

	exitCode := 0
	if waitErr != nil {
		var exitErr *exec.ExitError
		if errors.As(waitErr, &exitErr) {
			exitCode = exitErr.ExitCode()
		} else {
			exitCode = 1
		}
	}

	return &ToolResult{
		Success:  exitCode == 0,
		Output:   outputBuf.String(),
		ExitCode: exitCode,
	}, nil
}

// -----------------------------------------------------------------------------
// Built-in Tool: view_file
// -----------------------------------------------------------------------------

type ViewFileTool struct {
	wsMgr *workspace.Manager
}

type ViewFileParams struct {
	Path      string `json:"path"`
	StartLine int    `json:"startLine,omitempty"`
	EndLine   int    `json:"endLine,omitempty"`
}

func (t *ViewFileTool) Name() string { return "view_file" }
func (t *ViewFileTool) Description() string {
	return "Reads the contents of a file inside the workspace with optional line slice."
}
func (t *ViewFileTool) ParametersSchema() map[string]interface{} {
	return map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"path":      map[string]interface{}{"type": "string", "description": "Relative path to file."},
			"startLine": map[string]interface{}{"type": "integer", "description": "1-indexed starting line."},
			"endLine":   map[string]interface{}{"type": "integer", "description": "1-indexed ending line."},
		},
		"required": []string{"path"},
	}
}
func (t *ViewFileTool) RequiresApproval(_ json.RawMessage) bool { return false }

func (t *ViewFileTool) Execute(ctx context.Context, sessionID, workspaceID string, params json.RawMessage, onChunk func(chunk []byte)) (*ToolResult, error) {
	var p ViewFileParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, err
	}

	data, err := t.wsMgr.ReadFile(workspaceID, p.Path)
	if err != nil {
		return &ToolResult{Success: false, Error: err.Error()}, nil
	}

	lines := strings.Split(string(data), "\n")
	start := 1
	if p.StartLine > 1 {
		start = p.StartLine
	}
	end := len(lines)
	if p.EndLine > 0 && p.EndLine < end {
		end = p.EndLine
	}

	if start > len(lines) {
		return &ToolResult{Success: true, Output: ""}, nil
	}

	var sb strings.Builder
	for i := start - 1; i < end && i < len(lines); i++ {
		sb.WriteString(fmt.Sprintf("%d: %s\n", i+1, lines[i]))
	}

	out := sb.String()
	if onChunk != nil {
		onChunk([]byte(out))
	}
	return &ToolResult{Success: true, Output: out}, nil
}

// -----------------------------------------------------------------------------
// Built-in Tool: write_to_file
// -----------------------------------------------------------------------------

type WriteFileTool struct {
	wsMgr *workspace.Manager
}

type WriteFileParams struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

func (t *WriteFileTool) Name() string { return "write_to_file" }
func (t *WriteFileTool) Description() string {
	return "Writes content to a file inside the workspace (creates file and parent directories if missing)."
}
func (t *WriteFileTool) ParametersSchema() map[string]interface{} {
	return map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"path":    map[string]interface{}{"type": "string", "description": "Relative path to file."},
			"content": map[string]interface{}{"type": "string", "description": "Full file content to write."},
		},
		"required": []string{"path", "content"},
	}
}
func (t *WriteFileTool) RequiresApproval(_ json.RawMessage) bool { return true }

func (t *WriteFileTool) Execute(ctx context.Context, sessionID, workspaceID string, params json.RawMessage, onChunk func(chunk []byte)) (*ToolResult, error) {
	var p WriteFileParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, err
	}

	err := t.wsMgr.WriteFile(workspaceID, p.Path, []byte(p.Content))
	if err != nil {
		return &ToolResult{Success: false, Error: err.Error()}, nil
	}
	msg := fmt.Sprintf("Successfully wrote %d bytes to %s", len(p.Content), p.Path)
	if onChunk != nil {
		onChunk([]byte(msg))
	}
	return &ToolResult{Success: true, Output: msg}, nil
}

// -----------------------------------------------------------------------------
// Built-in Tool: replace_file_content
// -----------------------------------------------------------------------------

type ReplaceFileContentTool struct {
	wsMgr *workspace.Manager
}

type ReplaceFileContentParams struct {
	Path        string `json:"path"`
	Target      string `json:"target"`
	Replacement string `json:"replacement"`
}

func (t *ReplaceFileContentTool) Name() string { return "replace_file_content" }
func (t *ReplaceFileContentTool) Description() string {
	return "Replaces an exact target string with replacement text in a file inside the workspace."
}
func (t *ReplaceFileContentTool) ParametersSchema() map[string]interface{} {
	return map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"path":        map[string]interface{}{"type": "string", "description": "Relative path to file."},
			"target":      map[string]interface{}{"type": "string", "description": "Exact text substring to replace."},
			"replacement": map[string]interface{}{"type": "string", "description": "New text to substitute."},
		},
		"required": []string{"path", "target", "replacement"},
	}
}
func (t *ReplaceFileContentTool) RequiresApproval(_ json.RawMessage) bool { return true }

func (t *ReplaceFileContentTool) Execute(ctx context.Context, sessionID, workspaceID string, params json.RawMessage, onChunk func(chunk []byte)) (*ToolResult, error) {
	var p ReplaceFileContentParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, err
	}

	err := t.wsMgr.EditFile(workspaceID, p.Path, p.Target, p.Replacement)
	if err != nil {
		return &ToolResult{Success: false, Error: err.Error()}, nil
	}
	msg := fmt.Sprintf("Successfully replaced target text in %s", p.Path)
	if onChunk != nil {
		onChunk([]byte(msg))
	}
	return &ToolResult{Success: true, Output: msg}, nil
}

// -----------------------------------------------------------------------------
// Built-in Tool: list_dir
// -----------------------------------------------------------------------------

type ListDirTool struct {
	wsMgr *workspace.Manager
}

type ListDirParams struct {
	Path  string `json:"path,omitempty"`
	Depth int    `json:"depth,omitempty"`
}

func (t *ListDirTool) Name() string { return "list_dir" }
func (t *ListDirTool) Description() string {
	return "Lists files and subdirectories recursively inside the workspace."
}
func (t *ListDirTool) ParametersSchema() map[string]interface{} {
	return map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"path":  map[string]interface{}{"type": "string", "description": "Relative path (empty for workspace root)."},
			"depth": map[string]interface{}{"type": "integer", "description": "Max recursion depth (default 4)."},
		},
	}
}
func (t *ListDirTool) RequiresApproval(_ json.RawMessage) bool { return false }

func (t *ListDirTool) Execute(ctx context.Context, sessionID, workspaceID string, params json.RawMessage, onChunk func(chunk []byte)) (*ToolResult, error) {
	var p ListDirParams
	if len(params) > 0 {
		_ = json.Unmarshal(params, &p)
	}
	depth := 4
	if p.Depth > 0 {
		depth = p.Depth
	}

	files, err := t.wsMgr.ListDirectory(workspaceID, p.Path, depth)
	if err != nil {
		return &ToolResult{Success: false, Error: err.Error()}, nil
	}

	var sb strings.Builder
	for _, f := range files {
		kind := "FILE"
		if f.IsDir {
			kind = "DIR "
		}
		sb.WriteString(fmt.Sprintf("[%s] %s (%d bytes)\n", kind, f.Path, f.Size))
	}

	out := sb.String()
	if onChunk != nil {
		onChunk([]byte(out))
	}
	return &ToolResult{Success: true, Output: out}, nil
}

// -----------------------------------------------------------------------------
// Built-in Tool: grep_search
// -----------------------------------------------------------------------------

type GrepSearchTool struct {
	wsMgr *workspace.Manager
}

type GrepSearchParams struct {
	Query      string `json:"query"`
	MaxResults int    `json:"maxResults,omitempty"`
}

func (t *GrepSearchTool) Name() string { return "grep_search" }
func (t *GrepSearchTool) Description() string {
	return "Searches for a text pattern or keyword across files in the workspace."
}
func (t *GrepSearchTool) ParametersSchema() map[string]interface{} {
	return map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"query":      map[string]interface{}{"type": "string", "description": "Search pattern or text query."},
			"maxResults": map[string]interface{}{"type": "integer", "description": "Maximum number of results to return."},
		},
		"required": []string{"query"},
	}
}
func (t *GrepSearchTool) RequiresApproval(_ json.RawMessage) bool { return false }

func (t *GrepSearchTool) Execute(ctx context.Context, sessionID, workspaceID string, params json.RawMessage, onChunk func(chunk []byte)) (*ToolResult, error) {
	var p GrepSearchParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, err
	}

	results, err := t.wsMgr.SearchFiles(workspaceID, p.Query, p.MaxResults)
	if err != nil {
		return &ToolResult{Success: false, Error: err.Error()}, nil
	}

	var sb strings.Builder
	for _, r := range results {
		sb.WriteString(fmt.Sprintf("%s:%d: %s\n", r.Path, r.LineNumber, r.LineText))
	}

	out := sb.String()
	if onChunk != nil {
		onChunk([]byte(out))
	}
	return &ToolResult{Success: true, Output: out}, nil
}

// Ensure bufio is imported for potential streaming line reads
var _ = bufio.MaxScanTokenSize
