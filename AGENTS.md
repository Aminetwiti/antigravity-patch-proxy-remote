# AGENTS.md — Antigravity Patch Proxy

> `antigravity-patch-proxy` v3.4.2 — Desktop Electron proxy that injects custom LLM models (Claude, GPT, DeepSeek, Ollama, etc.) into Google Antigravity IDE.


---

## 1. Repository Map

```
antigravity-add-model-main/
├── AGENTS.md                        # This file — master system map & developer guide
├── package.json                     # Entry: dist/main.js | Scripts: build/test/lint/doctor/repack/patch
├── tsconfig.json                    # ES2020, commonjs, strict: partial
├── vitest.config.ts                 # Vitest, node env, electron stubbed
│
├── src/                             # Desktop Electron Patch Proxy
│   ├── main.ts                      # Electron lifecycle, LS startup, proxy boot
│   ├── proxy.ts                     # HTTP proxy server orchestration
│   ├── preload.ts                   # contextBridge → window.* APIs (10 domains)
│   ├── ipcHandlers.ts               # Legacy IPC — migrating to src/ipc/
│   ├── constants.ts                 # PROVIDERS, ports, timeouts — source of truth
│   ├── configExchange.ts            # Provider config import/export + AES-256-GCM
│   ├── schemaValidator.ts           # Runtime response validation
│   ├── proxy/                       # Translators & proxy resilience (circuit breaker, retry budget, etc.)
│   ├── services/                    # CryptoStore (safeStorage), ModelStore, SettingsService
│   ├── ipc/                         # Modular IPC handlers
│   └── __tests__/                   # 55 test files, 1469 tests (Vitest)
│
├── remote/                          # Antigravity Remote 2.0 Ecosystem
│   ├── PROTOCOL.md                  # ConnectRPC & WebSocket wire protocol specification
│   ├── daemon/                      # Go Daemon Bridge (gRPC-Web ↔ WebSocket + Cloudflare/Pinggy Tunnels)
│   │   ├── main.go                  # Daemon CLI entrypoint (flags: --port, --host, --tunnel, --auth-token, --approval-timeout)
│   │   ├── pkg/adb/                 # Android Debug Bridge remote file & device operations
│   │   ├── pkg/discovery/           # Process scanner, CSRF watchdog, PIN pairing & UDP LAN Beacon
│   │   ├── pkg/connectrpc/          # ConnectRPC / gRPC-Web client, Jetbox Connect JSON & protobuf framing
│   │   ├── pkg/gateway/             # WebSocket hub, StepRecovery, PTY terminal, Scheduler, history & RPC dispatchers
│   │   └── pkg/tunnel/              # Automated Cloudflare Quick Tunnel & Pinggy bridge, terminal QR generator
│   │
│   └── mobile/                      # Flutter Companion App (Android / iOS)
│       ├── lib/
│       │   ├── core/protocol/       # DaemonApi typed WebSocket client & Markdown renderer
│       │   ├── theme/app_colors.dart# Exact Antigravity 2.0 IDE design tokens (htmlcss.log)
│       │   ├── features/
│       │   │   ├── chat_stream/     # Streaming chat with Quiet Console welcome & action pills
│       │   │   ├── sessions/        # Session drawer & trajectory management
│       │   │   ├── workspace/       # File tree viewer, search & Git worktree switcher
│       │   │   ├── mcp/             # MCP server & tools explorer
│       │   │   ├── scheduled_tasks/ # Scheduled cron & background tasks dashboard
│       │   │   ├── code_review/     # In-line code commenting modal
│       │   │   ├── discovery/       # QR scanner & daemon pairing
│       │   │   └── settings/        # Profile, appearances, timeouts & diagnostics export
│       │   └── widgets/             # Tool approval cards, AskQuestion modal, diff viewers
│       └── test/                    # 215 unit and widget tests
│
├── ag-doctor/                       # Diagnostic CLI (bin/ag-doctor.js)
├── ag-doctor-ui/                    # Electron diagnostic UI
├── scripts/                         # repack/, deploy/, mitm/, patch_*.js, auto-heal.ps1, supervise-daemon.ps1
├── assets/                          # Screenshots & logos
├── ARCHITECTURE.md                  # Deep architecture documentation
├── DESIGN.md                        # UI design system specification
├── TROUBLESHOOTING.md               # Common issues & fixes
├── repatch.bat                      # Windows one-click repatch
└── "Start Antigravity MITM.bat"     # MITM mode launcher
```

---

## 2. Architecture

