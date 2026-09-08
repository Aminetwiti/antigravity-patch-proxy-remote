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
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/antigravity/remote-daemon/pkg/agent"
	"github.com/antigravity/remote-daemon/pkg/approval"
	"github.com/antigravity/remote-daemon/pkg/auth"
	"github.com/antigravity/remote-daemon/pkg/config"
	"github.com/antigravity/remote-daemon/pkg/connectrpc"
	"github.com/antigravity/remote-daemon/pkg/discovery"
	"github.com/antigravity/remote-daemon/pkg/domain"
	"github.com/antigravity/remote-daemon/pkg/eventstore"
	"github.com/antigravity/remote-daemon/pkg/gateway"
	"github.com/antigravity/remote-daemon/pkg/notification"
	"github.com/antigravity/remote-daemon/pkg/sandbox"
	"github.com/antigravity/remote-daemon/pkg/server"
	"github.com/antigravity/remote-daemon/pkg/tools"
	"github.com/antigravity/remote-daemon/pkg/tunnel"
	"github.com/antigravity/remote-daemon/pkg/web"
	"github.com/antigravity/remote-daemon/pkg/workspace"
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
	var allowPublicBind bool

	var modeFlag string
	var dbPathFlag string
	var workspacesDirFlag string
	var providerFlag string
	var modelFlag string
	var noApproval bool
	var sandboxFlag string
	var dockerImageFlag string
	var dockerMemoryFlag string
	var dockerCPUFlag string

	flag.IntVar(&listenPort, "port", cfg.Port, "Port for the WebSocket server")
	flag.StringVar(&host, "host", cfg.Host, "Host for the WebSocket server")
	flag.StringVar(&tunnelFlag, "tunnel", cfg.TunnelProvider, "Tunnel provider (cloudflare, pinggy, pangolin, ngrok, local)")
	flag.StringVar(&authToken, "auth-token", "", "Authentication token for Mobile App (generates dynamic CSPRNG if omitted, or 'none' to disable)")
	flag.BoolVar(&noAuth, "no-auth", false, "Disable authentication (allow any client without token)")
	flag.IntVar(&approvalTimeoutMin, "approval-timeout", int(cfg.ApprovalTimeout.Minutes()), "Auto-deny timeout for pending approvals in minutes (0 = disabled)")
	flag.BoolVar(&enableRemoteTerminal, "enable-remote-terminal", cfg.AllowRemoteTerminal, "Allow remote interactive PTY terminal creation")
	flag.BoolVar(&allowFirstAdmin, "allow-first-admin", false, "Let the FIRST paired device become Admin (default: promote via host console with 'promote <deviceId>')")
	flag.BoolVar(&allowPublicBind, "allow-public-bind", false, "Allow binding to public interfaces without restriction")

	flag.StringVar(&modeFlag, "mode", "auto", "Execution mode: 'server' (standalone cloud daemon), 'bridge' (desktop IDE bridge), or 'auto' (detect)")
	flag.StringVar(&dbPathFlag, "db-path", "", "Path to SQLite database for server runtime (default: ~/.antigravity/runtime.db)")
	flag.StringVar(&workspacesDirFlag, "workspaces-dir", "", "Root directory for server workspaces (default: ~/.antigravity/workspaces)")
	flag.StringVar(&providerFlag, "provider", "auto", "AI model provider: 'auto', 'anthropic', 'openai', 'ollama', 'proxy'")
	flag.StringVar(&modelFlag, "model", "", "Model name override (e.g. claude-3-5-sonnet-20241022, gpt-4o)")
	flag.BoolVar(&noApproval, "no-approval", false, "Disable manual tool approval (auto-approve all tool calls)")
	flag.StringVar(&sandboxFlag, "sandbox", "native", "Execution sandbox: 'native' (host execution) or 'docker' (isolated container)")
	flag.StringVar(&dockerImageFlag, "docker-image", "alpine:latest", "Docker container image when --sandbox=docker")
	flag.StringVar(&dockerMemoryFlag, "docker-memory", "512m", "Memory limit for docker container (e.g. 512m, 1g)")
	flag.StringVar(&dockerCPUFlag, "docker-cpu", "", "CPU limit for docker container (e.g. 1.0, 2.0)")
	var webhookURLFlag string
	flag.StringVar(&webhookURLFlag, "webhook-url", "", "Comma-separated webhook URLs for external alerts (Slack, Discord, generic POST)")
	flag.Parse()

	if webhookURLFlag == "" {
		webhookURLFlag = os.Getenv("AG_WEBHOOK_URL")
	}

	if err := config.AssertSafeBind(host, allowPublicBind); err != nil {
		fmt.Fprintf(os.Stderr, "❌ Security assertion failed: %v\n", err)
		os.Exit(1)
	}

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

	if modeFlag == "server" {
		runServerRuntime(host, listenPort, dbPathFlag, workspacesDirFlag, tunnelFlag, resolvedToken, authMgr, providerFlag, modelFlag, noApproval, sandboxFlag, dockerImageFlag, dockerMemoryFlag, dockerCPUFlag, webhookURLFlag)
		return
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
		if modeFlag == "auto" {
			fmt.Printf("ℹ️  No local Antigravity desktop IDE process detected (%v)\n", err)
			fmt.Println("🚀 Automatically launching in Standalone Cloud Server Runtime mode...")
			runServerRuntime(host, listenPort, dbPathFlag, workspacesDirFlag, tunnelFlag, resolvedToken, authMgr, providerFlag, modelFlag, noApproval, sandboxFlag, dockerImageFlag, dockerMemoryFlag, dockerCPUFlag, webhookURLFlag)
			return
		}
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
	pairingMgr.OnPaired = func(info discovery.SessionInfo) {
		name := info.Name
		if name == "" {
			name = info.DeviceID
		}
		notification.SendNotification("Antigravity Remote", fmt.Sprintf("📱 Nouvel appareil appairé : %s", name))
	}
	pin, _ := pairingMgr.CurrentPIN()
	fmt.Printf("🔑 Code PIN d'appairage mobile : %s (valable 60s — saisissez ce code sur votre téléphone)\n", pin)
	if !allowFirstAdmin {
		fmt.Println("⚠️  Premier appairage NON-admin par défaut : promouvez votre device depuis l'hôte (pairingMgr.PromoteAdmin) ou relancez avec --allow-first-admin")
	}

	server := gateway.NewServer(rpcClient, resolvedToken)
	gateway.SetMcpProxyBase(os.Getenv("AG_BIND_HOST"), cfg.ProxyPort)
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
	if cfg.SessionsCacheTTL > 0 {
		server.SetSessionsCacheTTL(cfg.SessionsCacheTTL)
	}

	var currentPID = info.PID
	var pidMu sync.Mutex

	rpcClient.OnAuthError = func() bool {
		newInfo, err := discovery.Discover()
		if err != nil {
			return false
		}
		rpcClient.UpdateEndpoint(newInfo.ConnectRPCPort, newInfo.ExtensionCSRF)
		rpcClient.SetUseTLS(newInfo.UseTLS)
		server.SetIDERunning(true, newInfo.ConnectRPCPort, newInfo)
		pidMu.Lock()
		currentPID = newInfo.PID
		pidMu.Unlock()
		return true
	}

	// Lancement du Watchdog CSRF & Statut IDE
	watchdog := discovery.NewWatchdog(rpcClient, 5*time.Second)
	watchdog.OnStatusChange = func(running bool, port int, inf *discovery.LocalHarnessInfo) {
		if running && inf != nil {
			pidMu.Lock()
			currentPID = inf.PID
			pidMu.Unlock()
		}
		server.SetIDERunning(running, port, inf)
	}
	watchdog.Start()
	fmt.Println("🛡️ Watchdog CSRF & Statut IDE démarré (vérification toutes les 5s)")
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
	server.StartHostTelemetryPoller(5 * time.Second)

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", server.HandleWebSocket)
	mux.HandleFunc("/pair", pairingMgr.HTTPHandler())
	mux.HandleFunc("/health", server.HTTPHandler)
	mux.Handle("/web/", http.StripPrefix("/web", web.Handler()))
	mux.Handle("/web", http.RedirectHandler("/web/", http.StatusPermanentRedirect))
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
		pidMu.Lock()
		p := currentPID
		pidMu.Unlock()
		data, _ := json.Marshal(map[string]interface{}{
			"status":         status,
			"rpcPort":        port,
			"pid":            p,
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

	// Durcissement TCP Keepalive sur le listener pour préserver les connexions mobiles
	listenConfig := net.ListenConfig{
		KeepAlive: 30 * time.Second,
	}
	listener, err := listenConfig.Listen(context.Background(), "tcp", net.JoinHostPort(host, strconv.Itoa(listenPort)))
	if err != nil {
		fmt.Fprintf(os.Stderr, "❌ Server listen error: %v\n", err)
		os.Exit(1)
	}
	defer listener.Close()

	fmt.Printf("🌐 Daemon listening on ws://%s:%d/ws\n", host, listenPort)
	if err := srv.Serve(listener); err != nil && err != http.ErrServerClosed {
		fmt.Fprintf(os.Stderr, "❌ Server error: %v\n", err)
		os.Exit(1)
	}
}

func runServerRuntime(
	host string,
	port int,
	dbPath string,
	workspacesDir string,
	tunnelFlag string,
	authToken string,
	authMgr *auth.TokenManager,
	provider string,
	model string,
	autoApprove bool,
	sandboxType string,
	dockerImage string,
	dockerMemory string,
	dockerCPU string,
	webhookURL string,
) {
	fmt.Printf("🚀 Starting Antigravity Standalone Cloud Server Runtime on %s:%d...\n", host, port)

	if dbPath == "" {
		home, _ := os.UserHomeDir()
		dbPath = filepath.Join(home, ".antigravity", "runtime.db")
	}
	_ = os.MkdirAll(filepath.Dir(dbPath), 0755)

	store, err := eventstore.NewSQLiteEventStore(dbPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "❌ Failed to initialize SQLite EventStore: %v\n", err)
		os.Exit(1)
	}
	defer store.Close()

	hostname, _ := os.Hostname()
	serverInfo := domain.Server{
		ID:        fmt.Sprintf("srv_%d", time.Now().UnixMilli()),
		Name:      "Antigravity Cloud Runtime",
		Hostname:  hostname,
		Platform:  runtime.GOOS,
		Version:   "2.0.0",
		Status:    domain.ServerStatusOnline,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	rt := server.NewRuntimeServer(serverInfo, store)

	webhookDispatcher := notification.NewWebhookDispatcher(webhookURL)
	rt.SetWebhookDispatcher(webhookDispatcher)
	defer webhookDispatcher.Close()
	if webhookURL != "" {
		fmt.Printf("🔔 Cloud Webhooks active: %s\n", webhookURL)
	}

	wsMgr := workspace.NewManager()

	if workspacesDir == "" {
		home, _ := os.UserHomeDir()
		workspacesDir = filepath.Join(home, ".antigravity", "workspaces")
	}
	_ = os.MkdirAll(workspacesDir, 0755)

	defaultWs, _ := wsMgr.RegisterWorkspace("default", "Default Workspace", workspacesDir)
	fmt.Printf("📁 Default workspace registered: %s (%s)\n", defaultWs.Name, defaultWs.Root)

	toolsReg := tools.NewRegistry(wsMgr, autoApprove)
	var sb sandbox.Provider
	if sandboxType == "docker" {
		sb = sandbox.NewDockerSandbox(sandbox.DockerSandboxConfig{
			Image:       dockerImage,
			MemoryLimit: dockerMemory,
			CPULimit:    dockerCPU,
		})
		fmt.Printf("📦 Sandbox: Docker container (%s, memory: %s)\n", dockerImage, dockerMemory)
	} else {
		sb = sandbox.NewNativeSandbox()
		fmt.Println("💻 Sandbox: Native (host execution)")
	}
	toolsReg.SetSandbox(sb)
	apprMgr := approval.NewManager(rt.SessionService(), 5*time.Minute)

	providerCfg := agent.AutoDetectProviderConfig()
	if provider != "" && provider != "auto" {
		providerCfg.Type = agent.ProviderType(provider)
	}
	if model != "" {
		providerCfg.Model = model
	}
	llmClient := agent.NewHTTPProviderClient(providerCfg)
	fmt.Printf("🧠 AI Provider: %s (Model: %s)\n", providerCfg.Type, providerCfg.Model)

	agentEng := agent.NewEngine(rt.SessionService(), wsMgr, toolsReg, apprMgr, llmClient)
	rt.SetAgentEngine(agentEng, apprMgr)

	v1Adapter := server.NewV1Adapter(rt.SessionService(), store, wsMgr, agentEng, apprMgr, authToken)
	rt.SetV1Adapter(v1Adapter)

	sched := server.NewScheduler(rt.SessionService(), agentEng)
	rt.SetScheduler(sched)
	sched.Start(context.Background())
	defer sched.Stop()

	handler := server.NewMux(rt, wsMgr, authToken)

	tunnelMgr := tunnel.NewManager(tunnelFlag)
	if !authMgr.IsDisabled() && authToken != "" {
		tunnelMgr.SetAuthToken(authToken)
	}
	go func() {
		if url, err := tunnelMgr.StartAutoTunnel(port); err == nil {
			fmt.Printf("🌐 Public Cloud Tunnel active: %s\n", url)
			if !authMgr.IsDisabled() && authToken != "" {
				fmt.Printf("📱 Mobile Pair URL: %s/v2/ws?token=%s\n", url, authToken)
				fmt.Printf("💻 Web Console URL: %s/console?token=%s\n", url, authToken)
			}
		} else {
			fmt.Printf("⚠️ Tunnel not started (local network access on port %d): %v\n", port, err)
		}
	}()

	addr := net.JoinHostPort(host, strconv.Itoa(port))
	srv := &http.Server{
		Addr:              addr,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		<-ctx.Done()
		fmt.Println("\n🛑 Shutting down server runtime gracefully...")
		tunnelMgr.Stop()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
	}()

	fmt.Printf("✅ Cloud Server Runtime is listening on http://%s\n", addr)
	fmt.Println("   - Web Console:       GET  /console")
	fmt.Println("   - Workspace Shell:   WS   /v2/terminal")
	fmt.Println("   - Prometheus Metrics:GET  /metrics")
	fmt.Println("   - Approvals API:     GET  /v2/approvals")
	fmt.Println("   - Health check:      GET  /health")
	fmt.Println("   - Sessions REST:     GET  /v2/sessions")
	fmt.Println("   - Workspaces API:    GET  /v2/workspaces")
	fmt.Println("   - Branches API:      GET  /v2/workspaces/branches")
	fmt.Println("   - Worktrees API:     POST /v2/workspaces/worktrees")
	fmt.Println("   - Schedules API:     GET  /v2/schedules")
	fmt.Println("   - Protocol v2 WS:    WS   /v2/ws")
	fmt.Println("   - Protocol v1 WS:    WS   /ws")

	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		fmt.Fprintf(os.Stderr, "❌ Server error: %v\n", err)
		os.Exit(1)
	}
}
