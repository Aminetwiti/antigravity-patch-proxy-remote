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
