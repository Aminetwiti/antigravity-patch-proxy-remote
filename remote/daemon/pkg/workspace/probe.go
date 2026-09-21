package workspace

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

// ProbeWriteAccess vérifie en pré-vol si les identifiants Git (SSH ou PAT) disposent des droits d'écriture sur le dépôt.
// Utilise git push --dry-run pour tester l'accès sans rien commiter ni altérer.
func (m *Manager) ProbeWriteAccess(ctx context.Context, workspaceID string) error {
	ws, err := m.GetWorkspace(workspaceID)
	if err != nil {
		return err
	}

	cmd := exec.CommandContext(ctx, "git", "push", "--dry-run", "origin", "HEAD")
	cmd.Dir = ws.Root
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0", "HUSKY=0", "CI=true")

	out, err := cmd.CombinedOutput()
	outStr := string(out)

	if err != nil {
		lower := strings.ToLower(outStr)
		if strings.Contains(lower, "permission denied") ||
			strings.Contains(lower, "read-only") ||
			strings.Contains(lower, "write access") ||
			strings.Contains(lower, "403") {
			return fmt.Errorf("accès refusé en écriture sur le dépôt distant: vérifiez les droits d'écriture de la clé SSH ou du token sur GitHub/GitLab (%s)", strings.TrimSpace(outStr))
		}
		// Si la branche distante n'a pas d'upstream ou est à jour, dry-run peut renvoyer une info bénigne
		if !strings.Contains(lower, "everything up-to-date") && !strings.Contains(lower, "up to date") {
			// Erreur bénigne de branche upstream absente, on tolère si ce n'est pas un refus d'authentification
			if strings.Contains(lower, "no upstream") || strings.Contains(lower, "fatal: the current branch") {
				return nil
			}
		}
	}

	return nil
}

// KillProcessTree élimine récursivement un processus et tous ses enfants (serveurs Node, Python, etc.)
// pour éliminer les processus zombies et libérer les ports réseau (anti-EADDRINUSE).
func KillProcessTree(cmd *exec.Cmd) error {
	if cmd == nil || cmd.Process == nil {
		return nil
	}

	pid := cmd.Process.Pid
	if pid <= 0 {
		return nil
	}

	killOSProcessTree(pid)
	_ = cmd.Process.Kill()
	return nil
}
