package connectrpc

import (
	"encoding/binary"
	"math"
	"math/rand"
	"testing"
)

// buildQuotaFrame construit un buffer protobuf synthétique imitant la réponse
// de RetrieveUserQuotaSummary : chaque clé est précédée d'un tag length-
// delimited (0x0A) et suivie du marqueur fixed32 (0x25) + float32 LE.
func buildQuotaFrame(t *testing.T, values map[string]float32) []byte {
	t.Helper()
	var buf []byte
	for key, v := range values {
		buf = append(buf, 0x0A, byte(len(key)))
		buf = append(buf, key...)
		buf = append(buf, 0x25)
		var f [4]byte
		binary.LittleEndian.PutUint32(f[:], math.Float32bits(v))
		buf = append(buf, f[:]...)
	}
	return buf
}

func TestParseQuotaSummary(t *testing.T) {
	raw := buildQuotaFrame(t, map[string]float32{
		"gemini-weekly": 0.42,
		"gemini-5h":     0.68,
		"3p-weekly":     0.10,
		"3p-5h":         0.95,
	})
	q := ParseQuotaSummary(raw)
	if q.WeeklyPercent != 42 {
		t.Errorf("WeeklyPercent = %d, attendu 42", q.WeeklyPercent)
	}
	if q.FiveHourPercent != 68 {
		t.Errorf("FiveHourPercent = %d, attendu 68", q.FiveHourPercent)
	}
	if q.WeeklyPercentClaude != 10 {
		t.Errorf("WeeklyPercentClaude = %d, attendu 10", q.WeeklyPercentClaude)
	}
	if q.FiveHourPercentClaude != 95 {
		t.Errorf("FiveHourPercentClaude = %d, attendu 95", q.FiveHourPercentClaude)
	}
	if !q.HasQuota() {
		t.Error("HasQuota() = false, attendu true")
	}
}

func TestParseQuotaSummaryMissingKeys(t *testing.T) {
	raw := buildQuotaFrame(t, map[string]float32{"gemini-weekly": 0.5})
	q := ParseQuotaSummary(raw)
	if q.WeeklyPercent != 50 {
		t.Errorf("WeeklyPercent = %d, attendu 50", q.WeeklyPercent)
	}
	if q.FiveHourPercent != -1 || q.WeeklyPercentClaude != -1 || q.FiveHourPercentClaude != -1 {
		t.Errorf("Clés absentes non marquées: %+v", q)
	}
	if q.HasQuota() != true {
		t.Error("HasQuota() = false avec une clé présente")
	}
}

func TestParseQuotaSummaryClamp(t *testing.T) {
	raw := buildQuotaFrame(t, map[string]float32{"gemini-weekly": -0.5, "gemini-5h": 1.7})
	q := ParseQuotaSummary(raw)
	if q.WeeklyPercent != 0 {
		t.Errorf("Clamp bas: WeeklyPercent = %d, attendu 0", q.WeeklyPercent)
	}
	if q.FiveHourPercent != 100 {
		t.Errorf("Clamp haut: FiveHourPercent = %d, attendu 100", q.FiveHourPercent)
	}
}

func TestParseQuotaSummaryEmpty(t *testing.T) {
	q := ParseQuotaSummary(nil)
	if q.HasQuota() {
		t.Error("HasQuota() = true sur buffer vide")
	}
	for _, v := range []int{q.WeeklyPercent, q.FiveHourPercent, q.WeeklyPercentClaude, q.FiveHourPercentClaude} {
		if v != -1 {
			t.Errorf("Valeur = %d, attendu -1 sur buffer vide", v)
		}
	}
}

// TestParseQuotaSummaryNoPanic fuzz léger : un buffer aléatoire ne doit jamais
// faire paniquer le parseur (pas de lecture hors bornes).
func TestParseQuotaSummaryNoPanic(t *testing.T) {
	rng := rand.New(rand.NewSource(42))
	for i := 0; i < 2000; i++ {
		buf := make([]byte, rng.Intn(512))
		rng.Read(buf)
		// Injecte parfois une clé partielle pour exercer le chemin du marqueur.
		if i%3 == 0 && len(buf) > 8 {
			copy(buf[2:], "gemini-week")
		}
		_ = ParseQuotaSummary(buf)
	}
}
