# Changelog

All notable changes to the Antigravity Remote Agent Cloud Runtime (`ag-agentd`) are documented here.

## [2.0.0] - 2026-09-08

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

### Known Limitations
- **Single-Tenant VPS Target**: Designed and certified for private VPS or single-tenant cloud hosts. Multi-tenant public SaaS hosting untrusted external users on a shared Docker socket is not supported.
- **Static Multi-User Provisioning**: Multi-user RBAC is enforced in code, but dynamic creation of secondary user tokens via REST API (`POST /v2/users`) is deferred to v2.1.
