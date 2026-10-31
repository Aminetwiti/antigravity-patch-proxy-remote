package memory

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	_ "modernc.org/sqlite"
)

var memIDCounter uint64

type Memory struct {
	ID        string    `json:"id"`
	Category  string    `json:"category"` // e.g. "architecture", "convention", "preference", "learning"
	Key       string    `json:"key"`
	Content   string    `json:"content"`
	Tags      []string  `json:"tags"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type MemoryStore struct {
	db *sql.DB
	mu sync.RWMutex
}

func NewMemoryStore(dbPath string) (*MemoryStore, error) {
	dsn := fmt.Sprintf("file:%s?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=synchronous(NORMAL)", dbPath)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("failed to open memory sqlite db: %w", err)
	}

	db.SetMaxOpenConns(1)

	s := &MemoryStore{db: db}
	if err := s.initSchema(context.Background()); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("failed to init memory schema: %w", err)
	}

	return s, nil
}

func (s *MemoryStore) initSchema(ctx context.Context) error {
	schema := `
	CREATE TABLE IF NOT EXISTS agent_memories (
		id TEXT PRIMARY KEY,
		category TEXT NOT NULL,
		key TEXT NOT NULL,
		content TEXT NOT NULL,
		tags TEXT NOT NULL,
		created_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL
	);
	CREATE INDEX IF NOT EXISTS idx_memories_cat ON agent_memories(category);
	CREATE INDEX IF NOT EXISTS idx_memories_key ON agent_memories(key);
	`
	_, err := s.db.ExecContext(ctx, schema)
	return err
}

func (s *MemoryStore) Store(ctx context.Context, category, key, content string, tags []string) (*Memory, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	category = strings.ToLower(strings.TrimSpace(category))
	if category == "" {
		category = "learning"
	}
	key = strings.TrimSpace(key)
	if key == "" {
		key = fmt.Sprintf("mem_%d", time.Now().UnixNano())
	}
	content = strings.TrimSpace(content)

	tagsStr := strings.Join(tags, ",")
	now := time.Now()

	// Check if key already exists in category -> update
	var existingID string
	var createdAtMs int64
	checkQuery := `SELECT id, created_at FROM agent_memories WHERE category = ? AND key = ? LIMIT 1;`
	err := s.db.QueryRowContext(ctx, checkQuery, category, key).Scan(&existingID, &createdAtMs)

	id := existingID
	createdAt := now
	if err == nil {
		// Update existing
		updateQuery := `
		UPDATE agent_memories
		SET content = ?, tags = ?, updated_at = ?
		WHERE id = ?;
		`
		_, err := s.db.ExecContext(ctx, updateQuery, content, tagsStr, now.UnixMilli(), id)
		if err != nil {
			return nil, fmt.Errorf("failed to update memory: %w", err)
		}
		createdAt = time.UnixMilli(createdAtMs)
	} else {
		// Insert new
		id = fmt.Sprintf("mem_%d_%d", now.UnixNano(), atomic.AddUint64(&memIDCounter, 1))
		insertQuery := `
		INSERT INTO agent_memories (id, category, key, content, tags, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?);
		`
		_, err := s.db.ExecContext(ctx, insertQuery, id, category, key, content, tagsStr, now.UnixMilli(), now.UnixMilli())
		if err != nil {
			return nil, fmt.Errorf("failed to insert memory: %w", err)
		}
	}

	return &Memory{
		ID:        id,
		Category:  category,
		Key:       key,
		Content:   content,
		Tags:      tags,
		CreatedAt: createdAt,
		UpdatedAt: now,
	}, nil
}

func (s *MemoryStore) Recall(ctx context.Context, category, query string, limit int) ([]Memory, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if limit <= 0 {
		limit = 10
	}

	var rows *sql.Rows
	var err error

	category = strings.ToLower(strings.TrimSpace(category))
	query = strings.ToLower(strings.TrimSpace(query))

	if category != "" && query != "" {
		sqlQuery := `
		SELECT id, category, key, content, tags, created_at, updated_at
		FROM agent_memories
		WHERE category = ? AND (LOWER(key) LIKE ? OR LOWER(content) LIKE ? OR LOWER(tags) LIKE ?)
		ORDER BY updated_at DESC
		LIMIT ?;
		`
		pattern := "%" + query + "%"
		rows, err = s.db.QueryContext(ctx, sqlQuery, category, pattern, pattern, pattern, limit)
	} else if category != "" {
		sqlQuery := `
		SELECT id, category, key, content, tags, created_at, updated_at
		FROM agent_memories
		WHERE category = ?
		ORDER BY updated_at DESC
		LIMIT ?;
		`
		rows, err = s.db.QueryContext(ctx, sqlQuery, category, limit)
	} else if query != "" {
		sqlQuery := `
		SELECT id, category, key, content, tags, created_at, updated_at
		FROM agent_memories
		WHERE LOWER(key) LIKE ? OR LOWER(content) LIKE ? OR LOWER(tags) LIKE ?
		ORDER BY updated_at DESC
		LIMIT ?;
		`
		pattern := "%" + query + "%"
		rows, err = s.db.QueryContext(ctx, sqlQuery, pattern, pattern, pattern, limit)
	} else {
		sqlQuery := `
		SELECT id, category, key, content, tags, created_at, updated_at
		FROM agent_memories
		ORDER BY updated_at DESC
		LIMIT ?;
		`
		rows, err = s.db.QueryContext(ctx, sqlQuery, limit)
	}

	if err != nil {
		return nil, fmt.Errorf("failed to query memories: %w", err)
	}
	defer rows.Close()

	var memories []Memory
	for rows.Next() {
		var m Memory
		var tagsStr string
		var createdMs, updatedMs int64

		if err := rows.Scan(&m.ID, &m.Category, &m.Key, &m.Content, &tagsStr, &createdMs, &updatedMs); err != nil {
			return nil, err
		}

		if tagsStr != "" {
			m.Tags = strings.Split(tagsStr, ",")
		} else {
			m.Tags = []string{}
		}
		m.CreatedAt = time.UnixMilli(createdMs)
		m.UpdatedAt = time.UnixMilli(updatedMs)
		memories = append(memories, m)
	}

	return memories, rows.Err()
}

func (s *MemoryStore) List(ctx context.Context, category string) ([]Memory, error) {
	return s.Recall(ctx, category, "", 100)
}

func (s *MemoryStore) Delete(ctx context.Context, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	_, err := s.db.ExecContext(ctx, `DELETE FROM agent_memories WHERE id = ?;`, id)
	return err
}

func (s *MemoryStore) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.db.Close()
}
