# scripts/supervise-proxy.ps1
# Watchdog & auto-guardian for Antigravity Patch Proxy (port 51074).
#
# Prevents:
#   1. Connection refused errors (127.0.0.1:51074) when proxy is down
#   2. "Error Loading Models" / language server panics
#   3. DNS failures (oauth2.googleapis.com: no such host)
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\supervise-proxy.ps1 -Once
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\supervise-proxy.ps1 -Loop

param(
    [switch]$Loop,
    [switch]$Once,
    [int]$IntervalSec = 3
)

$ErrorActionPreference = "SilentlyContinue"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$DoctorJs = Join-Path $RepoRoot "ag-doctor\bin\ag-doctor.js"
$ProxyPort = if ($env:AG_PROXY_PORT) { [int]$env:AG_PROXY_PORT } else { 51074 }
$LogDir = Join-Path $RepoRoot "logs"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
$SupLog = Join-Path $LogDir "proxy_supervisor.log"

function Write-Log($msg) {
    $line = "{0} [Watchdog] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
    Add-Content -Path $SupLog -Value $line -ErrorAction SilentlyContinue
    if (-not $Loop) { Write-Host $line }
}

function Test-AntigravityRunning {
    $procs = Get-Process -Name "Antigravity", "Antigravity IDE", "language_server", "language_server_windows_x64" -ErrorAction SilentlyContinue
    return ($procs -and $procs.Count -gt 0)
}

function Test-ProxyHealthy {
    try {
        $resp = Invoke-RestMethod -Uri "http://127.0.0.1:$ProxyPort/health" -TimeoutSec 2 -ErrorAction Stop
        return ($resp.status -eq "ok")
    } catch {
        return $false
    }
}

function Test-DnsHealthy {
    try {
        $ip = [System.Net.Dns]::GetHostAddresses("oauth2.googleapis.com")
        return ($ip -and $ip.Length -gt 0)
    } catch {
        return $false
    }
}

function Start-ProxyInstance {
    Write-Log "Proxy on port $ProxyPort is down. Reviving now..."
    if (Test-Path $DoctorJs) {
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = "node"
        $psi.Arguments = "`"$DoctorJs`" proxy start --port $ProxyPort"
        $psi.WorkingDirectory = $RepoRoot
        $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
        $psi.CreateNoWindow = $true
        $psi.UseShellExecute = $false
        [System.Diagnostics.Process]::Start($psi) | Out-Null
    }
    # Wait up to 4s for proxy to become ready
    for ($i = 0; $i -lt 8; $i++) {
        Start-Sleep -Milliseconds 500
        if (Test-ProxyHealthy) {
            Write-Log "Proxy successfully revived on port $ProxyPort."
            return $true
        }
    }
    Write-Log "WARN: Proxy did not respond within 4s."
    return $false
}

function Check-And-Fix {
    $agRunning = Test-AntigravityRunning
    $proxyOk = Test-ProxyHealthy

    if ($agRunning -and -not $proxyOk) {
        Write-Log "Antigravity is active but proxy :$ProxyPort is unreachable. Starting proxy..."
        Start-ProxyInstance
    }

    # Verify DNS health if Antigravity is active
    if ($agRunning) {
        if (-not (Test-DnsHealthy)) {
            Write-Log "DNS lookup for oauth2.googleapis.com failed. Flushing DNS cache..."
            ipconfig /flushdns | Out-Null
            Start-Sleep -Milliseconds 500
            if (Test-DnsHealthy) {
                Write-Log "DNS resolved successfully after flush."
            } else {
                Write-Log "WARN: DNS still unreachable. Check internet / network connection."
            }
        }
    }
}

# Main execution
if ($Once -or (-not $Loop)) {
    Check-And-Fix
    exit 0
}

Write-Log "Proxy watchdog loop started (polling every ${IntervalSec}s)..."

while ($true) {
    Check-And-Fix
    Start-Sleep -Seconds $IntervalSec
}
