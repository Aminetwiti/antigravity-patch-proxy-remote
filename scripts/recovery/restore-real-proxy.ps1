$ErrorActionPreference = 'Continue'

# Portable paths — derived from $PSScriptRoot, never hardcoded.
$ScriptDir = $PSScriptRoot
$Root = $ScriptDir
$AgDoctor = Join-Path $ScriptDir 'ag-doctor\bin\ag-doctor.js'
$StubJs = Join-Path $ScriptDir 'proxy-stub.js'
$LogFile = Join-Path $env:TEMP 'ag-proxy-stub.log'
$OutFile = Join-Path $env:TEMP 'ag-proxy-stub.out'
$ErrFile = Join-Path $env:TEMP 'ag-proxy-stub.err'
$BIND_HOST = if ($env:AG_BIND_HOST) { $env:AG_BIND_HOST } else { '127.0.0.1' }
$PROXY_PORT = if ($env:AG_PROXY_PORT) { $env:AG_PROXY_PORT } else { '51074' }

# 1. Kill the stub so port $PROXY_PORT is free for the real proxy
Write-Host "== [1] Stop proxy stub (free $PROXY_PORT) ==" -ForegroundColor Cyan
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match 'proxy-stub' } |
  ForEach-Object { Write-Host ("  killing stub pid=" + $_.ProcessId); Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Get-NetTCPConnection -LocalPort $PROXY_PORT -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Write-Host ("  killing PID " + $_.OwningProcess + " on ${PROXY_PORT}"); Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2

# 2. Kill Antigravity so repack is clean
Write-Host ''
Write-Host '== [2] Kill Antigravity ==' -ForegroundColor Cyan
Get-Process | Where-Object { $_.Name -like 'Antigravity*' -or $_.Name -like 'language_server*' } |
  ForEach-Object { Write-Host ("  killing " + $_.Name + " pid=" + $_.Id); Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2

# 3. Build the root project (recompile src/ -> dist/)
Write-Host ''
Write-Host '== [3] npm run build (root) ==' -ForegroundColor Cyan
Push-Location $Root
try {
  $nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $nodeCmd) { Write-Host 'node.exe not found' -ForegroundColor Red; exit 1 }
  & $nodeCmd.Source .\node_modules\.bin\tsc 2>&1 | Select-Object -Last 30
  if ($LASTEXITCODE -ne 0) { Write-Host "tsc exited $LASTEXITCODE" -ForegroundColor Red; Pop-Location; exit 1 }
  Write-Host '  build OK' -ForegroundColor Green
} finally { Pop-Location }

# 4. Repack app.asar
Write-Host ''
Write-Host '== [4] Repack app.asar ==' -ForegroundColor Cyan
Push-Location $Root
try {
  & $nodeCmd.Source .\node_modules\.bin\electron 2>$null  # warm npx cache, ignore
  $DestAsar = Join-Path $env:LOCALAPPDATA 'Programs\antigravity\resources\app.asar'
  # Backup current asar
  if (Test-Path $DestAsar) {
    $bak = $DestAsar + '.bak-' + (Get-Date -Format 'yyyyMMddHHmmss')
    Copy-Item $DestAsar $bak
    Write-Host ("  backed up -> " + $bak) -ForegroundColor DarkGray
  }
  & npx -y @electron/asar pack $Root $DestAsar --unpack-dir "{node_modules,scratch,.git}" 2>&1 | Select-Object -Last 20
  if ($LASTEXITCODE -ne 0) { Write-Host "asar pack exited $LASTEXITCODE" -ForegroundColor Red; Pop-Location; exit 1 }
  Write-Host '  repack OK' -ForegroundColor Green
} finally { Pop-Location }

# 5. Relaunch Antigravity
Write-Host ''
Write-Host '== [5] Launch Antigravity ==' -ForegroundColor Cyan
$exe = Join-Path $env:LOCALAPPDATA 'Programs\antigravity\Antigravity.exe'
if (Test-Path $exe) { Start-Process -FilePath $exe; Write-Host '  launched.' } else { Write-Host ("  MISSING: " + $exe) -ForegroundColor Red }

# 6. Poll $PROXY_PORT
Write-Host ''
Write-Host "== [6] Wait for ${BIND_HOST}:${PROXY_PORT} (up to 60s) ==" -ForegroundColor Cyan
$ready = $false
for ($i = 1; $i -le 60; $i++) {
  $tcp = $null
  try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $iar = $tcp.BeginConnect($BIND_HOST, [int]$PROXY_PORT, $null, $null)
    if ($iar.AsyncWaitHandle.WaitOne(1000, $false)) { $tcp.EndConnect($iar); $ready = $true; Write-Host ("  OPEN after {0}s" -f $i) -ForegroundColor Green; break }
  } catch {} finally { if ($tcp) { $tcp.Close() } }
  if ($i % 10 -eq 0) { Write-Host ("  waiting... {0}s" -f $i) -ForegroundColor Yellow }
  Start-Sleep -Seconds 1
}

# 7. Verify it's the real proxy (not the stub) by probing /health for stub marker
$stub = $false
if ($ready) {
  try {
    $r = Invoke-WebRequest -Uri "http://${BIND_HOST}:${PROXY_PORT}/health" -UseBasicParsing -TimeoutSec 3
    Write-Host ("  /health -> " + $r.StatusCode + " " + $r.Content)
    if ($r.Content -match '"stub":true') { $stub = $true }
  } catch { Write-Host "  /health probe failed: $($_.Exception.Message)" -ForegroundColor Yellow }
}

Write-Host ''
Write-Host '== [7] ag-doctor doctor ==' -ForegroundColor Cyan
if (Test-Path $AgDoctor) {
  & $nodeCmd.Source $AgDoctor doctor
} else {
  Write-Host ("ag-doctor not found at: " + $AgDoctor) -ForegroundColor Yellow
}

Write-Host ''
if ($ready -and -not $stub) {
  Write-Host 'REAL PROXY IS UP.' -ForegroundColor Green
} elseif ($ready -and $stub) {
  Write-Host "STUB is still answering (real proxy did not take $PROXY_PORT)." -ForegroundColor Yellow
} else {
  Write-Host "REAL PROXY DID NOT START on $PROXY_PORT after 60s." -ForegroundColor Red
  Write-Host 'Restarting stub to restore connectivity...' -ForegroundColor Yellow
  if (Test-Path $StubJs) {
    Start-Process -FilePath $nodeCmd.Source -ArgumentList "`"$StubJs`"" -WindowStyle Hidden `
      -RedirectStandardOutput $OutFile `
      -RedirectStandardError $ErrFile
    Start-Sleep -Seconds 2
    Write-Host '  stub relaunched.'
  } else {
    Write-Host ("  proxy-stub.js not found at: " + $StubJs) -ForegroundColor Yellow
  }
}
