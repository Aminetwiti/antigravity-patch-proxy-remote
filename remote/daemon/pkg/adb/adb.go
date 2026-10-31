package adb

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

// DeviceInfo décrit un appareil Android connecté via ADB.
type DeviceInfo struct {
	ID          string `json:"id"`
	State       string `json:"state"` // "device", "offline", "unauthorized"
	Model       string `json:"model,omitempty"`
	Product     string `json:"product,omitempty"`
	Device      string `json:"device,omitempty"`
	TransportID string `json:"transportId,omitempty"`
}

// FileEntry décrit un fichier ou dossier sur l'appareil distant.
type FileEntry struct {
	Name        string `json:"name"`
	Path        string `json:"path"`
	IsDir       bool   `json:"isDir"`
	Size        int64  `json:"size"`
	Permissions string `json:"permissions,omitempty"`
	ModifiedAt  string `json:"modifiedAt,omitempty"`
}

// Runner interface permet d'abstraire l'exécution ADB pour les tests unitaires.
type Runner interface {
	Run(ctx context.Context, args ...string) ([]byte, error)
}

// ExecRunner exécute les commandes adb système avec confinement strict (jamais de shell=true).
type ExecRunner struct {
	AdbPath string
}

func (e *ExecRunner) Run(ctx context.Context, args ...string) ([]byte, error) {
	adbBin := e.AdbPath
	if adbBin == "" {
		adbBin = "adb"
	}
	cmd := exec.CommandContext(ctx, adbBin, args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		errText := strings.TrimSpace(stderr.String())
		if errText != "" {
			return nil, fmt.Errorf("%w: %s", err, errText)
		}
		return nil, err
	}
	return stdout.Bytes(), nil
}

// Service gère les opérations ADB confinées.
type Service struct {
	runner Runner
}

// NewService crée une nouvelle instance de Service.
func NewService(runner Runner) *Service {
	if runner == nil {
		runner = &ExecRunner{}
	}
	return &Service{runner: runner}
}

