# Durable Event Store & Event Model

## 1. Design Principles

1. **Monotonically Increasing Sequences**: Sequences are per-session, continuous, and sequential starting at `1`.
2. **Durability First**: Every event is committed to SQLite (Write-Ahead Logging / WAL mode enabled) before acknowledgment or broadcast.
3. **Immutability**: Past events cannot be edited or deleted.
4. **Zero Missing Events**: Reconnecting clients pass their `lastSequence` and receive every missed event in order.

---

## 2. Event Schema

```sql
CREATE TABLE IF NOT EXISTS events (
    session_id TEXT NOT NULL,
    sequence   INTEGER NOT NULL,
    event_id   TEXT NOT NULL UNIQUE,
    type       TEXT NOT NULL,
    timestamp  INTEGER NOT NULL,
    payload    TEXT NOT NULL,
    PRIMARY KEY (session_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_events_session_seq ON events(session_id, sequence);
```

### Event JSON Wire Format
```json
{
  "sessionId": "sess_1757134000_abc123",
  "sequence": 14,
  "eventId": "evt_1757134015000_982",
  "type": "tool.invocation",
  "timestamp": 1757134015000,
  "payload": {
    "tool": "run_command",
    "command": "npm test"
  }
}
```

---

## 3. Append Semantics

To prevent SQLite lock contention under high-frequency writes while maintaining strict sequence ordering:
1. The store uses a **per-session write lock** (`sync.Mutex`).
2. The sequence assignment query executes atomically inside a transaction:
   ```sql
   SELECT COALESCE(MAX(sequence), 0) FROM events WHERE session_id = ?;
   INSERT INTO events (session_id, sequence, event_id, type, timestamp, payload) VALUES (?, ?, ?, ?, ?, ?);
   UPDATE sessions SET last_sequence = ?, updated_at = ? WHERE id = ?;
   ```
3. SQLite WAL mode (`PRAGMA journal_mode=WAL`) and `PRAGMA busy_timeout=5000` ensure non-blocking concurrent reads (catchup replays) while writes proceed sequentially.

---

## 4. Catchup Replay (`GetEventsSince`)

Clients fetch missed events by calling:
`GetEventsSince(ctx, sessionId, fromSeq, limit)`

The SQL query utilizes the composite index `idx_events_session_seq`:
```sql
SELECT session_id, sequence, event_id, type, timestamp, payload
FROM events
WHERE session_id = ? AND sequence > ?
ORDER BY sequence ASC
LIMIT ?;
```

This guarantees:
- Fast logarithmic lookup time even for sessions with 50,000+ events.
- Perfect chronological ordering without needing in-memory sorting.
