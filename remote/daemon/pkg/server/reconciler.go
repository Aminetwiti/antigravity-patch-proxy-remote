package server

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/antigravity/remote-daemon/pkg/domain"
	"github.com/antigravity/remote-daemon/pkg/eventstore"
	"github.com/antigravity/remote-daemon/pkg/session"
	"github.com/antigravity/remote-daemon/pkg/workspace"
)

// SessionRecoverer définit le contrat de réactivation active d'une session dont le runtime a crashé.
type SessionRecoverer interface {
	RecoverSession(ctx context.Context, sessionID string) error
}

// Reconciler surveille et réconcilie l'état désiré (EventStore SQLite)
// avec l'état effectif des runtimes (processus, boucles d'exécution, worktrees).
// Principe Staff Engineer : détecte et corrige automatiquement le drift après reboot ou crash.
type Reconciler struct {
	store             eventstore.EventStore
	sessionSvc        *session.Service
	wsMgr             *workspace.Manager
	interval          time.Duration
	worktreeRetention time.Duration
	recoverer         SessionRecoverer

	mu             sync.Mutex
	activeCheckers map[string]func() bool // sessionID -> isAlive checker
	stopCh         chan struct{}
}

func NewReconciler(store eventstore.EventStore, sessionSvc *session.Service, wsMgr *workspace.Manager, interval time.Duration) *Reconciler {
	if interval <= 0 {
		interval = 15 * time.Second
	}
	return &Reconciler{
		store:             store,
		sessionSvc:        sessionSvc,
		wsMgr:             wsMgr,
		interval:          interval,
		worktreeRetention: 7 * 24 * time.Hour, // Rétention de 7 jours par défaut
		activeCheckers:    make(map[string]func() bool),
		stopCh:            make(chan struct{}),
	}
}

func (r *Reconciler) SetSessionRecoverer(rec SessionRecoverer) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.recoverer = rec
}

func (r *Reconciler) SetWorktreeRetention(d time.Duration) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.worktreeRetention = d
}

func (r *Reconciler) RegisterSessionChecker(sessionID string, isAlive func() bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.activeCheckers[sessionID] = isAlive
}

func (r *Reconciler) UnregisterSessionChecker(sessionID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.activeCheckers, sessionID)
}

func (r *Reconciler) Start() {
	go r.loop()
}

func (r *Reconciler) Stop() {
	select {
	case <-r.stopCh:
	default:
		close(r.stopCh)
	}
}

func (r *Reconciler) ReconcileOnce(ctx context.Context) (int, error) {
	sessions, err := r.store.ListSessions(ctx)
	if err != nil {
		return 0, err
	}

	reconciled := 0
	r.mu.Lock()
	checkers := make(map[string]func() bool, len(r.activeCheckers))
	for k, v := range r.activeCheckers {
		checkers[k] = v
	}
	recoverer := r.recoverer
	retention := r.worktreeRetention
	r.mu.Unlock()

	for _, s := range sessions {
		// Seules les sessions censées être en cours d'exécution sont vérifiées
		if s.State != domain.SessionStateRunning && s.State != domain.SessionStateStarting {
			continue
		}

		checker, hasChecker := checkers[s.ID]
		isAlive := hasChecker && checker != nil && checker()

		if !isAlive {
			// Drift détecté : la base indique RUNNING/STARTING mais aucun processus n'est actif
			reconciled++
			_ = r.sessionSvc.TransitionState(ctx, s.ID, domain.SessionStateRecovering, "Reconciler detected dead execution runtime")

			// Si un recoverer est enregistré, tenter la réactivation active immédiate
			recovered := false
			if recoverer != nil {
				if errRec := recoverer.RecoverSession(ctx, s.ID); errRec == nil {
					_ = r.sessionSvc.TransitionState(ctx, s.ID, domain.SessionStateRunning, "Reconciler active recovery succeeded")
					_, _ = r.sessionSvc.EmitEvent(ctx, s.ID, domain.EventRuntimeRecovered, []byte(fmt.Sprintf(`{"sessionId":%q,"recovered":true}`, s.ID)))
					recovered = true
				}
			}

			if !recovered {
				payload, _ := json.Marshal(map[string]interface{}{
					"sessionId":     s.ID,
					"reason":        "reconciler_recovered_dead_process",
					"previousState": s.State,
					"timestamp":     time.Now().UnixMilli(),
				})
				_, _ = r.sessionSvc.EmitEvent(ctx, s.ID, domain.EventSessionReconciled, payload)
			}
		}
	}

	// Élagage des worktrees temporaires selon la politique de rétention (Worktree Retention Policy)
	// Staff Engineer : Ne JAMAIS supprimer un worktree immédiatement après complétion (l'utilisateur peut vouloir inspecter/merger).
	if r.wsMgr != nil && retention > 0 {
		for _, s := range sessions {
			if s.State == domain.SessionStateCompleted || s.State == domain.SessionStateFailed || s.State == domain.SessionStateCancelled {
				if time.Since(s.UpdatedAt) > retention {
					shadowWsID := fmt.Sprintf("shadow_%s_%s", s.WorkspaceID, s.ID)
					_ = r.wsMgr.RemoveWorktree(shadowWsID)
				}
			}
		}
	}

	return reconciled, nil
}

func (r *Reconciler) loop() {
	ticker := time.NewTicker(r.interval)
	defer ticker.Stop()

	for {
		select {
		case <-r.stopCh:
			return
		case <-ticker.C:
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			_, _ = r.ReconcileOnce(ctx)
			cancel()
		}
	}
}
