# Test du système de patch version-aware
# Ce script teste la détection de version et l'affichage du statut

Write-Host "=== Test du système de patch version-aware ===" -ForegroundColor Cyan
Write-Host ""

# Vérifier que ag-doctor est compilé
$agDoctorDist = ".\ag-doctor\dist"
if (-not (Test-Path $agDoctorDist)) {
    Write-Host "ERREUR: ag-doctor n'est pas compilé. Exécutez 'npm run build' d'abord." -ForegroundColor Red
    exit 1
}

Write-Host "1. Vérification de la version d'Antigravity installée..." -ForegroundColor Yellow
$antigravityPath = "$env:LOCALAPPDATA\Programs\Antigravity"
if (Test-Path $antigravityPath) {
    Write-Host "   ✓ Antigravity trouvé: $antigravityPath" -ForegroundColor Green
    
    # Chercher le fichier version
    $exePath = "$antigravityPath\Antigravity.exe"
    if (Test-Path $exePath) {
        $version = (Get-Item $exePath).VersionInfo.FileVersion
        Write-Host "   Version détectée: $version" -ForegroundColor Cyan
    }
} else {
    Write-Host "   ✗ Antigravity n'est pas installé" -ForegroundColor Red
}

Write-Host ""
Write-Host "2. Test de 'ag-doctor patch status' (version-aware)..." -ForegroundColor Yellow
Write-Host ""

# Exécuter ag-doctor patch status
$env:PATH = ".\ag-doctor\bin;" + $env:PATH
& node .\ag-doctor\bin\ag-doctor.js patch status

Write-Host ""
Write-Host "=== Résultats ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Le système version-aware devrait maintenant:" -ForegroundColor White
Write-Host "  1. Détecter automatiquement la version d'Antigravity" -ForegroundColor Gray
Write-Host "  2. Afficher le patch recommandé pour cette version" -ForegroundColor Gray
Write-Host "  3. Indiquer si la version est compatible" -ForegroundColor Gray
Write-Host "  4. Montrer les URLs détectées dans le binaire" -ForegroundColor Gray
Write-Host ""

Write-Host "Pour versions 2.2.x:" -ForegroundColor Yellow
Write-Host "  Si vous voyez 'No patch available', vous devez:" -ForegroundColor White
Write-Host "  1. Analyser le binaire pour trouver la nouvelle URL" -ForegroundColor Gray
Write-Host "  2. Ajouter le patch dans PATCH_REGISTRY" -ForegroundColor Gray
Write-Host "  3. Rebuild avec 'npm run build'" -ForegroundColor Gray
Write-Host ""

Write-Host "Documentation complète: .\ag-doctor\README_VERSION_AWARE_PATCH.md" -ForegroundColor Cyan
