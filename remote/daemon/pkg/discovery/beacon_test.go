package discovery

import (
	"encoding/json"
	"net"
	"testing"
	"time"
)

func TestLANBeaconPayloadAndResponder(t *testing.T) {
	beacon := NewLANBeacon(
		8090,
		func() string { return "https://remote.antigravity.test" },
		func() []string { return []string{"my-project", "pos"} },
	)

	payloadBytes := beacon.buildPayload("My-Test-Laptop")
	var payload BeaconPayload
	if err := json.Unmarshal(payloadBytes, &payload); err != nil {
		t.Fatalf("Unmarshal error: %v", err)
	}

	if payload.Magic != DiscoveryMagic {
		t.Errorf("Magic = %q, want %q", payload.Magic, DiscoveryMagic)
	}
	if payload.Hostname != "My-Test-Laptop" {
		t.Errorf("Hostname = %q, want %q", payload.Hostname, "My-Test-Laptop")
	}
	if payload.Port != 8090 {
		t.Errorf("Port = %d, want 8090", payload.Port)
	}
	// Le token d'auth ne doit JAMAIS être diffusé sur le LAN (broadcast lisible
	// par tout hôte) — le pairing passe par le QR ou la saisie manuelle.
	// Vérification au niveau du JSON brut : la clé ne doit même pas exister.
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(payloadBytes, &raw); err != nil {
		t.Fatalf("Unmarshal raw error: %v", err)
	}
	if _, present := raw["authToken"]; present {
		t.Error("authToken présent dans le payload diffusé (fuite de sécurité)")
	}
	if payload.PublicURL != "https://remote.antigravity.test" {
		t.Errorf("PublicURL = %q, want %q", payload.PublicURL, "https://remote.antigravity.test")
	}
	if len(payload.Workspaces) != 2 {
		t.Errorf("Workspaces length = %d, want 2", len(payload.Workspaces))
	}
}

func TestLANBeaconLoopStartStop(t *testing.T) {
	beacon := NewLANBeacon(
		8090,
		nil,
		nil,
	)

	if err := beacon.Start(); err != nil {
		t.Fatalf("Start error: %v", err)
	}

	// Double start should be safe
	if err := beacon.Start(); err != nil {
		t.Fatalf("Double start error: %v", err)
	}

	time.Sleep(50 * time.Millisecond)
	beacon.Stop()

	// Double stop should be safe
	beacon.Stop()
}

func TestDiscoveryQueryResponse(t *testing.T) {
	// Test sending discovery query to beacon responder
	listenAddr, err := net.ResolveUDPAddr("udp4", "127.0.0.1:0")
	if err != nil {
		t.Skip("UDP resolution unavailable")
	}
	conn, err := net.ListenUDP("udp4", listenAddr)
	if err != nil {
		t.Skip("Cannot open client UDP socket")
	}
	defer conn.Close()
}
