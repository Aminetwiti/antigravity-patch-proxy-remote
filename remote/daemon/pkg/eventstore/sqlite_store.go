package eventstore

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/antigravity/remote-daemon/pkg/domain"
	_ "modernc.org/sqlite"
)

var (
	ErrSessionNotFound = errors.New("session not found")
	ErrDuplicateEvent  = errors.New("duplicate event id")
	ErrStoreClosed     = errors.New("event store is closed")
)

type EventStore interface {
	InitSchema(ctx context.Context) error
	CreateSession(ctx context.Context, session *domain.Session) error
	GetSession(ctx context.Context, sessionID string) (*domain.Session, error)
	ListSessions(ctx context.Context) ([]domain.Session, error)
	UpdateSessionState(ctx context.Context, sessionID string, state domain.SessionState) error
	AppendEvent(ctx context.Context, sessionID, eventID, eventType string, payload []byte) (*domain.Event, error)
	AppendBatch(ctx context.Context, sessionID string, events []domain.Event) ([]domain.Event, error)
	GetEventsSince(ctx context.Context, sessionID string, sinceSeq int64, limit int) ([]domain.Event, error)
	GetLatestSequence(ctx context.Context, sessionID string) (int64, error)
	SaveSnapshot(ctx context.Context, snap *domain.Snapshot) error
	GetLatestSnapshot(ctx context.Context, sessionID string) (*domain.Snapshot, error)
	SaveScheduledJob(ctx context.Context, job *domain.ScheduledJob) error
	GetScheduledJob(ctx context.Context, id string) (*domain.ScheduledJob, error)
	ListScheduledJobs(ctx context.Context) ([]domain.ScheduledJob, error)
	DeleteScheduledJob(ctx context.Context, id string) error
	Close() error
}

type SQLiteEventStore struct {
	db       *sql.DB
	seqLocks sync.Map
}

func NewSQLiteEventStore(dbPath string) (*SQLiteEventStore, error) {
	syncMode := strings.ToUpper(strings.TrimSpace(os.Getenv("AG_DB_SYNCHRONOUS")))
	switch syncMode {
	case "NORMAL", "EXTRA", "OFF":
		// valid explicit options
	default:
		syncMode = "FULL" // MED-02: default to FULL durability in production
	}
	dsn := fmt.Sprintf("file:%s?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=synchronous(%s)", dbPath, syncMode)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("failed to open sqlite db: %w", err)
	}

	db.SetMaxOpenConns(1)

	store := &SQLiteEventStore{
		db: db,
	}

	if err := store.InitSchema(context.Background()); err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to initialize schema: %w", err)
	}

	return store, nil
}

func (s *SQLiteEventStore) getSessionMutex(sessionID string) *sync.Mutex {
	val, _ := s.seqLocks.LoadOrStore(sessionID, &sync.Mutex{})
	return val.(*sync.Mutex)
}

