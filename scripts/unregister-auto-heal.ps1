# scripts/unregister-auto-heal.ps1
# Supprime le VBS auto-heal du dossier Startup Windows.
#
# Usage :
#   powershell -NoProfile -ExecutionPolicy Bypass -File unregister-auto-heal.ps1

$ErrorActionPreference = "SilentlyContinue"

$startupDir = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup"
$vbsPath    = Join-Path $startupDir "AntigravityPatchAutoHealer.vbs"

if (Test-Path $vbsPath) {
    Remove-Item -Path $vbsPath -Force
    Write-Host "Auto-healer desactive: $vbsPath supprime." -ForegroundColor Green
} else {
    Write-Host "Auto-healer n'etait pas actif dans le dossier Startup." -ForegroundColor Yellow
}
