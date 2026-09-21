# Installation Guide — ag-agentd v2.0.0

## Automated Turnkey Installation

```bash
sudo bash scripts/deploy/install-cloud-agent.sh
```

The script automatically:
1. Detects `x86_64` vs `aarch64`.
2. Creates dedicated service user `ag-agent` and adds to `docker` group.
3. Provisions `/var/lib/antigravity` (data/workspaces) and `/etc/antigravity` (configuration).
4. Installs the static binary to `/usr/local/bin/ag-agentd`.
5. Generates a secure 256-bit CSPRNG authentication token in `/etc/antigravity/ag-agentd.env`.
6. Configures and starts `/etc/systemd/system/ag-agentd.service` with strict sandboxing.

---

## Manual Installation

If installing manually:
```bash
# 1. Create service user
sudo useradd -r -s /usr/sbin/nologin -d /var/lib/antigravity ag-agent
sudo usermod -aG docker ag-agent

# 2. Copy binary
sudo cp ag-agentd-linux-amd64 /usr/local/bin/ag-agentd
sudo chmod 755 /usr/local/bin/ag-agentd

# 3. Create directories
sudo mkdir -p /var/lib/antigravity/workspaces /etc/antigravity
sudo chown -R ag-agent:ag-agent /var/lib/antigravity /etc/antigravity
sudo chmod 750 /var/lib/antigravity /etc/antigravity

# 4. Create environment file
sudo cp scripts/deploy/ag-agentd.production.env /etc/antigravity/ag-agentd.env
sudo chmod 600 /etc/antigravity/ag-agentd.env

# 5. Copy and enable systemd unit
sudo cp scripts/deploy/ag-agentd.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ag-agentd
```

---

## Verifying the Deployment
```bash
# Health endpoint
curl http://127.0.0.1:8090/health

# Output:
# {"status":"ONLINE","version":"2.0.0",...}
```