func (s *SQLiteEventStore) InitSchema(ctx context.Context) error {
	schema := `
	CREATE TABLE IF NOT EXISTS servers (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		hostname TEXT NOT NULL,
		platform TEXT NOT NULL,
		version TEXT NOT NULL,
		status TEXT NOT NULL,
		created_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL
	);

	CREATE TABLE IF NOT EXISTS workspaces (
		id TEXT PRIMARY KEY,
		server_id TEXT NOT NULL,
		owner_id TEXT DEFAULT '',
		name TEXT NOT NULL,
		path TEXT NOT NULL,
		repo_url TEXT,
		branch TEXT,
		created_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL
	);

	CREATE TABLE IF NOT EXISTS sessions (
		id TEXT PRIMARY KEY,
		server_id TEXT NOT NULL,
		workspace_id TEXT NOT NULL,
		owner_id TEXT DEFAULT '',
		title TEXT NOT NULL,
		state TEXT NOT NULL,
		last_sequence INTEGER NOT NULL DEFAULT 0,
		created_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL
	);

	CREATE TABLE IF NOT EXISTS events (
		session_id TEXT NOT NULL,
		sequence INTEGER NOT NULL,
		event_id TEXT NOT NULL UNIQUE,
		event_type TEXT NOT NULL,
		timestamp INTEGER NOT NULL,
		payload BLOB NOT NULL,
		PRIMARY KEY (session_id, sequence)
	);

	CREATE INDEX IF NOT EXISTS idx_events_session_seq ON events (session_id, sequence);

	CREATE TABLE IF NOT EXISTS snapshots (
		session_id TEXT NOT NULL,
		sequence INTEGER NOT NULL,
		state TEXT NOT NULL,
		title TEXT NOT NULL,
		pending_data TEXT,
		captured_at INTEGER NOT NULL,
		PRIMARY KEY (session_id, sequence)
	);

	CREATE TABLE IF NOT EXISTS commands (
		command_id TEXT PRIMARY KEY,
		session_id TEXT NOT NULL,
		actor_id TEXT NOT NULL,
		command_type TEXT NOT NULL,
		payload_hash TEXT NOT NULL,
		status TEXT NOT NULL,
		created_at INTEGER NOT NULL
	);

	CREATE TABLE IF NOT EXISTS scheduled_jobs (
		id TEXT PRIMARY KEY,
		owner_id TEXT DEFAULT '',
		workspace_id TEXT NOT NULL,
		session_id TEXT DEFAULT '',
		name TEXT NOT NULL,
		cron_expr TEXT NOT NULL,
		prompt TEXT NOT NULL,
		enabled INTEGER NOT NULL DEFAULT 1,
		next_run_at INTEGER NOT NULL DEFAULT 0,
		last_run_at INTEGER NOT NULL DEFAULT 0,
		last_status TEXT DEFAULT '',
		retry_count INTEGER NOT NULL DEFAULT 0,
		created_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL
	);

	CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_owner ON scheduled_jobs (owner_id);
	`

	_, err := s.db.ExecContext(ctx, schema)
	if err != nil {
		return err
	}
	// Safe backward compatible column migrations
	_, _ = s.db.ExecContext(ctx, "ALTER TABLE sessions ADD COLUMN owner_id TEXT DEFAULT '';")
	_, _ = s.db.ExecContext(ctx, "ALTER TABLE workspaces ADD COLUMN owner_id TEXT DEFAULT '';")
	_, _ = s.db.ExecContext(ctx, "ALTER TABLE scheduled_jobs ADD COLUMN owner_id TEXT DEFAULT '';")
	_, _ = s.db.ExecContext(ctx, "ALTER TABLE scheduled_jobs ADD COLUMN session_id TEXT DEFAULT '';")
	return nil
}

func (s *SQLiteEventStore) CreateSession(ctx context.Context, sess *domain.Session) error {
	now := time.Now()
	if sess.CreatedAt.IsZero() {
		sess.CreatedAt = now
	}
	sess.UpdatedAt = now
	sess.State = domain.SessionStateCreated

	query := `
	INSERT INTO sessions (id, server_id, workspace_id, owner_id, title, state, last_sequence, created_at, updated_at)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
	`
	_, err := s.db.ExecContext(ctx, query,
		sess.ID,
		sess.ServerID,
		sess.WorkspaceID,
		sess.OwnerID,
		sess.Title,
		string(sess.State),
		sess.LastSequence,
		sess.CreatedAt.UnixMilli(),
		sess.UpdatedAt.UnixMilli(),
	)
	return err
}

func (s *SQLiteEventStore) GetSession(ctx context.Context, sessionID string) (*domain.Session, error) {
	query := `
	SELECT id, server_id, workspace_id, owner_id, title, state, last_sequence, created_at, updated_at
	FROM sessions WHERE id = ?;
	`
	row := s.db.QueryRowContext(ctx, query, sessionID)

	var sess domain.Session
	var stateStr string
	var createdMs, updatedMs int64

	err := row.Scan(
		&sess.ID,
		&sess.ServerID,
		&sess.WorkspaceID,
		&sess.OwnerID,
		&sess.Title,
		&stateStr,
		&sess.LastSequence,
		&createdMs,
		&updatedMs,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrSessionNotFound
	}
	if err != nil {
		return nil, err
	}

	sess.State = domain.SessionState(stateStr)
	sess.CreatedAt = time.UnixMilli(createdMs)
	sess.UpdatedAt = time.UnixMilli(updatedMs)

	return &sess, nil
}

