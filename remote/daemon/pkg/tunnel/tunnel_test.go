package tunnel

import (
	"strings"
	"testing"
)

func TestWebsocketURLConversion(t *testing.T) {
	httpsURL := "https://random123.trycloudflare.com"
	expectedWSS := "wss://random123.trycloudflare.com/ws"

	wsURL := WebSocketURL(httpsURL)
	if wsURL != expectedWSS {
		t.Errorf("Attendu %s, reçu %s", expectedWSS, wsURL)
	}
}

// TestCloudflareURLRegex â€” le parseur doit extraire l'URL trycloudflare depuis
// la sortie stderr rÃ©elle de cloudflared (lignes de logs mÃ©langÃ©es).
func TestCloudflareURLRegex(t *testing.T) {
	lines := []string{
		"INF Registered tunnel connection connIndex=0",
		"INF +--------------------------------------------------------------------------------------------+",
		"INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |",
		"INF |  https://random-words-123.trycloudflare.com                                                |",
		"INF +--------------------------------------------------------------------------------------------+",
	}
	var got string
	for _, line := range lines {
		if m := cloudflareURLRe.FindString(line); m != "" {
			got = m
			break
		}
	}
	if got != "https://random-words-123.trycloudflare.com" {
		t.Fatalf("Attendu https://random-words-123.trycloudflare.com, reÃ§u %q", got)
	}

	// Pas de faux positif sur des lignes sans URL.
	if m := cloudflareURLRe.FindString("INF Registered tunnel connection connIndex=0"); m != "" {
		t.Fatalf("Faux positif: %q", m)
	}
}

// TestPinggyURLRegex â€” le parseur doit extraire l'URL pinggy depuis stdout
// (ssh) et forcer https:// sur les occurrences http://.
func TestPinggyURLRegex(t *testing.T) {
	lines := []string{
		"Pinggy tunnel is ready!",
		"https://abc-123.a.pinggy.link",
		"http://abc-123.a.pinggy.link forwarded to 127.0.0.1:8090",
	}
	var got string
	for _, line := range lines {
		if m := pinggyURLRe.FindString(line); m != "" {
			got = m
			break
		}
	}
	if !strings.HasPrefix(got, "https://") {
		t.Fatalf("Attendu https://, reÃ§u %q", got)
	}
	if !strings.Contains(got, "pinggy.link") {
		t.Fatalf("Attendu .pinggy.link, reÃ§u %q", got)
	}
}

func TestTunnelDisabledPreference(t *testing.T) {
	mgr := NewManager("none")
	url, err := mgr.StartAutoTunnel(8090)
	if err == nil || url != "" {
		t.Fatalf("Attendu erreur de tunnel désactivé, reçu URL=%q, err=%v", url, err)
	}
}

func TestPangolinURLRegex(t *testing.T) {
	lines := []string{
		"[newt] connecting to server...",
		"Assigned URL: https://antigravity.my-homelab.net",
		"Forwarding http://127.0.0.1:8090 to https://antigravity.my-homelab.net",
	}
	var got string
	for _, line := range lines {
		if m := pangolinURLRe.FindString(line); m != "" {
			got = m
			break
		}
	}
	if got != "https://antigravity.my-homelab.net" {
		t.Fatalf("Attendu https://antigravity.my-homelab.net, reçu %q", got)
	}
}

func TestPangolinStaticURL(t *testing.T) {
	t.Setenv("PANGOLIN_URL", "https://custom.antigravity-remote.org")
	m := NewManager("pangolin")
	url, err := m.StartAutoTunnel(8090)
	if err != nil {
		t.Fatalf("StartAutoTunnel(pangolin static): %v", err)
	}
	if url != "https://custom.antigravity-remote.org" {
		t.Fatalf("Attendu https://custom.antigravity-remote.org, reçu %q", url)
	}
	if m.Provider != "pangolin" {
		t.Fatalf("Provider attendu pangolin, reçu %q", m.Provider)
	}
}


