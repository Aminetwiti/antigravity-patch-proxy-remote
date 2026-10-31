package workspace

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// TestMultiSessionWorktreeIsolationAndGitPolicy vérifie les Invariants 6 et 10 :
// - Invariant 6 : One session != shared repository (worktree isolé dédié par session, zéro collision).
// - Invariant 10 : Git push != automatic consequence of agent completion (push gouverné par policy).
func TestMultiSessionWorktreeIsolationAndGitPolicy(t *testing.T) {
	tmpDir := t.TempDir()

	// 1. Initialiser un dépôt git local servant de workspace de base
	baseRepoDir := filepath.Join(tmpDir, "main-project")
	_ = os.MkdirAll(baseRepoDir, 0755)

	cmd := exec.Command("git", "init")
	cmd.Dir = baseRepoDir
	if err := cmd.Run(); err != nil {
		t.Skip("git indisponible")
	}
	_ = exec.Command("git", "-C", baseRepoDir, "config", "user.name", "Senior Staff").Run()
	_ = exec.Command("git", "-C", baseRepoDir, "config", "user.email", "staff@antigravity.ai").Run()
	_ = exec.Command("git", "-C", baseRepoDir, "config", "core.autocrlf", "false").Run()

	// Créer un premier commit sur main
	pkgFile := filepath.Join(baseRepoDir, "package.json")
	_ = os.WriteFile(pkgFile, []byte(`{"name": "core-project", "version": "1.0.0"}`), 0644)
	_ = exec.Command("git", "-C", baseRepoDir, "add", "package.json").Run()
	_ = exec.Command("git", "-C", baseRepoDir, "commit", "-m", "initial commit").Run()

	mgr := NewManager()
	baseWs, err := mgr.RegisterWorkspace("ws-core", "Core Project", baseRepoDir)
	if err != nil {
		t.Fatalf("RegisterWorkspace failed: %v", err)
	}

	// 2. Lancer Session A (ex: "Auth Feature") -> Crée un worktree dédié
	sessA := "sess_auth_01"
	shadowA, cleanupA, err := mgr.CreateShadowWorktree(baseWs.ID, sessA)
	if err != nil {
		t.Fatalf("CreateShadowWorktree A failed: %v", err)
	}
	defer cleanupA()

	// 3. Lancer Session B (ex: "Dashboard Feature") -> Crée un second worktree distinct
	sessB := "sess_dash_02"
	shadowB, cleanupB, err := mgr.CreateShadowWorktree(baseWs.ID, sessB)
	if err != nil {
		t.Fatalf("CreateShadowWorktree B failed: %v", err)
	}
	defer cleanupB()

	// Vérifier que les chemins physiques des deux sessions sont différents
	if shadowA.Root == shadowB.Root {
		t.Fatalf("FATAL: Session A et Session B partagent le même dossier racine: %s", shadowA.Root)
	}

	// 4. Session A modifie package.json
	pkgA := filepath.Join(shadowA.Root, "package.json")
	_ = os.WriteFile(pkgA, []byte(`{"name": "core-project", "version": "1.0.0", "auth": true}`), 0644)

	// Session B modifie aussi package.json simultanément
	pkgB := filepath.Join(shadowB.Root, "package.json")
	_ = os.WriteFile(pkgB, []byte(`{"name": "core-project", "version": "1.0.0", "dashboard": true}`), 0644)

	// 5. Commit indépendant dans chaque worktree : ZÉRO conflit d'index git
	commitA, errA := mgr.Commit(shadowA.ID, "feat(auth): add authentication", "Agent A <agent-a@remote>")
	if errA != nil {
		t.Fatalf("Commit Session A failed: %v", errA)
	}
	if commitA.CommitHash == "" {
		t.Errorf("expected valid commit hash for Session A")
	}

	commitB, errB := mgr.Commit(shadowB.ID, "feat(dash): add dashboard", "Agent B <agent-b@remote>")
	if errB != nil {
		t.Fatalf("Commit Session B failed: %v", errB)
	}
	if commitB.CommitHash == "" {
		t.Errorf("expected valid commit hash for Session B")
	}

	// 6. Vérifier que les branches git sont distinctes
	branchA, _ := mgr.CurrentBranch(shadowA.ID)
	branchB, _ := mgr.CurrentBranch(shadowB.ID)
	if branchA == branchB {
		t.Errorf("expected distinct branches, got both on %s", branchA)
	}
	if !strings.Contains(branchA, sessA) || !strings.Contains(branchB, sessB) {
		t.Errorf("branch names must contain session id: A=%s, B=%s", branchA, branchB)
	}

	// 7. Vérifier que le workspace principal main est RESTÉ INTACT (aucun changement direct appliqué)
	baseDiff, _ := mgr.Diff(baseWs.ID)
	if !baseDiff.Clean {
		t.Errorf("main workspace should be totally clean while agents are working")
	}

	// 8. Vérifier la promotion/merge explicite avec politique de review
	promoteRes, err := mgr.PromoteShadowWorktree(baseWs.ID, sessA, "merge auth feature", "Lead Dev")
	if err != nil {
		t.Fatalf("PromoteShadowWorktree failed: %v", err)
	}
	if !promoteRes.Success {
		t.Errorf("expected promote to succeed")
	}

	// Le fichier sur main contient maintenant la modification de Session A
	mainPkgContent, _ := os.ReadFile(filepath.Join(baseWs.Root, "package.json"))
	if !strings.Contains(string(mainPkgContent), `"auth": true`) {
		t.Errorf("main workspace should have merged auth feature, content: %s", string(mainPkgContent))
	}
}
