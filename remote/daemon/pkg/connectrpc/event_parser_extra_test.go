package connectrpc

import (
	"encoding/binary"
	"strings"
	"testing"
)

// Frame protobuf construite avec l'encodeur maison : champ #2 length-delimited.
func pbTextFrame(s string) []byte {
	buf := make([]byte, 2+len(s))
	buf[0] = 0x12 // field 2, wire type 2
	buf[1] = byte(len(s))
	copy(buf[2:], s)
	return buf
}

func TestParseFrameEvents_TextDelta(t *testing.T) {
	raw := pbTextFrame("Bonjour, voici une réponse normale.")
	events := ParseFrameEvents(raw, "casc-1")

	if len(events) != 1 {
		t.Fatalf("Attendu 1 événement, reçu %d", len(events))
	}
	e := events[0]
	if e.Kind != EventKindText {
		t.Errorf("Attendu Kind=text, reçu=%s", e.Kind)
	}
	if !strings.Contains(e.Delta, "Bonjour") {
		t.Errorf("Delta inattendu: %q", e.Delta)
	}
	if e.CascadeID != "casc-1" {
		t.Errorf("CascadeID non propagé: %q", e.CascadeID)
	}
}

func TestParseFrameEvents_Thinking(t *testing.T) {
	raw := pbTextFrame("<thought>Analysons le problème...</thought>")
	events := ParseFrameEvents(raw, "casc-1")

	if len(events) != 1 || events[0].Kind != EventKindThinking {
		t.Fatalf("Attendu 1 événement thinking, reçu %v", events)
	}
}

func TestParseFrameEvents_IgnoresBinaryGarbage(t *testing.T) {
	// Des octets binaires non imprimables ne doivent pas devenir des deltas texte.
	raw := []byte{0x12, 0x04, 0x00, 0x01, 0x02, 0x03}
	events := ParseFrameEvents(raw, "casc-1")
	if len(events) != 0 {
		t.Fatalf("Attendu 0 événement pour des octets binaires, reçu %d", len(events))
	}
}

func TestParseFrameEvents_MultipleFields(t *testing.T) {
	// Deux champs length-delimited dans la même frame : les deux doivent être analysés.
	f1 := pbTextFrame("premier")
	f2 := pbTextFrame("second")
	raw := append(f1, f2...)
	events := ParseFrameEvents(raw, "casc-1")
	if len(events) != 2 {
		t.Fatalf("Attendu 2 événements, reçu %d", len(events))
	}
}

// TestFieldString — vérifie le formatage String() de Field (utilisé par toOutgoing).
func TestFieldString(t *testing.T) {
	f := Field{Num: 14, WireType: 0, Varint: 190}
	if s := f.String(); s != "#14:0=190" {
		t.Errorf("Attendu '#14:0=190', reçu %q", s)
	}
	f2 := Field{Num: 8, WireType: 2, Bytes: []byte("abc")}
	if s := f2.String(); s != "#8:2=3B" {
		t.Errorf("Attendu '#8:2=3B', reçu %q", s)
	}
}

// TestVarintBoundary — encode un varint multi-octets avec des bits à 1 sur tous les octets.
func TestVarintBoundary(t *testing.T) {
	w := &writer{}
	w.varint(0xFFFFFFFFFFFFFFFF) // max uint64 : 10 octets
	if len(w.b) != 10 {
		t.Fatalf("Attendu 10 octets pour MaxUint64, reçu %d", len(w.b))
	}
	v, n := readVarint(w.b, 0)
	if v != 0xFFFFFFFFFFFFFFFF || n != 10 {
		t.Fatalf("Round-trip MaxUint64 échoué: v=%d n=%d", v, n)
	}

	// Varint non canonique : octet de continuation parasite à la fin.
	// readVarint doit s'arrêter après 10 octets sans boucler à l'infini.
	nonCanonical := make([]byte, 11)
	for i := range nonCanonical {
		nonCanonical[i] = 0xff
	}
	nonCanonical[10] = 0x00
	v, n = readVarint(nonCanonical, 0)
	_ = v
	if n > 11 {
		t.Fatalf("readVarint a dépassé le buffer: n=%d", n)
	}
}

// TestDecodeFields_TruncatedLength — une longueur déclarée qui dépasse le buffer
// ne doit pas paniquer (propriété de robustesse).
func TestDecodeFields_TruncatedLength(t *testing.T) {
	// key field 2 wire 2 (0x12) + longueur 100 mais seulement 3 octets de données.
	raw := []byte{0x12, 100, 'a', 'b', 'c'}
	fields := DecodeFields(raw)
	if len(fields) != 1 {
		t.Fatalf("Attendu 1 champ (tronqué), reçu %d", len(fields))
	}
	if len(fields[0].Bytes) != 3 {
		t.Errorf("Attendu les octets restants comme Bytes, reçu %d", len(fields[0].Bytes))
	}
}

// TestFrameHelper — vérifie que l'encodeur maison de frame est cohérent avec Frame().
func TestFrameHelper(t *testing.T) {
	payload := []byte("test")
	enc := frame(0, payload)
	if enc[0] != 0 {
		t.Errorf("Flags attendu 0, reçu %d", enc[0])
	}
	length := binary.BigEndian.Uint32(enc[1:5])
	if int(length) != len(payload) {
		t.Errorf("Longueur attendue %d, reçue %d", len(payload), length)
	}
}
