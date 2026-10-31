# Antigravity Remote Agent Cloud — Troubleshooting Guide

Common issues, diagnostic commands, and recovery procedures for `ag-agentd`.

---

## 1. Diagnostic Quick Commands

```bash
# Service status
sudo systemctl status ag-agentd

# Real-time service logs
sudo journalctl -u ag-agentd -f -n 100

# Health check
curl -i http://127.0.0.1:8090/health

# Metrics inspection
curl -s http://127.0.0.1:8090/metrics

# Check running processes and memory footprint
ps aux | grep ag-agentd
```

---

## 2. Common Issues and Resolutions

### A. HTTP 401 Unauthorized
- **Cause**: Missing or incorrect authentication token in query parameter or `Authorization: Bearer <token>`.
- **Fix**: Check configured token in `/etc/antigravity/ag-agentd.env` (`AG_AUTH_TOKEN`). Ensure request includes `?token=<token>`.

### B. HTTP 429 Too Many Requests
- **Cause**: Rate limiter exceeded (120 requests/minute default).
- **Fix**: Wait 60 seconds for the sliding window to drain. If traffic is proxied through a reverse proxy, ensure `AG_TRUSTED_PROXIES` includes the proxy IP so rate limits apply per client rather than per proxy.

### C. Docker Sandbox Error (`ErrSandboxUnavailable`)
- **Symptom**: Tool calls return `docker daemon is unreachable and fallback to host is disabled in strict mode`.
- **Fix**:
  1. Verify Docker daemon is running: `sudo systemctl status docker`.
  2. Verify `ag-agent` user belongs to `docker` group: `groups ag-agent`.
  3. Pull base image: `docker pull alpine:latest`.

### D. Git Dubious Ownership Warning
- **Symptom**: `fatal: detected dubious ownership in repository at '/var/lib/antigravity/...'`.
- **Fix**: Run `sudo chown -R ag-agent:ag-agent /var/lib/antigravity`. Alternatively add safe directory: `git config --system --add safe.directory "*"`.

### E. AI Model Not Responding
- **Symptom**: Notice logged: `No direct AI API keys detected... Routing through local proxy`.
- **Fix**: Configure `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` in `/etc/antigravity/ag-agentd.env` and restart service.
