package workspace

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"unicode/utf8"
)

var (
	ErrWorkspaceNotFound = fmt.Errorf("workspace not found")
	ErrPathOutsideRoot   = fmt.Errorf("access denied: path outside workspace root")
	ErrTargetNotFound    = fmt.Errorf("target string not found in file")
	ErrFileTooLarge      = fmt.Errorf("file exceeds maximum size limit")
)

const (
	DefaultMaxFileSize = 10 * 1024 * 1024 // 10 MB
	DefaultMaxDepth    = 8
)

type FileInfo struct {
	Name     string `json:"name"`
	Path     string `json:"path"`
	FullPath string `json:"fullPath"`
	IsDir    bool   `json:"isDir"`
	Size     int64  `json:"size"`
	Depth    int    `json:"depth"`
}

type SearchResult struct {
	Path       string `json:"path"`
	LineNumber int    `json:"lineNumber"`
	LineText   string `json:"lineText"`
}

type Workspace struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Root string `json:"root"`
}

type Manager struct {
	mu          sync.RWMutex
	workspaces  map[string]*Workspace
	maxFileSize int64
}

func NewManager() *Manager {
	return &Manager{
		workspaces:  make(map[string]*Workspace),
		maxFileSize: DefaultMaxFileSize,
	}
}

func ResolveAndValidatePath(workspaceRoot, targetPath string) (string, error) {
	if workspaceRoot == "" {
		return "", fmt.Errorf("workspaceRoot cannot be empty")
	}
	cleanRoot := filepath.Clean(workspaceRoot)

	cleanTarget := strings.TrimPrefix(targetPath, "file:///")
	cleanTarget = strings.TrimPrefix(cleanTarget, "file://")

	var resolved string
	if filepath.IsAbs(cleanTarget) {
		resolved = filepath.Clean(cleanTarget)
	} else {
		resolved = filepath.Clean(filepath.Join(cleanRoot, cleanTarget))
	}

	rel, err := filepath.Rel(cleanRoot, resolved)
	if err != nil {
		return "", fmt.Errorf("failed to evaluate relative path: %w", err)
	}

	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("%w: %s", ErrPathOutsideRoot, targetPath)
	}

	return resolved, nil
}

func (m *Manager) RegisterWorkspace(id, name, root string) (*Workspace, error) {
	cleanRoot, err := filepath.Abs(root)
	if err != nil {
		return nil, fmt.Errorf("invalid workspace root: %w", err)
	}

	if err := os.MkdirAll(cleanRoot, 0755); err != nil {
		return nil, fmt.Errorf("failed to ensure workspace root directory: %w", err)
	}

	ws := &Workspace{
		ID:   id,
		Name: name,
		Root: cleanRoot,
	}

	m.mu.Lock()
	m.workspaces[id] = ws
	m.mu.Unlock()

	return ws, nil
}

func (m *Manager) GetWorkspace(id string) (*Workspace, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	ws, ok := m.workspaces[id]
	if !ok {
		return nil, ErrWorkspaceNotFound
	}
	return ws, nil
}

func (m *Manager) ListWorkspaces() []*Workspace {
	m.mu.RLock()
	defer m.mu.RUnlock()
	list := make([]*Workspace, 0, len(m.workspaces))
	for _, ws := range m.workspaces {
		list = append(list, ws)
	}
	return list
}

func (m *Manager) ResolvePath(workspaceID, targetPath string) (string, error) {
	ws, err := m.GetWorkspace(workspaceID)
	if err != nil {
		return "", err
	}
	return ResolveAndValidatePath(ws.Root, targetPath)
}

func (m *Manager) ReadFile(workspaceID, relPath string) ([]byte, error) {
	resolved, err := m.ResolvePath(workspaceID, relPath)
	if err != nil {
		return nil, err
	}

	info, err := os.Stat(resolved)
	if err != nil {
		return nil, err
	}
	if info.IsDir() {
		return nil, fmt.Errorf("target is a directory, not a file")
	}
	if info.Size() > m.maxFileSize {
		return nil, fmt.Errorf("%w (%d bytes > %d limit)", ErrFileTooLarge, info.Size(), m.maxFileSize)
	}

	return os.ReadFile(resolved)
}

