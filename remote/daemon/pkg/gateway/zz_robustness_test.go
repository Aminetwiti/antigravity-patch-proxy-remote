package gateway

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/antigravity/remote-daemon/pkg/connectrpc"
)

// C1 — idempotence : un requestId déjà traité ne rejoue pas le tour. Le mobile
// retransmet send_prompt après coupure Wi-Fi (outbox) ; sans ce garde, le hub
// recevrait le même prompt deux fois (double exécution de l'agent).
func TestSendPromptIdempotent(t *testing.T) {
	backend := &fakeRPCClient{streamDeltas: []string{"hello"}}
	srv := newTestServer(backend)
	defer srv.Close()

	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	// Premier envoi : stream complet + réponse.
	client.send(t, map[string]string{
		"type": "send_prompt", "requestId": "r1",
		"cascadeId": "casc-1", "prompt": "bonjour",
	})
	first := client.recv(t) // stream_start
	if first["type"] != "stream_start" {
		t.Fatalf("attendu stream_start, reçu %v", first)
	}
	for {
		msg := client.recv(t)
		if msg["type"] == "stream_end" {
			break
		}
	}

	// Retransmission du MÊME requestId (outbox replay) → dédupliqué, aucun
	// second tour côté backend.
	client.send(t, map[string]string{
		"type": "send_prompt", "requestId": "r1",
		"cascadeId": "casc-1", "prompt": "bonjour",
	})
	resp := client.recv(t)
	if resp["type"] != "response" {
		t.Fatalf("attendu response dédupliquée, reçu %v", resp)
	}
	if resp["data"].(map[string]interface{})["deduplicated"] != true {
		t.Fatalf("data.deduplicated attendu, reçu %v", resp["data"])
	}

	// Aucun stream_start supplémentaire ne doit être broadcasté.
	client.conn.SetReadDeadline(time.Now().Add(100 * time.Millisecond))
	if _, _, err := client.conn.ReadMessage(); err == nil {
		t.Fatal("Message inattendu après réponse dédupliquée (double broadcast ?)")
	}
}

// C3 — plafond de streams simultanés par client : le 3ᵉ send_prompt concurrent
// est refusé avec une erreur explicite (le hub ne peut pas être saturé).
func TestConcurrentStreamLimitPerClient(t *testing.T) {
	// Backend bloquant : SendMessageStream ne rend la main que sur release.
	backend := &blockingStreamClient{release: make(chan struct{}, 1)}
	srv := newTestServer(backend)
	defer srv.Close()

	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()

	// Deux streams simultanés acceptés.
	for i := 1; i <= 2; i++ {
		client.send(t, map[string]string{
			"type": "send_prompt", "requestId": "r" + string(rune('0'+i)),
			"cascadeId": "casc-1", "prompt": "tour",
		})
		if msg := client.recv(t); msg["type"] != "stream_start" {
			t.Fatalf("stream %d : attendu stream_start, reçu %v", i, msg)
		}
	}

	// 3ᵉ simultané → refusé immédiatement (maxConcurrentStreams = 2).
	client.send(t, map[string]string{
		"type": "send_prompt", "requestId": "r3",
		"cascadeId": "casc-1", "prompt": "surcharge",
	})
	resp := client.recv(t)
	if resp["type"] != "response" || resp["error"] == nil {
		t.Fatalf("attendu refus avec erreur, reçu %v", resp)
	}

	// Libération d'un slot → le 3ᵉ envoi repasse.
	backend.release <- struct{}{}
	backend.release <- struct{}{}
	// Consomme les 2 stream_end des streams bloqués.
	for i := 0; i < 2; i++ {
		for {
			msg := client.recv(t)
			if msg["type"] == "stream_end" {
				break
			}
		}
	}
	// Le stream_end est broadcasté AVANT la libération du slot (defer) : un
	// r4 envoyé juste après peut arriver avant le slot-- et être refusé
	// (transitoire). On réessaie r4 jusqu'au stream_start (le requestId n'est
	// marqué qu'après le contrôle de capacité, donc une retransmission est
	// sûre).

	client.send(t, map[string]string{
		"type": "send_prompt", "requestId": "r4",
		"cascadeId": "casc-1", "prompt": "après libération",
	})
	deadline := time.Now().Add(5 * time.Second)
	for {
		msg := client.recv(t)
		if msg["type"] == "stream_start" {
			break
		}
		if msg["type"] == "response" && msg["error"] != nil {
			if time.Now().After(deadline) {
				t.Fatalf("attendu stream_start après libération, reçu %v", msg)
			}
			time.Sleep(25 * time.Millisecond)
			client.send(t, map[string]string{
				"type": "send_prompt", "requestId": "r4",
				"cascadeId": "casc-1", "prompt": "après libération",
			})
			continue
		}
		t.Fatalf("attendu stream_start après libération, reçu %v", msg)
	}
	backend.release <- struct{}{}
	for {
		msg := client.recv(t)
		if msg["type"] == "stream_end" {
			break
		}
	}
}

// blockingStreamClient : SendMessageStream bloque jusqu'à réception sur le
// canal release (simule un hub qui met du temps à répondre).
type blockingStreamClient struct {
	fakeRPCClient
	release chan struct{}
}

func (b *blockingStreamClient) SendMessageStream(cascadeID, text string, onFrame func([]byte) error) error {
	<-b.release
	return nil
}
func (b *blockingStreamClient) SendMessageStreamModel(cascadeID, text, modelUID string, modelEnum uint64, onFrame func([]byte) error, noTools ...bool) error {
	<-b.release
	return nil
}
func (b *blockingStreamClient) SendMessageStreamModelWithMedia(cascadeID, text, modelUID string, modelEnum uint64, media []connectrpc.MediaAttachment, onFrame func([]byte) error, noTools ...bool) error {
	<-b.release
	return nil
}

// Helper httptest pour ces tests (le mux /ws suffit).
func newTestServerFor(t *testing.T, backend RPCClient) *httptest.Server {
	t.Helper()
	server := NewServer(backend, "")
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", server.HandleWebSocket)
	return httptest.NewServer(mux)
}
