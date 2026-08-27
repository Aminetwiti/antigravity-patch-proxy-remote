# scripts/register-auto-heal.ps1
# Enregistre l'auto-healer dans le dossier Startup Windows.
# Génère un VBS (invisible) qui lance scripts/auto-heal.ps1 à chaque ouverture
# de session — même mécanique que Antigravity-Chinese/install.ps1 (lignes 106-127).
#
# Usage :
#   powershell -NoProfile -ExecutionPolicy Bypass -File register-auto-heal.ps1

$ErrorActionPreference = "Stop"

$scriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Definition
$healScript = Join-Path $scriptDir "auto-heal.ps1"
$startupDir = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup"
$vbsPath    = Join-Path $startupDir "AntigravityPatchAutoHealer.vbs"

if (-not (Test-Path $healScript)) {
    Write-Error "auto-heal.ps1 introuvable: $healScript"
    exit 1
}

$vbsContent = @"
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File " & Chr(34) & "$healScript" & Chr(34), 0, False
"@
[System.IO.File]::WriteAllText($vbsPath, $vbsContent, [System.Text.Encoding]::ASCII)

$watchdogScript = Join-Path $scriptDir "supervise-proxy.ps1"
if (Test-Path $watchdogScript) {
    $watchdogVbs = Join-Path $startupDir "AntigravityProxyWatchdog.vbs"
    $watchdogVbsContent = @"
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File " & Chr(34) & "$watchdogScript" & Chr(34) & " -Loop", 0, False
"@
    [System.IO.File]::WriteAllText($watchdogVbs, $watchdogVbsContent, [System.Text.Encoding]::ASCII)
    Write-Host "Proxy watchdog enregistré: $watchdogVbs" -ForegroundColor Green
}

Write-Host "Auto-healer enregistré: $vbsPath" -ForegroundColor Green
Write-Host "  -> scripts/auto-heal.ps1 & supervise-proxy.ps1 seront lancés à chaque ouverture de session."

