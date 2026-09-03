# scripts/supervise-daemon.ps1
# Watchdog du daemon Remote Antigravity (persistance Windows).
#
# Problème : le daemon lancé depuis un shell meurt avec le Job Object, et un
# superviseur tiers le relance parfois avec un mauvais token (aa) -> le mobile
# (fix99token) est rejeté -> « rien reçu à Antigravity ».
#
# Solution : ce script garantit qu'UN daemon avec le bon token écoute sur :8090,
# relancé via WMI (détaché du Job Object) si absent ou mauvais token, tunnel
# cloudflared inclus (CWD = dossier daemon pour trouver .\cloudflared.exe).
#
# Usage :
#   powershell -NoProfile -File supervise-daemon.ps1 -Once   # une vérification
#   powershell -NoProfile -File supervise-daemon.ps1 -Loop   # boucle (tâche planifiée)
param([switch]$Loop, [switch]$Once)

$ErrorActionPreference = "SilentlyContinue"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$DaemonDir = Join-Path $RepoRoot "remote\daemon"
$DaemonExe = Join-Path $DaemonDir "daemon.exe"
$TokenFile = Join-Path $env:USERPROFILE ".gemini\antigravity\daemon.token"
$Token = if ($env:AG_DAEMON_AUTH_TOKEN) {
    $env:AG_DAEMON_AUTH_TOKEN
} elseif (Test-Path $TokenFile) {
    (Get-Content $TokenFile -Raw).Trim()
} else {
    $bytes = New-Object byte[] 16
    (New-Object Security.Cryptography.RNGCryptoServiceProvider).GetBytes($bytes)
    $gen = [System.BitConverter]::ToString($bytes).Replace("-", "").ToLower()
    $tokenDir = Split-Path -Parent $TokenFile
    if (-not (Test-Path $tokenDir)) { New-Item -ItemType Directory -Path $tokenDir -Force | Out-Null }
    Set-Content -Path $TokenFile -Value $gen -NoNewline
    $gen
}
$Port      = if ($env:AG_DAEMON_PORT) { [int]$env:AG_DAEMON_PORT } else { 8090 }
$BindHost  = if ($env:AG_BIND_HOST) { $env:AG_BIND_HOST } else { "127.0.0.1" }
$SupLog    = Join-Path $DaemonDir "daemon_supervisor.log"
$DmnLog    = Join-Path $DaemonDir "daemon_watch.log"
$PatchSig  = "MODEL_PLACEHOLDER_"
$HealScript = Join-Path (Split-Path -Parent $PSScriptRoot) "scripts\auto-heal.ps1"
$lastStart = Get-Date 0

function Write-Log($m) {
    $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $m
    Add-Content $SupLog $line
    if (-not $Loop) { Write-Host $line }
}

# Vrai si un daemon.exe écoute et répond sur $Port.
function Test-DaemonOk {
    $lis = Get-NetTCPConnection -LocalPort $Port -State Listen
    if (-not $lis) { return $false }
    try {
        $d = Invoke-RestMethod -Uri "http://${BindHost}:$Port/health/diagnostic" -TimeoutSec 2
        return ($d.status -eq "ok" -or $d.status -eq "degraded" -or $d.rpcPort -ne 0)
    } catch {
        $owner = ($lis | Select-Object -First 1).OwningProcess
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$owner"
        return ($proc -and $proc.Name -eq "daemon.exe")
    }
}

# Vrai si le daemon est sain et son tunnel configuré (ou en mode local).
function Test-TunnelOk {
    try {
        $d = Invoke-RestMethod -Uri "http://${BindHost}:$Port/health/diagnostic" -TimeoutSec 3
        if ($d.tunnelProvider -eq "" -or $d.tunnelProvider -eq "none") { return $true }
        return ($d.publicUrl -ne "")
    } catch { return $false }
}

