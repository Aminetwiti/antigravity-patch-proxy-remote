#Requires -Version 5.1
<#
.SYNOPSIS
    Detect which Antigravity installation is present (v1.x patched vs v2.0+ original).

.DESCRIPTION
    Scans the user's Local AppData for Antigravity installations and reports:
      - Which versions are installed
      - Which binary is currently active
      - Whether the running process is v1.x or v2.0+
      - Port ${AG_PROXY_PORT:-51074} ownership (which PID is bound to it)

    Use this script FIRST whenever you have problems. It avoids the most common
    mistake of patching the wrong installation.

.OUTPUTS
    Writes a structured report to stdout. Exit code:
      0 = single, unambiguous installation found
      1 = multiple installations found (ambiguous)
      2 = no installation found
#>

$ErrorActionPreference = 'Continue'
$PROXY_PORT = if ($env:AG_PROXY_PORT) { $env:AG_PROXY_PORT } else { '51074' }

# ─── Helpers ───────────────────────────────────────────────────────────────

function Write-Section($title) {
    Write-Host ''
    Write-Host '═══════════════════════════════════════════════════════════════════════' -ForegroundColor Cyan
    Write-Host "  $title" -ForegroundColor Cyan
    Write-Host '═══════════════════════════════════════════════════════════════════════' -ForegroundColor Cyan
}

function Test-InstallPath($path) {
    if (-not (Test-Path $path)) { return $null }
    $exe = Join-Path $path 'Antigravity.exe'
    if (-not (Test-Path $exe)) { return $null }

    # Try to read the version from package.json (works for both v1.x and v2.0+)
    $pkgPath = Join-Path $path 'resources/app/package.json'
    $version = 'unknown'
    if (Test-Path $pkgPath) {
        try {
            $pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
            if ($pkg.version) { $version = $pkg.version }
        } catch {}
    }

    # Detect whether app.asar has been patched (look for our proxy.ts markers)
    $isPatched = $false
    $asarPath = Join-Path $path 'resources/app.asar'
    if (Test-Path $asarPath) {
        # Quick heuristic: a patched build will have a larger app.asar than pristine
        $size = (Get-Item $asarPath).Length
        $isPatched = $size -gt 50MB  # pristine is ~40MB, patched is larger
    }

    return [PSCustomObject]@{
        Path     = $path
        Exe      = $exe
        Version  = $version
        Patched  = $isPatched
        Size     = if (Test-Path $asarPath) { (Get-Item $asarPath).Length } else { 0 }
    }
}

function Get-PortOwner($port) {
    try {
        $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop
        if ($conn) {
            $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
            return [PSCustomObject]@{
                Port    = $port
                PID     = $conn.OwningProcess
                Process = if ($proc) { $proc.ProcessName } else { 'unknown' }
                Path    = if ($proc) { $proc.Path } else { 'unknown' }
            }
        }
    } catch {}
    return $null
}

# ─── Main ──────────────────────────────────────────────────────────────────

Write-Section 'Antigravity Installation Detector'
Write-Host "  Run this first whenever you have problems." -ForegroundColor Yellow
Write-Host "  It tells you exactly which Antigravity binary is in play." -ForegroundColor Yellow

# ─── 1. Scan Local AppData ─────────────────────────────────────────────────

Write-Section '1. Installations Found'

$localAppData = $env:LOCALAPPDATA
$programs = Join-Path $localAppData 'Programs'
$installs = @()

# v1.x (lowercase 'a')
$v1Path = Join-Path $programs 'antigravity'
$installs += Test-InstallPath $v1Path

# v2.0+ (uppercase 'A')
$v2Path = Join-Path $programs 'Antigravity'
$installs += Test-InstallPath $v2Path

$installs = $installs | Where-Object { $_ -ne $null }

if ($installs.Count -eq 0) {
    Write-Host "  ❌ No Antigravity installation found in $programs" -ForegroundColor Red
    Write-Host ''
    Write-Host '  Expected paths:' -ForegroundColor Yellow
    Write-Host "    $v1Path" -ForegroundColor Gray
    Write-Host "    $v2Path" -ForegroundColor Gray
    exit 2
}

