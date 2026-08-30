package gateway

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"time"
)

// StreamSubscriber interface minimale représentant un client WebSocket abonné à un stream.
type StreamSubscriber interface {
	WriteMessage(msg OutgoingMessage) error
	ID() string
}

// ActiveStream représente une génération en cours côté Language Server.
type ActiveStream struct {
	CascadeID   string
	RequestID   string
	Context     context.Context
	Cancel      context.CancelFunc
	StartedAt   time.Time
	FrameCount  int64
	subscribers map[string]StreamSubscriber
	mu          sync.RWMutex
}

// StreamHub gère le cycle de vie des streams d'agents indépendamment des sockets clients.
type StreamHub struct {
	mu            sync.RWMutex
	activeStreams map[string]*ActiveStream
	buffer        *SessionStreamBuffer
	ledger        *SessionOperationLedger
}

// NewStreamHub instancie un StreamHub rattaché à un SessionStreamBuffer et un SessionOperationLedger.
func NewStreamHub(buffer *SessionStreamBuffer, ledger *SessionOperationLedger) *StreamHub {
	return &StreamHub{
		activeStreams: make(map[string]*ActiveStream),
		buffer:        buffer,
		ledger:        ledger,
	}
}

// StartStream enregistre et démarre le suivi d'un stream amont pour une cascade.
func (h *StreamHub) StartStream(parentCtx context.Context, cascadeID, requestID string) (*ActiveStream, context.Context, error) {
	if cascadeID == "" || requestID == "" {
		return nil, nil, fmt.Errorf("cascadeID et requestID sont obligatoires")
	}

	h.mu.Lock()
	defer h.mu.Unlock()

	if existing, running := h.activeStreams[cascadeID]; running {
		existing.Cancel()
	}

	ctx, cancel := context.WithCancel(parentCtx)
	stream := &ActiveStream{
		CascadeID:   cascadeID,
		RequestID:   requestID,
		Context:     ctx,
		Cancel:      cancel,
		StartedAt:   time.Now(),
		subscribers: make(map[string]StreamSubscriber),
	}

	h.activeStreams[cascadeID] = stream
	return stream, ctx, nil
}

// Subscribe abonne un client WebSocket au flux d'une cascade.
func (h *StreamHub) Subscribe(cascadeID string, sub StreamSubscriber) {
	if cascadeID == "" || sub == nil {
		return
	}

	h.mu.RLock()
	stream, exists := h.activeStreams[cascadeID]
	h.mu.RUnlock()

	if exists {
		stream.mu.Lock()
		stream.subscribers[sub.ID()] = sub
		stream.mu.Unlock()
	}
}

// Unsubscribe désabonne un client du flux d'une cascade.
func (h *StreamHub) Unsubscribe(cascadeID string, subID string) {
	if cascadeID == "" || subID == "" {
		return
	}

	h.mu.RLock()
	stream, exists := h.activeStreams[cascadeID]
	h.mu.RUnlock()

	if exists {
		stream.mu.Lock()
		delete(stream.subscribers, subID)
		stream.mu.Unlock()
	}
}

// BroadcastDelta enregistre une frame dans StepRecovery et la diffuse à tous les abonnés.
func (h *StreamHub) BroadcastDelta(cascadeID string, msg OutgoingMessage) int64 {
	var stepIndex int64
	if h.buffer != nil {
		stepIndex = h.buffer.RecordEvent(cascadeID, msg)
	}

	h.mu.RLock()
	stream, exists := h.activeStreams[cascadeID]
	h.mu.RUnlock()

	if exists {
		atomic.AddInt64(&stream.FrameCount, 1)
		stream.mu.RLock()
		for _, sub := range stream.subscribers {
			_ = sub.WriteMessage(msg)
		}
		stream.mu.RUnlock()
	}

	return stepIndex
}

// FinishStream clôture le stream actif, met à jour le ledger et purge le hub.
func (h *StreamHub) FinishStream(cascadeID, requestID string, result map[string]interface{}) {
	h.mu.Lock()
	stream, exists := h.activeStreams[cascadeID]
	if exists && stream.RequestID == requestID {
		delete(h.activeStreams, cascadeID)
	}
	h.mu.Unlock()

	if exists {
		stream.Cancel()
		if h.ledger != nil {
			_, _ = h.ledger.Accept(cascadeID, requestID, result)
		}
	}
}

// CancelStream annule la génération en cours sur une cascade.
func (h *StreamHub) CancelStream(cascadeID string) bool {
	h.mu.Lock()
	stream, exists := h.activeStreams[cascadeID]
	if exists {
		delete(h.activeStreams, cascadeID)
	}
	h.mu.Unlock()

	if exists {
		stream.Cancel()
		return true
	}
	return false
}

// IsActive indique si un stream est en cours d'exécution sur la cascade.
func (h *StreamHub) IsActive(cascadeID string) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	_, exists := h.activeStreams[cascadeID]
	return exists
}
