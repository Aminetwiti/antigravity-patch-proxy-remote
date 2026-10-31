package auth

import (
	"os"
	"testing"
)

func TestTokenManager_Generation(t *testing.T) {
	_ = os.Unsetenv("AG_REMOTE_AUTH_TOKEN")
	_ = os.Unsetenv("AG_DAEMON_AUTH_TOKEN")

	mgr, token, err := NewTokenManager("")
	if err != nil {
		t.Fatalf("NewTokenManager failed: %v", err)
	}
	if !mgr.IsGenerated() {
		t.Errorf("Expected token to be marked as generated")
	}
	if len(token) != 32 {
		t.Errorf("Expected 32 hex chars, got %d (%s)", len(token), token)
	}
	if !mgr.Validate(token) {
		t.Errorf("Expected generated token to validate successfully")
	}
	if !mgr.Validate("Bearer " + token) {
		t.Errorf("Expected generated token with Bearer prefix to validate successfully")
	}
	if mgr.Validate("invalid-token") {
		t.Errorf("Expected invalid token to fail validation")
	}
}

func TestTokenManager_EnvOverride(t *testing.T) {
	_ = os.Setenv("AG_REMOTE_AUTH_TOKEN", "custom-env-secret-12345")
	defer func() { _ = os.Unsetenv("AG_REMOTE_AUTH_TOKEN") }()

	mgr, token, err := NewTokenManager("flag-val")
	if err != nil {
		t.Fatalf("NewTokenManager failed: %v", err)
	}
	if mgr.IsGenerated() {
		t.Errorf("Expected token from env NOT to be marked as generated")
	}
	if token != "custom-env-secret-12345" {
		t.Errorf("Expected token 'custom-env-secret-12345', got '%s'", token)
	}
	if !mgr.Validate("custom-env-secret-12345") {
		t.Errorf("Expected valid token to pass")
	}
}

func TestTokenManager_RejectsDefaultMySecret(t *testing.T) {
	_ = os.Unsetenv("AG_REMOTE_AUTH_TOKEN")
	_ = os.Unsetenv("AG_DAEMON_AUTH_TOKEN")

	mgr, token, err := NewTokenManager("mysecret")
	if err != nil {
		t.Fatalf("NewTokenManager failed: %v", err)
	}
	if !mgr.IsGenerated() {
		t.Errorf("Expected 'mysecret' placeholder to trigger automatic CSPRNG generation")
	}
	if token == "mysecret" {
		t.Errorf("Expected token NOT to be 'mysecret'")
	}
}

func TestTokenManager_DisabledAuth(t *testing.T) {
	_ = os.Unsetenv("AG_REMOTE_AUTH_TOKEN")
	_ = os.Unsetenv("AG_DAEMON_AUTH_TOKEN")

	for _, flagVal := range []string{"none", "NONE", "disabled", "off", "false", "0"} {
		mgr, token, err := NewTokenManager(flagVal)
		if err != nil {
			t.Fatalf("NewTokenManager(%q) failed: %v", flagVal, err)
		}
		if !mgr.IsDisabled() {
			t.Errorf("Expected IsDisabled() to be true for flag %q", flagVal)
		}
		if token != "" {
			t.Errorf("Expected empty token for disabled auth, got %q", token)
		}
		if !mgr.Validate("") {
			t.Errorf("Expected empty token to validate successfully when disabled")
		}
		if !mgr.Validate("anything") {
			t.Errorf("Expected any token to validate successfully when disabled")
		}
	}
}

