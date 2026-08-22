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

| Command                       | Description                                     |
| ----------------------------- | ----------------------------------------------- |
| `doctor` (default)            | Full diagnostic with details                    |
| `check`                       | Quick health check (exit-code only)             |
| `repair [--yes]`              | Auto-fix detected issues                        |
| `models list`                 | List configured custom models                   |
| `models add`                  | Interactive model creation                      |
| `models remove <name>`        | Delete a model                                  |
| `models test [name]`          | Test connectivity for one or all models         |
| `patch status`                | Show binary patch state                         |
| `patch apply`                 | Apply the binary patch (creates backup)         |
| `patch restore`               | Restore language_server from backup             |
| `logs [-f] [-n N]`            | Show language_server logs (tail/follow)         |
| `update`                      | Re-run the parent deploy script                 |
| `info`                        | System & environment information                |

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
