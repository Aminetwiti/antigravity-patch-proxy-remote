package gateway

import (
	"strings"
	"testing"

	"github.com/antigravity/remote-daemon/pkg/connectrpc"
)

// TestExtractUserRequest_ComplexMultiArtifacts teste l'extraction avancée
// de multiples artefacts avec chemins Windows, URI encodées et métadonnées résiduelles.
func TestExtractUserRequest_ComplexMultiArtifacts(t *testing.T) {
	raw := `<USER_REQUEST>
[ARTIFACT: screenshot 1 with space.png]
Path: file:///C:/Users/developer/My%20Documents/screenshot%201%20with%20space.png
Last Edited: 2026-08-21T16:00:00Z

[ARTIFACT: debug_trace.jpg]
Path: C:\Users\developer\.gemini\antigravity\brain\test\.user_uploaded\debug_trace.jpg

voici les deux captures d'erreur pour analyse
</USER_REQUEST>
<ADDITIONAL_METADATA>
The current local time is: 2026-08-21T17:00:00+01:00.
</ADDITIONAL_METADATA>`

	got := extractUserRequest(raw)

	// 1. Ne doit contenir aucune balise brute [ARTIFACT: ...] ou métadonnées
	if strings.Contains(got, "[ARTIFACT:") || strings.Contains(got, "Last Edited:") {
		t.Fatalf("extractUserRequest contient encore des balises brutes: %q", got)
	}

	// 2. Doit conserver le texte du prompt utilisateur
	if !strings.Contains(got, "voici les deux captures d'erreur pour analyse") {
		t.Fatalf("extractUserRequest a perdu le texte utilisateur: %q", got)
	}

	// 3. Doit contenir les deux images formatées en markdown
	if !strings.Contains(got, "![Image](file:///C:/Users/developer/My%20Documents/screenshot%201%20with%20space.png)") {
		t.Errorf("Image 1 manquante dans %q", got)
	}
	if !strings.Contains(got, "debug_trace.jpg") {
		t.Errorf("Image 2 manquante dans %q", got)
	}
}

// TestExtractUserRequest_EdgeCases teste les cas limites rares :
// - Message sans texte (seulement image)
// - Caractères accentués, emojis, balises imbriquées
func TestExtractUserRequest_EdgeCases(t *testing.T) {
	// Cas 1: Seulement un artifact sans texte
	onlyArt := `<USER_REQUEST>
[ARTIFACT: patch_diff.png]
Path: file:///C:/Users/developer/patch_diff.png
</USER_REQUEST>`
	got1 := extractUserRequest(onlyArt)
	if got1 != "![Image](file:///C:/Users/developer/patch_diff.png)" {
		t.Errorf("got1 = %q, want ![Image](file:///C:/Users/developer/patch_diff.png)", got1)
	}

	// Cas 2: Texte avec caractères spéciaux et emojis
	emojiReq := `<USER_REQUEST>
🚀 Analyse du composant UI/UX & performance ⚡ (100% testé)
</USER_REQUEST>`
	got2 := extractUserRequest(emojiReq)
	if got2 != "🚀 Analyse du composant UI/UX & performance ⚡ (100% testé)" {
		t.Errorf("got2 = %q", got2)
	}

	// Cas 3: Requête vide
	emptyReq := `<USER_REQUEST>

</USER_REQUEST>`
	got3 := extractUserRequest(emptyReq)
	if got3 != "" {
		t.Errorf("got3 = %q, want empty string", got3)
	}
}

// TestEnrichStatus_ComplexMatrix teste la matrice d'état pour les sessions
// actives, les approbations en attente et les états de repli.
func TestEnrichStatus_ComplexMatrix(t *testing.T) {
	srv := &Server{
		activeCascades: map[string]bool{
			"session-running-1": true,
			"session-running-2": true,
		},
		approvals: map[string]*pendingApproval{
			"session-approval": {
				expired: false,
			},
			"session-expired": {
				expired: true,
			},
		},
	}

	// sessionsFromSummariesLocked
	res := srv.sessionsFromSummariesLocked(map[string]connectrpc.JetboxSummary{
		"session-running-1": {
			CascadeID: "session-running-1",
			Title:     "Active Session",
			Status:    "CASCADE_STATUS_READY",
			StepCount: 5,
		},
		"session-approval": {
			CascadeID: "session-approval",
			Title:     "Waiting Approval",
			Status:    "CASCADE_STATUS_READY",
			StepCount: 3,
		},
		"session-idle": {
			CascadeID: "session-idle",
			Title:     "Idle Session",
			Status:    "idle",
			StepCount: 2,
		},
	})

	sessions, ok := res["sessions"].([]map[string]interface{})
	if !ok || len(sessions) == 0 {
		t.Fatalf("sessions invalides: %v", res)
	}

	statuses := make(map[string]string)
	for _, s := range sessions {
		id := s["cascadeId"].(string)
		statuses[id] = s["status"].(string)
	}

	if statuses["session-running-1"] != "CASCADE_STATUS_RUNNING" {
		t.Errorf("session-running-1 status = %q, want CASCADE_STATUS_RUNNING", statuses["session-running-1"])
	}
	if statuses["session-approval"] != "CASCADE_STATUS_WAITING_FOR_USER_ACTION" {
		t.Errorf("session-approval status = %q, want CASCADE_STATUS_WAITING_FOR_USER_ACTION", statuses["session-approval"])
	}
	if statuses["session-idle"] != "CASCADE_STATUS_READY" {
		t.Errorf("session-idle status = %q, want CASCADE_STATUS_READY", statuses["session-idle"])
	}
}
