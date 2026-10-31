package connectrpc

import (
	"encoding/binary"
	"math"
	"strings"
)

// QuotaSummary porte les pourcentages de quota utilisateur extraits de la
// réponse protobuf RetrieveUserQuotaSummary. -1 = clé absente du buffer
// (le client mobile masque alors la tuile correspondante).
type QuotaSummary struct {
	WeeklyPercent         int
	FiveHourPercent       int
	WeeklyPercentClaude   int
	FiveHourPercentClaude int
}

// quotaKeys associe la clé ASCII de la réponse du LS aux champs du struct.
var quotaKeys = []struct {
	key  string
	name string
}{
	{"gemini-weekly", "weeklyPercent"},
	{"gemini-5h", "fiveHourPercent"},
	{"3p-weekly", "weeklyPercentClaude"},
	{"3p-5h", "fiveHourPercentClaude"},
}

// ParseQuotaSummary extrait les pourcentages de quota d'une réponse protobuf
// brute de RetrieveUserQuotaSummary, sans schéma (le LS 2.5.x n'expose pas de
// descriptor public). Stratégie portée du projet Antigravity-Chinese
// (parseProtoQuota) : pour chaque clé connue, on cherche le marqueur de champ
// fixed32 (0x25) dans les 500 octets suivants puis on lit le float32 LE.
// Le LS renvoie la fraction *utilisée* (0..1) ; on la convertit en % utilisé
// clampé 0-100, comme l'UI Settings du desktop.
func ParseQuotaSummary(raw []byte) QuotaSummary {
	var q QuotaSummary
	q.WeeklyPercent = -1
	q.FiveHourPercent = -1
	q.WeeklyPercentClaude = -1
	q.FiveHourPercentClaude = -1
	for _, item := range quotaKeys {
		idx := indexOf(raw, item.key)
		if idx == -1 {
			continue
		}
		// Le float peut être précédé de quelques octets (nested messages) ;
		// borne le scan à 500 octets comme l'implémentation de référence.
		limit := idx + 500
		if limit > len(raw) {
			limit = len(raw)
		}
		for i := idx + len(item.key); i < limit; i++ {
			if raw[i] == 0x25 && i+4 < len(raw) {
				used := math.Float32frombits(binary.LittleEndian.Uint32(raw[i+1 : i+5]))
				pct := int(math.Round(float64(used) * 100))
				if pct < 0 {
					pct = 0
				}
				if pct > 100 {
					pct = 100
				}
				switch item.name {
				case "weeklyPercent":
					q.WeeklyPercent = pct
				case "fiveHourPercent":
					q.FiveHourPercent = pct
				case "weeklyPercentClaude":
					q.WeeklyPercentClaude = pct
				case "fiveHourPercentClaude":
					q.FiveHourPercentClaude = pct
				}
				break
			}
		}
	}
	return q
}

// HasQuota indique si au moins une valeur exploitable a été trouvée.
func (q QuotaSummary) HasQuota() bool {
	return q.WeeklyPercent >= 0 || q.FiveHourPercent >= 0 ||
		q.WeeklyPercentClaude >= 0 || q.FiveHourPercentClaude >= 0
}

// indexOf cherche une sous-chaîne ASCII dans un buffer (strings.Index sur une
// conversion évitée : scan manuel O(n·m), m ≤ 12 — suffisant).
func indexOf(raw []byte, sub string) int {
	if len(sub) == 0 || len(raw) < len(sub) {
		return -1
	}
	for i := 0; i <= len(raw)-len(sub); i++ {
		if strings.EqualFold(string(raw[i:i+len(sub)]), sub) {
			return i
		}
	}
	return -1
}
