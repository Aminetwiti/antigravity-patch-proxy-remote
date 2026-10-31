#!/usr/bin/env bash
# Suivi des logs Antigravity depuis WSL.
# Le lancement de l'application Windows doit etre fait cote Windows
# (voir launch-antigravity-and-logs.ps1).
set -euo pipefail

cd "$(dirname "$0")/ag-doctor"
npm run build >/dev/null 2>&1 || true
exec node bin/ag-doctor.js logs -f -n "${1:-50}"
