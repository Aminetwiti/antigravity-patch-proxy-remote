package gateway

import (
	"os"
	"path/filepath"
	"testing"
)

func TestMain(m *testing.M) {
	dir, err := os.MkdirTemp("", "gateway_test_*")
	if err == nil {
		scheduledTasksPath = filepath.Join(dir, "scheduled_tasks.json")
		sidecarsDirPath = filepath.Join(dir, "sidecars")
		mainConfigFilePath = filepath.Join(dir, "config.json")
		defer os.RemoveAll(dir)
	}
	os.Exit(m.Run())
}
