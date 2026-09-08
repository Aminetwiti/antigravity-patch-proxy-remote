# Antigravity Remote Agent Cloud — Deployment Guide

This guide details how to deploy `ag-agentd` to a fresh Linux VPS (Ubuntu 22.04+, Debian 12+, Rocky Linux 9+, or Arch Linux).

---

## 1. System Requirements
- **Hardware**: 1 vCPU, 1 GB RAM, 10 GB SSD/NVMe (minimum). Recommended: 2 vCPU, 2-4 GB RAM.
- **Operating System**: Linux 64-bit (x86_64 or aarch64).
- **Core Dependencies**:
  - `systemd` (init system)
  - `docker.io` / `docker-ce` (for strict sandboxed tool execution)
  - `git` (version 2.25+)
  - `curl`

---

## 2. Automated Installation
Run the turnkey installation script as root:
```bash
sudo bash scripts/deploy/install-cloud-agent.sh
```

The installer performs the following:
1. Detects system architecture (`x86_64` or `aarch64`).
2. Creates system service user `ag-agent` and adds it to the `docker` group.
3. Provisions `/var/lib/antigravity` (data/workspaces) and `/etc/antigravity` (config).
4. Installs the static binary to `/usr/local/bin/ag-agentd`.
5. Generates a secure 256-bit CSPRNG token in `/etc/antigravity/ag-agentd.env`.
6. Configures and starts `/etc/systemd/system/ag-agentd.service`.

---

## 3. Recommended Network Architecture (TLS Termination)

Never expose `:8090` unencrypted directly to the internet. Use one of two recommended models:

### Model A: Cloudflare Quick Tunnel (Zero-Config)
Set in `/etc/antigravity/ag-agentd.env`:
```ini
AG_TUNNEL=cloudflare
```
Restart daemon: `sudo systemctl restart ag-agentd`. The daemon automatically launches a secure Cloudflare tunnel and logs the public HTTPS URL in `journalctl -u ag-agentd`.

### Model B: Reverse Proxy (Caddy or Nginx) with Let's Encrypt
Keep `AG_HOST=127.0.0.1` and `AG_PORT=8090`.
Configure Caddyfile:
```caddy
agent.yourdomain.com {
    reverse_proxy 127.0.0.1:8090 {
        header_up Host {host}
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }
}
```

---

## 4. Configuring Cloud AI Providers
Edit `/etc/antigravity/ag-agentd.env`:
```bash
# Anthropic Claude
ANTHROPIC_API_KEY="sk-ant-api03-..."
ANTHROPIC_MODEL="claude-3-5-sonnet-20241022"

# Or OpenAI
# OPENAI_API_KEY="sk-proj-..."
# OPENAI_MODEL="gpt-4o"
```
Apply changes:
```bash
sudo systemctl restart ag-agentd
```

---

## 5. Verification
Verify the service is active and healthy:
```bash
curl http://127.0.0.1:8090/health
```
Output format:
```json
{
  "status": "ONLINE",
  "mode": "server",
  "version": "2.0.0-rc1",
  "build": "026dc53",
  "serverId": "srv_1788871216080",
  "hostname": "your-vps",
  "platform": "linux",
  "arch": "amd64",
  "uptimeSeconds": 14
}
```
