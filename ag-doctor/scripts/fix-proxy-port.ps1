#Requires -Version 5.1
<#
.SYNOPSIS
    Self-elevating helper that fixes the WinHTTP proxy to 127.0.0.1:<AG_PROXY_PORT>.

.DESCRIPTION
    When run from a non-elevated PowerShell, `netsh winhttp set proxy` triggers
    a UAC prompt. If the prompt is dismissed or the shell is closed before the
    command completes, the change is lost and the window disappears.

    This script:
      1. Detects whether the current session is already elevated.
      2. If not, re-launches itself via Start-Process -Verb RunAs (UAC prompt).
      3. Runs the netsh command.
      4. Verifies the change with `netsh winhttp show proxy`.
      5. Pauses so you can read the output.

    Usage: just double-click the file, or run from any PowerShell:
        powershell -ExecutionPolicy Bypass -File .\fix-proxy-port.ps1
#>

$ErrorActionPreference = 'Stop'
$ExpectedPort = if ($env:AG_PROXY_PORT) { [int]$env:AG_PROXY_PORT } else { 51074 }
$BindHost = if ($env:AG_BIND_HOST) { $env:AG_BIND_HOST } else { '127.0.0.1' }
$ProxyValue  = "${BindHost}:$ExpectedPort"

function Is-Elevated {
    $id = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $p  = New-Object System.Security.Principal.WindowsPrincipal($id)
    return $p.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Is-Elevated)) {
    Write-Host "[fix-proxy-port] not elevated, requesting UAC..." -ForegroundColor Yellow
    $args = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"")
    try {
        $proc = Start-Process -FilePath 'powershell.exe' -ArgumentList $args -Verb RunAs -PassThru
        # Wait for the elevated child to finish so we can show its exit code
        $proc.WaitForExit()
        exit $proc.ExitCode
    } catch {
        Write-Host "[fix-proxy-port] UAC was dismissed or failed: $($_.Exception.Message)" -ForegroundColor Red
        Read-Host "Press Enter to close"
        exit 1
    }
}

# --- Elevated code path ---
Write-Host "[fix-proxy-port] running elevated" -ForegroundColor Cyan
Write-Host "[fix-proxy-port] setting WinHTTP proxy to $ProxyValue" -ForegroundColor Cyan

try {
    $out = netsh winhttp set proxy proxy-server="$ProxyValue" 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[fix-proxy-port] netsh failed (exit $LASTEXITCODE):" -ForegroundColor Red
        $out | ForEach-Object { Write-Host "  $_" }
        Read-Host "Press Enter to close"
        exit $LASTEXITCODE
    }
    Write-Host "[fix-proxy-port] netsh OK" -ForegroundColor Green
} catch {
    Write-Host "[fix-proxy-port] netsh threw: $($_.Exception.Message)" -ForegroundColor Red
    Read-Host "Press Enter to close"
    exit 1
}

Write-Host ""
Write-Host "[fix-proxy-port] verifying..." -ForegroundColor Cyan
netsh winhttp show proxy | ForEach-Object { Write-Host "  $_" }

Write-Host ""
Write-Host "[fix-proxy-port] done. You can close this window or press Enter." -ForegroundColor Green
Read-Host "Press Enter to close"
exit 0
