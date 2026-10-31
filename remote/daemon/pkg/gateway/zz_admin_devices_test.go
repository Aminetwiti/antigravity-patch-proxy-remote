package gateway

// Tests d'administration multi-devices (3.4) : admin.list_devices /
// admin.revoke_device. Le PairingManager réel est branché par main.go ; ici on
// utilise un stub conforme à l'interface minimale pairHandler. Les sessions
// clientSessions (Admin=true) sont injectées via SetSessionValidator, comme au
// handshake réel.

import (
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/antigravity/remote-daemon/pkg/discovery"
	"github.com/gorilla/websocket"
)

// fakePairing implémente l'interface minimale pairHandler du gateway.
type fakePairing struct {
	sessions []discovery.SessionInfo
	revoked  []string
}

func (f *fakePairing) ListSessions() []discovery.SessionInfo { return f.sessions }

func (f *fakePairing) RevokeDevice(deviceID string) bool {
	for i, s := range f.sessions {
		if s.DeviceID == deviceID {
			f.sessions = append(f.sessions[:i], f.sessions[i+1:]...)
			f.revoked = append(f.revoked, deviceID)
			return true
		}
	}
	return false
}

// dialAdminWS ouvre une connexion avec un token qui valide une session Admin
// (deviceId dev-admin, Admin=true) — même mécanique que le handshake réel.
func dialAdminWS(t *testing.T, srv *httptest.Server, token string) *wsTestClient {
	t.Helper()
	u := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws?token=" + token
	conn, _, err := websocket.DefaultDialer.Dial(u, nil)
	if err != nil {
		t.Fatalf("Dial WebSocket échoué: %v", err)
	}
	return &wsTestClient{conn: conn}
}

// TestAdminListDevices — un admin liste les sessions pairées (deviceId, name,
// ip, admin) ; le mobile parse la clé "devices" (daemon_api.listDevices).
func TestAdminListDevices(t *testing.T) {
	backend := &fakeRPCClient{}
	srv, gw := newTestServerWithGW(backend)
	defer srv.Close()

	gw.SetPairingManager(&fakePairing{
		sessions: []discovery.SessionInfo{
			{DeviceID: "dev-a", Name: "Pixel", IP: "192.168.1.10", Admin: false},
			{DeviceID: "dev-b", Name: "Galaxy", IP: "192.168.1.11", Admin: false},
		},
	})
	gw.SetSessionValidator(func(token string) (discovery.SessionInfo, bool) {
		if token == "tok-admin" {
			return discovery.SessionInfo{DeviceID: "dev-admin", Name: "PC hôte", Admin: true}, true
		}
		return discovery.SessionInfo{}, false
	})

	client := dialAdminWS(t, srv, "tok-admin")
	defer client.conn.Close()

	client.send(t, map[string]string{"type": "admin.list_devices", "requestId": "adm-1"})
	resp := client.recv(t)
	if resp["type"] != "response" || resp["requestId"] != "adm-1" {
		t.Fatalf("réponse inattendue: %v", resp)
	}
	if resp["error"] != nil {
		t.Fatalf("erreur inattendue: %v", resp["error"])
	}
	devices, ok := resp["data"].(map[string]interface{})["devices"].([]interface{})
	if !ok || len(devices) != 2 {
		t.Fatalf("devices attendu (2), reçu %v", resp["data"])
	}
	first := devices[0].(map[string]interface{})
	if first["deviceId"] != "dev-a" || first["name"] != "Pixel" {
		t.Fatalf("device[0] inattendu: %v", first)
	}
}

// TestAdminListDevicesRequiresAdmin — un client pairé NON admin est refusé
// (garde requireAdmin) ; jamais de fail-open.
func TestAdminListDevicesRequiresAdmin(t *testing.T) {
	backend := &fakeRPCClient{}
	srv, gw := newTestServerWithGW(backend)
	defer srv.Close()

	gw.SetPairingManager(&fakePairing{sessions: []discovery.SessionInfo{
		{DeviceID: "dev-a", Name: "Pixel", Admin: false},
	}})
	gw.SetSessionValidator(func(token string) (discovery.SessionInfo, bool) {
		if token == "tok-user" {
			return discovery.SessionInfo{DeviceID: "dev-user", Name: "Pixel", Admin: false}, true
		}
		return discovery.SessionInfo{}, false
	})

	client := dialAdminWS(t, srv, "tok-user")
	defer client.conn.Close()

	client.send(t, map[string]string{"type": "admin.list_devices", "requestId": "adm-1"})
	resp := client.recv(t)
	if resp["error"] == nil {
		t.Fatalf("non-admin devrait être refusé, reçu %v", resp)
	}
	if !strings.Contains(resp["error"].(string), "administrateur") {
		t.Fatalf("erreur inattendue: %v", resp["error"])
	}
}

