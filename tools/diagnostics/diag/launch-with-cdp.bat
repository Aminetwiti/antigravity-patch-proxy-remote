@echo off
REM scripts/diag/launch-with-cdp.bat
REM Launches Antigravity with remote debugging enabled on port 9229
REM so we can introspect the renderer via Chrome DevTools Protocol.
start "" "C:\Users\amine\AppData\Local\Programs\Antigravity\Antigravity.exe" --remote-debugging-port=9229 --remote-allow-origins=*