```
IDE Chat UI ↔ Language Server (Go Binary, patched) ↔ Local Proxy :${AG_PROXY_PORT:-51074}
                                                           │
                                              ┌────────────┴────────────┐
                                         Translator Registry   Protobuf Injector
                                              │                        │
                                   OpenAI API / Anthropic API    Model list modified
                                   / Google AI Studio           in GetAvailableModels
                                              ▲
                                              │
Language Server (Hub :55256) ◄── gRPC-Web ── Daemon Go (:8090 / Cloudflare Tunnel)
                                                     ▲
                                                     │ WebSocket (JSON RPC)
                                                     ▼
                                        Mobile Client (Flutter App)
```

**Three core mechanisms:**
1. **Binary Patching** — Go binary string tables: `daily-cloudcode-pa.googleapis.com` → `127.0.0.1:${AG_PROXY_PORT:-51074}`
2. **HTTP Interception** — `session.defaultSession.webRequest.onBeforeRequest` + proxy server
3. **Protobuf Injection** — Parse gRPC-Web `GetAvailableModels` response → append custom models → re-encode
4. **Remote Daemon Bridge** — Automatic PID discovery, CSRF watchdog, gRPC-Web framing, and WebSocket multiplexing with StepRecovery buffer
5. **Quota Push** — Daemon scheduler polls the LS `RetrieveUserQuotaSummary` every 60 s (only when clients are connected) and broadcasts `quota_update` over WebSocket; the mobile consumes it instead of polling
6. **Auto-heal** — `scripts/auto-heal.ps1` + `register-auto-heal.ps1` (Startup VBS) + `supervise-daemon.ps1` restore the binary patch after an official update overwrites `app.asar`

---

## 3. Exact Commands

### Proxy & Desktop
```bash
npm run build                   # tsc (compile src/ → dist/)
npm run lint                    # tsc --noEmit (type-check only)
npm test                        # vitest run (all 2565+ tests)
npm run test:watch              # vitest (watch mode)
npm run watch                   # tsc --watch

npm run doctor                  # Full diagnostic
npm run doctor:repair           # Auto-repair binary patch
npm run doctor:models           # List custom models
npm run doctor:logs             # Tail logs (-f -n 100)
npm run doctor:check            # Quick check only

npm run patch:2.2               # Apply Antigravity 2.2.1 patch
npm run patch:2.3               # Apply Antigravity 2.3.x / 2.4.x patch
npm run patch:2.5               # Apply Antigravity 2.5.x patch
npm run repatch                 # Windows one-click repatch
npm run mitm:start              # Start MITM HTTPS proxy
```

### Remote Daemon (Go Bridge)
```bash
cd remote/daemon
go test ./...                   # Run all 243 Go unit & property tests
go run main.go --port 8090 --tunnel cloudflare --auth-token mysecret
```

