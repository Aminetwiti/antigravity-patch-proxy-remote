package gateway

import (
	"bytes"
	"fmt"
	"os/exec"
	"runtime"
	"strings"
	"syscall"
)

// SetClipboardText écrit du texte dans le presse-papier du système hôte.
func SetClipboardText(text string) error {
	switch runtime.GOOS {
	case "windows":
		cmd := exec.Command("clip")
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
		cmd.Stdin = strings.NewReader(text)
		return cmd.Run()
	case "darwin":
		cmd := exec.Command("pbcopy")
		cmd.Stdin = strings.NewReader(text)
		return cmd.Run()
	default: // linux / unix
		if path, err := exec.LookPath("wl-copy"); err == nil {
			cmd := exec.Command(path)
			cmd.Stdin = strings.NewReader(text)
			return cmd.Run()
		}
		if path, err := exec.LookPath("xclip"); err == nil {
			cmd := exec.Command(path, "-selection", "clipboard")
			cmd.Stdin = strings.NewReader(text)
			return cmd.Run()
		}
		return fmt.Errorf("aucun utilitaire de presse-papier disponible (xclip/wl-copy)")
	}
}

// GetClipboardText lit le texte actuel du presse-papier du système hôte.
func GetClipboardText() (string, error) {
	switch runtime.GOOS {
	case "windows":
		cmd := exec.Command("powershell", "-NoProfile", "-Command", "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Clipboard")
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
		var out bytes.Buffer
		cmd.Stdout = &out
		if err := cmd.Run(); err != nil {
			return "", err
		}
		return strings.TrimRight(out.String(), "\r\n"), nil
	case "darwin":
		cmd := exec.Command("pbpaste")
		var out bytes.Buffer
		cmd.Stdout = &out
		if err := cmd.Run(); err != nil {
			return "", err
		}
		return out.String(), nil
	default: // linux / unix
		if path, err := exec.LookPath("wl-paste"); err == nil {
			cmd := exec.Command(path)
			var out bytes.Buffer
			cmd.Stdout = &out
			if err := cmd.Run(); err == nil {
				return out.String(), nil
			}
		}
		if path, err := exec.LookPath("xclip"); err == nil {
			cmd := exec.Command(path, "-selection", "clipboard", "-o")
			var out bytes.Buffer
			cmd.Stdout = &out
			if err := cmd.Run(); err == nil {
				return out.String(), nil
			}
		}
		return "", fmt.Errorf("aucun utilitaire de presse-papier disponible (xclip/wl-paste)")
	}
}
