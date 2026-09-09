# Antigravity Application Architecture

## Overview
Antigravity is a desktop application built on Electron, Node.js, and TypeScript. It features an in-app HTTP Gateway Proxy that translates model API protocols (Gemini, OpenAI, Anthropic) seamlessly, persistent custom model providers, and lightweight IPC bridge architecture.

---

## Directory & Component Breakdown (`src/`)

```
src/
├── main/                        # Electron Main Process Entry & Windows
│   ├── main.ts                  # Main process bootstrap & application lifecycle
│   ├── windowManager.ts         # Window bounds, loading overlay, & viewport state
│   ├── tray.ts                  # System tray icon & active agent counter
│   ├── menu.ts                  # Application menus & global keyboard shortcuts
│   └── updater.ts               # Electron auto-updater event listeners
│
├── ipc/                         # Inter-Process Communication (IPC Layer)
│   ├── index.ts                 # Centralized IPC registration orchestrator
│   └── handlers/                # Domain-driven IPC Handlers
│       ├── modelHandler.ts      # Provider & custom model IPC (CRUD, export/import base64)
│       ├── settingsHandler.ts   # Persistent user preferences & dialogs
│       ├── doctorHandler.ts     # System diagnostics & ag-doctor metrics
│       └── systemHandler.ts     # Window controls, shell execution, & notifications
│
├── gateway/                     # HTTP Proxy Engine & Protocol Router
│   ├── server.ts                # HTTP Proxy server bootstrap & graceful connection shutdown
│   ├── router.ts                # Route dispatcher for completion & discovery endpoints
│   ├── handlers/                # Request handlers per API protocol (Gemini, OpenAI, Claude)
│   └── middleware/              # Authentication, header injection, & log throttling
│
├── services/                    # Core Domain Services & Stores
│   ├── modelStore.ts            # Atomic custom model & provider store (`withWriteLock`)
│   ├── cryptoStore.ts           # SafeStorage OS keychain encryption & base64 fallback
│   ├── settingsService.ts       # Application configuration service
│   └── languageServer.ts        # LSP / IDE integration client
│
├── preload/                     # Renderer Preload & ContextBridge
│   ├── index.ts                 # Preload module entry point
│   ├── api.ts                   # Type-safe `contextBridge` exposure (`window.nativeStorage`, etc.)
│   └── doctor-ui.ts             # Doctor UI management panel & modal components
│
├── shared/                      # Shared Utilities, Schemas & Constants
│   ├── logger.ts                # Structured facade logger (`createLogger`)
│   ├── constants.ts             # Application-wide configuration constants
│   ├── schemaValidator.ts       # Runtime JSON schema validation
│   ├── paths.ts                 # User data & application path resolvers
│   └── utils.ts                 # Pure helper functions
│
└── presets/                     # Pre-configured model presets & reasoning parameters
```

---

## Architectural Principles

1. **Zero Unnecessary Dependencies (YAGNI)**
   - Modular Node.js native primitives (`http`, `events`, `crypto`, `path`, `fs/promises`) and Electron native APIs.
   - Clean abstractions without framework bloat.

2. **Concurrency Safety & Atomic Persistence**
   - Concurrent writes to `custom_models.json` use promise-chained mutex locks (`withWriteLock`) in `src/services/modelStore.ts` to eliminate race conditions.

3. **Secure Encryption at Rest**
   - API keys are encrypted using OS keychain credentials via Electron `safeStorage`. Fallback encoding is provided for systems without keychains.

4. **Modular IPC Architecture**
   - IPC channels are segregated by domain (`modelHandler`, `settingsHandler`, `doctorHandler`, `systemHandler`), eliminating monolithic handler files.

5. **Slim Preload Scripts**
   - The root `preload.ts` is lightweight, delegating contextBridge registrations to `src/preload/api.ts`.

---

## Antigravity Remote 2.0 Architecture (`remote/`)

Antigravity Remote introduces a 3-tier architecture extending the desktop IDE to mobile devices:

```
IDE Chat UI ↔ Language Server (Hub :55256) ◄── gRPC-Web ── Daemon Go (:8090 / Cloudflare Tunnel)
                                                                 ▲
                                                                 │ WebSocket (JSON RPC)
                                                                 ▼
                                                    Mobile Client (Flutter App)
```

