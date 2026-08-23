# Changelog

All notable changes to Antigravity will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.4.0] - 2026-08-22

### Added
- **Antigravity Remote Daemon Desktop Controller** (`remote/antigravity-remote-daemon`): Dedicated Electron 1-page tray controller for the Go Daemon bridge, automated Cloudflare tunnel launcher, real-time PID watchdog, and dynamic pairing QR code generator.
- **CI/CD Desktop Daemon Packaging**: Integrated automated multi-platform compilation and release publishing for `antigravity-remote-daemon.exe` (Windows portable) directly into GitHub Actions (`flutter-mobile.yml`).
- **Background Isolate Offloading (`compute`)**: Asynchronous decoding and sorting of massive session dumps (`parseListSessionsAsync`) and heavy Markdown code blocks (`blocksOfAsync`), eliminating all UI thread jank on payloads exceeding 50,000 items and 50 MB.
- **Extreme Benchmark Matrix (TEST-01 to TEST-10)**: Automated test suite validating 50k sessions virtualization, 20 concurrent agents with 500 events/s streaming, 1,000-cycle memory soak, and idempotent outbox replay.

### Changed
- **Bounded LRU Caches**: Strict LRU eviction capping in-memory session histories to 30 sessions and thumbnails to 50 items with zero memory leakage.
- **Streaming Coalescence & Repaint Boundaries**: 30ms throttling on Markdown token rendering and strict repaint boundaries on message bubbles, preventing parent tree rebuild cascades.

### Fixed
- **LAN Discovery & UDP Socket Cleanup**: Proper subscription cancellation and lifecycle disposal on `LanDiscoveryService`.
- **Security & Secret Storage**: Automated credential migration to hardware-backed keystore (`flutter_secure_storage`) without plaintext JSON token retention.

## [3.3.3] - 2026-08-21

## [3.3.0] - 2026-08-21

### Added
- **Modular Settings & User Account Architecture**: Added dedicated account profile configuration, custom preset policy derivation, and quota visualization suite.
- **Master Design System Parity in Mobile**: Strict alignment of mobile UI theme tokens with Antigravity 2.0 visual specification across dark and light modes.
- **Enhanced Safe Area Support**: Added responsive `SafeArea` handling across all modal sheets and bottom sheets (`ScheduledTasks`, `McpExplorer`, `VoicePromptDialog`, `ChatInputBar`, `BackgroundTaskOutputSheet`).

### Changed
- **Daemon Log & WebSocket Resilience**:
  - Automated 404 detection and exponential backoff (5 min) on unsupported `/StreamReactiveUpdates` endpoints, eliminating repetitive spam logs.
  - Silenced unformatted standard error noise from Gorilla WebSocket pipe closures via `log.SetOutput(io.Discard)`.
  - Filtered benign TCP socket disconnects in `writeJSON` down to `DEBUG` level.
- **Breadcrumb Responsive Adaptation**: Streamlined horizontal padding on `SessionBreadcrumb` preventing overflow on split-screen or narrow mobile layouts.

### Fixed
- **Unicode & Path Resolution**: Fixed UTF-16 code units decoding issues in `resolveWorkspacePath` and binary image decoding fallbacks in `artifact_viewer_modal`.
- **Syntax & Modal Closing Delimiters**: Fixed nested widget closure delimiters across mobile modal dialogs.

## [3.2.0] - 2026-08-19

### Added
- **Dynamic Workspace & Project Discovery**: Full live resolution of workspaces, projects, and active sessions directly from the Language Server and Daemon scan processes, removing all static/mock fallbacks.
- **Smart Speech-to-Code Formatter** (`CodeSpeechFormatter`): Intelligent developer dictation formatting that automatically parses CLI commands, file paths, and camelCase symbols into formatted markdown backticks with French/English spoken punctuation conversion.
- **Subagent DAG Visualization & Skeleton Loaders**: Real-time multi-agent execution hierarchy viewer with responsive shimmer loading states (`SkeletonLoader`, `SkeletonSubagentItem`).
- **Antigravity 2.0 Desktop Fidelity Alignment**: Standardized live tool execution badges and action verbs (`Analyzed <file>`, `Searched <query>`, `Ran <cmd>`).

### Changed
- **Zero Hardcoded Identifiers**: Neutral user profiles (`Developer`) and generic fallbacks across both mobile client and Go daemon bridge.
- **PTY Terminal Bridge Resiliency**: Streamlined live ANSI terminal sheet with PTY data framing and direct host execution.

### Fixed
- **Subagents RPC Parser**: Consolidated and deduplicated `getSubagents` RPC framing in `DaemonApi`.
- **Stream Parser Boundaries**: Resolved regex token precedence preventing CLI match collisions on file extensions.

