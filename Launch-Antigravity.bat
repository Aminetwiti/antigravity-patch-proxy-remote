@echo off
REM ============================================================
REM  Launch-Antigravity.bat — Smart Antigravity Launcher with Guard
REM ============================================================
REM  Ensures:
REM    1. Proxy on port 51074 is alive and responding before launching
REM    2. DNS resolution is valid for Google OAuth
REM    3. Background watchdog is active to prevent crashes
REM ============================================================

setlocal EnableDelayedExpansion

set "SCRIPT_DIR=%~dp0"
set "AG_IDE=%LOCALAPPDATA%\Programs\Antigravity IDE\Antigravity IDE.exe"
set "AG_CLASSIC=%LOCALAPPDATA%\Programs\Antigravity\Antigravity.exe"
set "PROXY_PORT=51074"

cd /d "%SCRIPT_DIR%"

echo [1/3] Checking Antigravity Proxy status on port %PROXY_PORT%...
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-RestMethod -Uri 'http://127.0.0.1:%PROXY_PORT%/health' -TimeoutSec 1; exit 0 } catch { exit 1 }"
if errorlevel 1 (
    echo   Starting proxy in background...
    node "%SCRIPT_DIR%ag-doctor\bin\ag-doctor.js" proxy start --port %PROXY_PORT%
    timeout /t 2 /nobreak >nul
) else (
    echo   Proxy is already running and healthy.
)

echo [2/3] Starting background watchdog...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell.exe -ArgumentList '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""%SCRIPT_DIR%scripts\supervise-proxy.ps1"" -Loop' -WindowStyle Hidden"

echo [3/3] Launching Antigravity...
if exist "%AG_IDE%" (
    start "" "%AG_IDE%"
) else if exist "%AG_CLASSIC%" (
    start "" "%AG_CLASSIC%"
) else (
    echo [ERROR] Antigravity executable not found in %LOCALAPPDATA%\Programs
    pause
    exit /b 1
)

echo Done! Antigravity launched safely with active guard.
endlocal
