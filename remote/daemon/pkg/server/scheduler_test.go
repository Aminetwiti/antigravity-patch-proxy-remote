package server

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/antigravity/remote-daemon/pkg/agent"
	"github.com/antigravity/remote-daemon/pkg/approval"
	"github.com/antigravity/remote-daemon/pkg/eventstore"
	"github.com/antigravity/remote-daemon/pkg/session"
	"github.com/antigravity/remote-daemon/pkg/tools"
	"github.com/antigravity/remote-daemon/pkg/workspace"
)

type mockSchedulerLLM struct{}

func (m *mockSchedulerLLM) Generate(ctx context.Context, messages []agent.LLMMessage, availableTools []tools.ToolDefinition, onChunk func(string)) (*agent.LLMResponse, error) {
	return &agent.LLMResponse{
		Message: "Nightly health check: all tests green.",
		Done:    true,
	}, nil
}

func TestScheduler_LifecycleAndExecution(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "sched_test.db")
	store, err := eventstore.NewSQLiteEventStore(dbPath)
	if err != nil {
		t.Fatalf("failed to create sqlite store: %v", err)
	}
	defer store.Close()

	sessSvc := session.NewService(store, nil)
	wsMgr := workspace.NewManager()
	ws, _ := wsMgr.RegisterWorkspace("ws-1", "Default", tmpDir)

	toolsReg := tools.NewRegistry(wsMgr, true)
	apprMgr := approval.NewManager(sessSvc, 5*time.Minute)
	llm := &mockSchedulerLLM{}
	eng := agent.NewEngine(sessSvc, wsMgr, toolsReg, apprMgr, llm)

	sched := NewScheduler(sessSvc, eng)

	// Test AddJob
	job := ScheduledJob{
		ID:             "job_health",
		Name:           "Code Health Check",
		CronExpression: "* * * * *",
		Prompt:         "Run repository health audit",
		WorkspaceID:    ws.ID,
		IsEnabled:      true,
	}
	if err := sched.AddJob(job); err != nil {
		t.Fatalf("AddJob failed: %v", err)
	}

	// Test ListJobs
	jobs := sched.ListJobs()
	if len(jobs) != 1 {
		t.Fatalf("expected 1 job, got %d", len(jobs))
	}
	if jobs[0].ID != "job_health" {
		t.Errorf("expected job ID job_health, got %s", jobs[0].ID)
	}

	// Test manual execution of job
	sched.executeJob(sched.jobs["job_health"])

	// Wait for agent execution
	time.Sleep(100 * time.Millisecond)

	// Verify session was created and completed
	sessions, err := sessSvc.ListSessions(context.Background())
	if err != nil {
		t.Fatalf("ListSessions failed: %v", err)
	}
	if len(sessions) != 1 {
		t.Fatalf("expected 1 session created by scheduler, got %d", len(sessions))
	}
	if sessions[0].Title != "[Schedule: Code Health Check]" {
		t.Errorf("unexpected session title: %s", sessions[0].Title)
	}

	// Test Start and Stop
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	sched.Start(ctx)
	sched.Stop()

	// Test RemoveJob
	if err := sched.RemoveJob("job_health"); err != nil {
		t.Fatalf("RemoveJob failed: %v", err)
	}
	if len(sched.ListJobs()) != 0 {
		t.Errorf("expected 0 jobs after removal, got %d", len(sched.ListJobs()))
	}
}

func TestCronMatches(t *testing.T) {
	now := time.Date(2026, 9, 8, 14, 30, 0, 0, time.UTC) // Tuesday 14:30

	cases := []struct {
		expr  string
		match bool
	}{
		{"* * * * *", true},
		{"30 * * * *", true},
		{"*/5 * * * *", true},
		{"*/7 * * * *", false}, // 30 is not divisible by 7
		{"30 14 * * *", true},
		{"30 15 * * *", false},
		{"30 14 * * 2", true},  // Tuesday = 2
		{"30 14 * * 3", false}, // Wednesday = 3
		{"invalid", false},
	}

	for _, tc := range cases {
		got := cronMatches(tc.expr, now)
		if got != tc.match {
			t.Errorf("cronMatches(%q) = %v, want %v", tc.expr, got, tc.match)
		}
	}
}

func TestScheduler_PersistenceAcrossRestarts(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "persist_sched.db")
	store, err := eventstore.NewSQLiteEventStore(dbPath)
	if err != nil {
		t.Fatalf("failed to create sqlite store: %v", err)
	}
	defer store.Close()

	sessSvc := session.NewService(store, nil)
	sched1 := NewScheduler(sessSvc, nil, store)

	job := ScheduledJob{
		ID:             "cron_persist_1",
		OwnerID:        "admin-user",
		Name:           "Persistent Backup Job",
		CronExpression: "0 3 * * *",
		Prompt:         "Execute daily backup",
		WorkspaceID:    "ws-main",
		IsEnabled:      true,
	}

	if err := sched1.AddJob(job); err != nil {
		t.Fatalf("failed to add job to sched1: %v", err)
	}

	// Verify job is immediately present in sched1
	if len(sched1.ListJobs()) != 1 {
		t.Fatalf("expected 1 job in sched1, got %d", len(sched1.ListJobs()))
	}

	// Verify directly in sqlite store
	storedJob, err := store.GetScheduledJob(context.Background(), "cron_persist_1")
	if err != nil {
		t.Fatalf("store.GetScheduledJob failed: %v", err)
	}
	if storedJob == nil {
		t.Fatal("expected stored job in sqlite, got nil")
	}
	if storedJob.Name != "Persistent Backup Job" || storedJob.OwnerID != "admin-user" {
		t.Errorf("unexpected stored job data: %+v", storedJob)
	}

	// Simulate daemon restart: create a new scheduler with the same SQLite store
	sched2 := NewScheduler(sessSvc, nil, store)
	restoredJobs := sched2.ListJobs()
	if len(restoredJobs) != 1 {
		t.Fatalf("expected 1 restored job in sched2 after reboot, got %d", len(restoredJobs))
	}
	if restoredJobs[0].ID != "cron_persist_1" || restoredJobs[0].Prompt != "Execute daily backup" {
		t.Errorf("unexpected restored job in sched2: %+v", restoredJobs[0])
	}

	// Remove job in sched2 and verify deletion persists
	if err := sched2.RemoveJob("cron_persist_1"); err != nil {
		t.Fatalf("failed to remove job in sched2: %v", err)
	}

	// Simulate second reboot
	sched3 := NewScheduler(sessSvc, nil, store)
	if len(sched3.ListJobs()) != 0 {
		t.Errorf("expected 0 jobs in sched3 after deletion and restart, got %d", len(sched3.ListJobs()))
	}
}

