$ErrorActionPreference = 'SilentlyContinue'
# Clear the env var that breaks Electron GUI apps in this dev session
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
# Also clear any stale single-instance lock
Start-Process 'C:\Users\Admin\AppData\Local\Programs\Antigravity IDE\Antigravity IDE.exe'
Start-Sleep -Seconds 20
$p = Get-Process 'Antigravity IDE' -ErrorAction SilentlyContinue
Write-Output ('IDE process count after launch: ' + ($p | Measure-Object).Count)
