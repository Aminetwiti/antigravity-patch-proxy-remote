$ErrorActionPreference = 'Continue'
$PROXY_PORT = if ($env:AG_PROXY_PORT) { $env:AG_PROXY_PORT } else { '51074' }
$BIND_HOST = if ($env:AG_BIND_HOST) { $env:AG_BIND_HOST } else { '127.0.0.1' }
Write-Host '== Setting netsh winhttp proxy ==' -ForegroundColor Cyan
netsh winhttp set proxy proxy-server="${BIND_HOST}:${PROXY_PORT}" | Out-String | Write-Host
Write-Host '-- Current --' -ForegroundColor Cyan
netsh winhttp show proxy | Out-String | Write-Host
Write-Host 'DONE' -ForegroundColor Green
Read-Host 'Enter'
