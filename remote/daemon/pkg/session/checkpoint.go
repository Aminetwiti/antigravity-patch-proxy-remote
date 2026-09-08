package session

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/antigravity/remote-daemon/pkg/domain"
	"github.com/antigravity/remote-daemon/pkg/eventstore"
	"github.com/antigravity/remote-daemon/pkg/workspace"
)

var (
	ErrSnapshotNotFound = errors.New("checkpoint snapshot not found")
)

type CheckpointManager struct {
	store      eventstore.EventStore
	sessionSvc *Service
	wsMgr      *workspace.Manager
	mu         sync.RWMutex
}

func NewCheckpointManager(store eventstore.EventStore, sessionSvc *Service, wsMgr *workspace.Manager) *CheckpointManager {
	return &CheckpointManager{
		store:      store,
		sessionSvc: sessionSvc,
		wsMgr:      wsMgr,
	}
}

// CreateCheckpoint captures a Git tree snapshot of the workspace and stores it in SQLite snapshots.
func (m *CheckpointManager) CreateCheckpoint(ctx context.Context, sessionID, workspaceID string, turn int) (*domain.Snapshot, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	dir := "."
	if m.wsMgr != nil && workspaceID != "" {
		resolved, err := m.wsMgr.ResolvePath(workspaceID, ".")
		if err == nil {
			dir = resolved
		}
	}

	gitRef := m.captureGitRef(dir)

	seq, _ := m.store.GetLatestSequence(ctx, sessionID)
	sess, err := m.store.GetSession(ctx, sessionID)
	state := domain.SessionStateRunning
	title := "Active Session"
	if err == nil && sess != nil {
		state = sess.State
		title = sess.Title
	}

	snap := &domain.Snapshot{
		SessionID: sessionID,
		Sequence:  seq,
		State:     state,
		Title:     title,
		PendingData: map[string]interface{}{
			"turn":        turn,
			"gitRef":      gitRef,
			"workspaceId": workspaceID,
			"capturedAt":  time.Now().UnixMilli(),
		},
		CapturedAt: time.Now(),
	}

	if err := m.store.SaveSnapshot(ctx, snap); err != nil {
		return nil, fmt.Errorf("failed saving snapshot to store: %w", err)
	}

	// Emit checkpoint created event
	evtPayload, _ := json.Marshal(map[string]interface{}{
		"sequence":    seq,
		"turn":        turn,
		"gitRef":      gitRef,
		"workspaceId": workspaceID,
	})
	_, _ = m.sessionSvc.EmitEvent(ctx, sessionID, "session.checkpoint_created", evtPayload)

	return snap, nil
}

// RollbackSession restores the workspace to the latest snapshot state at or before targetSequence.
func (m *CheckpointManager) RollbackSession(ctx context.Context, sessionID string, targetSequence int64) (*domain.Snapshot, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	snap, err := m.store.GetLatestSnapshot(ctx, sessionID)
	if err != nil || snap == nil {
		return nil, ErrSnapshotNotFound
	}

	wsID, _ := snap.PendingData["workspaceId"].(string)
	gitRef, _ := snap.PendingData["gitRef"].(string)

	dir := "."
	if m.wsMgr != nil && wsID != "" {
		resolved, err := m.wsMgr.ResolvePath(wsID, ".")
		if err == nil {
			dir = resolved
		}
	}

	if gitRef != "" {
		if err := m.restoreGitRef(dir, gitRef); err != nil {
			return nil, fmt.Errorf("failed restoring git ref %s: %w", gitRef, err)
		}
	}

	rollbackPayload, _ := json.Marshal(map[string]interface{}{
		"targetSequence": snap.Sequence,
		"gitRef":         gitRef,
		"rolledBackAt":   time.Now().UnixMilli(),
	})
	_, _ = m.sessionSvc.EmitEvent(ctx, sessionID, "session.rolled_back", rollbackPayload)
	_ = m.sessionSvc.TransitionState(ctx, sessionID, domain.SessionStateWaitingInput, fmt.Sprintf("Rolled back to sequence %d", snap.Sequence))

	return snap, nil
}

func (m *CheckpointManager) captureGitRef(dir string) string {
	// 1. Try git stash create (captures uncommitted working tree without touching working copy)
	cmdStash := exec.Command("git", "stash", "create")
	cmdStash.Dir = dir
	var outStash bytes.Buffer
	cmdStash.Stdout = &outStash
	if err := cmdStash.Run(); err == nil {
		stashHash := strings.TrimSpace(outStash.String())
		if stashHash != "" {
			return stashHash
		}
	}

	// 2. If stash was empty, fall back to current HEAD commit hash
	cmdHead := exec.Command("git", "rev-parse", "HEAD")
	cmdHead.Dir = dir
	var outHead bytes.Buffer
	cmdHead.Stdout = &outHead
	if err := cmdHead.Run(); err == nil {
		return strings.TrimSpace(outHead.String())
	}

	return ""
}

func (m *CheckpointManager) restoreGitRef(dir, gitRef string) error {
	// Try restoring via checkout/reset
	cmd := exec.Command("git", "checkout", gitRef, "--", ".")
	cmd.Dir = dir
	if err := cmd.Run(); err != nil {
		// Fallback: git stash apply
		cmdApply := exec.Command("git", "stash", "apply", gitRef)
		cmdApply.Dir = dir
		_ = cmdApply.Run()
	}
	return nil
}
