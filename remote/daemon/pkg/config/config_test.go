package config

import (
	"os"
	"testing"
	"time"
)

func TestLoadConfig_Defaults(t *testing.T) {
	_ = os.Unsetenv("AG_DAEMON_PORT")
	_ = os.Unsetenv("AG_DAEMON_HOST")
	_ = os.Unsetenv("AG_WS_WRITE_TIMEOUT")

	cfg := LoadConfig()
	if cfg.Host != "0.0.0.0" {
		t.Errorf("Expected default host 0.0.0.0, got %s", cfg.Host)
	}
	if cfg.Port != 8090 {
		t.Errorf("Expected default port 8090, got %d", cfg.Port)
	}
	if cfg.WriteTimeout != 10*time.Second {
		t.Errorf("Expected default write timeout 10s, got %v", cfg.WriteTimeout)
	}
	if cfg.PingPeriod != 54*time.Second {
		t.Errorf("Expected ping period 54s (90%% of 60s), got %v", cfg.PingPeriod)
	}
}

func TestLoadConfig_EnvOverrides(t *testing.T) {
	_ = os.Setenv("AG_DAEMON_PORT", "9999")
	_ = os.Setenv("AG_DAEMON_HOST", "127.0.0.1")
	_ = os.Setenv("AG_WS_WRITE_TIMEOUT", "15s")
	defer func() {
		_ = os.Unsetenv("AG_DAEMON_PORT")
		_ = os.Unsetenv("AG_DAEMON_HOST")
		_ = os.Unsetenv("AG_WS_WRITE_TIMEOUT")
	}()

	cfg := LoadConfig()
	if cfg.Port != 9999 {
		t.Errorf("Expected port 9999, got %d", cfg.Port)
	}
	if cfg.Host != "127.0.0.1" {
		t.Errorf("Expected host 127.0.0.1, got %s", cfg.Host)
	}
	if cfg.WriteTimeout != 15*time.Second {
		t.Errorf("Expected write timeout 15s, got %v", cfg.WriteTimeout)
	}
}

func TestAssertSafeBind(t *testing.T) {
	if !IsSafeHost("127.0.0.1") {
		t.Errorf("Expected 127.0.0.1 to be safe host")
	}
	if !IsSafeHost("localhost") {
		t.Errorf("Expected localhost to be safe host")
	}
	if !IsSafeHost("192.168.1.50") {
		t.Errorf("Expected 192.168.1.50 to be safe host")
	}
	if !IsSafeHost("100.80.20.10") {
		t.Errorf("Expected Tailscale IP 100.80.20.10 to be safe host")
	}
	if IsSafeHost("8.8.8.8") {
		t.Errorf("Expected 8.8.8.8 NOT to be safe host")
	}

	if err := AssertSafeBind("127.0.0.1", false); err != nil {
		t.Errorf("Expected safe bind on 127.0.0.1 without allowPublic, got error: %v", err)
	}
	if err := AssertSafeBind("8.8.8.8", false); err == nil {
		t.Errorf("Expected error for public bind 8.8.8.8 without allowPublic")
	}
	if err := AssertSafeBind("8.8.8.8", true); err != nil {
		t.Errorf("Expected allowed public bind on 8.8.8.8 with allowPublic=true, got error: %v", err)
	}
}
