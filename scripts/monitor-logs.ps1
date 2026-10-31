# scripts/monitor-logs.ps1
# Continuous real-time monitor for Antigravity Proxy & Language Server logs

$logPath = "$env:APPDATA\Antigravity\logs\main.log"
if (-not (Test-Path $logPath)) {
    Write-Host "[Monitor] Waiting for log file: $logPath"
    while (-not (Test-Path $logPath)) { Start-Sleep -Milliseconds 500 }
}

Write-Host "════════════════════════════════════════════════════════════════"
Write-Host " [MONITOR] Antigravity Real-Time Proxy & Performance Watcher"
Write-Host " Log: $logPath"
Write-Host "════════════════════════════════════════════════════════════════"

$count200 = 0
$countErr = 0
$latencies = [System.Collections.Generic.List[int]]::new()
$lastReport = [DateTime]::UtcNow

Get-Content -Path $logPath -Wait -Tail 20 | ForEach-Object {
    $line = $_
    
    # 200 OK feedback
    if ($line -match "HTTP 200 OK \((\d+)ms\)") {
        $ms = [int]$matches[1]
        $count200++
        $latencies.Add($ms)
        $accMatch = [regex]::Match($line, "Account: \[([^\]]+)\]")
        $acc = if ($accMatch.Success) { $accMatch.Groups[1].Value } else { "unknown" }
        Write-Host "✅ [200 OK] $acc -> ${ms}ms" -ForegroundColor Green
    }
    # Timeouts or errors
    elseif ($line -match "(timed out|stalled connection|HTTP 429|HTTP 503|HTTP 500|HTTP 404|RESOURCE_EXHAUSTED|MODEL_CAPACITY_EXHAUSTED)") {
        $countErr++
        Write-Host "⚠️ [ALERT] $line" -ForegroundColor Yellow
    }
    elseif ($line -match "(Client cancelled or closed connection|HTTP 499)") {
        Write-Host "🛑 [499] $line" -ForegroundColor DarkYellow
    }
    
    # Periodic report every 15 seconds if there was activity
    $now = [DateTime]::UtcNow
    if (($now - $lastReport).TotalSeconds -ge 15) {
        $avgLat = if ($latencies.Count -gt 0) {
            [math]::Round(($latencies | Measure-Object -Average).Average)
        } else { 0 }
        
        Write-Host "── [Stats: Last 15s] 200 OK: $count200 ($avgLat ms avg) | Anomalies/Alerts: $countErr ──" -ForegroundColor Cyan
        $count200 = 0
        $countErr = 0
        $latencies.Clear()
        $lastReport = $now
    }
}

