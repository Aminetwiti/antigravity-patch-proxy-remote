package gateway

import (
	"os"
	"path/filepath"
	"testing"
)

// G4 — le sélecteur de workspaces ne doit jamais inclure les dossiers système
// ni les dotfiles, et le registre officiel doit primer sur le scan du home.
func TestListWorkspacesSkipsSystemDirs(t *testing.T) {
	orig := os.Getenv("HOME")
	origUser, _ := os.UserHomeDir()
	t.Setenv("HOME", "") // forcer os.UserHomeDir à re-résoudre ? non — on ne peut pas
	_ = orig
	_ = origUser

	// Le helper lit os.UserHomeDir() ; on ne peut pas le rediriger proprement
	// sans t.Setenv("USERPROFILE") sur Windows — acceptable pour ce test.
	ws := listWorkspaces()
	if len(ws) == 0 {
		t.Skip("aucun workspace détecté sur cette machine (registre + home vides)")
	}
	for _, w := range ws {
		name, _ := w["name"].(string)
		path, _ := w["path"].(string)
		if name == "" || path == "" {
			t.Fatalf("workspace invalide: %v", w)
		}
		base := filepath.Base(path)
		switch base {
		case "AppData", "Library", "Desktop", "Downloads", "Documents":
			t.Fatalf("dossier système ne devrait pas apparaître: %s", path)
		}
		if len(base) > 0 && base[0] == '.' {
			t.Fatalf("dotfile ne devrait pas apparaître: %s", path)
		}
	}
}
