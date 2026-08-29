package tunnel

import (
	"bufio"
	"fmt"
	"log"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"
)

// execCommand et execLookPath sont injectables pour les tests (faux binaires
// cloudflared/ssh) — voir fake_bin_test.go. Valeurs réelles en production.
var (
	execCommand  = exec.Command
	execLookPath = exec.LookPath
)

// resolveBinaryPath recherche un binaire dans le PATH système puis dans les dossiers locaux du projet.
func resolveBinaryPath(name string) (string, error) {
	if p, err := execLookPath(name); err == nil {
		return p, nil
	}
	if runtime.GOOS == "windows" && !strings.HasSuffix(name, ".exe") {
		if p, err := execLookPath(name + ".exe"); err == nil {
			return p, nil
		}
	}

	exePath, err := os.Executable()
	var exeDir string
	if err == nil {
		exeDir = filepath.Dir(exePath)
	}

	candidates := []string{
		filepath.Join(".", name),
		filepath.Join(".", "bin", name),
		filepath.Join("..", "bin", name),
		filepath.Join("..", "..", "bin", name),
	}
	if exeDir != "" {
		candidates = append(candidates,
			filepath.Join(exeDir, name),
			filepath.Join(exeDir, "bin", name),
			filepath.Join(exeDir, "..", "bin", name),
			filepath.Join(exeDir, "..", "..", "bin", name),
		)
	}

	if runtime.GOOS == "windows" {
		candidates = append(candidates,
			filepath.Join(".", name+".exe"),
			filepath.Join(".", "bin", name+".exe"),
			filepath.Join("..", "bin", name+".exe"),
			filepath.Join("..", "..", "bin", name+".exe"),
			filepath.Join("C:\\Windows\\System32\\OpenSSH", name+".exe"),
			filepath.Join("C:\\Program Files\\Git\\usr\\bin", name+".exe"),
		)
		if exeDir != "" {
			candidates = append(candidates,
				filepath.Join(exeDir, name+".exe"),
				filepath.Join(exeDir, "bin", name+".exe"),
				filepath.Join(exeDir, "..", "bin", name+".exe"),
				filepath.Join(exeDir, "..", "..", "bin", name+".exe"),
			)
		}
	}


	if home, err := os.UserHomeDir(); err == nil {
		candidates = append(candidates,
			filepath.Join(home, ".gemini", "antigravity", "bin", name),
			filepath.Join(home, ".cloudflared", name),
		)
		if runtime.GOOS == "windows" {
			candidates = append(candidates,
				filepath.Join(home, ".gemini", "antigravity", "bin", name+".exe"),
				filepath.Join(home, ".cloudflared", name+".exe"),
			)
		}
	}

	for _, cand := range candidates {
		if info, err := os.Stat(cand); err == nil && !info.IsDir() {
			return cand, nil
		}
	}

	return "", fmt.Errorf("%s introuvable sur $PATH ou dans les dossiers locaux du projet", name)
}

// Regexes d'extraction d'URL (package-level pour testabilité sans binaire réel).
var (
	cloudflareURLRe = regexp.MustCompile(`https://[a-zA-Z0-9-]+\.trycloudflare\.com`)
	// https?://[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.pinggy\.link — couvre aussi
	// "a.pinggy.link" (sous-domaine à label unique) et le préfixe ssh://.
	pinggyURLRe = regexp.MustCompile(`(?:https?|ssh)://[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.pinggy\.link`)
	// Pangolin / Newt URL : https://*.pangolin.link ou nom de domaine custom https://*.*
	pangolinURLRe = regexp.MustCompile(`(?:https?|wss?)://[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+(?::\d+)?`)
)

type Manager struct {
	Provider     string `json:"provider"`
	ProviderPref string `json:"-"`
	PublicURL    string `json:"publicUrl"`
	AuthToken    string `json:"-"`
	cmd          *exec.Cmd
	mu           sync.Mutex
	stopChan     chan struct{}
}

func NewManager(providerPref string) *Manager {
	return &Manager{
		ProviderPref: providerPref,
		stopChan:     make(chan struct{}),
	}
}

func (m *Manager) SetAuthToken(token string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.AuthToken = token
}

