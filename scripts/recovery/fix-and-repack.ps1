# fix-and-repack.ps1 - One-click fix: kill, patch, repack, restart
param(
    [switch]$SkipPatch,
    [switch]$SkipMitm,
    [switch]$NoPause
)

$ErrorActionPreference = "Continue"
$ScriptDir = $PSScriptRoot
$AgDoctor = Join-Path $ScriptDir 'ag-doctor\bin\ag-doctor.js'

function Write-Step($msg) { Write-Host "`n== $msg ==" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  [WARN] $msg" -ForegroundColor Yellow }

# -- 1. Stop everything
Write-Step "Stopping all Antigravity processes"
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
Write-Ok "All processes stopped"

# -- 2. Apply binary patch
if (-not $SkipPatch -and (Test-Path $AgDoctor)) {
    Write-Step "Applying binary patch"
    Push-Location $ScriptDir
    try {
        $result = echo "y" | node $AgDoctor patch apply 2>&1
        if ($result -match "OK|Patched") {
            Write-Ok "Binary patch applied"
        } else {
            Write-Warn "Patch: $result"
        }
    } catch {
        Write-Warn "Patch failed or already applied: $($_.Exception.Message)"
    } finally {
        Pop-Location
    }
}

# -- 3. Install MITM CA
if (-not $SkipMitm -and (Test-Path $AgDoctor)) {
    Write-Step "Installing MITM CA certificate"
    Push-Location $ScriptDir
    try {
        $out = echo "y" | node $AgDoctor mitm install 2>&1
        Write-Ok "MITM CA installed"
    } catch {
        Write-Warn "MITM install failed: $($_.Exception.Message)"
    } finally {
        Pop-Location
    }
}

# -- 4. Repack app.asar (clean staging)
$RepackScript = Join-Path $ScriptDir 'repack.ps1'
Write-Step "Repacking app.asar"
& $RepackScript -SkipRestart -NoPause
if ($LASTEXITCODE -ne 0) {
    Write-Host "  [ERROR] Repack failed" -ForegroundColor Red
    if (-not $NoPause) { Read-Host "Press Enter to close" }
    exit 1
}

# -- 5. Restart Antigravity
Write-Step "Launching Antigravity"
$AntigravityExe = Join-Path $env:LOCALAPPDATA "Programs\antigravity\Antigravity.exe"
if (Test-Path $AntigravityExe) {
    Start-Process -FilePath $AntigravityExe
    Write-Ok "Antigravity launched"
    Write-Host "`n  Wait ~10s for the proxy to load custom models, then check the dropdown." -ForegroundColor Gray
} else {
    Write-Warn "Antigravity.exe not found at $AntigravityExe"
}

Write-Host "`n== All fixes applied ==" -ForegroundColor Green
if (-not $NoPause) { Read-Host "Press Enter to close" }
