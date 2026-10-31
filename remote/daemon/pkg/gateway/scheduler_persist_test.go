package gateway

import (
	"path/filepath"
	"testing"
)

func TestScheduledTasksPersistRoundTrip(t *testing.T) {
	dir := t.TempDir()
	old := scheduledTasksPath
	oldSidecars := sidecarsDirPath
	oldConfig := mainConfigFilePath
	scheduledTasksPath = filepath.Join(dir, "scheduled_tasks.json")
	sidecarsDirPath = filepath.Join(dir, "sidecars")
	mainConfigFilePath = filepath.Join(dir, "config.json")
	defer func() {
		scheduledTasksPath = old
		sidecarsDirPath = oldSidecars
		mainConfigFilePath = oldConfig
	}()

	_, s := newTestServerWithGW(&fakeRPCClient{})
	s.mu.Lock()
	s.scheduledTasks = map[string]*ScheduledTask{}
	s.mu.Unlock()
	task := &ScheduledTask{
		ID:             "t1",
		Name:           "Daily backup",
		Prompt:         "backup the project",
		WorkspaceName:  "myproj",
		CronExpression: "0 9 * * *",
		IsDaemon:       true,
		IsEnabled:      true,
		Status:         "idle",
	}
	s.mu.Lock()
	s.scheduledTasks[task.ID] = task
	s.mu.Unlock()

	if err := s.SaveScheduledTasks(); err != nil {
		t.Fatalf("SaveScheduledTasks: %v", err)
	}

	// Nouveau serveur (simule un redémarrage)
	_, s2 := newTestServerWithGW(&fakeRPCClient{})
	if err := s2.LoadScheduledTasks(); err != nil {
		t.Fatalf("LoadScheduledTasks: %v", err)
	}
	s2.mu.Lock()
	got, ok := s2.scheduledTasks["t1"]
	s2.mu.Unlock()
	if !ok {
		t.Fatal("tâche t1 non rechargée après redémarrage")
	}
	if got.CronExpression != "0 9 * * *" || !got.IsDaemon || !got.IsEnabled {
		t.Fatalf("tâche rechargée incorrecte: %+v", got)
	}
}

func TestLoadScheduledTasksMissingFileIsNotFatal(t *testing.T) {
	dir := t.TempDir()
	old := scheduledTasksPath
	oldSidecars := sidecarsDirPath
	oldConfig := mainConfigFilePath
	scheduledTasksPath = filepath.Join(dir, "does_not_exist.json")
	sidecarsDirPath = filepath.Join(dir, "sidecars")
	mainConfigFilePath = filepath.Join(dir, "config.json")
	defer func() {
		scheduledTasksPath = old
		sidecarsDirPath = oldSidecars
		mainConfigFilePath = oldConfig
	}()

	_, s := newTestServerWithGW(&fakeRPCClient{})
	s.mu.Lock()
	s.scheduledTasks = map[string]*ScheduledTask{}
	s.mu.Unlock()
	if err := s.LoadScheduledTasks(); err != nil {
		t.Fatalf("LoadScheduledTasks sur fichier absent doit être non-fatal, got: %v", err)
	}
	s.mu.Lock()
	n := len(s.scheduledTasks)
	s.mu.Unlock()
	if n != 0 {
		t.Fatalf("attendu 0 tâche, got %d", n)
	}
}
