package memory_test

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	"github.com/antigravity/remote-daemon/pkg/memory"
)

func setupTestMemoryStore(t *testing.T) (*memory.MemoryStore, func()) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test_memory.db")

	store, err := memory.NewMemoryStore(dbPath)
	if err != nil {
		t.Fatalf("failed to create memory store: %v", err)
	}

	cleanup := func() {
		_ = store.Close()
	}

	return store, cleanup
}

func TestMemoryStore_StoreAndRecall(t *testing.T) {
	store, cleanup := setupTestMemoryStore(t)
	defer cleanup()

	ctx := context.Background()

	// 1. Store architectural decision
	mem1, err := store.Store(ctx, "architecture", "database_choice", "We use pure SQLite with modernc for zero CGO.", []string{"sqlite", "cgo", "database"})
	if err != nil {
		t.Fatalf("unexpected error storing memory: %v", err)
	}
	if mem1.Key != "database_choice" {
		t.Errorf("expected key 'database_choice', got '%s'", mem1.Key)
	}

	// 2. Store convention
	_, err = store.Store(ctx, "convention", "lazy_dev_rules", "Ponytail rule: YAGNI, standard library first, shortest diff.", []string{"ponytail", "style"})
	if err != nil {
		t.Fatalf("unexpected error storing memory: %v", err)
	}

	// 3. Recall by category
	archList, err := store.Recall(ctx, "architecture", "", 10)
	if err != nil {
		t.Fatalf("failed recalling by category: %v", err)
	}
	if len(archList) != 1 || archList[0].Key != "database_choice" {
		t.Fatalf("expected 1 architecture memory, got %d", len(archList))
	}

	// 4. Recall by query keyword
	keywordList, err := store.Recall(ctx, "", "ponytail", 10)
	if err != nil {
		t.Fatalf("failed recalling by keyword: %v", err)
	}
	if len(keywordList) != 1 || keywordList[0].Key != "lazy_dev_rules" {
		t.Fatalf("expected 1 keyword match, got %d", len(keywordList))
	}

	// 5. Update existing key
	updated, err := store.Store(ctx, "architecture", "database_choice", "Updated: SQLite WAL mode enabled with modernc.", []string{"sqlite", "wal"})
	if err != nil {
		t.Fatalf("failed to update memory: %v", err)
	}
	if updated.ID != mem1.ID {
		t.Errorf("expected ID to remain identical on update, got %s vs %s", updated.ID, mem1.ID)
	}
	if !strings.Contains(updated.Content, "WAL mode") {
		t.Errorf("expected updated content, got %s", updated.Content)
	}

	// 6. Delete
	if err := store.Delete(ctx, mem1.ID); err != nil {
		t.Fatalf("failed to delete memory: %v", err)
	}
	afterDelete, _ := store.Recall(ctx, "architecture", "", 10)
	if len(afterDelete) != 0 {
		t.Errorf("expected 0 memories after delete, got %d", len(afterDelete))
	}
}

func TestMemoryTools_Execute(t *testing.T) {
	store, cleanup := setupTestMemoryStore(t)
	defer cleanup()

	ctx := context.Background()

	storeTool := memory.NewStoreMemoryTool(store)
	recallTool := memory.NewRecallMemoryTool(store)

	// 1. Store via tool
	storeParams, _ := json.Marshal(map[string]interface{}{
		"category": "preference",
		"key":      "terminal_shell",
		"content":  "User prefers bash on Linux and powershell on Windows.",
		"tags":     []string{"shell", "terminal"},
	})
	res, err := storeTool.Execute(ctx, "sess-1", "ws-1", storeParams, nil)
	if err != nil || !res.Success {
		t.Fatalf("expected store tool success, err: %v, res: %+v", err, res)
	}

	// 2. Recall via tool
	recallParams, _ := json.Marshal(map[string]interface{}{
		"query": "powershell",
	})
	recallRes, err := recallTool.Execute(ctx, "sess-1", "ws-1", recallParams, nil)
	if err != nil || !recallRes.Success {
		t.Fatalf("expected recall tool success, err: %v, res: %+v", err, recallRes)
	}

	if !strings.Contains(recallRes.Output, "User prefers bash") {
		t.Errorf("expected recalled text to contain preference, got:\n%s", recallRes.Output)
	}
}
