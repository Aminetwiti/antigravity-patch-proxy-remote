package ide

import (
	"bytes"
	"fmt"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/antigravity/remote-daemon/pkg/connectrpc"
)

// DiscoverInstances recherche tous les processus language_server_windows_x64.exe actifs.
func DiscoverInstances() ([]Instance, error) {
	// Script PowerShell d'extraction rapide des processus et ports
	psScript := strings.Join([]string{
		`$results = @()`,
		`Get-CimInstance Win32_Process | Where-Object { $_.Name -like '*language_server_windows_x64*' } | ForEach-Object {`,
		`    $pid = $_.ProcessId`,
		`    $cmd = $_.CommandLine`,
		`    $csrf = ""`,
		`    if ($cmd -match '--csrf_token\s+([a-f0-9\-]+)') { $csrf = $matches[1] }`,
		`    $ws = ""`,
		`    if ($cmd -match '--workspace_id\s+([a-f0-9]+)') { $ws = $matches[1] }`,
		`    $appDir = "antigravity-ide"`,
		`    if ($cmd -match '--app_data_dir\s+([a-zA-Z0-9_\-]+)') { $appDir = $matches[1] }`,
		`    $ports = Get-NetTCPConnection -OwningProcess $pid -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalPort`,
		`    foreach ($p in $ports) {`,
		`        $results += "$pid;$p;$csrf;$ws;$appDir"`,
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
