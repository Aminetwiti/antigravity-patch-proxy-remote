# Antigravity Remote Agent Cloud — Upgrade & Migration Guide

This document details the procedure for upgrading `ag-agentd` to newer releases and rolling back if necessary.

---

## 1. Zero-Downtime / Low-Downtime Upgrade Procedure

Because `ag-agentd` is compiled as a single static ELF binary, upgrading involves a simple binary replacement:

```bash
# 1. Download or compile the new release binary
# e.g., ag-agentd-linux-amd64 (v2.0.0-rc1)

# 2. Verify SHA-256 integrity
sha256sum -c checksums.txt

# 3. Create a backup of the existing binary and database
sudo cp /usr/local/bin/ag-agentd /usr/local/bin/ag-agentd.bak
python3 -c "import sqlite3; c=sqlite3.connect('/var/lib/antigravity/runtime.db'); b=sqlite3.connect('/var/lib/antigravity/runtime.db.bak'); c.backup(b); b.close(); c.close()"

# 4. Stop service gracefully
sudo systemctl stop ag-agentd

# 5. Replace binary
sudo cp ag-agentd-linux-amd64 /usr/local/bin/ag-agentd
sudo chmod +x /usr/local/bin/ag-agentd

# 6. Restart service
sudo systemctl start ag-agentd

# 7. Check service health
curl http://127.0.0.1:8090/health
```

---

## 2. Database Schema Migrations
- The SQLite event store automatically executes additive schema migrations upon startup.
- Column additions and index creation use `IF NOT EXISTS` guards.
- Running transactions in WAL mode ensure uncommitted operations cleanly recover during restart.

---

## 3. Rollback Procedure
If a regression is encountered in the newer binary:
```bash
# 1. Stop service
sudo systemctl stop ag-agentd

# 2. Restore backup binary
sudo mv /usr/local/bin/ag-agentd.bak /usr/local/bin/ag-agentd

# 3. If database changes caused schema incompatibility, restore backup DB:
sudo cp /var/lib/antigravity/runtime.db.bak /var/lib/antigravity/runtime.db
sudo chown ag-agent:ag-agent /var/lib/antigravity/runtime.db

# 4. Restart service
sudo systemctl start ag-agentd
```
