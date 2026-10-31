#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# detect-antigravity.sh — Detect which Antigravity installation is present.
# Linux/macOS counterpart to scripts/detect-antigravity.ps1.
#
# Scans ~/.local/share and /opt for Antigravity installations and reports:
#   - Which versions are installed
#   - Which binary is currently active
#   - Whether the running process is v1.x or v2.0+
#   - Port ${AG_PROXY_PORT:-51074} ownership (which PID is bound to it)
#
# Exit codes:
#   0 = single, unambiguous installation found
#   1 = multiple installations found (ambiguous)
#   2 = no installation found
# ─────────────────────────────────────────────────────────────────────────────

set -u

CYAN='\033[0;36m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
RED='\033[0;31m'
GRAY='\033[0;90m'
WHITE='\033[1;37m'
NC='\033[0m'

section() {
    echo ""
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  $1${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════${NC}"
}

# ─── 1. Scan for installations ─────────────────────────────────────────────

section 'Antigravity Installation Detector'
echo -e "  ${YELLOW}Run this first whenever you have problems.${NC}"
echo -e "  ${YELLOW}It tells you exactly which Antigravity binary is in play.${NC}"

# Possible install locations
CANDIDATES=(
    "$HOME/.local/share/antigravity"
    "$HOME/.local/share/Antigravity"
    "/opt/antigravity"
    "/opt/Antigravity"
    "/usr/local/bin/antigravity"
)

INSTALLS=()
for path in "${CANDIDATES[@]}"; do
    exe="$path/Antigravity"
    # Linux uses lowercase 'antigravity' binary
    if [ ! -x "$exe" ]; then
        exe="$path/antigravity"
    fi
    if [ -x "$exe" ] || [ -f "$exe" ]; then
        # Try to read version from package.json
        version="unknown"
        pkg="$path/resources/app/package.json"
        if [ -f "$pkg" ]; then
            version=$(grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "$pkg" 2>/dev/null | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
        fi

        # Heuristic: patched builds have a larger app.asar
        asar="$path/resources/app.asar"
        size=0
        patched=false
        if [ -f "$asar" ]; then
            size=$(stat -c%s "$asar" 2>/dev/null || stat -f%z "$asar" 2>/dev/null || echo 0)
            # >50MB suggests patched
            if [ "$size" -gt 52428800 ]; then
                patched=true
            fi
        fi

        INSTALLS+=("$path|$exe|$version|$patched|$size")
    fi
done

section '1. Installations Found'

if [ ${#INSTALLS[@]} -eq 0 ]; then
    echo -e "  ${RED}❌ No Antigravity installation found${NC}"
    echo ""
    echo -e "  ${YELLOW}Expected paths:${NC}"
    for c in "${CANDIDATES[@]}"; do
        echo -e "    ${GRAY}$c${NC}"
    done
    exit 2
fi

for entry in "${INSTALLS[@]}"; do
    IFS='|' read -r path exe version patched size <<< "$entry"
    if [[ "$path" == *"antigravity"* ]] && [[ "$path" != *"Antigravity"* ]]; then
        tag="v1.x (lowercase, patched repo)"
    else
        tag="v2.0+ (uppercase, Google original)"
    fi
    patchedTag=$([ "$patched" = true ] && echo -e "${GREEN}PATCHED${NC}" || echo -e "${YELLOW}pristine${NC}")
    sizeMB=$(awk "BEGIN {printf \"%.1f\", $size/1048576}")
    echo -e "  📦 ${WHITE}$tag${NC}"
    echo -e "     ${GRAY}Path:    $path${NC}"
    echo -e "     ${GRAY}Version: $version${NC}"
    echo -e "     State:   $patchedTag"
    echo -e "     ${GRAY}asar:    ${sizeMB} MB${NC}"
    echo ""
done

# ─── 2. Running processes ──────────────────────────────────────────────────

section '2. Running Antigravity Processes'

running=$(pgrep -af 'Antigravity|antigravity' 2>/dev/null | grep -v 'detect-antigravity' || true)
if [ -z "$running" ]; then
    echo -e "  ${GRAY}(none running)${NC}"
else
    while IFS= read -r line; do
        pid=$(echo "$line" | awk '{print $1}')
        cmd=$(echo "$line" | cut -d' ' -f2-)
        installType="unknown"
        if [[ "$cmd" == *"antigravity/"* ]] && [[ "$cmd" != *"Antigravity/"* ]]; then
            installType="v1.x"
        elif [[ "$cmd" == *"Antigravity/"* ]]; then
            installType="v2.0+"
        fi
        echo -e "  ▶ ${WHITE}PID $pid [$installType]${NC} ${GRAY}$cmd${NC}"
    done <<< "$running"
fi
echo ""

# ─── 3. Port ${AG_PROXY_PORT:-51074} ownership ──────────────────────────────────────────────

section '3. Port ${AG_PROXY_PORT:-51074} Ownership'

# Try multiple methods to find the owner of the proxy port
owner=""
if command -v ss >/dev/null 2>&1; then
    owner=$(ss -tlnp 2>/dev/null | grep ":${AG_PROXY_PORT:-51074} " | head -1)
elif command -v netstat >/dev/null 2>&1; then
    owner=$(netstat -tlnp 2>/dev/null | grep ":${AG_PROXY_PORT:-51074} " | head -1)
elif command -v lsof >/dev/null 2>&1; then
    owner=$(lsof -i :${AG_PROXY_PORT:-51074} 2>/dev/null | grep LISTEN | head -1)
fi

if [ -n "$owner" ]; then
    pid=$(echo "$owner" | grep -oP 'pid=\K[0-9]+' | head -1)
    if [ -z "$pid" ]; then
        pid=$(echo "$owner" | awk '{print $NF}' | grep -oP '\K[0-9]+' | head -1)
    fi
    processName=$(ps -p "$pid" -o comm= 2>/dev/null || echo "unknown")
    processPath=$(ps -p "$pid" -o args= 2>/dev/null || echo "unknown")

    echo -e "  ${YELLOW}⚠️  Port ${AG_PROXY_PORT:-51074} is bound by:${NC}"
    echo -e "     ${WHITE}PID:     $pid${NC}"
    echo -e "     ${WHITE}Process: $processName${NC}"
    echo -e "     ${GRAY}Path:    $processPath${NC}"

    if [[ "$processPath" == *"antigravity/"* ]] && [[ "$processPath" != *"Antigravity/"* ]]; then
        echo ""
        echo -e "  ${GREEN}✅ This is our patched v1.x proxy — expected.${NC}"
    else
        echo ""
        echo -e "  ${YELLOW}⚠️  This is NOT our patched build.${NC}"
        echo -e "     ${YELLOW}If you started Antigravity 2.0 (uppercase), its proxy cannot start${NC}"
        echo -e "     ${YELLOW}because port ${AG_PROXY_PORT:-51074} is taken. Either:${NC}"
        echo -e "       ${YELLOW}(a) Kill PID $pid: kill $pid${NC}"
        echo -e "       ${YELLOW}(b) Run Antigravity 2.0 with AG_PROXY_PORT=51999${NC}"
    fi
else
    echo -e "  ${GREEN}✅ Port ${AG_PROXY_PORT:-51074} is FREE.${NC}"
fi
echo ""

# ─── 4. Recommendations ───────────────────────────────────────────────────

section '4. Recommendation'

if [ ${#INSTALLS[@]} -gt 1 ]; then
    echo -e "  ${YELLOW}⚠️  MULTIPLE INSTALLATIONS DETECTED.${NC}"
    echo ""
    echo -e "  ${WHITE}This is the #1 source of confusion. Pick ONE:${NC}"
    echo ""
    echo -e "  ${CYAN}Option A — Use the patched v1.x (recommended for this repo):${NC}"
    first=$(echo "${INSTALLS[0]}" | cut -d'|' -f2)
    echo -e "    ${GRAY}$first${NC}"
    echo ""
    echo -e "  ${CYAN}Option B — Use the original v2.0+:${NC}"
    if [ ${#INSTALLS[@]} -ge 2 ]; then
        second=$(echo "${INSTALLS[1]}" | cut -d'|' -f2)
        echo -e "    ${GRAY}$second${NC}"
    else
        echo -e "    ${GRAY}(only one installation present)${NC}"
    fi
    echo ""
    echo -e "  ${YELLOW}To remove the ambiguity, uninstall one of them.${NC}"
    exit 1
else
    only=$(echo "${INSTALLS[0]}")
    IFS='|' read -r path exe version patched size <<< "$only"
    if [[ "$path" == *"antigravity"* ]] && [[ "$path" != *"Antigravity"* ]]; then
        tag="patched v1.x"
    else
        tag="original v2.0+"
    fi
    echo -e "  ${GREEN}✅ Single installation found: $tag${NC}"
    echo -e "     ${GRAY}$path${NC}"
    echo ""
    echo -e "  ${WHITE}To start it:${NC}"
    echo -e "    ${GRAY}$exe${NC}"
    exit 0
fi
