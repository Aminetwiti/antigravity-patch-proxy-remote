#Requires -RunAsAdministrator
<#
  Diagnostic script for Antigravity not starting.
  Collects file info, logs, Event Viewer entries, and tries to start with logging.
#>

$InstallDir = "$env:LOCALAPPDATA\Programs\antigravity"
$Report = @()

function Add-Report($line) {
    $script:Report += $line
    Write-Host $line
}

Add-Report "=============================================="
Add-Report "Antigravity Startup Diagnostics"
Add-Report "=============================================="

# 1. Check installation directory
Add-Report ""
Add-Report "[1] Installation directory: $InstallDir"
if (Test-Path $InstallDir) {
    Get-ChildItem $InstallDir | ForEach-Object { Add-Report "  $($_.Name) - $([math]::Round($_.Length / 1MB, 2)) MB" }
} else {
    Add-Report "  ERROR: Installation directory not found!"
}

# 2. Check resources
Add-Report ""
Add-Report "[2] Resources directory"
$ResourcesDir = Join-Path $InstallDir "resources"
if (Test-Path $ResourcesDir) {
    Get-ChildItem $ResourcesDir | ForEach-Object { Add-Report "  $($_.Name) - $([math]::Round($_.Length / 1MB, 2)) MB" }
} else {
    Add-Report "  ERROR: resources directory not found!"
}

# 3. Check binaries
Add-Report ""
Add-Report "[3] Binary files"
$AntigravityExe = Join-Path $InstallDir "Antigravity.exe"
$LsBinary = Join-Path $InstallDir "resources\bin\language_server.exe"
$LsBackup = "$LsBinary.bak"

foreach ($f in @($AntigravityExe, $LsBinary, $LsBackup)) {
    if (Test-Path $f) {
        $size = (Get-Item $f).Length
        Add-Report "  OK $f - $size bytes"
    } else {
        Add-Report "  MISSING $f"
    }
}

# 4. Check asar integrity
Add-Report ""
Add-Report "[4] app.asar integrity"
$AsarPath = Join-Path $InstallDir "resources\app.asar"
$BackupAsar = "$AsarPath.backup"
try {
    $list = npx -y @electron/asar list $AsarPath 2>$null
    if ($LASTEXITCODE -eq 0) {
        Add-Report "  OK app.asar contains $($list.Count) entries"
        Add-Report "  First entries: $($list | Select-Object -First 5)"
    } else {
        Add-Report "  ERROR app.asar is corrupted"
    }
} catch {
    Add-Report "  ERROR checking app.asar: $_"
}

if (Test-Path $BackupAsar) {
    $backupSize = (Get-Item $BackupAsar).Length
    $asarSize = if (Test-Path $AsarPath) { (Get-Item $AsarPath).Length } else { 0 }
    Add-Report "  Backup size: $backupSize bytes"
    Add-Report "  Current size: $asarSize bytes"
}

# 5. Check if language_server binary contains patch
Add-Report ""
Add-Report "[5] Language server binary patch status"
if (Test-Path $LsBinary) {
    $content = [System.IO.File]::ReadAllText($LsBinary, [System.Text.Encoding]::ASCII)
    $originalUrl = "https://daily-cloudcode-pa.googleapis.com"
    $proxyPort = if ($env:AG_PROXY_PORT) { $env:AG_PROXY_PORT } else { '51074' }
    $patchedUrl = "http://localhost:${proxyPort}/v1internal/xxxxxxx"
    if ($content.Contains($patchedUrl)) {
        Add-Report "  Binary is patched with $patchedUrl"
    } elseif ($content.Contains($originalUrl)) {
        Add-Report "  Binary is NOT patched (contains original URL)"
    } else {
        Add-Report "  WARNING: Neither original nor patched URL found in binary"
    }
} else {
    Add-Report "  Cannot check - binary missing"
}

# 6. Run Antigravity with logging
Add-Report ""
Add-Report "[6] Starting Antigravity with logging (10 seconds)"
Stop-Process -Name "Antigravity" -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

$LogFile = "$env:TEMP\antigravity_startup_log.txt"
$env:ELECTRON_ENABLE_LOGGING = "1"
$env:ELECTRON_ENABLE_STACK_DUMPING = "1"

$proc = Start-Process -FilePath $AntigravityExe -ArgumentList "--enable-logging --v=1" -RedirectStandardOutput $LogFile -RedirectStandardError "$env:TEMP\antigravity_startup_err.txt" -PassThru
Start-Sleep -Seconds 10

if ($proc.HasExited) {
    Add-Report "  Antigravity exited after $($proc.ExitTime - $proc.StartTime) seconds with code $($proc.ExitCode)"
} else {
    Add-Report "  Antigravity process is still running (PID $($proc.Id))"
    $proc | Stop-Process -Force -ErrorAction SilentlyContinue
}

if (Test-Path $LogFile) {
    $logContent = Get-Content $LogFile -Raw
    Add-Report "  STDOUT log:"
    Add-Report $logContent
} else {
    Add-Report "  No STDOUT log generated"
}

if (Test-Path "$env:TEMP\antigravity_startup_err.txt") {
    $errContent = Get-Content "$env:TEMP\antigravity_startup_err.txt" -Raw
    Add-Report "  STDERR log:"
    Add-Report $errContent
}

# 7. Event Viewer - last Antigravity errors
Add-Report ""
Add-Report "[7] Recent Application event log entries for Antigravity"
$events = Get-WinEvent -FilterHashtable @{LogName='Application'; ProviderName='Application Error'} -MaxEvents 20 -ErrorAction SilentlyContinue | Where-Object { $_.Message -like "*Antigravity*" -or $_.Message -like "*language_server*" }
if ($events) {
    $events | Select-Object -First 5 | ForEach-Object { Add-Report "  $($_.TimeCreated) - $($_.LevelDisplayName): $($_.Message.Substring(0,[Math]::Min(200,$_.Message.Length)))" }
} else {
    Add-Report "  No recent Antigravity errors found in Event Viewer"
}

# 8. Save report
Add-Report ""
$ReportPath = "$env:USERPROFILE\Desktop\antigravity_diagnosis.txt"
$Report | Out-File $ReportPath -Encoding utf8
Add-Report "Report saved to: $ReportPath"
Add-Report "Please attach this file or copy its contents."
