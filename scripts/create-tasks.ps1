# scripts/create-tasks.ps1
# Script de creation des taches planifiees Windows pour Antigravity

$action1 = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -Command ipconfig /flushdns; ipconfig /renew"
$trigger1 = New-ScheduledTaskTrigger -AtLogOn
$settings1 = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName "Antigravity-FlushDNS" -Action $action1 -Trigger $trigger1 -Settings $settings1 -Description "Flush DNS au demarrage pour Antigravity" -Force

$action2 = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -File $PSScriptRoot\cleanup-logs.ps1"
$trigger2 = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At "08:00"
Register-ScheduledTask -TaskName "Antigravity-CleanupLogs" -Action $action2 -Trigger $trigger2 -Description "Nettoyage hebdomadaire des logs Antigravity" -Force

Write-Host "✅ Taches planifiees crees avec succes sous Windows !"