1. **Go Daemon Bridge (`remote/daemon`)**:
   - **Discovery & Watchdog**: Probes local processes to identify the active `language_server` Hub instance, port, and CSRF token. Runs a 10s watchdog to detect token rotations.
   - **Pairing & Zero-Config LAN Beacon**: Generates rotating 60s 6-digit PIN codes with 5-attempt brute-force lockouts (`POST /pair`), and broadcasts UDP LAN discovery announcements on port `41234`.
   - **Protocol Translator**: Connects over gRPC-Web with manual Protobuf wire encoding to translate mobile WebSocket messages into `StartCascade`, `SendUserCascadeMessage`, `SubmitToolApproval`, `GetAvailableModels`, and file operations.
   - **Interactive Terminal & ADB Bridge**: Hosts PTY shell sessions (`terminal_create`/`write`/`kill`) and an Android Debug Bridge service (`adb.*`) for remote file and device inspection.
   - **Tunnel Bridge**: Seamlessly spins up Cloudflare Quick Tunnels (`cloudflared.exe`) and prints paired terminal QR codes for zero-config remote access.
   - **StepRecovery**: Retains in-memory ring buffers of trajectory events to replay lost messages after transient mobile network disconnections.
   - **Quota Push (real-time)**: The `Scheduler` (30 s tick) calls `RetrieveUserQuotaSummary` (force_refresh) at most every 60 s — and only while ≥1 WebSocket client is connected — then parses the raw protobuf (`ParseQuotaSummary` scans for `gemini-weekly`/`gemini-5h`/`3p-weekly`/`3p-5h` + fixed32 marker `0x25`) and broadcasts `quota_update` with the 4 usage percentages. The mobile consumes the push instead of polling; its 60 s timer stays as a fallback for older daemons.
   - **Binary Patch Auto-heal**: `repatch.bat` caches the patched `app.asar` (+ `.unpacked`) under `~/.gemini\antigravity\scratch\` and registers `register-auto-heal.ps1` (Startup VBS). `auto-heal.ps1` restores the cache when the `MODEL_PLACEHOLDER_` signature is missing (official update); `supervise-daemon.ps1` also checks mid-session, not only at boot.

2. **Flutter Mobile Companion (`remote/mobile`)**:
   - **Antigravity 2.0 Design System**: Replicated design tokens directly from IDE computed stylesheets (`htmlcss.log`) — including `#101010` canvas, `#21252B` sidebars, `#528BFF` focus borders, `#D7BA7D` syntax highlights, and IDE-native diff editor coloration.
   - **Typed Protocol Client (`DaemonApi`)**: Full WebSocket client handling request/response correlations, real-time token streams, tool approval queues, and outbox persistence.
   - **Typed Protocol Client (`DaemonApi`)**: Full WebSocket client handling request/response correlations, real-time token streams, tool approval queues, outbox persistence, and Protocol v2 session attachment (`attachSession`, `sendPromptV2`, `respondApprovalV2`).
   - **Core Screens**: Quiet Console chat stream, session manager, file tree with syntax icons & code viewer, MCP server explorer, scheduled tasks dashboard, and diagnostic export.

---

## Antigravity Remote Server Agent Runtime (`ag-agentd` / Protocol v2)

The Remote Server Agent Runtime transforms Antigravity into an authoritative, autonomous agent runtime running directly on cloud servers (VPS / Bare Metal), inspired by the Claude Code Cloud model.

### 1. Authoritative Architecture

```
                       LOCAL CLIENTS
┌────────────────────────┐      ┌────────────────────────┐      ┌────────────────────────┐
│  Desktop Electron IDE  │      │ Flutter Mobile Client  │      │  Web Console (Browser) │
│   (Attach / Control)   │      │   (Attach / Control)   │      │   (Attach / Control)   │
└───────────┬────────────┘      └───────────┬────────────┘      └───────────┬────────────┘
            │                               │                               │
            └───────────────────────┬───────┴───────────────────────────────┘
                                    │ WebSocket Protocol v2 / REST
                                    ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        REMOTE SERVER RUNTIME (ag-agentd)                               │
│                                                                                        │
│  ┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────────────┐  │
│  │ WebSocket Gateway v2 │  │  Session Controller  │  │    Terminal Exec Service     │  │
│  │ (Multi-Client Mux)   │  │ (Lifecycle & State)  │  │   (POST /v2/terminal/exec)   │  │
│  └──────────┬───────────┘  └──────────┬───────────┘  └──────────────┬───────────────┘  │
│             │                         │                             │                  │
│             ▼                         ▼                             ▼                  │
│  ┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────────────┐  │
│  │   Agent Core Loop    │  │  SQLite EventStore   │  │      Workspace Manager       │  │
│  │ (Context Compaction) │  │  (WAL Checkpointed)  │  │    (Tree, File, Git Sync)    │  │
│  └──────────┬───────────┘  └──────────────────────┘  └──────────────┬───────────────┘  │
│             │                                                       │                  │
│             ▼                                                       ▼                  │
│   LLM Providers (Proxy/API)                               Local Host Filesystem & Git  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### 2. Core Pillars

1. **Authoritative Execution & Detachment**:
   - The agent loop runs as a server daemon (`ag-agentd`), persisting its execution state, memory, and trajectory inside an append-only SQLite EventStore (`runtime.db`).
   - Clients can disconnect at any point without interrupting execution.
   - Upon reconnection, clients supply their `lastSequence` cursor (`session.attach`), and the server replays all intermediate events (`session.catchup`) with zero message loss.

2. **High-Frequency Streaming Decoupling (`EmitEphemeralEvent`)**:
   - Real-time token streaming (`agent.thought_chunk`) and stdout chunks (`tool.output`) are broadcast to connected WebSockets with ephemeral sequences (`Sequence = -1`).
   - Consolidated milestone events (`agent.thought`, `tool.result`, `session.state_changed`) are committed to SQLite with strict monotonic ordering and WAL checkpoints.

3. **Intelligent Context Compaction (`CompactContextMessages`)**:
   - Prevents token blowout during extended sessions.
   - Preserves recent turns while compacting older massive tool outputs (> 2,000 chars) in the middle with head/tail preservation (`[... N bytes omitted for context compaction ...]`).

4. **Bi-Directional Workspace Synchronization**:
   - REST API: `GET /v2/workspaces/tree`, `GET/POST /v2/workspaces/file`, `GET /v2/workspaces/search`, `POST /v2/workspaces/sync`.
   - Git primitives: `Pull` and `Push` methods in `workspace.Manager` support upstream synchronization between local repos and server workspaces.

5. **Security Confinement**:
   - Dedicated unprivileged system user `ag-agent` (`/bin/false`).
   - Systemd hardening: `ProtectSystem=strict`, `ProtectHome=true`, `PrivateTmp=true`, `NoNewPrivileges=true`, `LimitNOFILE=65536`.
   - Path confinement strictly enforces that all file operations remain within the registered workspace boundary (`ResolveAndValidatePath`).