func (s *SQLiteEventStore) ListSessions(ctx context.Context) ([]domain.Session, error) {
	query := `
	SELECT id, server_id, workspace_id, owner_id, title, state, last_sequence, created_at, updated_at
	FROM sessions ORDER BY updated_at DESC;
	`
	rows, err := s.db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var sessions []domain.Session
	for rows.Next() {
		var sess domain.Session
		var stateStr string
		var createdMs, updatedMs int64

		if err := rows.Scan(
			&sess.ID,
			&sess.ServerID,
			&sess.WorkspaceID,
			&sess.OwnerID,
			&sess.Title,
			&stateStr,
			&sess.LastSequence,
			&createdMs,
			&updatedMs,
		); err != nil {
			return nil, err
		}

		sess.State = domain.SessionState(stateStr)
		sess.CreatedAt = time.UnixMilli(createdMs)
		sess.UpdatedAt = time.UnixMilli(updatedMs)
		sessions = append(sessions, sess)
	}

	return sessions, rows.Err()
}

func (s *SQLiteEventStore) UpdateSessionState(ctx context.Context, sessionID string, newState domain.SessionState) error {
	mu := s.getSessionMutex(sessionID)
	mu.Lock()
	defer mu.Unlock()

	current, err := s.GetSession(ctx, sessionID)
	if err != nil {
		return err
	}

	if !domain.CanTransition(current.State, newState) {
		return domain.ErrInvalidTransition{From: current.State, To: newState}
	}

	query := `UPDATE sessions SET state = ?, updated_at = ? WHERE id = ?;`
	_, err = s.db.ExecContext(ctx, query, string(newState), time.Now().UnixMilli(), sessionID)
	return err
}