### Remote Resilience (Windows)
```powershell
powershell -NoProfile -File scripts\register-auto-heal.ps1   # one-time: Startup VBS → auto-heal at boot
powershell -NoProfile -File scripts\supervise-daemon.ps1 -Once  # one-shot daemon watchdog
powershell -NoProfile -File scripts\supervise-daemon.ps1 -Loop  # loop mode (scheduled task)
```
`repatch.bat` caches the patched `app.asar` (+ `.unpacked`) to `~/.gemini\antigravity\scratch\` and registers the auto-heal VBS. On an official update, `auto-heal.ps1` detects the lost `MODEL_PLACEHOLDER_` signature, kills Antigravity + language_server, restores the cache, and relaunches.

### Remote Mobile (Flutter App)
```bash
cd remote/mobile
flutter analyze                 # Dart static analysis (0 issues)
flutter test --exclude-tags=live # Run all 215 Flutter unit & widget tests (excludes @Tags(['live']))
flutter run -d <device-id>      # Run on connected phone (e.g. Galaxy S21 FE)
```

**Verification order:**
- **Proxy**: `npm run lint && npm run build && npm test` (1469 tests)
- **Daemon**: `go test ./...` in `remote/daemon` (243 tests)
- **Mobile**: `flutter analyze && flutter test --exclude-tags=live` in `remote/mobile` (215 tests)

---

## 4. Development Workflow

Before modifying any code:
```
1. Read — Read the file(s) you'll change. Trace the request/response flow end-to-end.
2. Analyze — Impact analysis (see §5). Run npm test first to confirm baseline passes.
3. Plan — Determine which files to change. Reuse existing patterns. No new abstractions.
4. Implement — Make the change. Minimum code. One file if possible.
5. Verify — npm run lint && npm run build && npm test
6. Document — Update AGENTS.md if API/behavior changed. Update ARCHITECTURE.md if deep arch change.
```

---

## 5. Impact Analysis (before editing)

Determine for each change:

| Area | Check |
|---|---|
| **Modules** | Which files import or are imported by the changed file? |
| **Proxy flow** | Does this change request/response envelope format? The cloud code envelope is `{"request":{...},"model":"..."}`. Breaking it = no models work. |
| **Data model** | Does this change `custom_models.json` schema? Check `src/services/modelStore.ts` + existing files on disk. |
| **IPC API** | Are IPC channels added/changed? Update both `src/ipcHandlers.ts` AND `src/preload.ts` (contextBridge). |
| **Preload API** | Does `window.*` surface change? Update `src/preload/` types. |
| **Backward compat** | Will old `custom_models.json` files still load? Test with a real saved config. |
| **Tests** | Do existing tests cover the changed path? Run `npm test` before to confirm baseline. |

---

## 6. Negative Rules (Never)

### Code
- **Never** hardcode URLs, ports, or API keys — use `constants.ts`
- **Never** add npm dependencies without justification — prefer stdlib `http`/`https`/`crypto`/`fs`
- **Never** use `eval()`, `new Function()`, or dynamic `require()` with user input
- **Never** introduce a web framework (Express/Koa/Fastify) — raw `http`/`https` only
- **Never** add a protobuf library — manual varint encoding only (`src/proxy/protobuf.ts`)
- **Never** access filesystem synchronously except at startup
- **Never** create circular dependencies between `src/proxy/` modules
- **Never** put business logic in `preload.ts` ��� it's a thin contextBridge proxy only

### Data
- **Never** log API keys, tokens, or secrets — use `maskApiKey()` helper
- **Never** use real model IDs for placeholders �� always `MODEL_PLACEHOLDER_<hash>`
- **Never** skip input validation at trust boundaries (user config, API responses)

### Process
- **Never** skip tests for new functionality
- **Never** modify `package-lock.json` unless adding/removing a dependency
- **Never** ignore TypeScript compilation errors — run `npm run lint` before finishing
- **Never** change proxy request/response envelope format without verifying all translators

---

## 7. Folder Responsibilities

| Path | Owns | Don't touch |
|---|---|---|
| `src/proxy/translators/` | Provider format mapping (request/response/stream) | Business logic, persistence |
| `src/proxy/` | Proxy internals (resilience, routing, injection) | IPC, UI, main process |
| `src/services/` | Data persistence, encryption | HTTP handling, translation |
| `src/` root | Main process, IPC, preload, config | Proxy internals (put in proxy/) |
| `src/ipc/handlers/` | New IPC handlers (migration target) | Legacy ipcHandlers.ts stays until fully migrated |
| `src/__tests__/` | All tests | Production code |
| `scripts/`, `ag-doctor/` | Build, deploy, diagnostic tooling | Runtime proxy logic |

---

## 8. Design Patterns (use these, don't invent new ones)

| Pattern | Where | When to use |
|---|---|---|
| **Registry** | `src/proxy/registry.ts` | Auto-discovering translator modules by convention |
| **Promise-chained mutex** | `withWriteLock` in `modelStore.ts` | Serialising concurrent file writes |
| **Circuit breaker** | `src/proxy/circuitBreaker.ts` | Per-provider failure isolation |
| **Strategy** | `retryStrategy.ts` / `retryBudget.ts` | Pluggable retry/backoff policies |
| **Manual protobuf** | `src/proxy/protobuf.ts` | All protobuf operations — no library |

---

## 9. Common Pitfalls

| Pitfall | Symptom | Fix |
|---|---|---|
| Forgetting `ALL_PROVIDERS` in constants.ts | Provider not found by registry | Add to both `PROVIDERS` and `ALL_PROVIDERS` |
| Breaking Cloud Code envelope | All providers return errors | Envelope must be `{"request":{...},"model":"..."}` |
| Missing contextBridge update | Renderer can't call new IPC channel | Add to preload.ts + preload/types.ts |
| Off-by-one in protobuf varint length | Model list corrupt, IDE crashes | Test protobuf encoding with binary diff |
| sync fs access during streaming | Event loop blocked, timeouts | Use async fs always, sync only at startup |
| Circular dep in proxy/ | tsc --noEmit errors | Import from registry, not individual translators |

---

## 10. Priority Levels

| Priority | Definition | Action |
|---|---|---|
| **Critical** | Proxy fails to start, models don't appear, data loss | Fix immediately |
| **High** | Streaming broken for a provider, encryption failure | Fix within the task |
| **Medium** | Missing tests, unoptimized code paths | Document or fix |
| **Low** | Cosmetic issues, log verbosity | Defer unless explicitly asked |

---

## 11. Security Rules

- API keys: always `cryptoStore.encryptString()` (safeStorage). Never plaintext in config files.
- Placeholder IDs: `MODEL_PLACEHOLDER_<djb2hash>` — never real model IDs
- Request body: 10 MB limit (`proxy.ts` — HTTP 413 on exceed)
- Timeouts: 30s-120s on outbound requests (`constants.ts`)
- Logging: all headers masked via `maskApiKey()` — never log `Authorization`, `x-api-key`, etc.
- Validation: `schemaValidator.ts` checks all provider responses at runtime
- Windows: repatch.bat requires admin — don't embed credentials in the script

---

## 12. Definition of Done

A change is done when:
- [ ] `npm run lint` passes with zero errors
- [ ] `npm run build` produces valid `dist/`
- [ ] `npm test` passes (or affected tests if partial run)
- [ ] No new dependencies added
- [ ] No hardcoded URLs, ports, or secrets
- [ ] Existing `custom_models.json` files remain compatible
- [ ] Backward-compatible: old saved configs still load and work
- [ ] If adding an IPC channel: preload.ts updated
- [ ] If changing behavior: ARCHITECTURE.md or AGENTS.md updated
- [ ] Security: no API keys in logs, no eval(), no sync fs in hot path

---

## 13. Reporting Format

When making changes, report as:

```
## Summary
What was changed and why.

