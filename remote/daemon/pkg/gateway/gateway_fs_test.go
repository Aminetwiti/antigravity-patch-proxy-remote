package gateway

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestResolvePath(t *testing.T) {
	root := t.TempDir()
	sub := filepath.Join(root, "sub")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name      string
		requested string
		wantErr   bool
	}{
		{"relatif simple", "sub/file.txt", false},
		{"absolu sous racine", filepath.Join(sub, "file.txt"), false},
		{"point", ".", false},
		{"traversee simple", "../etc/passwd", true},
		{"traversee imbriquee", "sub/../../etc/passwd", true},
		{"absolu hors racine", filepath.Join(root, "..", "hors"), true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := resolvePath(root, tt.requested)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("resolvePath(%q) = %q, attendu une erreur", tt.requested, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("resolvePath(%q) inattendu: %v", tt.requested, err)
			}
			rel, relErr := filepath.Rel(root, got)
			if relErr != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
				t.Fatalf("resolvePath(%q) = %q sort de la racine (rel=%q)", tt.requested, got, rel)
			}
		})
	}
}

// TestResolvePathSymlinkEscape : un symlink dans le workspace pointant vers
// un répertoire parent ne doit pas permettre de lire hors racine.
func TestResolvePathSymlinkEscape(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("création de symlink nécessite des privilèges admin sur Windows")
	}

	root := t.TempDir()
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "secret.txt"), []byte("secret"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "link")); err != nil {
		t.Skipf("symlink non disponible: %v", err)
	}

	// Le symlink lui-même est ignoré par buildFileTree (Lstat), mais resolvePath
	// ne doit pas non plus autoriser un chemin qui traverse le lien.
	got, err := resolvePath(root, filepath.Join("link", "secret.txt"))
	if err == nil {
		t.Fatalf("resolvePath à travers un symlink = %q, attendu refus", got)
	}
}

func TestBuildFileTreeDepthAndSymlink(t *testing.T) {
	root := t.TempDir()
	for i := 0; i < maxTreeDepth+3; i++ {
		root = filepath.Join(root, "d"+string(rune('a'+i%26)))
		if err := os.MkdirAll(root, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(root, "leaf.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	tree, err := buildFileTree(t.TempDir(), "", 0)
	if err != nil {
		t.Fatalf("buildFileTree: %v", err)
	}
	_ = tree

	// La profondeur max doit stopper la descente : construire un arbre réel de
	// profondeur maxTreeDepth+2 et vérifier qu'aucune entrée n'a depth > maxTreeDepth.
	deepRoot := t.TempDir()
	cur := deepRoot
	for i := 0; i <= maxTreeDepth+1; i++ {
		cur = filepath.Join(cur, "sub")
		if err := os.MkdirAll(cur, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	deepTree, err := buildFileTree(deepRoot, "", 0)
	if err != nil {
		t.Fatalf("buildFileTree profond: %v", err)
	}
	for _, item := range deepTree {
		if d, ok := item["depth"].(int); ok && d > maxTreeDepth {
			t.Fatalf("entrée profondeur %d > max %d: %v", d, maxTreeDepth, item)
		}
	}
}

func TestBuildFileTreeIgnoresSymlinks(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink nécessite des privilèges sur Windows")
	}
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(root, "evil")); err != nil {
		t.Skipf("symlink non disponible: %v", err)
	}
	tree, err := buildFileTree(root, "", 0)
	if err != nil {
		t.Fatalf("buildFileTree: %v", err)
	}
	for _, item := range tree {
		if name, _ := item["name"].(string); name == "evil" {
			t.Fatalf("symlink présent dans l'arbre: %v", item)
		}
	}
}

// TestHomeRoot : un chemin relatif (ex: .gemini/antigravity-ide/brain/...) doit
// être résolu contre le home utilisateur, pas le CWD du daemon. Un chemin
// absolu doit passer inchangé.
func TestHomeRoot(t *testing.T) {
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}

	rel := homeRoot(".gemini/antigravity-ide/brain/s1")
	if !filepath.IsAbs(rel) {
		t.Fatalf("homeRoot(relatif) = %q, attendu un chemin absolu", rel)
	}
	want := filepath.Join(home, ".gemini", "antigravity-ide", "brain", "s1")
	if rel != filepath.Clean(want) {
		t.Fatalf("homeRoot(relatif) = %q, attendu %q", rel, want)
	}

	abs := homeRoot(filepath.Join(home, "x", "y"))
	if abs != filepath.Join(home, "x", "y") {
		t.Fatalf("homeRoot(absolu) = %q, attendu inchangé", abs)
	}
	if got := homeRoot(""); got != "" {
		t.Fatalf("homeRoot(vide) = %q, attendu vide", got)
	}
}

