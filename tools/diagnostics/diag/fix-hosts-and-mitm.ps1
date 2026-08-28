#Requires -RunAsAdministrator
<#
  Fix Antigravity "not logged into Antigravity" error caused by /etc/hosts
  pointing Google APIs to 127.0.0.1:443 while the MITM proxy is not running.

  Strategy: comment out (don't delete) the bogus 127.0.0.1 entries so DNS
  resolution works normally. Backups go to C:\Windows\System32\drivers\etc\hosts.bak.YYYYMMDD-HHMMSS
#>

$ErrorActionPreference = 'Stop'

$hostsPath = 'C:\Windows\System32\drivers\etc\hosts'
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = "$hostsPath.bak.$timestamp"

# 1) Backup the current hosts file
Copy-Item -LiteralPath $hostsPath -Destination $backup -Force
Write-Host "Backed up hosts → $backup" -ForegroundColor Cyan

# 2) Read & rewrite — comment entries that redirect googleapis.com to 127.0.0.1
$lines = Get-Content -LiteralPath $hostsPath
$pattern = '^(127\.0\.0\.1|::1)\s+(daily-cloudcode-pa|cloudcode-pa|daily-cloudcode-pa\.sandbox|autopush-cloudcode-pa\.sandbox)\.googleapis\.com\s*$'
$rewritten = $lines | ForEach-Object {
  if ($_ -match $pattern) {
    "# $_  # commented by Antigravity hosts fix at $timestamp"
  } else {
    $_
  }
}
Set-Content -LiteralPath $hostsPath -Value $rewritten -Force

# 3) Flush DNS cache so the change takes effect immediately
Write-Host "Flushing DNS cache..." -ForegroundColor Cyan
& ipconfig /flushdns | Out-Null

# 4) Show the result
Write-Host "`n=== Active googleapis entries in hosts (should be empty or comments) ===" -ForegroundColor Green
Get-Content -LiteralPath $hostsPath | Where-Object { $_ -match 'googleapis' -and $_ -notmatch '^\s*#' } | ForEach-Object { Write-Host "  $_" }
if (-not (Get-Content -LiteralPath $hostsPath | Where-Object { $_ -match 'googleapis' -and $_ -notmatch '^\s*#' })) {
  Write-Host "  (none — good!)" -ForegroundColor Green
}

Write-Host "`n✓ Done. Antigravity should now resolve cloudcode-pa.googleapis.com" -ForegroundColor Green
Write-Host "  to its real IP. Restart Antigravity if needed." -ForegroundColor Green
Write-Host "  To restore: copy `"$backup`" back to `"$hostsPath`"" -ForegroundColor Yellow
