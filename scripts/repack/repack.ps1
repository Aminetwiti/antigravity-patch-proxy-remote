# Antigravity Model Support Patch Repack & Deploy Script

Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "Stopping all running Antigravity processes..." -ForegroundColor Yellow
Write-Host "==============================================" -ForegroundColor Cyan

# Terminate running app and language server processes
Stop-Process -Name "Antigravity" -Force -ErrorAction SilentlyContinue
Stop-Process -Name "language_server" -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "Repacking app.asar package..." -ForegroundColor Yellow
Write-Host "==============================================" -ForegroundColor Cyan

# Define source and destination paths (portable — uses LOCALAPPDATA)
# NOTE: this repack targets the CLASSIC 2.x shell (app.asar merge). The
# VS Code-based "Antigravity IDE" has no app.asar — it is patched via the
# jetski.cloudCodeUrl settings override (see ag-doctor/src/core/ide-patch.ts).
$SourceDir = Resolve-Path "$PSScriptRoot\..\.."
$DestAsar = "$env:LOCALAPPDATA\Programs\antigravity\resources\app.asar"

if (-not (Test-Path $SourceDir)) {
    Write-Host "==============================================" -ForegroundColor Red
    Write-Host "Error: Source directory not found at $SourceDir" -ForegroundColor Red
    Write-Host "==============================================" -ForegroundColor Red
    exit 1
}

# Remove transient build junk that must never reach the asar
# (a stray nested dist/dist or dist/__mocks__ bricked the app on 2026-07-11).
$JunkTargets = @(
  (Join-Path $SourceDir "dist\dist"),
  (Join-Path $SourceDir "dist\node_modules"),
  (Join-Path $SourceDir "dist\__mocks__")
)
foreach ($Junk in $JunkTargets) {
  if (Test-Path $Junk) {
    Write-Host "Removing build junk: $Junk" -ForegroundColor DarkYellow
    Remove-Item -Recurse -Force $Junk -ErrorAction SilentlyContinue
  }
}

# Repack using @electron/asar.
# NOTE: pack from a STAGING dir containing only what the app.asar needs
# (package.json + dist/ + proxy-runner.js). Packing the repo root directly
# dragged nested node_modules (ag-doctor-ui/node_modules with the 176 MB
# Electron binary) into the archive — a 569 MB junk asar that broke version
# detection and bloated the install.
$AsarBin = Join-Path $SourceDir "node_modules\@electron\asar\bin\asar.js"
$StageDir = Join-Path $env:TEMP "antigravity-repack-stage"
if (Test-Path $StageDir) { Remove-Item -Recurse -Force $StageDir }
New-Item -ItemType Directory -Path $StageDir | Out-Null
Copy-Item (Join-Path $SourceDir "package.json") (Join-Path $StageDir "package.json") -Force
Copy-Item (Join-Path $SourceDir "dist") (Join-Path $StageDir "dist") -Recurse -Force
if (Test-Path (Join-Path $SourceDir "proxy-runner.js")) {
    Copy-Item (Join-Path $SourceDir "proxy-runner.js") (Join-Path $StageDir "proxy-runner.js") -Force
}
if (Test-Path $AsarBin) {
    node $AsarBin pack $StageDir $DestAsar
} else {
    npx -y @electron/asar pack $StageDir $DestAsar
}
Remove-Item -Recurse -Force $StageDir -ErrorAction SilentlyContinue
if ((Get-Item $DestAsar).Length -gt 100MB) {
    Write-Host "==============================================" -ForegroundColor Red
    Write-Host "Error: app.asar is suspiciously large (expect < 100MB). Aborting." -ForegroundColor Red
    Write-Host "Restore the previous asar from app.asar.bak before continuing." -ForegroundColor Red
    Write-Host "==============================================" -ForegroundColor Red
    exit 1
}

if ($LASTEXITCODE -eq 0) {
    Write-Host "==============================================" -ForegroundColor Cyan
    Write-Host "Success! app.asar repacked successfully." -ForegroundColor Green
    Write-Host "Restarting Antigravity..." -ForegroundColor Yellow
    Write-Host "==============================================" -ForegroundColor Cyan

    $ExePath = "$env:LOCALAPPDATA\Programs\antigravity\Antigravity.exe"
    if (Test-Path $ExePath) {
        Start-Process -FilePath $ExePath
    } else {
        Write-Host "Warning: Antigravity.exe not found at $ExePath" -ForegroundColor Yellow
        Write-Host "Please restart Antigravity manually." -ForegroundColor Yellow
    }
} else {
    Write-Host "==============================================" -ForegroundColor Red
    Write-Host "Error: Repacking failed!" -ForegroundColor Red
    Write-Host "==============================================" -ForegroundColor Red
    exit 1
}
