# scripts/deploy_remote_asar.ps1 — Deploy clean dist into Antigravity app.asar
$ErrorActionPreference = "Stop"

$ProjectRoot = Resolve-Path "$PSScriptRoot\.."
$AsarPath = "$env:LOCALAPPDATA\Programs\antigravity\resources\app.asar"
$BackupPath = "$env:LOCALAPPDATA\Programs\antigravity\resources\app.asar.bak-before-claude"
$TempStage = "$env:TEMP\antigravity_deploy_stage"

Write-Host "=== Deploying Claude Code Remote to Antigravity app.asar ===" -ForegroundColor Cyan

# 1. Terminate running Antigravity processes
Write-Host "[1/5] Stopping Antigravity processes..." -ForegroundColor Yellow
Stop-Process -Name "Antigravity" -Force -ErrorAction SilentlyContinue
Stop-Process -Name "Antigravity IDE" -Force -ErrorAction SilentlyContinue
Stop-Process -Name "language_server" -Force -ErrorAction SilentlyContinue
Stop-Process -Name "language_server_windows_x64" -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# 2. Identify clean 22MB base
$BaseAsar = "$env:LOCALAPPDATA\Programs\antigravity\resources\app.asar.bak-before-claude"
if (-not (Test-Path $BaseAsar)) {
    $BaseAsar = "$env:LOCALAPPDATA\Programs\antigravity\resources\app.asar.bak"
}
Write-Host "[2/5] Using base asar: $BaseAsar ($(Get-Item $BaseAsar).Length bytes)" -ForegroundColor Yellow

# 3. Extract to staging directory
Write-Host "[3/5] Extracting base app.asar..." -ForegroundColor Yellow
if (Test-Path $TempStage) { Remove-Item $TempStage -Recurse -Force }
$env:NODE_OPTIONS = "--max-old-space-size=4096"
npx -y @electron/asar extract $BaseAsar $TempStage

# 4. Copy current dist/ into staging
Write-Host "[4/5] Copying updated dist/ into staging..." -ForegroundColor Yellow
$SrcDist = Join-Path $ProjectRoot "dist"
$DestDist = Join-Path $TempStage "dist"
if (-not (Test-Path $SrcDist)) {
    Write-Host "ERROR: dist/ directory not found at $SrcDist" -ForegroundColor Red
    exit 1
}
Copy-Item "$SrcDist\*" $DestDist -Recurse -Force

# 5. Repack app.asar (full package, preserving node_modules)
Write-Host "[5/5] Repacking app.asar..." -ForegroundColor Yellow
$AsarUnpacked = "$AsarPath.unpacked"
if (Test-Path $AsarUnpacked) { Remove-Item $AsarUnpacked -Recurse -Force }

npx -y @electron/asar pack $TempStage $AsarPath
Remove-Item $TempStage -Recurse -Force -ErrorAction SilentlyContinue

$NewSize = (Get-Item $AsarPath).Length
Write-Host "SUCCESS! Repacked app.asar size: $NewSize bytes" -ForegroundColor Green

# 6. Relaunch Antigravity
$ExePath = "$env:LOCALAPPDATA\Programs\antigravity\Antigravity.exe"
if (Test-Path $ExePath) {
    Write-Host "Relaunching Antigravity.exe..." -ForegroundColor Cyan
    Start-Process -FilePath $ExePath
}
Write-Host "Done!" -ForegroundColor Green
