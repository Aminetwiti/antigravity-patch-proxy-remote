package agent_test

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/antigravity/remote-daemon/pkg/agent"
	"github.com/antigravity/remote-daemon/pkg/approval"
	"github.com/antigravity/remote-daemon/pkg/domain"
	"github.com/antigravity/remote-daemon/pkg/eventstore"
	"github.com/antigravity/remote-daemon/pkg/session"
	"github.com/antigravity/remote-daemon/pkg/tools"
	"github.com/antigravity/remote-daemon/pkg/workspace"
)

type dynamicMockLLM struct {
	fn func(messages []agent.LLMMessage) *agent.LLMResponse
	mu sync.Mutex
}

func (d *dynamicMockLLM) Generate(ctx context.Context, messages []agent.LLMMessage, availableTools []tools.ToolDefinition, onChunk func(chunk string)) (*agent.LLMResponse, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.fn(messages), nil
}

func TestMultiSessionWorktreeIsolationInEngine(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not installed")
	}

	tmpDir := t.TempDir()
	baseRepoDir := filepath.Join(tmpDir, "base_repo")
	_ = os.MkdirAll(baseRepoDir, 0755)

	runGit := func(dir string, args ...string) {
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(),
			"GIT_AUTHOR_NAME=Audit",
			"GIT_AUTHOR_EMAIL=audit@antigravity.internal",
			"GIT_COMMITTER_NAME=Audit",
			"GIT_COMMITTER_EMAIL=audit@antigravity.internal",
		)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v failed: %s (%v)", args, string(out), err)
		}
	}

	runGit(baseRepoDir, "init")
	runGit(baseRepoDir, "config", "user.name", "Audit")
	runGit(baseRepoDir, "config", "user.email", "audit@antigravity.internal")
	runGit(baseRepoDir, "config", "core.autocrlf", "false")

	_ = os.WriteFile(filepath.Join(baseRepoDir, "seed.txt"), []byte("seed"), 0644)
	runGit(baseRepoDir, "add", "seed.txt")
	runGit(baseRepoDir, "commit", "-m", "Initial commit")

	dbPath := filepath.Join(tmpDir, "test.db")
	store, err := eventstore.NewSQLiteEventStore(dbPath)
	if err != nil {
		t.Fatalf("init store failed: %v", err)
	}
	defer store.Close()

	sessionSvc := session.NewService(store, nil)
	wsMgr := workspace.NewManager()
	baseWs, _ := wsMgr.RegisterWorkspace("default", "Base Repository", baseRepoDir)

	toolsReg := tools.NewRegistry(wsMgr, true)
	apprMgr := approval.NewManager(sessionSvc, 5*time.Second)

	mockLLM := &dynamicMockLLM{
		fn: func(messages []agent.LLMMessage) *agent.LLMResponse {
			isSessionA := false
			for _, m := range messages {
				if strings.Contains(m.Content, "turn A") {
					isSessionA = true
					break
				}
			}

			if isSessionA {
				for _, m := range messages {
					if m.Role == "tool" {
						return &agent.LLMResponse{Done: true, Message: "Done A"}
					}
				}
				return &agent.LLMResponse{
					Message: "Writing marker A",
					ToolCalls: []agent.ToolCall{
						{
							ID:   "call_a",
							Name: "write_to_file",
							Arguments: json.RawMessage(`{
								"path": "isolation-marker-A.txt",
								"content": "CONTENT_A"
							}`),
						},
					},
				}
			}

			for _, m := range messages {
				if m.Role == "tool" {
					return &agent.LLMResponse{Done: true, Message: "Done B"}
				}
			}
			return &agent.LLMResponse{
				Message: "Writing marker B",
				ToolCalls: []agent.ToolCall{
					{
						ID:   "call_b",
						Name: "write_to_file",
						Arguments: json.RawMessage(`{
							"path": "isolation-marker-B.txt",
							"content": "CONTENT_B"
						}`),
					},
				},
			}
		},
	}

	eng := agent.NewEngine(sessionSvc, wsMgr, toolsReg, apprMgr, mockLLM)
	eng.SetGitPolicy(agent.GitPolicy{Commit: "auto"})

	sessA, _ := sessionSvc.CreateSession(context.Background(), "srv-1", baseWs.ID, "Session A")
	sessB, _ := sessionSvc.CreateSession(context.Background(), "srv-1", baseWs.ID, "Session B")

	// Start turns concurrently
	ctx := context.Background()
	_ = eng.StartTurn(ctx, sessA.ID, "start turn A")
	_ = eng.StartTurn(ctx, sessB.ID, "start turn B")

	// Wait for both turns to complete
	deadline := time.Now().Add(6 * time.Second)
	for time.Now().Before(deadline) {
		sA, _ := sessionSvc.GetSession(ctx, sessA.ID)
		sB, _ := sessionSvc.GetSession(ctx, sessB.ID)
		if sA != nil && sB != nil && sA.State == domain.SessionStateWaitingInput && sB.State == domain.SessionStateWaitingInput {
			break
		}
		time.Sleep(30 * time.Millisecond)
	}

	// VERIFY: Base repository must remain clean! Markers MUST NOT exist in base repository
	if _, err := os.Stat(filepath.Join(baseRepoDir, "isolation-marker-A.txt")); err == nil {
		t.Fatalf("FATAL VIOLATION: isolation-marker-A.txt was written directly into base repository!")
	}
	if _, err := os.Stat(filepath.Join(baseRepoDir, "isolation-marker-B.txt")); err == nil {
		t.Fatalf("FATAL VIOLATION: isolation-marker-B.txt was written directly into base repository!")
	}

	// Verify Worktree A has Marker A and not Marker B
	cleanIDA := strings.ReplaceAll(sessA.ID, "-", "_")
	shadowWsIDA := "shadow_" + baseWs.ID + "_" + cleanIDA
	wsA, err := wsMgr.GetWorkspace(shadowWsIDA)
	if err != nil {
		t.Fatalf("Worktree for Session A not found: %v", err)
	}
	dataA, err := wsMgr.ReadFile(wsA.ID, "isolation-marker-A.txt")
	if err != nil || string(dataA) != "CONTENT_A" {
		t.Fatalf("Worktree A should contain marker A: %v", err)
	}
	if _, err := wsMgr.ReadFile(wsA.ID, "isolation-marker-B.txt"); err == nil {
		t.Fatalf("FATAL VIOLATION: Worktree A contains isolation-marker-B.txt from Session B!")
	}

	// Verify Worktree B has Marker B and not Marker A
	cleanIDB := strings.ReplaceAll(sessB.ID, "-", "_")
	shadowWsIDB := "shadow_" + baseWs.ID + "_" + cleanIDB
	wsB, err := wsMgr.GetWorkspace(shadowWsIDB)
	if err != nil {
		t.Fatalf("Worktree for Session B not found: %v", err)
	}
	dataB, err := wsMgr.ReadFile(wsB.ID, "isolation-marker-B.txt")
	if err != nil || string(dataB) != "CONTENT_B" {
		t.Fatalf("Worktree B should contain marker B: %v", err)
	}
	if _, err := wsMgr.ReadFile(wsB.ID, "isolation-marker-A.txt"); err == nil {
		t.Fatalf("FATAL VIOLATION: Worktree B contains isolation-marker-A.txt from Session A!")
	}
}
