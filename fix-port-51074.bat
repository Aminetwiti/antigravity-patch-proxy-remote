@echo off
setlocal

:: Check for administrator privileges
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo ============================================================
    echo [!] Administrator privileges required.
    echo Requesting UAC elevation...
    echo ============================================================
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo ============================================================
echo  Fixing Port 51074 Windows NAT Exclusion Conflict
echo ============================================================
echo.
echo [1/4] Stopping Antigravity processes...
taskkill /F /IM Antigravity.exe >nul 2>&1
taskkill /F /IM language_server.exe >nul 2>&1

echo [2/4] Stopping WinNAT service...
net stop winnat

echo [3/4] Reconfiguring dynamic port range to start at 52000...
echo       (Ensures Windows NAT/Hyper-V/Docker will never exclude port 51074)
netsh int ipv4 set dynamicport tcp start=52000 num=13535

echo [4/4] Restarting WinNAT service...
net start winnat

echo.
echo ============================================================
echo  SUCCESS: Port 51074 is freed and permanently protected!
echo ============================================================
echo.
echo Relaunching Antigravity...
if exist "%LOCALAPPDATA%\Programs\antigravity\Antigravity.exe" (
    start "" "%LOCALAPPDATA%\Programs\antigravity\Antigravity.exe"
) else (
    start "" "C:\Users\amine\AppData\Local\Programs\antigravity\Antigravity.exe"
)
timeout /t 3 >nul
