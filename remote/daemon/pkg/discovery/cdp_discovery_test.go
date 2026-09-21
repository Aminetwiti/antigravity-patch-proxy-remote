package discovery

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReadDevToolsActivePort(t *testing.T) {
	tmpDir := t.TempDir()
	portFile := filepath.Join(tmpDir, "DevToolsActivePort")

	content := "53061\n/devtools/browser/4fa42610-4438-419e-926c-c2c05763a83f\n"
	if err := os.WriteFile(portFile, []byte(content), 0644); err != nil {
		t.Fatalf("échec écriture fichier temp: %v", err)
	}

	port, browserPath, err := ReadDevToolsActivePort(portFile)
	if err != nil {
		t.Fatalf("ReadDevToolsActivePort returned error: %v", err)
	}

	if port != 53061 {
		t.Errorf("attendu port 53061, obtenu %d", port)
	}
	if browserPath != "/devtools/browser/4fa42610-4438-419e-926c-c2c05763a83f" {
		t.Errorf("attendu browserPath spécifique, obtenu %s", browserPath)
	}
}

func TestReadDevToolsActivePort_Invalid(t *testing.T) {
	tmpDir := t.TempDir()
	portFile := filepath.Join(tmpDir, "DevToolsActivePort")

	if err := os.WriteFile(portFile, []byte("not_a_number\n"), 0644); err != nil {
		t.Fatalf("échec écriture: %v", err)
	}

	_, _, err := ReadDevToolsActivePort(portFile)
	if err == nil {
		t.Errorf("attendu erreur pour port non-numérique, obtenu nil")
	}
}