// StartAutoTunnel tente de lancer Pangolin, Cloudflare Quick Tunnel ou Pinggy SSH Tunnel.
func (m *Manager) StartAutoTunnel(localPort int) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Si aucun tunnel n'est demandé (réseau local uniquement)
	if m.ProviderPref == "none" || m.ProviderPref == "local" || m.ProviderPref == "disabled" {
		return "", fmt.Errorf("tunnel désactivé (mode réseau local uniquement)")
	}

	// Si un provider est forcé
	if m.ProviderPref == "pangolin" {
		return m.tryPangolin(localPort)
	} else if m.ProviderPref == "cloudflare" {
		return m.tryCloudflare(localPort)
	} else if m.ProviderPref == "pinggy" {
		return m.tryPinggy(localPort)
	} else if m.ProviderPref != "" {
		log.Printf("⚠️ Fournisseur de tunnel inconnu: %s. Essai automatique...", m.ProviderPref)
	}

	// 1. Essayer Pangolin si configuré via env (PANGOLIN_URL)
	if os.Getenv("PANGOLIN_URL") != "" {
		if url, err := m.tryPangolin(localPort); err == nil {
			return url, nil
		}
	}

	// 2. Essayer Cloudflare Quick Tunnel (cloudflared)
	if url, err := m.tryCloudflare(localPort); err == nil {
		return url, nil
	}

	// 3. Essayer Pinggy SSH Tunnel (ssh)
	if url, err := m.tryPinggy(localPort); err == nil {
		return url, nil
	}

	// 4. Essayer Pangolin (newt / pangolin binaire)
	if url, err := m.tryPangolin(localPort); err == nil {
		return url, nil
	}

	return "", fmt.Errorf("aucun fournisseur de tunnel disponible (pangolin, cloudflared ou ssh introuvable sur $PATH)")
}

func (m *Manager) tryPangolin(localPort int) (string, error) {
	// 1. Si une URL statique personnalisée est définie dans l'environnement (ex: reverse proxy VPS existant)
	if staticURL := os.Getenv("PANGOLIN_URL"); staticURL != "" {
		if !strings.HasPrefix(staticURL, "http://") && !strings.HasPrefix(staticURL, "https://") {
			staticURL = "https://" + staticURL
		}
		m.Provider = "pangolin"
		m.PublicURL = staticURL
		m.printBanner(staticURL)
		return staticURL, nil
	}

	// 2. Recherche du binaire client Pangolin (newt ou pangolin) dans le PATH ou localement
	binPath := ""
	if envBin := os.Getenv("PANGOLIN_BIN"); envBin != "" {
		binPath = envBin
	} else if p, err := resolveBinaryPath("newt"); err == nil {
		binPath = p
	} else if p, err := resolveBinaryPath("pangolin"); err == nil {
		binPath = p
	}

	if binPath == "" {
		return "", fmt.Errorf("client Pangolin (newt ou pangolin) introuvable sur $PATH (définissez PANGOLIN_URL ou installez newt)")
	}

	log.Printf("[Tunnel] Lancement de Pangolin Tunnel (%s)...", binPath)
	url, err := m.startPangolin(binPath, localPort)
	if err == nil {
		m.Provider = "pangolin"
		m.PublicURL = url
		m.printBanner(url)
		return url, nil
	}
	log.Printf("[Tunnel] Échec Pangolin: %v", err)
	return "", err
}

func (m *Manager) tryCloudflare(localPort int) (string, error) {
	path, err := resolveBinaryPath("cloudflared")
	if err != nil {
		return "", fmt.Errorf("cloudflared introuvable sur $PATH ou dans remote/daemon/bin/")
	}
	log.Printf("[Tunnel] Lancement de Cloudflare Quick Tunnel (%s)...", path)
	url, err := m.startCloudflare(path, localPort)
	if err == nil {
		m.Provider = "cloudflare"
		m.PublicURL = url
		m.printBanner(url)
		return url, nil
	}
	log.Printf("[Tunnel] Échec Cloudflare: %v", err)
	return "", err
}

func (m *Manager) tryPinggy(localPort int) (string, error) {
	path, err := resolveBinaryPath("ssh")
	if err != nil {
		return "", fmt.Errorf("ssh introuvable")
	}
	log.Printf("[Tunnel] Lancement de Pinggy SSH Tunnel (%s)...", path)
	url, err := m.startPinggy(path, localPort)
	if err == nil {
		m.Provider = "pinggy"
		m.PublicURL = url
		m.printBanner(url)
		return url, nil
	}
	log.Printf("[Tunnel] Échec Pinggy SSH: %v", err)
	return "", err
}

func (m *Manager) startCloudflare(binPath string, localPort int) (string, error) {
	bind := os.Getenv("AG_BIND_HOST")
	if bind == "" {
		bind = "127.0.0.1"
	}
	targetURL := fmt.Sprintf("http://%s:%d", bind, localPort)
	cmd := execCommand(binPath, "tunnel", "--url", targetURL)
	m.cmd = cmd

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return "", err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return "", err
	}

	if err := cmd.Start(); err != nil {
		return "", err
	}

	urlChan := make(chan string, 1)
	re := cloudflareURLRe

	scanFunc := func(scanner *bufio.Scanner) {
		for scanner.Scan() {
			line := scanner.Text()
			if match := re.FindString(line); match != "" {
				select {
				case urlChan <- match:
				default:
				}
			}
		}
	}

	go scanFunc(bufio.NewScanner(stdout))
	go scanFunc(bufio.NewScanner(stderr))

	select {
	case url := <-urlChan:
		return url, nil
	case <-time.After(30 * time.Second):
		cmd.Process.Kill()
		return "", fmt.Errorf("timeout d'attente de l'URL Cloudflare")
	}
}

