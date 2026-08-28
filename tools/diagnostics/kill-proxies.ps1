$ErrorActionPreference = 'SilentlyContinue'
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

# Kill all proxy/stub/worker electron processes to remove port conflicts
Get-CimInstance Win32_Process -Filter 'Name="electron.exe"' | Where-Object {
  $_.CommandLine -like '*standalone-proxy-runner*' -or
  $_.CommandLine -like '*proxy-stub*' -or
  $_.CommandLine -like '*ag-doctor.js --worker*' -or
  $_.CommandLine -like '*proxy-stub.js*'
} | ForEach-Object {
  Stop-Process -Id $_.ProcessId -Force
  Write-Output ('killed ' + $_.ProcessId)
}
Start-Sleep -Seconds 3

# Confirm nothing holds 51074
$conn = Get-NetTCPConnection -LocalPort 51074 -State Listen -ErrorAction SilentlyContinue
Write-Output ('51074 listeners remaining: ' + (($conn | Measure-Object).Count))
