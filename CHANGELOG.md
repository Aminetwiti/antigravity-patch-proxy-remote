# Changelog

All notable changes to the Antigravity Patch Proxy and Remote Agent Cloud Runtime are documented here.

## [3.5.0] - 2026-09-10 (Desktop Patch Proxy & IDE Integration)

### Added
- **Antigravity IDE (VS Code Platform Fork v1.107.0+) Support**: Integrated autonomous background proxy starter hook in `main.js` and `jetski.cloudCodeUrl` override alongside classic Antigravity 2.0 Electron binary patching.
- **In-Stream Model Auto-Fallback**: Emits inline markdown warning notices (`> ⚠️ Auto-fallback: <model-1> failed... Retrying with <model-2>`) into active chat streams on 429 rate-limit or upstream timeouts without breaking session context.
- **ag-doctor CLI & UI Suite**: 26 diagnostic and maintenance subcommands including `models rekey` (re-encrypting language server v10 keys), `repair-asar`, `check-asar`, live traffic inspection, and error scenario simulation.
- **Zero-Config Windows Auto-Heal**: Automatic backup restoration and binary re-patching across official Antigravity updates via `scripts/auto-heal.ps1` and `scripts/supervise-daemon.ps1`.
- **Extended Provider Matrix**: Full streaming and function calling support across 19+ providers (Claude 3.5 Sonnet, GPT-4o, DeepSeek R1 / V3, Ollama, LM Studio, OpenRouter, Google AI Studio).

### Changed
- Default request body limit configured to 100 MB (`DEFAULT_MAX_BODY_SIZE`) to accommodate complex multimodal and long-context trajectories.
- Hardened key storage using Electron `safeStorage` (AES-256-GCM) with automatic migration from plaintext legacy configs.

---

## [2.0.0] - 2026-09-08 (Antigravity Remote Agent Cloud Runtime `ag-agentd`)

### Added
- **Pure Static Linux & Windows Binaries**: Cross-compiled standalone executables for Linux AMD64, Linux ARM64, and Windows AMD64 using pure Go SQLite (`modernc.org/sqlite`) with zero dynamic dependencies.
- **Strict Docker Container Sandbox**: Ephemeral container execution with dropped capabilities (`ALL`), read-only root filesystems, memory ceilings (512MB), and zero network egress (`NetworkMode: "none"`).
- **Fail-Closed Security**: Strictly denies host fallback execution if the container runtime is unreachable (`ErrSandboxUnavailable`).
- **Persistent PTY Sessions**: Interactive terminal sessions survive client disconnects; re-attaching clients automatically receive scrollback buffers.
- **Comprehensive SSRF Defense**: Strict socket-level IP address validation for outbound HTTP tools and webhooks, rejecting loopback, RFC1918 subnets, cloud metadata IPs, and evasive IP notations.
- **Multi-Turn Git Worktrees**: Full branch isolation, real-time Git diff tracking, atomic commits, and disk integrity verification.
- **Embedded Web Console**: Self-contained Single-Page Application (SPA) served at `/console` and `/` without third-party CDN dependencies.
- **Role-Based Access Control (RBAC)**: Enforced permission checking (`admin`, `user`, `readonly`) on all session, workspace, commit, approval, and MCP tool execution endpoints.
- **Automated Secrets Redaction**: Trajectory export endpoint (`GET /v2/sessions/export`) and terminal logs scrub API keys, bearer tokens, and connection strings.
- **Systemd Hardening**: Automated Linux installer provisioning non-root service user `ag-agent` with strict filesystem, kernel, and capability protections.

### Changed
- Refactored server runtime into modular REST and WebSocket architecture under `pkg/server/`.
- Default network binding restricted to `127.0.0.1:8090`; public exposure requires explicit `--allow-public-bind`.
- Upgraded SQLite event store to enforce Write-Ahead Logging (`wal`) mode with synchronous=NORMAL.

### Fixed
- Prevented silent fallback from Docker sandbox to host command execution (BLK-01).
- Eliminated SSRF vulnerabilities in `fetch_web_page` and webhook dispatchers (BLK-02).
- Resolved terminal subprocess termination upon client WebSocket disconnection (HIGH-01).
- Prevented rate limiter bypass via spoofed `X-Forwarded-For` headers by enforcing `AG_TRUSTED_PROXIES` (HIGH-02).
- Sanitized sensitive API credentials in session export post-mortems (HIGH-04).
- Fixed Docker group permission requirement in automated VPS installer (HIGH-05).
- Eliminated command-line credential exposure in systemd process arguments by adding native `AG_AUTH_TOKEN` environment variable resolution and stripping `--auth-token` from CLI invocation (`INC-2026-0908-SYSTEMD-TOKEN-LEAK`).
- Resolved multi-user IDOR access gaps and privilege escalations on workspace, session, terminal, and approval endpoints.

### Verified & Deployed (Phase 19 & 20)
- **Real External Cloud VPS Deployment**: Verified live on Ubuntu 24.04 LTS (`62.169.27.8:4155`) under systemd supervision with zero secret leakage in `/proc/<PID>/cmdline` or `ps aux`.
- **Public Ingress & Remote Access**: Automated Cloudflare Quick Tunnel TLS bridge tested end-to-end for both Web Console (`/console`) and Mobile WebSockets (`/v2/ws`).
- **Disaster Recovery & SQLite Durability**: Online hot point-in-time SQLite snapshot validated with catastrophic state wipe and restore (RTO: 47s, 0 data loss, `PRAGMA integrity_check = ok`).
- **Physical Mobile Companion**: Built Android APK with Impeller Vulkan engine, installed and verified on Samsung Galaxy S21 FE 5G (`SM G990B2`).

### Known Limitations
- **Single-Tenant VPS Target**: Designed and certified for private VPS or single-tenant cloud hosts. Multi-tenant public SaaS hosting untrusted external users on a shared Docker socket is not supported.
- **Static Multi-User Provisioning**: Multi-user RBAC is enforced in code, but dynamic creation of secondary user tokens via REST API (`POST /v2/users`) is deferred to v2.1.

