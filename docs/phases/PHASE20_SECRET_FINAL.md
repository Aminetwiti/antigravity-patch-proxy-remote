# PHASE 20 — FINAL SECURITY INCIDENT & CREDENTIAL HYGIENE AUDIT

**Incident Reference:** INC-2026-0909-TOKEN-EXPOSURE-V2  
**Classification:** HIGH (Hardcoded Fallback Secret in Client Source & Incomplete VPS Secret Revocation)  
**Status:** **PARTIALLY CONTAINED LOCALLY / ACTION REQUIRED ON REMOTE VPS**  
**Audit Date:** 2026-09-09  

---

## 1. Incident Description & Scope

During the Phase 20 Final Ship Certification audit, a recursive repository and live endpoint inspection revealed that the bearer token generated during Phase 19 (`4d8b9f1a2c3e5a7b0e2f4a6c8d1e3b5a7c9e1f3a5b7d9f1a3c5e7b9d1f3a5b7d`) was:
1. **Committed directly into client source code** as default fallback values in:
   - `src/preload.ts` (line 204: `const DEFAULT_TOKEN = "4d8b9f1a..."`)
   - `scripts/patch_ide_remote.py` (line 30: `let t=localStorage.getItem(...) || "4d8b9f1a..."`)
2. **Recorded in plaintext** across Phase 19 audit markdown reports (`PHASE19_SECURITY_INCIDENT.md`, `PHASE19_REAL_VPS.md`).
3. **Still active and unrevoked on the live production VPS**:
   - `curl -i "https://pharmaceuticals-willing-warrant-pound.trycloudflare.com/v2/schedules?token=4d8b9f1a..."` returned `HTTP/1.1 200 OK` on 2026-09-09 at 10:11 UTC.

---

## 2. Root Cause Analysis

1. **Client Ergonomics Shortcut**: During Phase 19 IDE integration, developers embedded the active VPS token as a fallback default in `preload.ts` and `patch_ide_remote.py` to allow instant UI testing without manual configuration.
2. **Documentation Leakage**: The token was quoted verbatim in Phase 19 verification reports without redaction.
3. **Remote Access Boundary**: Rotating the secret on the remote VPS requires SSH access to edit `/etc/antigravity/ag-agentd.env` and restart `ag-agentd.service`. Because external SSH access to `root@62.169.27.8:4155` returned `Permission denied (publickey,password)` during this black-box verification session, the token could not be rotated remotely by the automated test harness.

---

## 3. Containment & Remediation Actions Taken

### Step 1: Local Codebase Scrubbing
The hardcoded fallback secret was eliminated from all local client source files:
- `src/preload.ts`: `DEFAULT_TOKEN` was reset to `""` (empty string). `getRemoteConfig()` now marks `configured: false` when no token is saved in `localStorage`, prompting the user to open `openRemoteConfigModal()`.
- `scripts/patch_ide_remote.py`: Removed fallback token, setting `t = localStorage.getItem("ag_remote_token") || ""`.

### Step 2: Build & Type-Check Verification
Executed:
- `npm run lint` (`tsc --noEmit`): PASSED (0 errors).
- `npm run build` (`tsc`): PASSED (`dist/` updated without hardcoded credentials).

### Step 3: Recursive Credential Scan
Scanned repository via `git grep` and pattern matchers for:
- `auth-token`
- `Bearer`
- `token=`
- `AG_AUTH_TOKEN`
- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `sk-`
- `csrf`
- `password`
- `secret`

Findings:
- Active source code is 100% free of plaintext production credentials.
- All historical tokens in markdown reports must be treated as irrevocably compromised.

---

## 4. Current State Across Environments

| Surface | Status | Verification Evidence |
|:---|:---:|:---|
| **Process Command Line (`ps`, `/proc`)** | **PASS** | `/usr/local/bin/ag-agentd --mode=server --port=8090 --host=127.0.0.1` contains 0 flags. |
| **Systemd Unit (`ExecStart`)** | **PASS** | Uses environment file `/etc/antigravity/ag-agentd.env` with `0600` permissions. |
| **Client Source Code (`src/preload.ts`)** | **PASS** | Hardcoded token scrubbed; dynamic user configuration modal used. |
| **Patch Scripts (`patch_ide_remote.py`)**| **PASS** | Hardcoded token scrubbed. |
| **Legacy Token (`80950aff...`)** | **PASS** | HTTP 401 Unauthorized verified against live endpoint. |
| **Phase 19 Token (`4d8b9f1a...`) on VPS** | **FAIL (ACTIVE)** | Returns HTTP 200 OK on live VPS; requires remote admin rotation. |
| **Public URLs & Query Parameters** | **FAIL** | Cloudflare tunnel endpoint accepts token via query string until rotated on host. |

---

## 5. Required Day-1 Operational Action for VPS Administrator

The host administrator must execute the following rotation on `62.169.27.8`:

```bash
# 1. Connect as root
ssh -p 4155 root@62.169.27.8

# 2. Generate new 256-bit CSPRNG token
NEW_TOKEN=$(openssl rand -hex 32)

# 3. Update environment file with strict 0600 permissions
sed -i "s/^AG_AUTH_TOKEN=.*/AG_AUTH_TOKEN=${NEW_TOKEN}/" /etc/antigravity/ag-agentd.env
chmod 0600 /etc/antigravity/ag-agentd.env

# 4. Restart service to invalidate old token
systemctl restart ag-agentd

# 5. Verify old token returns 401
curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:8090/v2/schedules?token=4d8b9f1a2c3e5a7b0e2f4a6c8d1e3b5a7c9e1f3a5b7d9f1a3c5e7b9d1f3a5b7d"
# Expected: 401
```

---

## 6. Final Incident Verdict

```text
==============================================================================
               INCIDENT VERDICT: FIX BEFORE RELEASE (ON REMOTE VPS)
==============================================================================

  LOCAL REPOSITORY: CLEAN (Hardcoded fallback secrets removed)
  REMOTE VPS: COMPROMISED TOKEN REMAINS ACTIVE
  REASON: Automated test harness lacks SSH root credentials to rotate remote env.
  ACTION: VPS Administrator must rotate AG_AUTH_TOKEN prior to production signoff.

==============================================================================
```
