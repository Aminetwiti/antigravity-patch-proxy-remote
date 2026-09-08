# Antigravity Remote Agent Cloud — Backup & Disaster Recovery Guide

This guide details the procedure for backing up, verifying, and recovering `ag-agentd` data.

---

## 1. Data Anatomy
State is contained in three locations:
1. **Configuration**: `/etc/antigravity/ag-agentd.env` (tokens, flags).
2. **Metadata & Trajectory Store**: `/var/lib/antigravity/runtime.db` (SQLite database with WAL mode).
3. **Workspace Files**: `/var/lib/antigravity/workspaces/` (Git repositories, active worktrees).

---

## 2. Online Hot Backup

### Step A: SQLite Hot Snapshot
SQLite operates in Write-Ahead Logging (`wal`) mode. To create a consistent point-in-time snapshot without stopping the daemon:
```bash
# Using python built-in sqlite3 backup API
python3 -c "
import sqlite3
con = sqlite3.connect('/var/lib/antigravity/runtime.db')
bck = sqlite3.connect('/tmp/backup-runtime.db')
con.backup(bck)
bck.close()
con.close()
"
```

### Step B: Archive Workspaces and Config
```bash
sudo tar -czf /tmp/antigravity-backup-$(date +%Y%m%d%H%M).tar.gz \
    /etc/antigravity/ag-agentd.env \
    /tmp/backup-runtime.db \
    /var/lib/antigravity/workspaces
```

---

## 3. Disaster Recovery (Restoring on a New VPS)

### Recovery Procedure
1. Provision a clean VPS and install prerequisites (`docker.io`, `git`, `curl`).
2. Run the installer script to create the service user and directory structure:
   ```bash
   sudo bash scripts/deploy/install-cloud-agent.sh
   sudo systemctl stop ag-agentd
   ```
3. Extract the backup archive:
   ```bash
   sudo tar -xzf antigravity-backup-YYYYMMDDHHMM.tar.gz -C /
   sudo cp /tmp/backup-runtime.db /var/lib/antigravity/runtime.db
   ```
4. Verify SQLite database integrity:
   ```bash
   python3 -c "
   import sqlite3
   con = sqlite3.connect('/var/lib/antigravity/runtime.db')
   print('Integrity check:', con.execute('PRAGMA integrity_check;').fetchone()[0])
   con.close()
   "
   ```
5. Restore filesystem permissions:
   ```bash
   sudo chown -R ag-agent:ag-agent /var/lib/antigravity /etc/antigravity
   sudo chmod 600 /etc/antigravity/ag-agentd.env
   ```
6. Start the daemon:
   ```bash
   sudo systemctl start ag-agentd
   ```

---

## 4. Recovery Objectives
- **RPO (Recovery Point Objective)**: 1 hour with hourly scheduled backup snapshots.
- **RTO (Recovery Time Objective)**: < 5 minutes on a freshly provisioned VPS.
