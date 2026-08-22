$ErrorActionPreference = 'Continue'

# Portable paths — derived from $PSScriptRoot, never hardcoded.
$ScriptDir = $PSScriptRoot
$AgDoctor = Join-Path $ScriptDir 'ag-doctor\bin\ag-doctor.js'
$PROXY_PORT = if ($env:AG_PROXY_PORT) { $env:AG_PROXY_PORT } else { '51074' }

Write-Host "== Setting system proxy to 127.0.0.1:${PROXY_PORT} ==" -ForegroundColor Cyan
try {
  netsh winhttp set proxy proxy-server="127.0.0.1:${PROXY_PORT}" | Out-String | Write-Host
  Write-Host 'OK: netsh winhttp set proxy succeeded' -ForegroundColor Green
} catch {
  Write-Host ("FAIL: " + $_.Exception.Message) -ForegroundColor Red
}

Write-Host ''
Write-Host '== Current WinHTTP proxy ==' -ForegroundColor Cyan
netsh winhttp show proxy | Out-String | Write-Host

Write-Host ''
Write-Host '== Re-running ag-doctor doctor ==' -ForegroundColor Cyan
if (Test-Path $AgDoctor) {
  & node $AgDoctor doctor
} else {
  Write-Host ("ag-doctor not found at: " + $AgDoctor) -ForegroundColor Yellow
}

Read-Host 'Press Enter to close'
