# Standalone Server Runtime CLI & Deployment Guide

## 1. Overview

The `ag-agentd` binary provides a dual-personality runtime:
- **Bridge Mode** (`--mode=bridge`): Connects to a local Antigravity desktop IDE language server via gRPC-Web (hub :55256).
- **Server Runtime Mode** (`--mode=server`): Runs as an autonomous, persistent remote agent daemon on headless servers, VPS, cloud VMs, and developer instances.

If `--mode=bridge` is specified but no local Antigravity IDE process or hub is detected, `ag-agentd` automatically falls back to **Server Mode**.

---

## 2. CLI Command & Flags

```bash
ag-agentd --mode=server [flags]
```

### Supported Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--mode` | `server` | Operation mode: `server` (autonomous daemon) or `bridge` (desktop IDE bridge). |
| `--port` | `8090` | HTTP and WebSocket port to bind. |
| `--host` | `0.0.0.0` | Bind host IP address (`0.0.0.0` listens on all interfaces). |
| `--db-path` | `ag_agentd.db` | Path to the SQLite WAL database for persistent sessions and events. |
| `--workspaces-dir` | `./workspaces` | Root directory containing sandboxed workspaces for agent sessions. |
| `--provider` | `anthropic` | LLM provider: `anthropic`, `openai`, `ollama`, or `proxy`. |
| `--model` | *(auto)* | Model name (e.g., `claude-3-7-sonnet-20250219`, `gpt-4o`, `deepseek-r1`). |
| `--auth-token` | *(random)* | Shared secret token for REST and WebSocket authentication. Auto-generated if omitted. |
| `--approval-timeout` | `5m` | Maximum duration to wait for human tool approval before aborting/rejecting. |
| `--no-approval` | `false` | Disable human approval gating (autonomous agent tool execution). |
| `--no-auth` | `false` | Disable authentication checks (intended for trusted LAN/isolated networks). |
| `--tunnel` | `none` | Remote tunnel to launch: `none`, `cloudflare`, or `pinggy`. |

---

## 3. Environment Variables

- `ANTHROPIC_API_KEY`: API key for Anthropic Claude models.
- `OPENAI_API_KEY`: API key for OpenAI GPT models.
- `OLLAMA_HOST`: Host URL for local Ollama server (default: `http://127.0.0.1:11434`).
- `AG_PROXY_URL`: Local or remote Antigravity Patch Proxy endpoint (default: `http://127.0.0.1:51074`).
- `AG_AUTH_TOKEN`: Fallback for `--auth-token`.

---

## 4. REST Endpoints

All endpoints (except `/health`) require token authentication via `Authorization: Bearer <TOKEN>` or `?token=<TOKEN>`.

### `GET /health`
Returns runtime status and active server details.
```json
{
  "status": "ok",
  "version": "2.0.0",
  "mode": "server",
  "sessions": 3
}
```

### `GET /v2/sessions`
Lists all persisted sessions across restarts.
```json
{
  "sessions": [
    {
      "id": "sess_1720000000",
      "workspace_id": "proj_demo",
      "status": "WAITING_INPUT",
      "fsm_state": "WAITING_INPUT",
      "created_at": 1720000000,
      "updated_at": 1720000050
    }
  ]
}
```

### `POST /v2/sessions`
Creates a new persistent session.
```json
// Request Body:
{
  "session_id": "sess_new",
  "workspace_id": "proj_demo"
}

// Response:
{
  "session": {
    "id": "sess_new",
    "workspace_id": "proj_demo",
    "status": "CREATED",
    "fsm_state": "CREATED",
    "created_at": 1720000100,
    "updated_at": 1720000100
  }
}
```

### `GET /v2/workspaces`
Lists sandboxed workspace directories available under `--workspaces-dir`.

---

## 5. WebSocket Connection (`/v2/ws`)

Connect to:
`ws://<host>:<port>/v2/ws?token=<auth-token>`

Clients can then send and receive Protocol v2 envelopes:
- `session.attach`: Subscribe to a session with optional `since_seq` for instant catchup replay.
- `session.prompt`: Dispatch user requests to trigger the autonomous ReAct loop.
- `tool.approval.respond`: Approve or deny sensitive actions.
- `session.cancel`: Cancel current agent reasoning and tool executions.

---

## 6. Headless VPS Deployment (Systemd Service)

Create `/etc/systemd/system/ag-agentd.service`:

```ini
[Unit]
Description=Antigravity Remote Agent Runtime Daemon
After=network.target

[Service]
Type=simple
User=agent
WorkingDirectory=/home/agent/workspace
Environment="ANTHROPIC_API_KEY=sk-ant-api03-..."
ExecStart=/usr/local/bin/ag-agentd \
  --mode=server \
  --port=8090 \
  --db-path=/home/agent/.ag_agentd.db \
  --workspaces-dir=/home/agent/projects \
  --auth-token=supersecret_token_123 \
  --provider=anthropic \
  --model=claude-3-7-sonnet-20250219
Restart=always
RestartSec=5s
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ag-agentd
sudo journalctl -u ag-agentd -f
```
