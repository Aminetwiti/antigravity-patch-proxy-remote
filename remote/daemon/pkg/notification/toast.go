package notification

import (
	"fmt"
	"os/exec"
	"runtime"
)

// SendNotification envoie une notification Toast native sur le bureau de l'hôte (Windows/macOS/Linux).
func SendNotification(title, message string) {
	go func() {
		switch runtime.GOOS {
		case "windows":
			sendWindowsToast(title, message)
		case "darwin":
			script := fmt.Sprintf(`display notification %q with title %q`, message, title)
			cmd := exec.Command("osascript", "-e", script)
			_ = cmd.Run()
		default:
			cmd := exec.Command("notify-send", title, message)
			_ = cmd.Run()
		}
	}()
}
