@echo off
REM Kill any process holding the configured proxy port (no hardcoded PID).
set PORT=%AG_PROXY_PORT%
if "%PORT%"=="" set PORT=51074
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R "[: ]%PORT% .*LISTENING"') do (
  echo Killing PID %%P on %PORT%
  taskkill /F /T /PID %%P
)
echo DONE > "%TEMP%\kill-done.txt"