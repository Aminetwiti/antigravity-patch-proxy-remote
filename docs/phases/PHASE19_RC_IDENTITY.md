# PHASE 19 — RELEASE CANDIDATE IDENTITY SPECIFICATION

**Project:** Antigravity Remote Agent Cloud Runtime  
**Target:** `ag-agentd` v2.0.0  
**Evaluation Gate:** Phase 19 Release Candidate Black-Box Validation  
**Date:** 2026-09-08  

---

## 1. Release Candidate Identity & Provenance

| Identity Field | Value | Source of Evidence |
|:---|:---|:---|
| **Software Version** | `2.0.0` | `release/v2.0.0/VERSION` |
| **Git Commit Hash** | `026dc531014a7f7254dd5ba8c8e7eab29ef4fe9b` | `git rev-parse HEAD` |
| **Git Description / Tag** | `v3.5.0-10-g026dc53` | `git describe --tags --always` |
| **Release Branch** | `feat/remote-agent-runtime` | `git branch --show-current` |
| **Build Architecture** | Pure Go (`CGO_ENABLED=0`), `-ldflags="-s -w"` | Go Toolchain 1.26.2 |
| **Database Engine** | Embedded pure Go SQLite (`modernc.org/sqlite`) | Go Module dependencies |

---

## 2. Release Artifacts & Cryptographic Checksums

Location: `release/v2.0.0/` (verified against `checksums.txt`):

```text
6177f9382f316dd91e4b260a3ff0b528c088db9967a13016743f5029b3e35c82  ag-agentd-linux-amd64
3f291ec6481f5dd43da1d1fc1e30ba10ef1f8b3647dfe763661fdb7b36ee375f  ag-agentd-linux-arm64
90bbf28fd39fe1b55cab671a8d1a3a1e0716b4d86604ec9225e4687939fcd08d  ag-agentd-windows-amd64.exe
```

---

## 3. Host Environment & Subsystem Topology

| Parameter | Observed Value | Classification |
|:---|:---|:---|
| **Host Operating System** | Windows 11 Professional (x86_64) | OBSERVED |
| **Testing Environment** | WSL2 Linux production-like environment (Ubuntu 24.04 LTS) | OBSERVED |
| **Linux Kernel** | `Linux TweeDev 6.18.33.2-microsoft-standard-WSL2 #1 SMP PREEMPT_DYNAMIC Thu Jun 18 21:54:43 UTC 2026 x86_64 GNU/Linux` | OBSERVED |
| **Process Supervisor** | systemd 255.4 (active with sandboxing directives) | OBSERVED |
| **Hardware Virtualization**| 16 vCPUs, 16 GB Virtual RAM | OBSERVED |
| **Storage Subsystem** | ext4 filesystem on dynamic virtual disk (VHDX) | OBSERVED |
| **Database File** | `/var/lib/antigravity/runtime.db` (WAL mode, `synchronous=FULL`) | OBSERVED |
| **Workspaces Directory**| `/var/lib/antigravity/workspaces/` | OBSERVED |
| **Container Engine** | Docker 27.x with `containerd` | OBSERVED |
| **Network Interface** | Virtual Ethernet `eth0` (`172.28.11.5`) & Loopback (`127.0.0.1`) | OBSERVED |
| **External VPS Access** | **NO** (No external VPS accessible without interactive credentials) | **VERIFIED FACT** |
| **Public IP Address** | Internal RFC 1918 / WSL Virtual IP only | OBSERVED |
| **Tunnel Provider** | Cloudflare Quick Tunnel (`cloudflared`) auto-provisioning | VERIFIED |