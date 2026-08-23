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

func TestPairingManager_Success(t *testing.T) {
	pm := NewPairingManager()
	pin, remaining := pm.CurrentPIN()
	if len(pin) != 6 {
		t.Fatalf("Longueur du PIN attendue = 6, got %s", pin)
	}
	if remaining <= 0 || remaining > 60*time.Second {
		t.Fatalf("TTL restant invalide: %v", remaining)
	}

	token, expiresAt, err := pm.VerifyPIN("192.168.1.50:54321", pin, "phone-123")
	if err != nil {
		t.Fatalf("VerifyPIN a échoué avec le PIN valide: %v", err)
	}
	if len(token) != 64 { // 32 bytes hex = 64 chars
		t.Fatalf("Token de session hex invalide: %s", token)
	}
	if expiresAt.Before(time.Now()) {
		t.Fatalf("Expiration du token dans le passé: %v", expiresAt)
	}

	// Validation du jeton
	if !pm.ValidateToken(token) {
		t.Fatalf("ValidateToken doit renvoyer true pour le jeton émis")
	}
	if pm.ValidateToken("random-invalid-token") {
		t.Fatalf("ValidateToken doit renvoyer false pour un faux jeton")
	}
}

func TestPairingManager_AntiBruteForceLockout(t *testing.T) {
	pm := NewPairingManager()
	pm.maxAttempts = 3
	pm.lockoutDuration = 500 * time.Millisecond

	ip := "192.168.1.99:11111"

	// 2 échecs
	for i := 1; i <= 2; i++ {
		_, _, err := pm.VerifyPIN(ip, "000000", "attacker")
		if err == nil || !strings.Contains(err.Error(), "tentatives restantes") {
			t.Fatalf("Échec %d: attendu erreur de tentative, got: %v", i, err)
		}
	}

	// 3e échec -> Verrouillage
	_, _, err := pm.VerifyPIN(ip, "000000", "attacker")
	if err == nil || !strings.Contains(err.Error(), "temporairement verrouillé") {
		t.Fatalf("Attendu verrouillage au 3e échec, got: %v", err)
	}

	// Tentative même avec le bon PIN pendant le verrouillage
	pin, _ := pm.CurrentPIN()
	_, _, err = pm.VerifyPIN(ip, pin, "attacker")
	if err == nil || !strings.Contains(err.Error(), "temporairement verrouillé") {
		t.Fatalf("Même avec le bon PIN, doit être rejeté si verrouillé: %v", err)
	}

	// Attente de l'expiration du verrouillage
	time.Sleep(550 * time.Millisecond)

	// Nouveau PIN valide après expiration
	newPin, _ := pm.CurrentPIN()
	token, _, err := pm.VerifyPIN(ip, newPin, "legit-device")
	if err != nil {
		t.Fatalf("Après expiration du verrouillage, le bon PIN doit fonctionner: %v", err)
	}
	if !pm.ValidateToken(token) {
		t.Fatalf("Le token doit être valide")
	}
}

func TestPairingManager_HTTPHandler(t *testing.T) {
	pm := NewPairingManager()
	pin, _ := pm.CurrentPIN()
	handler := pm.HTTPHandler()

	// 1. GET /pair -> interdit (sécurité anti-fuite de PIN)
	reqGet := httptest.NewRequest(http.MethodGet, "/pair", nil)
	rrGet := httptest.NewRecorder()
	handler.ServeHTTP(rrGet, reqGet)

	if rrGet.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET /pair statut %d != 405 MethodNotAllowed", rrGet.Code)
	}

	// 2. POST /pair avec mauvais PIN
	badBody, _ := json.Marshal(map[string]string{"pin": "999999", "deviceId": "dev1"})
	reqBad := httptest.NewRequest(http.MethodPost, "/pair", bytes.NewReader(badBody))
	rrBad := httptest.NewRecorder()
	handler.ServeHTTP(rrBad, reqBad)

	if rrBad.Code != http.StatusUnauthorized {
		t.Fatalf("POST /pair mauvais PIN statut %d != 401", rrBad.Code)
	}

	// 3. POST /pair avec bon PIN
	goodBody, _ := json.Marshal(map[string]string{"pin": pin, "deviceId": "dev1"})
	reqGood := httptest.NewRequest(http.MethodPost, "/pair", bytes.NewReader(goodBody))
	rrGood := httptest.NewRecorder()
	handler.ServeHTTP(rrGood, reqGood)

	if rrGood.Code != http.StatusOK {
		t.Fatalf("POST /pair bon PIN statut %d != 200", rrGood.Code)
	}
	var pairResp map[string]interface{}
	json.NewDecoder(rrGood.Body).Decode(&pairResp)
	token, ok := pairResp["token"].(string)
	if !ok || len(token) != 64 {
		t.Fatalf("Token manquant ou invalide dans la réponse: %v", pairResp)
	}

	if !pm.ValidateToken(token) {
		t.Fatalf("Le token de session doit être validé par PairingManager")
	}

	// SEC-03 : le premier device pairé n'est PAS admin par défaut — la
	// révocation exige une promotion explicite côté hôte.
	reqDelForbidden := httptest.NewRequest(http.MethodDelete, "/pair?deviceId=dev1&token="+token, nil)
	rrDelForbidden := httptest.NewRecorder()
	handler.ServeHTTP(rrDelForbidden, reqDelForbidden)
	if rrDelForbidden.Code != http.StatusForbidden {
		t.Fatalf("DELETE /pair sans promotion doit être 403, reçu %d", rrDelForbidden.Code)
	}
	if !pm.PromoteAdmin("dev1") {
		t.Fatalf("PromoteAdmin doit réussir pour un device appairé")
	}

	// 4. DELETE /pair sans token -> 401 Unauthorized (VULN-07)
	reqDelNoAuth := httptest.NewRequest(http.MethodDelete, "/pair?deviceId=dev1", nil)
	rrDelNoAuth := httptest.NewRecorder()
	handler.ServeHTTP(rrDelNoAuth, reqDelNoAuth)
	if rrDelNoAuth.Code != http.StatusUnauthorized {
		t.Fatalf("DELETE /pair sans token doit être 401, reçu %d", rrDelNoAuth.Code)
	}

	// 5. DELETE /pair avec token valide -> 200 OK
	reqDelAuth := httptest.NewRequest(http.MethodDelete, "/pair?deviceId=dev1&token="+token, nil)
	rrDelAuth := httptest.NewRecorder()
	handler.ServeHTTP(rrDelAuth, reqDelAuth)
	if rrDelAuth.Code != http.StatusOK {
		t.Fatalf("DELETE /pair avec token doit être 200, reçu %d", rrDelAuth.Code)
	}
	if pm.ValidateToken(token) {
		t.Fatalf("Le token révoqué ne doit plus être valide")
	}
}

