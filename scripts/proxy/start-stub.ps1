# start-stub.ps1 - Start the minimal proxy stub on the configured proxy port
#
# WARNING: This stub does NOT inject custom models. It only returns empty 200s
# so the patched language_server.exe can initialise without ECONNREFUSED errors.
# The real proxy (inside the repacked app.asar) handles custom models.
# Only use the stub when Antigravity is NOT running.
param([switch]$NoPause)

$PORT = if ($env:AG_PROXY_STUB_PORT) { [int]$env:AG_PROXY_STUB_PORT } else { 51999 }
$StubScript = Join-Path $PSScriptRoot 'proxy-stub.js'

$busy = Get-NetTCPConnection -LocalPort $PORT -ErrorAction SilentlyContinue
if ($busy) {
  Write-Host "[WARN] Port $PORT already in use by PID $($busy.OwningProcess)." -ForegroundColor Yellow
  Write-Host "       If Antigravity is running, the real proxy handles custom models." -ForegroundColor Yellow
  Write-Host "       Only start the stub when Antigravity is stopped." -ForegroundColor Yellow
  if (-not $NoPause) { Read-Host "Press Enter to close" }
  exit 0
}

Write-Host "Starting proxy-stub on port $PORT..." -ForegroundColor Cyan
Write-Host "(No custom models -- use fix-all.ps1 for full support)" -ForegroundColor DarkGray
Start-Process -FilePath "node" -ArgumentList $StubScript
Start-Sleep -Seconds 2

$busy2 = Get-NetTCPConnection -LocalPort $PORT -ErrorAction SilentlyContinue
if ($busy2) {
  Write-Host "[OK] proxy-stub listening on port $PORT" -ForegroundColor Green
}
else {
  Write-Host "[ERROR] proxy-stub failed to start on port $PORT" -ForegroundColor Red
}
if (-not $NoPause) { Read-Host "Press Enter to close" }
