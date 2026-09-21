# Security Architecture — ag-agentd v2.0.0

## Threat Model & Boundaries

`ag-agentd` is strictly architected for **Private Dedicated VPS / Single-Tenant Infrastructure**. It is NOT designed to serve as a multi-tenant public SaaS hosting untrusted external users on a shared Docker daemon.

### 1. Execution Isolation
- All agent command and tool execution occurs inside isolated Docker containers.
- Hardening parameters:
  - `ReadonlyRootfs: true`
  - `CapDrop: ["ALL"]`
  - `SecurityOpt: ["no-new-privileges"]`
  - `NetworkMode: "none"`
  - `PidsLimit: 256`
  - `Memory: 512 MB`
- **Fail-Closed Policy**: If the Docker daemon is unreachable or stopped, host fallback is strictly denied. Commands fail with `ErrSandboxUnavailable`.

### 2. Network Perimeter & SSRF Protection
- Outbound tools (`fetch_web_page`) and webhooks strictly validate IP destinations:
  - Rejects `127.0.0.0/8`, `::1` (loopback).
  - Rejects `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` (RFC1918).
  - Rejects `169.254.169.254` (cloud metadata).
  - Rejects hexadecimal, octal, decimal, and dotless IPv4 representations.
  - Rejects non-HTTP(S) schemes.

### 3. Rate Limiting & Anti-Spoofing
- 120 requests/minute sliding window rate limiter per client IP.
- `X-Forwarded-For` header is only respected if the immediate network peer is configured in `AG_TRUSTED_PROXIES`.

### 4. Secrets Scrubbing
- Post-mortem trajectory exports (`GET /v2/sessions/export`) and terminal logs automatically redact API keys (`sk-ant...`, `sk-proj...`), bearer tokens, and database passwords.
