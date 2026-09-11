# ag-doctor

A standalone, zero-runtime-dependency diagnostic & management CLI for the
Antigravity custom-models patch.

## Install

```bash
cd ag-doctor
npm install
npm run build
```

Then run via `node bin/ag-doctor.js <command>` or link it globally:

```bash
npm link
ag-doctor doctor
```

## Usage

```text
ag-doctor [command] [options]
```

### Commands

| Command                                | Description                                              |
| -------------------------------------- | -------------------------------------------------------- |
| `doctor` (default)                     | Full diagnostic with details (`--watch`, `--report <f>`) |
| `check`                                | Quick health check (exit-code only)                      |
| `repair [--yes]`                       | Auto-fix detected issues (creates snapshot first)        |
| `repair-asar [--yes]`                  | Detect & restore a corrupted `app.asar`                  |
| `check-asar`                           | Read-only `app.asar` integrity check (JSON-friendly)     |
| `models list`                          | List configured custom models                            |
| `models add`                           | Interactive model creation                               |
| `models remove <name>`                 | Delete a model                                           |
| `models rekey`                         | Re-enter API keys encrypted by Language Server (v10)     |
| `models test [name]`                   | Test connectivity for one or all models                  |
| `models fetch`                         | Query `/v1/models` for a provider to list models         |
| `patch status`                         | Show binary patch state                                  |
| `patch apply`                          | Apply the binary patch (creates backup)                  |
| `patch restore`                        | Restore `language_server` from backup                    |
| `patch select <range\|auto>`           | Force a patch range or return to auto-detect             |
| `logs [-f] [-n N]`                     | Show language server logs (tail/follow/filter/clear)     |
| `mitm {status\|install\|proxy-on...}`  | Manage MITM CA cert and system proxy                     |
| `proxy {status\|start\|stop\|stub}`    | Manage standalone local proxy & emergency stub           |
| `config {list\|get\|set\|reset}`       | Manage persistent settings                               |
| `snapshot {list\|create\|restore}`     | Manage timestamped backups                               |
| `history {list\|show\|diff}`           | View and manage past doctor runs                         |
| `net {dns\|mx\|ping\|port...}`         | Network diagnostics for upstream endpoints               |
| `monitor`                              | Live resource monitoring for Antigravity processes       |
| `crashes`                              | Analyze Crashpad crash dumps                             |
| `selftest`                             | Verify the CLI itself                                    |
| `plugins {list\|add\|remove...}`       | Manage user-defined check plugins                        |
| `serve [--port N] [--host H]`          | Start Doctor-as-a-Service HTTP daemon                    |
| `profile {list\|use\|create...}`       | Manage isolated configuration profiles                   |
| `daemon {start\|stop\|status...}`      | Auto-recovery daemon (continuous monitoring)             |
| `antigravity {status\|version...}`     | Manage the Antigravity installation lifecycle            |
| `update [--check]`                     | Re-run deployment or check for upstream updates          |
| `info`                                 | System & environment information                         |

### Options

| Option              | Description                          |
| ------------------- | ------------------------------------ |
| `--json`            | Machine-readable JSON output         |
| `--verbose, -v`     | Verbose output                       |
| `--yes, -y`         | Auto-confirm prompts                 |
| `--follow, -f`      | Follow log output                    |
| `--lines N, -n N`   | Number of log lines                  |

### Exit codes

| Code | Meaning          |
| ---- | ---------------- |
| 0    | OK               |
| 1    | Warning(s)       |
| 2    | Error(s)         |

## Examples

```bash
# Run full diagnostic
ag-doctor doctor

# Quick check (CI-friendly)
ag-doctor check && echo "healthy"

# Get JSON output for scripting
ag-doctor doctor --json | jq '.[] | select(.status=="error")'

# Apply the binary patch non-interactively
ag-doctor patch apply --yes

# Add a custom model interactively
ag-doctor models add

# Test connectivity to all configured providers
ag-doctor models test

# Tail the language_server log
ag-doctor logs -f -n 100

# Auto-repair everything that can be fixed
ag-doctor repair --yes
```

## Architecture

```
ag-doctor/
├── bin/ag-doctor.js        # Entry shim
├── src/
│   ├── index.ts            # Command router
│   ├── types.ts            # Shared types
│   ├── cli/                # Output, parser, prompts, spinner
│   ├── core/               # Platform, paths, binary-patch, custom-models, process, probe
│   ├── checks/             # Individual diagnostic checks
│   └── commands/           # doctor, check, repair, models/*, patch/*, logs, info, update
└── package.json
```

## Design constraints

- **Zero runtime dependencies** — only `typescript` (devDep) and Node 18+ stdlib.
- **Cross-platform** — Windows, macOS, Linux.
- **Read-only by default** — only `patch apply`, `models add/remove`, and `repair`
  modify state, and they all require explicit confirmation (or `--yes`).
- **JSON-friendly** — every command supports `--json` for scripting.
