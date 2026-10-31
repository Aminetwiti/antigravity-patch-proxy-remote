package gateway

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// C5 — /health expose un snapshot JSON de l'état du serveur : le mobile (ou un
// script) peut diagnostiquer sans écran (sessions en cours, erreur, uptime).
func TestStatsHealth(t *testing.T) {
	backend := &fakeRPCClient{streamDeltas: []string{"hello"}}
	server := NewServer(backend, "")
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", server.HandleWebSocket)
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		st := server.Stats()
		if st.Status == "degraded" {
			w.WriteHeader(http.StatusServiceUnavailable)
		}
		json.NewEncoder(w).Encode(st)
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	// Au repos : status ok, aucune session active, uptime présent.
	resp, err := http.Get(srv.URL + "/health")
	if err != nil {
		t.Fatalf("GET /health: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status attendu 200, reçu %d", resp.StatusCode)
	}
	var st Stats
	if err := json.NewDecoder(resp.Body).Decode(&st); err != nil {
		t.Fatalf("decode /health: %v", err)
	}
	if st.Status != "ok" || st.Uptime == "" || len(st.ActiveCascades) != 0 {
		t.Fatalf("snapshot inattendu: %+v", st)
	}

	// Un stream en cours apparaît dans activeCascades + streams.
	client := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws")
	defer client.conn.Close()
	client.send(t, map[string]string{
		"type": "send_prompt", "requestId": "r1",
		"cascadeId": "casc-1", "prompt": "bonjour",
	})
	// Consomme stream_start + stream_delta + stream_end.
	for {
		msg := client.recv(t)
		if msg["type"] == "stream_end" {
			break
		}
	}
	// Le stream est terminé : /health doit redevenir vide. La libération du
	// slot (ClearCascadeActive) se fait dans le defer de la goroutine de
	// send_prompt, légèrement APRÈS le broadcast stream_end : on sonde.
	var emptySnap Stats
	deadline := time.Now().Add(3 * time.Second)
	for {
		resp2, err := http.Get(srv.URL + "/health")
		if err != nil {
			t.Fatalf("GET /health (2): %v", err)
		}
		decErr := json.NewDecoder(resp2.Body).Decode(&emptySnap)
		resp2.Body.Close()
		if decErr != nil {
			t.Fatalf("decode /health (2): %v", decErr)
		}
		if emptySnap.Status == "ok" && len(emptySnap.ActiveCascades) == 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("snapshot après stream attendu vide, reçu %+v", emptySnap)
		}
		time.Sleep(50 * time.Millisecond)
	}

	// lastError : le stream suivant échoue (erreur RPC simulée) → /health
	// passe en 503 degraded avec la cause.
	server2 := NewServer(&failingStreamClient{}, "")
	mux2 := http.NewServeMux()
	mux2.HandleFunc("/ws", server2.HandleWebSocket)
	mux2.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		st := server2.Stats()
		if st.Status == "degraded" {
			w.WriteHeader(http.StatusServiceUnavailable)
		}
		json.NewEncoder(w).Encode(st)
	})
	srv2 := httptest.NewServer(mux2)
	defer srv2.Close()

	client2 := dialWS(t, "ws"+strings.TrimPrefix(srv2.URL, "http")+"/ws")
	defer client2.conn.Close()
	client2.send(t, map[string]string{
		"type": "send_prompt", "requestId": "r2",
		"cascadeId": "casc-2", "prompt": "plante",
	})
	for {
		msg := client2.recv(t)
		if msg["type"] == "stream_end" {
			break
		}
	}
	resp3, err := http.Get(srv2.URL + "/health")
	if err != nil {
		t.Fatalf("GET /health (3): %v", err)
	}
	defer resp3.Body.Close()
	if resp3.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("status attendu 503 après erreur, reçu %d", resp3.StatusCode)
	}
	if err := json.NewDecoder(resp3.Body).Decode(&st); err != nil {
		t.Fatalf("decode /health (3): %v", err)
	}
	if st.Status != "degraded" || st.LastError == "" {
		t.Fatalf("degraded attendu avec lastError, reçu %+v", st)
	}
}
