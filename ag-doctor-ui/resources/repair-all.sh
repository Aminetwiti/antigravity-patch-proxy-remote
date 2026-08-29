#!/bin/bash
# Self-elevating repair script for Linux/macOS

if [ "$EUID" -ne 0 ]; then
  echo "Elevating privileges to repair proxy and CA..."
  exec sudo "$0" "$@"
fi

echo "Running as root."
RESULT_JSON="{\"proxy\":false,\"ca\":false}"
TEMP_FILE="/tmp/ag-repair-result.json"

OS="$(uname -s)"
CA_CERT="$HOME/.gemini/antigravity/certs/ca-cert.pem"

if [ "$OS" = "Darwin" ]; then
  # macOS (port ${AG_STUB_PORT:-51999} for ag-doctor-ui stub, NOT ${AG_PROXY_PORT:-51074} which is reserved for main Antigravity proxy)
  echo "Setting system proxy (macOS)..."
  BIND_HOST=${AG_BIND_HOST:-127.0.0.1}
  networksetup -listallnetworkservices | grep -v '*' | while read -r svc; do
    networksetup -setwebproxy "$svc" "$BIND_HOST" ${AG_STUB_PORT:-51999}
    networksetup -setsecurewebproxy "$svc" "$BIND_HOST" ${AG_STUB_PORT:-51999}
    networksetup -setwebproxystate "$svc" on
    networksetup -setsecurewebproxystate "$svc" on
  done
  
  if [ -f "$CA_CERT" ]; then
    echo "Installing CA certificate..."
    security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "$CA_CERT"
    RESULT_JSON="{\"proxy\":true,\"ca\":true}"
  else
    RESULT_JSON="{\"proxy\":true,\"ca\":false}"
  fi
else
  # Linux (best effort gsettings)
  echo "Setting system proxy (Linux)..."
  if command -v gsettings &> /dev/null; then
    BIND_HOST=${AG_BIND_HOST:-127.0.0.1}
    gsettings set org.gnome.system.proxy mode manual
    gsettings set org.gnome.system.proxy.http host "$BIND_HOST"
    gsettings set org.gnome.system.proxy.http port ${AG_PROXY_PORT:-51074}
    gsettings set org.gnome.system.proxy.https host "$BIND_HOST"
    gsettings set org.gnome.system.proxy.https port ${AG_PROXY_PORT:-51074}
  fi
  
  if [ -f "$CA_CERT" ]; then
    echo "Installing CA certificate..."
    cp "$CA_CERT" /usr/local/share/ca-certificates/antigravity-mitm.crt
    update-ca-certificates
    RESULT_JSON="{\"proxy\":true,\"ca\":true}"
  else
    RESULT_JSON="{\"proxy\":true,\"ca\":false}"
  fi
fi

echo "$RESULT_JSON" > "$TEMP_FILE"
echo "Repair complete."
