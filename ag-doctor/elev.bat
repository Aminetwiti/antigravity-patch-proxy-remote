@echo off && cd /d "%~dp0" && node bin\ag-doctor.js mitm proxy-on --yes && echo ---STATUS--- && node bin\ag-doctor.js mitm status && pause