// sanitizePath valide et nettoie un chemin distant Android pour éviter toute injection ou traversée.
func sanitizePath(p string) (string, error) {
	clean := strings.TrimSpace(p)
	if clean == "" {
		return "", errors.New("chemin distant vide")
	}
	// Interdit les caractères d'injection shell
	for _, char := range []string{";", "&", "|", "`", "$", "(", ")", "<", ">", "\n", "\r", "\"", "'"} {
		if strings.Contains(clean, char) {
			return "", fmt.Errorf("caractère interdit dans le chemin: %q", char)
		}
	}
	clean = strings.ReplaceAll(clean, `\`, "/")
	clean = filepath.ToSlash(filepath.Clean(clean))
	if !strings.HasPrefix(clean, "/") && !strings.HasPrefix(clean, "sdcard") && !strings.HasPrefix(clean, "storage") {
		clean = "/" + clean
	}
	return clean, nil
}

// ListDevices liste les appareils Android connectés et leur état.
func (s *Service) ListDevices(ctx context.Context) ([]DeviceInfo, error) {
	out, err := s.runner.Run(ctx, "devices", "-l")
	if err != nil {
		return nil, err
	}
	return ParseDevicesOutput(out), nil
}

// ParseDevicesOutput parse la sortie de 'adb devices -l'.
func ParseDevicesOutput(out []byte) []DeviceInfo {
	lines := strings.Split(string(out), "\n")
	var devices []DeviceInfo
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "List of devices") || strings.HasPrefix(line, "*") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		dev := DeviceInfo{
			ID:    fields[0],
			State: fields[1],
		}
		for _, f := range fields[2:] {
			if strings.HasPrefix(f, "model:") {
				dev.Model = strings.TrimPrefix(f, "model:")
			} else if strings.HasPrefix(f, "product:") {
				dev.Product = strings.TrimPrefix(f, "product:")
			} else if strings.HasPrefix(f, "device:") {
				dev.Device = strings.TrimPrefix(f, "device:")
			} else if strings.HasPrefix(f, "transport_id:") {
				dev.TransportID = strings.TrimPrefix(f, "transport_id:")
			}
		}
		devices = append(devices, dev)
	}
	return devices
}

var validDeviceIDRe = regexp.MustCompile(`^[a-zA-Z0-9_.:-]+$`)

func validateDeviceID(deviceID string) error {
	if deviceID == "" {
		return nil
	}
	if !validDeviceIDRe.MatchString(deviceID) {
		return fmt.Errorf("identifiant d'appareil invalide: %q", deviceID)
	}
	return nil
}

// ListDirectory liste les fichiers d'un dossier distant sur l'appareil.
func (s *Service) ListDirectory(ctx context.Context, deviceID, remotePath string) ([]FileEntry, error) {
	if err := validateDeviceID(deviceID); err != nil {
		return nil, err
	}
	cleanPath, err := sanitizePath(remotePath)
	if err != nil {
		return nil, err
	}
	args := []string{}
	if deviceID != "" {
		args = append(args, "-s", deviceID)
	}
	args = append(args, "shell", "ls", "-la", cleanPath)
	out, err := s.runner.Run(ctx, args...)
	if err != nil {
		return nil, err
	}
	return ParseLsOutput(cleanPath, out), nil
}

// ParseLsOutput parse la sortie de 'ls -la' sur Android.
func ParseLsOutput(parentPath string, out []byte) []FileEntry {
	lines := strings.Split(string(out), "\n")
	var entries []FileEntry
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "total ") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 6 {
			continue
		}
		perms := fields[0]
		isDir := strings.HasPrefix(perms, "d")
		var size int64
		var nameIdx int

		if len(fields) >= 7 {
			if s, err := strconv.ParseInt(fields[4], 10, 64); err == nil {
				size = s
				nameIdx = 7
				if nameIdx > len(fields) {
					nameIdx = 6
				}
			} else if s, err := strconv.ParseInt(fields[3], 10, 64); err == nil {
				size = s
				nameIdx = 6
			}
		}
		if nameIdx == 0 || nameIdx >= len(fields) {
			nameIdx = len(fields) - 1
		}
		name := strings.Join(fields[nameIdx:], " ")
		if name == "." || name == ".." {
			continue
		}
		if arrow := strings.Index(name, " -> "); arrow != -1 {
			name = name[:arrow]
		}
		fullPath := filepath.ToSlash(filepath.Join(parentPath, name))
		entries = append(entries, FileEntry{
			Name:        name,
			Path:        fullPath,
			IsDir:       isDir,
			Size:        size,
			Permissions: perms,
		})
	}
	return entries
}

// SearchFiles recherche récursivement des fichiers sur l'appareil.
func (s *Service) SearchFiles(ctx context.Context, deviceID, remotePath, pattern string, maxDepth int) ([]string, error) {
	if err := validateDeviceID(deviceID); err != nil {
		return nil, err
	}
	cleanPath, err := sanitizePath(remotePath)
	if err != nil {
		return nil, err
	}
	if maxDepth <= 0 {
		maxDepth = 3
	}
	if maxDepth > 5 {
		maxDepth = 5
	}
	cleanPattern := strings.TrimSpace(pattern)
	for _, char := range []string{";", "&", "|", "`", "$", "(", ")", "<", ">", "\"", "'"} {
		if strings.Contains(cleanPattern, char) {
			return nil, fmt.Errorf("caractère interdit dans le motif de recherche: %q", char)
		}
	}
	if cleanPattern == "" {
		cleanPattern = "*"
	}

	args := []string{}
	if deviceID != "" {
		args = append(args, "-s", deviceID)
	}
	args = append(args, "shell", "find", cleanPath, "-maxdepth", strconv.Itoa(maxDepth), "-iname", cleanPattern)
	out, err := s.runner.Run(ctx, args...)
	if err != nil {
		return nil, err
	}
	lines := strings.Split(string(out), "\n")
	var results []string
	for _, l := range lines {
		l = strings.TrimSpace(l)
		if l != "" && !strings.Contains(l, "Permission denied") {
			results = append(results, l)
		}
	}
	return results, nil
}

// PullFile transfère un fichier depuis l'appareil Android vers le poste hôte local.
func (s *Service) PullFile(ctx context.Context, deviceID, remotePath, localDestPath string) error {
	if err := validateDeviceID(deviceID); err != nil {
		return err
	}
	cleanRemote, err := sanitizePath(remotePath)
	if err != nil {
		return err
	}
	cleanLocal := filepath.Clean(localDestPath)
	args := []string{}
	if deviceID != "" {
		args = append(args, "-s", deviceID)
	}
	args = append(args, "pull", cleanRemote, cleanLocal)
	_, err = s.runner.Run(ctx, args...)
	return err
}

// PushFile transfère un fichier depuis le poste hôte vers l'appareil Android.
func (s *Service) PushFile(ctx context.Context, deviceID, localSrcPath, remoteDestPath string) error {
	if err := validateDeviceID(deviceID); err != nil {
		return err
	}
	cleanRemote, err := sanitizePath(remoteDestPath)
	if err != nil {
		return err
	}
	cleanLocal := filepath.Clean(localSrcPath)
	args := []string{}
	if deviceID != "" {
		args = append(args, "-s", deviceID)
	}
	args = append(args, "push", cleanLocal, cleanRemote)
	_, err = s.runner.Run(ctx, args...)
	return err
}
