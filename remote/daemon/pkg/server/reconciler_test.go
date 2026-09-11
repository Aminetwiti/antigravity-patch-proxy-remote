package server

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/antigravity/remote-daemon/pkg/domain"
	"github.com/antigravity/remote-daemon/pkg/eventstore"
	"github.com/antigravity/remote-daemon/pkg/session"
)

func TestReconciler_DetectsDriftAndTransitionsToRecovering(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test_reconciler.db")
	store, err := eventstore.NewSQLiteEventStore(dbPath)
	if err != nil {
		t.Fatalf("failed to create sqlite store: %v", err)
	}
	defer store.Close()

	sessionSvc := session.NewService(store, nil)
	reconciler := NewReconciler(store, sessionSvc, nil, 100*time.Millisecond)

	ctx := context.Background()
	// Créer une session simulant un état RUNNING après crash
	sess, err := sessionSvc.CreateSession(ctx, "srv-1", "ws-1", "Crashed Agent Session")
	if err != nil {
		t.Fatalf("CreateSession failed: %v", err)
	}

	_ = sessionSvc.TransitionState(ctx, sess.ID, domain.SessionStateStarting, "starting")
	_ = sessionSvc.TransitionState(ctx, sess.ID, domain.SessionStateRunning, "running")

	// Sans checker enregistré (simule le daemon qui redémarre et trouve la session en DB sans goroutine active)
	reconciled, err := reconciler.ReconcileOnce(ctx)
	if err != nil {
		t.Fatalf("ReconcileOnce failed: %v", err)
	}

	if reconciled != 1 {
		t.Errorf("expected 1 session reconciled, got %d", reconciled)
	}

	// Vérifier que la session a bien transitionné vers RECOVERING
	updatedSess, err := store.GetSession(ctx, sess.ID)
	if err != nil {
		t.Fatalf("GetSession failed: %v", err)
	}

	if updatedSess.State != domain.SessionStateRecovering {
		t.Errorf("expected session state %s, got %s", domain.SessionStateRecovering, updatedSess.State)
	}

	// Vérifier que l'événement session.reconciled a été émis
	events, err := store.GetEventsSince(ctx, sess.ID, 0, 100)
	if err != nil {
		t.Fatalf("GetEventsSince failed: %v", err)
	}

	foundReconciledEvent := false
	for _, ev := range events {
		if ev.Type == "session.reconciled" {
			foundReconciledEvent = true
			break
		}
	}
	if !foundReconciledEvent {
		t.Errorf("expected session.reconciled event in event store")
	}
}

func TestReconciler_PreservesHealthyRunningSession(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test_reconciler_healthy.db")
	store, err := eventstore.NewSQLiteEventStore(dbPath)
	if err != nil {
		t.Fatalf("failed to create sqlite store: %v", err)
	}
	defer store.Close()

	sessionSvc := session.NewService(store, nil)
	reconciler := NewReconciler(store, sessionSvc, nil, 100*time.Millisecond)

	ctx := context.Background()
	sess, err := sessionSvc.CreateSession(ctx, "srv-1", "ws-1", "Healthy Agent Session")
	if err != nil {
		t.Fatalf("CreateSession failed: %v", err)
	}

	_ = sessionSvc.TransitionState(ctx, sess.ID, domain.SessionStateStarting, "starting")
	_ = sessionSvc.TransitionState(ctx, sess.ID, domain.SessionStateRunning, "running")

	// Enregistrer un checker qui confirme la vitalité du process
	reconciler.RegisterSessionChecker(sess.ID, func() bool {
		return true // Processus vivant
	})

	reconciled, err := reconciler.ReconcileOnce(ctx)
	if err != nil {
		t.Fatalf("ReconcileOnce failed: %v", err)
	}

	if reconciled != 0 {
		t.Errorf("expected 0 sessions reconciled, got %d", reconciled)
	}

	// La session doit rester RUNNING
	updatedSess, err := store.GetSession(ctx, sess.ID)
	if err != nil {
		t.Fatalf("GetSession failed: %v", err)
	}

	if updatedSess.State != domain.SessionStateRunning {
		t.Errorf("expected session state to remain RUNNING, got %s", updatedSess.State)
	}
}
