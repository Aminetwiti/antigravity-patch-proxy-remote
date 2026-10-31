package discovery

import (
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/antigravity/remote-daemon/pkg/connectrpc"
)

// TestWatchdogUpdatesClientOnRestart vérifie que le Watchdog met à jour le
// client (port + CSRF) quand le hub redémarre, sans couper la session.
func TestWatchdogUpdatesClientOnRestart(t *testing.T) {
	client := connectrpc.NewClient(51000, "old-token")

	// Le 1er tick renvoie un hub redémarré (nouveau port + nouveau token).
	var calls int32
	w := NewWatchdog(client, 10*time.Millisecond)
	w.discover = func() (*LocalHarnessInfo, error) {
		if atomic.AddInt32(&calls, 1) == 1 {
			return &LocalHarnessInfo{ConnectRPCPort: 51234, ExtensionCSRF: "new-token"}, nil
		}
		return &LocalHarnessInfo{ConnectRPCPort: 51234, ExtensionCSRF: "new-token"}, nil
	}

	w.Start()
	defer w.Stop()

	deadline := time.Now().Add(2 * time.Second)
	port, token := client.Endpoint()
	for port != 51234 || token != "new-token" {
		if time.Now().After(deadline) {
			t.Fatalf("Watchdog n'a pas mis à jour le client (port=%d token=%s)", port, token)
		}
		time.Sleep(5 * time.Millisecond)
		port, token = client.Endpoint()
	}

	if port != 51234 || token != "new-token" {
		t.Fatalf("Client non mis à jour: port=%d token=%s", port, token)
	}
}

// TestWatchdogIgnoresDiscoveryErrors — une erreur de découverte ne doit pas
// corrompre l'état du client (le client garde ses valeurs).
func TestWatchdogIgnoresDiscoveryErrors(t *testing.T) {
	client := connectrpc.NewClient(51000, "stable-token")
	w := NewWatchdog(client, 10*time.Millisecond)
	w.discover = func() (*LocalHarnessInfo, error) {
		return nil, errors.New("hub introuvable")
	}

	w.Start()
	defer w.Stop()

	time.Sleep(100 * time.Millisecond)
	port, token := client.Endpoint()
	if port != 51000 || token != "stable-token" {
		t.Fatalf("Le client ne doit pas changer après une erreur de découverte: port=%d token=%s", port, token)
	}
}