func (m *Manager) WriteFile(workspaceID, relPath string, content []byte) error {
	resolved, err := m.ResolvePath(workspaceID, relPath)
	if err != nil {
		return err
	}

	parent := filepath.Dir(resolved)
	if err := os.MkdirAll(parent, 0755); err != nil {
		return fmt.Errorf("failed to create parent directories: %w", err)
	}

	// Atomic write via temporary file
	tmpFile := fmt.Sprintf("%s.tmp.%d", resolved, os.Getpid())
	if err := os.WriteFile(tmpFile, content, 0644); err != nil {
		return fmt.Errorf("failed to write temp file: %w", err)
	}

	if err := os.Rename(tmpFile, resolved); err != nil {
		_ = os.Remove(tmpFile)
		return fmt.Errorf("failed to commit atomic write: %w", err)
	}

	return nil
}

func (m *Manager) EditFile(workspaceID, relPath, target, replacement string) error {
	resolved, err := m.ResolvePath(workspaceID, relPath)
	if err != nil {
		return err
	}

	content, err := os.ReadFile(resolved)
	if err != nil {
		return err
	}

	text := string(content)
	if !strings.Contains(text, target) {
		return fmt.Errorf("%w: %q", ErrTargetNotFound, target)
	}

	newText := strings.Replace(text, target, replacement, 1)
	return m.WriteFile(workspaceID, relPath, []byte(newText))
}

func isIgnored(name string) bool {
	switch name {
	case ".git", "node_modules", ".dart_tool", "dist", "build", ".venv", "__pycache__":
		return true
	default:
		return false
	}
}

func (m *Manager) ListDirectory(workspaceID, relPath string, depth int) ([]FileInfo, error) {
	ws, err := m.GetWorkspace(workspaceID)
	if err != nil {
		return nil, err
	}

	targetDir, err := ResolveAndValidatePath(ws.Root, relPath)
	if err != nil {
		return nil, err
	}

	return m.listDirRecursive(ws.Root, targetDir, relPath, 0, depth)
}

func (m *Manager) listDirRecursive(root, currentAbs, currentRel string, currentDepth, maxDepth int) ([]FileInfo, error) {
	if maxDepth > 0 && currentDepth >= maxDepth {
		return nil, nil
	}

	entries, err := os.ReadDir(currentAbs)
	if err != nil {
		return nil, err
	}

	sort.Slice(entries, func(i, j int) bool {
		if entries[i].IsDir() == entries[j].IsDir() {
			return entries[i].Name() < entries[j].Name()
		}
		return entries[i].IsDir()
	})

	var result []FileInfo
	for _, entry := range entries {
		name := entry.Name()
		if isIgnored(name) {
			continue
		}

		fullPath := filepath.Join(currentAbs, name)
		info, errInfo := os.Lstat(fullPath)
		if errInfo != nil || info.Mode()&os.ModeSymlink != 0 {
			continue
		}

		entryRel := filepath.ToSlash(filepath.Join(currentRel, name))
		item := FileInfo{
			Name:     name,
			Path:     entryRel,
			FullPath: fullPath,
			IsDir:    entry.IsDir(),
			Size:     info.Size(),
			Depth:    currentDepth,
		}
		result = append(result, item)

		if entry.IsDir() {
			children, _ := m.listDirRecursive(root, fullPath, entryRel, currentDepth+1, maxDepth)
			result = append(result, children...)
		}
	}

	return result, nil
}

