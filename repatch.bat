@echo off
REM ============================================================
REM  repatch.bat — One-click Antigravity patch (any version)
REM ============================================================
REM  Auto-detects the installed product and applies the correct
REM  patch:
REM
REM    A) Antigravity IDE (v1.107.0+, VS Code-based)
REM         - settings override: jetski.cloudCodeUrl -> %DEFAULT_BIND_HOST%:%AG_PROXY_PORT%
REM         - starts the local proxy (real proxy via bundled Electron)
REM
REM    B) Classic Antigravity (2.x shell)
REM         - version-aware asar surgery (2.2.x / 2.3.x / ...)
REM         - binary patch: language_server URL -> %DEFAULT_BIND_HOST%:%AG_PROXY_PORT%
REM         - asar cache + auto-heal registration (survives official updates)
REM
REM  Pipeline:
REM    1. Stop Antigravity processes
REM    2. npm run build (compile TS to dist/)
REM    3. ag-doctor patch apply  (binary + IDE override, auto-detected)
REM    4. ag-doctor proxy start  (real proxy; stub fallback)
REM    5. Launch the detected app
REM ============================================================

setlocal EnableDelayedExpansion

set "SCRIPT_DIR=%~dp0"
set "AG_IDE=%LOCALAPPDATA%\Programs\Antigravity IDE"
set "AG_CLASSIC=%LOCALAPPDATA%\Programs\Antigravity"
set "AG_IDE_EXE=%AG_IDE%\Antigravity IDE.exe"
set "AG_CLASSIC_EXE=%AG_CLASSIC%\Antigravity.exe"
set "AG_ASAR=%AG_CLASSIC%\resources\app.asar"
set "AG_BIN_LS=%AG_CLASSIC%\resources\bin\language_server.exe"
set "PROXY_PORT=%AG_PROXY_PORT%"
if "!PROXY_PORT!"=="" set "PROXY_PORT=51074"
set "STAGING_DIR=%TEMP%\antigravity-asar-staging-%RANDOM%"
set "AG_SCRATCH=%USERPROFILE%\.gemini\antigravity\scratch"

cd /d "%SCRIPT_DIR%"

echo.
echo ============================================================
echo  Antigravity Patch (one-click, version-agnostic)
echo ============================================================
echo.

REM -- 1. Stop Antigravity + language servers + proxy-stub
echo [1/5] Stopping Antigravity processes...
powershell -ExecutionPolicy Bypass -Command "Stop-Process -Name 'Antigravity IDE', Antigravity, language_server, language_server_windows_x64 -Force -ErrorAction SilentlyContinue"
powershell -ExecutionPolicy Bypass -Command "Get-Process -Name node -ErrorAction SilentlyContinue | ForEach-Object { try { $cmd = (Get-CimInstance Win32_Process -Filter 'ProcessId='+$_.Id).CommandLine; if ($cmd -like '*proxy-stub*' -or $cmd -like '*standalone-proxy-runner*') { $_ | Stop-Process -Force } } catch {} }"
timeout /t 2 /nobreak >nul

REM -- 2. Build TS
echo [2/5] Building TypeScript...
call npm run build
if errorlevel 1 (
  echo   [WARN] tsc build failed -- continuing with existing dist/
)

REM -- 3. Patch Classic Antigravity (asar overlay) if present
if exist "%AG_CLASSIC_EXE%" (
  echo [3/5] Classic Antigravity found -- applying asar overlay...
  set "AG_ASAR=%AG_CLASSIC%\resources\app.asar"
  if not exist "!AG_ASAR!.bak" (
    copy /Y "!AG_ASAR!" "!AG_ASAR!.bak" >nul
    echo   Backup created: !AG_ASAR!.bak
    if exist "!AG_ASAR!.unpacked" (
      if not exist "!AG_ASAR!.bak.unpacked" (
        xcopy /E /I /H /Y "!AG_ASAR!.unpacked" "!AG_ASAR!.bak.unpacked" >nul
        echo   Backup created: !AG_ASAR!.bak.unpacked
      )
    )
  ) else (
    echo   Backup already exists at !AG_ASAR!.bak
  )
  set "STAGING_DIR=%TEMP%\antigravity-asar-staging-%RANDOM%"
  node "%SCRIPT_DIR%scripts\patch-version.js" "!AG_ASAR!.bak" "!STAGING_DIR!" "!AG_ASAR!"
  if errorlevel 1 (
    echo   [ERROR] Asar overlay failed. Restoring backup...
    copy /Y "!AG_ASAR!.bak" "!AG_ASAR!" >nul
  ) else (
    if exist "!STAGING_DIR!" rmdir /S /Q "!STAGING_DIR!"
    echo   Asar overlay applied.

    if not exist "%AG_SCRATCH%" mkdir "%AG_SCRATCH%"
    copy /Y "!AG_ASAR!" "%AG_SCRATCH%\app.asar.patched" >nul
    echo   Patched asar cached for auto-heal: %AG_SCRATCH%\app.asar.patched
    if exist "%AG_CLASSIC%\resources\app.asar.unpacked" (
      if exist "%AG_SCRATCH%\app.asar.unpacked" rmdir /S /Q "%AG_SCRATCH%\app.asar.unpacked"
      xcopy /E /I /H /Y "%AG_CLASSIC%\resources\app.asar.unpacked" "%AG_SCRATCH%\app.asar.unpacked" >nul
      echo   app.asar.unpacked cached as well
    )
    powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%scripts\register-auto-heal.ps1"
  )
)

if exist "%AG_IDE_EXE%" (
  echo   Found Antigravity IDE: %AG_IDE%
  set "TARGET=IDE"
) else (
  set "TARGET=CLASSIC"
)

REM -- 4. Binary patch (+ IDE override)
echo [4/5] Applying binary patch + IDE settings override (ag-doctor patch apply)...
node "%SCRIPT_DIR%ag-doctor\bin\ag-doctor.js" patch apply --yes
if errorlevel 1 (
  echo   [ERROR] Patch failed. Re-run ag-doctor repair to recover.
  exit /b 1
)

REM -- 5. Start the local proxy (real proxy via bundled Electron; stub fallback)
echo [5/5] Starting local proxy on port %PROXY_PORT%...
node "%SCRIPT_DIR%ag-doctor\bin\ag-doctor.js" proxy start
if errorlevel 1 (
  echo   [WARN] Proxy did not start cleanly -- models may not be injected.
)

REM -- Launch the detected app
echo.
echo ============================================================
REM TARGET is set inside the if-exist block above, and the else-branch
REM echo must not contain unescaped parentheses (cmd parses both branches
REM of an if/else as one block -- "(classic)" caused "... was unexpected
REM at this time." and broke the launch step).
if "!TARGET!"=="IDE" (
  echo  Launching Antigravity IDE...
  start "" "%AG_IDE_EXE%"
) else (
  echo  Launching Antigravity classic...
  start "" "%AG_CLASSIC_EXE%"
)

echo.
echo ============================================================
echo  Patch complete!
echo  - Custom models now route through the local proxy (port %PROXY_PORT%)
echo  - Cache + auto-heal configured for classic installs
echo  - Verify with:  ag-doctor doctor
echo ============================================================
echo.

endlocal