## Files Modified
- src/proxy/translators/openai.ts — fixed streaming chunk parsing

## Verification
- npm run lint  ��� PASS
- npm test      — 2565 passed
- npm run build — PASS

## Risks
- Minor: backward-compatible change to chunk parsing

## Rollback
- git revert <commit>
```

---

## 14. Adding a New Provider (Quick Reference)

1. Add name to `PROVIDERS` + `ALL_PROVIDERS` in `src/constants.ts`
2. Add to compat group in `src/proxy/registry.ts` (`OPENAI_COMPAT` / `ANTHROPIC_COMPAT`)
3. Add preset to `src/presets.ts` (optional)
4. Create translator in `src/proxy/translators/` if custom format (auto-discovered)
5. Add tests in `src/__tests__/`
6. Verify: `npm run lint && npm run build && npm test`

---

## 15. Key Constraints

- **Auto-updater disabled** (`AG_DISABLE_UPDATER=1`) — patching breaks binary checksums
- **safeStorage fallback** — headless Linux without keychain → base64 (reversible, not OS-protected)
- **No protobuf library** — manual varint encoding only
- **Partial strict mode** — `noImplicitAny: false`, `strictNullChecks: false`
- **Binary patch is version-sensitive** — separate scripts for 2.2.1, 2.3.x/2.4.x, vs 2.5.x/2.6.x. The VS Code-based "Antigravity IDE" (v1.107.0+) is patched via the `jetski.cloudCodeUrl` settings override (ag-doctor/src/core/ide-patch.ts), not binary surgery; `ag-doctor models rekey` re-enters language-server-encrypted (v10) API keys in a proxy-compatible format.
- **Windows** — repatch.bat requires PowerShell ExecutionPolicy Bypass

---

## 16. References

| Doc | When to read |
|---|---|
| [ARCHITECTURE.md](file:///c:/Users/amine/Downloads/antigravity-add-model-main/antigravity-add-model-main/ARCHITECTURE.md) | Deep architecture, data flow diagrams |
| [DESIGN.md](file:///c:/Users/amine/Downloads/antigravity-add-model-main/antigravity-add-model-main/DESIGN.md) | UI design system, component tokens |
| [TROUBLESHOOTING.md](file:///c:/Users/amine/Downloads/antigravity-add-model-main/antigravity-add-model-main/TROUBLESHOOTING.md) | Common issues, error codes |
| [CI workflow](file:///c:/Users/amine/Downloads/antigravity-add-model-main/antigravity-add-model-main/.github/workflows/ci.yml) | CI pipeline: typecheck → test (3 OS) → build |
| [package.json](file:///c:/Users/amine/Downloads/antigravity-add-model-main/antigravity-add-model-main/package.json) | All available scripts |
