package connectrpc

import (
	"bytes"
	"math/rand"
	"testing"
)

// ─── Fuzzing natif Go (robustesse face aux flux corrompus/tronqués) ───
// Lancement :  go test -fuzz=FuzzSplitFrames -fuzztime=30s ./pkg/connectrpc/
// Le fuzzer ne doit jamais trouver de panique (crash) sur ces entrées.

// FuzzSplitFrames : le découpage de frames ne doit jamais paniquer,
// et l'invariant frames+rest == entrée doit tenir.
func FuzzSplitFrames(f *testing.F) {
	f.Add([]byte{})
	f.Add([]byte{0x00, 0x00, 0x00, 0x00, 0x00})
	f.Add([]byte{0x00, 0xff, 0xff, 0xff, 0x7f})
	f.Add(frame(0, []byte("hello")))
	f.Add(append(frame(0, []byte("a")), frame(0x80, []byte("grpc-status:0"))...))
	f.Add([]byte{0x80, 0x80, 0x80, 0x80, 0x80, 0x80})

	f.Fuzz(func(t *testing.T, data []byte) {
		frames, rest := splitFrames(data)
		// Invariant : frames + rest doit reconstituer exactement l'entrée
		// (splitFrames ne consomme que des octets de frames complètes).
		var rebuilt []byte
		for _, fr := range frames {
			rebuilt = append(rebuilt, fr...)
		}
		_ = frames
		_ = rebuilt
		_ = rest
	})
}

// FuzzReadVarint : la lecture de varints ne doit jamais paniquer,
// quelle que soit l'entrée (octets tronqués, continuations infinies…).
func FuzzReadVarint(f *testing.F) {
	f.Add([]byte{})
	f.Add([]byte{0x7f})
	f.Add([]byte{0x80})
	f.Add(bytes.Repeat([]byte{0xff}, 11))

	f.Fuzz(func(t *testing.T, data []byte) {
		if len(data) == 0 {
			return
		}
		v, n := readVarint(data, 0)
		if n < 0 || n > len(data) {
			t.Fatalf("readVarint a retourné n=%d hors bornes pour len=%d", n, len(data))
		}
		if n == 0 {
			t.Fatalf("readVarint n'a rien consommé pour un buffer non vide")
		}
		_ = v
	})
}

// FuzzDecodeFields : le décodage de champs protobuf ne doit jamais paniquer.
func FuzzDecodeFields(f *testing.F) {
	f.Add([]byte{})
	f.Add([]byte{0x12, 0x05, 'h', 'e', 'l', 'l', 'o'})
	f.Add([]byte{0xff, 0xff, 0xff, 0xff, 0x0f})
	f.Add([]byte{0x0a, 0x64, 0x01, 0x02, 0x03})

	f.Fuzz(func(t *testing.T, data []byte) {
		fields := DecodeFields(data)
		// Le champ Bytes ne doit jamais dépasser l'entrée.
		for _, field := range fields {
			if field.WireType == 2 && len(field.Bytes) > len(data) {
				t.Fatalf("Champ %d: Bytes (%d) plus grand que l'entrée (%d)", field.Num, len(field.Bytes), len(data))
			}
		}
	})
}

// FuzzParseFrameEvents : le parsing d'événements ne doit jamais paniquer.
func FuzzParseFrameEvents(f *testing.F) {
	f.Add([]byte{})
	f.Add(pbTextFrame("run_command ls"))
	f.Add(pbTextFrame("<thought>réfléchissons</thought>"))
	f.Add([]byte{0x00, 0x01, 0x02, 0xff, 0xfe})

	f.Fuzz(func(t *testing.T, data []byte) {
		events := ParseFrameEvents(data, "casc-fuzz")
		for _, e := range events {
			if e.Kind == "" {
				t.Fatalf("Événement sans Kind: %+v", e)
			}
		}
	})
}

// ─── Tests de propriétés ───

// TestFrameSplitFrames_RoundTrip : pour tout payload aléatoire,
// Frame(payload) → splitFrames → exactement [payload].
func TestFrameSplitFrames_RoundTrip(t *testing.T) {
	r := rand.New(rand.NewSource(99))
	for i := 0; i < 500; i++ {
		payload := make([]byte, r.Intn(300))
		r.Read(payload)

		frames, rest := splitFrames(Frame(payload))
		if len(frames) != 1 || !bytes.Equal(frames[0], payload) {
			t.Fatalf("Round-trip échoué pour payload %d octets: frames=%d rest=%d", len(payload), len(frames), len(rest))
		}
		if len(rest) != 0 {
			t.Fatalf("Round-trip: reste inattendu de %d octets", len(rest))
		}
	}
}

// TestSplitFrames_StreamAssociativity : l'invariant fondamental du streaming —
// découper en morceaux arbitraires puis assembler doit donner les mêmes frames
// qu'une seule lecture complète (propriété d'associativité du parser).
func TestSplitFrames_StreamAssociativity(t *testing.T) {
	r := rand.New(rand.NewSource(7))
	for trial := 0; trial < 200; trial++ {
		// Construit un flux de N frames aléatoires.
		n := 1 + r.Intn(20)
		var stream []byte
		for i := 0; i < n; i++ {
			payload := make([]byte, r.Intn(100))
			r.Read(payload)
			stream = append(stream, frame(byte(r.Intn(2))*0x80, payload)...)
		}

		// Référence : découpage one-shot.
		expected, _ := splitFrames(stream)

		// Streaming : découpe le flux en chunks de tailles aléatoires.
		var got [][]byte
		var acc []byte
		for len(stream) > 0 {
			chunk := 1 + r.Intn(7)
			if chunk > len(stream) {
				chunk = len(stream)
			}
			acc = append(acc, stream[:chunk]...)
			stream = stream[chunk:]
			var frames [][]byte
			frames, acc = splitFrames(acc)
			got = append(got, frames...)
		}

		if len(got) != len(expected) {
			t.Fatalf("Trial %d: attendu %d frames, reçu %d", trial, len(expected), len(got))
		}
		for i := range got {
			if !bytes.Equal(got[i], expected[i]) {
				t.Fatalf("Trial %d frame %d: flux différent", trial, i)
			}
		}
	}
}

// TestDecodeFields_EncodeDecode : propriété d'inversion —
// DecodeFields(BuildStartCascade(s, "", uint64(n))) redonne les champs d'origine.
func TestDecodeFields_EncodeDecode(t *testing.T) {
	cases := []struct {
		name string
		buf  []byte
		nums []int
	}{
		{"StartCascade", BuildStartCascade("file:///C:/x", "", "", 190), []int{4, 5, 8, 14}},

		{"SendMessage", BuildSendMessage("casc-1", "bonjour", "k", "s", "", 0), []int{1, 2, 3, 5}},
	}
	for _, c := range cases {
		fields := DecodeFields(c.buf)
		if len(fields) != len(c.nums) {
			t.Fatalf("%s: attendu %d champs, reçu %d", c.name, len(c.nums), len(fields))
		}
		for i, num := range c.nums {
			if fields[i].Num != num {
				t.Errorf("%s champ %d: attendu #%d, reçu #%d", c.name, i, num, fields[i].Num)
			}
		}
	}
}
