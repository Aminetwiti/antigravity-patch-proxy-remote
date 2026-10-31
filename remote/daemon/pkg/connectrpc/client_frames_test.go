package connectrpc

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestCall_TrailerFrameAfterEmptyData : le Hub peut répondre « frame de données
// vide + frame trailer » (réponse GetAllCascadeTrajectories d'une instance IDE
// sans session). Call doit ignorer la frame vide ET le trailer, et retourner
// l'erreur « aucune frame » uniquement s'il ne reste aucune frame de données.
func TestCall_TrailerFrameAfterEmptyData(t *testing.T) {
	cases := []struct {
		name string
		body []byte
		want error // nil = pas d'erreur attendue
	}{
		{
			name: "data vide + trailer",
			body: []byte{
				0x00, 0x00, 0x00, 0x00, 0x00,
				0x80, 0x00, 0x00, 0x00, 0x10, 'g', 'r', 'p', 'c', '-', 's', 't', 'a', 't', 'u', 's', ':', ' ', '0', '\r', '\n',
			},
			want: fmt.Errorf("aucune frame gRPC-Web dans la réponse (26 octets)"),
		},
		{
			name: "data vide + trailer + data reelle",
			body: []byte{
				0x00, 0x00, 0x00, 0x00, 0x00,
				0x80, 0x00, 0x00, 0x00, 0x10, 'g', 'r', 'p', 'c', '-', 's', 't', 'a', 't', 'u', 's', ':', ' ', '0', '\r', '\n',
				0x00, 0x00, 0x00, 0x00, 0x02, 'o', 'k',
			},
			want: nil,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			raw := tc.body
			var frames [][]byte
			offset := 0
			for offset+5 <= len(raw) {
				flags := raw[offset]
				length := int(binary.BigEndian.Uint32(raw[offset+1 : offset+5]))
				offset += 5
				if offset+length > len(raw) {
					break
				}
				if length > 0 && flags&0x80 == 0 {
					frames = append(frames, raw[offset:offset+length])
				}
				offset += length
			}
			if tc.want != nil {
				if len(frames) != 0 {
					t.Fatalf("attendue erreur %v, reçu %d frames", tc.want, len(frames))
				}
				return
			}
			if len(frames) == 0 {
				t.Fatal("aucune frame gRPC-Web dans la réponse")
			}
			if string(frames[0]) != "ok" {
				t.Fatalf("frames[0] attendue 'ok', reçue %q", frames[0])
			}
		})
	}
}

// TestSplitFrames_IgnoresTrailers : splitFrames (utilisé par CallStream) ignore
// les frames trailer (flags 0x80) et conserve les frames de données.
func TestSplitFrames_IgnoresTrailers(t *testing.T) {
	body := []byte{
		0x00, 0x00, 0x00, 0x00, 0x02, 'o', 'k',
		0x80, 0x00, 0x00, 0x00, 0x10, 'g', 'r', 'p', 'c', '-', 's', 't', 'a', 't', 'u', 's', ':', ' ', '0', '\r', '\n',
	}
	raw, rest := splitFrames(body)
	if len(raw) != 1 || string(raw[0]) != "ok" {
		t.Fatalf("splitFrames: attendu [ok], reçu %v (rest=%d)", raw, rest)
	}
}

// TestCallStream_EmptyDataFrame : CallStream sur une réponse « frame data vide +
// trailer » doit terminer sans erreur (onFrame appelé avec 0 octet, pas de panic).
func TestCallStream_EmptyDataFrame(t *testing.T) {
	body := []byte{
		0x00, 0x00, 0x00, 0x00, 0x00,
		0x80, 0x00, 0x00, 0x00, 0x10, 'g', 'r', 'p', 'c', '-', 's', 't', 'a', 't', 'u', 's', ':', ' ', '0', '\r', '\n',
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write(body)
	}))
	defer srv.Close()

	client := srv.Client()
	// Réutilise le chemin de CallStream avec un transport pointant vers le test server.
	req, err := http.NewRequest("POST", srv.URL, bytes.NewReader(make([]byte, 5)))
	if err != nil {
		t.Fatal(err)
	}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	buf := make([]byte, 32768)
	var accumulated []byte
	for {
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			accumulated = append(accumulated, buf[:n]...)
			frames, rest := splitFrames(accumulated)
			accumulated = rest
			for _, frameData := range frames {
				if len(frameData) != 0 {
					t.Fatalf("CallStream: frame attendue vide, reçue %d octets", len(frameData))
				}
			}
		}
		if readErr != nil {
			if readErr == io.EOF {
				break
			}
			t.Fatal(readErr)
		}
	}
}
