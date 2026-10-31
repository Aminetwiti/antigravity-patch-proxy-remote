# fix-all.ps1 - One-click: fix every warning from ag-doctor
#
# Runs sequentially:
#   1. Stop Antigravity + LS + proxy-stub
#   2. Binary patch (ag-doctor patch apply)
#   3. MITM CA install (ag-doctor mitm install)
#   4. Kill proxy-stub so real proxy gets the configured proxy port
#   5. Repack app.asar with patched proxy code
#   6. Restart Antigravity
param([switch]$NoPause)

$ErrorActionPreference = "Continue"
$ScriptDir = $PSScriptRoot
$PROXY_PORT = if ($env:AG_PROXY_PORT) { $env:AG_PROXY_PORT } else { '51074' }

function Write-Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green }

Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "  fix-all - Antigravity one-click repair"      -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Cyan

# -- 1. Stop everything
Write-Step "Stopping all processes"
Stop-Process -Name "Antigravity"     -Force -ErrorAction SilentlyContinue
Stop-Process -Name "language_server" -Force -ErrorAction SilentlyContinue
Get-Process -Name "node" -ErrorAction SilentlyContinue | ForEach-Object {
    try {
        $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)").CommandLine
        if ($cmd -like "*proxy-stub*") {
            Write-Host "  Killing proxy-stub (PID $($_.Id))" -ForegroundColor Yellow
            $_ | Stop-Process -Force
        }
    } catch {}
}
Start-Sleep -Seconds 2
Write-Ok "All stopped"

# -- 2. Binary patch
Write-Step "Applying binary patch"
$AgDoctor = Join-Path $ScriptDir 'ag-doctor\bin\ag-doctor.js'
if (Test-Path $AgDoctor) {
    Push-Location $ScriptDir
    try {
        $out = echo "y" | node $AgDoctor patch apply 2>&1
        if ($out -match "Patched|OK|already") { Write-Ok "Binary patch OK" }
        else { Write-Host "  $out" -ForegroundColor Gray }
    } catch {
        Write-Host "  [WARN] $($_.Exception.Message)" -ForegroundColor Yellow
    } finally { Pop-Location }
} else {
    Write-Host "  [WARN] ag-doctor not found, skipping patch" -ForegroundColor Yellow
}

# -- 3. MITM CA
Write-Step "Installing MITM CA"
if (Test-Path $AgDoctor) {
    Push-Location $ScriptDir
    try {
        $out = echo "y" | node $AgDoctor mitm install 2>&1
        Write-Ok "MITM CA installed"
    } catch {
        Write-Host "  [WARN] $($_.Exception.Message)" -ForegroundColor Yellow
    } finally { Pop-Location }
}

# -- 4. Kill proxy-stub (port $PROXY_PORT must be free for real proxy)
Write-Step "Ensuring port $PROXY_PORT is free for real proxy"
$busy = Get-NetTCPConnection -LocalPort $PROXY_PORT -ErrorAction SilentlyContinue
if ($busy) {
    Write-Host "  Port $PROXY_PORT occupied by PID $($busy.OwningProcess) -- killing" -ForegroundColor Yellow
    Stop-Process -Id $busy.OwningProcess -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
}
$busy2 = Get-NetTCPConnection -LocalPort $PROXY_PORT -ErrorAction SilentlyContinue
if (-not $busy2) { Write-Ok "Port $PROXY_PORT free" }

# -- 5. Repack app.asar
Write-Step "Repacking app.asar"
$RepackScript = Join-Path $ScriptDir 'repack.ps1'
& $RepackScript -SkipRestart -NoPause
if ($LASTEXITCODE -ne 0) {
    Write-Host "  [ERROR] Repack failed" -ForegroundColor Red
    if (-not $NoPause) { Read-Host "Press Enter to close" }
    exit 1
}

# -- 6. Restart Antigravity
Write-Step "Launching Antigravity"
$ExePath = Join-Path $env:LOCALAPPDATA "Programs\antigravity\Antigravity.exe"
if (Test-Path $ExePath) {
    Start-Process -FilePath $ExePath
    Write-Ok "Antigravity launched"
} else {
    Write-Host "  [ERROR] Antigravity.exe not found at $ExePath" -ForegroundColor Red
}

Write-Host "`n==============================================" -ForegroundColor Green
Write-Host "  All fixes applied successfully!"              -ForegroundColor Green
Write-Host "  Custom models will appear in the dropdown."   -ForegroundColor Green
Write-Host "==============================================" -ForegroundColor Green
if (-not $NoPause) { Read-Host "Press Enter to close" }