## [3.1.0] - 2026-08-14

### Added
- **Antigravity Remote 2.0 Companion Suite** (`remote/`): Full mobile companion app (Flutter) and background daemon bridge (Go) allowing developers to control and monitor Antigravity IDE sessions, stream thinking LLMs, approve tool calls, and browse workspaces from their phone over secure local network or Cloudflare Quick Tunnels. Run with `cd remote/daemon && go run main.go --tunnel cloudflare`.
- **Exact Antigravity 2.0 Design System in Mobile** (`remote/mobile`): Replicated the computed theme tokens from Antigravity 2.0 (`htmlcss.log`) into `AppColors` — including `#101010` canvas, `#21252B` sidebars, `#282C34` editor background, `#528BFF` focus ring, `#4D78CC` button accents, `#D7BA7D` syntax gold, and exact diff editor line addition/deletion tints (`rgba(155, 185, 85, 0.2)` / `rgba(255, 0, 0, 0.2)`).
- **Interactive Tool Approval with Single & Session Scopes** (`remote/mobile`): Instant push notifications and responsive cards to review CLI commands, file edits, and tool runs. Allows approving once or trusting for the whole session with auto-rejection timer.
- **Multimodal Prompting & Autocomplete Overlay**: Support for attaching camera/gallery images in chat, plus dynamic `@` mention auto-completion for files, folders, and workspace paths.
- **MCP Server & Tool Explorer** (`mcp_explorer_screen.dart`): Browse active Model Context Protocol (MCP) servers and their registered tools directly from your mobile device.
- **Workspace File Explorer & In-Line Code Viewer** (`workspace_screen.dart`): Tree view with search, find-in-page, syntax-aware language icons, and full code viewer with binary file handling.
- **Scheduled Tasks & Background Monitor** (`scheduled_tasks_screen.dart`): Inspect running background commands, timers, and cron schedules remotely.
- **Code Review Commenting** (`add_comment_dialog.dart`): Leave line-anchored comments on code diffs directly from mobile.

### Changed
- **Zero Token Loss Background Ingestion**: Stream subscriptions remain active on mobile when the app transitions to background or the device is locked, eliminating missed tokens upon return.
- **Dynamic Workspace Resolution**: Automatically detects workspace URI from `metadata.json` or current working directory instead of hardcoded paths.
- **Protobuf Alignment**: Aligned default `plan_model` to `GOOGLE_GEMINI_2_5_PRO` (varint `246`) to match Google Antigravity Language Server expectations.

### Security
- **DNS Rebinding & Origin Protection**: Daemon WebSocket server validates origins against localhost, private LANs, and authenticated Cloudflare/Pinggy tunnel domains.
- **Path Traversal Confinement**: Strict validation ensures all file operations remain confined to the active workspace.
- **Constant-Time Token Comparison**: Protects daemon authentication against timing side-channel attacks.

## [2.1.0] - 2026-07-07

### Added
- **OpenRouter provider**: Unified access to 300+ models via the OpenAI-compatible API
- **Safe JSON repair** ([src/proxy/jsonRepair.ts](src/proxy/jsonRepair.ts)): `repairPartialJson()` handles malformed upstream JSON (trailing commas, unquoted keys, single quotes, comments, truncated payloads) without using `eval()` or `new Function()`. 27 unit tests in `src/__tests__/jsonRepair.test.ts`.
- **Centralized provider registry** ([src/constants.ts](src/constants.ts)): `PROVIDERS`, `ALL_PROVIDERS`, `PROVIDER_DEFAULT_URLS`, and `PROVIDERS_REQUIRING_API_KEY` are now the single source of truth for all 19 supported providers. `src/proxy/registry.ts` and `src/schemaValidator.ts` import from `constants.ts` to prevent drift.
- **Pure retry strategy module** ([src/proxy/retryStrategy.ts](src/proxy/retryStrategy.ts)): `computeRetryDelay`, `shouldRetryStatus`, and `buildRetryDecision` are now pure, fully-tested functions (separate from `proxy.ts` orchestration).
- **Protobuf injection utilities** ([src/proxy/protoInjector.ts](src/proxy/protoInjector.ts), [src/proxy/protobuf.ts](src/proxy/protobuf.ts)): Pure functions for protobuf encode/decode and injection into `GetAvailableModels` responses.
- **Deterministic placeholder ID generation** ([src/proxy/idGenerator.ts](src/proxy/idGenerator.ts)): DJB2-hash-based IDs for custom model slots.
- **URL builder** ([src/proxy/urlBuilder.ts](src/proxy/urlBuilder.ts)): Centralized URL construction for custom model requests.
- **Model loader** ([src/proxy/modelLoader.ts](src/proxy/modelLoader.ts)): Custom model loading with encryption migration.
- **IDE installation wizard** ([src/ideInstall/](src/ideInstall/)): Extracted to a dedicated module.
- **Settings service** ([src/services/settingsService.ts](src/services/settingsService.ts)): Centralized settings management.
- **ESLint + Prettier** configured with `lint`, `format`, `lint:fix` scripts in `package.json`.

