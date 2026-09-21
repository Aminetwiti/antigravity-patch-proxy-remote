package session_test

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/antigravity/remote-daemon/pkg/domain"
	"github.com/antigravity/remote-daemon/pkg/eventstore"
	"github.com/antigravity/remote-daemon/pkg/session"
	"github.com/antigravity/remote-daemon/pkg/workspace"
)

type mockBroadcaster struct{}

func (m *mockBroadcaster) BroadcastEvent(event *domain.Event)                  {}
func (m *mockBroadcaster) BroadcastSessionUpdate(session *domain.Session) {}

func setupGitWorkspace(t *testing.T) string {
	tmpDir := t.TempDir()

	runCmd := func(args ...string) {
		cmd := exec.Command("git", args...)
		cmd.Dir = tmpDir
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v failed: %s", args, string(out))
		}
	}

	runCmd("init")
	runCmd("config", "user.email", "test@antigravity.dev")
	runCmd("config", "user.name", "Test Agent")

	testFile := filepath.Join(tmpDir, "code.txt")
	_ = os.WriteFile(testFile, []byte("version 1 - clean code\n"), 0644)
	runCmd("add", ".")
	runCmd("commit", "-m", "initial commit")

	return tmpDir
}

func TestCheckpointManager_CreateAndRollback(t *testing.T) {
	wsDir := setupGitWorkspace(t)
	dbPath := filepath.Join(t.TempDir(), "checkpoint_test.db")

	store, err := eventstore.NewSQLiteEventStore(dbPath)
	if err != nil {
		t.Fatalf("failed creating event store: %v", err)
	}
	defer store.Close()

	ctx := context.Background()
	svc := session.NewService(store, &mockBroadcaster{})
	wsMgr := workspace.NewManager()
	ws, _ := wsMgr.RegisterWorkspace("ws-test", "TestWS", wsDir)

	sess, err := svc.CreateSession(ctx, "srv-1", ws.ID, "Checkpoint Test Session")
	if err != nil {
		t.Fatalf("failed creating session: %v", err)
	}

	mgr := session.NewCheckpointManager(store, svc, wsMgr)

	// 1. Create checkpoint 1
	snap1, err := mgr.CreateCheckpoint(ctx, sess.ID, ws.ID, 1)
	if err != nil {
		t.Fatalf("failed creating checkpoint: %v", err)
	}
	if snap1.SessionID != sess.ID {
		t.Errorf("expected session ID %s, got %s", sess.ID, snap1.SessionID)
	}

	// 2. Modify file (simulating agent error)
	filePath := filepath.Join(wsDir, "code.txt")
	_ = os.WriteFile(filePath, []byte("version 2 - corrupted code\n"), 0644)

	// 3. Rollback to checkpoint 1
	snapRolledBack, err := mgr.RollbackSession(ctx, sess.ID, snap1.Sequence)
	if err != nil {
		t.Fatalf("failed rolling back session: %v", err)
	}
	if snapRolledBack.Sequence != snap1.Sequence {
		t.Errorf("expected sequence %d, got %d", snap1.Sequence, snapRolledBack.Sequence)
	}

	// 4. Verify file content was reverted
	restoredContent, err := os.ReadFile(filePath)
	if err != nil {
		t.Fatalf("failed reading restored file: %v", err)
	}
	if strings.TrimSpace(string(restoredContent)) != "version 1 - clean code" {
		t.Fatalf("expected file to be restored to version 1, got: %q", string(restoredContent))
	}

	// 5. Verify events logged in store
	events, err := store.GetEventsSince(ctx, sess.ID, 0, 50)
	if err != nil {
		t.Fatalf("failed reading events: %v", err)
	}

	hasCheckpointEvt := false
	hasRollbackEvt := false
	for _, ev := range events {
		if ev.Type == "session.checkpoint_created" {
			hasCheckpointEvt = true
		}
		if ev.Type == "session.rolled_back" {
			hasRollbackEvt = true
		}
	}

	if !hasCheckpointEvt {
		t.Errorf("expected session.checkpoint_created event in store")
	}
	if !hasRollbackEvt {
		t.Errorf("expected session.rolled_back event in store")
	}
}
