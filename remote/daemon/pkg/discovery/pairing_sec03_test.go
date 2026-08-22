package discovery

import (
	"strings"
	"testing"
	"time"
)

// SEC-03 (régression) : la rotation de deviceId ne doit plus offrir de budget
// de tentatives neuf — la clé de verrouillage est l'IP seule.
func TestPairing_DeviceIdRotationDoesNotBypassLockout(t *testing.T) {
	pm := NewPairingManager()
	pm.maxAttempts = 5
	pm.globalMaxAttempts = 1000 // isoler le comportement par-IP de ce test
	pm.lockoutDuration = time.Minute

	ip := "10.0.0.5:44444"
	// 5 échecs depuis la même IP avec 5 deviceId différents.
	for i := 0; i < 5; i++ {
		_, _, err := pm.VerifyPIN(ip, "000000", strings.Repeat("d", i+1))
		if err == nil {
			t.Fatalf("tentative %d: le mauvais PIN doit échouer", i+1)
		}
	}
	// 6e tentative avec un deviceId tout neuf : doit être verrouillée (IP).
	_, _, err := pm.VerifyPIN(ip, "000000", "brand-new-device")
	if err == nil || !strings.Contains(err.Error(), "temporairement verrouillé") {
		t.Fatalf("la rotation de deviceId ne doit plus contourner le verrou: %v", err)
	}
}

// SEC-03 (régression) : épuisement du budget global → nouveau PIN + gel des
// tentatives jusqu'à la fin du TTL courant.
func TestPairing_GlobalBudgetExhaustionRegeneratesPIN(t *testing.T) {
	pm := NewPairingManager()
	pm.maxAttempts = 1000 // neutraliser le verrou par-IP pour isoler le budget global
	pm.globalMaxAttempts = 10

	pinBefore, _ := pm.CurrentPIN()
	if pinBefore == "" {
		t.Fatal("PIN initial requis")
	}

	var lastErr error
	for i := 0; i < 10; i++ {
		_, _, lastErr = pm.VerifyPIN("172.16.0.9:1000", "000000", "attacker")
		if lastErr == nil {
			t.Fatal("mauvais PIN ne doit jamais réussir")
		}
	}
	if !strings.Contains(lastErr.Error(), "nouveau PIN généré") {
		t.Fatalf("le 10e échec doit épuiser le budget global, got: %v", lastErr)
	}

	pinAfter, _ := pm.CurrentPIN()
	if pinAfter == pinBefore {
		t.Fatal("le PIN doit être régénéré après épuisement du budget global")
	}

	// Gel actif : même le BON PIN est refusé pendant le cooldown.
	_, _, err := pm.VerifyPIN("172.16.0.9:1000", pinAfter, "attacker")
	if err == nil || !strings.Contains(err.Error(), "temporairement verrouillé") {
		t.Fatalf("gel global attendu après épuisement du budget: %v", err)
	}
}

// SEC-03 (régression) : le premier device pairé n'est PAS admin par défaut.
func TestPairing_FirstDeviceNotAdminByDefault(t *testing.T) {
	pm := NewPairingManager()
	pin, _ := pm.CurrentPIN()

	token, _, err := pm.VerifyPIN("192.168.1.10:55555", pin, "first-phone")
	if err != nil {
		t.Fatalf("VerifyPIN: %v", err)
	}
	sess, ok := pm.ValidateSession(token)
	if !ok {
		t.Fatal("session doit être valide")
	}
	if sess.Admin {
		t.Fatal("le premier device ne doit pas être Admin sans --allow-first-admin")
	}

	// Promotion explicite côté hôte.
	if !pm.PromoteAdmin("first-phone") {
		t.Fatal("PromoteAdmin doit réussir")
	}
	sess, _ = pm.ValidateSession(token)
	if !sess.Admin {
		t.Fatal("le device promu doit être Admin")
	}
}

// SEC-03 : avec l'opt-in hôte --allow-first-admin, le premier pairé est Admin.
func TestPairing_FirstDeviceAdminWithOptIn(t *testing.T) {
	pm := NewPairingManager()
	pm.AllowFirstAdmin = true
	pin, _ := pm.CurrentPIN()

	token, _, err := pm.VerifyPIN("192.168.1.11:55556", pin, "first-phone")
	if err != nil {
		t.Fatalf("VerifyPIN: %v", err)
	}
	sess, _ := pm.ValidateSession(token)
	if !sess.Admin {
		t.Fatal("avec AllowFirstAdmin, le premier device doit être Admin")
	}
}