### Changed
- **TypeScript migration**: All source files migrated from JavaScript (`dist/*.js`) to TypeScript (`src/*.ts`). Compiled via `npx tsc`.
- **Refactored `proxy.ts`**: Monolithic proxy split into focused modules under `src/proxy/` (registry, shared, modelUtils, translators, retryStrategy, urlBuilder, protoInjector, idGenerator, protobuf, modelLoader, jsonRepair, types).
- **Centralized constants**: All magic numbers moved to [src/constants.ts](src/constants.ts) (ports, timeouts, retry delays, provider list, default URLs, HTTP status codes).
- **Per-model state isolation**: Global `lastToolCallIds` and `lastReasoningContent` replaced with `modelToolCallIds` and `modelReasoningContent` Maps to prevent cross-contamination between concurrent requests.
- **Managed cleanup interval**: Proxy state TTL cleanup (10min stream, 30min tool/reasoning) is now properly started/stopped by `proxy.ts` lifecycle instead of auto-starting at import time.

### Security
- **No `eval()`**: All JSON repair goes through `repairPartialJson()` (string-level transforms + `JSON.parse`). Verified by `jsonRepair.test.ts`.
- **API key encryption**: AES-256-GCM via Electron `safeStorage` (macOS Keychain / Windows DPAPI / Linux libsecret).
- **Request body size limit**: 10 MB cap on incoming requests to prevent memory exhaustion DoS.

### Fixed
- **`ERR_HTTP_HEADERS_SENT` race conditions**: All proxy response handlers now use `safeWriteHead`/`safeEnd` helpers to prevent multiple `writeHead` calls when timeouts race with successful responses.
- **Provider list drift**: `constants.ts`, `registry.ts`, and `schemaValidator.ts` now share a single source of truth.

### Documentation
- **README**: Added Table of Contents, fixed provider list, fixed retry backoff description, fixed safeStorage reference, fixed test file enumeration (12 files, not 6).
- **CHANGELOG**: This v2.1.0 entry added to reconcile with README.

## [2.0.3] - 2026-07-07

### Changed
- Migrated codebase from JavaScript (dist/) to TypeScript (src/)
- Refactored monolithic `proxy.ts` into focused modules under `src/proxy/`
- Centralized magic numbers in `src/constants.ts`

### Added
- `src/proxy/urlBuilder.ts` — URL construction logic for custom model requests
- `src/proxy/protoInjector.ts` — Pure functions for protobuf injection into GetAvailableModels
- `src/proxy/idGenerator.ts` — Deterministic ID generation (DJB2 hash)
- `src/proxy/retryStrategy.ts` — Retry strategies (linear, exponential, 2x exponential)
- `src/proxy/protobuf.ts` — Protobuf encode/decode utilities
- `src/proxy/modelLoader.ts` — Custom model loading with encryption migration
- `src/proxy/types.ts` — Shared TypeScript types
- `src/proxy/shared.ts` — Cross-turn state management with TTL cleanup
- `src/proxy/registry.ts` — Provider translator registry
- `src/proxy/modelUtils.ts` — Model capability detection
- `src/proxy/translators/` — Provider-specific request/response translators
- 84 new unit tests covering URL construction, protobuf injection, ID generation, and retry strategies

### Security
- AES-256-GCM encryption for API keys in `custom_models.json`
- Automatic migration from plaintext to encrypted on first run
- BOM-stripping for cross-platform file compatibility

## [2.0.1] - 2026-XX-XX

### Added
- Custom model support for 15+ providers (OpenAI, Anthropic, Google, Ollama, OpenRouter, custom)
- Automatic retry with exponential backoff for 5xx and 429 responses
- Configurable retry count and timeout per model
- Binary patch for Language Server hostname redirection
- Health check endpoint (`/health`, `/healthz`)

### Fixed
- `ERR_HTTP_HEADERS_SENT` race condition in proxy response handling
- Memory leak from uncleaned stream contexts

## [1.x.x] - Initial Release

### Added
- Electron-based desktop application
- Local proxy server for intercepting Gemini API calls
- Custom model management UI
