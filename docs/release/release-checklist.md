# Antigravity Remote Agent Cloud — Release Candidate Checklist

This checklist defines the gate criteria required to certify a build of `ag-agentd` as a **Release Candidate (RC)** for dedicated private VPS deployments.

---

## 1. Quality & Test Gates
- [x] **Static Analysis (Go)**: All 33 packages pass `go test -count=1 ./...` with zero failures.
- [x] **Static Analysis (Frontend)**: `npm run lint` (`tsc --noEmit`) passes with zero errors.
- [x] **Static Analysis (Mobile)**: `flutter analyze` in `remote/mobile` reports 0 issues.
- [x] **Adversarial Security Tests**: SSRF evasion vectors, rate-limiting spoofing, and silent fallback prevention pass 100%.
- [x] **Reality Integration Tests**: Real Git worktrees, SQLite WAL durability, and process crash recovery pass on clean Linux.

---

## 2. Binary & Packaging
- [x] **Pure Static Binaries**: Compiled with `CGO_ENABLED=0` to ensure zero host glibc/musl dynamic library dependencies.
- [x] **Multi-Architecture**: Cross-compiled for Linux AMD64, Linux ARM64, and Windows AMD64.
- [x] **Symbol Stripping**: Compiled with `-ldflags="-s -w"` to minimize binary footprint (< 15 MB).
- [x] **Build Traceability**: Version, Git commit hash, build date, Go version, and platform embedded into the binary and queryable via `/health`.
- [x] **Cryptographic Integrity**: SHA-256 checksums generated and recorded in `checksums.txt`.

---

## 3. Deployment & Systemd Hardening
- [x] **Non-Root Execution**: Runs under dedicated unprivileged user `ag-agent:ag-agent`.
- [x] **Systemd Security Sandbox**:
  - `NoNewPrivileges=true`
  - `ProtectSystem=strict`
  - `ProtectHome=true`
  - `PrivateTmp=true`
  - `PrivateDevices=true`
  - `ProtectKernelTunables=true`
  - `ProtectKernelModules=true`
  - `ProtectControlGroups=true`
  - `RestrictSUIDSGID=true`
  - `LockPersonality=true`
- [x] **Automated Recovery**: `Restart=always` with `RestartSec=5s` in systemd service configuration.
- [x] **Directory Permissions**: `/etc/antigravity` (0750) and `/var/lib/antigravity` (0750) restricted to service user.

---

## 4. Sandbox & Execution Security
- [x] **Strict Docker Mode**: `--sandbox=docker --sandbox-mode=strict` enforced by default.
- [x] **Container Hardening**:
  - Read-only root filesystem (`ReadonlyRootfs: true`)
  - Full Linux capabilities dropped (`CapDrop: ["ALL"]`)
  - No privilege escalation (`no-new-privileges`)
  - Network isolation (`NetworkMode: "none"`)
  - Memory ceiling (`512 MB`) and process ceiling (`256 PIDs`)
- [x] **Fail-Closed Guard**: Host command execution strictly denied when Docker daemon is unavailable.

---

## 5. Network & Access Control
- [x] **Default Loopback Binding**: `127.0.0.1:8090` default. Public interfaces require explicit `--allow-public-bind`.
- [x] **Mandatory Token Authentication**: Constant-time token verification (`crypto/subtle.ConstantTimeCompare`) on all session and management endpoints.
- [x] **SSRF Defense**: Tool execution and webhooks reject loopback, RFC1918 private subnets, cloud metadata IPs, and non-HTTP schemes.
- [x] **Sliding-Window Rate Limiter**: 120 req/minute rate limit with trusted proxy validation for anti-spoofing.
- [x] **Secrets Sanitization**: Session exports and logs scrub API keys, tokens, and authorization headers.

---

## 6. Approved Operational Scope
- **Target A: Private VPS / Single-Tenant Cloud Instance**: **APPROVED (RC)**
- **Target B: On-Premises Dedicated Server**: **APPROVED (RC)**
- **Target C: Public Multi-Tenant SaaS**: **PROHIBITED (Requires microVM isolation)**
