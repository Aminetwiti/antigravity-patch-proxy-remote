#!/bin/bash
# Script de déploiement pour le serveur Linux
# Ce script automatise la compilation et le redémarrage des services.

set -e

echo "🚀 Début du déploiement sur le serveur Linux..."

# 1. Aller dans le dossier du projet
cd "$(dirname "$0")"

# 2. Stopper les processus existants
echo "🛑 Arrêt des services Antigravity existants..."
pkill -f "Antigravity" || true
pkill -f "language_server" || true
sleep 2

# 3. Installer les dépendances et compiler le core
echo "📦 Compilation de ag-doctor..."
cd ag-doctor
npm install
npm run build
cd ..

# 4. Installer les dépendances et compiler l'UI
echo "🎨 Compilation de ag-doctor-ui..."
cd ag-doctor-ui
npm install
npm run build
cd ..

# 5. Redémarrer les services
echo "✅ Déploiement terminé avec succès. Vous pouvez maintenant relancer le binaire ou l'application."
