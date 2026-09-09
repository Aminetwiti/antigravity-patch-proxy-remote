# PHASE 20 — BLACK-BOX EVIDENCE MATRIX & EMPIRICAL AUDIT LOG

**Project:** Antigravity Remote Agent Cloud Runtime  
**Target:** `ag-agentd` v2.0.0 (Release Candidate & GA Gate)  
**Audit Standard:** "NO CLAIM WITHOUT EVIDENCE" (Zero-Trust)  
**Date:** 2026-09-09  

---

## 1. Final Structured Evidence Matrix (Section 20 Standard)

| Gate | Environment | Test Scenario | Classification | Empirical Evidence & Trace | Result |
|:---|:---|:---|:---:|:---|:---:|
| **GATE-01: Commercial LLM Provider** | Cloud VPS (`vmi2743594`) | Autonomous agent turn via live WebSocket prompt | **REAL** | Prompt sent via `/v2/ws` on session `sess_1788945181673_506861`; daemon dialed `http://127.0.0.1:51074/v1/chat/completions` and failed with `dial tcp 127.0.0.1:51074: connect: connection refused`. No active `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` in headless VPS environment; configured desktop key hits HTTP 429 quota exhaustion. | **FAIL** |
| **GATE-02: Real Mobile Workflow** | Physical Phone | Device pairing, gesture control, network failover | **NOT TESTED** | `adb devices -l` executed against Android SDK platform-tools; returned `List of devices attached: <empty>`. Zero physical devices tethered for live touch/4G-WiFi testing. | **NOT TESTED** |
| **GATE-03: Full Machine Reboot** | Cloud VPS (`vmi2743594`) | Bare-metal `sudo reboot` and full recovery | **NOT TESTED** | Live daemon on `vmi2743594` exhibits continuous `uptimeSeconds: 63095` (~17.5 hours since Sep 8). Host was never rebooted. Remote SSH execution of `sudo reboot` rejected with `Permission denied (publickey,password)`. Multi-tenant server with active client websites and Coolify. | **NOT PROVEN** |
| **GATE-04: Power Loss** | Cloud VPS (`vmi2743594`) | Hardware cut via IPMI/PDU | **NOT TESTED** | VPS virtualization provider does not expose IPMI/PDU hardware control to this session. | **NOT TESTED** |
| **GATE-05: Secret Rotation & Hygiene** | Cloud VPS & Repo | Token revocation and hardcoded secret scrub | **REAL** | Revoked token `80950aff...` returns HTTP 401 Unauthorized (`PASS`). Compromised token `4d8b9f1a...` was found hardcoded in `src/preload.ts` and `scripts/patch_ide_remote.py` and active on live VPS (`HTTP 200 OK`). Scrubbed from local source code, but remains active on remote VPS pending admin SSH access. | **FAIL** |
| **P20-006: Live Cloudflare Ingress** | Public Internet | HTTPS & WSS reachability via Cloudflare tunnel | **REAL** | `https://pharmaceuticals-willing-warrant-pound.trycloudflare.com/health` returns `HTTP 200 OK` (`hostname: vmi2743594`, `version: 2.0.0`, `serverId: srv_1788882085886`). | **PASS** |
| **P20-007: SQLite Session Persistence** | Cloud VPS | Creation & persistence of autonomous sessions | **REAL** | `POST /v2/sessions` created `sess_1788945181673_506861` (`state: CREATED`); persisted across queries. Previous sessions from Sep 8 retained in SQLite WAL. | **PASS** |
| **P20-008: FSM Domain Lifecycle** | Cloud VPS | State transitions on client interaction | **REAL** | On prompt dispatch, FSM advanced `CREATED -> STARTING -> RUNNING -> FAILED` with atomic state change events recorded in SQLite. | **PASS** |
| **P20-009: WebSocket StepRecovery Replay** | Cloud VPS | Client session attach and sequence catchup | **REAL** | Client attached to `sess_1788945181673_506861` with `lastSequence: 0`; server returned `session.catchup` with event sequence 1 (`session.created`), preserving message ordering. | **PASS** |
| **P20-010: Persistent Scheduler Execution** | Cloud VPS | Nightly cron execution on remote server | **REAL** | Schedule `cron-audit` executed autonomously on VPS at `2026-09-09T02:00:00.888+01:00` (`lastStatus: COMPLETED`, session `sess_1788915600910_5b5363`). | **PASS** |
| **P20-011: Docker Sandbox Fail-Closed** | Linux Subsystem | Tool execution rejection without container engine | **VERIFIED** | Stopping Docker engine triggers `ErrSandboxUnavailable` with zero host execution fallback (`TestSandbox_FailClosed_NoHostFallback`). | **PASS** |
| **P20-012: Disaster Recovery RTO** | Cloud VPS | State wipe and point-in-time snapshot restore | **OBSERVED** | Hot SQLite backup restored with `PRAGMA integrity_check = ok`, measured RTO: 47.0s on real VPS. | **PASS** |
| **P20-013: Desktop Proxy Compilation** | Local Node.js | TypeScript type-checking and distribution build | **VERIFIED** | `npm run lint` (`tsc --noEmit`) and `npm run build` (`tsc`) executed cleanly with 0 errors. Local proxy active on port 51074. | **PASS** |

---

## 2. Evidence Classification Audit

In accordance with Section 19 directives:
- **REAL & OBSERVED**: Empirical live requests executed directly against the remote VPS daemon on `vmi2743594` via the live Cloudflare Tunnel (`pharmaceuticals-willing-warrant-pound.trycloudflare.com`) and local toolchains.
- **NOT TESTED / NOT PROVEN**:
  - `GATE-01 (Commercial Provider)`: VPS runtime has no API key and cannot reach a commercial provider; prompt failed with connection refused on `:51074`.
  - `GATE-02 (Physical Mobile)`: No smartphone tethered (`adb devices` empty).
  - `GATE-03 (Full Machine Reboot)`: VPS daemon has continuous 17.5-hour uptime; OS reboot never executed.
  - `GATE-04 (Power Loss)`: No hardware IPMI interface available.
  - `GATE-05 (Secret Incident on VPS)`: Compromised token remains active on remote host due to absence of SSH access.
