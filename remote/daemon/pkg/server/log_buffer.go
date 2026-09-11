package server

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"
)

// LogEntry représente un événement de journalisation structuré capturé par le daemon.
type LogEntry struct {
	Timestamp string                 `json:"timestamp"`
	Level     string                 `json:"level"`
	Message   string                 `json:"message"`
	Fields    map[string]interface{} `json:"fields,omitempty"`
}

// LogBuffer est un tampon circulaire thread-safe conservant les N derniers logs en mémoire.
type LogBuffer struct {
	mu      sync.RWMutex
	entries []LogEntry
	maxSize int
}

var (
	globalLogBuffer     *LogBuffer
	globalLogBufferOnce sync.Once
)

// GetGlobalLogBuffer retourne l'instance unique du tampon de logs.
func GetGlobalLogBuffer() *LogBuffer {
	globalLogBufferOnce.Do(func() {
		globalLogBuffer = NewLogBuffer(1000)
	})
	return globalLogBuffer
}

// NewLogBuffer crée un tampon de logs avec une capacité maximale.
func NewLogBuffer(maxSize int) *LogBuffer {
	if maxSize <= 0 {
		maxSize = 1000
	}
	return &LogBuffer{
		entries: make([]LogEntry, 0, maxSize),
		maxSize: maxSize,
	}
}

// Add ajoute une entrée au tampon en écrasant les plus anciennes si plein.
func (b *LogBuffer) Add(entry LogEntry) {
	b.mu.Lock()
	defer b.mu.Unlock()

	if len(b.entries) >= b.maxSize {
		b.entries = b.entries[1:]
	}
	b.entries = append(b.entries, entry)
}

// GetEntries retourne les entrées les plus récentes filtrées.
func (b *LogBuffer) GetEntries(limit int, minLevel string, search string) []LogEntry {
	b.mu.RLock()
	defer b.mu.RUnlock()

	if limit <= 0 || limit > len(b.entries) {
		limit = len(b.entries)
	}

	search = strings.ToLower(strings.TrimSpace(search))
	minLevel = strings.ToUpper(strings.TrimSpace(minLevel))

	result := make([]LogEntry, 0, limit)
	for i := len(b.entries) - 1; i >= 0 && len(result) < limit; i-- {
		e := b.entries[i]
		if minLevel != "" && minLevel != "ALL" && !strings.EqualFold(e.Level, minLevel) {
			continue
		}
		if search != "" && !matchesSearch(e, search) {
			continue
		}
		result = append(result, e)
	}
	return result
}

func matchesSearch(e LogEntry, q string) bool {
	if strings.Contains(strings.ToLower(e.Message), q) {
		return true
	}
	if strings.Contains(strings.ToLower(e.Level), q) {
		return true
	}
	for k, v := range e.Fields {
		if strings.Contains(strings.ToLower(k), q) || strings.Contains(strings.ToLower(fmt.Sprint(v)), q) {
			return true
		}
	}
	return false
}

// LogBufferHandler adapte un slog.Handler pour alimenter automatiquement le LogBuffer.
type LogBufferHandler struct {
	buffer *LogBuffer
	next   slog.Handler
}

// NewLogBufferHandler crée un handler slog branché sur un LogBuffer.
func NewLogBufferHandler(buffer *LogBuffer, next slog.Handler) *LogBufferHandler {
	return &LogBufferHandler{buffer: buffer, next: next}
}

func (h *LogBufferHandler) Enabled(ctx context.Context, level slog.Level) bool {
	if h.next != nil {
		return h.next.Enabled(ctx, level)
	}
	return true
}

func (h *LogBufferHandler) Handle(ctx context.Context, r slog.Record) error {
	fields := make(map[string]interface{})
	r.Attrs(func(a slog.Attr) bool {
		fields[a.Key] = a.Value.Any()
		return true
	})

	entry := LogEntry{
		Timestamp: r.Time.UTC().Format(time.RFC3339),
		Level:     r.Level.String(),
		Message:   r.Message,
		Fields:    fields,
	}
	h.buffer.Add(entry)

	if h.next != nil {
		return h.next.Handle(ctx, r)
	}
	return nil
}

func (h *LogBufferHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	var next slog.Handler
	if h.next != nil {
		next = h.next.WithAttrs(attrs)
	}
	return &LogBufferHandler{buffer: h.buffer, next: next}
}

func (h *LogBufferHandler) WithGroup(name string) slog.Handler {
	var next slog.Handler
	if h.next != nil {
		next = h.next.WithGroup(name)
	}
	return &LogBufferHandler{buffer: h.buffer, next: next}
}
