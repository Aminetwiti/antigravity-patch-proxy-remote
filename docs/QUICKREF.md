# Quick Reference: Top 5 commands

> Speed dial. Full details in [README.md](../README.md) and [TROUBLESHOOTING.md](../TROUBLESHOOTING.md).

## 1. "Everything is broken after an Antigravity update"

```powershell
npm run repatch
```

Re-build + repack `app.asar` + relaunch. Equivalent to double-click `repatch.bat`.

## 2. "Custom models no longer respond"

```bash
npm run doctor
```

Full diagnostic (proxy, MITM, encryption, models). Auto-fix:

```bash
npm run doctor:repair
```

## 3. "MITM 443 dead after reboot"

```powershell
# PowerShell ADMINISTRATOR
npm run start:mitm
```

Launches `scripts/mitm/start_mitm_443.ps1` with UAC, imports CA, forwards to ${AG_PROXY_PORT:-51074}.

## 4. "Rebuild without redeploying"

```bash
npm run build       # TypeScript -> dist/
npm run test        # vitest run
npm run lint        # tsc --noEmit
```

## 5. "Check my patch state"

```bash
npm run doctor:check    # exit-code-only, CI-friendly
npm run doctor:models   # list custom models
npm run doctor:logs     # tail -f language_server.log
```

---

## OS-aware actions

| Action | Windows | macOS | Linux |
|---|---|---|---|
| Repack | `npm run repack:win` | `npm run repack:mac` | `npm run repack:linux` |
| MITM | `npm run start:mitm` (admin) | manual `bash scripts/deploy/deploy.sh` | N/A |

> On macOS/Linux, MITM 443 is not automated. See [troubleshooting/mitm-procedure.md](troubleshooting/mitm-procedure.md) for the manual procedure.