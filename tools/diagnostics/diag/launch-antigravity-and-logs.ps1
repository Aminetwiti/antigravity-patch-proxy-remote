#requires -Version 5.1
<#
.SYNOPSIS
    Lance Antigravity et suit ses logs en temps reel depuis Windows.
.DESCRIPTION
    Rebuild ag-doctor si besoin, lance Antigravity via ag-doctor,
    puis affiche les dernieres lignes du language_server.log.
#>
param(
    [switch]$NoRebuild,
    [int]$TailLines = 50
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Definition
$agDoctor = Join-Path $root "ag-doctor"

Push-Location $agDoctor

try {
    if (-not $NoRebuild) {
        Write-Host "[1/3] Build ag-doctor..." -ForegroundColor Cyan
        npm run build | Out-Host
    }

    Write-Host "[2/3] Lancement d'Antigravity..." -ForegroundColor Cyan
    $launch = node bin/ag-doctor.js antigravity launch --json | ConvertFrom-Json
    if (-not $launch.ok) {
        Write-Host "[X] Echec du lancement : $($launch.message)" -ForegroundColor Red
        exit 2
    }
    Write-Host "[OK] $($launch.message)" -ForegroundColor Green

    Write-Host "[3/3] Suivi des logs (Ctrl+C pour arreter)..." -ForegroundColor Cyan
    node bin/ag-doctor.js logs -f -n $TailLines | Out-Host
}
finally {
    Pop-Location
}
