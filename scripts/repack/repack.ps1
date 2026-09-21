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
# Extract base asar first (to preserve app assets and dependencies), then overlay dist/ and node_modules.
$AsarBin = Join-Path $SourceDir "node_modules\@electron\asar\bin\asar.js"
$StageDir = Join-Path $env:TEMP "antigravity-repack-stage"
if (Test-Path $StageDir) { Remove-Item -Recurse -Force $StageDir }
New-Item -ItemType Directory -Path $StageDir | Out-Null

$BaseAsar = "$env:LOCALAPPDATA\Programs\antigravity\resources\app.asar.bak"
if (-not (Test-Path $BaseAsar)) {
    $BaseAsar = $DestAsar
}

if ((Test-Path $BaseAsar) -and ((Get-Item $BaseAsar).Length -gt 5MB)) {
    Write-Host "Extracting base app.asar ($BaseAsar)..." -ForegroundColor Yellow
    if (Test-Path $AsarBin) {
        node $AsarBin extract $BaseAsar $StageDir
    } else {
        npx -y @electron/asar extract $BaseAsar $StageDir
    }
}

Copy-Item (Join-Path $SourceDir "package.json") (Join-Path $StageDir "package.json") -Force
Copy-Item (Join-Path $SourceDir "dist") (Join-Path $StageDir "dist") -Recurse -Force
if (Test-Path (Join-Path $SourceDir "proxy-runner.js")) {
    Copy-Item (Join-Path $SourceDir "proxy-runner.js") (Join-Path $StageDir "proxy-runner.js") -Force
}

$StageNodeModules = Join-Path $StageDir "node_modules"
if (-not (Test-Path $StageNodeModules)) {
    New-Item -ItemType Directory -Path $StageNodeModules | Out-Null
}
$SourceNodeModules = Join-Path $SourceDir "node_modules"
if (Test-Path $SourceNodeModules) {
    Write-Host "Copying dependencies from $SourceNodeModules..." -ForegroundColor Yellow
    Copy-Item (Join-Path $SourceNodeModules "*") $StageNodeModules -Recurse -Force -ErrorAction SilentlyContinue
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
