package gateway

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"time"
)

const DefaultUploadTTL = 7 * 24 * time.Hour

func CleanExpiredUploads(baseDir string, cutoff time.Time) (int, error) {
	if baseDir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return 0, err
		}
		baseDir = filepath.Join(home, ".gemini", "antigravity", "brain")
	}

	if _, err := os.Stat(baseDir); os.IsNotExist(err) {
		return 0, nil
	}

	deletedCount := 0
	_ = filepath.Walk(baseDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if !info.IsDir() && filepath.Base(filepath.Dir(path)) == ".user_uploaded" {
			if info.ModTime().Before(cutoff) {
				if errDel := os.Remove(path); errDel == nil {
					deletedCount++
					slog.Info("upload_cleaner_deleted_expired_file", "path", path)
				}
			}
		}
		return nil
	})

	return deletedCount, nil
}

func StartUploadCleanerRoutine(ctx context.Context, baseDir string, interval, ttl time.Duration) {
	if interval <= 0 {
		interval = 1 * time.Hour
	}
	if ttl <= 0 {
		ttl = DefaultUploadTTL
	}

	go func() {
		_, _ = CleanExpiredUploads(baseDir, time.Now().Add(-ttl))

		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				_, _ = CleanExpiredUploads(baseDir, time.Now().Add(-ttl))
			}
		}
	}()
}
