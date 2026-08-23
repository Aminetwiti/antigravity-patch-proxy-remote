package config

import (
	"encoding/json"
	"os"
	"strconv"
	"time"
)

// DaemonConfig structure l'intégralité des paramètres du daemon selon la norme 12-Factor App.
type DaemonConfig struct {
	Host                 string        `json:"host"`
	Port                 int           `json:"port"`
	LanguageServerPort   int           `json:"language_server_port"`
	TunnelProvider       string        `json:"tunnel_provider"`
	WriteTimeout         time.Duration `json:"write_timeout"`
	PongWait             time.Duration `json:"pong_wait"`
	PingPeriod           time.Duration `json:"ping_period"`
	MaxWSMessageSize     int64         `json:"max_ws_message_size"`
	HistoryMaxBufferSize int           `json:"history_max_buffer_size"`
	QuotaPollInterval    time.Duration `json:"quota_poll_interval"`
	ApprovalTimeout      time.Duration `json:"approval_timeout"`
	DiscoveryPort        int           `json:"discovery_port"`
	AllowRemoteTerminal  bool          `json:"allow_remote_terminal"`
}

// LoadConfig charge la configuration en appliquant la hiérarchie :
// 1. Valeurs par défaut sécurisées
// 2. Fichier daemon.json (optionnel)
// 3. Variables d'environnement (AG_*)
func LoadConfig() *DaemonConfig {
	cfg := &DaemonConfig{
		Host:                 getEnvString("AG_DAEMON_HOST", "0.0.0.0"),
		Port:                 getEnvInt("AG_DAEMON_PORT", 8090),
		LanguageServerPort:   getEnvInt("AG_LS_PORT", 55256),
		TunnelProvider:       getEnvString("AG_TUNNEL_PROVIDER", ""),
		WriteTimeout:         getEnvDuration("AG_WS_WRITE_TIMEOUT", 10*time.Second),
		PongWait:             getEnvDuration("AG_WS_PONG_WAIT", 60*time.Second),
		MaxWSMessageSize:     getEnvInt64("AG_WS_MAX_MSG_SIZE", 10*1024*1024),
		HistoryMaxBufferSize: getEnvInt("AG_HISTORY_BUFFER_SIZE", 10*1024*1024),
		QuotaPollInterval:    getEnvDuration("AG_QUOTA_INTERVAL", 60*time.Second),
		ApprovalTimeout:      getEnvDuration("AG_APPROVAL_TIMEOUT", 5*time.Minute),
		DiscoveryPort:        getEnvInt("AG_DISCOVERY_PORT", 41234),
		AllowRemoteTerminal:  getEnvBool("AG_ALLOW_REMOTE_TERMINAL", true),
	}

	// Tentative de lecture d'un fichier de configuration local si présent
	if configPath := os.Getenv("AG_CONFIG_FILE"); configPath != "" {
		if data, err := os.ReadFile(configPath); err == nil {
			_ = json.Unmarshal(data, cfg)
		}
	}

	cfg.PingPeriod = (cfg.PongWait * 9) / 10
	return cfg
}

func getEnvString(key, fallback string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if val := os.Getenv(key); val != "" {
		if n, err := strconv.Atoi(val); err == nil {
			return n
		}
	}
	return fallback
}

func getEnvInt64(key string, fallback int64) int64 {
	if val := os.Getenv(key); val != "" {
		if n, err := strconv.ParseInt(val, 10, 64); err == nil {
			return n
		}
	}
	return fallback
}

func getEnvDuration(key string, fallback time.Duration) time.Duration {
	if val := os.Getenv(key); val != "" {
		if d, err := time.ParseDuration(val); err == nil {
			return d
		}
		if n, err := strconv.Atoi(val); err == nil {
			return time.Duration(n) * time.Second
		}
	}
	return fallback
}

func getEnvBool(key string, fallback bool) bool {
	if val := os.Getenv(key); val != "" {
		if b, err := strconv.ParseBool(val); err == nil {
			return b
		}
	}
	return fallback
}

