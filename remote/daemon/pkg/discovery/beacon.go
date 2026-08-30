package discovery

import (
	"encoding/json"
	"fmt"
	"net"
	"os"
	"sync"
	"time"
)

const (
	DiscoveryPort     = 41234
	DiscoveryMagic    = "antigravity-remote"
	DiscoveryProtocol = "ag-discovery-v1"
)

// BeaconPayload represents the discovery announcement broadcasted by the Daemon.
// NOTE : AuthToken n'a PAS de champ ici — le jeton ne doit jamais être diffusé
// sur le LAN (broadcast lisible par tout hôte). Le mobile parse encore
// `authToken` (absent → "") pour compat avec les anciens daemons.
type BeaconPayload struct {
	Magic      string   `json:"magic"`
	Protocol   string   `json:"protocol"`
	Hostname   string   `json:"hostname"`
	Port       int      `json:"port"`
	LanIP      string   `json:"lanIp,omitempty"`
	PublicURL  string   `json:"publicUrl,omitempty"`
	Workspaces []string `json:"workspaces,omitempty"`
	Timestamp  int64    `json:"timestamp"`
}

// LANBeacon handles UDP broadcast beaconing and response to discovery pings.
// Il ne détient AUCUN jeton : le pairing se fait via QR (tunnel) ou saisie
// manuelle, jamais via le broadcast UDP.
type LANBeacon struct {
	port           int
	publicURLFunc  func() string
	workspacesFunc func() []string
	stopChan       chan struct{}
	mu             sync.Mutex
	running        bool
}

// NewLANBeacon creates a new LAN auto-discovery beacon
func NewLANBeacon(port int, publicURLFunc func() string, workspacesFunc func() []string) *LANBeacon {
	return &LANBeacon{
		port:           port,
		publicURLFunc:  publicURLFunc,
		workspacesFunc: workspacesFunc,
		stopChan:       make(chan struct{}),
	}
}

// Start launches the UDP broadcast loop and responder
func (b *LANBeacon) Start() error {
	b.mu.Lock()
	if b.running {
		b.mu.Unlock()
		return nil
	}
	b.running = true
	b.mu.Unlock()

	hostname, _ := os.Hostname()
	if hostname == "" {
		hostname = "Antigravity-PC"
	}

	go b.listenResponder(hostname)
	go b.broadcastLoop(hostname)

	return nil
}

// Stop terminates the beacon loops
func (b *LANBeacon) Stop() {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.running {
		close(b.stopChan)
		b.running = false
	}
}

func (b *LANBeacon) buildPayload(hostname string) []byte {
	pubURL := ""
	if b.publicURLFunc != nil {
		pubURL = b.publicURLFunc()
	}
	var wsList []string
	if b.workspacesFunc != nil {
		wsList = b.workspacesFunc()
	}

	payload := BeaconPayload{
		Magic:      DiscoveryMagic,
		Protocol:   DiscoveryProtocol,
		Hostname:   hostname,
		Port:       b.port,
		LanIP:      GetPhysicalLANIP(),
		PublicURL:  pubURL,
		Workspaces: wsList,
		Timestamp:  time.Now().Unix(),
	}
	data, _ := json.Marshal(payload)
	return data
}

func (b *LANBeacon) broadcastLoop(hostname string) {
	ticker := time.NewTicker(2500 * time.Millisecond)
	defer ticker.Stop()

	destAddr, err := net.ResolveUDPAddr("udp4", fmt.Sprintf("255.255.255.255:%d", DiscoveryPort))
	if err != nil {
		return
	}

	conn, err := net.DialUDP("udp4", nil, destAddr)
	if err != nil {
		return
	}
	defer conn.Close()

	for {
		select {
		case <-b.stopChan:
			return
		case <-ticker.C:
			data := b.buildPayload(hostname)
			conn.Write(data)
		}
	}
}

func (b *LANBeacon) listenResponder(hostname string) {
	listenAddr, err := net.ResolveUDPAddr("udp4", fmt.Sprintf("0.0.0.0:%d", DiscoveryPort))
	if err != nil {
		return
	}

	conn, err := net.ListenUDP("udp4", listenAddr)
	if err != nil {
		return
	}
	defer conn.Close()

	buf := make([]byte, 2048)
	for {
		select {
		case <-b.stopChan:
			return
		default:
		}

		conn.SetReadDeadline(time.Now().Add(1 * time.Second))
		n, remoteAddr, err := conn.ReadFromUDP(buf)
		if err != nil {
			time.Sleep(100 * time.Millisecond)
			continue
		}

		var query struct {
			Type string `json:"type"`
		}
		if json.Unmarshal(buf[:n], &query) == nil && (query.Type == "discover" || query.Type == "ping") {
			respData := b.buildPayload(hostname)
			conn.WriteToUDP(respData, remoteAddr)
		}
	}
}
