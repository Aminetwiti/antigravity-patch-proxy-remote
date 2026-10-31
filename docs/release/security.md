# Antigravity Remote Agent Cloud — Security Architecture & Hardening

This document outlines the zero-trust security architecture, sandboxing mechanisms, and operational boundaries of `ag-agentd`.

---

## 1. Isolation Boundaries

### A. Non-Root Daemon Process
- The service runs as `ag-agent:ag-agent` (UID/GID isolated).
- Systemd enforces `ProtectSystem=strict`, making the entire OS filesystem read-only to the daemon, except for explicit paths `/var/lib/antigravity` and `/etc/antigravity`.
- `NoNewPrivileges=true` prevents SUID binaries from escalating permissions.

### B. Docker Sandbox (`--sandbox=docker --sandbox-mode=strict`)
Untrusted code execution and tool calls run inside ephemeral Docker containers configured with:
- `ReadonlyRootfs: true`: Container filesystem cannot be modified.
- `CapDrop: ["ALL"]`: All Linux kernel capabilities dropped.
- `SecurityOpt: ["no-new-privileges"]`: No privilege escalation.
- `NetworkMode: "none"`: Container has zero network interfaces.
- `PidsLimit: 256`: Guard against fork-bombs.
- `Memory: 512 MB`: Hard memory ceiling.

### C. Fail-Closed Guarantee
If the host Docker service is stopped or becomes unreachable, `ag-agentd` rejects tool executions immediately with `ErrSandboxUnavailable`. **Host fallback is strictly prohibited** in strict mode.

---

## 2. Network & Application Defense

### A. SSRF Mitigation
The `fetch_web_page` tool and outbound webhook dispatchers strictly validate target IP addresses:
- Rejects loopback (`127.0.0.0/8`, `::1`).
- Rejects RFC1918 private IP subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`).
- Rejects cloud metadata addresses (`169.254.169.254`, `metadata.google.internal`).
- Rejects alternative IP representations (hex, octal, decimal integer, dotless).
- Rejects non-HTTP(S) schemes (`file://`, `gopher://`, `ftp://`).

### B. Rate Limiting & Anti-Spoofing
- In-memory sliding window limiter allows 120 requests/minute per client IP.
- `X-Forwarded-For` headers are only trusted if the immediate socket peer belongs to `AG_TRUSTED_PROXIES` (e.g. reverse proxy CIDR).

### C. Redaction of Sensitive Data
- Session exports (`GET /v2/sessions/export`) and terminal logs scrub API keys (`sk-ant...`, `sk-proj...`), bearer tokens, and session credentials.

---

## 3. Operational Risk Matrix

| Threat | Defense | Residual Risk |
|:---|:---|:---|
| Malicious code escape | Readonly rootfs, CapDrop ALL, PidsLimit | Linux kernel 0-day exploit |
| Network lateral movement | Container NetworkMode: none | None (no network interface) |
| SSRF metadata theft | IP validation before dial | Publicly resolvable DNS rebinding |
| Brute-force token guessing | CSPRNG 256-bit token + Rate Limiter | Weak user-configured token |
| Docker socket misuse | Multi-tenant SaaS rejected | Service user belongs to docker group |
