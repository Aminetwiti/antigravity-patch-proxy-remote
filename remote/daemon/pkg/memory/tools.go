package memory

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/antigravity/remote-daemon/pkg/tools"
)

// -----------------------------------------------------------------------------
// Tool: store_memory
// -----------------------------------------------------------------------------

type StoreMemoryTool struct {
	store *MemoryStore
}

func NewStoreMemoryTool(store *MemoryStore) *StoreMemoryTool {
	return &StoreMemoryTool{store: store}
}

type StoreMemoryParams struct {
	Category string   `json:"category"`
	Key      string   `json:"key"`
	Content  string   `json:"content"`
	Tags     []string `json:"tags,omitempty"`
}

func (t *StoreMemoryTool) Name() string { return "store_memory" }
func (t *StoreMemoryTool) Description() string {
	return "Stores a durable piece of knowledge, architectural decision, code convention, or project fact in long-term memory."
}

func (t *StoreMemoryTool) ParametersSchema() map[string]interface{} {
	return map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"category": map[string]interface{}{
				"type":        "string",
				"description": "Category of memory: 'architecture', 'convention', 'preference', 'learning'.",
				"enum":        []string{"architecture", "convention", "preference", "learning"},
			},
			"key": map[string]interface{}{
				"type":        "string",
				"description": "Unique key or title for the memory (e.g. 'build_script', 'auth_flow').",
			},
			"content": map[string]interface{}{
				"type":        "string",
				"description": "The detailed content, decision, or instruction to remember.",
			},
			"tags": map[string]interface{}{
				"type":        "array",
				"items":       map[string]interface{}{"type": "string"},
				"description": "Optional search tags.",
			},
		},
		"required": []string{"category", "key", "content"},
	}
}

func (t *StoreMemoryTool) RequiresApproval(params json.RawMessage) bool {
	return false
}

func (t *StoreMemoryTool) Execute(ctx context.Context, sessionID, workspaceID string, params json.RawMessage, onChunk func(chunk []byte)) (*tools.ToolResult, error) {
	if t.store == nil {
		return &tools.ToolResult{Success: false, Error: "memory store is not initialized"}, nil
	}

	var p StoreMemoryParams
	if err := json.Unmarshal(params, &p); err != nil {
		return &tools.ToolResult{Success: false, Error: "invalid parameters: " + err.Error()}, nil
	}

	mem, err := t.store.Store(ctx, p.Category, p.Key, p.Content, p.Tags)
	if err != nil {
		return &tools.ToolResult{Success: false, Error: err.Error()}, nil
	}

	out := fmt.Sprintf("Saved memory [%s] %s (id: %s)", mem.Category, mem.Key, mem.ID)
	if onChunk != nil {
		onChunk([]byte(out))
	}

	return &tools.ToolResult{
		Success: true,
		Output:  out,
	}, nil
}

// -----------------------------------------------------------------------------
// Tool: recall_memory
// -----------------------------------------------------------------------------

type RecallMemoryTool struct {
	store *MemoryStore
}

func NewRecallMemoryTool(store *MemoryStore) *RecallMemoryTool {
	return &RecallMemoryTool{store: store}
}

type RecallMemoryParams struct {
	Category string `json:"category,omitempty"`
	Query    string `json:"query,omitempty"`
	Limit    int    `json:"limit,omitempty"`
}

func (t *RecallMemoryTool) Name() string { return "recall_memory" }
func (t *RecallMemoryTool) Description() string {
	return "Queries long-term memory for stored architectural decisions, conventions, preferences, or past solutions."
}

func (t *RecallMemoryTool) ParametersSchema() map[string]interface{} {
	return map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"category": map[string]interface{}{
				"type":        "string",
				"description": "Optional filter category ('architecture', 'convention', 'preference', 'learning').",
			},
			"query": map[string]interface{}{
				"type":        "string",
				"description": "Optional keyword query to search key, content, or tags.",
			},
			"limit": map[string]interface{}{
				"type":        "integer",
				"description": "Maximum number of memories to return (default: 5).",
			},
		},
	}
}

func (t *RecallMemoryTool) RequiresApproval(params json.RawMessage) bool {
	return false
}

func (t *RecallMemoryTool) Execute(ctx context.Context, sessionID, workspaceID string, params json.RawMessage, onChunk func(chunk []byte)) (*tools.ToolResult, error) {
	if t.store == nil {
		return &tools.ToolResult{Success: false, Error: "memory store is not initialized"}, nil
	}

	var p RecallMemoryParams
	if len(params) > 0 && string(params) != "{}" {
		_ = json.Unmarshal(params, &p)
	}

	limit := p.Limit
	if limit <= 0 {
		limit = 5
	} else if limit > 20 {
		limit = 20
	}

	memories, err := t.store.Recall(ctx, p.Category, p.Query, limit)
	if err != nil {
		return &tools.ToolResult{Success: false, Error: err.Error()}, nil
	}

	if len(memories) == 0 {
		out := "No memories found matching the query."
		if onChunk != nil {
			onChunk([]byte(out))
		}
		return &tools.ToolResult{Success: true, Output: out}, nil
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Recalled %d memory items:\n\n", len(memories)))
	for i, m := range memories {
		tags := ""
		if len(m.Tags) > 0 {
			tags = fmt.Sprintf(" (tags: %s)", strings.Join(m.Tags, ", "))
		}
		sb.WriteString(fmt.Sprintf("%d. [%s] %s%s\n   %s\n\n", i+1, m.Category, m.Key, tags, m.Content))
	}

	out := strings.TrimSpace(sb.String())
	if onChunk != nil {
		onChunk([]byte(out))
	}

	return &tools.ToolResult{
		Success: true,
		Output:  out,
	}, nil
}
