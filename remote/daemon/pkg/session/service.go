package session

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/antigravity/remote-daemon/pkg/domain"
	"github.com/antigravity/remote-daemon/pkg/eventstore"
)

var eventIdCounter uint64

func nextEventID(prefix string) string {
	c := atomic.AddUint64(&eventIdCounter, 1)
	return fmt.Sprintf("%s_%d_%d", prefix, time.Now().UnixNano(), c)
}

var (
	ErrSessionNotFound  = errors.New("session not found")
	ErrCommandDuplicate = domain.ErrCommandDuplicate
	ErrCommandConflict  = domain.ErrCommandConflict
	ErrInvalidCommand   = errors.New("invalid command payload or type")
	ErrSessionClosed    = errors.New("session is already in a terminal state")
)

type EventBroadcaster interface {
	BroadcastEvent(event *domain.Event)
	BroadcastSessionUpdate(session *domain.Session)
}

type Service struct {
	store       eventstore.EventStore
	broadcaster EventBroadcaster
	commandsMu  sync.RWMutex
	commands    map[string]*domain.CommandRecord // hot cache
}

func NewService(store eventstore.EventStore, broadcaster EventBroadcaster) *Service {
	return &Service{
		store:       store,
		broadcaster: broadcaster,
		commands:    make(map[string]*domain.CommandRecord),
	}
}

func HashPayload(payload interface{}) string {
	raw, err := json.Marshal(payload)
	if err != nil {
		h := sha256.Sum256([]byte(fmt.Sprintf("%v", payload)))
		return hex.EncodeToString(h[:])
	}
	h := sha256.Sum256(raw)
	return hex.EncodeToString(h[:])
}

func (s *Service) CheckAndRegisterCommand(commandID, sessionID string, payload interface{}) error {
	return s.CheckAndRegisterCommandCtx(context.Background(), commandID, sessionID, payload)
}

func (s *Service) CheckAndRegisterCommandCtx(ctx context.Context, commandID, sessionID string, payload interface{}) error {
	s.commandsMu.Lock()
	defer s.commandsMu.Unlock()

	hash := HashPayload(payload)
	// 1. Vérification dans le cache chaud en mémoire
	if existing, ok := s.commands[commandID]; ok {
		if existing.PayloadHash == hash {
			return ErrCommandDuplicate
		}
		return ErrCommandConflict
	}

	// 2. Vérification dans la base SQLite persistante (survit aux reboots VPS / crashs daemon)
	if s.store != nil {
		dbCmd, err := s.store.GetCommand(ctx, commandID)
		if err == nil && dbCmd != nil {
			s.commands[commandID] = dbCmd
			if dbCmd.PayloadHash == hash {
				return ErrCommandDuplicate
			}
			return ErrCommandConflict
		}
	}

	cmdRecord := &domain.CommandRecord{
		CommandID:   commandID,
		SessionID:   sessionID,
		PayloadHash: hash,
		Status:      "accepted",
		CreatedAt:   time.Now().UnixMilli(),
	}

	if s.store != nil {
		if err := s.store.RegisterCommand(ctx, cmdRecord); err != nil {
			return err
		}
	}
	s.commands[commandID] = cmdRecord
	return nil
}

func (s *Service) CreateSession(ctx context.Context, serverID, workspaceID, title string) (*domain.Session, error) {
	return s.CreateSessionWithOwner(ctx, serverID, workspaceID, title, "")
}

