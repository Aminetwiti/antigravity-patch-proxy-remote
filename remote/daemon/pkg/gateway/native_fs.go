package gateway

import (
	"bytes"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode/utf8"
)

// NativeFSEngine gère l'accès autonome au système de fichiers du workspace
// sans nécessiter que le Language Server soit actif (inspiré du modèle Antimatter).
type NativeFSEngine struct {
	MaxDepth         int
	MaxFileSize      int64
	MaxSearchResults int
}

// NewNativeFSEngine crée une nouvelle instance de moteur FS.
func NewNativeFSEngine() *NativeFSEngine {
	return &NativeFSEngine{
		MaxDepth:         8,
		MaxFileSize:      10 * 1024 * 1024, // 10 Mo
		MaxSearchResults: 100,
	}
}

// ResolveAndValidatePath valide qu'un chemin cible est strictement contenu dans le workspaceRoot.
// Empêche toute attaque par Directory Traversal (ex: ../../etc/passwd).
func ResolveAndValidatePath(workspaceRoot, targetPath string) (string, error) {
	if workspaceRoot == "" {
		return "", fmt.Errorf("workspaceRoot ne peut pas être vide")
	}
	cleanRoot := filepath.Clean(workspaceRoot)

	// Nettoyage des préfixes file:// ou slash résiduels
	cleanTarget := strings.TrimPrefix(targetPath, "file:///")
	cleanTarget = strings.TrimPrefix(cleanTarget, "file://")

	var resolved string
	if filepath.IsAbs(cleanTarget) {
		resolved = filepath.Clean(cleanTarget)
	} else {
		resolved = filepath.Clean(filepath.Join(cleanRoot, cleanTarget))
	}

	// Validation du confinement
	rel, err := filepath.Rel(cleanRoot, resolved)
	if err != nil {
		return "", fmt.Errorf("impossible de calculer le chemin relatif: %w", err)
	}

	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("accès refusé: chemin hors du workspace autorisé (%s)", targetPath)
	}

	return resolved, nil
}

// ListDirectoryNative liste le contenu récursif d'un répertoire de manière sûre et bornée.
func (e *NativeFSEngine) ListDirectoryNative(workspaceRoot, relativePath string, depth int) ([]map[string]interface{}, error) {
	if depth > e.MaxDepth {
		return nil, nil
	}

	targetDir, err := ResolveAndValidatePath(workspaceRoot, relativePath)
	if err != nil {
		return nil, err
	}

	entries, err := os.ReadDir(targetDir)
	if err != nil {
		return nil, err
	}

	sort.Slice(entries, func(i, j int) bool {
		if entries[i].IsDir() == entries[j].IsDir() {
			return entries[i].Name() < entries[j].Name()
		}
		return entries[i].IsDir()
	})

	var result []map[string]interface{}
	for _, entry := range entries {
		name := entry.Name()
		if isIgnoredDir(name) {
			continue
		}

		fullPath := filepath.Join(targetDir, name)
		info, errInfo := os.Lstat(fullPath)
		if errInfo != nil || info.Mode()&os.ModeSymlink != 0 {
			continue
		}

		entryRel := filepath.Join(relativePath, name)
		item := map[string]interface{}{
			"name":     name,
			"path":     entryRel,
			"fullPath": fullPath,
			"depth":    depth,
			"isDir":    entry.IsDir(),
			"size":     info.Size(),
		}
		result = append(result, item)

		if entry.IsDir() {
			children, _ := e.ListDirectoryNative(workspaceRoot, entryRel, depth+1)
			result = append(result, children...)
		}
	}

	return result, nil
}

