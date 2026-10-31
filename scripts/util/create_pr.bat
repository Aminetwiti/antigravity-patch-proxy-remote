@echo off
set PATH=C:\Program Files\GitHub CLI;%PATH%
cd /d "%~dp0..\.."
gh pr create --repo vahapogut/antigravity-add-model --head Aminetwiti:main --base main --title "Sync fork with TypeScript migration and ag-doctor-ui renderer" --body-file .git\PR_BODY.md
