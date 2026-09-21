# Backup & Disaster Recovery — ag-agentd v2.0.0

## 1. Hot Backup Procedure (Zero Downtime)

SQLite runs in Write-Ahead Logging (`wal`) mode. To create a consistent point-in-time snapshot without taking the daemon offline:

```bash
# Snapshot SQLite database using python built-in sqlite3 driver
python3 -c "
import sqlite3
con = sqlite3.connect('/var/lib/antigravity/runtime.db')
bck = sqlite3.connect('/tmp/backup-runtime.db')
con.backup(bck)
bck.close()
con.close()
"

# Bundle database, workspaces, and configuration into tarball
sudo tar -czf /tmp/antigravity-backup-$(date +%Y%m%d%H%M).tar.gz \
    /tmp/backup-runtime.db \
    /var/lib/antigravity/workspaces \
    /etc/antigravity/ag-agentd.env
```

## 2. Recovery on a New VPS

```bash
# 1. Provision fresh VPS and install dependencies (docker, git, curl)
# 2. Run automated installer: sudo bash install-cloud-agent.sh
# 3. Stop daemon: sudo systemctl stop ag-agentd
# 4. Extract backup archive:
sudo tar -xzf antigravity-backup-*.tar.gz -C /
sudo cp /tmp/backup-runtime.db /var/lib/antigravity/runtime.db

# 5. Fix permissions:
sudo chown -R ag-agent:ag-agent /var/lib/antigravity /etc/antigravity
sudo chmod 600 /etc/antigravity/ag-agentd.env

# 6. Start service:
sudo systemctl start ag-agentd
```
