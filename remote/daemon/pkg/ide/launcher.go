package ide

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
	"syscall"
	"time"
)

var (
	ErrExecutableNotFound = errors.New("exécutable Antigravity introuvable sur le système")
)

// Launcher gère la détection, le lancement et l'arrêt d'Antigravity IDE.
type Launcher struct {
	mu             sync.Mutex
	customPath     string
	lastProcessCmd *exec.Cmd
}

// NewLauncher crée une nouvelle instance de Launcher.
func NewLauncher(customPath ...string) *Launcher {
	path := ""
	if len(customPath) > 0 {
		path = customPath[0]
	}
	return &Launcher{
		customPath: path,
	}
}

// FindExecutable localise le binaire Antigravity sur Windows, Linux ou macOS.
func (l *Launcher) FindExecutable() (string, error) {
	l.mu.Lock()
	defer l.mu.Unlock()

	// 1. Chemin personnalisé
	if l.customPath != "" {
		if _, err := os.Stat(l.customPath); err == nil {
			return l.customPath, nil
		}
	}

	// 2. Variable d'environnement AG_IDE_PATH
	if envPath := os.Getenv("AG_IDE_PATH"); envPath != "" {
		if _, err := os.Stat(envPath); err == nil {
			return envPath, nil
		}
	}

	// 3. Emplacements standards selon l'OS
	switch runtime.GOOS {
	case "windows":
		localAppData := os.Getenv("LOCALAPPDATA")
		if localAppData != "" {
			candidates := []string{
				filepath.Join(localAppData, "Programs", "Antigravity", "Antigravity.exe"),
				filepath.Join(localAppData, "Programs", "Antigravity IDE", "Antigravity.exe"),
				filepath.Join(localAppData, "Programs", "antigravity", "Antigravity.exe"),
			}
			for _, c := range candidates {
				if _, err := os.Stat(c); err == nil {
					return c, nil
				}
			}
		}
		programFiles := os.Getenv("ProgramFiles")
		if programFiles != "" {
			c := filepath.Join(programFiles, "Antigravity", "Antigravity.exe")
			if _, err := os.Stat(c); err == nil {
				return c, nil
			}
		}
		if path, err := exec.LookPath("Antigravity.exe"); err == nil {
			return path, nil
		}
		if path, err := exec.LookPath("Antigravity"); err == nil {
			return path, nil
		}

	case "darwin":
		candidates := []string{
			"/Applications/Antigravity.app/Contents/MacOS/Antigravity",
			filepath.Join(os.Getenv("HOME"), "Applications/Antigravity.app/Contents/MacOS/Antigravity"),
		}
		for _, c := range candidates {
			if _, err := os.Stat(c); err == nil {
				return c, nil
			}
		}
		if path, err := exec.LookPath("antigravity"); err == nil {
			return path, nil
		}

	default: // Linux et autres unix
		candidates := []string{
			"/usr/bin/antigravity",
			"/usr/local/bin/antigravity",
			"/opt/antigravity/antigravity",
			filepath.Join(os.Getenv("HOME"), ".local/bin/antigravity"),
		}
		for _, c := range candidates {
			if _, err := os.Stat(c); err == nil {
				return c, nil
			}
		}
		if path, err := exec.LookPath("antigravity"); err == nil {
			return path, nil
		}
	}

	return "", ErrExecutableNotFound
}

// Launch démarre Antigravity en arrière-plan détaché.
func (l *Launcher) Launch(args ...string) (*exec.Cmd, error) {
	exePath, err := l.FindExecutable()
	if err != nil {
		return nil, err
	}

	cmd := exec.Command(exePath, args...)

	setDetachedProcAttr(cmd)

	cmd.Stdout = nil
	cmd.Stderr = nil

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("échec du lancement d'Antigravity (%s) : %w", exePath, err)
	}

	l.mu.Lock()
	l.lastProcessCmd = cmd
	l.mu.Unlock()

	return cmd, nil
}

// KillAll termine tous les processus Antigravity et Language Server.
func (l *Launcher) KillAll() error {
	switch runtime.GOOS {
	case "windows":
		cmd := exec.Command("taskkill", "/F", "/T", "/IM", "language_server.exe", "/IM", "language_server_windows_x64.exe", "/IM", "Antigravity.exe")
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
		_ = cmd.Run()
		return nil
	default:
		cmd := exec.Command("pkill", "-9", "-f", "language_server")
		_ = cmd.Run()
		cmd2 := exec.Command("pkill", "-9", "-f", "antigravity")
		_ = cmd2.Run()
		return nil
	}
}

// Restart tue les processus existants puis relance Antigravity.
func (l *Launcher) Restart(args ...string) (*exec.Cmd, error) {
	_ = l.KillAll()
	time.Sleep(1 * time.Second)
	return l.Launch(args...)
}

// OpenFile ouvre un fichier dans la fenêtre active d'Antigravity IDE.
func (l *Launcher) OpenFile(filePath string, line, column int) error {
	exePath, err := l.FindExecutable()
	if err != nil {
		return err
	}
	target := filePath
	if line > 0 {
		if column > 0 {
			target = fmt.Sprintf("%s:%d:%d", filePath, line, column)
		} else {
			target = fmt.Sprintf("%s:%d", filePath, line)
		}
	}
	cmd := exec.Command(exePath, "--reuse-window", "-g", target)
	setDetachedProcAttr(cmd)
	return cmd.Start()
}

