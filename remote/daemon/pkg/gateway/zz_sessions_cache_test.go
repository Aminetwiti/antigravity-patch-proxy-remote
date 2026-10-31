package gateway

import (
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// countingCascadesClient compte les appels GetAllCascades (pour vérifier que le
// cache single-flight n'en déclenche qu'UN pour N clients simultanés).
type countingCascadesClient struct {
	fakeRPCClient
	mu    sync.Mutex
	calls int
}

func (c *countingCascadesClient) GetAllCascades() ([]byte, error) {
	c.mu.Lock()
	c.calls++
	c.mu.Unlock()
	// Simule la latence réelle du hub (~9,5 s) : le single-flight doit
	// absorber N requêtes concurrentes pendant que le premier appel est en vol.
	time.Sleep(100 * time.Millisecond)
	return trajectoryFrame("11111111-2222-3333-4444-555555555555"), nil
}

func (c *countingCascadesClient) callCount() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.calls
}

// TestListSessionsSingleFlight — N clients demandent list_sessions en même
// temps : le backend ne doit recevoir qu'UN GetAllCascades, et chaque client
// doit recevoir une réponse portant son requestId.
func TestListSessionsSingleFlight(t *testing.T) {
	backend := &countingCascadesClient{}
	ts, gw := newTestServerWithGW(backend)
	defer ts.Close()

	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws"
	const clients = 8

	var wg sync.WaitGroup
	errCh := make(chan error, clients)
	for c := 0; c < clients; c++ {
		wg.Add(1)
		go func(c int) {
			defer wg.Done()
			conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
			if err != nil {
				errCh <- fmt.Errorf("client %d: dial: %w", c, err)
				return
			}
			defer conn.Close()

			rid := fmt.Sprintf("list-%d", c)
			if err := conn.WriteJSON(map[string]string{"type": "list_sessions", "requestId": rid}); err != nil {
				errCh <- fmt.Errorf("client %d: send: %w", c, err)
				return
			}
			conn.SetReadDeadline(time.Now().Add(15 * time.Second))
			var out map[string]interface{}
			if err := conn.ReadJSON(&out); err != nil {
				errCh <- fmt.Errorf("client %d: recv: %w", c, err)
				return
			}
			if out["requestId"] != rid || out["type"] != "response" {
				errCh <- fmt.Errorf("client %d: réponse croisée: requestId=%v type=%v", c, out["requestId"], out["type"])
				return
			}
			if out["error"] != nil {
				errCh <- fmt.Errorf("client %d: erreur: %v", c, out["error"])
				return
			}
		}(c)
	}
	wg.Wait()
	close(errCh)
	for err := range errCh {
		t.Error(err)
	}
	if got := backend.callCount(); got > 1 {
		t.Fatalf("single-flight: attendu 1 appel GetAllCascades pour %d clients, reçu %d", clients, got)
	}
	t.Logf("ok: %d clients partagent 1 appel GetAllCascades (cache)", clients)
	_ = gw
}

// TestListSessionsCacheTTL — après un premier list_sessions, un second appel
// immédiat est servi depuis le cache (0 appel backend supplémentaire), et un
// appel après expiration du TTL refait un vrai appel.
func TestListSessionsCacheTTL(t *testing.T) {
	backend := &countingCascadesClient{}
	srv, gw := newTestServerWithGW(backend)
	defer srv.Close()
	gw.SetSessionsCacheTTL(800 * time.Millisecond)

	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	// 1er appel : déclenche l'appel backend + remplit le cache.
	client.send(t, map[string]string{"type": "list_sessions", "requestId": "a1"})
	resp := client.recv(t)
	if resp["requestId"] != "a1" || resp["type"] != "response" {
		t.Fatalf("réponse 1 inattendue: %v", resp)
	}
	if backend.callCount() != 1 {
		t.Fatalf("après 1er appel: attendu 1 appel backend, reçu %d", backend.callCount())
	}

	// 2e appel immédiat : servi depuis le cache (0 appel backend).
	client.send(t, map[string]string{"type": "list_sessions", "requestId": "a2"})
	resp = client.recv(t)
	if resp["requestId"] != "a2" || resp["type"] != "response" {
		t.Fatalf("réponse 2 inattendue: %v", resp)
	}
	if backend.callCount() != 1 {
		t.Fatalf("cache: attendu 1 appel backend après 2e appel, reçu %d", backend.callCount())
	}

	// 3e appel après expiration du TTL court : nouveau vrai appel backend.
	time.Sleep(1000 * time.Millisecond)
	client.send(t, map[string]string{"type": "list_sessions", "requestId": "a3"})
	resp = client.recv(t)
	if resp["requestId"] != "a3" || resp["type"] != "response" {
		t.Fatalf("réponse 3 inattendue: %v", resp)
	}
	if backend.callCount() != 2 {
		t.Fatalf("TTL: attendu 2 appels backend, reçu %d", backend.callCount())
	}
}
