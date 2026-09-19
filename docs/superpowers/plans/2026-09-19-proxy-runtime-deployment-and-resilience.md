# Proxy Runtime Deployment, Model Quota Resolution & Branch Finalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy all verified resilience improvements (0ms in-memory DNS cache, 15-minute billing circuit breaker, 10-minute Google pool 429 cooldown, orphan DB purge) into the live Antigravity `app.asar`, resolve the exhausted Apinex token ceiling, and commit/finalize the development branch.

**Architecture:** Repack `dist/` into Antigravity's `resources/app.asar` via `repack.ps1` with graceful process reload, configure fallback or update model definition for the exhausted Apinex free quota, and stage/commit clean git changes to `feat/remote-agent-runtime`.

**Tech Stack:** TypeScript, Node.js v22, Electron asar, PowerShell, SQLite (`node:sqlite`), Vitest.

## Global Constraints

- Never hardcode credentials, URLs, or ports (use `src/constants.ts`).
- Respect Ponytail lazy senior dev principles (minimal code, standard library over dependencies).
- All 1096 unit tests and `npm run lint` must stay 100% passing.
- Backward compatibility with existing `custom_models.json` must be preserved.

---

### Task 1: Repack and Deploy Updated Code into Antigravity Runtime

**Files:**
- Target: `$env:LOCALAPPDATA\Programs\antigravity\resources\app.asar`
- Source: `dist/`, `package.json`, `node_modules/`
- Tool: `scripts/repack/repack.ps1` or `npm run repack:win`

**Interfaces:**
- Consumes: Built `dist/` from `npm run build`
- Produces: Repacked `app.asar` containing new `dnsResolver`, `circuitBreaker`, and `proxy` cooldown logic.

- [ ] **Step 1: Verify current build output integrity**
Verify that `dist/proxy.js`, `dist/proxy/dnsResolver.js`, and `dist/proxy/circuitBreaker.js` exist and reflect the new methods.
Run:
```powershell
Get-Item dist\proxy.js, dist\proxy\dnsResolver.js, dist\proxy\circuitBreaker.js | Select-Object Name, Length, LastWriteTime
```
Expected: All 3 files present and recently timestamped.

- [ ] **Step 2: Execute repack to update Antigravity's app.asar**
Run:
```powershell
npm run repack:win
```
Expected:
`Success! app.asar repacked successfully.`
Antigravity automatically terminates, repacks with new `dist/`, and relaunches.

- [ ] **Step 3: Verify running process PID and port 51074 binding**
Run:
```powershell
Get-Process -Name "Antigravity" | Select-Object Id, ProcessName, StartTime
netstat -ano | findstr :51074
```
Expected: New Antigravity PID running, listening on `:51074`.

- [ ] **Step 4: Check live proxy logs for 0ms DNS fast-path and breaker activation**
Tail `$env:APPDATA\Antigravity Patch Proxy\logs\main.log` to confirm DNS queries take 0ms and billing errors trigger the 15-minute cooldown.
Run:
```powershell
Get-Content -Path "$env:APPDATA\Antigravity Patch Proxy\logs\main.log" -Tail 30
```
Expected: Log shows `[Proxy] [dns-timing] public DNS parallel query took 0ms` or fast-path cache hit.

---

### Task 2: Resolve Apinex Exhausted Token Ceiling (`free/deepseek-v4-pro-0813`)

**Files:**
- Config: `%USERPROFILE%\.gemini\antigravity\custom_models.json` (or via `ag-doctor models`)
- Code reference: `src/proxy.ts`, `src/services/modelStore.ts`

**Interfaces:**
- Consumes: `custom_models.json` provider definitions
- Produces: Healthy model configurations where non-functional free endpoints do not stall IDE chat sessions.

- [ ] **Step 1: Inspect current model entry for Apinex**
Run:
```powershell
node ag-doctor/bin/ag-doctor.js models list
```
Expected: List showing `free/deepseek-v4-pro-0813` with its provider, API URL, and status.

- [ ] **Step 2: Update model configuration or fallback chain**
If the Apinex free tier is permanently exhausted (500M tokens consumed), configure its `fallbackModel` / `fallbackChain` to directly route to a working model (e.g. `gemini-2.5-pro` or another active OpenAI-compatible endpoint) so requests do not waste time on repeated 402 rejects.
Run:
```powershell
node ag-doctor/bin/ag-doctor.js doctor
```
Expected: Doctor reports all providers and models validated.

---

### Task 3: Commit and Finalize Development Branch

**Files:**
- Modified: `src/proxy.ts`, `src/proxy/dnsResolver.ts`, `src/proxy/circuitBreaker.ts`, `src/proxy/modelLoader.ts`, `src/proxy/types.ts`, `src/services/modelStore.ts`
- Tests: `src/__tests__/circuitBreaker.test.ts`, `src/__tests__/dnsResolver.test.ts`, `src/__tests__/googleAccountPool.test.ts`
- Doctor: `ag-doctor/src/commands/prune.ts`, `ag-doctor/src/commands/prune.test.ts`, `ag-doctor/src/index.ts`
- Doctor UI: `ag-doctor-ui/src/renderer/index.html`, `ag-doctor-ui/src/renderer/app.ts`

**Interfaces:**
- Consumes: Working directory changes
- Produces: Clean git history ready for merge to `main`.

- [ ] **Step 1: Run full test verification suite**
Run:
```bash
npm run lint && npm test
```
Expected: PASS (1096 tests passing, 0 lint errors).

- [ ] **Step 2: Stage and commit resilience and pruning features**
Run:
```bash
git add src/ ag-doctor/ ag-doctor-ui/ docs/
git commit -m "feat(resilience): add in-memory DNS cache, adaptive billing circuit breaker, account pool cooldown and db:prune command"
```
Expected: Working tree clean for tracked source directories.

- [ ] **Step 3: Decide branch integration**
Optionally merge `feat/remote-agent-runtime` into `main` or push to origin as requested by user.

---
