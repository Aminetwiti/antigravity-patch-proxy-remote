#!/usr/bin/env bash
# ==============================================================================
# Antigravity Remote Agent Cloud Runtime - VPS Automated Installer
# Supported: Ubuntu 20.04+, Debian 11+, RHEL/Rocky Linux 8+, Arch Linux
# ==============================================================================
set -eo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${BLUE}======================================================${NC}"
echo -e "${CYAN}   🚀 Antigravity Cloud Remote Agent Installer       ${NC}"
echo -e "${BLUE}======================================================${NC}"

if [ "$(id -u)" -ne 0 ]; then
    echo -e "${RED}❌ Please run this installer with root privileges (e.g., sudo bash install-cloud-agent.sh)${NC}"
    exit 1
fi

INSTALL_BIN_DIR="/usr/local/bin"
CONFIG_DIR="/etc/antigravity"
DATA_DIR="/var/lib/antigravity"
WORKSPACES_DIR="${DATA_DIR}/workspaces"
SERVICE_NAME="ag-agentd"
ENV_FILE="${CONFIG_DIR}/ag-agentd.env"

PORT=${AG_PORT:-8090}
HOST=${AG_HOST:-"0.0.0.0"}
PROVIDER=${AG_PROVIDER:-"auto"}
MODEL=${AG_MODEL:-""}
if command -v docker >/dev/null 2>&1; then
    SANDBOX_DEFAULT="docker"
else
    SANDBOX_DEFAULT="native"
fi
SANDBOX=${AG_SANDBOX:-$SANDBOX_DEFAULT}
SANDBOX_MODE=${AG_SANDBOX_MODE:-"strict"}

echo -e "${BLUE}[1/5] Checking environment and system dependencies...${NC}"

# Detect architecture
ARCH=$(uname -m)
case "$ARCH" in
    x86_64)  GO_ARCH="amd64" ;;
    aarch64|arm64) GO_ARCH="arm64" ;;
    *)
        echo -e "${RED}❌ Unsupported system architecture: $ARCH${NC}"
        exit 1
        ;;
esac
echo -e "   Target architecture: ${GREEN}${ARCH} (${GO_ARCH})${NC}"

# Install curl, git, ca-certificates if missing
if command -v apt-get >/dev/null 2>&1; then
    apt-get update -qq && apt-get install -y -qq curl git ca-certificates openssl >/dev/null 2>&1 || true
elif command -v dnf >/dev/null 2>&1; then
    dnf install -y -q curl git ca-certificates openssl >/dev/null 2>&1 || true
elif command -v yum >/dev/null 2>&1; then
    yum install -y -q curl git ca-certificates openssl >/dev/null 2>&1 || true
fi

echo -e "${BLUE}[2/5] Creating directories and runtime user...${NC}"
id -u ag-agent >/dev/null 2>&1 || useradd -r -s /bin/false -d "${DATA_DIR}" ag-agent || true

# HIGH-05: Ensure ag-agent has docker permissions if docker daemon is present
if getent group docker >/dev/null 2>&1; then
    usermod -aG docker ag-agent 2>/dev/null || true
    echo -e "   ${GREEN}✓${NC} User ag-agent added to docker group"
fi

mkdir -p "${CONFIG_DIR}"
mkdir -p "${DATA_DIR}"
mkdir -p "${WORKSPACES_DIR}"
chown -R ag-agent:ag-agent "${DATA_DIR}"
chmod 750 "${DATA_DIR}"

echo -e "${BLUE}[3/5] Building or installing ag-agentd binary...${NC}"

# If running from cloned repo with Go installed
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DAEMON_DIR="${SCRIPT_DIR}/../../remote/daemon"

if [ -f "${REPO_DAEMON_DIR}/main.go" ] && command -v go >/dev/null 2>&1; then
    echo -e "   Building ag-agentd from local source..."
    (cd "${REPO_DAEMON_DIR}" && CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o "${INSTALL_BIN_DIR}/ag-agentd" .)
    chmod +x "${INSTALL_BIN_DIR}/ag-agentd"
elif [ -f "${SCRIPT_DIR}/ag-agentd" ]; then
    echo -e "   Installing pre-built ag-agentd from script directory..."
    cp "${SCRIPT_DIR}/ag-agentd" "${INSTALL_BIN_DIR}/ag-agentd"
    chmod +x "${INSTALL_BIN_DIR}/ag-agentd"
elif command -v ag-agentd >/dev/null 2>&1; then
    echo -e "   ag-agentd binary already installed at $(command -v ag-agentd)."
else
    echo -e "${YELLOW}⚠️ Go compiler not found on VPS. Attempting to install Go compiler...${NC}"
    GO_VERSION="1.24.0"
    curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-${GO_ARCH}.tar.gz" -o /tmp/go.tar.gz
    tar -C /usr/local -xzf /tmp/go.tar.gz
    rm -f /tmp/go.tar.gz
    export PATH="/usr/local/go/bin:$PATH"
    
    if [ -f "${REPO_DAEMON_DIR}/main.go" ]; then
        (cd "${REPO_DAEMON_DIR}" && CGO_ENABLED=0 GOOS=linux /usr/local/go/bin/go build -ldflags="-s -w" -o "${INSTALL_BIN_DIR}/ag-agentd" .)
        chmod +x "${INSTALL_BIN_DIR}/ag-agentd"
    else
        echo -e "${RED}❌ Unable to find source code or pre-built binary. Please clone the repository first.${NC}"
        exit 1
    fi
