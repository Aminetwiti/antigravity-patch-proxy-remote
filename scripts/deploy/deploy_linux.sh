#!/bin/bash
# Antigravity Safe Deploy (Linux)
# Re-packages dist/ into the app.asar inside the Antigravity installation
# Usage: bash deploy_linux.sh

set -e

echo "============================================"
echo "  Antigravity Safe Deploy Script (Linux)"
echo "============================================"

# 1. Kill Antigravity
echo ""
echo "[1/6] Stopping Antigravity..."
pkill -f "Antigravity" 2>/dev/null || true
pkill -f "language_server" 2>/dev/null || true
sleep 3
echo "   OK"

# 2. Auto-detect Antigravity installation path
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Common Linux Electron app paths (ordered by priority)
ASAR_PATH=""
SEARCH_PATHS=(
  "$HOME/.local/share/Programs/antigravity/resources/app.asar"
  "/opt/antigravity/resources/app.asar"
  "/usr/lib/antigravity/resources/app.asar"
  "/usr/local/lib/antigravity/resources/app.asar"
)

for p in "${SEARCH_PATHS[@]}"; do
  if [ -f "$p" ]; then
    ASAR_PATH="$p"
    echo "[2/6] Found Antigravity at: $ASAR_PATH"
    break
  fi
done

if [ -z "$ASAR_PATH" ]; then
  echo "[2/6] ERROR: app.asar not found. Checked:"
  for p in "${SEARCH_PATHS[@]}"; do
    echo "   - $p"
  done
  exit 1
fi

BACKUP_ASAR="${ASAR_PATH}.backup"
TEMP_DIR="$(mktemp -d -t antigravity_safe_deploy)"

# 3. Backup check
ASAR_UNPACKED="${ASAR_PATH}.unpacked"
BACKUP_ASAR_UNPACKED="${BACKUP_ASAR}.unpacked"

if [ -f "$BACKUP_ASAR" ]; then
    echo "   Backup found: $BACKUP_ASAR"
    if [ -d "$ASAR_UNPACKED" ] && [ ! -d "$BACKUP_ASAR_UNPACKED" ]; then
        echo "   Creating backup of unpacked directory..."
        cp -R "$ASAR_UNPACKED" "$BACKUP_ASAR_UNPACKED"
        echo "   Backup unpacked directory created."
    fi
elif [ -f "$ASAR_PATH" ]; then
    echo "   No backup found - creating backup of current asar..."
    cp "$ASAR_PATH" "$BACKUP_ASAR"
    if [ -d "$ASAR_UNPACKED" ]; then
        cp -R "$ASAR_UNPACKED" "$BACKUP_ASAR_UNPACKED"
    fi
    echo "   Backup created."
fi

# 4. Extract backup asar to temp directory
echo "[3/6] Extracting backup asar..."
rm -rf "$TEMP_DIR"
NODE_OPTIONS="--max-old-space-size=4096" npx -y @electron/asar extract "$BACKUP_ASAR" "$TEMP_DIR"

if [ $? -ne 0 ]; then
    echo "   ERROR: asar extract failed!"
    exit 1
fi
echo "   OK - Temp directory: $TEMP_DIR"

# 5. Copy dist/ from project and clean up
echo "[4/6] Updating dist/ and cleaning up..."
rm -rf "$TEMP_DIR/.git" 2>/dev/null || true
rm -rf "$TEMP_DIR/scratch" 2>/dev/null || true

SRC_DIST="$SCRIPT_DIR/dist"
DEST_DIST="$TEMP_DIR/dist"

rm -rf "$DEST_DIST"
cp -R "$SRC_DIST" "$DEST_DIST"
echo "   OK - dist copied."

# Also copy repack scripts
for f in "$SCRIPT_DIR"/repack.*; do
  if [ -f "$f" ]; then
    cp "$f" "$TEMP_DIR/"
  fi
done

# 6. Re-pack app.asar
echo "[5/6] Packaging app.asar..."
rm -rf "$ASAR_UNPACKED"

npx -y @electron/asar pack "$TEMP_DIR" "$ASAR_PATH" --unpack-dir "node_modules"

if [ $? -ne 0 ]; then
    echo "   ERROR: Packaging failed! Restoring backup..."
    cp "$BACKUP_ASAR" "$ASAR_PATH"
    if [ -d "$BACKUP_ASAR_UNPACKED" ]; then
        rm -rf "$ASAR_UNPACKED"
        cp -R "$BACKUP_ASAR_UNPACKED" "$ASAR_UNPACKED"
    fi
    rm -rf "$TEMP_DIR"
    exit 1
fi
echo "   OK"

# Cleanup
rm -rf "$TEMP_DIR"

# 7. Relaunch Antigravity
echo "[6/6] Launching Antigravity..."

# Try to find the executable
EXE_PATH=""
# Derive exe dir from asar path (resources/ -> parent dir)
ASAR_DIR="$(dirname "$ASAR_PATH")"
APP_DIR="$(dirname "$ASAR_DIR")"

if [ -f "$APP_DIR/Antigravity" ]; then
    EXE_PATH="$APP_DIR/Antigravity"
elif [ -f "$APP_DIR/antigravity" ]; then
    EXE_PATH="$APP_DIR/antigravity"
elif [ -f "$HOME/.local/share/Programs/antigravity/Antigravity" ]; then
    EXE_PATH="$HOME/.local/share/Programs/antigravity/Antigravity"
elif [ -f "/opt/antigravity/Antigravity" ]; then
    EXE_PATH="/opt/antigravity/Antigravity"
fi

if [ -n "$EXE_PATH" ] && [ -f "$EXE_PATH" ]; then
    nohup "$EXE_PATH" > /dev/null 2>&1 &
    echo ""
    echo "============================================"
    echo "  SUCCESS! Antigravity restarted."
    echo "============================================"
else
    echo "  Warning: Antigravity executable not found. Launch manually."
    echo "  Checked paths:"
    echo "    - $APP_DIR/Antigravity"
    echo "    - $APP_DIR/antigravity"
    echo "    - $HOME/.local/share/Programs/antigravity/Antigravity"
    echo "    - /opt/antigravity/Antigravity"
fi
