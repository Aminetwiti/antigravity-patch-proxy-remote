# scripts/diag/relaunch.ps1 — Cleanly relaunch Antigravity + capture logs
$ErrorActionPreference = 'Continue'

$AG_INSTALL = Join-Path $env:LOCALAPPDATA 'Programs\Antigravity'
$AG_EXE     = Join-Path $AG_INSTALL 'Antigravity.exe'
$LOG_DIR    = Join-Path $env:USERPROFILE 'AppData\Roaming\Antigravity\logs'
$STAMP      = (Get-Date).ToString('yyyyMMdd-HHmmss')
$PROXY_PORT = if ($env:AG_PROXY_PORT) { $env:AG_PROXY_PORT } else { '51074' }

Write-Host '=== Step 1: Kill all Antigravity-related processes ===' -ForegroundColor Cyan
foreach ($n in @('Antigravity.exe', 'language_server.exe')) {
    try {
        & taskkill /F /IM $n /T 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) { Write-Host "  killed $n" }
    } catch { }
}

# Kill node processes whose command line mentions proxy-runner / ag-doctor
try {
    $procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'"
    foreach ($p in $procs) {
        if ($p.CommandLine -match 'proxy-runner|ag-doctor') {
            Write-Host "  killing node.exe pid=$($p.ProcessId) ($($p.CommandLine.Substring(0, [Math]::Min(80, $p.CommandLine.Length))))..."
            & taskkill /F /PID $p.ProcessId /T 2>&1 | Out-Null
        }
    }
} catch { }

Write-Host ''
Write-Host '=== Step 2: Backup logs ===' -ForegroundColor Cyan
foreach ($f in @('main.log', 'renderer.log', 'language_server.log')) {
    $p = Join-Path $LOG_DIR $f
    if (Test-Path $p) {
        $bak = "$p.pre-$STAMP.bak"
        try { Copy-Item $p $bak -Force; Write-Host "  backed up $f" }
        catch { Write-Host "  backup $f failed (locked): $($_.Exception.Message)" }
    } else { Write-Host "  $f does not exist" }
}

Write-Host ''
Write-Host "=== Step 3: Free port $PROXY_PORT ===" -ForegroundColor Cyan
try {
    $busy = Get-NetTCPConnection -LocalPort $PROXY_PORT -ErrorAction SilentlyContinue
    if ($busy) {
        foreach ($c in $busy) {
            Write-Host "  killing PID $($c.OwningProcess) on port $PROXY_PORT"
            try { & taskkill /F /PID $c.OwningProcess /T 2>&1 | Out-Null } catch { }
        }
        Start-Sleep -Seconds 1
    }
    $busy2 = Get-NetTCPConnection -LocalPort $PROXY_PORT -ErrorAction SilentlyContinue
    if ($busy2) { Write-Host "  WARNING: port $PROXY_PORT still busy" }
    else { Write-Host "  port $PROXY_PORT free" }
} catch { Write-Host '  port check skipped' }

Write-Host ''
Write-Host '=== Step 4: Launch Antigravity ===' -ForegroundColor Cyan
Start-Sleep -Seconds 2
try {
    Start-Process -FilePath $AG_EXE
    Write-Host "  launched $AG_EXE"
} catch {
    Write-Host "  launch failed: $($_.Exception.Message)"
}

Write-Host ''
Write-Host '=== Step 5: Wait 12s and dump logs ===' -ForegroundColor Cyan
Start-Sleep -Seconds 12

Write-Host ''
Write-Host '--- main.log (size + tail 50) ---' -ForegroundColor Yellow
$main = Join-Path $LOG_DIR 'main.log'
if (Test-Path $main) {
    $info = Get-Item $main
    Write-Host "  size=$($info.Length) B  mtime=$($info.LastWriteTime.ToString('HH:mm:ss'))"
    Get-Content $main -Tail 50
} else { Write-Host '  (missing)' }

Write-Host ''
Write-Host '--- renderer.log (size + tail 50) ---' -ForegroundColor Yellow
$ren = Join-Path $LOG_DIR 'renderer.log'
if (Test-Path $ren) {
    $info = Get-Item $ren
    Write-Host "  size=$($info.Length) B  mtime=$($info.LastWriteTime.ToString('HH:mm:ss'))"
    Get-Content $ren -Tail 50
} else { Write-Host '  (does not exist)' }

Write-Host ''
Write-Host '--- language_server.log (size + tail 30) ---' -ForegroundColor Yellow
$ls = Join-Path $LOG_DIR 'language_server.log'
if (Test-Path $ls) {
    $info = Get-Item $ls
    Write-Host "  size=$($info.Length) B  mtime=$($info.LastWriteTime.ToString('HH:mm:ss'))"
    Get-Content $ls -Tail 30
} else { Write-Host '  (missing)' }

Write-Host ''
Write-Host "--- port $PROXY_PORT ---" -ForegroundColor Yellow
try {
    Get-NetTCPConnection -LocalPort $PROXY_PORT -ErrorAction SilentlyContinue |
        Format-Table -AutoSize | Out-String | Write-Host
} catch { Write-Host '  no listener' }

Write-Host ''
Write-Host '--- Antigravity processes ---' -ForegroundColor Yellow
try {
    Get-Process -Name Antigravity, language_server -ErrorAction SilentlyContinue |
        Select-Object Id, ProcessName, StartTime | Format-Table -AutoSize | Out-String | Write-Host
} catch { Write-Host '  (none)' }

Write-Host ''
Write-Host '=== DONE ===' -ForegroundColor Cyan