fi

echo -e "${BLUE}[4/5] Configuring environment and authentication...${NC}"

# Generate token if not already existing
EXISTING_TOKEN=""
if [ -f "${ENV_FILE}" ]; then
    EXISTING_TOKEN=$(grep -E '^AG_AUTH_TOKEN=' "${ENV_FILE}" | cut -d '=' -f2- || true)
fi

if [ -n "${AG_AUTH_TOKEN}" ]; then
    AUTH_TOKEN="${AG_AUTH_TOKEN}"
elif [ -n "${EXISTING_TOKEN}" ]; then
    AUTH_TOKEN="${EXISTING_TOKEN}"
else
    AUTH_TOKEN=$(openssl rand -hex 16 2>/dev/null || tr -dc 'a-zA-Z0-9' </dev/urandom | head -c 32)
fi

cat <<EOF > "${ENV_FILE}"
# Antigravity Cloud Remote Agent Runtime Configuration
AG_HOST=${HOST}
AG_PORT=${PORT}
AG_DB_PATH=${DATA_DIR}/runtime.db
AG_WORKSPACES_DIR=${WORKSPACES_DIR}
AG_AUTH_TOKEN=${AUTH_TOKEN}
AG_PROVIDER=${PROVIDER}
AG_MODEL=${MODEL}
AG_SANDBOX=${SANDBOX}
AG_SANDBOX_MODE=${SANDBOX_MODE}
AG_TUNNEL=local
AG_ALLOW_PUBLIC_BIND=true
# Set AI Provider Keys as needed:
# ANTHROPIC_API_KEY=sk-ant-...
# OPENAI_API_KEY=sk-...
# OLLAMA_HOST=http://127.0.0.1:11434
EOF

chmod 600 "${ENV_FILE}"
chown ag-agent:ag-agent "${ENV_FILE}"

echo -e "${BLUE}[5/5] Installing systemd service unit...${NC}"

SUPP_GROUPS=""
if getent group docker >/dev/null 2>&1; then
    SUPP_GROUPS="SupplementaryGroups=docker"
fi

cat <<EOF > "/etc/systemd/system/${SERVICE_NAME}.service"
[Unit]
Description=Antigravity Remote Agent Cloud Runtime Daemon
After=network.target network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ag-agent
Group=ag-agent
${SUPP_GROUPS}
WorkingDirectory=${DATA_DIR}
EnvironmentFile=${ENV_FILE}
ExecStart=${INSTALL_BIN_DIR}/ag-agentd \\
    --mode=server \\
    --host=\${AG_HOST} \\
    --port=\${AG_PORT} \\
    --db-path=\${AG_DB_PATH} \\
    --workspaces-dir=\${AG_WORKSPACES_DIR} \\
    --auth-token=\${AG_AUTH_TOKEN} \\
    --provider=\${AG_PROVIDER} \\
    --model=\${AG_MODEL} \\
    --sandbox=\${AG_SANDBOX} \\
    --sandbox-mode=\${AG_SANDBOX_MODE} \\
    --tunnel=\${AG_TUNNEL} \\
    --allow-public-bind
Restart=always
RestartSec=5s
LimitNOFILE=65536
# Security Hardening
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true
PrivateTmp=true
ReadWritePaths=${DATA_DIR} ${CONFIG_DIR}

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
systemctl restart "${SERVICE_NAME}"

# Detect Public IP
SERVER_IP=$(curl -s -4 ifconfig.me || curl -s -4 api.ipify.org || hostname -I | awk '{print $1}')

echo ""
echo -e "${GREEN}======================================================${NC}"
echo -e "${GREEN}   🎉 Antigravity Remote Agent Daemon Installed!     ${NC}"
echo -e "${GREEN}======================================================${NC}"
echo -e "   Status:           ${GREEN}Active & Running (systemd)${NC}"
echo -e "   Service:          ${CYAN}systemctl status ${SERVICE_NAME}${NC}"
echo -e "   Logs:             ${CYAN}journalctl -u ${SERVICE_NAME} -f${NC}"
echo -e "   Configuration:    ${CYAN}${ENV_FILE}${NC}"
echo -e "   Database:         ${CYAN}${DATA_DIR}/runtime.db${NC}"
echo -e "   Workspaces:       ${CYAN}${WORKSPACES_DIR}${NC}"
echo -e "   Auth Token:       ${YELLOW}${AUTH_TOKEN}${NC}"
echo ""
echo -e "${BLUE}📡 Connection Surfaces:${NC}"
echo -e "   - Web Console:    ${CYAN}http://${SERVER_IP}:${PORT}/console?token=${AUTH_TOKEN}${NC}"
echo -e "   - Health check:   ${CYAN}http://${SERVER_IP}:${PORT}/health${NC}"
echo -e "   - Mobile (v2 WS): ${CYAN}ws://${SERVER_IP}:${PORT}/v2/ws?token=${AUTH_TOKEN}${NC}"
echo -e "   - Mobile (v1 WS): ${CYAN}ws://${SERVER_IP}:${PORT}/ws?token=${AUTH_TOKEN}${NC}"
echo ""
echo -e "${YELLOW}👉 Make sure port ${PORT} is allowed in your firewall (ufw allow ${PORT}/tcp)${NC}"