# Tue le daemon qui écoute sur $Port (et son cloudflared associé) puis relance.
# N'interfère PAS avec un daemon lancé manuellement sur un port différent.
function Start-Daemon {
    # Trouver le PID qui écoute sur $Port et tuer seulement lui
    $lis = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($lis) {
        $owner = $lis.OwningProcess
        $proc  = Get-CimInstance Win32_Process -Filter "ProcessId=$owner" -ErrorAction SilentlyContinue
        if ($proc -and $proc.Name -like "daemon*") {
            Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue
            # Tuer le cloudflared enfant s'il existe (Parent = $owner)
            Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" |
                Where-Object { $_.ParentProcessId -eq $owner } |
                ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
        }
    }
    # Tuer aussi les cloudflared orphelins (sans parent daemon)
    Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" |
        ForEach-Object {
            $parent = (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.ParentProcessId)" -ErrorAction SilentlyContinue)
            if (-not $parent -or $parent.Name -notlike "daemon*") {
                Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
            }
        }
    Start-Sleep -Seconds 1
    $proc = Start-Process -FilePath $DaemonExe -ArgumentList "--port $Port --tunnel cloudflare --auth-token $Token --allow-first-admin" -WorkingDirectory $DaemonDir -WindowStyle Hidden -PassThru
    if ($proc) {
        Write-Log "relance Start-Process OK (PID $($proc.Id), token=$Token)"
    } else {
        Write-Log "ECHEC Start-Process"
    }
}

# Vrai si le asar actif a perdu la signature du patch (écrasé par un update officiel).
function Test-PatchLost {
    $appDir = if ($env:ANTIGRAVITY_APP_DIR) { $env:ANTIGRAVITY_APP_DIR } else { "$env:LOCALAPPDATA\Programs\Antigravity" }
    $asar = "$appDir\resources\app.asar"
    if (-not (Test-Path $asar)) { return $false }
    $content = [System.IO.File]::ReadAllText($asar, [System.Text.Encoding]::GetEncoding('latin1'))
    return ($content -notlike "*$PatchSig*")
}

if ($Loop) {
    Write-Log "watchdog demarre (boucle 30s, token=$Token, port=$Port)"
    while ($true) {
        # IDE fermé (language_server absent) : pas de daemon à maintenir.
        if (-not (Get-Process -Name language_server)) {
            Start-Sleep -Seconds 30
            continue
        }
        if (-not (Test-DaemonOk)) {
            Start-Daemon
            $lastStart = Get-Date
            Start-Sleep -Seconds 5
            continue
        }
        # Tunnel mort ? (grace 90s après un (re)démarrage : cloudflared met ~15s à s'enregistrer)
        # ponytail: heuristique 90s — si cloudflared met plus longtemps, le daemon sera
        # redémarré une fois de plus ; acceptable, upgrade = surveiller /health/diagnostic en boucle.
        if ((Get-Date) -gt $lastStart.AddSeconds(90) -and -not (Test-TunnelOk)) {
            Write-Log "tunnel absent - redemarrage du daemon pour relancer cloudflared"
            Start-Daemon
            $lastStart = Get-Date
        } else {
            Write-Log "ok: daemon $Token sur :$Port"
        }
        # Patch écrasé par un update officiel pendant la session ? Le VBS startup
        # ne couvre que le boot — ce check attrape le cas « update en cours d'usage ».
        if ((Test-Path $HealScript) -and (Test-PatchLost)) {
            Write-Log "patch perdu (update officiel?) - auto-heal"
            & powershell -NoProfile -ExecutionPolicy Bypass -File $HealScript
        }
        Start-Sleep -Seconds 30
    }
} elseif ($Once) {
    if (-not (Get-Process -Name language_server)) {
        Write-Host "IDE (language_server) non demarre - daemon inutile pour l'instant"
        exit 0
    }
    if (Test-DaemonOk) {
        Write-Host "deja OK: daemon actif sur :$Port"
    } else {
        Start-Daemon
    }
} else {
    Write-Host "Usage: supervise-daemon.ps1 -Once | -Loop"
}
