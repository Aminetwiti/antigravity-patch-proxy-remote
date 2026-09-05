package connectrpc

import (
	"bytes"
	"encoding/binary"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"testing"
)

// frame construit une frame gRPC-Web encodée (flags + longueur BE + payload).
func frame(flags byte, payload []byte) []byte {
	buf := make([]byte, 5+len(payload))
	buf[0] = flags
	binary.BigEndian.PutUint32(buf[1:5], uint32(len(payload)))
	copy(buf[5:], payload)
	return buf
}

// testClient pointe un Client vers un serveur httptest (l'URL est Host:Port).
func testClient(serverURL, token string) *Client {
	u, _ := url.Parse(serverURL)
	port, _ := strconv.Atoi(u.Port())
	c := NewClient(port, token)
	c.Host = u.Hostname()
	return c
}

// --- Tests de splitFrames (logique pure de découpage des frames) ---

func TestSplitFrames_CompleteFrames(t *testing.T) {
	payloads := [][]byte{[]byte("frame-1"), []byte("frame-2"), []byte("frame-3")}
	var buf []byte
	for _, p := range payloads {
		buf = append(buf, frame(0, p)...)
	}

	frames, rest := splitFrames(buf)
	if len(frames) != 3 {
		t.Fatalf("Attendu 3 frames, reçu %d", len(frames))
	}
	if len(rest) != 0 {
		t.Fatalf("Attendu aucun reste, reçu %d octets", len(rest))
	}
	for i, f := range frames {
		if string(f) != string(payloads[i]) {
			t.Errorf("Frame %d: attendu %q, reçu %q", i, payloads[i], f)
		}
	}
}

func TestSplitFrames_PartialFragment(t *testing.T) {
	full := frame(0, []byte("hello-world"))
	// Buffer coupé au milieu de la frame : rien ne doit être émis.
	frames, rest := splitFrames(full[:8])
	if len(frames) != 0 {
		t.Fatalf("Attendu 0 frame pour un fragment partiel, reçu %d", len(frames))
	}
	if !bytes.Equal(rest, full[:8]) {
		t.Errorf("Le fragment restant doit être conservé tel quel pour le prochain read")
	}
}

func TestSplitFrames_ChunkBoundary(t *testing.T) {
	// Deux frames dont la seconde est découpée en deux morceaux (simule 2 reads TCP).
	first := frame(0, []byte("alpha"))
	second := frame(0, []byte("beta"))

	// read 1 : frame complète + moitié de la suivante
	chunk1 := append(append([]byte{}, first...), second[:4]...)
	frames, rest := splitFrames(chunk1)
	if len(frames) != 1 || string(frames[0]) != "alpha" {
		t.Fatalf("Attendu 1 frame 'alpha', reçu %v", frames)
	}
	if !bytes.Equal(rest, second[:4]) {
		t.Fatalf("Reste inattendu: %x", rest)
	}

	// read 2 : le reste de la seconde frame
	frames, rest = splitFrames(append(rest, second[4:]...))
	if len(frames) != 1 || string(frames[0]) != "beta" {
		t.Fatalf("Attendu 1 frame 'beta', reçu %v", frames)
	}
	if len(rest) != 0 {
		t.Fatalf("Attendu aucun reste, reçu %d octets", len(rest))
	}
}

func TestSplitFrames_SkipsTrailers(t *testing.T) {
	// Les trailers gRPC (flag 0x80) ne doivent jamais être transmis à onFrame.
	data := append(frame(0, []byte("content")), frame(0x80, []byte("grpc-status:0"))...)
	frames, rest := splitFrames(data)
	if len(frames) != 1 || string(frames[0]) != "content" {
		t.Fatalf("Attendu uniquement la frame de données, reçu %v", frames)
	}
	if len(rest) != 0 {
		t.Fatalf("Attendu aucun reste, reçu %d octets", len(rest))
	}
}

func TestSplitFrames_EmptyAndGarbage(t *testing.T) {
	if frames, rest := splitFrames(nil); len(frames) != 0 || len(rest) != 0 {
		t.Fatalf("Buffer vide doit produire 0 frame et 0 reste")
	}
	// Longueur déclarée plus grande que le buffer → fragment partiel, pas de panique.
	bad := []byte{0x00, 0xff, 0xff, 0xff, 0x7f}
	if frames, _ := splitFrames(bad); len(frames) != 0 {
		t.Fatalf("Longueur invalide doit être traitée comme fragment, reçu %d frames", len(frames))
	}
}

