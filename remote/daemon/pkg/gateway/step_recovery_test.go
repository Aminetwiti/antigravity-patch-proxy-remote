package gateway

import (
	"testing"
)

func TestSessionStreamBuffer_RecordAndGetEvents(t *testing.T) {
	buf := NewSessionStreamBuffer(5)
	cascadeID := "cas_test_123"

	// Enregistre 3 événements
	seq1 := buf.RecordEvent(cascadeID, OutgoingMessage{Type: "stream_delta", Data: map[string]string{"text": "hello"}})
	seq2 := buf.RecordEvent(cascadeID, OutgoingMessage{Type: "stream_delta", Data: map[string]string{"text": " world"}})
	seq3 := buf.RecordEvent(cascadeID, OutgoingMessage{Type: "stream_delta", Data: map[string]string{"text": "!"}})

	if seq1 != 1 || seq2 != 2 || seq3 != 3 {
		t.Fatalf("expected step indices 1, 2, 3 but got %d, %d, %d", seq1, seq2, seq3)
	}

	// Récupère depuis stepIndex 1 (doit renvoyer seq 2 et 3)
	missed, current := buf.GetEventsSince(cascadeID, 1)
	if current != 3 {
		t.Fatalf("expected currentSeq 3, got %d", current)
	}
	if len(missed) != 2 {
		t.Fatalf("expected 2 missed events, got %d", len(missed))
	}

	// Récupère depuis stepIndex 3 (aucun manqué)
	missedNone, current := buf.GetEventsSince(cascadeID, 3)
	if len(missedNone) != 0 || current != 3 {
		t.Fatalf("expected 0 missed events, got %d", len(missedNone))
	}
}

func TestSessionStreamBuffer_Eviction(t *testing.T) {
	buf := NewSessionStreamBuffer(3) // Capacité max 3
	cascadeID := "cas_test_evict"

	for i := 1; i <= 5; i++ {
		buf.RecordEvent(cascadeID, OutgoingMessage{Type: "stream_delta"})
	}

	// Le buffer contient les 3 derniers (seq 3, 4, 5)
	missed, current := buf.GetEventsSince(cascadeID, 0)
	if current != 5 {
		t.Fatalf("expected currentSeq 5, got %d", current)
	}
	if len(missed) != 3 {
		t.Fatalf("expected exactly 3 events after eviction, got %d", len(missed))
	}
}

func TestSessionStreamBuffer_MultiSessionAndClear(t *testing.T) {
	buf := NewSessionStreamBuffer(10)
	buf.RecordEvent("casc-A", OutgoingMessage{Type: "stream_delta"})
	buf.RecordEvent("casc-B", OutgoingMessage{Type: "stream_delta"})
	buf.RecordEvent("casc-A", OutgoingMessage{Type: "stream_delta"})

	missedA, seqA := buf.GetEventsSince("casc-A", 0)
	missedB, seqB := buf.GetEventsSince("casc-B", 0)

	if len(missedA) != 2 || seqA != 2 {
		t.Fatalf("casc-A expected 2 events, got %d (seq %d)", len(missedA), seqA)
	}
	if len(missedB) != 1 || seqB != 1 {
		t.Fatalf("casc-B expected 1 event, got %d (seq %d)", len(missedB), seqB)
	}

	buf.ClearCascade("casc-A")
	missedACleared, seqACleared := buf.GetEventsSince("casc-A", 0)
	if len(missedACleared) != 0 || seqACleared != 0 {
		t.Fatalf("casc-A expected cleared buffer, got %d events (seq %d)", len(missedACleared), seqACleared)
	}
}
