package protocol_test

import (
	"encoding/json"
	"testing"

	"github.com/antigravity/remote-daemon/pkg/domain"
	"github.com/antigravity/remote-daemon/pkg/protocol"
)

func TestProtocolV2_EnvelopeSerialization(t *testing.T) {
	env := protocol.V2Envelope{
		Version:      protocol.ProtocolVersion,
		Type:         protocol.TypeSessionAttach,
		RequestID:    "req-test-1",
		SessionID:    "sess-123",
		LastSequence: 42,
		Payload:      json.RawMessage(`{"filter":"all"}`),
	}

	data, err := json.Marshal(env)
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}

	var decoded protocol.V2Envelope
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}

	if decoded.Version != protocol.ProtocolVersion || decoded.Type != protocol.TypeSessionAttach || decoded.LastSequence != 42 {
		t.Fatalf("decoded envelope mismatch: %+v", decoded)
	}
}

func TestProtocolV2_Responses(t *testing.T) {
	// 1. CatchupResponse
	events := []domain.Event{
		{
			SessionID: "s1",
			Sequence:  1,
			EventID:   "e1",
			Type:      "session.created",
			Timestamp: 1000,
			Payload:   json.RawMessage(`{}`),
		},
	}
	catchup := protocol.CatchupResponse{
		Version:      protocol.ProtocolVersion,
		Type:         protocol.TypeSessionCatchup,
		SessionID:    "s1",
		FromSequence: 1,
		ToSequence:   1,
		Events:       events,
	}
	cuData, _ := json.Marshal(catchup)
	var cuDecoded protocol.CatchupResponse
	if err := json.Unmarshal(cuData, &cuDecoded); err != nil || len(cuDecoded.Events) != 1 {
		t.Fatalf("CatchupResponse mismatch: %v", err)
	}

	// 2. LiveEventMessage
	live := protocol.LiveEventMessage{
		Version:   protocol.ProtocolVersion,
		Type:      protocol.TypeSessionEvent,
		SessionID: "s1",
		Event:     events[0],
	}
	liveData, _ := json.Marshal(live)
	var liveDecoded protocol.LiveEventMessage
	if err := json.Unmarshal(liveData, &liveDecoded); err != nil || liveDecoded.Event.Sequence != 1 {
		t.Fatalf("LiveEventMessage mismatch: %v", err)
	}

	// 3. AckResponse
	ack := protocol.AckResponse{
		Version:   protocol.ProtocolVersion,
		Type:      protocol.TypeSessionAck,
		RequestID: "req-1",
		SessionID: "s1",
		Success:   true,
		Data:      json.RawMessage(`{"status":"ok"}`),
	}
	ackData, _ := json.Marshal(ack)
	var ackDecoded protocol.AckResponse
	if err := json.Unmarshal(ackData, &ackDecoded); err != nil || !ackDecoded.Success {
		t.Fatalf("AckResponse mismatch: %v", err)
	}

	// 4. ErrorResponse
	errResp := protocol.ErrorResponse{
		Version:   protocol.ProtocolVersion,
		Type:      protocol.TypeErrorResponse,
		RequestID: "req-err",
		Error:     "invalid transition",
	}
	errData, _ := json.Marshal(errResp)
	var errDecoded protocol.ErrorResponse
	if err := json.Unmarshal(errData, &errDecoded); err != nil || errDecoded.Error != "invalid transition" {
		t.Fatalf("ErrorResponse mismatch: %v", err)
	}
}