foreach ($i in $installs) {
    $tag = if ($i.Path -match '\\antigravity$') { 'v1.x (lowercase, patched repo)' } else { 'v2.0+ (uppercase, Google original)' }
    $patchedTag = if ($i.Patched) { 'PATCHED' } else { 'pristine' }
    Write-Host "  📦 $tag" -ForegroundColor White
    Write-Host "     Path:    $($i.Path)" -ForegroundColor Gray
    Write-Host "     Version: $($i.Version)" -ForegroundColor Gray
    Write-Host "     State:   $patchedTag" -ForegroundColor $(if ($i.Patched) { 'Green' } else { 'Yellow' })
    Write-Host "     asar:    $([math]::Round($i.Size / 1MB, 1)) MB" -ForegroundColor Gray
    Write-Host ''
}

# ─── 2. Running Processes ──────────────────────────────────────────────────

Write-Section '2. Running Antigravity Processes'

$running = Get-Process -Name 'Antigravity' -ErrorAction SilentlyContinue
if (-not $running) {
    Write-Host '  (none running)' -ForegroundColor Gray
} else {
    foreach ($p in $running) {
        $installType = if ($p.Path -match '\\antigravity\\') { 'v1.x' } elseif ($p.Path -match '\\Antigravity\\') { 'v2.0+' } else { 'unknown' }
        Write-Host "  ▶ PID $($p.Id) [$installType] $($p.Path)" -ForegroundColor White
        Write-Host "     Started: $($p.StartTime)" -ForegroundColor Gray
    }
}
Write-Host ''

# ─── 3. Port $PROXY_PORT Ownership ──────────────────────────────────────────────

Write-Section "3. Port $PROXY_PORT Ownership"

$owner = Get-PortOwner $PROXY_PORT
if ($owner) {
    Write-Host "  ⚠️  Port $PROXY_PORT is bound by:" -ForegroundColor Yellow
    Write-Host "     PID:     $($owner.PID)" -ForegroundColor White
    Write-Host "     Process: $($owner.Process)" -ForegroundColor White
    Write-Host "     Path:    $($owner.Path)" -ForegroundColor Gray

    # Check if it's our patched build or something else
    $isOurs = $owner.Path -match '\\antigravity\\'
    if ($isOurs) {
        Write-Host ''
        Write-Host '  ✅ This is our patched v1.x proxy — expected.' -ForegroundColor Green
    } else {
        Write-Host ''
        Write-Host '  ⚠️  This is NOT our patched build.' -ForegroundColor Yellow
        Write-Host '     If you started Antigravity 2.0 (uppercase), its proxy cannot start' -ForegroundColor Yellow
        Write-Host '     because port $PROXY_PORT is taken. Either:' -ForegroundColor Yellow
        Write-Host '       (a) Kill PID $($owner.PID): Stop-Process -Id $($owner.PID) -Force' -ForegroundColor Yellow
        Write-Host '       (b) Run Antigravity 2.0 with AG_PROXY_PORT=51999' -ForegroundColor Yellow
    }
} else {
    Write-Host "  ✅ Port $PROXY_PORT is FREE." -ForegroundColor Green
}
Write-Host ''

# ─── 4. Recommendations ───────────────────────────────────────────────────

Write-Section '4. Recommendation'

if ($installs.Count -gt 1) {
    Write-Host '  ⚠️  MULTIPLE INSTALLATIONS DETECTED.' -ForegroundColor Yellow
    Write-Host ''
    Write-Host '  This is the #1 source of confusion. Pick ONE:' -ForegroundColor White
    Write-Host ''
    Write-Host '  Option A — Use the patched v1.x (recommended for this repo):' -ForegroundColor Cyan
    Write-Host "    & '$($installs[0].Exe)'" -ForegroundColor Gray
    Write-Host ''
    Write-Host '  Option B — Use the original v2.0+:' -ForegroundColor Cyan
    if ($installs.Count -ge 2) {
        Write-Host "    & '$($installs[1].Exe)'" -ForegroundColor Gray
    } else {
        Write-Host "    (only one installation present)" -ForegroundColor Gray
    }
    Write-Host ''
    Write-Host '  To remove the ambiguity, uninstall one of them via:' -ForegroundColor Yellow
    Write-Host '    Settings → Apps → Installed apps → search "Antigravity" → Uninstall' -ForegroundColor Gray
    exit 1
} else {
    $only = $installs[0]
    $tag = if ($only.Path -match '\\antigravity$') { 'patched v1.x' } else { 'original v2.0+' }
    Write-Host "  ✅ Single installation found: $tag" -ForegroundColor Green
    Write-Host "     $($only.Path)" -ForegroundColor Gray
    Write-Host ''
    Write-Host '  To start it:' -ForegroundColor White
    Write-Host "    & '$($only.Exe)'" -ForegroundColor Gray
    exit 0
}
