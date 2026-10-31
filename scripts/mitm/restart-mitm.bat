@echo off
REM Kill any process holding the configured proxy port then start a new MITM forwarder.
set PORT=%AG_PROXY_PORT%
if "%PORT%"=="" set PORT=51074
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R "[: ]%PORT% .*LISTENING"') do (
  echo Killing PID %%P on %PORT%...
  taskkill /F /T /PID %%P 2>&1
)
timeout /t 3 /nobreak >nul

echo.
echo Starting new MITM forwarder...
cd /d "%~dp0..\.."
node scripts\mitm\mitm_443.js