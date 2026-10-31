$ErrorActionPreference = 'Continue'

# Portable paths — derived from $PSScriptRoot, never hardcoded.
$ScriptDir = $PSScriptRoot
$AgDoctor = Join-Path $ScriptDir 'ag-doctor\bin\ag-doctor.js'
$PROXY_PORT = if ($env:AG_PROXY_PORT) { $env:AG_PROXY_PORT } else { '51074' }
$BIND_HOST = if ($env:AG_BIND_HOST) { $env:AG_BIND_HOST } else { '127.0.0.1' }

Write-Host '== [1] Kill Antigravity processes ==' -ForegroundColor Cyan
Get-Process | Where-Object { $_.Name -like 'Antigravity*' -or $_.Name -like 'language_server*' } | ForEach-Object {
  Write-Host ("  killing {0} (PID {1})" -f $_.Name, $_.Id)
  try { $_ | Stop-Process -Force -ErrorAction Stop } catch {}
}
Start-Sleep -Seconds 2

Write-Host ''
Write-Host "== [2] Confirm port $PROXY_PORT free ==" -ForegroundColor Cyan
$conn = Get-NetTCPConnection -LocalPort $PROXY_PORT -ErrorAction SilentlyContinue
if ($conn) { Write-Host "  Port $PROXY_PORT still in use by PID $($conn.OwningProcess)" -ForegroundColor Yellow } else { Write-Host "  Port $PROXY_PORT is free" -ForegroundColor Green }

Write-Host ''
Write-Host '== [3] Truncate main.log to capture fresh startup ==' -ForegroundColor Cyan
$logPath = Join-Path $env:APPDATA 'Antigravity\logs\main.log'
if (Test-Path $logPath) {
  # rename current log so the new run creates a fresh one, but keep the old
  Rename-Item -Path $logPath -NewName 'main.previous.log' -Force
  Write-Host '  Renamed main.log -> main.previous.log'
}

Write-Host ''
Write-Host '== [4] Launch Antigravity ==' -ForegroundColor Cyan
$exe = Join-Path $env:LOCALAPPDATA 'Programs\antigravity\Antigravity.exe'
if (Test-Path $exe) {
  Start-Process -FilePath $exe
  Write-Host '  Launched.'
} else {
  Write-Host ("  Antigravity.exe not found at: " + $exe) -ForegroundColor Red
}

Write-Host ''
Write-Host "== [5] Poll port $PROXY_PORT (up to 45s) + scan new log for Proxy ==" -ForegroundColor Cyan
$ready = $false
for ($i = 1; $i -le 45; $i++) {
  $tcp = $null
  try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $iar = $tcp.BeginConnect($BIND_HOST, [int]$PROXY_PORT, $null, $null)
    if ($iar.AsyncWaitHandle.WaitOne(1000, $false)) {
      $tcp.EndConnect($iar)
      Write-Host ("  Port $PROXY_PORT OPEN after {0}s" -f $i) -ForegroundColor Green
      $ready = $true
      break
    }
  } catch {} finally { if ($tcp) { $tcp.Close() } }
  Start-Sleep -Seconds 1
}
if (-not $ready) { Write-Host "  Port $PROXY_PORT NOT reachable after 45s" -ForegroundColor Red }

Write-Host ''
Write-Host '== [6] Grep new main.log for proxy activity ==' -ForegroundColor Cyan
if (Test-Path $logPath) {
  Select-String -Path $logPath -Pattern "Proxy|${PROXY_PORT}|listening|EADDRINUSE|patched" | Select-Object -Last 40 | ForEach-Object { Write-Host ("  {0}" -f $_.Line) }
} else {
  Write-Host '  No new main.log yet'
}

Write-Host ''
Write-Host '== [7] ag-doctor doctor ==' -ForegroundColor Cyan
if (Test-Path $AgDoctor) {
  & node $AgDoctor doctor
} else {
  Write-Host ("ag-doctor not found at: " + $AgDoctor) -ForegroundColor Yellow
}

Read-Host 'Enter to close'
