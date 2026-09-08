# Remote Protocol v2 Specification

## 1. Overview

**Remote Protocol v2** is a bidirectional, framed JSON-over-WebSocket protocol enabling multiple clients (Desktop, Mobile, Web) to concurrently attach to, observe, and control remote agent sessions.

- **Endpoint**: `/v2/ws`
- **Protocol Version**: `2`
- **Transport**: WebSocket (RFC 6455)

---

## 2. Universal Envelope

All frames sent between client and server share the `V2Envelope` structure:

```typescript
interface V2Envelope {
  version: 2;
  type: string;
  requestId?: string;     // Unique client request ID for command correlation & idempotency
  sessionId?: string;     // Target session identifier
  lastSequence?: number;  // Highest sequence acknowledged by client
  payload?: any;          // Command or event body
}
```

---

## 3. Client Commands

### 3.1 `session.attach`
Attached client requests synchronization with a session.
```json
{
  "version": 2,
  "type": "session.attach",
  "sessionId": "sess_1757134000_abc123",
  "lastSequence": 42
}
```

### 3.2 `session.catchup_ack`
Client informs the server that it has processed events up to sequence N.
```json
{
  "version": 2,
  "type": "session.catchup_ack",
  "sessionId": "sess_1757134000_abc123",
  "lastSequence": 65
}
```

### 3.3 `session.pause` / `session.resume` / `session.cancel`
Control commands targeting the session state machine.
```json
{
  "version": 2,
  "type": "session.pause",
  "requestId": "req_user_pause_991",
  "sessionId": "sess_1757134000_abc123",
  "payload": {
    "reason": "Inspecting terminal outputs manually"
  }
}
```

### 3.4 `session.prompt`
User submits a prompt or instruction into an active session.
```json
{
  "version": 2,
  "type": "session.prompt",
  "requestId": "req_prompt_102",
  "sessionId": "sess_1757134000_abc123",
  "payload": {
    "text": "Run tests and summarize failures"
  }
}
```

---

## 4. Server Responses & Events

### 4.1 `session.catchup`
Sent immediately after `session.attach` to deliver all missed events.
```json
{
  "version": 2,
  "type": "session.catchup",
  "sessionId": "sess_1757134000_abc123",
  "fromSequence": 43,
  "toSequence": 46,
  "events": [
    { "sequence": 43, "type": "agent.thought", "payload": { ... } },
    { "sequence": 44, "type": "tool.call", "payload": { ... } },
    { "sequence": 45, "type": "tool.result", "payload": { ... } },
    { "sequence": 46, "type": "agent.response", "payload": { ... } }
  ]
}
```

### 4.2 `session.event`
Broadcast to all attached clients as events occur in real-time.
```json
{
  "version": 2,
  "type": "session.event",
  "sessionId": "sess_1757134000_abc123",
  "event": {
    "sessionId": "sess_1757134000_abc123",
    "sequence": 47,
    "eventId": "evt_1757134045000_104",
    "type": "agent.thought",
    "timestamp": 1757134045000,
    "payload": {
      "thought": "All unit tests passed successfully."
    }
  }
}
```

### 4.3 `session.ack`
Acknowledges a client command.
```json
{
  "version": 2,
  "type": "session.ack",
  "requestId": "req_user_pause_991",
  "sessionId": "sess_1757134000_abc123",
  "success": true
}
```

### 4.4 `session.error`
Reports an error when a command fails validation or execution.
```json
{
  "version": 2,
  "type": "session.error",
  "requestId": "req_user_pause_991",
  "error": "Invalid session state transition: cannot transition from PAUSED to PAUSED"
}
```

---

## 5. Command Idempotency
Every mutating command includes a `requestId`.
1. The server computes `SHA256(payload)`.
2. If `requestId` was already processed with the **identical payload hash**, the server acknowledges the command immediately with `success: true` without re-executing transitions.
3. If `requestId` was seen with a **different payload**, the server returns `ErrCommandConflict`.
