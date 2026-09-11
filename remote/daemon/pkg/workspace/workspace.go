package workspace

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

var (
	ErrWorkspaceNotFound   = fmt.Errorf("workspace not found")
	ErrPathOutsideRoot     = fmt.Errorf("access denied: path outside workspace root")
	ErrSensitiveFileAccess = fmt.Errorf("access denied: sensitive system file is protected")
	ErrTargetNotFound      = fmt.Errorf("target string not found in file")
	ErrFileTooLarge        = fmt.Errorf("file exceeds maximum size limit")
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

	cleanTarget := strings.TrimPrefix(targetPath, "file://")

	var resolved string
	if strings.HasPrefix(cleanTarget, "/") || strings.HasPrefix(cleanTarget, "\\") {
		if runtime.GOOS == "windows" {
			vol := filepath.VolumeName(cleanRoot)
			resolved = filepath.Clean(vol + cleanTarget)
		} else {
			resolved = filepath.Clean(cleanTarget)
		}
	} else if filepath.IsAbs(cleanTarget) {
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

	// Symlink escape guardrail: verify resolved canonical physical path remains within canonical root
	realRoot, errRoot := filepath.EvalSymlinks(cleanRoot)
	if errRoot != nil {
		realRoot = cleanRoot
	}
	realTarget, errTarget := filepath.EvalSymlinks(resolved)
	if errTarget != nil {
		// Target may not exist yet (e.g. WriteFile creating a new file). Walk up to deepest existing ancestor.
		parent := filepath.Dir(resolved)
		for parent != filepath.Dir(parent) {
			if realParent, pErr := filepath.EvalSymlinks(parent); pErr == nil {
				relToParent, _ := filepath.Rel(parent, resolved)
				realTarget = filepath.Join(realParent, relToParent)
				break
			}
			parent = filepath.Dir(parent)
		}
		if realTarget == "" {
			realTarget = resolved
		}
	}

	relReal, errReal := filepath.Rel(realRoot, realTarget)
	if errReal != nil || relReal == ".." || strings.HasPrefix(relReal, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("%w: %s", ErrPathOutsideRoot, targetPath)
	}

	if isProtectedSystemFile(resolved) {
		return "", fmt.Errorf("%w: %s", ErrSensitiveFileAccess, targetPath)
	}

	return resolved, nil
}

func isProtectedSystemFile(name string) bool {
	base := strings.ToLower(filepath.Base(name))
	if base == "runtime.db" || base == "memory.db" ||
		strings.HasPrefix(base, "runtime.db") || strings.HasPrefix(base, "memory.db") {
		return true
	}
	return false
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
	ws, ok := m.workspaces[id]
	if !ok {
		for _, w := range m.workspaces {
			if w.Root == id || filepath.Clean(w.Root) == filepath.Clean(id) {
				ws = w
				ok = true
				break
			}
		}
	}
	m.mu.RUnlock()

	if !ok {
		// Also check if id matches a safe subdirectory under the default workspace
		m.mu.RLock()
		defaultWs := m.workspaces["default"]
		m.mu.RUnlock()
		if defaultWs != nil {
			baseName := filepath.Base(id)
			subPath := filepath.Join(defaultWs.Root, baseName)
			if rel, err := filepath.Rel(defaultWs.Root, subPath); err == nil && !strings.HasPrefix(rel, "..") && rel != "." {
				if fi, err := os.Stat(subPath); err == nil && fi.IsDir() {
					if autoWs, regErr := m.RegisterWorkspace(baseName, baseName, subPath); regErr == nil {
						if id != baseName {
							m.mu.Lock()
							m.workspaces[id] = autoWs
							m.mu.Unlock()
						}
						return autoWs, nil
					}
				}
			}
			subProjPath := filepath.Join(defaultWs.Root, "projects", baseName)
			if rel, err := filepath.Rel(defaultWs.Root, subProjPath); err == nil && !strings.HasPrefix(rel, "..") && rel != "." {
				if fi, err := os.Stat(subProjPath); err == nil && fi.IsDir() {
					if autoWs, regErr := m.RegisterWorkspace(baseName, baseName, subProjPath); regErr == nil {
						if id != baseName {
							m.mu.Lock()
							m.workspaces[id] = autoWs
							m.mu.Unlock()
						}
						return autoWs, nil
					}
				}
			}
		}
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

// GetGitHead returns the current Git HEAD commit hash of the workspace.
func (m *Manager) GetGitHead(workspaceID string) (string, error) {
	ws, err := m.GetWorkspace(workspaceID)
	if err != nil {
		return "", err
	}

	cmd := exec.Command("git", "rev-parse", "HEAD")
	cmd.Dir = ws.Root
	out, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("git rev-parse HEAD failed: %w", err)
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

	if existingWs, err := m.GetWorkspace(newWsID); err == nil {
		return existingWs, nil
	}

	parentDir := filepath.Dir(baseWs.Root)
	worktreeRoot := filepath.Join(parentDir, "worktrees", newWsID)
	if _, err := os.Stat(worktreeRoot); err == nil {
		return m.RegisterWorkspace(newWsID, fmt.Sprintf("%s (%s)", baseWs.Name, branch), worktreeRoot)
	}
	_ = os.MkdirAll(filepath.Dir(worktreeRoot), 0755)

	// Autonomous fetch: refresh origin so worktree is created from latest remote state
	fetchCmd := exec.Command("git", "fetch", "origin", "--quiet")
	fetchCmd.Dir = baseWs.Root
	_ = fetchCmd.Run()

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

// CreateShadowWorktree creates an isolated ephemeral Git worktree for an autonomous agent session.
// It isolates all file modifications and terminal PTY runs from the primary desktop workspace,
// returning the shadow Workspace and a cleanup closure to be deferred by the caller.
func (m *Manager) CreateShadowWorktree(baseWsID, sessionID string) (*Workspace, func(), error) {
	if sessionID == "" {
		return nil, nil, fmt.Errorf("sessionID cannot be empty")
	}
	cleanID := strings.ReplaceAll(sessionID, "-", "_")
	shadowBranch := fmt.Sprintf("agent/shadow_%s", cleanID)
	shadowWsID := fmt.Sprintf("shadow_%s_%s", baseWsID, cleanID)

	ws, err := m.CreateWorktree(baseWsID, shadowBranch, shadowWsID)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to create shadow worktree: %w", err)
	}

	cleanup := func() {
		_ = m.RemoveWorktree(ws.ID)
		// Best effort: delete ephemeral shadow branch
		if baseWs, err := m.GetWorkspace(baseWsID); err == nil {
			cmd := exec.Command("git", "branch", "-D", shadowBranch)
			cmd.Dir = baseWs.Root
			_ = cmd.Run()
		}
	}

	return ws, cleanup, nil
}

// EnsureSessionWorktree guarantees an isolated shadow Git worktree for the session.
// If the base workspace is a Git repository, it creates or returns the dedicated shadow worktree
// on branch agent/shadow_<sessionID>.
// If the base workspace is not a Git repo:
//   1. It checks if there is an active child Git repository registered under this base workspace.
//   2. Fallback: it isolates the session into a dedicated session folder under .antigravity/worktrees/session_<sessionID>.
func (m *Manager) EnsureSessionWorktree(baseWsID, sessionID string) (*Workspace, error) {
	if sessionID == "" {
		return m.GetWorkspace(baseWsID)
	}
	baseWs, err := m.GetWorkspace(baseWsID)
	if err != nil {
		return nil, err
	}

	cleanID := strings.ReplaceAll(sessionID, "-", "_")
	shadowBranch := fmt.Sprintf("agent/shadow_%s", cleanID)
	shadowWsID := fmt.Sprintf("shadow_%s_%s", baseWs.ID, cleanID)

	// If already created/registered in memory, return it directly
	if existingWs, err := m.GetWorkspace(shadowWsID); err == nil {
		return existingWs, nil
	}

	// 1. Try to create the worktree
	ws, err := m.CreateWorktree(baseWs.ID, shadowBranch, shadowWsID)
	if err == nil {
		return ws, nil
	}

	// 2. If baseWs is a container/parent folder without .git, check if it contains child Git workspaces
	m.mu.RLock()
	var childGitWs *Workspace
	for _, w := range m.workspaces {
		if w.ID != baseWs.ID && strings.HasPrefix(w.Root, baseWs.Root+string(filepath.Separator)) {
			gitPath := filepath.Join(w.Root, ".git")
			if fi, sErr := os.Stat(gitPath); sErr == nil && (fi.IsDir() || fi.Mode().IsRegular()) {
				childGitWs = w
				break
			}
		}
	}
	m.mu.RUnlock()

	if childGitWs != nil {
		return m.EnsureSessionWorktree(childGitWs.ID, sessionID)
	}

	// Non-git directory fallback: isolate session into dedicated folder under .antigravity/worktrees/session_<sessionID>
	isolatedDir := filepath.Join(baseWs.Root, ".antigravity", "worktrees", fmt.Sprintf("session_%s", cleanID))
	if err := os.MkdirAll(isolatedDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create isolated session directory: %w", err)
	}
	return m.RegisterWorkspace(shadowWsID, fmt.Sprintf("%s (Session %s)", baseWs.Name, sessionID), isolatedDir)
}

// AutoDiscoverWorkspaces scans the given root directory up to depth 2 looking for child Git repositories.
// Each discovered repository is registered as a workspace named after its directory name.
func (m *Manager) AutoDiscoverWorkspaces(rootDir string) ([]*Workspace, error) {
	cleanRoot, err := filepath.Abs(rootDir)
	if err != nil {
		return nil, fmt.Errorf("invalid root dir: %w", err)
	}

	var discovered []*Workspace

	checkAndRegister := func(dir string) {
		gitPath := filepath.Join(dir, ".git")
		if fi, sErr := os.Stat(gitPath); sErr == nil && (fi.IsDir() || fi.Mode().IsRegular()) {
			name := filepath.Base(dir)
			m.mu.RLock()
			_, exists := m.workspaces[name]
			m.mu.RUnlock()
			if !exists {
				if ws, regErr := m.RegisterWorkspace(name, name, dir); regErr == nil {
					discovered = append(discovered, ws)
				}
			}
		}
	}

	entries, err := os.ReadDir(cleanRoot)
	if err != nil {
		return nil, err
	}

	for _, entry := range entries {
		if !entry.IsDir() || isIgnored(entry.Name()) {
			continue
		}
		childDir := filepath.Join(cleanRoot, entry.Name())
		checkAndRegister(childDir)

		// Also check depth 2 (e.g. root/projects/*, root/workspaces/*)
		if entry.Name() == "projects" || entry.Name() == "workspaces" {
			if subEntries, subErr := os.ReadDir(childDir); subErr == nil {
				for _, subEntry := range subEntries {
					if subEntry.IsDir() && !isIgnored(subEntry.Name()) {
						checkAndRegister(filepath.Join(childDir, subEntry.Name()))
					}
				}
			}
		}
	}

	return discovered, nil
}

// ShadowPromoteResult encapsulates the outcome of merging an ephemeral shadow worktree into the main workspace.
type ShadowPromoteResult struct {
	Success      bool   `json:"success"`
	BaseBranch   string `json:"baseBranch"`
	ShadowBranch string `json:"shadowBranch"`
	CommitHash   string `json:"commitHash"`
	Message      string `json:"message"`
}

// PromoteShadowWorktree commits any pending changes in the shadow worktree, merges its branch back
// into the base workspace, and cleans up the shadow worktree and ephemeral branch.
func (m *Manager) PromoteShadowWorktree(baseWsID, sessionID, commitMsg, author string) (*ShadowPromoteResult, error) {
	if sessionID == "" {
		return nil, fmt.Errorf("sessionID cannot be empty")
	}
	baseWs, err := m.GetWorkspace(baseWsID)
	if err != nil {
		return nil, err
	}

	cleanID := strings.ReplaceAll(sessionID, "-", "_")
	shadowBranch := fmt.Sprintf("agent/shadow_%s", cleanID)
	shadowWsID := fmt.Sprintf("shadow_%s_%s", baseWsID, cleanID)

	baseBranch, _ := m.CurrentBranch(baseWsID)
	if baseBranch == "" {
		baseBranch = "main"
	}

	// 1. If shadow workspace exists and has uncommitted changes, commit them
	shadowWs, err := m.GetWorkspace(shadowWsID)
	if err == nil {
		diff, diffErr := m.Diff(shadowWs.ID)
		if diffErr == nil && !diff.Clean {
			msg := commitMsg
			if msg == "" {
				msg = fmt.Sprintf("Agent changes for session %s", sessionID)
			}
			if _, err := m.Commit(shadowWs.ID, msg, author); err != nil {
				return nil, fmt.Errorf("failed to commit shadow changes: %w", err)
			}
		}
	} else {
		// Attempt to discover worktree directory on disk if not registered in memory
		parentDir := filepath.Dir(baseWs.Root)
		worktreeRoot := filepath.Join(parentDir, "worktrees", shadowWsID)
		if fi, statErr := os.Stat(worktreeRoot); statErr == nil && fi.IsDir() {
			_, _ = m.RegisterWorkspace(shadowWsID, shadowBranch, worktreeRoot)
		}
	}

	// 2. Merge shadow branch into base workspace
	msg := commitMsg
	if msg == "" {
		msg = fmt.Sprintf("Promote shadow worktree (%s)", sessionID)
	}
	mergeCmd := exec.Command("git", "merge", "--no-ff", shadowBranch, "-m", msg)
	mergeCmd.Dir = baseWs.Root
	mergeCmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0", "HUSKY=0", "CI=true")
	if out, err := mergeCmd.CombinedOutput(); err != nil {
		abortCmd := exec.Command("git", "merge", "--abort")
		abortCmd.Dir = baseWs.Root
		_ = abortCmd.Run()
		return &ShadowPromoteResult{
			Success:      false,
			BaseBranch:   baseBranch,
			ShadowBranch: shadowBranch,
			Message:      string(out),
		}, fmt.Errorf("git merge failed: %s (%w)", string(out), err)
	}

	// 3. Obtain new commit hash in base workspace
	revCmd := exec.Command("git", "rev-parse", "HEAD")
	revCmd.Dir = baseWs.Root
	revOut, _ := revCmd.Output()
	newHash := strings.TrimSpace(string(revOut))

	// 4. Remove worktree and ephemeral branch
	_ = m.RemoveWorktree(shadowWsID)
	delCmd := exec.Command("git", "branch", "-D", shadowBranch)
	delCmd.Dir = baseWs.Root
	_ = delCmd.Run()

	return &ShadowPromoteResult{
		Success:      true,
		BaseBranch:   baseBranch,
		ShadowBranch: shadowBranch,
		CommitHash:   newHash,
		Message:      fmt.Sprintf("Successfully promoted %s into %s", shadowBranch, baseBranch),
	}, nil
}

// DiscardShadowWorktree removes the shadow worktree and forcibly deletes its branch without merging.
func (m *Manager) DiscardShadowWorktree(baseWsID, sessionID string) error {
	if sessionID == "" {
		return fmt.Errorf("sessionID cannot be empty")
	}
	baseWs, err := m.GetWorkspace(baseWsID)
	if err != nil {
		return err
	}

	cleanID := strings.ReplaceAll(sessionID, "-", "_")
	shadowBranch := fmt.Sprintf("agent/shadow_%s", cleanID)
	shadowWsID := fmt.Sprintf("shadow_%s_%s", baseWsID, cleanID)

	_ = m.RemoveWorktree(shadowWsID)

	delCmd := exec.Command("git", "branch", "-D", shadowBranch)
	delCmd.Dir = baseWs.Root
	_ = delCmd.Run()

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

	// 2. git commit --no-verify -m
	args := []string{"commit", "--no-verify", "-m", message}
	if author != "" {
		args = append(args, fmt.Sprintf("--author=%s", author))
	}
	commitCmd := exec.Command("git", args...)
	commitCmd.Dir = ws.Root
	// ponytail: inject fallback identity and non-interactive flags so git commit succeeds in bare Docker containers
	commitCmd.Env = append(os.Environ(),
		"GIT_TERMINAL_PROMPT=0",
		"HUSKY=0",
		"CI=true",
		"GIT_AUTHOR_NAME=Antigravity Agent",
		"GIT_AUTHOR_EMAIL=agent@antigravity.internal",
		"GIT_COMMITTER_NAME=Antigravity Agent",
		"GIT_COMMITTER_EMAIL=agent@antigravity.internal",
	)
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

type GitSyncResult struct {
	Branch  string `json:"branch"`
	Message string `json:"message"`
	Success bool   `json:"success"`
}

// Pull fetches and integrates remote changes for the specified branch.
func (m *Manager) Pull(workspaceID, remote, branch string) (*GitSyncResult, error) {
	ws, err := m.GetWorkspace(workspaceID)
	if err != nil {
		return nil, err
	}
	if remote == "" {
		remote = "origin"
	}
	currentBranch, _ := m.CurrentBranch(workspaceID)
	if branch == "" {
		branch = currentBranch
	}
	if branch == "" {
		branch = "main"
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "git", "pull", remote, branch)
	cmd.Dir = ws.Root
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return &GitSyncResult{
			Branch:  branch,
			Message: string(out),
			Success: false,
		}, fmt.Errorf("git pull failed: %s (%w)", string(out), err)
	}

	return &GitSyncResult{
		Branch:  branch,
		Message: strings.TrimSpace(string(out)),
		Success: true,
	}, nil
}

// DetectStaleBase checks whether the given workspace's current commit differs from the baseCommit
// that was recorded when the session was created.
// Returns isStale (true if different), currentCommit, and any error encountered.
func (m *Manager) DetectStaleBase(workspaceID, baseCommit string) (bool, string, error) {
	ws, err := m.GetWorkspace(workspaceID)
	if err != nil {
		return false, "", err
	}
	cleanBase := strings.TrimSpace(baseCommit)
	if cleanBase == "" {
		return false, "", nil
	}

	cmdHead := exec.Command("git", "rev-parse", "HEAD")
	cmdHead.Dir = ws.Root
	cmdHead.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	outHead, err := cmdHead.Output()
	if err != nil {
		return false, "", fmt.Errorf("git rev-parse HEAD failed: %w", err)
	}
	currentSHA := strings.TrimSpace(string(outHead))

	cmdBase := exec.Command("git", "rev-parse", cleanBase)
	cmdBase.Dir = ws.Root
	cmdBase.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	outBase, err := cmdBase.Output()
	if err != nil {
		// If baseCommit cannot be resolved by git rev-parse, compare string prefix
		return !strings.HasPrefix(currentSHA, cleanBase), currentSHA, nil
	}
	baseSHA := strings.TrimSpace(string(outBase))

	return currentSHA != baseSHA, currentSHA, nil
}

// Push exports committed changes to the specified remote repository branch.
// If expectedBaseCommit is provided, it validates that the branch has not diverged before pushing.
func (m *Manager) Push(workspaceID, remote, branch string, expectedBaseCommit ...string) (*GitSyncResult, error) {
	ws, err := m.GetWorkspace(workspaceID)
	if err != nil {
		return nil, err
	}
	if remote == "" {
		remote = "origin"
	}
	currentBranch, _ := m.CurrentBranch(workspaceID)
	if branch == "" {
		branch = currentBranch
	}
	if branch == "" {
		branch = "main"
	}

	if len(expectedBaseCommit) > 0 && expectedBaseCommit[0] != "" {
		stale, cur, err := m.DetectStaleBase(workspaceID, expectedBaseCommit[0])
		if err != nil {
			return nil, fmt.Errorf("failed to verify base commit before push: %w", err)
		}
		if stale {
			return &GitSyncResult{
				Branch:  branch,
				Message: fmt.Sprintf("stale base detected: current %s != expected %s", cur, expectedBaseCommit[0]),
				Success: false,
			}, fmt.Errorf("stale base detected: current commit %s diverged from expected %s", cur, expectedBaseCommit[0])
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "git", "push", remote, branch)
	cmd.Dir = ws.Root
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return &GitSyncResult{
			Branch:  branch,
			Message: string(out),
			Success: false,
		}, fmt.Errorf("git push failed: %s (%w)", string(out), err)
	}

	return &GitSyncResult{
		Branch:  branch,
		Message: strings.TrimSpace(string(out)),
		Success: true,
	}, nil
}

// PruneWorktrees scans the worktrees directory and purges stale ephemeral worktrees older than maxAge.
// It prevents disk bloat on the VPS.
func (m *Manager) PruneWorktrees(baseDir string, maxAge time.Duration) (int, error) {
	if baseDir == "" {
		baseDir = os.Getenv("WORKSPACE_ROOT")
		if baseDir == "" {
			baseDir = "/var/lib/antigravity"
		}
	}
	worktreesDir := filepath.Join(baseDir, "worktrees")
	entries, err := os.ReadDir(worktreesDir)
	if err != nil {
		if os.IsNotExist(err) {
			return 0, nil
		}
		return 0, err
	}

	if maxAge <= 0 {
		maxAge = 48 * time.Hour
	}

	prunedCount := 0
	now := time.Now()

	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		wtPath := filepath.Join(worktreesDir, e.Name())
		info, errInfo := os.Stat(wtPath)
		if errInfo != nil {
			continue
		}

		if now.Sub(info.ModTime()) > maxAge {
			_ = exec.Command("git", "worktree", "remove", "--force", wtPath).Run()
			_ = os.RemoveAll(wtPath)
			m.mu.Lock()
			delete(m.workspaces, e.Name())
			m.mu.Unlock()
			prunedCount++
		}
	}

	for _, ws := range m.ListWorkspaces() {
		_ = exec.Command("git", "-C", ws.Root, "worktree", "prune").Run()
	}

	return prunedCount, nil
}

// SyncEnv writes environment secrets (.env file) atomically to the target workspace root.
func (m *Manager) SyncEnv(workspaceID, envContent string) error {
	if envContent == "" {
		return fmt.Errorf("envContent cannot be empty")
	}
	return m.WriteFile(workspaceID, ".env", []byte(envContent))
}

// SessionLineageInfo records the exact Git provenance at the moment the session was created.
type SessionLineageInfo struct {
	BaseCommit    string `json:"baseCommit"`
	BaseBranch    string `json:"baseBranch"`
	OriginCommit  string `json:"originCommit,omitempty"`
	SessionBranch string `json:"sessionBranch,omitempty"`
}

// RecordSessionLineage captures baseCommit, baseBranch and origin HEAD for session lineage.
func (m *Manager) RecordSessionLineage(workspaceID string) (*SessionLineageInfo, error) {
	ws, err := m.GetWorkspace(workspaceID)
	if err != nil {
		return nil, err
	}
	branch, _ := m.CurrentBranch(workspaceID)
	if branch == "" {
		branch = "main"
	}
	cmdHead := exec.Command("git", "rev-parse", "HEAD")
	cmdHead.Dir = ws.Root
	cmdHead.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	outHead, err := cmdHead.Output()
	if err != nil {
		return nil, err
	}
	baseCommit := strings.TrimSpace(string(outHead))

	originCommit := ""
	cmdOrigin := exec.Command("git", "rev-parse", fmt.Sprintf("origin/%s", branch))
	cmdOrigin.Dir = ws.Root
	cmdOrigin.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	if outOrigin, err := cmdOrigin.Output(); err == nil {
		originCommit = strings.TrimSpace(string(outOrigin))
	}

	return &SessionLineageInfo{
		BaseCommit:   baseCommit,
		BaseBranch:   branch,
		OriginCommit: originCommit,
	}, nil
}

// SyncPreflightResult details the safety analysis of synchronizing a workspace before touching files.
type SyncPreflightResult struct {
	CanSync      bool   `json:"canSync"`
	Strategy     string `json:"strategy"` // "up_to_date", "fast_forward", "blocked_dirty_local", "blocked_diverged", "blocked_remote_missing"
	LocalClean   bool   `json:"localClean"`
	LocalCommit  string `json:"localCommit"`
	RemoteCommit string `json:"remoteCommit"`
	Branch       string `json:"branch"`
	Uncommitted  int    `json:"uncommittedCount"`
	Reason       string `json:"reason"`
}

// PreflightSync checks all safety guardrails before synchronizing local workspace with remote repository.
// Zero friction != zero guardrails:
// - If local has uncommitted edits -> blocks sync to prevent data loss
// - If local and remote have diverged -> blocks automatic sync to prevent unwanted merge conflicts
// - If remote is ahead and local is clean -> authorizes safe fast-forward sync
func (m *Manager) PreflightSync(workspaceID, remote, branch string) (*SyncPreflightResult, error) {
	ws, err := m.GetWorkspace(workspaceID)
	if err != nil {
		return nil, err
	}
	if remote == "" {
		remote = "origin"
	}
	if branch == "" {
		branch, _ = m.CurrentBranch(workspaceID)
	}
	if branch == "" {
		branch = "main"
	}

	// 1. Check local working tree dirtiness
	diff, err := m.Diff(workspaceID)
	if err != nil {
		return nil, fmt.Errorf("preflight diff failed: %w", err)
	}
	localClean := diff.Clean
	uncommitted := diff.TotalChanges

	if !localClean {
		return &SyncPreflightResult{
			CanSync:     false,
			Strategy:    "blocked_dirty_local",
			LocalClean:  false,
			Branch:      branch,
			Uncommitted: uncommitted,
			Reason:      fmt.Sprintf("Local workspace has %d uncommitted modifications. Commit or stash your changes before synchronizing to prevent data loss.", uncommitted),
		}, nil
	}

	// 2. Fetch remote silently without altering working tree
	ctxFetch, cancelFetch := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancelFetch()
	fetchCmd := exec.CommandContext(ctxFetch, "git", "fetch", remote, branch)
	fetchCmd.Dir = ws.Root
	fetchCmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	_ = fetchCmd.Run()

	// 3. Resolve local HEAD commit
	cmdLocal := exec.Command("git", "rev-parse", "HEAD")
	cmdLocal.Dir = ws.Root
	cmdLocal.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	outLocal, err := cmdLocal.Output()
	if err != nil {
		return nil, fmt.Errorf("git rev-parse HEAD failed: %w", err)
	}
	localCommit := strings.TrimSpace(string(outLocal))

	// 4. Resolve remote HEAD commit
	remoteRef := fmt.Sprintf("%s/%s", remote, branch)
	cmdRemote := exec.Command("git", "rev-parse", remoteRef)
	cmdRemote.Dir = ws.Root
	cmdRemote.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	outRemote, err := cmdRemote.Output()
	if err != nil {
		return &SyncPreflightResult{
			CanSync:     false,
			Strategy:    "blocked_remote_missing",
			LocalClean:  true,
			LocalCommit: localCommit,
			Branch:      branch,
			Reason:      fmt.Sprintf("Remote tracking branch %s not found on remote %s", remoteRef, remote),
		}, nil
	}
	remoteCommit := strings.TrimSpace(string(outRemote))

	if localCommit == remoteCommit {
		return &SyncPreflightResult{
			CanSync:      true,
			Strategy:     "up_to_date",
			LocalClean:   true,
			LocalCommit:  localCommit,
			RemoteCommit: remoteCommit,
			Branch:       branch,
			Reason:       "Local workspace is already up to date with remote repository.",
		}, nil
	}

	// 5. Check merge base to see if fast-forward is possible
	cmdBase := exec.Command("git", "merge-base", localCommit, remoteCommit)
	cmdBase.Dir = ws.Root
	cmdBase.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	outBase, err := cmdBase.Output()
	if err != nil {
		return nil, fmt.Errorf("git merge-base failed: %w", err)
	}
	mergeBase := strings.TrimSpace(string(outBase))

	if mergeBase == localCommit {
		return &SyncPreflightResult{
			CanSync:      true,
			Strategy:     "fast_forward",
			LocalClean:   true,
			LocalCommit:  localCommit,
			RemoteCommit: remoteCommit,
			Branch:       branch,
			Reason:       "Remote contains new commits ahead of local. Fast-forward is safe.",
		}, nil
	}

	if mergeBase == remoteCommit {
		return &SyncPreflightResult{
			CanSync:      false,
			Strategy:     "local_ahead",
			LocalClean:   true,
			LocalCommit:  localCommit,
			RemoteCommit: remoteCommit,
			Branch:       branch,
			Reason:       "Local workspace is ahead of remote branch. Nothing to pull.",
		}, nil
	}

	return &SyncPreflightResult{
		CanSync:      false,
		Strategy:     "blocked_diverged",
		LocalClean:   true,
		LocalCommit:  localCommit,
		RemoteCommit: remoteCommit,
		Branch:       branch,
		Reason:       "Local and remote histories have diverged. Manual rebase or merge resolution is required to avoid accidental conflicts.",
	}, nil
}

// SafeSync performs synchronization only after validating all safety guardrails.
func (m *Manager) SafeSync(workspaceID, remote, branch string) (*GitSyncResult, error) {
	preflight, err := m.PreflightSync(workspaceID, remote, branch)
	if err != nil {
		return nil, err
	}
	if !preflight.CanSync {
		return &GitSyncResult{
			Branch:  preflight.Branch,
			Message: preflight.Reason,
			Success: false,
		}, fmt.Errorf("sync aborted by guardrail (%s): %s", preflight.Strategy, preflight.Reason)
	}

	if preflight.Strategy == "up_to_date" {
		return &GitSyncResult{
			Branch:  preflight.Branch,
			Message: "Already up to date",
			Success: true,
		}, nil
	}

	ws, err := m.GetWorkspace(workspaceID)
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", "merge", "--ff-only", fmt.Sprintf("%s/%s", remote, preflight.Branch))
	cmd.Dir = ws.Root
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return &GitSyncResult{
			Branch:  preflight.Branch,
			Message: string(out),
			Success: false,
		}, fmt.Errorf("fast-forward sync failed: %s (%w)", string(out), err)
	}

	return &GitSyncResult{
		Branch:  preflight.Branch,
		Message: strings.TrimSpace(string(out)),
		Success: true,
	}, nil
}


