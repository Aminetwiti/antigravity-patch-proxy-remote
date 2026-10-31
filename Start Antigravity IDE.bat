@echo off
REM ============================================================
REM  Start Antigravity IDE (with background proxy)
REM ============================================================

set "SCRIPT_DIR=%~dp0"
set "AG_IDE=%LOCALAPPDATA%\Programs\Antigravity IDE\Antigravity IDE.exe"

cd /d "%SCRIPT_DIR%"

REM 1. Demarrer le proxy en arriere-plan s'il n'est pas deja en ecoute
powershell -NoProfile -ExecutionPolicy Bypass -Command "if (-not (Get-NetTCPConnection -LocalPort 51074 -State Listen -ErrorAction SilentlyContinue)) { Start-Process node -ArgumentList 'ag-doctor/bin/ag-doctor.js proxy start' -WindowStyle Hidden }"

REM 2. Lancer Antigravity IDE
if exist "%AG_IDE%" (
    start "" "%AG_IDE%" %*
) else (
    echo [ERREUR] Antigravity IDE non trouve a : "%AG_IDE%"
    pause
)
