package discovery

import (
	"os"
	"testing"
)

func TestLiveDiscovery(t *testing.T) {
	if os.Getenv("DAEMON_LIVE_E2E") != "1" {
		t.Skip("Live Discovery désactivé par défaut (définir DAEMON_LIVE_E2E=1 pour exécuter)")
		return
	}
	info, err := Discover()
	if err != nil {
		t.Fatalf("Discovery failed: %v", err)
	}
	t.Logf("DISCOVERED: PID=%d Name=%s Port=%d Subclient=%s WorkspaceID=%s CSRF=%s",
		info.PID, info.ProcessName, info.ConnectRPCPort, info.SubclientType, info.WorkspaceID, info.CSRFToken)
	if info.PID <= 0 {
		t.Errorf("PID invalide: %d", info.PID)
	}
	if info.ConnectRPCPort <= 0 {
		t.Errorf("Port invalide: %d", info.ConnectRPCPort)
	}
	token := info.ExtensionCSRF
	if token == "" {
		token = info.CSRFToken
	}
	if token == "" {
		t.Errorf("CSRF token vide")
	}
}