// TestAdminRevokeDevice — un admin révoque une session cible ; le daemon
// répond status=revoked + deviceId (contrat daemon_api.revokeDevice) et
// broadcast devices_updated aux autres clients.
func TestAdminRevokeDevice(t *testing.T) {
	backend := &fakeRPCClient{}
	srv, gw := newTestServerWithGW(backend)
	defer srv.Close()

	pairing := &fakePairing{
		sessions: []discovery.SessionInfo{
			{DeviceID: "dev-a", Name: "Pixel", Admin: false},
			{DeviceID: "dev-b", Name: "Galaxy", Admin: false},
		},
	}
	gw.SetPairingManager(pairing)
	// Validateur complet AVANT de dialer : l'observateur (non-admin) doit être
	// accepté au handshake pour recevoir le broadcast devices_updated.
	gw.SetSessionValidator(func(token string) (discovery.SessionInfo, bool) {
		if token == "tok-admin" {
			return discovery.SessionInfo{DeviceID: "dev-admin", Name: "PC hôte", Admin: true}, true
		}
		if token == "tok-observer" {
			return discovery.SessionInfo{DeviceID: "dev-obs", Name: "Obs", Admin: false}, true
		}
		return discovery.SessionInfo{}, false
	})

	// Second client (non-admin) pour vérifier le broadcast devices_updated.
	observer := dialAdminWS(t, srv, "tok-observer")
	defer observer.conn.Close()

	client := dialAdminWS(t, srv, "tok-admin")
	defer client.conn.Close()

	client.sendRaw(t, `{"type":"admin.revoke_device","requestId":"adm-2","data":{"deviceId":"dev-a"}}`)
	var resp map[string]interface{}
	for i := 0; i < 3; i++ {
		m := client.recv(t)
		if m["type"] == "response" && m["requestId"] == "adm-2" {
			resp = m
			break
		}
	}
	if resp == nil {
		t.Fatalf("réponse à la requête adm-2 non reçue")
	}
	data := resp["data"].(map[string]interface{})
	if data["status"] != "revoked" || data["deviceId"] != "dev-a" {
		t.Fatalf("status attendu revoked/dev-a, reçu %v", data)
	}
	if len(pairing.sessions) != 1 || pairing.sessions[0].DeviceID != "dev-b" {
		t.Fatalf("session dev-a devrait être révoquée, restant %v", pairing.sessions)
	}

	// Broadcast devices_updated reçu par l'observateur.
	deadline := time.Now().Add(2 * time.Second)
	var got map[string]interface{}
	for got == nil && time.Now().Before(deadline) {
		observer.conn.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
		if m, err := observer.recvSafe(); err == nil && m["type"] == "devices_updated" {
			got = m
		}
	}
	if got == nil {
		t.Fatalf("broadcast devices_updated non reçu")
	}
	devices := got["data"].(map[string]interface{})["devices"].([]interface{})
	if len(devices) != 1 {
		t.Fatalf("broadcast devices attendu (1), reçu %v", devices)
	}
}

// TestAdminRevokeSelf — un admin ne peut pas révoquer son propre device
// (garde de dernier recours : le premier appairage reste admin).
func TestAdminRevokeSelf(t *testing.T) {
	backend := &fakeRPCClient{}
	srv, gw := newTestServerWithGW(backend)
	defer srv.Close()

	gw.SetPairingManager(&fakePairing{
		sessions: []discovery.SessionInfo{
			{DeviceID: "dev-admin", Name: "PC hôte", Admin: true},
		},
	})
	gw.SetSessionValidator(func(token string) (discovery.SessionInfo, bool) {
		if token == "tok-admin" {
			return discovery.SessionInfo{DeviceID: "dev-admin", Name: "PC hôte", Admin: true}, true
		}
		return discovery.SessionInfo{}, false
	})

	client := dialAdminWS(t, srv, "tok-admin")
	defer client.conn.Close()

	client.sendRaw(t, `{"type":"admin.revoke_device","requestId":"adm-3","data":{"deviceId":"dev-admin"}}`)
	resp := client.recv(t)
	if resp["error"] == nil {
		t.Fatalf("auto-révocation devrait être refusée, reçu %v", resp)
	}
	if !strings.Contains(resp["error"].(string), "administrateur courant") {
		t.Fatalf("erreur inattendue: %v", resp["error"])
	}
}

// TestAdminWithoutPairingManager — sans PairingManager branché (daemon sans
// pairing), la réponse est une erreur explicite, pas un panic.
func TestAdminWithoutPairingManager(t *testing.T) {
	backend := &fakeRPCClient{}
	srv, gw := newTestServerWithGW(backend)
	defer srv.Close()

	gw.SetSessionValidator(func(token string) (discovery.SessionInfo, bool) {
		if token == "tok-admin" {
			return discovery.SessionInfo{DeviceID: "dev-admin", Name: "PC hôte", Admin: true}, true
		}
		return discovery.SessionInfo{}, false
	})

	client := dialAdminWS(t, srv, "tok-admin")
	defer client.conn.Close()

	client.send(t, map[string]string{"type": "admin.list_devices", "requestId": "adm-4"})
	resp := client.recv(t)
	if resp["error"] == nil {
		t.Fatalf("pairing non branché devrait être signalé, reçu %v", resp)
	}
	if !strings.Contains(resp["error"].(string), "indisponible") {
		t.Fatalf("erreur inattendue: %v", resp["error"])
	}
}
