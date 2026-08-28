# scripts/diag/launch-only.ps1
# Launches Antigravity using PowerShell (most reliable on Windows)
# and exits immediately so the caller doesn't block.

$ErrorActionPreference = 'Continue'
$AG_EXE = 'C:\Users\amine\AppData\Local\Programs\Antigravity\Antigravity.exe'

# Kill existing
try { Get-Process -Name Antigravity -ErrorAction SilentlyContinue | Stop-Process -Force } catch {}

# Wait then launch
Start-Sleep -Milliseconds 200
try {
    Start-Process -FilePath $AG_EXE -ErrorAction Stop
    Write-Host 'launched OK'
} catch {
    Write-Host "launch failed: $_"
    exit 1
}
