# Upgrade & Migration Guide — ag-agentd v2.0.0

## Binary Upgrade Procedure

`ag-agentd` operates with zero external runtime dependencies. Upgrades are performed by swapping the single static binary:

```bash
# 1. Verify new binary SHA-256
sha256sum -c checksums.txt

# 2. Stop running service
sudo systemctl stop ag-agentd

# 3. Create a snapshot backup of existing binary and database
sudo cp /usr/local/bin/ag-agentd /usr/local/bin/ag-agentd.bak
python3 -c "import sqlite3; c=sqlite3.connect('/var/lib/antigravity/runtime.db'); b=sqlite3.connect('/tmp/runtime.db.bak'); c.backup(b); b.close(); c.close()"

# 4. Install updated binary
sudo install -m 755 ag-agentd-linux-amd64 /usr/local/bin/ag-agentd

# 5. Restart service
sudo systemctl start ag-agentd

# 6. Verify health and version
curl http://127.0.0.1:8090/health
```

## Schema Compatibility
- The SQLite event store automatically applies additive schema migrations on boot.
- Prior session state, worktrees, approvals, memories, and schedules are preserved across restarts.
