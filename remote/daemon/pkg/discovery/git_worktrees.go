package discovery

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
)

type GitWorktree struct {
	Path   string `json:"path"`
	Head   string `json:"head"`
	Branch string `json:"branch"`
	Bare   bool   `json:"bare"`
}

// gitCmd exécute git dans un workspace validé.
func gitCmd(workspacePath string, args ...string) ([]byte, error) {
	if workspacePath == "" {
		return nil, fmt.Errorf("chemin de workspace vide")
	}
	if fi, err := os.Stat(workspacePath); err != nil || !fi.IsDir() {
		return nil, fmt.Errorf("workspace introuvable ou invalide: %s", workspacePath)
	}
	cmdArgs := append([]string{"-c", "safe.directory=*", "--no-pager"}, args...)
	cmd := exec.Command("git", cmdArgs...)
	cmd.Dir = workspacePath
	return cmd.Output()
}

// ListGitBranches liste les branches d'un workspace git.
func ListGitBranches(workspacePath string) ([]string, error) {
	out, err := gitCmd(workspacePath, "branch", "-a", "--format=%(refname:short)")
	if err != nil {
		return nil, err
	}

	lines := strings.Split(string(out), "\n")
	var branches []string
	seen := make(map[string]bool)
	for _, l := range lines {
		trimmed := strings.TrimSpace(l)
		if trimmed != "" && !seen[trimmed] {
			seen[trimmed] = true
			branches = append(branches, trimmed)
		}
	}
	return branches, nil
}

// ListGitWorktrees liste les worktrees associés à un dépôt git (format --porcelain).
func ListGitWorktrees(workspacePath string) ([]GitWorktree, error) {
	out, err := gitCmd(workspacePath, "worktree", "list", "--porcelain")
	if err != nil {
		return nil, err
	}

	var worktrees []GitWorktree
	blocks := strings.Split(strings.ReplaceAll(string(out), "\r\n", "\n"), "\n\n")
	for _, b := range blocks {
		lines := strings.Split(b, "\n")
		var wt GitWorktree
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if strings.HasPrefix(line, "worktree ") {
				wt.Path = strings.TrimPrefix(line, "worktree ")
			} else if strings.HasPrefix(line, "HEAD ") {
				wt.Head = strings.TrimPrefix(line, "HEAD ")
			} else if strings.HasPrefix(line, "branch ") {
				wt.Branch = strings.TrimPrefix(line, "branch ")
			} else if line == "bare" {
				wt.Bare = true
			}
		}
		if wt.Path != "" {
			worktrees = append(worktrees, wt)
		}
	}
	return worktrees, nil
}

// ListGitChanges extrait les fichiers modifiés dans le workspace via `git status --porcelain`.
func ListGitChanges(workspacePath string) (workingDir []string, staged []string, err error) {
	out, err := gitCmd(workspacePath, "status", "--porcelain")
	if err != nil {
		return nil, nil, err
	}
	lines := strings.Split(strings.ReplaceAll(string(out), "\r\n", "\n"), "\n")
	for _, l := range lines {
		if len(l) < 4 {
			continue
		}
		indexStatus := l[0]
		workTreeStatus := l[1]
		filePath := strings.TrimSpace(l[3:])
		// Handle rename format: orig -> new
		if parts := strings.Split(filePath, " -> "); len(parts) == 2 {
			filePath = parts[1]
		}
		if indexStatus == 'M' || indexStatus == 'A' || indexStatus == 'D' || indexStatus == 'R' || indexStatus == 'C' {
			staged = append(staged, filePath)
		}
		if workTreeStatus == 'M' || workTreeStatus == 'D' || workTreeStatus == '?' || workTreeStatus == 'U' || l[:2] == "??" {
			workingDir = append(workingDir, filePath)
		}
	}
	return workingDir, staged, nil
}

