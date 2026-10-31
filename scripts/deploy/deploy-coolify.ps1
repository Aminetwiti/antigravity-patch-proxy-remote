# ==============================================================================
# Antigravity Remote Agent Cloud — Coolify & Docker Deployment Script (PowerShell)
# ==============================================================================
# Usage:
#   .\scripts\deploy\deploy-coolify.ps1 [-CoolifyUrl <url>] [-CoolifyApiToken <token>] [-AppUuid <uuid>]
# ==============================================================================

param(
    [string]$CoolifyUrl = $env:COOLIFY_URL,
    [string]$CoolifyApiToken = $env:COOLIFY_API_TOKEN,
    [string]$AppUuid = $env:COOLIFY_APP_UUID,
    [string]$AuthToken = $env:AUTH_TOKEN,
    [int]$Port = 8090
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$DaemonDir = Join-Path $RepoRoot "remote\daemon"

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "  Antigravity Remote Cloud — Headless Daemon Deployment" -ForegroundColor Yellow
Write-Host "========================================================" -ForegroundColor Cyan

# Check if Coolify API deployment is requested
if ($CoolifyUrl -and $CoolifyApiToken) {
    Write-Host "📡 Mode: Déploiement via Coolify API..." -ForegroundColor Cyan
    $CoolifyUrl = $CoolifyUrl.TrimEnd('/')
    
    if (-not $AppUuid) {
        Write-Host "⚠️ AppUuid non spécifié. Récupération des applications depuis Coolify..." -ForegroundColor Yellow
        $headers = @{ "Authorization" = "Bearer $CoolifyApiToken" }
        try {
            $apps = Invoke-RestMethod -Uri "$CoolifyUrl/api/v1/applications" -Headers $headers -Method Get
            $apps | Format-Table -Property uuid, name, status
        } catch {
            Write-Host "❌ Erreur lors de la requête Coolify API : $_" -ForegroundColor Red
        }
        Write-Host "Spécifiez -AppUuid pour déclencher le build distant." -ForegroundColor Yellow
        exit 1
    }

    Write-Host "🚀 Déclenchement du déploiement pour l'application $AppUuid..." -ForegroundColor Cyan
    $headers = @{
        "Authorization" = "Bearer $CoolifyApiToken"
        "Content-Type" = "application/json"
    }
    try {
        $deployRes = Invoke-RestMethod -Uri "$CoolifyUrl/api/v1/deploy?uuid=$AppUuid" -Headers $headers -Method Post
        Write-Host "✅ Déploiement Coolify initié avec succès !" -ForegroundColor Green
        $deployRes | ConvertTo-Json
    } catch {
        Write-Host "❌ Erreur lors du déclenchement du déploiement : $_" -ForegroundColor Red
        exit 1
    }
    exit 0
}

# Fallback mode: Docker Compose
Write-Host "🐳 Mode: Déploiement local / VPS avec Docker Compose..." -ForegroundColor Cyan

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Erreur: Docker n'est pas installé sur ce système." -ForegroundColor Red
    exit 1
}

Push-Location $DaemonDir
try {
    Write-Host "📦 Construction de l'image Docker headless..." -ForegroundColor Yellow
    docker compose build --pull

    Write-Host "🚀 Lancement du conteneur antigravity-remote-daemon..." -ForegroundColor Yellow
    docker compose up -d

    Write-Host "🔍 Vérification de la santé du service (health check)..." -ForegroundColor Yellow
    $maxRetries = 15
    $count = 0
    $healthy = $false

    while ($count -lt $maxRetries) {
        try {
            $res = Invoke-WebRequest -Uri "http://localhost:$Port/health" -UseBasicParsing -TimeoutSec 2 -ErrorAction SilentlyContinue
            if ($res.StatusCode -eq 200) {
                $healthy = $true
                break
            }
        } catch {}
        Write-Host "   En attente du démarrage du daemon ($count/$maxRetries)..."
        Start-Sleep -Seconds 2
        $count++
    }

    if ($healthy) {
        Write-Host "✅ Le daemon Antigravity Remote Cloud est opérationnel sur le port $Port !" -ForegroundColor Green
        Write-Host "📊 Journalisation : docker compose logs -f antigravity-daemon" -ForegroundColor Cyan
    } else {
        Write-Host "⚠️ Le daemon a démarré mais le healthcheck ne répond pas encore." -ForegroundColor Yellow
        Write-Host "Vérifiez les logs avec : docker compose logs antigravity-daemon"
    }
} finally {
    Pop-Location
}

