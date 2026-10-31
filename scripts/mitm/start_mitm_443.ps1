#Requires -RunAsAdministrator
<#
  Start Antigravity MITM HTTPS forwarder on port 443.
  Must be run as Administrator (port 443 + cert trust).
#>
$ErrorActionPreference = "Stop"

$ProjectDir = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$CaCert = Join-Path $ProjectDir "certs\ca-cert.pem"
$Node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $Node) {
    Write-Host "Node.js not found in PATH. Exiting." -ForegroundColor Red
    exit 1
}

# Remove any previous Antigravity MITM CA and import the current one
Get-ChildItem -Path Cert:\LocalMachine\Root | Where-Object Subject -Like '*Antigravity MITM CA*' | Remove-Item -Force -ErrorAction SilentlyContinue
Get-ChildItem -Path Cert:\CurrentUser\Root | Where-Object Subject -Like '*Antigravity MITM CA*' | Remove-Item -Force -ErrorAction SilentlyContinue

Write-Host "Importing CA certificate..." -ForegroundColor Cyan
Import-Certificate -FilePath $CaCert -CertStoreLocation Cert:\LocalMachine\Root | Out-Null
Import-Certificate -FilePath $CaCert -CertStoreLocation Cert:\CurrentUser\Root | Out-Null
Write-Host "CA imported to LocalMachine\\Root and CurrentUser\\Root." -ForegroundColor Green

Write-Host "Starting MITM HTTPS forwarder on port 443..." -ForegroundColor Cyan
Write-Host "(Press Ctrl+C to stop)" -ForegroundColor Yellow
& $Node (Join-Path $ProjectDir "scripts\mitm\mitm_443.js")
