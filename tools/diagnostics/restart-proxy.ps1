$ErrorActionPreference = 'SilentlyContinue'
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

# Kill existing standalone proxy
Get-CimInstance Win32_Process -Filter 'Name="electron.exe"' | Where-Object { $_.CommandLine -like '*standalone-proxy-runner*' } | ForEach-Object {
  Stop-Process -Id $_.ProcessId -Force
  Write-Output ('killed ' + $_.ProcessId)
}
Start-Sleep -Seconds 2

# Remove old dump
Remove-Item 'C:\Users\Admin\AppData\Local\Temp\ag-fetchUserInfo-dump.json' -ErrorAction SilentlyContinue

# Start instrumented proxy
Start-Process -FilePath 'C:\Business\tools\solutions\antigravity-patch-proxy\ag-doctor-ui\node_modules\electron\dist\electron.exe' -ArgumentList 'C:\Business\tools\solutions\antigravity-patch-proxy\ag-doctor\scripts\proxy\standalone-proxy-runner.js' -RedirectStandardOutput 'C:\Users\Admin\AppData\Local\Temp\proxy-out2.log' -RedirectStandardError 'C:\Users\Admin\AppData\Local\Temp\proxy-err2.log' -WindowStyle Hidden
Start-Sleep -Seconds 6
Write-Output 'restarted'
