#!/bin/bash
# Script to automate deployment and execution of the Antigravity Proxy on a Linux server
# This script builds the project and runs the standalone proxy in the background.

set -e

echo "============================================"
echo "  Deploying Antigravity Proxy on Linux Server"
echo "============================================"

# 1. Install dependencies
echo "[1/4] Installing dependencies..."
npm install
echo "   OK"

# 2. Build the project
echo "[2/4] Building the project..."
npm run build
echo "   OK"

# 3. Check and kill any existing proxy instances
echo "[3/4] Stopping existing proxy instances (if any)..."
node ag-doctor/bin/ag-doctor.js proxy stop || true
sleep 1
echo "   OK"

# 4. Start the standalone proxy
echo "[4/4] Starting the standalone proxy..."
node ag-doctor/bin/ag-doctor.js proxy start

echo ""
echo "============================================"
echo "  SUCCESS! Proxy is running on port ${AG_PROXY_PORT:-51074}"
echo "  Check status: node ag-doctor/bin/ag-doctor.js proxy status"
echo "============================================"
