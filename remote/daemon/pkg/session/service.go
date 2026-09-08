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
	ErrSessionNotFound   = errors.New("session not found")
	ErrCommandDuplicate  = errors.New("duplicate command detected with same payload")
	ErrCommandConflict   = errors.New("conflicting payload for existing command id")
	ErrInvalidCommand    = errors.New("invalid command payload or type")
	ErrSessionClosed     = errors.New("session is already in a terminal state")
)

type EventBroadcaster interface {
	BroadcastEvent(event *domain.Event)
	BroadcastSessionUpdate(session *domain.Session)
}

type CommandRecord struct {
	CommandID   string `json:"commandId"`
	SessionID   string `json:"sessionId"`
	PayloadHash string `json:"payloadHash"`
	Status      string `json:"status"`
	CreatedAt   int64  `json:"createdAt"`
}

type Service struct {
	store       eventstore.EventStore
	broadcaster EventBroadcaster
	commandsMu  sync.RWMutex
	commands    map[string]*CommandRecord // key: commandId
}

func NewService(store eventstore.EventStore, broadcaster EventBroadcaster) *Service {
	return &Service{
		store:       store,
		broadcaster: broadcaster,
		commands:    make(map[string]*CommandRecord),
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
	s.commandsMu.Lock()
	defer s.commandsMu.Unlock()

	hash := HashPayload(payload)
	existing, ok := s.commands[commandID]
	if ok {
		if existing.PayloadHash == hash {
			return ErrCommandDuplicate
		}
		return ErrCommandConflict
	}

	s.commands[commandID] = &CommandRecord{
		CommandID:   commandID,
		SessionID:   sessionID,
		PayloadHash: hash,
		Status:      "accepted",
		CreatedAt:   time.Now().UnixMilli(),
	}
	return nil
}

func (s *Service) CreateSession(ctx context.Context, serverID, workspaceID, title string) (*domain.Session, error) {
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
	sess, err := s.store.GetSession(ctx, sessionID)
	if err != nil {
		return err
	}

	if !domain.CanTransition(sess.State, targetState) {
		return domain.ErrInvalidTransition{From: sess.State, To: targetState}
	}

	if err := s.store.UpdateSessionState(ctx, sessionID, targetState); err != nil {
		return fmt.Errorf("failed to persist state transition: %w", err)
	}

	sess.State = targetState
	sess.UpdatedAt = time.Now()

	eventID := nextEventID("evt_state")
	payload := []byte(fmt.Sprintf(`{"from": %q, "to": %q, "reason": %q}`, sess.State, targetState, reason))
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

func (s *Service) GetCatchupEvents(ctx context.Context, sessionID string, fromSeq int64, limit int) ([]domain.Event, error) {
	return s.store.GetEventsSince(ctx, sessionID, fromSeq, limit)
}
