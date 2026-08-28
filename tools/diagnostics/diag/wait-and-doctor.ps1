$ErrorActionPreference = 'Continue'
$proxyPort = if ($env:AG_PROXY_PORT) { $env:AG_PROXY_PORT } else { '51074' }
Write-Host "== Waiting for 127.0.0.1:${proxyPort} (up to 90s) ==" -ForegroundColor Cyan
$ready = $false
for ($i = 1; $i -le 90; $i++) {
  $tcp = $null
  try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $iar = $tcp.BeginConnect('127.0.0.1', [int]$proxyPort, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne(1000, $false)
    if ($ok) {
      $tcp.EndConnect($iar)
      Write-Host ("Port ${proxyPort} OPEN after {0}s" -f $i) -ForegroundColor Green
      $ready = $true
      break
    }
  } catch {
  } finally {
    if ($tcp) { $tcp.Close() }
  }
  if ($i % 10 -eq 0) { Write-Host ("  still waiting... {0}s" -f $i) -ForegroundColor Yellow }
  Start-Sleep -Seconds 1
}
if (-not $ready) { Write-Host "Port ${proxyPort} NOT reachable after 90s" -ForegroundColor Red }

Write-Host ''
Write-Host '== ag-doctor doctor ==' -ForegroundColor Cyan
$agDoctor = Join-Path $PSScriptRoot '..\..\ag-doctor\bin\ag-doctor.js'
node $agDoctor doctor

Read-Host 'Enter to close'
