package gateway

import (
	"strings"
	"testing"
)

// TestAdvancedEdgeCases_HistoryParsing teste des cas rares et complexes d'extraction de requêtes et d'artefacts.
func TestAdvancedEdgeCases_HistoryParsing(t *testing.T) {
	t.Run("Mixed multi-line artifacts with spaces, parenthesis and Windows paths", func(t *testing.T) {
		raw := `<USER_REQUEST>
[ARTIFACT: Capture d'écran (1).PNG]
Path: file:///C:/Users/Developer/.gemini/antigravity/brain/session-123/scratch/upload_1787324800703 (1).png
Last Edited: 2026-08-21T16:00:00Z

[ARTIFACT: second_diagram.jpg]
Path: C:\Users\Developer\.gemini\antigravity\brain\session-123\.user_uploaded\second_diagram.jpg

Veuillez analyser ces deux captures et corriger l'erreur de layout.
</USER_REQUEST>
<ADDITIONAL_METADATA>
The current local time is: 2026-08-21T17:00:00+01:00.
</ADDITIONAL_METADATA>`

		clean := extractUserRequest(raw)

		// 1. Les balises brutes ARTIFACT et Path doivent être supprimées du texte utilisateur
		if strings.Contains(clean, "[ARTIFACT:") || strings.Contains(clean, "Last Edited:") {
			t.Errorf("Le texte contient encore des balises brutes : %s", clean)
		}

		// 2. Le texte utilisateur réel doit être préservé
		expectedPrompt := "Veuillez analyser ces deux captures et corriger l'erreur de layout."
		if !strings.Contains(clean, expectedPrompt) {
			t.Errorf("Le prompt utilisateur est manquant ou tronqué dans : %s", clean)
		}

		// 3. Les deux images doivent être transformées en tags markdown standardisés
		if !strings.Contains(clean, "![Image](file:///C:/Users/Developer/.gemini/antigravity/brain/session-123/scratch/upload_1787324800703 (1).png)") {
			t.Errorf("Première image non trouvée ou mal encodée dans : %s", clean)
		}
		if !strings.Contains(clean, "![Image](file:///C:/Users/Developer/.gemini/antigravity/brain/session-123/.user_uploaded/second_diagram.jpg)") {
			t.Errorf("Deuxième image non convertie en URI file:/// dans : %s", clean)
		}
	})

	t.Run("User prompt with multiple complex UTF-8 characters and code snippets", func(t *testing.T) {
		raw := `<USER_REQUEST>
[ARTIFACT: schéma_architecture_🚀.webp]
Path: file:///C:/projets/antigravity/brain/session/.user_uploaded/schéma_architecture_🚀.webp

Analysons la formule \(E = mc^2\) et le code Go :
` + "```go\nfunc Solve() int { return 42 }\n```" + `
Est-ce correct ?
</USER_REQUEST>`

		clean := extractUserRequest(raw)
		if !strings.Contains(clean, "Analysons la formule \\(E = mc^2\\)") {
			t.Errorf("Formule mathématique altérée dans : %s", clean)
		}
		if !strings.Contains(clean, "func Solve() int { return 42 }") {
			t.Errorf("Snippet de code altéré dans : %s", clean)
		}
		if !strings.Contains(clean, "![Image](file:///C:/projets/antigravity/brain/session/.user_uploaded/schéma_architecture_🚀.webp)") {
			t.Errorf("Image avec caractères UTF-8/emoji non trouvée : %s", clean)
		}
	})

	t.Run("Empty prompt with only multiple uploaded media files", func(t *testing.T) {
		raw := `<USER_REQUEST>
[ARTIFACT: img1.jpg]
Path: file:///C:/brain/img1.jpg

[ARTIFACT: img2.png]
Path: file:///C:/brain/img2.png
</USER_REQUEST>`

		clean := extractUserRequest(raw)
		expected := "![Image](file:///C:/brain/img1.jpg)\n\n![Image](file:///C:/brain/img2.png)"
		if clean != expected {
			t.Errorf("extractUserRequest(empty with 2 images) = %q, want %q", clean, expected)
		}
	})
}