func (s *Service) CreateSessionWithOwner(ctx context.Context, serverID, workspaceID, title, ownerID string) (*domain.Session, error) {
	if serverID == "" {
		serverID = "local-server"
	}
	if workspaceID == "" {
		workspaceID = "default-workspace"
	}
	if title == "" {
		title = "New Session"
	}

	sessionID := fmt.Sprintf("sess_%d_%s", time.Now().UnixMilli(), hex.EncodeToString([]byte(title))[:6])
	sess := &domain.Session{
		ID:          sessionID,
		ServerID:    serverID,
		WorkspaceID: workspaceID,
		OwnerID:     ownerID,
		Title:       title,
		State:       domain.SessionStateCreated,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}

	if err := s.store.CreateSession(ctx, sess); err != nil {
		return nil, fmt.Errorf("failed to persist session: %w", err)
	}

	initEv, err := s.store.AppendEvent(ctx, sess.ID, fmt.Sprintf("evt_init_%s", sess.ID), "session.created", []byte(fmt.Sprintf(`{"title": %q, "state": %q}`, sess.Title, sess.State)))
	if err == nil && s.broadcaster != nil {
		s.broadcaster.BroadcastEvent(initEv)
		s.broadcaster.BroadcastSessionUpdate(sess)
	}

	return sess, nil
}

func (s *Service) GetSession(ctx context.Context, sessionID string) (*domain.Session, error) {
	return s.store.GetSession(ctx, sessionID)
}

func (s *Service) TransitionState(ctx context.Context, sessionID string, targetState domain.SessionState, reason string) error {
	return s.TransitionStateWithVersion(ctx, sessionID, targetState, reason, 0)
}

func (s *Service) TransitionStateWithVersion(ctx context.Context, sessionID string, targetState domain.SessionState, reason string, expectedVersion int64) error {
	sess, err := s.store.GetSession(ctx, sessionID)
	if err != nil {
		return err
	}

	if !domain.CanTransition(sess.State, targetState) {
		return domain.ErrInvalidTransition{From: sess.State, To: targetState}
	}

	if err := s.store.UpdateSessionStateWithVersion(ctx, sessionID, targetState, expectedVersion); err != nil {
		return fmt.Errorf("failed to persist state transition: %w", err)
	}

	sess.State = targetState
	sess.UpdatedAt = time.Now()
	if expectedVersion > 0 {
		sess.Version = expectedVersion + 1
	}

	eventID := nextEventID("evt_state")
	payload := []byte(fmt.Sprintf(`{"from": %q, "to": %q, "reason": %q, "version": %d}`, sess.State, targetState, reason, sess.Version))
	ev, err := s.store.AppendEvent(ctx, sessionID, eventID, "session.state_changed", payload)
	if err == nil && s.broadcaster != nil {
		s.broadcaster.BroadcastEvent(ev)
		s.broadcaster.BroadcastSessionUpdate(sess)
	}

	return nil
}

func (s *Service) EmitEvent(ctx context.Context, sessionID, eventType string, payload []byte) (*domain.Event, error) {
	eventID := nextEventID("evt")
	ev, err := s.store.AppendEvent(ctx, sessionID, eventID, eventType, payload)
	if err != nil {
		return nil, err
	}

	if s.broadcaster != nil {
		s.broadcaster.BroadcastEvent(ev)
	}
	return ev, nil
}

// EmitEphemeralEvent broadcasts a high-frequency transient event (such as streaming thought/tool chunks)
// directly to all attached clients without writing intermediate rows to SQLite.
// Final consolidated events (agent.thought, tool.result) are persisted via EmitEvent.
func (s *Service) EmitEphemeralEvent(sessionID, eventType string, payload []byte) {
	if s.broadcaster != nil {
		ev := &domain.Event{
			SessionID: sessionID,
			Sequence:  -1,
			EventID:   nextEventID("ephem"),
			Type:      eventType,
			Timestamp: time.Now().UnixNano() / 1000,
			Payload:   payload,
		}
		s.broadcaster.BroadcastEvent(ev)
	}
}

func (s *Service) GetCatchupEvents(ctx context.Context, sessionID string, fromSeq int64, limit int) ([]domain.Event, error) {
	return s.store.GetEventsSince(ctx, sessionID, fromSeq, limit)
}

func (s *Service) ListSessions(ctx context.Context) ([]domain.Session, error) {
	return s.store.ListSessions(ctx)
}
