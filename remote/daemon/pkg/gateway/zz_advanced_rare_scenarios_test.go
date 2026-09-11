package gateway

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/antigravity/remote-daemon/pkg/workspace"
)

// SCÉNARIO 1 : Conflit Git critique en tâche de fond (PromoteShadowWorktree Conflict Abort)
func TestAdvancedScenario1_GitConflictAbortSafety(t *testing.T) {
	tmpDir := t.TempDir()

	cmd := exec.Command("git", "init")
	cmd.Dir = tmpDir
	if err := cmd.Run(); err != nil {
		t.Skip("git not available in environment")
	}
	_ = exec.Command("git", "-C", tmpDir, "config", "user.name", "Tester").Run()
	_ = exec.Command("git", "-C", tmpDir, "config", "user.email", "tester@example.com").Run()
	_ = exec.Command("git", "-C", tmpDir, "config", "core.autocrlf", "false").Run()

	mgr := workspace.NewManager()
	ws, err := mgr.RegisterWorkspace("ws-conflict", "conflict-project", tmpDir)
	if err != nil {
		t.Fatalf("RegisterWorkspace failed: %v", err)
	}

	conflictFile := "conflict.txt"
	_ = mgr.WriteFile(ws.ID, conflictFile, []byte("LIGNE ORIGINALE\n"))
	_, err = mgr.Commit(ws.ID, "commit initial", "")
	if err != nil {
		t.Fatalf("initial commit failed: %v", err)
	}

	sessionID := "sess-hardcore-99"
	shadowWs, cleanup, err := mgr.CreateShadowWorktree(ws.ID, sessionID)
	if err != nil {
		t.Fatalf("CreateShadowWorktree failed: %v", err)
	}
	defer cleanup()

	_ = mgr.WriteFile(shadowWs.ID, conflictFile, []byte("LIGNE MODIFIEE PAR L'AGENT DANS LE SHADOW WORKTREE\n"))
	_, _ = mgr.Commit(shadowWs.ID, "agent commit", "")

	_ = mgr.WriteFile(ws.ID, conflictFile, []byte("LIGNE MODIFIEE PAR LE DEVELOPPEUR SUR MAIN\n"))
	_, _ = mgr.Commit(ws.ID, "dev commit conflictuel", "")

	res, err := mgr.PromoteShadowWorktree(ws.ID, sessionID, "tentative merge", "")
	if err == nil {
		t.Fatalf("expected merge conflict error, but got nil")
	}
	if res != nil && res.Success {
		t.Errorf("expected res.Success to be false")
	}

	diffAfter, err := mgr.Diff(ws.ID)
	if err != nil {
		t.Fatalf("Diff failed: %v", err)
	}
	if !diffAfter.Clean {
		t.Errorf("expected clean repository after merge abort, but found uncommitted conflict files")
	}

	content, _ := mgr.ReadFile(ws.ID, conflictFile)
	if strings.TrimSpace(string(content)) != "LIGNE MODIFIEE PAR LE DEVELOPPEUR SUR MAIN" {
		t.Errorf("main branch content was corrupted! Got: %s", string(content))
	}
}

// SCÉNARIO 2 : Attaque de sécurité par Path Traversal et Symlink malicieux
func TestAdvancedScenario2_Security_PathTraversalAndSymlinkEscape(t *testing.T) {
	mgr := workspace.NewManager()
	tmpDir := t.TempDir()

	ws, err := mgr.RegisterWorkspace("ws-sec", "sec-test", tmpDir)
	if err != nil {
		t.Fatalf("RegisterWorkspace failed: %v", err)
	}

	badPaths := []string{
		"../outside.txt",
		"../../../../etc/passwd",
		"sub/../../../../windows/system32",
		"foo/bar/../../../secret",
	}

	for _, p := range badPaths {
		_, err := mgr.ResolvePath(ws.ID, p)
		if !errors.Is(err, workspace.ErrPathOutsideRoot) {
			t.Errorf("expected ErrPathOutsideRoot for %s, got: %v", p, err)
		}
	}

	outsideDir := t.TempDir()
	secretFile := filepath.Join(outsideDir, "vps_root_secret.key")
	_ = os.WriteFile(secretFile, []byte("SUPER_SECRET_KEY_12345"), 0600)

	symlinkPath := filepath.Join(tmpDir, "evil_symlink")
	errSymlink := os.Symlink(outsideDir, symlinkPath)
	if errSymlink == nil {
		entries, err := mgr.ListDirectory(ws.ID, "", 2)
		if err != nil {
			t.Fatalf("ListDirectory failed: %v", err)
		}
		for _, e := range entries {
			if e.Name == "evil_symlink" {
				t.Errorf("ListDirectory must skip symlinks pointing outside workspace! Found: %v", e)
			}
		}
	}
}

