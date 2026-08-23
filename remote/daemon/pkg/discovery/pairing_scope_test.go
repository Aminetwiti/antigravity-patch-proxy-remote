package discovery

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// 3.3 : le device peut ├¬tre pair├® avec un scope projet (allowedProjects),
// et les infos de session sont retrouvables via ValidateSession.
func TestPairingManager_ProjectScope(t *testing.T) {
	pm := NewPairingManager()
	pin, _ := pm.CurrentPIN()

	token, _, err := pm.VerifyPIN("192.168.1.50:54321", pin, "phone-proj",
		[]string{"file:///C:/proj-a", "/home/user/proj-b"})
	if err != nil {
		t.Fatalf("VerifyPIN avec allowedProjects a ├®chou├®: %v", err)
	}

	sess, ok := pm.ValidateSession(token)
	if !ok {
		t.Fatalf("ValidateSession doit trouver la session")
	}
	if sess.DeviceID != "phone-proj" {
		t.Fatalf("DeviceID = %q, attendu phone-proj", sess.DeviceID)
	}
	if len(sess.AllowedProjects) != 2 {
		t.Fatalf("AllowedProjects = %v, attendu 2 entr├®es", sess.AllowedProjects)
	}

	// Token invalide ou expir├® ÔåÆ false
	if _, ok := pm.ValidateSession("bogus"); ok {
		t.Fatalf("ValidateSession doit renvoyer false pour un jeton inconnu")
	}
}

// 3.3 : le scope projet est aussi captur├® via POST /pair (allowedProjects).
func TestPairingManager_HTTPHandlerScope(t *testing.T) {
	pm := NewPairingManager()
	handler := pm.HTTPHandler()

	pin, _ := pm.CurrentPIN()
	body, _ := json.Marshal(map[string]interface{}{
		"pin":             pin,
		"deviceId":        "dev-scoped",
		"name":            "Pixel",
		"allowedProjects": []string{"file:///C:/workspace-a"},
	})
	req := httptest.NewRequest(http.MethodPost, "/pair", bytes.NewReader(body))
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("POST /pair statut %d != 200: %s", rr.Code, rr.Body.String())
	}
	var resp map[string]interface{}
	json.NewDecoder(rr.Body).Decode(&resp)
	token, _ := resp["token"].(string)
	if token == "" {
		t.Fatalf("Token manquant: %v", resp)
	}
	sess, ok := pm.ValidateSession(token)
	if !ok || sess.Name != "Pixel" {
		t.Fatalf("Nom du device non stock├®: %+v", sess)
	}
	if len(sess.AllowedProjects) != 1 || sess.AllowedProjects[0] != "file:///C:/workspace-a" {
		t.Fatalf("Scope projet non stock├®: %+v", sess.AllowedProjects)
	}
}

// 3.4 : revoke invalide tous les jetons d'un device (├®quivalent removeDevice).
func TestPairingManager_RevokeDevice(t *testing.T) {
	pm := NewPairingManager()
	pin, _ := pm.CurrentPIN()

	t1, _, err := pm.VerifyPIN("ip-a", pin, "phone-1")
	if err != nil {
		t.Fatalf("VerifyPIN 1: %v", err)
	}
	pin2, _ := pm.CurrentPIN()
	t2, _, err := pm.VerifyPIN("ip-b", pin2, "phone-1")
	if err != nil {
		t.Fatalf("VerifyPIN 2: %v", err)
	}

	if !pm.RevokeDevice("phone-1") {
		t.Fatalf("RevokeDevice doit trouver le device")
	}
	if pm.ValidateToken(t1) || pm.ValidateToken(t2) {
		t.Fatalf("Jetons du device r├®voqu├® doivent ├¬tre invalides")
	}
	if pm.RevokeDevice("inconnu") {
		t.Fatalf("RevokeDevice d'un device inconnu doit renvoyer false")
	}
}