func (m *Manager) SearchFiles(workspaceID, query string, maxResults int) ([]SearchResult, error) {
	if query == "" {
		return []SearchResult{}, nil
	}
	if maxResults <= 0 {
		maxResults = 50
	}

	ws, err := m.GetWorkspace(workspaceID)
	if err != nil {
		return nil, err
	}

	var results []SearchResult
	queryLower := strings.ToLower(query)

	err = filepath.Walk(ws.Root, func(path string, info os.FileInfo, err error) error {
		if err != nil || len(results) >= maxResults {
			return nil
		}
		if info.IsDir() {
			if isIgnored(info.Name()) {
				return filepath.SkipDir
			}
			return nil
		}

		if info.Size() > 2*1024*1024 { // Skip files > 2MB for search
			return nil
		}

		data, err := os.ReadFile(path)
		if err != nil || !utf8.Valid(data) || bytes.IndexByte(data, 0) != -1 {
			return nil // Skip non-utf8 or binary files
		}

		lines := strings.Split(string(data), "\n")
		rel, _ := filepath.Rel(ws.Root, path)
		rel = filepath.ToSlash(rel)

		for i, line := range lines {
			if strings.Contains(strings.ToLower(line), queryLower) {
				results = append(results, SearchResult{
					Path:       rel,
					LineNumber: i + 1,
					LineText:   strings.TrimSpace(line),
				})
				if len(results) >= maxResults {
					return nil
				}
			}
		}
		return nil
	})

	return results, err
}

// UnregisterWorkspace removes a workspace from management.
func (m *Manager) UnregisterWorkspace(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.workspaces[id]; !ok {
		return ErrWorkspaceNotFound
	}
	delete(m.workspaces, id)
	return nil
}

// ListBranches returns all local and remote branches in the workspace repository.
func (m *Manager) ListBranches(workspaceID string) ([]string, error) {
	ws, err := m.GetWorkspace(workspaceID)
	if err != nil {
		return nil, err
	}

	cmd := exec.Command("git", "branch", "-a", "--format=%(refname:short)")
	cmd.Dir = ws.Root
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("git branch failed: %w", err)
	}

	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	var branches []string
	seen := make(map[string]bool)
	for _, l := range lines {
		trimmed := strings.TrimSpace(l)
		if trimmed != "" && !seen[trimmed] {
			seen[trimmed] = true
			branches = append(branches, trimmed)
		}
	}
	sort.Strings(branches)
	return branches, nil
}

// CurrentBranch returns the currently checked out branch name in the workspace repository.
func (m *Manager) CurrentBranch(workspaceID string) (string, error) {
	ws, err := m.GetWorkspace(workspaceID)
	if err != nil {
		return "", err
	}

	cmd := exec.Command("git", "rev-parse", "--abbrev-ref", "HEAD")
	cmd.Dir = ws.Root
	out, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("git rev-parse failed: %w", err)
	}
	return strings.TrimSpace(string(out)), nil
}

// CreateWorktree creates an isolated Git worktree on a new or existing branch.
func (m *Manager) CreateWorktree(baseWsID, branch, newWsID string) (*Workspace, error) {
	baseWs, err := m.GetWorkspace(baseWsID)
	if err != nil {
		return nil, err
	}

	if branch == "" {
		return nil, fmt.Errorf("branch name cannot be empty")
	}
	if newWsID == "" {
		newWsID = fmt.Sprintf("%s_%s", baseWsID, strings.ReplaceAll(branch, "/", "_"))
	}

	parentDir := filepath.Dir(baseWs.Root)
	worktreeRoot := filepath.Join(parentDir, "worktrees", newWsID)
	_ = os.MkdirAll(filepath.Dir(worktreeRoot), 0755)

	branches, _ := m.ListBranches(baseWsID)
	branchExists := false
	for _, b := range branches {
		if b == branch || strings.HasSuffix(b, "/"+branch) {
			branchExists = true
			break
		}
	}

	var cmd *exec.Cmd
	if branchExists {
		cmd = exec.Command("git", "worktree", "add", worktreeRoot, branch)
	} else {
		cmd = exec.Command("git", "worktree", "add", "-b", branch, worktreeRoot)
	}
	cmd.Dir = baseWs.Root
	if out, err := cmd.CombinedOutput(); err != nil {
		return nil, fmt.Errorf("git worktree add failed: %s (%w)", string(out), err)
	}

	return m.RegisterWorkspace(newWsID, fmt.Sprintf("%s (%s)", baseWs.Name, branch), worktreeRoot)
}

// RemoveWorktree deletes a Git worktree and unregisters the workspace.
func (m *Manager) RemoveWorktree(wsID string) error {
	ws, err := m.GetWorkspace(wsID)
	if err != nil {
		return err
	}

	cmd := exec.Command("git", "worktree", "remove", "--force", ws.Root)
	cmd.Dir = ws.Root
	_ = cmd.Run()

	_ = m.UnregisterWorkspace(wsID)
	_ = os.RemoveAll(ws.Root)
	return nil
}

