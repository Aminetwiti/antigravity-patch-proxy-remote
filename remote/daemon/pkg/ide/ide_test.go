package ide

import (
	"os"
	"path/filepath"
	"strings"
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

func TestDiscoverInstances(t *testing.T) {
	instances, err := DiscoverInstances()
	if err != nil {
		t.Fatalf("DiscoverInstances error: %v", err)
	}
	t.Logf("✅ Instances IDE découvertes : %d", len(instances))
	for _, inst := range instances {
		t.Logf("  - PID: %d | Port: %d | WS: %s | AppDir: %s", inst.PID, inst.Port, inst.WorkspaceID, inst.AppDataDir)
	}
}

func TestFindInstanceForCascade(t *testing.T) {
	cid := "12deb7f0-b0a0-4461-95a6-b9b45ecec1c5"
	hint := extractCascadeWorkspaceHint(cid)
	t.Logf("🔍 Hint extrait pour %s : %q", cid, hint)
	inst, err := FindInstanceForCascade(cid)
	if err != nil {
		if strings.Contains(err.Error(), "aucune instance active") {
			t.Skip("aucune instance active d'Antigravity IDE trouvée (normal hors environnement IDE)")
		}
		t.Fatalf("FindInstanceForCascade error: %v", err)
	}
	t.Logf("🎯 Instance trouvée pour cascade %s : PID %d, Port %d, WS %s", cid, inst.PID, inst.Port, inst.WorkspaceID)
	if inst.PID != 17992 && !strings.Contains(inst.WorkspaceID, "Copie") {
		t.Errorf("attendu instance pour www - Copie, obtenu: %v", inst)
	}
}

func TestFindClientForCascade(t *testing.T) {
	cid := "12deb7f0-b0a0-4461-95a6-b9b45ecec1c5"
	client, err := FindClientForCascade(cid)
	if err != nil {
		if strings.Contains(err.Error(), "aucune instance active") {
			t.Skip("aucune instance active d'Antigravity IDE trouvée (normal hors environnement IDE)")
		}
		t.Fatalf("FindClientForCascade failed: %v", err)
	}
	hb, errHb := client.Heartbeat()
	if errHb != nil {
		t.Fatalf("Heartbeat failed: %v", errHb)
	}
	t.Logf("✅ Heartbeat OK sur l'instance IDE pour %s (reçu %d octets)", cid, len(hb))
}
