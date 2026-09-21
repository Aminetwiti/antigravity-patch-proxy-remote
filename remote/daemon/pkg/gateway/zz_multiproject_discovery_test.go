package gateway

import (
	"os"
	"path/filepath"
	"testing"
)

func TestMultiProjectAutoDiscovery_CloudVPS(t *testing.T) {
	// 1. Créer une racine temporaire simulant /var/lib/antigravity/projects
	tmpRoot := t.TempDir()
	projectsDir := filepath.Join(tmpRoot, "projects")
	_ = os.MkdirAll(projectsDir, 0755)

	// Simuler 3 projets VPS distincts
	dummyProjects := []string{"vps_structuba_core", "vps_omniroute_api", "vps_posw_backend"}
	for _, p := range dummyProjects {
		pDir := filepath.Join(projectsDir, p)
		if err := os.MkdirAll(pDir, 0755); err != nil {
			t.Fatalf("failed to create dummy project %s: %v", p, err)
		}
		_ = os.WriteFile(filepath.Join(pDir, "README.md"), []byte("# "+p), 0644)
	}

	// 2. Définir WORKSPACE_ROOT vers notre dossier simulé
	t.Setenv("WORKSPACE_ROOT", projectsDir)

	// 3. Tester listWorkspaces()
	workspaces := listWorkspaces()

	foundCount := 0
	for _, ws := range workspaces {
		name, _ := ws["name"].(string)
		source, _ := ws["source"].(string)
		for _, target := range dummyProjects {
			if name == target {
				foundCount++
				if source != "workspace_root" {
					t.Errorf("expected source 'workspace_root' for %s, got %s", target, source)
				}
			}
		}
	}

	if foundCount != len(dummyProjects) {
		t.Fatalf("expected to discover %d projects, but found %d. All workspaces: %+v", len(dummyProjects), foundCount, workspaces)
	}

	// 4. Tester la politique de confinement isPathInsideAllowedWorkspaces
	testPath := filepath.Join(projectsDir, "vps_structuba_core", "src", "main.go")
	if !isPathInsideAllowedWorkspaces(testPath) {
		t.Errorf("expected path %s to be allowed inside WORKSPACE_ROOT, but was rejected", testPath)
	}

	outsidePath := "C:\\Windows\\System32\\drivers\\etc\\hosts"
	if isPathInsideAllowedWorkspaces(outsidePath) {
		t.Errorf("expected path outside WORKSPACE_ROOT to be rejected, but was allowed: %s", outsidePath)
	}
}
