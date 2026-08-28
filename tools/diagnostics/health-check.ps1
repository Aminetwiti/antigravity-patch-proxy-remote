# c:\Users\amine\Downloads\antigravity-add-model-main\antigravity-add-model-main\scripts\health-check.ps1
# Script de diagnostic de sante pour Antigravity

$domains = @(
    "oauth2.googleapis.com",
    "daily-cloudcode-pa.googleapis.com",
    "play.googleapis.com"
)

Write-Host "Antigravity Health Check" -ForegroundColor Cyan
Write-Host "=================================================="

# 1. Verification DNS
Write-Host "[1/4] Verification de la resolution DNS et connectivite..." -ForegroundColor Yellow
foreach ($domain in $domains) {
    try {
        $dns = Resolve-DnsName $domain -ErrorAction Stop
        $ip = $dns[0].IPAddress
        
        # Test de connexion TCP sur le port 443
        $tcp = Test-NetConnection $domain -Port 443 -WarningAction SilentlyContinue
        if ($tcp.TcpTestSucceeded) {
            Write-Host "  OK $domain -> Resolution: $ip | TCP 443: OK" -ForegroundColor Green
        } else {
            Write-Host "  FAIL $domain -> Resolution: $ip | TCP 443: ECHEC" -ForegroundColor Red
        }
    } catch {
        Write-Host "  FAIL $domain -> ECHEC Resolution DNS" -ForegroundColor Red
    }
}

# 2. Verification du proxy local
$proxyPort = $env:AG_PROXY_PORT; if (-not $proxyPort) { $proxyPort = '51074' }
Write-Host "`n[2/4] Verification du proxy local (Port $proxyPort)..." -ForegroundColor Yellow
$proxy = Test-NetConnection -ComputerName localhost -Port $proxyPort -WarningAction SilentlyContinue
if ($proxy.TcpTestSucceeded) {
    Write-Host "  OK Proxy local (Port $proxyPort) actif et ecoute." -ForegroundColor Green
} else {
    Write-Host "  FAIL Proxy local (Port $proxyPort) inactif ou bloque." -ForegroundColor Red
}

# 3. Verification de l'espace disque
Write-Host "`n[3/4] Verification de l'espace disque (Lecteur C:)..." -ForegroundColor Yellow
$disk = Get-PSDrive C -ErrorAction SilentlyContinue
if ($disk) {
    $freeGB = [math]::Round($disk.Free / 1GB, 2)
    if ($freeGB -lt 5) {
        Write-Host "  WARNING Espace disque faible : ${freeGB} GB libres." -ForegroundColor Yellow
    } else {
        Write-Host "  OK Espace disque suffisant : ${freeGB} GB libres." -ForegroundColor Green
    }
} else {
    Write-Host "  WARNING Impossible de lire l'espace disque C:" -ForegroundColor Yellow
}

# 4. Verification des logs
Write-Host "`n[4/4] Verification de la taille des logs..." -ForegroundColor Yellow
$logPath = "$env:APPDATA\Antigravity\logs"
if (Test-Path $logPath) {
    $logFiles = Get-ChildItem $logPath -Filter "*.log"
    $totalSize = 0
    foreach ($file in $logFiles) {
        $totalSize += $file.Length
    }
    $totalSizeMB = [math]::Round($totalSize / 1MB, 2)
    if ($totalSizeMB -gt 500) {
        Write-Host "  WARNING Dossier logs volumineux : ${totalSizeMB} MB. Executez cleanup-logs.ps1" -ForegroundColor Yellow
    } else {
        Write-Host "  OK Taille des logs raisonnable : ${totalSizeMB} MB." -ForegroundColor Green
    }
} else {
    Write-Host "  WARNING Dossier des logs introuvable a : $logPath" -ForegroundColor Yellow
}

Write-Host "`n==================================================" -ForegroundColor Cyan
Write-Host "Diagnostic termine." -ForegroundColor Cyan