func (m *Manager) startPinggy(binPath string, localPort int) (string, error) {
	bind := os.Getenv("AG_BIND_HOST")
	if bind == "" {
		bind = "127.0.0.1"
	}
	args := []string{
		"-p", "443",
		"-o", "StrictHostKeyChecking=no",
		"-o", "ServerAliveInterval=30",
		"-R", fmt.Sprintf("0:%s:%d", bind, localPort),
		"a.pinggy.io",
	}
	cmd := execCommand(binPath, args...)
	m.cmd = cmd

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return "", err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return "", err
	}

	if err := cmd.Start(); err != nil {
		return "", err
	}

	urlChan := make(chan string, 1)
	re := pinggyURLRe

	scanFunc := func(scanner *bufio.Scanner) {
		for scanner.Scan() {
			line := scanner.Text()
			if match := re.FindString(line); match != "" {
				// Assurez-vous d'avoir https
				match = strings.Replace(match, "http://", "https://", 1)
				select {
				case urlChan <- match:
				default:
				}
			}
		}
	}

	go scanFunc(bufio.NewScanner(stdout))
	go scanFunc(bufio.NewScanner(stderr))

	select {
	case url := <-urlChan:
		return url, nil
	case <-time.After(15 * time.Second):
		cmd.Process.Kill()
		return "", fmt.Errorf("timeout d'attente de l'URL Pinggy")
	}
}

func (m *Manager) startPangolin(binPath string, localPort int) (string, error) {
	// Syntaxe newt/pangolin standard : newt http <port> ou newt --server ... --token ... http <port>
	var args []string
	if server := os.Getenv("PANGOLIN_SERVER"); server != "" {
		args = append(args, "--server", server)
	}
	if token := os.Getenv("PANGOLIN_TOKEN"); token != "" {
		args = append(args, "--token", token)
	}
	args = append(args, "http", fmt.Sprintf("%d", localPort))

	cmd := execCommand(binPath, args...)
	m.cmd = cmd

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return "", err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return "", err
	}

	if err := cmd.Start(); err != nil {
		return "", err
	}

	urlChan := make(chan string, 1)
	re := pangolinURLRe

	scanFunc := func(scanner *bufio.Scanner) {
		for scanner.Scan() {
			line := scanner.Text()
			if match := re.FindString(line); match != "" {
				if !strings.HasPrefix(match, "https://") && !strings.HasPrefix(match, "http://") {
					match = "https://" + match
				}
				match = strings.Replace(match, "http://", "https://", 1)
				select {
				case urlChan <- match:
				default:
				}
			}
		}
	}

	go scanFunc(bufio.NewScanner(stdout))
	go scanFunc(bufio.NewScanner(stderr))

	select {
	case url := <-urlChan:
		return url, nil
	case <-time.After(20 * time.Second):
		if fallbackURL := os.Getenv("PANGOLIN_URL"); fallbackURL != "" {
			if !strings.HasPrefix(fallbackURL, "http://") && !strings.HasPrefix(fallbackURL, "https://") {
				fallbackURL = "https://" + fallbackURL
			}
			return fallbackURL, nil
		}
		cmd.Process.Kill()
		return "", fmt.Errorf("timeout d'attente de l'URL Pangolin")
	}
}

// WebSocketURL convertit l'URL HTTPS publique d'un tunnel en endpoint WebSocket WSS.
func WebSocketURL(publicURL string) string {

	return strings.Replace(publicURL, "https://", "wss://", 1) + "/ws"
}

func (m *Manager) printBanner(publicURL string) {
	wsURL := WebSocketURL(publicURL)
	token := m.AuthToken

	qrTarget := wsURL
	if token != "" {
		qrTarget = fmt.Sprintf("%s?token=%s", wsURL, url.QueryEscape(token))
	}

	fmt.Println("\n========================================================")
	fmt.Println("🌐 TUNNEL DISTANT 4G/5G ET ACCÈS HORS DOMICILE ACTIF !")
	fmt.Printf("   Fournisseur : %s\n", strings.ToUpper(m.Provider))
	fmt.Printf("   URL Web     : %s\n", publicURL)
	fmt.Printf("   URL WebSocket mobile : %s\n", wsURL)
	if token != "" {
		fmt.Printf("   Token Auth Mobile    : %s\n", token)
	}
	fmt.Println("========================================================")
	PrintQRCode(qrTarget)
}

func (m *Manager) GetPublicURL() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.PublicURL
}

func (m *Manager) GetProvider() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.Provider
}

func (m *Manager) Stop() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.cmd != nil && m.cmd.Process != nil {
		// Windows : taskkill /T /PID pour tuer cloudflared + ses enfants
		// (groupe de processus créé dans startCloudflare). Sur les autres
		// plateformes, le kill simple suffit.
		if runtime.GOOS == "windows" {
			execCommand("taskkill", "/T", "/F", "/PID", fmt.Sprintf("%d", m.cmd.Process.Pid)).Run()
		} else {
			m.cmd.Process.Kill()
		}
	}
}
