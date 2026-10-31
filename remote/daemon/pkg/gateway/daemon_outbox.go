package gateway

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// DaemonOutbox est la file de messages utilisateur côté daemon : quand le
// WebSocket mobile est coupé AVANT le stream_end, le prompt n'est pas confirmé.
// On persiste ici un append-only JSONL par cascade (~/.gemini/antigravity-remote/
// outbox/<cascadeId>.jsonl). À la reconnexion, sync_session renvoie ces messages
// en attente (pendingMessages) — le mobile ré-affiche les prompts non confirmés
// et peut les retransmettre (dédupliqués par requestId côté hub).
//
// ponytail: plafond = pas de ré-envoi automatique (l'utilisateur décide), et les
// entrées de plus de 24 h sont purgées — upgrade = retransmission avec backoff
// ou confirmation explicite par le mobile si le besoin apparaît.
type DaemonOutbox struct {
	// now : horloge injectable (tests déterministes).
	now func() time.Time
}

// outboxFileMu : verrou de PACKAGE (pas par instance) — Windows n'autorise pas
// deux handles en écriture simultanés sur le même JSONL. En production le daemon
// ne crée qu'un serveur (verrou non contentieux) ; en test, plusieurs serveurs
// partagent le même chemin (casc-1.jsonl) et le même processus → ce verrou
// sérialise les accès disque qui sinon se marchaient dessus (tmp + rename).
var outboxFileMu sync.Mutex

// pendingMessageMaxAge : au-delà, un message non confirmé est considéré comme
// obsolète (le transcript contiendra l'échange si l'agent a répondu) et purgé.
const pendingMessageMaxAge = 24 * time.Hour

// NewDaemonOutbox instancie l'outbox du daemon (une seule instance, chemin par
// cascade dérivé à chaque appel).
func NewDaemonOutbox() *DaemonOutbox {
	return &DaemonOutbox{now: time.Now}
}

// pendingOutboxPath : chemin du fichier JSONL de l'outbox pour une cascade.
// Variable (pas const) pour testabilité — les tests redirigent vers t.TempDir().
var pendingOutboxPath = func(cascadeID string) string {
	home, err := os.UserHomeDir()
	if err != nil {
		return "daemon_outbox_" + cascadeID + ".jsonl"
	}
	return filepath.Join(home, ".gemini", "antigravity-remote", "outbox", cascadeID+".jsonl")
}

// Append enregistre un prompt non confirmé. Idempotent par requestId : un
// même prompt retransmis (outbox replay) ne crée pas de doublon sur disque.
func (o *DaemonOutbox) Append(cascadeID, requestID, prompt string) error {
	if cascadeID == "" || requestID == "" || prompt == "" {
		return nil // rien à persister
	}
	outboxFileMu.Lock()
	defer outboxFileMu.Unlock()

	if o.existsLocked(cascadeID, requestID) {
		return nil // déjà persisté (retransmission)
	}

	line, err := json.Marshal(map[string]interface{}{
		"requestId": requestID,
		"cascadeId": cascadeID,
		"prompt":    prompt,
		"queuedAt":  o.now().UTC().Format(time.RFC3339),
	})
	if err != nil {
		return err
	}

	path := pendingOutboxPath(cascadeID)
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.Write(append(line, '\n'))
	return err
}

// Pending renvoie les messages non confirmés d'une cascade (ordre chronologique),
// en purgeant au passage ceux de plus de 24 h.
func (o *DaemonOutbox) Pending(cascadeID string) []map[string]interface{} {
	if cascadeID == "" {
		return nil
	}
	outboxFileMu.Lock()
	defer outboxFileMu.Unlock()

	path := pendingOutboxPath(cascadeID)
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()

	cutoff := o.now().Add(-pendingMessageMaxAge)
	var out []map[string]interface{}
	var stale []string // lignes à purger (hors limites d'âge)
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var m map[string]interface{}
		if json.Unmarshal([]byte(line), &m) != nil {
			continue // ligne corrompue → ignorée
		}
		if m["requestId"] == nil || m["prompt"] == nil {
			continue
		}
		if t, ok := m["queuedAt"].(string); ok {
			if parsed, err := time.Parse(time.RFC3339, t); err == nil && parsed.Before(cutoff) {
				stale = append(stale, line)
				continue
			}
		}
		out = append(out, m)
	}
	if len(stale) > 0 {
		var remaining []string
		for _, m := range out {
			if b, err := json.Marshal(m); err == nil {
				remaining = append(remaining, string(b))
			}
		}
		_ = o.rewriteLocked(path, remaining) // purge des lignes obsolètes en préservant les récentes
	}
	return out
}

// Confirm supprime un message confirmé d'une cascade (requestId donné).
func (o *DaemonOutbox) Confirm(cascadeID, requestID string) error {
	if cascadeID == "" || requestID == "" {
		return nil
	}
	outboxFileMu.Lock()
	defer outboxFileMu.Unlock()

	path := pendingOutboxPath(cascadeID)
	lines, err := o.readLinesLocked(path)
	if err != nil || lines == nil {
		return err
	}
	kept := lines[:0]
	removed := false
	for _, l := range lines {
		if l == "" {
			continue
		}
		var m map[string]interface{}
		if json.Unmarshal([]byte(l), &m) != nil {
			kept = append(kept, l) // corrompu → conservé tel quel
			continue
		}
		if m["requestId"] == requestID {
			removed = true
			continue
		}
		kept = append(kept, l)
	}
	if !removed {
		return nil // rien à réécrire
	}
	return o.rewriteLocked(path, kept)
}

// rewriteLocked réécrit le fichier (nil → suppression). Verrou déjà tenu.
func (o *DaemonOutbox) rewriteLocked(path string, lines []string) error {
	if len(lines) == 0 {
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return err
		}
		return nil
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, []byte(strings.Join(lines, "\n")+"\n"), 0600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// existsLocked vérifie la présence d'un requestId (verrou déjà tenu).
func (o *DaemonOutbox) existsLocked(cascadeID, requestID string) bool {
	lines, err := o.readLinesLocked(pendingOutboxPath(cascadeID))
	if err != nil || lines == nil {
		return false
	}
	for _, l := range lines {
		if l == "" {
			continue
		}
		var m map[string]interface{}
		if json.Unmarshal([]byte(l), &m) != nil {
			continue
		}
		if m["requestId"] == requestID {
			return true
		}
	}
	return false
}

// readLinesLocked relit toutes les lignes d'un fichier (verrou déjà tenu).
func (o *DaemonOutbox) readLinesLocked(path string) ([]string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	s := strings.TrimRight(string(data), "\n")
	if s == "" {
		return nil, nil
	}
	return strings.Split(s, "\n"), nil
}
