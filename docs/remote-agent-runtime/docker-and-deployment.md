# Docker, VPS & Cloud Deployment Guide

## 1. Overview

The **Antigravity Remote Agent Cloud Runtime** (`ag-agentd`) is built as a self-contained, statically compiled daemon that can run:
1. **As a Docker container** (via `Dockerfile` and `docker-compose.yml`)
2. **On a bare-metal Linux VPS** (via systemd and `scripts/deploy/install-cloud-agent.sh`)
3. **On PaaS / Self-hosted platforms** like **Coolify**, Railway, or Portainer.

It runs persistently and autonomously, preserving session state in SQLite WAL mode and isolating file executions inside workspace sandboxes.

---

## 2. Docker Deployment

### 2.1 Quickstart with Docker Compose

From the repository root or inside `remote/`:

```bash
cd remote
docker compose up -d
```

### 2.2 Configuration via `.env` or Environment Variables

Create or pass the following environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `AG_PORT` | `8090` | Port exposed by the daemon. |
| `AG_AUTH_TOKEN` | *(auto)* | Bearer authentication token for Web Console, REST API, and WebSocket. |
| `AG_PROVIDER` | `auto` | AI provider (`anthropic`, `openai`, `ollama`, `proxy`). |
| `AG_MODEL` | *(empty)* | Model identifier (e.g. `claude-3-5-sonnet-20241022`, `gpt-4o`). |
| `AG_SANDBOX` | `native` | Execution sandbox: `native` (host inside container) or `docker` (nested docker containers). |
| `AG_TUNNEL` | `local` | Tunnel provider (`cloudflare`, `pinggy`, or `local`). |
| `ANTHROPIC_API_KEY` | *(empty)* | API key for Anthropic Claude models. |
| `OPENAI_API_KEY` | *(empty)* | API key for OpenAI GPT models. |
| `OLLAMA_HOST` | *(empty)* | Address of Ollama instance (e.g. `http://host.docker.internal:11434`). |

### 2.3 Persistent Volumes

The Docker setup defines two named volumes:
- `ag_data`: Stores SQLite persistent database (`runtime.db` + WAL files) containing all sessions, messages, tool execution logs, and domain events.
- `ag_workspaces`: Stores workspace files, git repositories, and code touched by the AI agent.

### 2.4 Health Check

The container image includes a native HTTP health check on `GET /health` (`interval: 15s`, `retries: 3`).

---

## 3. Automated VPS Deployment (systemd)

For standard Ubuntu, Debian, CentOS, or RHEL VPS instances, an automated installer is provided in `scripts/deploy/install-cloud-agent.sh`.

### 3.1 One-Command Installation

Run as root or with `sudo`:

```bash
sudo bash scripts/deploy/install-cloud-agent.sh
```

### 3.2 What the Installer Does

1. **System & Architecture Detection**: Detects `x86_64` (amd64) or `aarch64` (arm64).
2. **Dedicated User**: Creates an unprivileged system user `ag-agent` for security isolation.
3. **Directories**: Prepares `/var/lib/antigravity/` (database) and `/var/lib/antigravity/workspaces/`.
4. **Binary Compilation / Installation**: Compiles a static binary with `CGO_ENABLED=0` directly on the machine, placing it in `/usr/local/bin/ag-agentd`.
5. **Token Generation**: Generates a secure 32-character hexadecimal token if none was provided.
6. **systemd Unit**: Installs `/etc/systemd/system/ag-agentd.service` with auto-restart on failure.
7. **Firewall & Status**: Starts the service and prints the exact Web Console and Mobile pairing URLs.

### 3.3 Managing the VPS Service

```bash
# Check status
systemctl status ag-agentd

# Stream real-time logs
journalctl -u ag-agentd -f

# Restart daemon
systemctl restart ag-agentd

# Stop daemon
systemctl stop ag-agentd
```

Configuration is stored securely in `/etc/antigravity/ag-agentd.env` (permissions `0600`, owned by `ag-agent`).

---

## 4. Coolify 1-Click Deployment

[Coolify](https://coolify.io) is an open-source self-hosted PaaS. You can deploy `ag-agentd` in Coolify via Docker Compose:

1. In Coolify, click **+ Add Resource** -> **Docker Compose** or **GitHub / Git Repository**.
2. Point to this repository branch (`feat/remote-agent-runtime`).
3. Set **Base Directory** to `/remote`.
4. Define Environment Variables in Coolify UI:
   - `AG_AUTH_TOKEN`: Your secret token.
   - `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`: Your model API key.
   - `AG_SANDBOX`: `native`.
5. Expose port `8090` or set Coolify FQDN (e.g. `https://agent.yourdomain.com`).
6. Click **Deploy**. Coolify will build the multi-stage Docker image and provide automated HTTPS via Traefik.

---

## 5. Execution Sandboxing (`--sandbox`)

The server runtime supports two sandbox models:

1. **`native` (Default)**:
   - Commands (`run_command`) execute directly in the workspace directory with path canonicalization and confinement safeguards.
   - Ideal for single-tenant VPS or when running inside an already containerized Docker container.

2. **`docker`**:
   - Each command runs inside an isolated container (`docker run --rm -v <workspace>:/workspace -w /workspace <image>`).
   - Configurable via `--docker-image` (default: `alpine:latest`), `--docker-memory` (default: `512m`), and `--docker-cpu`.
   - Automatic fallback: If the Docker daemon is not reachable, `ag-agentd` seamlessly falls back to `native` execution with an informative log event, ensuring high availability.

---

## 6. Accessing Connection Surfaces

Once deployed, the agent server exposes three primary interfaces:

1. **Embedded Web Console**:
   ```text
   http://<YOUR_IP_OR_DOMAIN>:8090/console?token=<AG_AUTH_TOKEN>
   ```
   Zero-dependency live browser UI with session management, streaming transcripts, and human-in-the-loop tool approvals.

2. **Flutter Mobile Companion App**:
   - In Mobile Settings, tap **Add Cloud Server**.
   - Enter IP or domain, Port (`8090`), and Auth Token.
   - The app connects either via Protocol v2 WebSocket (`/v2/ws`) or via Protocol v1 adapter (`/ws`).

3. **REST API & Telemetry**:
   - Health check: `GET /health`
   - List Sessions: `GET /v2/sessions` (Header `Authorization: Bearer <TOKEN>`)
   - Create Session: `POST /v2/sessions`
   - Send Prompt: `POST /v2/sessions/{id}/prompt`
