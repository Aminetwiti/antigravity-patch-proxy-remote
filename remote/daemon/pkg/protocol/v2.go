package protocol

import (
	"encoding/json"

	"github.com/antigravity/remote-daemon/pkg/domain"
)

const ProtocolVersion = 2

// Types de messages client -> serveur (Commandes v2)
const (
	TypeSessionAttach    = "session.attach"
	TypeSessionCatchupAck = "session.catchup_ack"
	TypeSessionCreate    = "session.create"
	TypeSessionPrompt    = "session.prompt"
	TypeSessionPause     = "session.pause"
	TypeSessionResume    = "session.resume"
	TypeSessionCancel    = "session.cancel"
	TypeApprovalRespond  = "approval.respond"
)

// Types de messages serveur -> client (Événements v2)
const (
	TypeSessionCatchup = "session.catchup"
	TypeSessionEvent   = "session.event"
	TypeSessionAck     = "session.ack"
	TypeErrorResponse  = "session.error"
)

type V2Envelope struct {
	Version      int             `json:"version"`
	Type         string          `json:"type"`
	RequestID    string          `json:"requestId,omitempty"`
	SessionID    string          `json:"sessionId,omitempty"`
	LastSequence int64           `json:"lastSequence,omitempty"`
	Payload      json.RawMessage `json:"payload,omitempty"`
}

type CatchupResponse struct {
	Version      int            `json:"version"`
	Type         string         `json:"type"`
	RequestID    string         `json:"requestId,omitempty"`
	SessionID    string         `json:"sessionId"`
	FromSequence int64          `json:"fromSequence"`
	ToSequence   int64          `json:"toSequence"`
	Events       []domain.Event `json:"events"`
}

type LiveEventMessage struct {
	Version   int          `json:"version"`
	Type      string       `json:"type"`
	SessionID string       `json:"sessionId"`
	Event     domain.Event `json:"event"`
}

type ErrorResponse struct {
	Version   int    `json:"version"`
	Type      string `json:"type"`
	RequestID string `json:"requestId,omitempty"`
	Error     string `json:"error"`
}

type AckResponse struct {
	Version   int             `json:"version"`
	Type      string          `json:"type"`
	RequestID string          `json:"requestId,omitempty"`
	SessionID string          `json:"sessionId,omitempty"`
	Success   bool            `json:"success"`
	Data      json.RawMessage `json:"data,omitempty"`
}

type PromptPayload struct {
	Text string `json:"text"`
}

type ApprovalRespondPayload struct {
	ApprovalID string `json:"approvalId"`
	Approved   bool   `json:"approved"`
	Reason     string `json:"reason,omitempty"`
}