// ReadFileNative lit le contenu d'un fichier avec garde de taille et détection de binarité.
func (e *NativeFSEngine) ReadFileNative(workspaceRoot, filePath string) ([]byte, bool, error) {
	resolved, err := ResolveAndValidatePath(workspaceRoot, filePath)
	if err != nil {
		return nil, false, err
	}

	info, err := os.Stat(resolved)
	if err != nil {
		return nil, false, err
	}
	if info.IsDir() {
		return nil, false, fmt.Errorf("la cible est un dossier, pas un fichier")
	}
	if info.Size() > e.MaxFileSize {
		return nil, false, fmt.Errorf("fichier trop volumineux (%d octets > limite %d)", info.Size(), e.MaxFileSize)
	}

	data, err := os.ReadFile(resolved)
	if err != nil {
		return nil, false, err
	}

	isBinary := !utf8.Valid(data) || bytes.IndexByte(data, 0) != -1
	return data, isBinary, nil
}

// WriteFileNative écrit de manière atomique et sécurisée dans un fichier sous le workspace.
func (e *NativeFSEngine) WriteFileNative(workspaceRoot, filePath string, content []byte) error {
	resolved, err := ResolveAndValidatePath(workspaceRoot, filePath)
	if err != nil {
		return err
	}

	parentDir := filepath.Dir(resolved)
	if err := os.MkdirAll(parentDir, 0755); err != nil {
		return fmt.Errorf("impossible de créer les dossiers parents: %w", err)
	}

	// Écriture atomique via fichier temporaire
	tmpFile := fmt.Sprintf("%s.tmp.%d", resolved, os.Getpid())
	if err := os.WriteFile(tmpFile, content, 0644); err != nil {
		return fmt.Errorf("échec d'écriture temporaire: %w", err)
	}

	if err := os.Rename(tmpFile, resolved); err != nil {
		_ = os.Remove(tmpFile)
		return fmt.Errorf("échec de validation atomique du fichier: %w", err)
	}

	return nil
}

// SearchFilesNative effectue une recherche textuelle rapide et bornée dans le workspace.
func (e *NativeFSEngine) SearchFilesNative(workspaceRoot, query string) ([]map[string]interface{}, error) {
	if query == "" {
		return []map[string]interface{}{}, nil
	}

	cleanRoot, err := ResolveAndValidatePath(workspaceRoot, "")
	if err != nil {
		return nil, err
	}

	results := make([]map[string]interface{}, 0, e.MaxSearchResults)
	queryLower := strings.ToLower(query)

	_ = filepath.WalkDir(cleanRoot, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			if d != nil && d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			if path != cleanRoot && isIgnoredDir(d.Name()) {
				return filepath.SkipDir
			}
			return nil
		}

		if len(results) >= e.MaxSearchResults {
			return filepath.SkipAll
		}

		relPath, _ := filepath.Rel(cleanRoot, path)
		fileName := d.Name()

		// Match dans le nom de fichier
		if strings.Contains(strings.ToLower(fileName), queryLower) {
			results = append(results, map[string]interface{}{
				"path":      relPath,
				"fullPath":  path,
				"name":      fileName,
				"matchType": "filename",
				"line":      0,
				"preview":   "",
			})
			return nil
		}

		// Match dans le contenu (limité aux fichiers < 2 Mo)
		info, errStat := d.Info()
		if errStat != nil || info.Size() > 2*1024*1024 || info.Size() == 0 {
			return nil
		}

		content, errRead := os.ReadFile(path)
		if errRead != nil || !utf8.Valid(content) {
			return nil
		}

		lines := strings.Split(string(content), "\n")
		for i, line := range lines {
			if len(results) >= e.MaxSearchResults {
				return filepath.SkipAll
			}
			if strings.Contains(strings.ToLower(line), queryLower) {
				preview := strings.TrimSpace(line)
				if len(preview) > 160 {
					preview = preview[:157] + "..."
				}
				results = append(results, map[string]interface{}{
					"path":      relPath,
					"fullPath":  path,
					"name":      fileName,
					"matchType": "content",
					"line":      i + 1,
					"preview":   preview,
				})
			}
		}

		return nil
	})

	return results, nil
}
