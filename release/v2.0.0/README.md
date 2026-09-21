# Antigravity Remote Agent Cloud Runtime (ag-agentd) v2.0.0

> Official Production Release for Private VPS & Single-Tenant Cloud Instances.

`ag-agentd` is a headless, standalone AI agent server runtime that allows developers to run, supervise, and interact with coding AI agents on a remote Linux server from mobile phones, desktop IDEs, or web browsers — with persistent execution that continues when client devices disconnect.

---

## Key Capabilities

- **Zero Host Drift**: 100% pure static Go binary with embedded modernc SQLite; zero glibc or shared library dependencies.
- **Strict Container Isolation**: Untrusted commands and tools execute inside ephemeral Docker containers with dropped capabilities (`ALL`), read-only root filesystems, memory caps (512MB), and zero network egress (`NetworkMode: "none"`).
- **Persistent PTY & Git Worktrees**: Terminal processes and Git branch worktrees run detached on the server; dropping your connection does not interrupt long builds, tests, or commits.
- **Client Detach Resilience**: Turn off your laptop or close your phone; the agent finishes its multi-turn tasks, persists all events to SQLite (WAL mode), and replays trajectory upon client reconnect.
- **Multi-Client Convergence**: Connect from Mobile (Flutter app), Desktop (Antigravity IDE), and Web Console (`/console`) simultaneously to the same live session.
- **Model Context Protocol (MCP)**: Built-in host for MCP tool servers and dynamic tool invocation.

---

## Release Artifacts

| Binary | Target Platform | SHA-256 Checksum |
|:---|:---|:---|
| `ag-agentd-linux-amd64` | Linux x86_64 | `165db9c3c46d1e2983a0522181892868f267ef5deaa8e1b931ab9e94ea46405c` |
| `ag-agentd-linux-arm64` | Linux aarch64 | `9aaae47781293dbbca145c29b4669e8d2fcba5fe671ece241e374ffd6365597f` |
| `ag-agentd-windows-amd64.exe` | Windows x86_64 | `608a661da53e81acd2f54db17a3d4c86a89dcad51a72efea56b65d29fa932fd5` |

Verify with:
```bash
sha256sum -c checksums.txt
```

---

## Quick Start
```bash
# Automated install on Linux VPS (Ubuntu, Debian, Rocky, Arch)
sudo bash scripts/deploy/install-cloud-agent.sh

# Verify health
curl http://127.0.0.1:8090/health
```

See `INSTALL.md` for manual configuration and reverse proxy setups.