// 3.4 : ListSessions n'expose que les sessions non expir├®es.
func TestPairingManager_ListSessions(t *testing.T) {
	pm := NewPairingManager()
	pin, _ := pm.CurrentPIN()
	_, _, err := pm.VerifyPIN("ip", pin, "phone-1")
	if err != nil {
		t.Fatalf("VerifyPIN: %v", err)
	}
	sessions := pm.ListSessions()
	if len(sessions) != 1 || sessions[0].DeviceID != "phone-1" {
		t.Fatalf("ListSessions = %+v, attendu [phone-1]", sessions)
	}
}

// DELETE /pair?deviceId=xxx r├®voque le device (admin h├┤te).
func TestPairingManager_HTTPRevoke(t *testing.T) {
	pm := NewPairingManager()
	handler := pm.HTTPHandler()

	pin, _ := pm.CurrentPIN()
	body, _ := json.Marshal(map[string]string{"pin": pin, "deviceId": "dev-1"})
	req := httptest.NewRequest(http.MethodPost, "/pair", bytes.NewReader(body))
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("POST /pair statut %d != 200", rr.Code)
	}
	var pairResp map[string]interface{}
	json.NewDecoder(rr.Body).Decode(&pairResp)
	token := pairResp["token"].(string)
	if !pm.ValidateToken(token) {
		t.Fatalf("Token doit être valide après pairing")
	}
	// SEC-03 : promotion admin explicite côté hôte avant la révocation.
	if !pm.PromoteAdmin("dev-1") {
		t.Fatalf("PromoteAdmin doit réussir pour dev-1")
	}

	reqDel := httptest.NewRequest(http.MethodDelete, "/pair?deviceId=dev-1&token="+token, nil)
	rrDel := httptest.NewRecorder()
	handler.ServeHTTP(rrDel, reqDel)
	if rrDel.Code != http.StatusOK {
		t.Fatalf("DELETE /pair statut %d != 200", rrDel.Code)
	}
	if !strings.Contains(rrDel.Body.String(), "revoked") {
		t.Fatalf("Réponse DELETE = %s, attendu status revoked", rrDel.Body.String())
	}
	if pm.ValidateToken(token) {
		t.Fatalf("Token doit être révoqué après DELETE /pair")
	}

	// DELETE sans deviceId → 400 (avec token valide pour tester le paramètre manquant)
	// On crée une nouvelle session d'abord
	_, _, _ = pm.VerifyPIN("127.0.0.1:9999", pm.GeneratePIN(), "dev-2")
	pm.PromoteAdmin("dev-2")
	tok2 := ""
	for tok, s := range pm.sessions {
		if s.DeviceID == "dev-2" {
			tok2 = tok
			break
		}
	}
	reqBad := httptest.NewRequest(http.MethodDelete, "/pair?token="+tok2, nil)
	rrBad := httptest.NewRecorder()
	handler.ServeHTTP(rrBad, reqBad)
	if rrBad.Code != http.StatusBadRequest {
		t.Fatalf("DELETE /pair sans deviceId statut %d != 400", rrBad.Code)
	}
}

// La session expire : ValidateToken/ValidateSession doivent passer ├á false.
func TestPairingManager_SessionExpiry(t *testing.T) {
	pm := NewPairingManager()
	pm.sessionTTL = 1 * time.Millisecond
	pin, _ := pm.CurrentPIN()
	token, _, err := pm.VerifyPIN("ip", pin, "phone-1")
	if err != nil {
		t.Fatalf("VerifyPIN: %v", err)
	}
	time.Sleep(5 * time.Millisecond)
	if pm.ValidateToken(token) {
		t.Fatalf("ValidateToken doit renvoyer false apr├¿s expiration")
	}
	if _, ok := pm.ValidateSession(token); ok {
		t.Fatalf("ValidateSession doit renvoyer false apr├¿s expiration")
	}
}