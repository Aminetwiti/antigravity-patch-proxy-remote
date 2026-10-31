package gateway

import (
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/antigravity/remote-daemon/pkg/connectrpc"
	"github.com/antigravity/remote-daemon/pkg/eventstore"
)

// countingRPCClient compte le nombre réel d'exécutions de streams
type countingRPCClient struct {
	fakeRPCClient
	executions int64
}

func (c *countingRPCClient) SendMessageStream(cascadeID, text string, onFrame func([]byte) error) error {
	atomic.AddInt64(&c.executions, 1)
	return c.fakeRPCClient.SendMessageStream(cascadeID, text, onFrame)
}

func (c *countingRPCClient) SendMessageStreamModel(cascadeID, text, modelUID string, modelEnum uint64, onFrame func([]byte) error, noTools ...bool) error {
	atomic.AddInt64(&c.executions, 1)
	return c.fakeRPCClient.SendMessageStreamModel(cascadeID, text, modelUID, modelEnum, onFrame, noTools...)
}

func (c *countingRPCClient) SendMessageStreamModelWithMedia(cascadeID, text, modelUID string, modelEnum uint64, media []connectrpc.MediaAttachment, onFrame func([]byte) error, noTools ...bool) error {
	atomic.AddInt64(&c.executions, 1)
	return c.fakeRPCClient.SendMessageStreamModelWithMedia(cascadeID, text, modelUID, modelEnum, media, onFrame, noTools...)
}

// TestBreak_CommandID_PayloadMismatch_MustBeRefused prouve que réutiliser un
// commandId existant avec un payload différent N'EST PAS une déduplication, mais
// doit être REFUSÉ comme violation de protocole (COMMAND_ID_REUSED / ErrCommandConflict).
func TestBreak_CommandID_PayloadMismatch_MustBeRefused(t *testing.T) {
	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "runtime.db")
	store, err := eventstore.NewSQLiteEventStore(dbPath)
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}
	defer store.Close()

	backend := &countingRPCClient{}
	srv, gw := newTestServerWithGW(backend)
	defer srv.Close()
	gw.SetEventStore(store)

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"

	// Client 1 envoie commande initiale avec payload A
	c1 := dialWS(t, wsURL)
	defer c1.conn.Close()

	c1.send(t, map[string]string{
		"type":      "send_prompt",
		"requestId": "req-sec-1",
		"commandId": "cmd-sec-fixed",
		"cascadeId": "casc-sec",
		"prompt":    "Action Légitime A",
	})

	// Attente de démarrage du stream pour la commande A
	msg1 := c1.recv(t)
	if msg1["type"] != "stream_start" && msg1["type"] != "response" {
		t.Fatalf("unexpected first message: %v", msg1)
	}

	// Client 2 réutilise le MÊME commandId mais avec un payload B complètement différent
	c2 := dialWS(t, wsURL)
	defer c2.conn.Close()

	c2.send(t, map[string]string{
		"type":      "send_prompt",
		"requestId": "req-sec-2",
		"commandId": "cmd-sec-fixed",
		"cascadeId": "casc-sec",
		"prompt":    "Action Attaque B (DIFFÉRENT)",
	})

	msg2 := c2.recv(t)
	// La réutilisation de commandId avec un payload différent DOIT produire une erreur
	// et NE DOIT PAS renvoyer deduplicated=true
	data, _ := msg2["data"].(map[string]interface{})
	if data != nil && data["deduplicated"] == true {
		t.Fatalf("FAIL: Le serveur a retourné deduplicated=true pour un commandId réutilisé avec un payload différent! Réponse: %v", msg2)
	}

	errMsg, _ := msg2["error"].(string)
	if errMsg == "" && (data == nil || data["status"] != "error") {
		t.Fatalf("FAIL: Le serveur n'a pas rejeté la réutilisation illégale de commandId avec payload conflictuel! Réponse: %v", msg2)
	}
}

// TestBreak_Concurrent_CommandRegistration_Atomic prouve que 50 requêtes concurrentes
// avec le même commandId et même payload ne déclenchent qu'UNE SEULE exécution réelle,
// et que les 49 autres sont atomiquement dédupliquées sans TOCTOU race.
func TestBreak_Concurrent_CommandRegistration_Atomic(t *testing.T) {
	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "runtime.db")
	store, err := eventstore.NewSQLiteEventStore(dbPath)
	if err != nil {
		t.Fatalf("failed to create store: %v", err)
	}
	defer store.Close()

	backend := &countingRPCClient{}
	srv, gw := newTestServerWithGW(backend)
	defer srv.Close()
	gw.SetEventStore(store)

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"

	concurrency := 50
	var wg sync.WaitGroup
	wg.Add(concurrency)

	type clientResult struct {
		isDedup bool
		isExec  bool
		err     string
	}
	results := make([]clientResult, concurrency)

	// Lancement simultané des 50 requêtes
	startBarrier := make(chan struct{})

	for i := 0; i < concurrency; i++ {
		idx := i
		go func() {
			defer wg.Done()
			client := dialWS(t, wsURL)
			defer client.conn.Close()

			<-startBarrier

			reqID := "req-atomic-" + itoa(idx)
			client.send(t, map[string]string{
				"type":      "send_prompt",
				"requestId": reqID,
				"commandId": "cmd-atomic-concurrent-shared",
				"cascadeId": "casc-atomic",
				"prompt":    "Tâche concurrente unique",
			})

			res := clientResult{}
			for {
				msg := client.recv(t)
				if msg["requestId"] == reqID {
					if msg["type"] == "stream_start" {
						res.isExec = true
					} else if msg["type"] == "response" {
						if d, ok := msg["data"].(map[string]interface{}); ok && d["deduplicated"] == true {
							res.isDedup = true
						}
						if e, ok := msg["error"].(string); ok {
							res.err = e
						}
					}
					break
				}
			}
			results[idx] = res
		}()
	}

	close(startBarrier)
	wg.Wait()

	totalExecs := atomic.LoadInt64(&backend.executions)
	dedupCount := 0
	execCount := 0
	errCount := 0

	for _, r := range results {
		if r.isDedup {
			dedupCount++
		}
		if r.isExec {
			execCount++
		}
		if r.err != "" {
			errCount++
		}
	}

	t.Logf("Resultats: execs=%d (backend=%d), dedup=%d, errs=%d", execCount, totalExecs, dedupCount, errCount)

	if totalExecs > 1 {
		t.Fatalf("FAIL DOUBLE EXECUTION: backend.executions = %d, attendu au plus 1!", totalExecs)
	}
	if execCount != 1 {
		t.Fatalf("FAIL: attendu exactement 1 client exécutant, reçu %d", execCount)
	}
	if dedupCount != concurrency-1 {
		t.Fatalf("FAIL: attendu %d réponses deduplicated, reçu %d (erreurs=%d)", concurrency-1, dedupCount, errCount)
	}
}
