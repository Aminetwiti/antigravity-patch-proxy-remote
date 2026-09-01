package notification

import (
	"fmt"
	"os/exec"
	"runtime"
	"strings"
	"syscall"
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

func sendWindowsToast(title, message string) {
	// Échappement des guillemets pour PowerShell
	cleanTitle := strings.ReplaceAll(title, "'", "''")
	cleanMessage := strings.ReplaceAll(message, "'", "''")

	psScript := fmt.Sprintf(`
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
$template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$toastXml = [xml]$template.GetXml()
$textNodes = $toastXml.GetElementsByTagName("text")
$textNodes.Item(0).AppendChild($toastXml.CreateTextNode('%s')) > $null
$textNodes.Item(1).AppendChild($toastXml.CreateTextNode('%s')) > $null
$xmlDoc = New-Object Windows.Data.Xml.Dom.XmlDocument
$xmlDoc.LoadXml($toastXml.OuterXml)
$toast = [Windows.UI.Notifications.ToastNotification]::new($xmlDoc)
$notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Antigravity Remote')
$notifier.Show($toast)
`, cleanTitle, cleanMessage)

	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command", psScript)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	_ = cmd.Run()
}
