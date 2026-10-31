# Contributing to antigravity-patch-proxy

## Repo layout

This is a polyglot workspace containing five installable artifacts:

| Path | Stack | Purpose |
|---|---|---|
| `src/` + root `package.json` | TypeScript + Electron | Desktop proxy that patches Antigravity IDE / classic |
| `ag-doctor/` | TypeScript (Node CLI) | Diagnostic, repair and management CLI (`bin/ag-doctor.js`) |
| `ag-doctor-ui/` | TypeScript + Electron | Electron dashboard for ag-doctor |
| `remote/antigravity-remote-daemon/` | TypeScript + Electron | Remote controller for mobile pairing |
| `remote/cli/` | TypeScript (ESM) | ConnectRPC validation CLI |
| `remote/daemon/` | Go | gRPC-Web/WebSocket daemon bridge |
| `remote/mobile/` | Flutter (Dart) | Mobile companion app |

Shared devDependencies are hoisted via npm workspaces (defined in root `package.json`).

## Build and test

### Root proxy
```bash
npm run lint      # tsc --noEmit
npm run build     # tsc
npm test          # vitest run
```

### ag-doctor (standalone npm package)
```bash
cd ag-doctor
npm install
npm run lint
npm test
```

### ag-doctor-ui
```bash
cd ag-doctor-ui
npm install
npm run build     # tsc + electron-builder prep
npm test
```

### Remote daemon (Go)
```bash
cd remote/daemon
go test ./...
go build -o daemon.exe .
```

### Remote mobile (Flutter)
```bash
cd remote/mobile
flutter analyze
flutter test --exclude-tags=live
```

## Test layout convention

- Root proxy: `src/__tests__/*.test.ts` (directory-based, legacy)
- ag-doctor: `src/**/*.test.ts` (co-located)
- ag-doctor-ui: `src/renderer/*.test.ts` (co-located in renderer)
- Go daemon: `pkg/**/*_test.go` (co-located)
- Flutter mobile: `test/**/*_test.dart` (directory-based)

When adding tests for the root proxy, follow the existing `src/__tests__/` convention.

## Test layout: decision log

Root proxy uses `src/__tests__/` (directory-based). The rest of the repo uses co-located `*.test.ts`. Migrating the 1,470 root tests to co-located would be high-effort, low-value, and risks breaking vitest discovery. The exception is documented here so contributors don’t “fix” it during cleanup.

## Constants and source-of-truth files

Some domain concepts are represented in more than one place. When in doubt, use this table:

| Concept | Source of truth | Secondary copy | Notes |
|---|---|---|---|
| Proxy port | `src/constants.ts` (`DEFAULT_PROXY_PORT`) | `ag-doctor/src/core/config.ts` | ag-doctor must stay standalone; minor drift is acceptable if both agree on the default |
| Provider list / URLs | `src/constants.ts` (`PROVIDERS`, `PROVIDER_DEFAULT_URLS`) | `ag-doctor/src/commands/models/providers.ts` | Keep aligned when adding providers |
| App paths | `src/paths.ts` | `ag-doctor/src/core/paths.ts` | Platform-specific; review together on Windows/macOS changes |

A future improvement is to extract a small shared-constants workspace package, but this is blocked on agreeing on a story that doesn’t break `ag-doctor`’s standalone npm publish.

## Diagnostic scripts

One-off investigation and debug scripts live under `tools/diagnostics/`. They are developer-only utilities (CDP probes, asar inspectors, log dumpers) and are not part of the production build.

Production scripts (patch, deploy, MITM, auto-heal, recovery) remain in `scripts/`.

## Release checklist

1. Bump `VERSION` and affected `package.json` files.
2. Run `npm run lint && npm run build && npm test` at root.
3. Commit: `chore(release): bump version to vX.Y.Z and update release notes`.
4. Tag: `git tag -a vX.Y.Z <commit> && git push origin vX.Y.Z`.
5. Push via the `antigravity-patch-proxy-remote` canonical remote.

## Remote ecosystem: open decision

`remote/` currently contains four independent build targets (Go daemon, Flutter mobile, Electron remote-daemon UI, TS CLI) inside one repo. This is intentional for now, but it has tradeoffs:

- **Keep monorepo**: Add a `Taskfile` (already provided) so contributors have one entrypoint. Works well if the teams are small and releases are coupled.
- **Split**: Move `remote/daemon` and `remote/mobile` into their own repos. Better for independent release cadence, CI, and contributor onboarding. Harder to keep API contracts in sync.

No action is required until one of those pain points becomes real. If you split, start with the daemon (it has no runtime dependency on the other three).

## Notes

- `ag-doctor` must remain a standalone npm package (it declares its own `bin` entry). Do not move its runtime dependencies into the root.
- Electron versions are unified at `^44` across both Electron UIs via npm workspaces.
- The `src/__mocks__/` folder is intentionally kept adjacent to the modules it mocks; vitest manual mock resolution depends on this location.
