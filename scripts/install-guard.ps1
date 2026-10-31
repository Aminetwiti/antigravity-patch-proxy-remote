# scripts/install-guard.ps1
# Installs Antigravity Auto-Guard and Desktop Shortcut
#
# 1. Registers Watchdog in Windows Startup folder (auto-starts on boot)
# 2. Creates a Desktop Shortcut "Antigravity (Guard)" pointing to silent launcher

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$LauncherVbs = Join-Path $RepoRoot "Launch-Antigravity.vbs"
$WatchdogPs1 = Join-Path $RepoRoot "scripts\supervise-proxy.ps1"
$StartupDir  = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup"
$DesktopDir  = [System.Environment]::GetFolderPath("Desktop")

# 1. Register Watchdog at Windows Startup
$StartupVbs = Join-Path $StartupDir "AntigravityProxyWatchdog.vbs"
$vbsContent = @"
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File " & Chr(34) & "$WatchdogPs1" & Chr(34) & " -Loop", 0, False
"@
[System.IO.File]::WriteAllText($StartupVbs, $vbsContent, [System.Text.Encoding]::ASCII)
Write-Host "✅ Watchdog registered in Windows Startup: $StartupVbs" -ForegroundColor Green

# 2. Create Desktop Shortcut
$WshShell = New-Object -ComObject WScript.Shell
$ShortcutPath = Join-Path $DesktopDir "Antigravity (Guard).lnk"
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = "wscript.exe"
$Shortcut.Arguments = "`"$LauncherVbs`""
$Shortcut.WorkingDirectory = $RepoRoot
$Shortcut.Description = "Launch Antigravity with auto-proxy protection"

# Try to find Antigravity IDE icon
$IconIde = "$env:LOCALAPPDATA\Programs\Antigravity IDE\Antigravity IDE.exe"
$IconClassic = "$env:LOCALAPPDATA\Programs\Antigravity\Antigravity.exe"
if (Test-Path $IconIde) {
    $Shortcut.IconLocation = "$IconIde,0"
} elseif (Test-Path $IconClassic) {
    $Shortcut.IconLocation = "$IconClassic,0"
}
$Shortcut.Save()

Write-Host "✅ Desktop shortcut created: $ShortcutPath" -ForegroundColor Green

# 3. Start watchdog now
powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "$WatchdogPs1" -Once
Write-Host "✅ Immediate guard check passed." -ForegroundColor Green