// SCÉNARIO 3 : Fichiers géants, binaires corrompus et protection anti-crash mémoire
func TestAdvancedScenario3_BinaryAndHugeFileProtection(t *testing.T) {
	mgr := workspace.NewManager()
	tmpDir := t.TempDir()

	ws, err := mgr.RegisterWorkspace("ws-files", "files-test", tmpDir)
	if err != nil {
		t.Fatalf("RegisterWorkspace failed: %v", err)
	}

	corruptBlob := []byte{0x00, 0xFF, 0xFE, 0x00, 0x48, 0x65, 0x6C, 0x6C, 0x6F, 0x00, 0x80, 0x81}
	_ = mgr.WriteFile(ws.ID, "blob.bin", corruptBlob)

	results, err := mgr.SearchFiles(ws.ID, "Hello", 10)
	if err != nil {
		t.Fatalf("SearchFiles failed: %v", err)
	}
	if len(results) != 0 {
		t.Errorf("SearchFiles should ignore binary files with null bytes, but got: %+v", results)
	}

	largeData := make([]byte, 10*1024)
	for i := range largeData {
		largeData[i] = 'A'
	}
	if err := mgr.WriteFile(ws.ID, "large.dat", largeData); err != nil {
		t.Fatalf("WriteFile failed: %v", err)
	}

	readData, err := mgr.ReadFile(ws.ID, "large.dat")
	if err != nil {
		t.Fatalf("ReadFile failed: %v", err)
	}
	if len(readData) != len(largeData) {
		t.Errorf("expected %d bytes, got %d", len(largeData), len(readData))
	}
}

// SCÉNARIO 4 : Concurrence massive multi-sessions (Stress Test sans Deadlock)
func TestAdvancedScenario4_ExtremeConcurrencyStress(t *testing.T) {
	mgr := workspace.NewManager()
	tmpDir := t.TempDir()

	ws, err := mgr.RegisterWorkspace("ws-stress", "stress-test", tmpDir)
	if err != nil {
		t.Fatalf("RegisterWorkspace failed: %v", err)
	}

	var wg sync.WaitGroup
	workers := 50
	iterations := 20

	for i := 0; i < workers; i++ {
		wg.Add(1)
		workerID := i
		go func() {
			defer wg.Done()
			for j := 0; j < iterations; j++ {
				filename := fmt.Sprintf("worker_%d.txt", workerID)
				content := fmt.Sprintf("Iteration %d by worker %d\n", j, workerID)

				if err := mgr.WriteFile(ws.ID, filename, []byte(content)); err != nil {
					t.Errorf("concurrent WriteFile failed: %v", err)
					return
				}

				readBack, err := mgr.ReadFile(ws.ID, filename)
				if err != nil {
					t.Errorf("concurrent ReadFile failed: %v", err)
					return
				}
				if len(readBack) == 0 {
					t.Errorf("concurrent ReadFile returned empty content")
					return
				}
			}
		}()
	}

	wg.Wait()

	entries, err := mgr.ListDirectory(ws.ID, "", 1)
	if err != nil {
		t.Fatalf("ListDirectory after stress test failed: %v", err)
	}
	if len(entries) != workers {
		t.Errorf("expected %d files written concurrently, got %d", workers, len(entries))
	}
}

