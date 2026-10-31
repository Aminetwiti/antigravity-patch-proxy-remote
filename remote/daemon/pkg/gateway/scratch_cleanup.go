package gateway

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// DefaultScratchMaxAge durée de rétention par défaut des fichiers scratch (7 jours).
const DefaultScratchMaxAge = 7 * 24 * time.Hour

// CleanExpiredScratchFiles purge les fichiers scratch plus anciens que maxAge.
// Si cascadeID est non-vide, il nettoie le scratch de cette session.
// Si cascadeID est vide (""), il nettoie l'ensemble des sous-dossiers scratch du brain.
func CleanExpiredScratchFiles(cascadeID string, maxAge time.Duration) (int, error) {
	if maxAge <= 0 {
		maxAge = DefaultScratchMaxAge
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return 0, fmt.Errorf("impossible de localiser le home directory: %w", err)
	}

	brainDir := filepath.Join(home, ".gemini", "antigravity", "brain")
	if _, err := os.Stat(brainDir); os.IsNotExist(err) {
		return 0, nil
	}

	var scratchDirs []string
	if cascadeID != "" {
		if !uuidRe.MatchString(cascadeID) {
			return 0, fmt.Errorf("cascadeId invalide: %q", cascadeID)
		}
		scratchDirs = append(scratchDirs, filepath.Join(brainDir, cascadeID, "scratch"))
	} else {
		entries, err := os.ReadDir(brainDir)
		if err != nil {
			return 0, fmt.Errorf("erreur de lecture du dossier brain: %w", err)
		}
		for _, entry := range entries {
			if entry.IsDir() && uuidRe.MatchString(entry.Name()) {
				scratchDirs = append(scratchDirs, filepath.Join(brainDir, entry.Name(), "scratch"))
			}
		}
	}

	cutoff := time.Now().Add(-maxAge)
	deletedCount := 0

	for _, sDir := range scratchDirs {
		entries, err := os.ReadDir(sDir)
		if err != nil {
			continue // dossier inexistant ou non lisible, on passe
		}

		for _, file := range entries {
			if file.IsDir() {
				continue
			}

			// Ne purge que les uploads et fichiers temporaires
			name := file.Name()
			if !strings.HasPrefix(name, "upload_") && !strings.HasPrefix(name, "tmp_") {
				continue
			}

			filePath := filepath.Join(sDir, name)
			info, err := file.Info()
			if err != nil {
				continue
			}

			if info.ModTime().Before(cutoff) {
				if err := os.Remove(filePath); err == nil {
					deletedCount++
				}
			}
		}
	}

	return deletedCount, nil
}

// StartScratchCleanupRoutine lance une routine non-bloquante de nettoyage périodique.
func StartScratchCleanupRoutine(ctx context.Context, interval, maxAge time.Duration) {
	if interval <= 0 {
		interval = 24 * time.Hour
	}
	if maxAge <= 0 {
		maxAge = DefaultScratchMaxAge
	}

	go func() {
		// Nettoyage immédiat au démarrage
		_, _ = CleanExpiredScratchFiles("", maxAge)

		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				_, _ = CleanExpiredScratchFiles("", maxAge)
			}
		}
	}()
}
