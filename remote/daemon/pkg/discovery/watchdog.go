package discovery

import (
	"log"
	"sync"
	"time"

	"github.com/antigravity/remote-daemon/pkg/connectrpc"
)

type Watchdog struct {
	Client         *connectrpc.Client
	Interval       time.Duration
	OnStatusChange func(running bool, port int, info *LocalHarnessInfo)
	stopChan       chan struct{}
	stopOnce       sync.Once
	discover       func() (*LocalHarnessInfo, error)
	lastRunning    bool
}

func NewWatchdog(client *connectrpc.Client, interval time.Duration) *Watchdog {
	if interval <= 0 {
		interval = 5 * time.Second
	}
	return &Watchdog{
		Client:      client,
		Interval:    interval,
		stopChan:    make(chan struct{}),
		discover:    Discover,
		lastRunning: true,
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
					if w.lastRunning {
						w.lastRunning = false
						log.Printf("[Watchdog] Antigravity IDE / language_server fermé ou introuvable : %v", err)
						if w.OnStatusChange != nil {
							w.OnStatusChange(false, 0, nil)
						}
					}
					continue
				}

				port, token := w.Client.Endpoint()
				wasDown := !w.lastRunning
				w.lastRunning = true

				if info.ConnectRPCPort != port || info.ExtensionCSRF != token || wasDown {
					log.Printf("[Watchdog] Hub actif/redémarré détecté ! Port: %d (TLS: %v)", info.ConnectRPCPort, info.UseTLS)
					w.Client.UpdateEndpoint(info.ConnectRPCPort, info.ExtensionCSRF)
					w.Client.SetUseTLS(info.UseTLS)
					if w.OnStatusChange != nil {
						w.OnStatusChange(true, info.ConnectRPCPort, info)
					}
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
