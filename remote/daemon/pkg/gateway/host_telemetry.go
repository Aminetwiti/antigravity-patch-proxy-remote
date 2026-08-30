package gateway

import (
	"sync"
	"time"
)

// HostStats représente l'utilisation matérielle en temps réel de la machine hôte.
type HostStats struct {
	CPUPercent    int   `json:"cpuPercent"`
	RAMUsedMb     int   `json:"ramUsedMb"`
	RAMTotalMb    int   `json:"ramTotalMb"`
	UptimeSeconds int64 `json:"uptimeSeconds"`
}

var (
	daemonStartTime = time.Now()
	lastStatsMu     sync.RWMutex
	lastStats       HostStats
)

// StartHostTelemetryPoller démarre la collecte et diffusion périodique de la télémétrie hôte.
func (s *Server) StartHostTelemetryPoller(interval time.Duration) {
	if interval <= 0 {
		interval = 5 * time.Second
	}

	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		for range ticker.C {
			// Ne collecter que si au moins un client WebSocket est connecté
			s.mu.Lock()
			clientCount := len(s.clients)
			s.mu.Unlock()

			if clientCount == 0 {
				continue
			}

			stats := collectHostStats()
			stats.UptimeSeconds = int64(time.Since(daemonStartTime).Seconds())

			lastStatsMu.Lock()
			lastStats = stats
			lastStatsMu.Unlock()

			s.broadcast(OutgoingMessage{
				Type: "host_telemetry",
				Data: map[string]interface{}{
					"cpuPercent":    stats.CPUPercent,
					"ramUsedMb":     stats.RAMUsedMb,
					"ramTotalMb":    stats.RAMTotalMb,
					"uptimeSeconds": stats.UptimeSeconds,
				},
			})
		}
	}()
}

// GetLatestHostStats retourne le dernier snapshot de télémétrie collecté.
func GetLatestHostStats() HostStats {
	lastStatsMu.RLock()
	defer lastStatsMu.RUnlock()
	return lastStats
}
