package discovery

import (
	"log"
	"sync"
	"time"

	"github.com/antigravity/remote-daemon/pkg/connectrpc"
)

type Watchdog struct {
	Client   *connectrpc.Client
	Interval time.Duration
	stopChan chan struct{}
	stopOnce sync.Once
	discover func() (*LocalHarnessInfo, error)
}

func NewWatchdog(client *connectrpc.Client, interval time.Duration) *Watchdog {
	if interval <= 0 {
		interval = 10 * time.Second
	}
	return &Watchdog{
		Client:   client,
		Interval: interval,
		stopChan: make(chan struct{}),
		discover: Discover,
	}
}

func (w *Watchdog) Start() {
	ticker := time.NewTicker(w.Interval)
	go func() {
		for {
			select {
			case <-ticker.C:
				info, err := w.discover()
				if err != nil {
					log.Printf("[Watchdog] Avertissement découverte hub: %v", err)
					continue
				}
				port, token := w.Client.Endpoint()
				if info.ConnectRPCPort != port || info.ExtensionCSRF != token {
					log.Printf("[Watchdog] Hub redémarré détecté ! Mise à jour du port (%d -> %d) et du jeton CSRF", port, info.ConnectRPCPort)
					w.Client.UpdateEndpoint(info.ConnectRPCPort, info.ExtensionCSRF)
					w.Client.SetUseTLS(info.UseTLS)
				}
			case <-w.stopChan:
				ticker.Stop()
				return
			}
		}
	}()
}

func (w *Watchdog) Stop() {
	w.stopOnce.Do(func() {
		close(w.stopChan)
	})
}
