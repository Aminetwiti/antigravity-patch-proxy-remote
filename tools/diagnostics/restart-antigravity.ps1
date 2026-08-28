# c:\Users\amine\Downloads\antigravity-add-model-main\antigravity-add-model-main\scripts\restart-antigravity.ps1
# Script de redémarrage propre d'Antigravity et nettoyage réseau (Version Robuste)

Write-Host "🔄 Arrêt des processus Antigravity..." -ForegroundColor Yellow

$processes = Get-Process | Where-Object { $_.ProcessName -match "antigravity|language.server|ag-doctor" }

if ($processes -eq $null) {
    Write-Host "  ℹ️ Aucun processus Antigravity actif trouvé." -ForegroundColor Gray
}
else {
    $processes | ForEach-Object {
        $pName = $_.ProcessName
        $pId = $_.Id
        Stop-Process -Id $pId -Force -ErrorAction SilentlyContinue
        Write-Host "  ✅ Tentative d'arrêt de $pName (PID: $pId)" -ForegroundColor Gray
    }
}

Start-Sleep -Seconds 2

# Vider le cache DNS local
Write-Host "`n🧹 Nettoyage du cache DNS Windows..." -ForegroundColor Yellow
ipconfig /flushdns | Out-Null
Write-Host "  ✅ Cache DNS vidé avec succès." -ForegroundColor Green

# Tester la connectivité de base après le restart
Write-Host "`n🔍 Test rapide de connectivité..." -ForegroundColor Yellow
$test = Test-NetConnection oauth2.googleapis.com -Port 443 -WarningAction SilentlyContinue
if ($test.TcpTestSucceeded) {
    Write-Host "  ✅ Connexion à oauth2.googleapis.com réussie." -ForegroundColor Green
}
else {
    Write-Host "  ⚠️ Échec de connexion réseau. Vérifiez vos paramètres réseau ou votre VPN." -ForegroundColor Yellow
}

Write-Host "`n================================================--" -ForegroundColor Cyan
Write-Host "Prêt. Vous pouvez maintenant redémarrer votre IDE." -ForegroundColor Green
