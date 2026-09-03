//go:build windows

package notification

import (
	"fmt"
	"os/exec"
	"strings"
	"syscall"
)

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
