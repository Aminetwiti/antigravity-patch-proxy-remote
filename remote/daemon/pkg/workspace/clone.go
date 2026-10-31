package workspace

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// GitCloneOptions définit les paramètres de clonnage d'un dépôt distant.
type GitCloneOptions struct {
	RepoURL     string `json:"repoUrl"`               // Ex: https://github.com/org/repo.git
	Branch      string `json:"branch,omitempty"`      // Branche source (défaut: main/master)
	AuthToken   string `json:"authToken,omitempty"`   // PAT GitHub/GitLab pour dépôts privés
	TargetDir   string `json:"targetDir,omitempty"`   // Dossier cible sur /data/workspaces
	WorkspaceID string `json:"workspaceId,omitempty"` // ID unique de session / workspace
	Depth       int    `json:"depth,omitempty"`       // Profondeur de clonnage (ex: 1 pour shallow clone)
}

// GitCloneResult contient le résultat de l'initialisation du workspace distant.
type GitCloneResult struct {
	WorkspaceID string `json:"workspaceId"`
	Root        string `json:"root"`
	Branch      string `json:"branch"`
	CommitHash  string `json:"commitHash"`
	Message     string `json:"message"`
	Success     bool   `json:"success"`
	WriteAccess bool   `json:"writeAccess"`
}

// FormatAuthenticatedURL injecte le jeton d'authentification dans l'URL HTTPS de manière sécurisée.
func FormatAuthenticatedURL(rawURL, token string) (string, error) {
	if token == "" || (!strings.HasPrefix(rawURL, "https://") && !strings.HasPrefix(rawURL, "http://")) {
		return rawURL, nil // Seules les URLs HTTP/HTTPS sont enrichies du jeton
	}

	u, err := url.Parse(rawURL)
	if err != nil {
		return "", fmt.Errorf("invalid repository URL: %w", err)
	}

	// Formatage d'authentification pour GitHub/GitLab : x-access-token:<token>@host
	u.User = url.UserPassword("x-access-token", token)
	return u.String(), nil
}

// Clone clone un dépôt distant, prépare une branche de travail isolée et enregistre le workspace.
func (m *Manager) Clone(ctx context.Context, opts GitCloneOptions) (*GitCloneResult, error) {
	if opts.RepoURL == "" {
		return nil, fmt.Errorf("repoUrl is required")
	}

	wsID := opts.WorkspaceID
	if wsID == "" {
		// ponytail: ID dérivé du nom du dépôt et de l'horodatage si non fourni
		repoName := filepath.Base(strings.TrimSuffix(opts.RepoURL, ".git"))
		wsID = fmt.Sprintf("%s-%d", repoName, time.Now().Unix())
	}

	targetPath := opts.TargetDir
	if targetPath == "" {
		baseDir := os.Getenv("WORKSPACE_ROOT")
		if baseDir == "" {
			if fi, err := os.Stat("/var/lib/antigravity/projects"); err == nil && fi.IsDir() {
				baseDir = "/var/lib/antigravity/projects"
			}
		}
		if baseDir == "" {
			baseDir = os.Getenv("DATA_DIR")
		}
		if baseDir == "" {
			baseDir = os.TempDir()
		}
		targetPath = filepath.Join(baseDir, wsID)
	}

	cleanTarget, err := filepath.Abs(targetPath)
	if err != nil {
		return nil, fmt.Errorf("invalid target path: %w", err)
	}

	// 1. Assurance que le dossier conteneur parent existe
	if err := os.MkdirAll(filepath.Dir(cleanTarget), 0755); err != nil {
		return nil, fmt.Errorf("failed to create base workspace dir: %w", err)
	}

	token := opts.AuthToken
	if token == "" {
		token = os.Getenv("GITHUB_TOKEN")
		if token == "" {
			token = os.Getenv("GIT_AUTH_TOKEN")
		}
	}

	authURL, err := FormatAuthenticatedURL(opts.RepoURL, token)
	if err != nil {
		return nil, err
	}

	args := []string{"clone"}
	if opts.Depth > 0 {
		args = append(args, "--depth", fmt.Sprintf("%d", opts.Depth))
	}
	if opts.Branch != "" {
		args = append(args, "-b", opts.Branch)
	}
	args = append(args, authURL, cleanTarget)

	cmd := exec.CommandContext(ctx, "git", args...)
	// Masquage du jeton dans les variables d'environnement de commande
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")

	out, err := cmd.CombinedOutput()
	if err != nil {
		// Masquage du token dans les messages d'erreur de logs
		safeErr := string(out)
		if opts.AuthToken != "" {
			safeErr = strings.ReplaceAll(safeErr, opts.AuthToken, "***")
		}
		return &GitCloneResult{
			WorkspaceID: wsID,
			Root:        cleanTarget,
			Success:     false,
			Message:     safeErr,
		}, fmt.Errorf("git clone failed: %s (%w)", safeErr, err)
	}

	// 2. Enregistrement du workspace dans le gestionnaire actif
	repoName := filepath.Base(cleanTarget)
	ws, err := m.RegisterWorkspace(wsID, repoName, cleanTarget)
	if err != nil {
		return nil, fmt.Errorf("failed to register cloned workspace: %w", err)
	}

	// 3. Récupération du CommitHash initial
	revCmd := exec.CommandContext(ctx, "git", "rev-parse", "HEAD")
	revCmd.Dir = ws.Root
	commitOut, _ := revCmd.Output()
	commitHash := strings.TrimSpace(string(commitOut))

	currentBranch, _ := m.CurrentBranch(wsID)
	if currentBranch == "" {
		currentBranch = opts.Branch
	}
	if currentBranch == "" {
		currentBranch = "main"
	}

	// 4. Test d'écriture pré-vol (non bloquant)
	writeAccess := true
	probeCtx, probeCancel := context.WithTimeout(ctx, 3*time.Second)
	defer probeCancel()
	if errProbe := m.ProbeWriteAccess(probeCtx, wsID); errProbe != nil {
		writeAccess = false
	}

	return &GitCloneResult{
		WorkspaceID: wsID,
		Root:        ws.Root,
		Branch:      currentBranch,
		CommitHash:  commitHash,
		Message:     "Repository cloned and registered successfully",
		Success:     true,
		WriteAccess: writeAccess,
	}, nil
}
