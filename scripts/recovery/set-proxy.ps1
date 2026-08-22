$ErrorActionPreference = 'Continue'
$PROXY_PORT = if ($env:AG_PROXY_PORT) { $env:AG_PROXY_PORT } else { '51074' }
Write-Host '== Setting netsh winhttp proxy ==' -ForegroundColor Cyan
netsh winhttp set proxy proxy-server="127.0.0.1:${PROXY_PORT}" | Out-String | Write-Host
Write-Host '-- Current --' -ForegroundColor Cyan
netsh winhttp show proxy | Out-String | Write-Host
Write-Host 'DONE' -ForegroundColor Green
Read-Host 'Enter'
