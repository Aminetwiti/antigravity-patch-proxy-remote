package connectrpc

import (
	"bytes"
	"math"
	"math/rand"
	"testing"
)

// --- Tests logiques (property-based) : varint encode/decode ---

// TestVarintRoundTrip vérifie la propriété : pour tout uint64 v,
// readVarint(writer.varint(v)) == v. Utilise testing/quick (stdlib).
func TestVarintRoundTrip(t *testing.T) {
	r := rand.New(rand.NewSource(42))
	values := []uint64{
		0, 1, 127, 128, 300, 16383, 16384,
		math.MaxUint32,
		math.MaxUint64,
	}
	for i := 0; i < 1000; i++ {
		values = append(values, r.Uint64())
	}

	for _, v := range values {
		w := &writer{}
		w.varint(v)

		got, n := readVarint(w.b, 0)
		if got != v {
			t.Fatalf("varint(%d) → décodé %d", v, got)
		}
		if n != len(w.b) {
			t.Fatalf("varint(%d): attendu %d octets lus, reçu %d", v, len(w.b), n)
		}
	}
}

// TestVarintTruncatedFragments vérifie que readVarint ne panique jamais
// sur des flux tronqués ou corrompus (propriété de robustesse).
func TestVarintTruncatedFragments(t *testing.T) {
	r := rand.New(rand.NewSource(7))
	for i := 0; i < 1000; i++ {
		// Génère un varint valide puis le tronque à chaque position possible.
		w := &writer{}
		w.varint(r.Uint64())

		for cut := 0; cut < len(w.b); cut++ {
			func() {
				defer func() {
					if recover() != nil {
						t.Fatalf("readVarint a paniqué sur un fragment tronqué de %d octets", cut)
					}
				}()
				readVarint(w.b[:cut], 0)
			}()
		}
	}
}

// --- Performance : benchmarks (go test -bench . -benchmem) ---

var benchSink []StreamEvent
var benchSinkBytes []byte

func BenchmarkParseFrameEvents_Text(b *testing.B) {
	// Frame protobuf réaliste : champ #2 (length-delimited) contenant du texte.
	raw := append([]byte{0x12, 0x18}, []byte("hello from the AI model")...)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		benchSink = ParseFrameEvents(raw, "cascade-123")
	}
}

func BenchmarkParseFrameEvents_Approval(b *testing.B) {
	raw := append([]byte{0x12, 0x1a}, []byte(`{"tool":"run_command","cmd":"ls"}`)...)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		benchSink = ParseFrameEvents(raw, "cascade-123")
	}
}

func BenchmarkSplitFrames_LargeStream(b *testing.B) {
	// Simule un stream de 100 frames de 1 Ko chacune (100 Ko).
	var stream []byte
	for i := 0; i < 100; i++ {
		stream = append(stream, frame(0, bytes.Repeat([]byte{0x41}, 1024))...)
	}
	b.SetBytes(int64(len(stream)))
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		frames, rest := splitFrames(stream)
		benchSinkBytes = rest
		_ = len(frames)
	}
}

func BenchmarkVarintRoundTrip(b *testing.B) {
	w := &writer{}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		w.b = w.b[:0]
		w.varint(uint64(i) * 2654435761)
		readVarint(w.b, 0)
	}
}
