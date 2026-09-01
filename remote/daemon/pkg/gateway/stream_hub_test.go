package gateway

import (
	"context"
	"testing"
	"time"
)

type mockSubscriber struct {
	id       string
	received []OutgoingMessage
}

func (m *mockSubscriber) ID() string {
	return m.id
}

func (m *mockSubscriber) WriteMessage(msg OutgoingMessage) error {
	m.received = append(m.received, msg)
	return nil
}

func TestStreamHub_LifecycleAndFanout(t *testing.T) {
	buf := NewSessionStreamBuffer(100)
	tmpDir := t.TempDir()
	ledger := NewSessionOperationLedger(tmpDir)

	hub := NewStreamHub(buf, ledger)

	cascadeID := "cas_stream_1"
	requestID := "req_stream_1"

	// 1. Démarrer stream
	stream, ctx, err := hub.StartStream(context.Background(), cascadeID, requestID)
	if err != nil || stream == nil || ctx == nil {
		t.Fatalf("StartStream error: %v", err)
	}

	if !hub.IsActive(cascadeID) {
		t.Fatalf("expected stream to be active")
	}

	// 2. Abonner deux abonnés
	sub1 := &mockSubscriber{id: "sub_1"}
	sub2 := &mockSubscriber{id: "sub_2"}
	hub.Subscribe(cascadeID, sub1)
	hub.Subscribe(cascadeID, sub2)

	// 3. Diffuser delta
	msg := OutgoingMessage{
		Type:      "stream_delta",
		CascadeID: cascadeID,
		RequestID: requestID,
		Data:      map[string]interface{}{"delta": "Hello "},
	}
	stepIdx := hub.BroadcastDelta(cascadeID, msg)
	if stepIdx <= 0 {
		t.Fatalf("expected valid stepIndex > 0, got %d", stepIdx)
	}

	if len(sub1.received) != 1 || len(sub2.received) != 1 {
		t.Fatalf("expected message delivered to both subscribers")
	}

	// 4. Désabonner sub1 et renvoyer un second delta
	hub.Unsubscribe(cascadeID, "sub_1")
	msg2 := OutgoingMessage{
		Type:      "stream_delta",
		CascadeID: cascadeID,
		RequestID: requestID,
		Data:      map[string]interface{}{"delta": "world!"},
	}
	hub.BroadcastDelta(cascadeID, msg2)

	if len(sub1.received) != 1 {
		t.Fatalf("expected sub1 to receive only 1 message after unsubscribe")
	}
	if len(sub2.received) != 2 {
		t.Fatalf("expected sub2 to receive 2 messages")
	}

	// 5. Clôture du stream
	hub.FinishStream(cascadeID, requestID, map[string]interface{}{"status": "done"})
	if hub.IsActive(cascadeID) {
		t.Fatalf("expected stream to be inactive after finish")
	}
}

func TestStreamHub_Cancel(t *testing.T) {
	hub := NewStreamHub(nil, nil)
	cascadeID := "cas_cancel"
	requestID := "req_cancel"

	_, ctx, _ := hub.StartStream(context.Background(), cascadeID, requestID)
	cancelled := hub.CancelStream(cascadeID)
	if !cancelled {
		t.Fatalf("expected CancelStream to return true")
	}

	select {
	case <-ctx.Done():
		// OK
	case <-time.After(500 * time.Millisecond):
		t.Fatalf("context was not cancelled after CancelStream")
	}
}

func TestStreamHub_CleanupStaleStreams(t *testing.T) {
	hub := NewStreamHub(nil, nil)
	cascadeID := "cas_stale"
	requestID := "req_stale"

	_, _, err := hub.StartStream(context.Background(), cascadeID, requestID)
	if err != nil {
		t.Fatalf("start stream failed: %v", err)
	}

	if hub.SubscriberCount(cascadeID) != 0 {
		t.Errorf("expected 0 subscribers, got %d", hub.SubscriberCount(cascadeID))
	}

	// Stale cleanup with 0 duration will immediately clean streams without subscribers
	cleaned := hub.CleanupStaleStreams(0)
	if len(cleaned) != 1 || cleaned[0] != cascadeID {
		t.Errorf("expected [%s] cleaned, got %v", cascadeID, cleaned)
	}

	if hub.IsActive(cascadeID) {
		t.Errorf("expected stream to be removed after cleanup")
	}
}
