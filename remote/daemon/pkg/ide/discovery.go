package ide

import (
	"bufio"
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/antigravity/remote-daemon/pkg/connectrpc"
)

// DiscoverInstances recherche tous les processus language_server_windows_x64.exe actifs.
func DiscoverInstances() ([]Instance, error) {
	// Script PowerShell d'extraction rapide des processus et ports
	psScript := strings.Join([]string{
		`$results = @()`,
		`Get-CimInstance Win32_Process | Where-Object { $_.Name -like '*language_server_windows_x64*' } | ForEach-Object {`,
		`    $procId = $_.ProcessId`,
		`    $cmd = $_.CommandLine`,
		`    $csrf = ""`,
		`    if ($cmd -match '--csrf_token\s+([a-f0-9\-]+)') { $csrf = $matches[1] }`,
		`    $ws = ""`,
		`    if ($cmd -match '--workspace_id\s+([^\s]+)') { $ws = $matches[1] }`,
		`    $appDir = "antigravity-ide"`,
		`    if ($cmd -match '--app_data_dir\s+([a-zA-Z0-9_\-]+)') { $appDir = $matches[1] }`,
		`    $ports = Get-NetTCPConnection -OwningProcess $procId -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalPort`,
		`    foreach ($p in $ports) {`,
		`        $results += "$procId;$p;$csrf;$ws;$appDir"`,
		`    }`,
		`}`,
		`$results -join "` + "`n" + `"`,
	}, "\n")

	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command", psScript)
	var stdout bytes.Buffer
	cmd.Stdout = &stdout
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("erreur scan powershell: %w", err)
	}

	lines := strings.Split(stdout.String(), "\n")
	var instances []Instance

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.Split(line, ";")
		if len(parts) < 5 {
			continue
		}

		pid, _ := strconv.Atoi(parts[0])
		port, _ := strconv.Atoi(parts[1])
		csrf := parts[2]
		wsID := parts[3]
		appDir := parts[4]

		if port <= 0 || csrf == "" {
			continue
		}

		// Tester si le port répond à Heartbeat
		client := connectrpc.NewClient(port, csrf)
		client.UseTLS = false
		client.HTTP.Timeout = 1 * time.Second

		if _, err := client.Heartbeat(); err == nil {
			instances = append(instances, Instance{
				PID:         pid,
				Port:        port,
				CSRFToken:   csrf,
				WorkspaceID: wsID,
				AppDataDir:  appDir,
				ActiveSince: time.Now(),
			})
		}
	}

	return instances, nil
}

// FindActiveInstance retourne la première instance active valide.
func FindActiveInstance() (*Instance, error) {
	instances, err := DiscoverInstances()
	if err != nil {
		return nil, err
	}
	if len(instances) == 0 {
		return nil, fmt.Errorf("aucune instance active d'Antigravity IDE trouvée")
	}
	return &instances[0], nil
}

// ExtractCSRFTokenFromCmd extrait le token CSRF depuis une ligne de commande.
func ExtractCSRFTokenFromCmd(cmdLine string) string {
	re := regexp.MustCompile(`--csrf_token\s+([a-f0-9\-]+)`)
	matches := re.FindStringSubmatch(cmdLine)
	if len(matches) > 1 {
		return matches[1]
	}
	return ""
}

// decodeVSCodeWorkspaceID décode un workspace_id VS Code (ex: file_c_3A_Users_..._www_20_20Copie) en chemin normalisé.
func decodeVSCodeWorkspaceID(wsID string) string {
	if wsID == "" {
		return ""
	}
	s := wsID
	if strings.HasPrefix(s, "file_") {
		s = strings.TrimPrefix(s, "file_")
	}
	s = strings.ReplaceAll(s, "_20", " ")
	s = strings.ReplaceAll(s, "_3A", ":")
	s = strings.ReplaceAll(s, "_3a", ":")
	s = strings.ReplaceAll(s, "_", "/")
	return strings.ToLower(filepath.ToSlash(s))
}

// extractCascadeWorkspaceHint extrait un indice de chemin de workspace pour une session IDE.
func extractCascadeWorkspaceHint(cascadeID string) string {
	if cascadeID == "" {
		return ""
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}

	// 1. Recherche dans la base SQLite de la conversation (source la plus fiable)
	dbPath := filepath.Join(home, ".gemini", "antigravity-ide", "conversations", cascadeID+".db")
	if data, err := os.ReadFile(dbPath); err == nil {
		limit := len(data)
		if limit > 65536 {
			limit = 65536
		}
		str := string(data[:limit])
		if idx := strings.Index(str, "file:///"); idx != -1 {
			sub := str[idx:]
			for i, r := range sub {
				if r < 32 || r > 126 || r == '"' || r == '\'' {
					sub = sub[:i]
					break
				}
			}
			return DecodeURI(sub)
		}
	}

	// 2. Lire les premières lignes du transcript
	transcriptPath := filepath.Join(home, ".gemini", "antigravity-ide", "brain", cascadeID, ".system_generated", "logs", "transcript.jsonl")
	if f, err := os.Open(transcriptPath); err == nil {
		defer f.Close()
		scanner := bufio.NewScanner(f)
		buf := make([]byte, 64*1024)
		scanner.Buffer(buf, 256*1024)
		linesRead := 0
		for scanner.Scan() && linesRead < 5 {
			line := scanner.Text()
			linesRead++
			if idx := strings.Index(line, "Active Document:"); idx != -1 {
				sub := line[idx+len("Active Document:"):]
				if end := strings.IndexAny(sub, "(\r\n"); end != -1 {
					sub = sub[:end]
				}
				sub = strings.TrimSpace(sub)
				sub = strings.ReplaceAll(sub, `\\`, `/`)
				sub = strings.ReplaceAll(sub, `\`, `/`)
				for strings.Contains(sub, "//") {
					sub = strings.ReplaceAll(sub, "//", "/")
				}
				if sub != "" {
					return filepath.Dir(sub)
				}
			}
			if idx := strings.Index(line, "file:///"); idx != -1 {
				sub := line[idx:]
				if end := strings.IndexAny(sub, `"\r\n `); end != -1 {
					sub = sub[:end]
				}
				return DecodeURI(sub)
			}
		}
	}

	return ""
}

