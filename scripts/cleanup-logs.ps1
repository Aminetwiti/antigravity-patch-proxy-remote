# c:\Users\amine\Downloads\antigravity-add-model-main\antigravity-add-model-main\scripts\cleanup-logs.ps1
# Script de nettoyage et rotation des logs Antigravity

$logPath = "$env:APPDATA\Antigravity\logs"
$daysToKeep = 7

Write-Host "🧹 Nettoyage des logs Antigravity..." -ForegroundColor Cyan
Write-Host "Dossier source : $logPath" -ForegroundColor Gray

if (-not (Test-Path $logPath)) {
    Write-Host "❌ Le dossier des logs n'existe pas." -ForegroundColor Red
    exit
}

# Récupérer les fichiers logs et sauvegardes
$logFiles = Get-ChildItem $logPath -File | Where-Object { $_.Name -like "*.log*" -or $_.Name -like "*.bak" }
$logDirs = Get-ChildItem $logPath -Directory

$deletedCount = 0
$savedSpace = 0

$limitDate = (Get-Date).AddDays(-$daysToKeep)

foreach ($file in $logFiles) {
    if ($file.LastWriteTime -lt $limitDate) {
        $size = $file.Length
        try {
            Remove-Item $file.FullName -Force -ErrorAction Stop
            Write-Host "  🗑️ Supprimé : $($file.Name) ($([math]::Round($size / 1KB, 2)) KB)" -ForegroundColor Gray
            $deletedCount++
            $savedSpace += $size
        } catch {
            Write-Host "  ⚠️ Impossible de supprimer : $($file.Name) (Fichier probablement verrouillé)" -ForegroundColor Yellow
        }
    }
}

foreach ($dir in $logDirs) {
    if ($dir.LastWriteTime -lt $limitDate) {
        try {
            $dirSize = (Get-ChildItem $dir.FullName -Recurse -File | Measure-Object -Property Length -Sum).Sum
            Remove-Item $dir.FullName -Recurse -Force -ErrorAction Stop
            Write-Host "  🗑️ Dossier supprimé : $($dir.Name) ($([math]::Round($dirSize / 1KB, 2)) KB)" -ForegroundColor Gray
            $deletedCount++
            $savedSpace += $dirSize
        } catch {
            Write-Host "  ⚠️ Impossible de supprimer dossier : $($dir.Name)" -ForegroundColor Yellow
        }
    }
}

$savedSpaceMB = [math]::Round($savedSpace / 1MB, 2)
Write-Host "--------------------------------------------------" -ForegroundColor Cyan
Write-Host "✅ Nettoyage terminé." -ForegroundColor Green
Write-Host "Fichiers supprimés : $deletedCount" -ForegroundColor Green
Write-Host "Espace libéré : $savedSpaceMB MB" -ForegroundColor Green
