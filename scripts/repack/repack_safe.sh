#!/bin/bash
# Safe repack: overlay only dist/proxy.js onto the current app.asar
# preserving all other runtime files and previous patches.
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIST="$SCRIPT_DIR/dist"
ASAR_PATH="${AG_ASAR_PATH:-/mnt/c/Users/${USER:-Default}/AppData/Local/Programs/Antigravity/resources/app.asar}"
BACKUP_PATH="${ASAR_PATH}.pre-dnsfix.bak"
STAGE_DIR="/tmp/antigravity_repack_dnsfix_$$"

echo "============================================"
echo "  Safe repack: DNS bypass for Google upstream"
echo "============================================"

# 1. Stop Antigravity (Windows processes from WSL)
echo ""
echo "[1/6] Stopping Antigravity..."
taskkill.exe /IM Antigravity.exe /F 2>/dev/null || true
taskkill.exe /IM language_server.exe /F 2>/dev/null || true
sleep 3
echo "   OK"

# 2. Backup current asar if not already backed up
echo ""
echo "[2/6] Backing up current app.asar..."
if [ ! -f "$BACKUP_PATH" ]; then
    cp "$ASAR_PATH" "$BACKUP_PATH"
    echo "   Backup created: $BACKUP_PATH"
else
    echo "   Backup already exists: $BACKUP_PATH"
fi

# 3. Extract current asar
echo ""
echo "[3/6] Extracting current app.asar..."
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR"
npx -y @electron/asar extract "$ASAR_PATH" "$STAGE_DIR/base"
echo "   OK"

# 4. Overlay dist/proxy.js
echo ""
echo "[4/6] Overlaying dist/proxy.js..."
if [ ! -f "$PROJECT_DIST/proxy.js" ]; then
    echo "   ERROR: dist/proxy.js not found. Run 'npm run build' first."
    rm -rf "$STAGE_DIR"
    exit 1
fi
cp "$PROJECT_DIST/proxy.js" "$STAGE_DIR/base/dist/proxy.js"
echo "   OK"

# 5. Repack
echo ""
echo "[5/6] Repacking app.asar..."
npx -y @electron/asar pack "$STAGE_DIR/base" "$ASAR_PATH" --unpack-dir "{node_modules,scratch,.git}"
echo "   OK"

# 6. Cleanup
echo ""
echo "[6/6] Cleaning up..."
rm -rf "$STAGE_DIR"
echo "   OK"

echo ""
echo "============================================"
echo "  SUCCESS! Restart Antigravity to apply."
echo "  Backup: $BACKUP_PATH"
echo "============================================"