// SCÉNARIO 5 : Synchronisation .env atomique et Prune automatique des worktrees
func TestAdvancedScenario5_SyncEnvAndPruneWorktrees(t *testing.T) {
	mgr := workspace.NewManager()
	tmpDir := t.TempDir()

	ws, err := mgr.RegisterWorkspace("ws-env-prune", "env-prune-test", tmpDir)
	if err != nil {
		t.Fatalf("RegisterWorkspace failed: %v", err)
	}

	// 1. Tester SyncEnv
	secretContent := "DATABASE_URL=postgres://user:pass@localhost:5432/mydb\nAPI_KEY=sk_test_123456\n"
	if err := mgr.SyncEnv(ws.ID, secretContent); err != nil {
		t.Fatalf("SyncEnv failed: %v", err)
	}

	envBytes, err := mgr.ReadFile(ws.ID, ".env")
	if err != nil {
		t.Fatalf("ReadFile .env failed: %v", err)
	}
	if string(envBytes) != secretContent {
		t.Errorf("expected secret content to match exactly, got %s", string(envBytes))
	}

	// 2. Tester PruneWorktrees
	worktreesDir := filepath.Join(tmpDir, "worktrees")
	_ = os.MkdirAll(worktreesDir, 0755)

	// Créer un vieux worktree orphelin
	staleDir := filepath.Join(worktreesDir, "stale_agent_session_1")
	_ = os.MkdirAll(staleDir, 0755)
	_ = os.WriteFile(filepath.Join(staleDir, "dummy.txt"), []byte("stale"), 0644)

	// Simuler une date de modification ancienne (ex: il y a 72 heures)
	pastTime := time.Now().Add(-72 * time.Hour)
	_ = os.Chtimes(staleDir, pastTime, pastTime)

	// Créer un worktree tout neuf (ex: il y a 10 minutes)
	freshDir := filepath.Join(worktreesDir, "fresh_agent_session_2")
	_ = os.MkdirAll(freshDir, 0755)
	_ = os.WriteFile(filepath.Join(freshDir, "dummy.txt"), []byte("fresh"), 0644)

	// Exécuter PruneWorktrees avec une limite de 48 heures
	pruned, err := mgr.PruneWorktrees(tmpDir, 48*time.Hour)
	if err != nil {
		t.Fatalf("PruneWorktrees failed: %v", err)
	}

	if pruned != 1 {
		t.Errorf("expected exactly 1 stale worktree pruned, got %d", pruned)
	}

	// Vérifier que le dossier frais existe toujours
	if _, err := os.Stat(freshDir); os.IsNotExist(err) {
		t.Errorf("fresh worktree was erroneously pruned!")
	}

	// Vérifier que le dossier ancien a bien été supprimé
	if _, err := os.Stat(staleDir); !os.IsNotExist(err) {
		t.Errorf("stale worktree was not pruned from disk!")
	}
}

// SCÉNARIO 6 : Auto-détection de runtime polyglot (Node/Next.js, Python, Go)
func TestAdvancedScenario6_DetectRuntime(t *testing.T) {
	mgr := workspace.NewManager()
	tmpDir := t.TempDir()

	// 1. Simuler un projet Next.js
	nextDir := filepath.Join(tmpDir, "my-next-app")
	_ = os.MkdirAll(nextDir, 0755)
	pkgJSON := `{
		"name": "my-next-app",
		"scripts": {
			"build": "next build",
			"test": "jest"
		},
		"dependencies": {
			"next": "^14.2.0",
			"react": "^18.2.0"
		}
	}`
	_ = os.WriteFile(filepath.Join(nextDir, "package.json"), []byte(pkgJSON), 0644)
	_ = os.WriteFile(filepath.Join(nextDir, "pnpm-lock.yaml"), []byte("lockfileVersion: '6.0'"), 0644)

	wsNext, err := mgr.RegisterWorkspace("ws-next", "next-app", nextDir)
	if err != nil {
		t.Fatalf("RegisterWorkspace failed: %v", err)
	}

	info, err := mgr.DetectRuntime(wsNext.ID)
	if err != nil {
		t.Fatalf("DetectRuntime failed: %v", err)
	}

	if info.Language != "nodejs" {
		t.Errorf("expected language nodejs, got %s", info.Language)
	}
	if info.PackageManager != "pnpm" {
		t.Errorf("expected packageManager pnpm, got %s", info.PackageManager)
	}
	if info.Framework != "nextjs" {
		t.Errorf("expected framework nextjs, got %s", info.Framework)
	}
	if !info.HasTests || info.TestCommand != "pnpm test" {
		t.Errorf("expected testCommand 'pnpm test', got %s", info.TestCommand)
	}
	if info.BuildCommand != "pnpm run build" {
		t.Errorf("expected buildCommand 'pnpm run build', got %s", info.BuildCommand)
	}
}

