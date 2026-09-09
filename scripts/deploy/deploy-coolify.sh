#!/usr/bin/env bash
# ==============================================================================
# Antigravity Remote Agent Cloud — Coolify & Docker Deployment Script
# ==============================================================================
# Usage:
#   ./scripts/deploy/deploy-coolify.sh
#
# Environment variables (optional):
#   COOLIFY_URL         Coolify instance URL (e.g. https://coolify.example.com)
#   COOLIFY_API_TOKEN   Coolify Bearer API token
#   COOLIFY_APP_UUID    UUID of the application in Coolify
#   AUTH_TOKEN          Daemon auth token for WebSocket / REST bridge
#   PORT                Port to bind (default: 8090)
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
DAEMON_DIR="${REPO_ROOT}/remote/daemon"

echo "========================================================"
echo "  Antigravity Remote Cloud — Headless Daemon Deployment"
echo "========================================================"

# Check if Coolify API deployment is requested
if [[ -n "${COOLIFY_URL:-}" && -n "${COOLIFY_API_TOKEN:-}" ]]; then
    echo "📡 Mode: Déploiement via Coolify API..."
    COOLIFY_URL="${COOLIFY_URL%/}"
    
    if [[ -z "${COOLIFY_APP_UUID:-}" ]]; then
        echo "⚠️ COOLIFY_APP_UUID non spécifié. Récupération des applications..."
        APPS=$(curl -s -f -H "Authorization: Bearer ${COOLIFY_API_TOKEN}" "${COOLIFY_URL}/api/v1/applications" || echo "[]")
        echo "Applications trouvées dans Coolify : ${APPS}"
        echo "Veuillez exporter COOLIFY_APP_UUID pour déclencher le build distant."
        exit 1
    fi

    echo "🚀 Déclenchement du déploiement pour l'application ${COOLIFY_APP_UUID}..."
    DEPLOY_RES=$(curl -s -X POST \
        -H "Authorization: Bearer ${COOLIFY_API_TOKEN}" \
        -H "Content-Type: application/json" \
        "${COOLIFY_URL}/api/v1/deploy?uuid=${COOLIFY_APP_UUID}")
    
    echo "Réponse de déploiement Coolify : ${DEPLOY_RES}"
    echo "✅ Déploiement Coolify initié avec succès !"
    exit 0
fi

# Fallback mode: Local / VPS Docker Compose
echo "🐳 Mode: Déploiement local / VPS avec Docker Compose..."

if ! command -v docker &>/dev/null; then
    echo "❌ Erreur: Docker n'est pas installé sur ce système."
    exit 1
fi

cd "${DAEMON_DIR}"

echo "📦 Construction de l'image Docker headless..."
docker compose build --pull

echo "🚀 Lancement du conteneur antigravity-remote-daemon..."
docker compose up -d

echo "🔍 Vérification de la santé du service (health check)..."
MAX_RETRIES=15
COUNT=0
HEALTHY=false

while [[ ${COUNT} -lt ${MAX_RETRIES} ]]; do
    if curl -s -f "http://localhost:${PORT:-8090}/health" >/dev/null 2>&1; then
        HEALTHY=true
        break
    fi
    echo "   En attente du démarrage du daemon (${COUNT}/${MAX_RETRIES})..."
    sleep 2
    COUNT=$((COUNT + 1))
done

if [[ "${HEALTHY}" = true ]]; then
    echo "✅ Le daemon Antigravity Remote Cloud est opérationnel sur le port ${PORT:-8090} !"
    echo "📊 Journalisation : docker compose logs -f antigravity-daemon"
else
    echo "⚠️ Le daemon a démarré mais le healthcheck ne répond pas encore."
    echo "Vérifiez les logs avec : docker compose logs antigravity-daemon"
fi

