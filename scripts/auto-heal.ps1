# scripts/auto-heal.ps1
# Auto-healer du patch Antigravity (porté de Antigravity-Chinese/auto_heal.ps1).
#
# Problème : une mise à jour officielle d'Antigravity remplace resources\app.asar
# et efface le patch (modèles custom, proxy). repatch.bat garde un .bak unique,
# mais rien ne restaure après un update.
#
# Solution : le asar patché est mis en cache dans ~/.gemini\antigravity\scratch\
# par repatch.bat. Ce script, lancé au démarrage Windows via un VBS Startup,
# vérifie si le asar actif contient encore la signature du patch et le restaure
# depuis le cache sinon.
#
# Usage :
#   powershell -NoProfile -ExecutionPolicy Bypass -File auto-heal.ps1

$ErrorActionPreference = "SilentlyContinue"

$appPath   = "$env:LOCALAPPDATA\Programs\Antigravity"
$asarPath  = "$appPath\resources\app.asar"
$scratch   = "$env:USERPROFILE\.gemini\antigravity\scratch"
$cached    = "$scratch\app.asar.patched"
$cachedUn  = "$scratch\app.asar.unpacked"
$destUn    = "$appPath\resources\app.asar.unpacked"

# Signature du patch : chaque modèle custom injecté porte un ID
# MODEL_PLACEHOLDER_<hash> (voir AGENTS.md §6). Absente de l'asar officiel.
$Signature = "MODEL_PLACEHOLDER_"

if (-not (Test-Path $asarPath) -or -not (Test-Path $cached)) {
    exit 0
}

try {
    # Lecture en latin1 (l'asar est binaire ; la signature est ASCII).
    $content = [System.IO.File]::ReadAllText($asarPath, [System.Text.Encoding]::GetEncoding('latin1'))
    if ($content -like "*$Signature*") {
        exit 0 # patch toujours en place
    }

    # L'update a écrasé le patch. Tuer l'app pour libérer le verrou fichier.
    $wasRunning = $false
    $procs = Get-Process -Name "Antigravity", "language_server" -ErrorAction SilentlyContinue
    if ($procs) {
        $wasRunning = $true
        Stop-Process -Name "Antigravity", "language_server" -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
    }

    Copy-Item -Path $cached -Destination $asarPath -Force

    if (Test-Path $cachedUn) {
        if (Test-Path $destUn) {
            Remove-Item -Path $destUn -Recurse -Force
        }
        Copy-Item -Path $cachedUn -Destination "$appPath\resources" -Recurse -Force
    }

    # Relance l'app pour que l'utilisateur ne voie pas de disruption.
    if ($wasRunning) {
        Start-Process -FilePath "$appPath\Antigravity.exe"
    }
} catch {
    # Échoue silencieusement en arrière-plan (ne jamais déranger l'utilisateur).
}

# Assure que le proxy local (port 51074) est toujours démarré pour Antigravity IDE
try {
    $repoDir = Split-Path -Parent $PSScriptRoot
    $doctorJs = Join-Path $repoDir "ag-doctor\bin\ag-doctor.js"
    if (Test-Path $doctorJs) {
        $lis = Get-NetTCPConnection -LocalPort 51074 -State Listen -ErrorAction SilentlyContinue
        if (-not $lis) {
            Start-Process -FilePath "node" -ArgumentList "`"$doctorJs`" proxy start" -WorkingDirectory $repoDir -WindowStyle Hidden
        }
    }
} catch {}