// --- Test d'intégration : CallStream contre un faux serveur gRPC-Web ---

func TestCallStream_Integration(t *testing.T) {
	frames := [][]byte{[]byte("delta-1"), []byte("delta-2")}
	// Serveur qui renvoie les deux frames + un trailer, en 3 écritures espacées
	// pour simuler un streaming réseau réel.
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-codeium-csrf-token") != "tok-123" {
			t.Errorf("En-tête CSRF manquant ou incorrect: %q", r.Header.Get("x-codeium-csrf-token"))
		}
		if r.Header.Get("Content-Type") != "application/grpc-web+proto" {
			t.Errorf("Content-Type incorrect: %q", r.Header.Get("Content-Type"))
		}
		w.Header().Set("Content-Type", "application/grpc-web+proto")
		body := append(frame(0, frames[0]), frame(0, frames[1])...)
		body = append(body, frame(0x80, []byte("grpc-status:0"))...)
		w.Write(body[:20])  // 1er chunk partiel
		w.(http.Flusher).Flush()
		w.Write(body[20:]) // 2e chunk
	}))
	defer server.Close()

	client := testClient(server.URL, "tok-123")
	client.HTTP = server.Client()

	var got [][]byte
	err := client.CallStream("SendUserCascadeMessage", []byte("req"), 5e9, func(f []byte) error {
		got = append(got, append([]byte{}, f...))
		return nil
	})
	if err != nil {
		t.Fatalf("CallStream a échoué: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("Attendu 2 frames, reçu %d", len(got))
	}
	for i, f := range got {
		if string(f) != string(frames[i]) {
			t.Errorf("Frame %d: attendu %q, reçu %q", i, frames[i], f)
		}
	}
}

func TestCallStream_HTTPError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "nope", http.StatusForbidden)
	}))
	defer server.Close()

	client := testClient(server.URL, "tok")
	client.HTTP = server.Client()

	err := client.CallStream("Heartbeat", nil, 5e9, func(f []byte) error { return nil })
	if err == nil {
		t.Fatal("Attendu une erreur HTTP 403, reçu nil")
	}
}

func TestCallStream_OnFrameErrorStops(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write(frame(0, []byte("x")))
	}))
	defer server.Close()

	client := testClient(server.URL, "tok")
	client.HTTP = server.Client()

	calls := 0
	err := client.CallStream("X", nil, 5e9, func(f []byte) error {
		calls++
		return io.ErrClosedPipe
	})
	if err != io.ErrClosedPipe {
		t.Fatalf("Attendu io.ErrClosedPipe, reçu %v", err)
	}
	if calls != 1 {
		t.Fatalf("Attendu 1 seul appel onFrame, reçu %d", calls)
	}
}

func TestClientAutoRecoverOnInvalidCSRF(t *testing.T) {
	attempts := 0
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts++
		if r.Header.Get("x-codeium-csrf-token") == "bad-token" {
			w.Header().Set("Content-Type", "application/grpc-web+proto")
			w.Header().Set("grpc-status", "16")
			w.Header().Set("grpc-message", "invalid CSRF token")
			w.WriteHeader(http.StatusOK)
			return
		}
		// Second attempt with good token
		w.Header().Set("Content-Type", "application/grpc-web+proto")
		w.Header().Set("grpc-status", "0")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(Frame([]byte("success_payload")))
	}))
	defer ts.Close()

	u, _ := url.Parse(ts.URL)
	port, _ := strconv.Atoi(u.Port())

	client := NewClient(port, "bad-token")
	client.Host = u.Hostname()

	recovered := false
	client.OnAuthError = func() bool {
		recovered = true
		client.UpdateEndpoint(port, "good-token")
		return true
	}

	res, err := client.Call("GetRevertPreview", []byte("req"))
	if err != nil {
		t.Fatalf("Attendu succès après auto-recovery, reçu erreur: %v", err)
	}
	if !recovered {
		t.Errorf("Attendu que OnAuthError soit invoqué")
	}
	if attempts != 2 {
		t.Errorf("Attendu 2 tentatives, reçu %d", attempts)
	}
	if string(res) != "success_payload" {
		t.Errorf("Attendu payload 'success_payload', reçu %q", string(res))
	}
}