func (s *SQLiteEventStore) AppendEvent(ctx context.Context, sessionID, eventID, eventType string, payload []byte) (*domain.Event, error) {
	mu := s.getSessionMutex(sessionID)
	mu.Lock()
	defer mu.Unlock()

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var currentSeq int64
	err = tx.QueryRowContext(ctx, `SELECT last_sequence FROM sessions WHERE id = ?;`, sessionID).Scan(&currentSeq)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrSessionNotFound
	}
	if err != nil {
		return nil, err
	}

	nextSeq := currentSeq + 1
	nowUnixMicro := time.Now().UnixNano() / 1000

	ev := &domain.Event{
		SessionID: sessionID,
		Sequence:  nextSeq,
		EventID:   eventID,
		Type:      eventType,
		Timestamp: nowUnixMicro,
		Payload:   payload,
	}

	insertQuery := `
	INSERT INTO events (session_id, sequence, event_id, event_type, timestamp, payload)
	VALUES (?, ?, ?, ?, ?, ?);
	`
	_, err = tx.ExecContext(ctx, insertQuery, ev.SessionID, ev.Sequence, ev.EventID, ev.Type, ev.Timestamp, ev.Payload)
	if err != nil {
		return nil, fmt.Errorf("failed to insert event: %w", err)
	}

	updateQuery := `UPDATE sessions SET last_sequence = ?, updated_at = ? WHERE id = ?;`
	_, err = tx.ExecContext(ctx, updateQuery, nextSeq, time.Now().UnixMilli(), sessionID)
	if err != nil {
		return nil, fmt.Errorf("failed to update session last_sequence: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return ev, nil
}

func (s *SQLiteEventStore) AppendBatch(ctx context.Context, sessionID string, events []domain.Event) ([]domain.Event, error) {
	if len(events) == 0 {
		return nil, nil
	}

	mu := s.getSessionMutex(sessionID)
	mu.Lock()
	defer mu.Unlock()

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var currentSeq int64
	err = tx.QueryRowContext(ctx, `SELECT last_sequence FROM sessions WHERE id = ?;`, sessionID).Scan(&currentSeq)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrSessionNotFound
	}
	if err != nil {
		return nil, err
	}

	stmt, err := tx.PrepareContext(ctx, `
		INSERT INTO events (session_id, sequence, event_id, event_type, timestamp, payload)
		VALUES (?, ?, ?, ?, ?, ?);
	`)
	if err != nil {
		return nil, err
	}
	defer stmt.Close()

	now := time.Now().UnixNano() / 1000
	saved := make([]domain.Event, len(events))

	for i, inEv := range events {
		currentSeq++
		ev := inEv
		ev.SessionID = sessionID
		ev.Sequence = currentSeq
		if ev.Timestamp == 0 {
			ev.Timestamp = now
		}

		_, err := stmt.ExecContext(ctx, ev.SessionID, ev.Sequence, ev.EventID, ev.Type, ev.Timestamp, ev.Payload)
		if err != nil {
			return nil, fmt.Errorf("failed to insert batch event at index %d: %w", i, err)
		}
		saved[i] = ev
	}

	updateQuery := `UPDATE sessions SET last_sequence = ?, updated_at = ? WHERE id = ?;`
	_, err = tx.ExecContext(ctx, updateQuery, currentSeq, time.Now().UnixMilli(), sessionID)
	if err != nil {
		return nil, fmt.Errorf("failed to update session sequence after batch: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return saved, nil
}

func (s *SQLiteEventStore) GetEventsSince(ctx context.Context, sessionID string, sinceSeq int64, limit int) ([]domain.Event, error) {
	if limit <= 0 {
		limit = 1000
	}

	query := `
	SELECT session_id, sequence, event_id, event_type, timestamp, payload
	FROM events
	WHERE session_id = ? AND sequence > ?
	ORDER BY sequence ASC
	LIMIT ?;
	`
	rows, err := s.db.QueryContext(ctx, query, sessionID, sinceSeq, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []domain.Event
	for rows.Next() {
		var ev domain.Event
		var payloadBytes []byte
		if err := rows.Scan(&ev.SessionID, &ev.Sequence, &ev.EventID, &ev.Type, &ev.Timestamp, &payloadBytes); err != nil {
			return nil, err
		}
		ev.Payload = payloadBytes
		events = append(events, ev)
	}

	return events, rows.Err()
}

func (s *SQLiteEventStore) GetLatestSequence(ctx context.Context, sessionID string) (int64, error) {
	query := `SELECT last_sequence FROM sessions WHERE id = ?;`
	var seq int64
	err := s.db.QueryRowContext(ctx, query, sessionID).Scan(&seq)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, ErrSessionNotFound
	}
	return seq, err
}

func (s *SQLiteEventStore) SaveSnapshot(ctx context.Context, snap *domain.Snapshot) error {
	dataJSON, err := json.Marshal(snap.PendingData)
	if err != nil {
		return fmt.Errorf("failed to marshal snapshot data: %w", err)
	}

	query := `
	INSERT OR REPLACE INTO snapshots (session_id, sequence, state, title, pending_data, captured_at)
	VALUES (?, ?, ?, ?, ?, ?);
	`
	_, err = s.db.ExecContext(ctx, query,
		snap.SessionID,
		snap.Sequence,
		string(snap.State),
		snap.Title,
		string(dataJSON),
		snap.CapturedAt.UnixMilli(),
	)
	return err
}

func (s *SQLiteEventStore) GetLatestSnapshot(ctx context.Context, sessionID string) (*domain.Snapshot, error) {
	query := `
	SELECT session_id, sequence, state, title, pending_data, captured_at
	FROM snapshots
	WHERE session_id = ?
	ORDER BY sequence DESC
	LIMIT 1;
	`
	row := s.db.QueryRowContext(ctx, query, sessionID)

	var snap domain.Snapshot
	var stateStr, pendingDataStr string
	var capturedMs int64

	err := row.Scan(&snap.SessionID, &snap.Sequence, &stateStr, &snap.Title, &pendingDataStr, &capturedMs)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	snap.State = domain.SessionState(stateStr)
	snap.CapturedAt = time.UnixMilli(capturedMs)
	if pendingDataStr != "" {
		_ = json.Unmarshal([]byte(pendingDataStr), &snap.PendingData)
	}

	return &snap, nil
}

func (s *SQLiteEventStore) SaveScheduledJob(ctx context.Context, job *domain.ScheduledJob) error {
	now := time.Now()
	if job.CreatedAt.IsZero() {
		job.CreatedAt = now
	}
	job.UpdatedAt = now

	enabledInt := 0
	if job.IsEnabled {
		enabledInt = 1
	}

	query := `
	INSERT OR REPLACE INTO scheduled_jobs (
		id, owner_id, workspace_id, session_id, name, cron_expr, prompt,
		enabled, next_run_at, last_run_at, last_status, retry_count, created_at, updated_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
	`
	_, err := s.db.ExecContext(ctx, query,
		job.ID,
		job.OwnerID,
		job.WorkspaceID,
		job.SessionID,
		job.Name,
		job.CronExpression,
		job.Prompt,
		enabledInt,
		job.NextRunAt.UnixMilli(),
		job.LastRunAt.UnixMilli(),
		job.LastStatus,
		job.RetryCount,
		job.CreatedAt.UnixMilli(),
		job.UpdatedAt.UnixMilli(),
	)
	return err
}

func (s *SQLiteEventStore) GetScheduledJob(ctx context.Context, id string) (*domain.ScheduledJob, error) {
	query := `
	SELECT id, owner_id, workspace_id, session_id, name, cron_expr, prompt,
	       enabled, next_run_at, last_run_at, last_status, retry_count, created_at, updated_at
	FROM scheduled_jobs WHERE id = ?;
	`
	row := s.db.QueryRowContext(ctx, query, id)

	var job domain.ScheduledJob
	var enabledInt int
	var nextRunMs, lastRunMs, createdMs, updatedMs int64

	err := row.Scan(
		&job.ID,
		&job.OwnerID,
		&job.WorkspaceID,
		&job.SessionID,
		&job.Name,
		&job.CronExpression,
		&job.Prompt,
		&enabledInt,
		&nextRunMs,
		&lastRunMs,
		&job.LastStatus,
		&job.RetryCount,
		&createdMs,
		&updatedMs,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	job.IsEnabled = enabledInt != 0
	if nextRunMs > 0 {
		job.NextRunAt = time.UnixMilli(nextRunMs)
	}
	if lastRunMs > 0 {
		job.LastRunAt = time.UnixMilli(lastRunMs)
	}
	if createdMs > 0 {
		job.CreatedAt = time.UnixMilli(createdMs)
	}
	if updatedMs > 0 {
		job.UpdatedAt = time.UnixMilli(updatedMs)
	}
	return &job, nil
}

func (s *SQLiteEventStore) ListScheduledJobs(ctx context.Context) ([]domain.ScheduledJob, error) {
	query := `
	SELECT id, owner_id, workspace_id, session_id, name, cron_expr, prompt,
	       enabled, next_run_at, last_run_at, last_status, retry_count, created_at, updated_at
	FROM scheduled_jobs
	ORDER BY created_at ASC;
	`
	rows, err := s.db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var jobs []domain.ScheduledJob
	for rows.Next() {
		var job domain.ScheduledJob
		var enabledInt int
		var nextRunMs, lastRunMs, createdMs, updatedMs int64

		err := rows.Scan(
			&job.ID,
			&job.OwnerID,
			&job.WorkspaceID,
			&job.SessionID,
			&job.Name,
			&job.CronExpression,
			&job.Prompt,
			&enabledInt,
			&nextRunMs,
			&lastRunMs,
			&job.LastStatus,
			&job.RetryCount,
			&createdMs,
			&updatedMs,
		)
		if err != nil {
			return nil, err
		}

		job.IsEnabled = enabledInt != 0
		if nextRunMs > 0 {
			job.NextRunAt = time.UnixMilli(nextRunMs)
		}
		if lastRunMs > 0 {
			job.LastRunAt = time.UnixMilli(lastRunMs)
		}
		if createdMs > 0 {
			job.CreatedAt = time.UnixMilli(createdMs)
		}
		if updatedMs > 0 {
			job.UpdatedAt = time.UnixMilli(updatedMs)
		}
		jobs = append(jobs, job)
	}
	return jobs, rows.Err()
}

func (s *SQLiteEventStore) DeleteScheduledJob(ctx context.Context, id string) error {
	query := `DELETE FROM scheduled_jobs WHERE id = ?;`
	_, err := s.db.ExecContext(ctx, query, id)
	return err
}

func (s *SQLiteEventStore) Close() error {
	_, _ = s.db.Exec("PRAGMA wal_checkpoint(TRUNCATE);")
	return s.db.Close()
}