func cleanPathAlphaNum(s string) string {
	s = strings.ToLower(s)
	s = strings.ReplaceAll(s, "file:///", "")
	s = strings.ReplaceAll(s, "file://", "")
	s = strings.ReplaceAll(s, "file_", "")
	s = strings.ReplaceAll(s, "_20", "")
	s = strings.ReplaceAll(s, "%20", "")
	s = strings.ReplaceAll(s, "_3a", "")
	s = strings.ReplaceAll(s, "%3a", "")
	var sb strings.Builder
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			sb.WriteRune(r)
		}
	}
	return sb.String()
}

// FindInstanceForCascade recherche l'instance IDE correspondant à une cascade donnée.
func FindInstanceForCascade(cascadeID string) (*Instance, error) {
	instances, err := DiscoverInstances()
	if err != nil {
		return nil, err
	}
	if len(instances) == 0 {
		return nil, fmt.Errorf("aucune instance active d'Antigravity IDE trouvée")
	}

	var valid []Instance
	for _, inst := range instances {
		if inst.Port > 0 && inst.CSRFToken != "" {
			valid = append(valid, inst)
		}
	}
	if len(valid) == 0 {
		return nil, fmt.Errorf("aucune instance active avec port gRPC valide")
	}

	if len(valid) == 1 {
		return &valid[0], nil
	}

	hint := extractCascadeWorkspaceHint(cascadeID)
	if hint != "" {
		cleanHint := cleanPathAlphaNum(hint)
		if cleanHint != "" {
			for _, inst := range valid {
				if inst.WorkspaceID != "" {
					cleanInst := cleanPathAlphaNum(inst.WorkspaceID)
					if cleanInst != "" {
						if cleanHint == cleanInst || strings.HasPrefix(cleanHint, cleanInst) || strings.HasPrefix(cleanInst, cleanHint) {
							return &inst, nil
						}
					}
				}
			}
		}

		normHint := strings.ToLower(filepath.ToSlash(strings.TrimPrefix(hint, "file:///")))
		normHint = strings.TrimRight(normHint, "/")

		// Correspondance standard sur le chemin décodé du workspace
		for _, inst := range valid {
			if inst.WorkspaceID != "" {
				wsDecoded := decodeVSCodeWorkspaceID(inst.WorkspaceID)
				wsDecoded = strings.TrimRight(wsDecoded, "/")
				if wsDecoded != "" {
					if normHint == wsDecoded || strings.HasPrefix(normHint, wsDecoded+"/") || strings.HasPrefix(wsDecoded, normHint+"/") {
						return &inst, nil
					}
					baseHint := filepath.Base(normHint)
					baseWS := filepath.Base(wsDecoded)
					if len(baseHint) >= 3 && len(baseWS) >= 3 && baseHint == baseWS {
						return &inst, nil
					}
				}
			}
		}
	}

	// Préférence pour les instances ayant un WorkspaceID (fenêtres d'édition réelles)
	for _, inst := range valid {
		if inst.WorkspaceID != "" {
			return &inst, nil
		}
	}

	return &valid[0], nil
}

var (
	cachedClientsMu sync.RWMutex
	cachedClients   = make(map[string]*cachedClientEntry)
)

type cachedClientEntry struct {
	client    *connectrpc.Client
	expiresAt time.Time
}

// FindClientForCascade retourne un client ConnectRPC connecté à l'instance IDE gérant la cascade.
func FindClientForCascade(cascadeID string) (*connectrpc.Client, error) {
	cachedClientsMu.RLock()
	if entry, ok := cachedClients[cascadeID]; ok && time.Now().Before(entry.expiresAt) {
		cachedClientsMu.RUnlock()
		return entry.client, nil
	}
	cachedClientsMu.RUnlock()

	inst, err := FindInstanceForCascade(cascadeID)
	if err != nil {
		return nil, err
	}

	client := connectrpc.NewClient(inst.Port, inst.CSRFToken)
	client.UseTLS = false
	client.HTTP.Timeout = 120 * time.Second

	cachedClientsMu.Lock()
	cachedClients[cascadeID] = &cachedClientEntry{
		client:    client,
		expiresAt: time.Now().Add(60 * time.Second),
	}
	cachedClientsMu.Unlock()

	return client, nil
}

// InvalidateClientForCascade invalide le cache client pour une cascade donnée.
func InvalidateClientForCascade(cascadeID string) {
	cachedClientsMu.Lock()
	delete(cachedClients, cascadeID)
	cachedClientsMu.Unlock()
}

