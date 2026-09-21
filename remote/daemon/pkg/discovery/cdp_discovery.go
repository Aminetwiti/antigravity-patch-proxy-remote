package discovery

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// CDPTarget représente une cible de débogage exposée par Chromium/Electron.
type CDPTarget struct {
	ID                   string `json:"id"`
	Type                 string `json:"type"`
	Title                string `json:"title"`
	URL                  string `json:"url"`
	WebSocketDebuggerURL string `json:"webSocketDebuggerUrl"`
	Port                 int    `json:"-"`
}

// CDPDiscoveryInfo regroupe le port actif et les cibles trouvées.
type CDPDiscoveryInfo struct {
	Port         int
	BrowserPath  string
	ActiveTarget *CDPTarget
	AllTargets   []CDPTarget
}

// FindDevToolsActivePort localise le fichier DevToolsActivePort créé par Electron.
func FindDevToolsActivePort() (string, error) {
	appData := os.Getenv("APPDATA")
	if appData != "" {
		p := filepath.Join(appData, "Antigravity", "DevToolsActivePort")
		if _, err := os.Stat(p); err == nil {
			return p, nil
		}
		pLower := filepath.Join(appData, "antigravity", "DevToolsActivePort")
		if _, err := os.Stat(pLower); err == nil {
			return pLower, nil
		}
	}

	userProfile := os.Getenv("USERPROFILE")
	if userProfile == "" {
		userProfile = os.Getenv("HOME")
	}
	if userProfile != "" {
		candidates := []string{
			filepath.Join(userProfile, "AppData", "Roaming", "Antigravity", "DevToolsActivePort"),
			filepath.Join(userProfile, ".gemini", "antigravity", "DevToolsActivePort"),
			filepath.Join(userProfile, ".gemini", "antigravity-ide", "DevToolsActivePort"),
		}
		for _, c := range candidates {
			if _, err := os.Stat(c); err == nil {
				return c, nil
			}
		}
	}

	return "", fmt.Errorf("DevToolsActivePort introuvable")
}

// ReadDevToolsActivePort lit le port et le chemin de débogage.
func ReadDevToolsActivePort(filePath string) (int, string, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return 0, "", err
	}
	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	if len(lines) < 1 {
		return 0, "", fmt.Errorf("fichier DevToolsActivePort vide")
	}

	port, err := strconv.Atoi(strings.TrimSpace(lines[0]))
	if err != nil {
		return 0, "", fmt.Errorf("port invalide dans DevToolsActivePort: %w", err)
	}

	browserPath := ""
	if len(lines) >= 2 {
		browserPath = strings.TrimSpace(lines[1])
	}

	return port, browserPath, nil
}

// DiscoverCDP inspecte l'interface Chromium/Electron et retourne les cibles actives.
func DiscoverCDP() (*CDPDiscoveryInfo, error) {
	filePath, err := FindDevToolsActivePort()
	if err != nil {
		return nil, err
	}

	port, browserPath, err := ReadDevToolsActivePort(filePath)
	if err != nil {
		return nil, err
	}

	client := &http.Client{Timeout: 800 * time.Millisecond}
	url := fmt.Sprintf("http://127.0.0.1:%d/json/list", port)
	resp, err := client.Get(url)
	if err != nil {
		return nil, fmt.Errorf("échec de connexion au port CDP %d: %w", port, err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var targets []CDPTarget
	if err := json.Unmarshal(body, &targets); err != nil {
		return nil, fmt.Errorf("erreur décodage json/list: %w", err)
	}

	info := &CDPDiscoveryInfo{
		Port:        port,
		BrowserPath: browserPath,
		AllTargets:  targets,
	}

	// Prioriser la page principale du chat (contient /c/ ou section=)
	for i := range targets {
		targets[i].Port = port
		if targets[i].Type == "page" && targets[i].WebSocketDebuggerURL != "" {
			if strings.Contains(targets[i].URL, "/c/") || strings.Contains(targets[i].URL, "section=") {
				info.ActiveTarget = &targets[i]
				break
			}
			if info.ActiveTarget == nil {
				info.ActiveTarget = &targets[i]
			}
		}
	}

	return info, nil
}
