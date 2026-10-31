package gateway

// Tests du correctif « sidebar fantômes » : les sessions archivées et
// supprimées ne doivent plus apparaître dans la sidebar Projects du mobile
// (fallback disque inclus), tandis que les archivées restent disponibles
// pour l'historique des conversations (list_all_sessions).

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/antigravity/remote-daemon/pkg/connectrpc"
)

// TestIsJunkSessionTitle — le fallback disque doit masquer les sessions sans
// titre réel (« Cascade Session » côté mobile) de plus de 24 h, comme les
// chemins froid et Jetbox le font déjà.
func TestIsJunkSessionTitle(t *testing.T) {
	for _, title := range []string{"", "Untitled Conversation", "Cascade Session", "Empty session", "New conversation", "General Conversation"} {
		if !isJunkSessionTitle(title) {
			t.Fatalf("isJunkSessionTitle(%q) = false, attendu true", title)
		}
	}
	for _, title := range []string{"Refactor cache layer", "Mobile Daemon Launcher Plan", "Audit Forensic Technique Complet"} {
		if isJunkSessionTitle(title) {
			t.Fatalf("isJunkSessionTitle(%q) = true, attendu false", title)
		}
	}
}

// TestSessionsFromSummariesOptsArchived — chemin Jetbox chaud : une session
// archivée est exclue de la sidebar (includeArchived=false) mais conservée et
// marquée pour l'historique (includeArchived=true).
func TestSessionsFromSummariesOptsArchived(t *testing.T) {
	gw := &Server{}
	summaries := map[string]connectrpc.JetboxSummary{
		"casc-live": {CascadeID: "casc-live", Title: "Session active", Status: "CASCADE_STATUS_READY", UpdatedAt: time.Now()},
		"casc-arch": {CascadeID: "casc-arch", Title: "Session archivée", Status: "CASCADE_STATUS_READY", UpdatedAt: time.Now(), Archived: true},
	}

	sidebar := gw.sessionsFromSummariesOptsLocked(summaries, false)
	items, _ := sidebar["sessions"].([]map[string]interface{})
	if len(items) != 1 {
		t.Fatalf("sidebar: attendu 1 session (active), reçu %d", len(items))
	}
	if id, _ := items[0]["cascadeId"].(string); id != "casc-live" {
		t.Fatalf("sidebar: attendu casc-live, reçu %v", id)
	}

	history := gw.sessionsFromSummariesOptsLocked(summaries, true)
	hItems, _ := history["sessions"].([]map[string]interface{})
	if len(hItems) != 2 {
		t.Fatalf("historique: attendu 2 sessions, reçu %d", len(hItems))
	}
	for _, it := range hItems {
		id, _ := it["cascadeId"].(string)
		isArch, _ := it["isArchived"].(bool)
		st, _ := it["status"].(string)
		if id == "casc-arch" {
			if !isArch || st != "CASCADE_STATUS_ARCHIVED" {
				t.Fatalf("archivée mal marquée: isArchived=%v status=%q", isArch, st)
			}
		} else if isArch {
			t.Fatalf("session active marquée archivée par erreur")
		}
	}
}

// TestListLocalSessionsOptsArchivedVsDeleted — fallback disque : archivée
// exclue de la sidebar mais présente (marquée) dans l'historique ; supprimée
// exclue partout.
func TestListLocalSessionsOptsArchivedVsDeleted(t *testing.T) {
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatalf("UserHomeDir: %v", err)
	}
	annoDir := filepath.Join(home, ".gemini", "antigravity", "annotations")
	if err := os.MkdirAll(annoDir, 0o755); err != nil {
		t.Fatalf("MkdirAll annotations: %v", err)
	}

	archID := "cafe0000-0000-4000-8000-00000000cafe"
	delID := "cafe0001-0000-4000-8000-00000000cafe"
	for _, id := range []string{archID, delID} {
		if _, err := os.Stat(filepath.Join(annoDir, id+".pbtxt")); err == nil {
			t.Skipf("annotation existante %s — test ignoré (fichier réel)", id)
		}
	}
	if err := os.WriteFile(filepath.Join(annoDir, archID+".pbtxt"), []byte("cascade_id: \""+archID+"\"\narchived: true\n"), 0o644); err != nil {
		t.Fatalf("WriteFile annotation archivée: %v", err)
	}
	defer os.Remove(filepath.Join(annoDir, archID+".pbtxt"))
	if err := os.WriteFile(filepath.Join(annoDir, delID+".pbtxt"), []byte("cascade_id: \""+delID+"\"\ndeleted: true\n"), 0o644); err != nil {
		t.Fatalf("WriteFile annotation supprimée: %v", err)
	}
	defer os.Remove(filepath.Join(annoDir, delID+".pbtxt"))

	if !isSessionArchived(home, archID) || !isSessionArchived(home, delID) {
		t.Fatalf("isSessionArchived doit couvrir archivée et supprimée")
	}
	if !isSessionDeleted(home, delID) {
		t.Fatalf("isSessionDeleted(delID) = false, attendu true")
	}
	if isSessionDeleted(home, archID) {
		t.Fatalf("isSessionDeleted(archID) = true, attendu false")
	}

	for _, s := range ListLocalSessions() {
		if id, _ := s["cascadeId"].(string); id == archID || id == delID {
			t.Fatalf("sidebar (fallback disque) contient %s — doit être masquée", id)
		}
	}

	for _, s := range ListLocalSessionsOpts(true) {
		id, _ := s["cascadeId"].(string)
		if id == delID {
			t.Fatalf("historique (fallback disque) contient la session supprimée %s", id)
		}
		if id == archID {
			if isArch, _ := s["isArchived"].(bool); !isArch {
				t.Fatalf("session archivée %s non marquée isArchived dans l'historique", id)
			}
			if st, _ := s["status"].(string); st != "CASCADE_STATUS_ARCHIVED" {
				t.Fatalf("session archivée %s status=%q, attendu CASCADE_STATUS_ARCHIVED", id, st)
			}
		}
	}
}