// SCÉNARIO 7 : Neutralisation des processus zombies et sonde d'écriture Git
func TestAdvancedScenario7_KillProcessTreeAndWriteProbe(t *testing.T) {
	// 1. Tester KillProcessTree sur un processus en tâche de fond
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.Command("ping", "-n", "10", "127.0.0.1")
	} else {
		cmd = exec.Command("sleep", "10")
	}

	if err := cmd.Start(); err != nil {
		t.Fatalf("failed to start background process: %v", err)
	}

	pid := cmd.Process.Pid
	if pid <= 0 {
		t.Fatalf("invalid pid: %d", pid)
	}

	// Tuer l'arbre de processus
	if err := workspace.KillProcessTree(cmd); err != nil {
		t.Errorf("KillProcessTree returned error: %v", err)
	}

	// Attendre que le processus soit bien terminé
	_ = cmd.Wait()

	// 2. Tester ProbeWriteAccess sur un dépôt local sans remote
	mgr := workspace.NewManager()
	tmpDir := t.TempDir()
	initCmd := exec.Command("git", "init")
	initCmd.Dir = tmpDir
	_ = initCmd.Run()

	ws, err := mgr.RegisterWorkspace("ws-probe", "probe-app", tmpDir)
	if err != nil {
		t.Fatalf("RegisterWorkspace failed: %v", err)
	}

	// ProbeWriteAccess doit gérer l'absence d'origin sans paniquer
	_ = mgr.ProbeWriteAccess(context.Background(), ws.ID)
}

// SCÉNARIO 8 : Idempotence stricte des commandes et rattrapage d'événements après reconnexion
func TestAdvancedScenario8_CommandIdempotencyAndEventReplay(t *testing.T) {
	backend := &fakeRPCClient{}
	srv, gw := newTestServerWithGW(backend)
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"
	client := dialWS(t, wsURL)
	defer client.conn.Close()

	// 1. Simuler l'envoi d'une commande avec commandId
	cmdPayload := `{"type":"send_prompt","requestId":"r_idemp_1","commandId":"cmd_8a91","cascadeId":"casc-test","prompt":"hello"}`
	client.sendRaw(t, cmdPayload)

	// Consommer les messages du stream initial
	for {
		msg := client.recv(t)
		if msg["type"] == "stream_end" || msg["type"] == "error" || msg["type"] == "response" {
			break
		}
	}

	// 2. Ré-envoyer EXACTEMENT la même commande avec le même commandId (simulation retry réseau/timeout)
	client.sendRaw(t, cmdPayload)
	duplicateResp := client.recv(t)

	// L'invariant 4 impose qu'aucun second tour ne soit démarré : statut already_processed immédiat
	if duplicateResp["type"] != "response" {
		t.Fatalf("expected response type, got: %v", duplicateResp["type"])
	}
	dataMap, _ := duplicateResp["data"].(map[string]interface{})
	if dataMap["status"] != "already_processed" {
		t.Errorf("expected status 'already_processed', got: %v", dataMap["status"])
	}

	// 3. Simuler une reconnexion après coupure avec afterSequence
	gw.streamBuffer.RecordEvent("casc-test", OutgoingMessage{Type: "stream_delta", Data: map[string]interface{}{"delta": "1"}})
	gw.streamBuffer.RecordEvent("casc-test", OutgoingMessage{Type: "stream_delta", Data: map[string]interface{}{"delta": "2"}})
	gw.streamBuffer.RecordEvent("casc-test", OutgoingMessage{Type: "stream_delta", Data: map[string]interface{}{"delta": "3"}})

	client2 := dialWS(t, wsURL)
	defer client2.conn.Close()

	// Reconnexion demandant le flux manqué depuis la séquence 1
	client2.sendRaw(t, `{"type":"resume","requestId":"req_reconnect","cascadeId":"casc-test","data":{"afterSequence":1}}`)
	reconnectMsg := client2.recv(t)

	if reconnectMsg["type"] != "sync_catchup" {
		t.Fatalf("expected sync_catchup, got: %v", reconnectMsg["type"])
	}
	syncData, _ := reconnectMsg["Data"].(map[string]interface{})
	if syncData == nil {
		syncData, _ = reconnectMsg["data"].(map[string]interface{})
	}
	missed, _ := syncData["missedEvents"].([]interface{})
	if len(missed) != 2 {
		t.Errorf("expected 2 missed events since seq 1, got: %d", len(missed))
	}
}

