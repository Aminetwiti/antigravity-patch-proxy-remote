package ide

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDecodeURI(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"file:///c%3A/Users/amine/Downloads", filepath.FromSlash("c:/Users/amine/Downloads")},
		{"file:///d:/projects/app", filepath.FromSlash("d:/projects/app")},
		{"", ""},
	}

	for _, tt := range tests {
		got := DecodeURI(tt.input)
		if got != tt.expected {
			t.Errorf("DecodeURI(%q) = %q, attendu %q", tt.input, got, tt.expected)
		}
	}
}

func TestExtractCSRFToken(t *testing.T) {
	cmd := `language_server.exe --csrf_token aca2a2fd-f0e6-4053-931e-a28accf6f5f2 --port 55432`
	token := ExtractCSRFTokenFromCmd(cmd)
	if token != "aca2a2fd-f0e6-4053-931e-a28accf6f5f2" {
		t.Errorf("ExtractCSRFTokenFromCmd a échoué: %q", token)
	}
}

func TestListWorkspaces(t *testing.T) {
	workspaces, err := ListWorkspaces()
	if err != nil {
		if os.IsNotExist(err) {
			t.Skip("storage.json non présent sur cet environnement")
		}
		t.Fatalf("ListWorkspaces error: %v", err)
	}
	t.Logf("✅ Workspaces découverts : %d", len(workspaces))
	for _, ws := range workspaces {
		t.Logf("  - [%v] %s (%s)", ws.IsActive, ws.Name, ws.Path)
	}
}

func TestListSessions(t *testing.T) {
	sessions, err := ListSessions()
	if err != nil {
		t.Fatalf("ListSessions error: %v", err)
	}
	t.Logf("✅ Sessions IDE découvertes : %d", len(sessions))
	for _, s := range sessions {
		t.Logf("  - ID: %s | Étapes: %d | Titre: %q | Modifié: %v", s.CascadeID, s.StepCount, s.Title, s.LastModified)
	}
}
