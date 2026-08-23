package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/antigravity/remote-daemon/pkg/auth"
	"github.com/antigravity/remote-daemon/pkg/config"
	"github.com/antigravity/remote-daemon/pkg/connectrpc"
	"github.com/antigravity/remote-daemon/pkg/discovery"
	"github.com/antigravity/remote-daemon/pkg/gateway"
	"github.com/antigravity/remote-daemon/pkg/tunnel"
)

// maskToken affiche un préfixe du jeton sans paniquer sur les jetons courts.
func maskToken(token string) string {
	if len(token) > 10 {
		return token[:10]
	}
	return token
}

func main() {
	cfg := config.LoadConfig()

	var listenPort int
	var host string
	var tunnelFlag string
	var authToken string
	var noAuth bool
	var approvalTimeoutMin int
	var enableRemoteTerminal bool
	var allowFirstAdmin bool

	flag.IntVar(&listenPort, "port", cfg.Port, "Port for the WebSocket server")
	flag.StringVar(&host, "host", cfg.Host, "Host for the WebSocket server")
	flag.StringVar(&tunnelFlag, "tunnel", cfg.TunnelProvider, "Tunnel provider (cloudflare, pinggy, pangolin, ngrok, local)")
	flag.StringVar(&authToken, "auth-token", "", "Authentication token for Mobile App (generates dynamic CSPRNG if omitted, or 'none' to disable)")
	flag.BoolVar(&noAuth, "no-auth", false, "Disable authentication (allow any client without token)")
	flag.IntVar(&approvalTimeoutMin, "approval-timeout", int(cfg.ApprovalTimeout.Minutes()), "Auto-deny timeout for pending approvals in minutes (0 = disabled)")
	flag.BoolVar(&enableRemoteTerminal, "enable-remote-terminal", cfg.AllowRemoteTerminal, "Allow remote interactive PTY terminal creation")
	flag.BoolVar(&allowFirstAdmin, "allow-first-admin", false, "Let the FIRST paired device become Admin (default: promote via host console with 'promote <deviceId>')")
	flag.Parse()

	// Silencer le logger standard Go pour éliminer le spam brut de gorilla/websocket (qui échappe à slog)
	log.SetOutput(io.Discard)

	if noAuth {
		authToken = "none"
	}

	authMgr, resolvedToken, err := auth.NewTokenManager(authToken)
	if err != nil {
		fmt.Fprintf(os.Stderr, "❌ Failed to initialize auth manager: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("🚀 Starting Antigravity Remote Daemon Bridge on %s:%d...\n", host, listenPort)
	if authMgr.IsDisabled() {
		fmt.Println("🔓 Authentication is DISABLED (--no-auth / --auth-token none)")
	} else if authMgr.IsGenerated() {
		fmt.Printf("🔒 Dynamic CSPRNG Auth Token generated: %s\n", resolvedToken)
	} else {
		fmt.Println("🔒 Authentication is ENABLED with configured token")
	}

	info, err := discovery.Discover()
	if err != nil {
		fmt.Fprintf(os.Stderr, "❌ Failed to discover localharness process: %v\n", err)
		os.Exit(1)
	}

	fmt.Println("✅ LocalHarness Discovered:")
	fmt.Printf("   PID: %d\n", info.PID)
	token := info.ExtensionCSRF
	if token == "" {
		token = info.CSRFToken
	}
	fmt.Printf("   CSRF Token: %s...\n", maskToken(token))

	rpcClient := connectrpc.NewClient(info.ConnectRPCPort, token)
	if info.UseTLS {
		rpcClient.SetUseTLS(true)
	}

	// Lancement du Watchdog CSRF
	watchdog := discovery.NewWatchdog(rpcClient, 10*time.Second)
	watchdog.Start()
	fmt.Println("🛡️ Watchdog CSRF démarré (vérification toutes les 10s)")

	// Lancement asynchrone du Tunnel Distant (Cloudflare / Pinggy / Ngrok)
	tunnelMgr := tunnel.NewManager(tunnelFlag)
	if !authMgr.IsDisabled() && resolvedToken != "" {
		tunnelMgr.SetAuthToken(resolvedToken)
	}
	go func() {
		if url, err := tunnelMgr.StartAutoTunnel(listenPort); err == nil {
			fmt.Printf("🌐 Tunnel public actif : %s\n", url)
		} else {
			fmt.Fprintf(os.Stderr, "⚠️ Tunnel non démarré (accès local Wi-Fi disponible sur port %d) : %v\n", listenPort, err)
		}
	}()


	// Lancement du Beacon de D├®couverte Automatique LAN (Zero-Config UDP).
	// Aucun jeton n'y est pass├® : le beacon ne diffuse JAMAIS le token sur le
	// LAN (broadcast lisible par tout h├┤te) ÔÇö pairing par QR ou saisie manuelle.
	beacon := discovery.NewLANBeacon(
		listenPort,
		func() string { return tunnelMgr.PublicURL },
		gateway.GetUniqueWorkspaces,
	)
	if err := beacon.Start(); err == nil {
		fmt.Printf("­ƒôí Beacon LAN UDP actif sur le port %d (Zero-Config Auto-Discovery)\n", discovery.DiscoveryPort)
	}

	// C4 : branche le logger structur├® rotatif (AG_REMOTE_LOG_FILE) ou stdout
	// (AG_REMOTE_LOG_LEVEL) ÔÇö les logs du gateway partent en JSON exploitable.
	gateway.SetLogJSON(gateway.NewLogger())

	// P4 : Pairing PIN éphémère + anti-brute-force
	pairingMgr := discovery.NewPairingManager()
	pairingMgr.AllowFirstAdmin = allowFirstAdmin
	pin, _ := pairingMgr.CurrentPIN()
	fmt.Printf("🔑 Code PIN d'appairage mobile : %s (valable 60s — saisissez ce code sur votre téléphone)\n", pin)
	if !allowFirstAdmin {
		fmt.Println("⚠️  Premier appairage NON-admin par défaut : promouvez votre device depuis l'hôte (pairingMgr.PromoteAdmin) ou relancez avec --allow-first-admin")
	}

	server := gateway.NewServer(rpcClient, resolvedToken)
	if !authMgr.IsDisabled() {
		server.SetTokenValidator(func(t string) bool {
			return authMgr.Validate(t) || pairingMgr.ValidateToken(t)
		})
		// Variante enrichie (3.3) : le gateway récupère deviceId + allowedProjects
		// au handshake pour le filtrage par projet (send_prompt / list_sessions).
		server.SetSessionValidator(pairingMgr.ValidateSession)
	}
	// 3.4 : branche le PairingManager pour list_devices / revoke_device
	// (gestion administrative des appareils pairÃ©s depuis le mobile admin).
	server.SetPairingManager(pairingMgr)
	server.SetApprovalTimeout(time.Duration(approvalTimeoutMin) * time.Minute)
	server.SetAllowRemoteTerminal(enableRemoteTerminal)
	// Flux temps réel Jetbox : la sidebar mobile est alimentée par le stream
	// JetboxSubscribeToSummaries (snapshot initial + updates incrémentaux) au
	// lieu de GetAllCascades (~9,5 s). Reconnecte automatiquement en boucle.
	server.RunJetboxSubscription(rpcClient)
	// Flux réactif StreamReactiveUpdates : source secondaire de fiabilité
	// (approbations + détection instantanée "waiting for input") — le parsing
	// des frames de réponse reste le chemin principal. Goroutine autonome.
	server.RunReactiveSubscription(rpcClient)
	sched := gateway.NewScheduler(server)
	sched.Start()

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", server.HandleWebSocket)
	mux.HandleFunc("/pair", pairingMgr.HTTPHandler())
	mux.HandleFunc("/health", server.HTTPHandler)
	mux.HandleFunc("/health/diagnostic", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if !authMgr.IsDisabled() {
			clientToken := r.URL.Query().Get("token")
			if clientToken == "" {
				clientToken = r.Header.Get("Authorization")
				clientToken = strings.TrimPrefix(clientToken, "Bearer ")
			}
			if !authMgr.Validate(clientToken) && !pairingMgr.ValidateToken(clientToken) {
				w.WriteHeader(http.StatusUnauthorized)
				_ = json.NewEncoder(w).Encode(map[string]string{"error": "Unauthorized"})
				return
			}
		}
		hbErr := ""
		if _, err := rpcClient.Heartbeat(); err != nil {
			hbErr = err.Error()
		}
		status := "ok"
		if hbErr != "" {
			status = "degraded"
		}
		w.WriteHeader(http.StatusOK)
		port, _ := rpcClient.Endpoint()
		provider := tunnelMgr.GetProvider()
		pubURL := tunnelMgr.GetPublicURL()
		data, _ := json.Marshal(map[string]interface{}{
			"status":         status,
			"rpcPort":        port,
			"pid":            info.PID,
			"heartbeatOk":    hbErr == "",
			"tunnelProvider": provider,
			"publicUrl":      pubURL,
			"error":          hbErr,
		})
		w.Write(data)
	})

	srv := &http.Server{
		Addr:              net.JoinHostPort(host, strconv.Itoa(listenPort)),
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	// Arrêt propre sur Ctrl+C / SIGTERM : ferme le tunnel, le beacon, le watchdog, le scheduler et le serveur HTTP.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		log.Println("🛑 Arrêt du daemon, fermeture du tunnel et des services…")
		tunnelMgr.Stop()
		beacon.Stop()
		watchdog.Stop()
		sched.Stop()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
	}()

	fmt.Printf("🌐 Daemon listening on ws://%s:%d/ws\n", host, listenPort)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("❌ Server error: %v", err)
	}
}
