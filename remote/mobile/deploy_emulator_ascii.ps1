# One-shot deploy v2: keep adb daemon ALIVE across all steps (single process tree).
$ErrorActionPreference = "Continue"
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
$apk = "$PSScriptRoot\build\app\outputs\flutter-apk\app-debug.apk"
$pkg = "com.antigravity.remote.mobile"

function Run-Adb([string[]]$args) {
    & $adb @args 2>&1
    return $LASTEXITCODE
}

# 1. Clean daemon state
& $adb kill-server 2>$null | Out-Null
Start-Sleep -Seconds 2

# 2. Start server DETACHED so it survives this PS process exit
Start-Process -FilePath $adb -ArgumentList "start-server" -WindowStyle Hidden | Out-Null
Write-Output "adb start-server launched"
Start-Sleep -Seconds 5

# 3. Wait for device online
$ok = $false
for ($i = 0; $i -lt 30; $i++) {
    $devices = (& $adb devices 2>&1) | Out-String
    if ($devices -match "emulator-\d+\s+device") { $ok = $true; Write-Output "DEVICE ONLINE after ${i}x3s"; break }
    if ($devices -match "emulator-\d+\s+offline") { Write-Output "device OFFLINE (attempt $i) - restarting adb"; & $adb kill-server 2>$null | Out-Null; Start-Sleep -Seconds 1; Start-Process -FilePath $adb -ArgumentList "start-server" -WindowStyle Hidden | Out-Null }
    Start-Sleep -Seconds 3
}
if (-not $ok) { Write-Output "DEVICE NEVER ONLINE"; & $adb devices; exit 1 }
& $adb devices

# 4. adb reverse for daemon port
& $adb -s emulator-5554 reverse tcp:8090 tcp:8090 2>&1 | Out-Null
& $adb reverse --list

# 5. Push APK
& $adb -s emulator-5554 push $apk /data/local/tmp/app-debug.apk
if ($LASTEXITCODE -ne 0) { Write-Output "PUSH FAILED"; exit 1 }

# 6. pm install
& $adb -s emulator-5554 shell pm install -r -t /data/local/tmp/app-debug.apk
if ($LASTEXITCODE -ne 0) { Write-Output "PM INSTALL FAILED"; exit 1 }

# 7. Launch
& $adb -s emulator-5554 shell am start -n $pkg/.MainActivity
Write-Output "DONE"