type GitDiffFile struct {
	Path   string `json:"path"`
	Status string `json:"status"` // "M", "A", "D", "R", "??"
	Staged bool   `json:"staged"`
}

type GitDiffSummary struct {
	Branch       string        `json:"branch"`
	Clean        bool          `json:"clean"`
	Files        []GitDiffFile `json:"files"`
	TotalChanges int           `json:"totalChanges"`
	UnifiedDiff  string        `json:"unifiedDiff"`
}

type GitCommitResult struct {
	CommitHash string `json:"commitHash"`
	Branch     string `json:"branch"`
	Message    string `json:"message"`
}

// Diff returns current working tree and staged Git changes in the workspace.
func (m *Manager) Diff(workspaceID string) (*GitDiffSummary, error) {
	ws, err := m.GetWorkspace(workspaceID)
	if err != nil {
		return nil, err
	}

	branch, _ := m.CurrentBranch(workspaceID)
	if branch == "" {
		branch = "HEAD"
	}

	// 1. Status porcelain
	statusCmd := exec.Command("git", "status", "--porcelain=v1")
	statusCmd.Dir = ws.Root
	statusOut, err := statusCmd.Output()
	if err != nil {
		return nil, fmt.Errorf("git status failed: %w", err)
	}

	lines := strings.Split(strings.TrimSpace(string(statusOut)), "\n")
	var files []GitDiffFile
	for _, l := range lines {
		l = strings.TrimSpace(l)
		if len(l) < 3 {
			continue
		}
		statusCode := l[:2]
		filePath := strings.TrimSpace(l[2:])
		staged := statusCode[0] != ' ' && statusCode[0] != '?'
		files = append(files, GitDiffFile{
			Path:   filePath,
			Status: strings.TrimSpace(statusCode),
			Staged: staged,
		})
	}

	// 2. Unified diff (diff against HEAD, fallback to plain diff)
	diffCmd := exec.Command("git", "diff", "HEAD")
	diffCmd.Dir = ws.Root
	diffOut, err := diffCmd.Output()
	if err != nil {
		diffCmd = exec.Command("git", "diff")
		diffCmd.Dir = ws.Root
		diffOut, _ = diffCmd.Output()
	}

	return &GitDiffSummary{
		Branch:       branch,
		Clean:        len(files) == 0,
		Files:        files,
		TotalChanges: len(files),
		UnifiedDiff:  string(diffOut),
	}, nil
}

// Commit stages all changes in the workspace and creates an atomic Git commit.
func (m *Manager) Commit(workspaceID, message, author string) (*GitCommitResult, error) {
	if strings.TrimSpace(message) == "" {
		return nil, fmt.Errorf("commit message cannot be empty")
	}

	ws, err := m.GetWorkspace(workspaceID)
	if err != nil {
		return nil, err
	}

	// 1. git add -A
	addCmd := exec.Command("git", "add", "-A")
	addCmd.Dir = ws.Root
	if out, err := addCmd.CombinedOutput(); err != nil {
		return nil, fmt.Errorf("git add failed: %s (%w)", string(out), err)
	}

	// 2. git commit -m
	args := []string{"commit", "-m", message}
	if author != "" {
		args = append(args, fmt.Sprintf("--author=%s", author))
	}
	commitCmd := exec.Command("git", args...)
	commitCmd.Dir = ws.Root
	if out, err := commitCmd.CombinedOutput(); err != nil {
		return nil, fmt.Errorf("git commit failed: %s (%w)", string(out), err)
	}

	// 3. git rev-parse HEAD
	revCmd := exec.Command("git", "rev-parse", "HEAD")
	revCmd.Dir = ws.Root
	revOut, err := revCmd.Output()
	if err != nil {
		return nil, fmt.Errorf("git rev-parse HEAD failed: %w", err)
	}

	branch, _ := m.CurrentBranch(workspaceID)

	return &GitCommitResult{
		CommitHash: strings.TrimSpace(string(revOut)),
		Branch:     branch,
		Message:    message,
	}, nil
}


