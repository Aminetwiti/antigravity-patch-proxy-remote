$ErrorActionPreference = 'Continue'
$nodeExe = (Get-Command node.exe).Source

$proxyPort = if ($env:AG_PROXY_PORT) { $env:AG_PROXY_PORT } else { '51074' }
Write-Host "== Port $proxyPort status ==" -ForegroundColor Cyan
$conn = Get-NetTCPConnection -LocalPort $proxyPort -State Listen -ErrorAction SilentlyContinue
if ($conn) { Write-Host ("  LISTENING (PID " + $conn.OwningProcess + ")") -ForegroundColor Green } else { Write-Host '  NOT listening' -ForegroundColor Red }

Write-Host ''
Write-Host '== Antigravity processes ==' -ForegroundColor Cyan
Get-Process | Where-Object { $_.Name -like 'Antigravity*' -or $_.Name -like 'language_server*' } |
  Select-Object Name,Id,StartTime | Format-Table -AutoSize

Write-Host '== Quick TCP probe ==' -ForegroundColor Cyan
$tcp = New-Object System.Net.Sockets.TcpClient
try { $tcp.BeginConnect('127.0.0.1', [int]$proxyPort, $null, $null).AsyncWaitHandle.WaitOne(2000) | Out-Null; $tcp.Close(); Write-Host '  TCP connect OK' -ForegroundColor Green }
catch { Write-Host '  TCP connect FAILED: ' + $_.Exception.Message -ForegroundColor Red }

Write-Host ''
Write-Host '== /health probe (identify real proxy vs stub) ==' -ForegroundColor Cyan
try {
  $r = Invoke-WebRequest -Uri "http://127.0.0.1:${proxyPort}/health" -UseBasicParsing -TimeoutSec 3
  Write-Host ("  status=" + $r.StatusCode + " body=" + $r.Content)
  if ($r.Content -match '"stub":true') { Write-Host '  -> STUB is answering' -ForegroundColor Yellow }
  else { Write-Host '  -> REAL proxy is answering' -ForegroundColor Green }
} catch {
  Write-Host "  /health failed: $($_.Exception.Message)" -ForegroundColor Yellow
  Write-Host '  (real proxy /health may not exist — checking main.log for [Proxy])' -ForegroundColor DarkGray
}

Write-Host ''
Write-Host '== main.log: proxy startup lines ==' -ForegroundColor Cyan
$logPath = "$env:APPDATA\Antigravity\logs\main.log"
if (Test-Path $logPath) {
  Select-String -Path $logPath -Pattern "Proxy|${proxyPort}|listening|EADDRINUSE|startProxy failed" -ErrorAction SilentlyContinue |
    Select-Object -Last 20 | ForEach-Object { Write-Host "  " + $_.Line }
} else { Write-Host '  no main.log' }

Write-Host ''
Write-Host "== language_server.log: ${proxyPort} errors? ==" -ForegroundColor Cyan
$lsLog = "$env:APPDATA\Antigravity\logs\language_server.log"
if (Test-Path $lsLog) {
  Select-String -Path $lsLog -Pattern "${proxyPort}|connectex|No connection" -ErrorAction SilentlyContinue |
    Select-Object -Last 5 | ForEach-Object { Write-Host "  " + $_.Line }
}

Write-Host ''
Write-Host '== ag-doctor doctor ==' -ForegroundColor Cyan
$agDoctor = Join-Path $PSScriptRoot '..\..\ag-doctor\bin\ag-doctor.js'
& $nodeExe $agDoctor doctor
