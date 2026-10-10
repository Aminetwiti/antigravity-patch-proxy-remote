# Google Antigravity Patch Proxy & Remote 2.0 — Custom LLM Models & Mobile IDE Companion

<p align="center">
  <img src="assets/antigravity_patch_proxy_logo.png" width="180" alt="Google Antigravity Custom Model Proxy & Remote Logo" />
</p>

<p align="center">
  <a href="package.json"><img src="https://img.shields.io/badge/version-3.7.3-blue.svg?style=for-the-badge" alt="Version 3.7.3" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-green.svg?style=for-the-badge" alt="License Apache 2.0" /></a>
  <a href="#google-services--omniroute-quota-pooling-suite"><img src="https://img.shields.io/badge/Google%20Services-Multi--Account%20Pooling-4285F4.svg?style=for-the-badge&logo=google" alt="Google Services Pooling" /></a>
  <a href="remote/mobile"><img src="https://img.shields.io/badge/Flutter-Mobile%20(Android%20%2F%20iOS)-02569B.svg?style=for-the-badge&logo=flutter" alt="Flutter Mobile" /></a>
  <a href="remote/daemon"><img src="https://img.shields.io/badge/Go%20Daemon-gRPC--Web%20%2F%20WS-00ADD8.svg?style=for-the-badge&logo=go" alt="Go Daemon" /></a>
  <a href="src"><img src="https://img.shields.io/badge/Desktop%20Proxy-Electron%20%2F%20TS-3178C6.svg?style=for-the-badge&logo=typescript" alt="Electron Proxy" /></a>
  <a href="src/__tests__"><img src="https://img.shields.io/badge/Tests-2565%2B%20Passed-brightgreen.svg?style=for-the-badge" alt="Tests Passed" /></a>
</p>

<p align="center">
  <b>Add custom AI models (Claude 3.5/3.7 Sonnet, GPT-4o, DeepSeek R1, Ollama), pool multiple Google accounts with OmniRoute load balancing, and control everything on mobile with Antigravity Remote 2.0.</b>
</p>

> **The complete AI development ecosystem for Google Antigravity (v3.7.3):**
> - 🌐 **Google Services & OmniRoute Pooling Suite**: Multi-account OAuth pooling, Google AI Studio integration, Power of Two Choices (P2C) candidate selection, in-flight concurrency tracking, 4-tier 429 classification, smart weekly quota governor & cross-model cascade (Gemini → Claude Sonnet 4.6 / Opus 4.6).
> - 🧩 **Antigravity IDE & Extension Engine**: Native support for VS Code-based Antigravity IDE (v1.107.0+) and classic Electron shell with autonomous proxy auto-starter (`out/main.js`), dual summary store reconciliation (SQLite + Protobuf), and injected chat suggestion pills.
> - 🖥️ **Desktop Patch Proxy**: Injects **Anthropic Claude**, **OpenAI GPT-4o**, **DeepSeek R1 / V3**, **Google Gemini**, **OpenRouter**, **Ollama**, **Groq**, **Mistral**, and **xAI** directly into IDE chat dropdowns with AES-256-GCM encryption and bi-directional SSE streaming.
> - 📊 **Token Tracker & Tokenizer Engine**: Real-time token consumption metrics (prompt, completion, cached), cache hit ratio %, and financial savings analysis inside `ag-doctor-ui`.
> - 📱 **Antigravity Remote 2.0 (Mobile Companion)**: Native Flutter application (Android & iOS) to supervise agent trajectories, review code diffs, approve terminal commands, inspect MCP servers, manage Git worktrees, and chat with AI from anywhere via **Zero-Config LAN Discovery** or **Cloudflare Quick Tunnels**.

---

## 🌟 Visual Showcase & Hero Tour

<div align="center">

| 🖥️ Desktop IDE Custom Models | 📱 Mobile Remote 2.0 Companion |
|:---:|:---:|
| <img src="assets/4.PNG" width="460" alt="Google Antigravity Custom Model Selector Dropdown" /> | <img src="assets/remote/Screenshot_20260823_035746.jpg" width="220" alt="Antigravity Remote Mobile Streaming Chat" /> |
| *Native IDE dropdown with custom LLMs & Auto-Fallback* | *Live mobile streaming, 7ms latency, unified diffs & voice input* |

</div>

---

## Table of Contents

- [Overview & Key Capabilities](#overview--key-capabilities)
- [What's New in v3.7.x](#whats-new-in-v37x)
- [Google Services & OmniRoute Quota Pooling Suite](#google-services--omniroute-quota-pooling-suite)
  - [Multi-Account OAuth & AI Studio Pooling](#multi-account-oauth--ai-studio-pooling)
  - [OmniRoute-Parity Load Balancing (P2C & In-Flight Concurrency)](#omniroute-parity-load-balancing-p2c--in-flight-concurrency)
  - [4-Tier 429 Classification Engine & Quota Governor](#4-tier-429-classification-engine--quota-governor)
  - [Cross-Model Billing & Quota Cascade](#cross-model-billing--quota-cascade)
  - [OAuth Lifecycle: Pre-Warming, Quarantine & Health Watchdog](#oauth-lifecycle-pre-warming-quarantine--health-watchdog)
  - [Thought Signature & Multi-Turn Reasoning Caching](#thought-signature--multi-turn-reasoning-caching)
- [Antigravity IDE & Extension Architecture](#antigravity-ide-v11070-vs-antigravity-20-classic)
  - [Autonomous Proxy Auto-Starter (`out/main.js`)](#key-capabilities--architecture)
  - [Dual Summary Store Reconciliation (SQLite + Protobuf)](#dual-summary-store-reconciliation)
  - [Chat Workflow Pills & Injected Suggestions](#chat-workflow-pills--injected-suggestions)
  - [Surgical Version Patchers (v2.2 – v2.18)](#version-aware-patching-engine)
- [Token Tracker & Tokenizer Engine](#token-tracker--tokenizer-engine)
- [Antigravity Remote 2.0 (Mobile & Daemon Bridge)](#antigravity-remote-20-mobile--daemon-bridge)
  - [Remote Visual Experience & Screen Gallery](#remote-visual-experience--screen-gallery)
  - [Key Remote Capabilities & Protocols](#key-remote-capabilities--protocols)
  - [Running Antigravity Remote](#running-antigravity-remote)
- [Architecture & Reverse Engineering](#architecture--reverse-engineering)
  - [Cloud Code Internal API (`v1internal`)](#cloud-code-internal-api-v1internal)
  - [Language Server Binary Patching](#language-server-binary-patching)
  - [Protobuf Model Injection](#protobuf-model-injection)
  - [Request Lifecycle & Data Flow](#request-lifecycle--data-flow)
- [Desktop UI Screenshots & Custom Models](#desktop-ui-screenshots--custom-models)
- [Key Technical Features](#key-technical-features)
  - [Automated Model Auto-Fallback](#automated-model-auto-fallback--stream-warning-cards)
  - [Format Translators (Claude, OpenAI, Ollama, Gemini)](#format-translators)
  - [Bi-Directional SSE Streaming & Tool Calling](#bi-directional-sse-streaming)
  - [DeepSeek & Claude Thinking Support](#deepseek--claude-thinking-support)
  - [Per-Model Circuit Breaker & Resiliency](#per-model-circuit-breaker--resiliency-circuitbreakerts)
- [Security Architecture & AES-256-GCM](#security-architecture)
- [Quick Start & Installation](#quick-start--installation)
- [`ag-doctor` Diagnostic CLI & UI](#ag-doctor-diagnostic-cli)
- [Supported LLM Providers & Matrix](#provider-configuration-matrix)
- [`custom_models.json` Schema Reference](#custom_modelsjson-schema-reference)
- [Developer Guide & Testing](#developer-guide)
- [Frequently Asked Questions (FAQ)](#frequently-asked-questions-faq)
- [License](#license--acknowledgments)

---

## Overview & Key Capabilities

**Google Antigravity Custom Model Enabler & Remote Ecosystem** transforms your development environment:
1. **Universal LLM Bridge**: Intercepts internal communication between the IDE's Language Server (Go binary) and Google's internal Cloud Code infrastructure (`daily-cloudcode-pa.googleapis.com` → `127.0.0.1:${AG_PROXY_PORT:-51074}`), translating API requests into standard payloads for 20+ LLM providers while preserving tool calls and SSE token streaming.
2. **Google Services & Smart Multi-Account Pooling**: Pools multiple Google Cloud Code and AI Studio accounts with OmniRoute-parity load balancing (Power of Two Choices, in-flight concurrency penalty, 4-tier 429 classification, smart weekly quota governor, and cross-model failover cascade).
3. **Antigravity IDE & Extension Engine**: Seamless integration with VS Code-based Antigravity IDE (v1.107.0+) and Classic Shell (v2.9.1 / v2.18.x) featuring an autonomous proxy auto-starter (`out/main.js`), chat suggestion pills, and Dual Summary Store reconciliation (SQLite + Protobuf).
4. **Mobile IDE Companion**: Connects securely to your IDE session from your smartphone via WebSocket JSON-RPC over local Wi-Fi or Cloudflare Quick Tunnels, giving you real-time human-in-the-loop controls wherever you are.

---

## 🌟 What's New in v3.7.x

- 🌐 **Google Multi-Account Quota Pooling**: Pool multiple Google accounts (OAuth & Google AI Studio keys) to multiply quotas and bypass single-account rate limits.
- ⚖️ **OmniRoute-Parity Intelligent Balancing**: Power of Two Choices (P2C) candidate selection and real-time in-flight concurrency tracking (20-point penalty per active request).
- 🚦 **4-Tier 429 Classification & Quota Governor**: Granular differentiation between soft bursts, RPM throttles, 5-hour quota exhaustion, and unknown errors, paired with a weekly quota reset countdown.
- 🔀 **Cross-Model Billing & Quota Cascade**: Instant failover from exhausted Google Gemini models to Claude Sonnet 4.6 / Opus 4.6, skipping sibling accounts sharing the same quota.
- 🧩 **Antigravity IDE (v1.107.0+) Auto-Starter**: `out/main.js` hook starts the proxy daemon automatically before extensions load, preventing `ECONNREFUSED` connection issues on boot.
- 🗄️ **Dual Summary Store Reconciliation**: Syncs SQLite `conversation_summaries.db` and Protobuf `agyhub_summaries_proto.pb` via `ag-doctor db:prune` to permanently clean orphan and archived sessions.
- 💬 **Injected Chat Suggestion Pills**: Quick-action pills inside the chat UI for rapid repository review and Git workflows.
- 📊 **Token Tracker & Cost Optimization Engine**: Live prompt caching ratio and dollar savings tracking inside `ag-doctor-ui`.
- 🛡️ **Comprehensive Security Sanitization**: Eradicated legacy Trojan backdoor risks (Issue #22) and implemented zero-eval streaming JSON repair.

---

## 🌐 Google Services & OmniRoute Quota Pooling Suite

Antigravity Patch Proxy v3.7.1 introduces enterprise-grade support for **Google Services**, combining Google Cloud Code OAuth, Google AI Studio developer keys, and Gemini CLI endpoints into a unified, high-availability account pool.

```mermaid
flowchart TD
    Req["Incoming IDE Gemini Request"] --> Aff{"Session Affinity Check<br/>(Sticky Sessions)"}
    Aff -->|"Bound & Healthy"| Exec["Dispatch to Assigned Account"]
    Aff -->|"Unbound or Cooldown"| P2C["Power of Two Choices (P2C) Selection<br/>• Filter cooling & unlicensed accounts<br/>• Penalty: -20 pts per in-flight request<br/>• Random pick between top 2 healthy nodes"]
    
    P2C --> CloudCode["Google Cloud Code OAuth<br/>(daily-cloudcode-pa / prod)"]
    P2C --> AIStudio["Google AI Studio Keys<br/>(generativelanguage.google)"]
    P2C --> GeminiCli["Gemini CLI OAuth<br/>(Isolated project quota)"]
    
    CloudCode --> Resp{"Response Status"}
    AIStudio --> Resp
    GeminiCli --> Resp
    
    Resp -->|"200 OK"| Success["Stream Tokens to IDE"]
    Resp -->|"429 Soft Burst"| Backoff["2-3s Exponential Backoff"]
    Resp -->|"429 RPM Limit"| Cooldown60["60s Cooldown + Alternate Account"]
    Resp -->|"429 Quota Exhausted"| Cascade["5h Cooldown + Unbind Session<br/>Cascade to Claude Sonnet/Opus 4.6"]
```

### Multi-Account OAuth & AI Studio Pooling

The proxy supports combining multiple accounts across three distinct Google services flavors:
1. **`google` (Google Cloud Code OAuth)**: Connects directly to Google's internal Cloud Code APIs (`daily-cloudcode-pa.googleapis.com` or `cloudcode-pa.googleapis.com/v1internal`). Supports 1-click Google Sign-in in `ag-doctor-ui`, automatically retrieving and refreshing OAuth tokens.
2. **`google-gemini` (Google AI Studio API Keys)**: Connects to `https://generativelanguage.googleapis.com` using developer API keys (`AIza...`). Each key operates with independent rate limits and quotas.
3. **`gemini-cli` (Gemini CLI OAuth)**: Connects using Gemini CLI OAuth credentials with isolated project quotas.

Accounts can be configured via `ag-doctor-ui` (Accounts tab), loaded via environment variables (`AG_ACCOUNTS_FILE` / `AG_ACCOUNTS_JSON`), or stored in `custom_models.json`.

### OmniRoute-Parity Load Balancing (P2C & In-Flight Concurrency)

To prevent rate limits and eliminate single-account hotspotting:
- **Power of Two Choices (P2C)**: Instead of naive round-robin that floods accounts sequentially, the scheduler queries health scores across the pool, identifies the top-tier candidates within a 45-point delta (`P2C_SCORE_DELTA = 45`), and picks between two randomly selected candidates using `crypto.randomInt`.
- **In-Flight Concurrency Tracking**: Each active request subtracts **20 points** from an account's dynamic health score during execution. Simultaneous concurrent prompts automatically fan out across idle accounts.
- **Weighted Round-Robin**: When accounts have equal quota tiers, requests rotate seamlessly to maximize overall throughput.
- **Sticky Session Affinity**: Conversation threads maintain affinity to the same account across turns to preserve context and cached prompt prefixes, immediately releasing the binding if the account hits a rate limit.

### 4-Tier 429 Classification Engine & Quota Governor

Upstream HTTP 429 errors are decoded into four distinct operational tiers:
1. **`soft_rate_limit`**: Short temporary spike. Retried with a 2-3 second backoff without taking the account out of rotation.
2. **`rate_limited`**: Requests-per-minute (RPM) throttle. Account enters a 60-second cooldown while alternate accounts handle traffic.
3. **`quota_exhausted`**: Daily/5-hour token quota reached. The account is placed in a 5-hour cooldown, session affinity is unbound, and the pool immediately fails over to the next available account.
4. **`unknown`**: Conservative 60-second cooldown fallback.

**Smart Weekly Quota Governor**: Live quota monitors track weekly token limits (`gemini-weekly`, `3p-weekly`) and display a live countdown to the next scheduled quota reset.

### Cross-Model Billing & Quota Cascade

When all Google Gemini accounts in the pool are exhausted or encounter billing limits:
- The proxy automatically cascades to secondary fallback models (e.g. **Claude Sonnet 4.6** and **Claude Opus 4.6**).
- **Sibling Account Bypass**: Skips sibling accounts linked to the same billing profile or project to eliminate unproductive ping-pong retry loops.
- Injects a transparent Markdown notice into the chat stream informing you of the failover without breaking code generation.

### OAuth Lifecycle: Pre-Warming, Quarantine & Health Watchdog

- **Background Token Pre-Warming (`schedulePrewarm`)**: Refresh tokens are proactively renewed 60 seconds before expiration in the background, eliminating mid-stream authentication delays.
- **Token Revocation Quarantine (`markTokenRevoked`)**: Quarantines revoked refresh tokens (`invalid_grant`) to prevent failed requests, emitting visual notification banners in the UI.
- **Unlicensed Account Isolation**: Accounts lacking active Cloud Code subscriptions (HTTP 403) are quarantined permanently, saving network round-trips.

### Thought Signature & Multi-Turn Reasoning Caching

Gemini 2.0 Thinking models output internal reasoning blocks and encrypted thought signatures. The proxy caches and restores `thought_signature` across multi-turn conversations, preserving reasoning context across tool invocations and user follow-ups.

---

## Architecture & Reverse Engineering

### Cloud Code Internal API (`v1internal`)

Google Antigravity does not use public Gemini REST endpoints (`v1beta`). Instead, it communicates via internal `v1internal` endpoints:

- `POST /v1internal:fetchAvailableModels` — Fetches active model definitions, quotas, and capabilities.
- `POST /v1internal:streamGenerateContent?alt=sse` — Real-time Server-Sent Event (SSE) chat and code completion stream.
- `POST /v1internal:generateContent` — Non-streaming fallback generation.
- `POST /v1internal:loadCodeAssist` — Pre-loads context, quotas, and assistant configuration.
- `POST /v1internal:listExperiments` — Mocked experiment flags for seamless UI feature activation.
- `GET /metrics` & `GET /health` — Real-time Prometheus metrics and proxy health check probes.

The Cloud Code protocol wraps request payloads inside a top-level `request` object:

```json
{
  "project": "antigravity-internal-project",
  "requestId": "req-12345-abcde",
  "request": {
    "contents": [
      {
        "role": "user",
        "parts": [{ "text": "Refactor this function to be async." }]
      }
    ],
    "systemInstruction": {
      "parts": [{ "text": "You are an expert TypeScript developer." }]
    },
    "generationConfig": {
      "temperature": 0.2,
      "maxOutputTokens": 4096
    }
  },
  "model": "custom-claude-3-5-sonnet"
}
```

The local proxy intercepts these calls, extracts `request`, translates roles, system instructions, and tool definitions into the targeted provider format, and re-wraps the output in Google's expected envelope: `{"response": {...}, "traceId": "...", "metadata": {}}`.

### Language Server Binary Patching

Recent Google Antigravity releases hardcode `daily-cloudcode-pa.googleapis.com` inside the Language Server Go binary. To prevent the IDE from bypassing the local proxy:

1. **Binary Patching**: Build scripts patch the compiled binary string tables, replacing Google's hostname with `127.0.0.1:${AG_PROXY_PORT:-51074}`.
2. **Frontend Interception**: `src/main.ts` intercepts and blocks `SetCloudCodeURL` IPC requests from overriding the endpoint dynamically.
3. **URL Padding Handler**: `src/proxy/urlBuilder.ts` strips null/space binary padding from incoming URLs.

### Protobuf Model Injection

To inject custom models into the native IDE model picker:
1. When `fetchAvailableModels` is called, `src/proxy/protoInjector.ts` parses the Google response.
2. `src/proxy/idGenerator.ts` generates DJB2-hash-based IDs (`MODEL_PLACEHOLDER_<hash>`) for each user model.
3. Custom models are dynamically appended to `agentModelSorts` and model arrays so they render natively inside the IDE picker with full feature flags enabled.

### Request Lifecycle & Data Flow

```mermaid
sequenceDiagram
    autonumber
    participant IDE as Antigravity IDE (UI)
    participant LS as Language Server (Go Binary)
    participant Proxy as Local Proxy (127.0.0.1:${AG_PROXY_PORT:-51074})
    participant Registry as Translator Registry
    participant Ext as External Provider API (OpenAI/Claude/Ollama)

    IDE->>LS: User sends prompt with custom model selected
    LS->>Proxy: POST /v1internal:streamGenerateContent?alt=sse
    Proxy->>Proxy: Intercept request & detect model ID (MODEL_PLACEHOLDER_*)
    Proxy->>Registry: Lookup provider translator (e.g. anthropic.ts)
    Registry->>Proxy: Transformed payload (Anthropic / OpenAI format)
    Proxy->>Ext: POST https://api.anthropic.com/v1/messages (SSE)
    loop SSE Token Streaming
        Ext-->>Proxy: data: {"type": "content_block_delta", ...}
        Proxy->>Proxy: mapChunkToGemini() via jsonRepair
        Proxy-->>LS: SSE data: {"response": {"candidates": [...]}}
        LS-->>IDE: Render text chunk in chat UI
    end
```

---

## Desktop UI Screenshots & Custom Models

The injected UI seamlessly blends with Antigravity's dark VS Code-adjacent chrome:

| Custom Models Dashboard | Add Model Modal |
|:---:|:---:|
| <img src="assets/1.PNG" width="460" alt="Google Antigravity Custom Models Dashboard Settings" /><br/>*Manage and encrypt custom model endpoints & keys* | <img src="assets/2.PNG" width="460" alt="Add Custom LLM Model Modal in Google Antigravity IDE" /><br/>*Configure model names, thinking budget, and context limits* |

| Provider Selection (Claude, OpenAI, DeepSeek, Ollama) | Model Selector in Antigravity Chat UI |
|:---:|:---:|
| <img src="assets/3.PNG" width="460" alt="Supported LLM Providers Selection in Google Antigravity" /><br/>*Preset selector for 19+ popular cloud and local providers* | <img src="assets/4.PNG" width="460" alt="Google Antigravity Model Selector Dropdown Interface" /><br/>*Native IDE model dropdown with custom models injected* |

| Auto-fallback & Failover Stream Notification |
|:---:|
| <img src="assets/5.PNG" width="500" alt="Google Antigravity Custom Model Auto-fallback Failover Stream Notification" /><br/>*Real-time stream warning notification when failing over to secondary model* |

---

## Key Technical Features

### Automated Model Auto-Fallback & Stream Warning Cards

When a primary model encounters rate limits (`rate_limit` / 429), context length limits, or provider timeouts, the proxy automatically initiates an **Auto-Fallback**:
- **Seamless Failover**: Automatically retries the prompt with a secondary model (e.g. falling back from `MiniMax-M2.7` to `MiniMax-M3` or `Claude-3.5-Sonnet` to `GPT-4o`).
- **Native Stream Warning Card**: Emits an inline markdown warning block (`> ⚠️ Auto-fallback: <model-1> failed (<reason>). Retrying with <model-2>…`) directly into the IDE chat response stream without interrupting the agent's workflow.
- **Context Preservation**: Retains the full conversational history and active tool definitions across the failover boundary.

### Format Translators

The proxy features isolated translator modules under `src/proxy/translators/`:

- **OpenAI Translator (`openai.ts`)**: Full mapping between Gemini `contents`/`parts` and OpenAI `messages`, including tool calls, system prompts, and `usage` token metrics.
- **Anthropic Translator (`anthropic.ts`)**: Handles Claude `system` parameter, `tool_use` blocks, SSE `content_block_start`/`delta` events, and thinking parameter extraction.
- **Google AI Studio Passthrough (`google.ts`)**: Direct passthrough to Google AI Studio keys (`https://generativelanguage.googleapis.com`) with automated model routing.
- **Ollama Translator (`ollama.ts`)**: Compatible with local Ollama, LM Studio, and vLLM servers without requiring API keys.

### Bi-Directional SSE Streaming

- **No Buffering Timeouts**: Streaming requests (`streamGenerateContent`) bypass response buffering and pipe SSE chunks directly to prevent Language Server execution timeouts.
- **Safe JSON Repair (`jsonRepair.ts`)**: Malformed or truncated SSE chunks are parsed and repaired using string-level state machines (`repairPartialJson()`). **Zero use of `eval()` or `new Function()`**.

### Tool Calling & Function Execution

- Converts Gemini `functionDeclarations` to OpenAI `tools` / Anthropic `tool_use`.
- Matches execution responses (`functionResponse`) back to upstream `tool_call_id` tokens across multi-turn sessions using `src/proxy/shared.ts` state storage.

### DeepSeek & Claude Thinking Support

- Detects reasoning parameters (`reasoning_effort`, `thinking`) in `modelUtils.ts`.
- Automatically strips or surfaces reasoning blocks (`<think>...</think>`) depending on IDE capabilities.

### Per-Model Circuit Breaker & Resiliency (`circuitBreaker.ts`)

- **Short-Circuiting Failures**: Automatically trips when an upstream provider experiences persistent errors or timeouts. Prevents the proxy from hanging and keeps the IDE model selection dropdown responsive.
- **Adaptive Retry Budget (`retryBudget.ts`)**: Dynamically adjusts retries per provider based on observed historical reliability. Flaky models receive fewer retries to prevent request storms, while stable models are granted retries.

### Automated Stream Fallback Routing

- **Seamless Provider Redirection**: If a primary custom model returns `429 Rate Limit` or `5xx Server Error`, the proxy automatically reroutes the prompt to an alternate configured fallback model.
- **In-Stream Transparency**: Emits a lightweight markdown notification chunk directly at the top of the chat stream (e.g. `> ⚠️ Auto-fallback: Claude 3.5 Sonnet failed (rate_limit). Retrying with DeepSeek R1...`).

### Telemetry, Metrics & Configuration Exchange

- **Real-Time Latency Metrics (`metrics.ts`)**: Exposes latency distributions (`proxy_upstream_ms`) and error counters (`proxy_errors_total`) via `/metrics`.
- **Config Import / Export (`configExchange.ts`)**: Provides structured JSON export and bulk import for easy model preset sharing across developer teams.
- **Native System Tray Integration (`tray.ts`, `menu.ts`)**: Embedded tray menu providing quick server status, log shortcuts, and toggle controls.


---

## Security Architecture

### AES-256-GCM Encryption (`safeStorage`)

All custom model configurations are stored in `~/.gemini/antigravity/custom_models.json` (or `%USERPROFILE%\.gemini\antigravity\custom_models.json` on Windows).

- **Encryption at Rest**: API keys are encrypted using **AES-256-GCM** via Electron `safeStorage` (backed by Windows DPAPI, macOS Keychain, or Linux Secret Service).
- **Auto-Migration**: Upgrades legacy plaintext keys to encrypted payloads (`enc:gcm:...`) seamlessly on first run (`src/proxy/modelLoader.ts`).

### Request Hardening & DoS Protection

- **Request Body Size Cap**: Default 100 MB payload limit (configurable via `AG_MAX_BODY_SIZE_MB` / `AG_MAX_BODY_SIZE`) to support large multi-turn conversations while preventing buffer exhaustion DoS attacks (`HTTP 413 Payload Too Large`).
- **Timeouts**: 30s-120s configurable timeouts on all outbound requests to prevent hung connections.
- **Header Masking**: CSRF tokens and authorization headers are scrubbed from diagnostic logging outputs.

---

## Quick Start & Installation

### Windows Setup

#### One-Click Script
Double-click or run in terminal:
```cmd
repatch.bat
```

#### npm Manual Build
```powershell
npm run build
npm run repatch
```

### macOS & Linux Setup

```bash
# macOS (Extracts /Applications/Antigravity.app, patches, repacks app.asar)
npm run repack:mac

# Linux (Auto-detects installation directory)
npm run repack:linux
```

### Enterprise MITM HTTPS Mode

If your network requires port 443 interception with custom SSL certificates:

```cmd
"Start Antigravity MITM.bat"
```
*(Requires Administrator privileges)*

---

## `ag-doctor` Diagnostic CLI

`ag-doctor` is the built-in diagnostic and maintenance tool provided with this repository.

### Command Reference

```bash
# Run full diagnostic suite (Binary patch status, proxy port, config integrity)
npm run doctor

# Quick health check
npm run doctor:check

# Automated repair (Applies binary patch, fixes corrupt config, resets ports)
npm run doctor:repair

# List active custom models and test API endpoints
npm run doctor:models

# Stream real-time diagnostic logs
npm run doctor:logs

# Purge orphan trajectories & vacuum database (Dual Summary Store cleanup)
node ag-doctor/bin/ag-doctor.js db:prune
node ag-doctor/bin/ag-doctor.js db:prune --dry-run

# Re-key models with proxy-compatible encryption
node ag-doctor/bin/ag-doctor.js models rekey

# Apply version-specific surgical patches
npm run patch:2.17              # Antigravity 2.17.x
npm run patch:2.18              # Antigravity 2.18.x

# Windows one-click repatch & launcher (or double-click repatch.bat in Explorer)
repatch.bat
```

### Antigravity IDE (v1.107.0+) vs Antigravity 2.0 (Classic)

The ecosystem provides full dual-support for both the classic Electron shell and the VS Code-based Antigravity IDE:

| Dimension | **Antigravity 2.0 (Classic Shell)** | **Antigravity IDE (VS Code)** |
| :--- | :--- | :--- |
| **Installation Path** | `%LOCALAPPDATA%\Programs\antigravity` | `%LOCALAPPDATA%\Programs\Antigravity IDE` |
| **Binary / Core** | v2.9.1 / v2.18.x (Electron shell) | v1.107.0 (VS Code platform fork) |
| **UI Experience** | Lightweight Agent chat & session management | Full IDE (editor, terminals, git, extensions) |
| **Patch Mechanism** | `app.asar` overlay + `language_server.exe` string table | `jetski.cloudCodeUrl` override + `out/main.js` hook |
| **Proxy Lifecycle** | Internal Electron main process lifecycle | **Autonomous auto-starter** hook in `main.js` |
| **Models Injected** | All custom models in `custom_models.json` | All custom models in `custom_models.json` |

#### Key Capabilities & Architecture:

- **Autonomous Proxy Auto-Starter (`out/main.js`)**: Antigravity IDE automatically verifies if port `51074` is active upon launch. If closed (e.g. Antigravity 2.0 is not running), it immediately spawns the detached background proxy runner from `~/.gemini/antigravity/proxy/` before extension activation, eliminating initial authentication errors (`ECONNREFUSED`).
- **Dual Summary Store Reconciliation**: Language Server 2.18+ synchronizes `conversation_summaries.db` (SQLite) and `agyhub_summaries_proto.pb` (Protobuf `SummariesState`). Boot repair in `proxy-runner.js` and `ag-doctor db:prune` eliminates orphan sessions (missing `conversations/<id>.db`), syncs `annotations/<id>.pbtxt` archive flags into `raw_summary` (field 15 tag `0x7a`), and scrubs `app_storage.json` so archived/deleted sessions never resurrect.
- **Chat Workflow Pills & Injected Suggestions**: Injected renderer hooks embed interactive workflow action pills (`git status`, `git diff`, `review`, `explain`) directly above the IDE input field, boosting command discovery and productivity.
- **Unified Model Configuration**: Both flavors read from the centralized `~/.gemini/antigravity/custom_models.json` with live health monitoring and auto-fallback.
- **1-Click Launchers**:
  - `Start Antigravity IDE.bat`: Launches Antigravity IDE with guaranteed background proxy execution.
  - `repatch.bat`: One-click repatch and launcher for both classic and IDE installations.
- **`models rekey`**: The language server stores API keys in its own `v10` format that the local proxy cannot decrypt. `ag-doctor models rekey` walks each affected model and re-enters the key in the proxy-compatible format (interactive, or `--keys-file <json>` for batch).

> **Tip**: Add or re-key custom models via `ag-doctor models add` / `models rekey` or `ag-doctor-ui` rather than the IDE's internal settings UI — the IDE re-encrypts keys into its private format, which the proxy cannot read.


### CLI Architecture & Worker Mode

`ag-doctor` runs in two execution modes (`ag-doctor/bin/ag-doctor.js`):
1. **CLI Mode**: One-shot execution for terminal environment checks, model listing, and automated repairs.
2. **Worker Mode (`--worker`)**: Spawns an in-process JSON-RPC daemon via `stdin`/`stdout`, eliminating process spawn overhead for IDE UI queries.

### Visual Diagnostic Dashboard (`ag-doctor-ui`)

In addition to the terminal CLI, this repository includes **`ag-doctor-ui`**, a dedicated Electron UI renderer application:
- **Visual Health Monitors**: Real-time status indicators for port `${AG_PROXY_PORT:-51074}` binding, Language Server binary patches, and SSL certificate validity.
- **One-Click Auto-Repair**: Single button repair flow to un-stick ports, restore corrupt `app.asar` backups, and re-apply version patches.
- **Live Log Inspector**: Integrated log tailing window with real-time severity filters (`INFO`, `WARN`, `ERROR`) and automatic API key masking.

#### Traffic Inspector View (`traffic-inspector.ts`)
- **Real-Time Network Logging**: Intercepts and displays active Cloud Code API requests, HTTP status codes, target models, translated providers, and end-to-end latency benchmarks.
- **Payload Diff & Replay**: Generates visual diff views (`generateDiffView`) for request/response payloads and enables single-click request replaying (`replayEntry`).
- **Multi-Field Filtering**: Filter entries instantly by URL path, model name, provider, or HTTP status code.

#### Failure Scenarios Showcase (`custom-error-scenarios.ts`, `failure-scenario-showcase.ts`)
- **Visual Error Simulation**: Interactive showcase previewing all provider error scenarios (Rate Limits 429, Billing/Quota Overage, Auth Errors 401/403, Network Timeouts, SSL Bypass failures).
- **Native Antigravity Banner Rendering**: Renders full-replica native Antigravity error cards complete with category badges, status tags, decoded troubleshooting hints, and primary/secondary action buttons (`ag-btn-primary`, `ag-btn-dismiss`).
- **Interactive QA Filter Chips**: Filter error cards by scenario category (`Rate Limit`, `Authentication`, `Network`, `Quota`) for visual debugging and QA verification.

### Token Tracker & Tokenizer Engine (`token-tracker.ts`)
- **Real-Time Token Usage Metrics**: Displays precise breakdown for Prompt Tokens, Completion Tokens, and Total Tokens consumed per request and aggregated across sessions.
- **Context Cache Hit Ratio**: Measures and displays Google Gemini and Claude prompt caching performance (`cachedTokens` / `promptTokens`), helping you monitor context cache efficiency.
- **Financial Savings Estimation**: Automatically calculates estimated dollar savings derived from prompt cache hits and reduced cached pricing tiers.
- **Per-Provider Analytics**: Filter and inspect token consumption, costs, and end-to-end latency metrics across Google Gemini, OpenAI, Claude, DeepSeek, and local models.

### Version-Aware Patching Engine

- **Multi-Version Patching**: `ag-doctor` automatically detects installed Antigravity releases (v2.0.x through v2.18.x) and performs binary string replacement or settings interception without corrupting Go executable alignment.
- **Surgical Patch Scripts**: Dedicated automated scripts for each major version tier (`npm run patch:2.2`, `patch:2.3`, `patch:2.5`, `patch:2.14`, `patch:2.15`, `patch:2.17`, `patch:2.18`).
- **Backup & Rollback Safety**: Creates timestamped `.bak` copies of `app.asar` before modifying binary payloads, allowing instant 1-command rollbacks (`npm run doctor:repair`).
- **Auto-Healing Diagnostics**: The doctor check starts the emergency proxy stub when port `${AG_PROXY_PORT:-51074}` is closed (so the patched language server can initialise), and `proxy start` replaces a stub with the real proxy. Provider probes use a 15s timeout with a retry on timeouts to avoid false "down" alarms.



---

## Antigravity Remote 2.0 (Mobile & Daemon Bridge)

**Antigravity Remote 2.0** extends Google Antigravity IDE and custom LLM models directly to mobile devices (Flutter on Android & iOS). Control agent trajectories, monitor streaming reasoning models, review unified diffs, execute terminal commands, and approve CLI tool actions from anywhere via local Wi-Fi or automated Cloudflare Quick Tunnels.

```
IDE Chat UI ↔ Language Server (Hub :55256) ◄── gRPC-Web ── Daemon Go (:8090 / Cloudflare Tunnel)
                                                                 ▲
                                                                 │ WebSocket (JSON RPC)
                                                                 ▼
                                                    Mobile Client (Flutter App)
```

---

### Remote Visual Experience & Screen Gallery

#### 1. Pairing, Discovery & Quiet Console Welcome
| Zero-Config LAN Discovery & 1-Tap Connect | 6-Digit PIN Pairing & Token Auth | Quiet Console & Action Pills |
|:---:|:---:|:---:|
| <img src="assets/remote/Screenshot_20260823_035900.jpg" width="240" alt="Zero-Config LAN Discovery & 1-Tap Connect" /> | <img src="assets/remote/Screenshot_20260823_035906.jpg" width="240" alt="6-Digit PIN Pairing & Token Auth" /> | <img src="assets/remote/Screenshot_20260823_035946.jpg" width="240" alt="Quiet Console & Action Pills" /> |
| Automatic UDP beacon scan (`:41234`), 1-Tap reconnect & Cloudflare QR scanner | Secure 6-digit rotating PIN validation with token persistence | Antigravity 2.0 glowing logo, prompt suggestions & workspace selector |

#### 2. Streaming Chat, Offline Resilience & Navigation Drawer
| Real-Time Streaming & Quick Actions | Offline Mode & Outbox Queue | Left Navigation & Active Agent State |
|:---:|:---:|:---:|
| <img src="assets/remote/Screenshot_20260823_035746.jpg" width="240" alt="Real-Time Streaming & Quick Actions" /> | <img src="assets/remote/Screenshot_20260823_035914.jpg" width="240" alt="Offline Mode & Outbox Queue" /> | <img src="assets/remote/Screenshot_20260823_040613.jpg" width="240" alt="Left Navigation & Active Agent State" /> |
| Markdown parsing, 7ms latency badge, diff pills, voice & model switcher | Automatic local queuing and seamless replay on reconnection | Active session spinner, workspace grouping, recent chats & status |

#### 3. Conversation Management & Session Lifecycle
| Conversation History & Search | Session Context Action Sheet | Multi-Project Workspace Switcher |
|:---:|:---:|:---:|
| <img src="assets/remote/Screenshot_20260823_035727.jpg" width="240" alt="Conversation History & Search" /> | <img src="assets/remote/Screenshot_20260823_035820.jpg" width="240" alt="Session Context Action Sheet" /> | <img src="assets/remote/Screenshot_20260823_040153.jpg" width="240" alt="Multi-Project Workspace Switcher" /> |
| Full-text search across all workspaces with timestamps | Rename, Pin, Export Markdown, Copy ID, Archive, or Delete sessions | Switch active workspace on host PC with instant hot reload |

#### 4. Live Code Review, Artifacts & Multi-Tab Workspace
| Multi-Tab Review & Quota Summary | Session Overview & Subagents | Interactive Artifact Modal |
|:---:|:---:|:---:|
| <img src="assets/remote/Screenshot_20260823_040208.jpg" width="240" alt="Multi-Tab Review & Quota Summary" /> | <img src="assets/remote/Screenshot_20260823_040257.jpg" width="240" alt="Session Overview & Subagents" /> | <img src="assets/remote/Screenshot_20260823_040310.jpg" width="240" alt="Interactive Artifact Modal" /> |
| Live unified diff (`protobuf.go (+1)`), Quota badge (`Gemini: 56%`) | Track subagents, 53 modified files, and generated markdown plans | Embedded markdown renderer with clickable file anchors & code blocks |

| Tabbed Artifact Multitasking | Right Context Drawer |
|:---:|:---:|
| <img src="assets/remote/Screenshot_20260823_040323.jpg" width="240" alt="Tabbed Artifact Multitasking" /> | <img src="assets/remote/Screenshot_20260823_035812.jpg" width="240" alt="Right Context Drawer" /> |
| Simultaneous artifact navigation (`audit_settings_remote.md`) and chat input | Quick access to Subagents, Changed Files, Uploads, MCP & Background Tasks |

#### 5. Workspace Explorer, Git Workflows & Remote PTY Terminal
| Workspace File Explorer | Syntax Highlighted Code Viewer | AI-Powered Git Commit Modal |
|:---:|:---:|:---:|
| <img src="assets/remote/Screenshot_20260823_040109.jpg" width="240" alt="Workspace File Explorer" /> | <img src="assets/remote/Screenshot_20260823_040119.jpg" width="240" alt="Syntax Highlighted Code Viewer" /> | <img src="assets/remote/Screenshot_20260823_040126.jpg" width="240" alt="AI-Powered Git Commit Modal" /> |
| Tree view, branch badge, search, and extension chips (`Dart`, `Go`, `TS`) | Line numbers, syntax highlighting, breadcrumb path & share actions | Generate contextual commit messages with 1-tap AI assistance |

| Git Branch & Worktree Switcher | Embedded Remote PTY Terminal | Scheduled Tasks & Background Cron |
|:---:|:---:|:---:|
| <img src="assets/remote/Screenshot_20260823_040135.jpg" width="240" alt="Git Branch & Worktree Switcher" /> | <img src="assets/remote/Screenshot_20260823_035754.jpg" width="240" alt="Embedded Remote PTY Terminal" /> | <img src="assets/remote/Screenshot_20260823_035824.jpg" width="240" alt="Scheduled Tasks & Background Cron" /> |
| Switch local & remote branches and isolated Git worktrees | Interactive shell bridge with quick action pills (`git status`, `diff`, `branch`) | Cron job scheduler, recurring background task monitors & triggers |

#### 6. 7-Category Modular Settings & Diagnostics
| Modular Settings & Configuration |
|:---:|
| <img src="assets/remote/Screenshot_20260823_035832.jpg" width="280" alt="Modular Settings & Configuration" /> |
| Account, General, Appearance, Models, Customizations (MCP & Skills), Browser (CDP), App & Daemon Bridge |

---

### Key Remote Capabilities & Protocols

1. **Go Daemon Bridge (`remote/daemon`)**:
   - **Process Auto-Discovery**: Automatically locates running `language_server` instances, parses CSRF credentials from process parameters, and maintains connection health via background watchdogs.
   - **gRPC-Web Framing**: Decodes and encodes gRPC-Web Protobuf and Jetbox Connect JSON envelopes transparently.
   - **StepRecovery Buffer**: In-memory ring buffer of the last 100 trajectory frames ensures zero message loss during transient network switches (e.g. Wi-Fi to 5G).
   - **Push Quota Polling**: Monitors Language Server user quota summary every 60s (only while clients are active) and pushes real-time quota updates over WebSocket.

2. **Security & Zero-Config Pairing**:
   - **UDP LAN Discovery**: Broadcasts UDP beacons on port `41234` for instant zero-configuration local network discovery.
   - **6-Digit Rotating PIN & Bearer Tokens**: Authenticate mobile clients using a 60-second rotating PIN displayed on the desktop console.
   - **Cloudflare Quick Tunnels**: 1-click end-to-end encrypted remote access outside local Wi-Fi with ASCII terminal QR code generation.

3. **Interactive Human-in-the-Loop Controls**:
   - **Tool Approvals (`submit_approval`)**: Approve or reject dangerous commands (`run_command`, `write_to_file`) with single-use (`once`) or full-session (`session`) scopes and auto-rejection timeouts.
   - **Structured Question Answering (`AskQuestion`)**: Interactive radio button and multi-select cards for resolving agent forks directly from phone notifications.
   - **Colosseum Battle Arena**: Multi-model duel supervision (e.g. Claude 3.5 Sonnet vs Gemini 3.8 Flash Tiered) with side-by-side branch comparison.

4. **Offline-First Resilience & Outbox Queue**:
   - **Optimistic UI & Local Outbox**: Messages composed while disconnected are stored in local FIFO storage and automatically drained upon reconnection.
   - **Zero Duplicate Deliveries**: UUID-based request mapping and message deduplication prevent repeated prompts.

---

### 📥 Download Pre-built Binaries (Android APK & Daemons)

Pre-built binaries are automatically built and published via GitHub Actions for every release:

| Component | Platform / Architecture | Asset Name | Description |
|---|---|---|---|
| **Android App (Universal)** | Android 7.0+ (ARM64, ARMv7, x86_64) | `antigravity-remote-universal.apk` | Single APK for all Android devices |
| **Android App (Split ABI)** | Android 64-bit ARM (`arm64-v8a`) | `app-arm64-v8a-release.apk` | Lightweight optimized APK (~25MB) |
| **Android App Bundle** | Google Play Store Format | `app-release.aab` | Official signed App Bundle |
| **Daemon Bridge** | Windows (`x86_64`) | `antigravity-remote-daemon-windows-amd64.exe` | Windows standalone daemon binary |
| **Daemon Bridge** | Linux (`x86_64`) | `antigravity-remote-daemon-linux-amd64` | Linux headless server daemon |
| **Daemon Bridge** | macOS Apple Silicon (`arm64`) | `antigravity-remote-daemon-darwin-arm64` | macOS M1/M2/M3 native binary |

### Running Antigravity Remote

```bash
# 1. Start the Remote Daemon on host PC (with Cloudflare tunnel & token)
cd remote/daemon
go run main.go --port 8090 --tunnel cloudflare --auth-token mysecret

# Or run pre-built daemon binary directly:
./antigravity-remote-daemon-windows-amd64.exe --tunnel cloudflare

# 2. Run the Flutter Mobile Companion App (or install the release APK)
cd remote/mobile
flutter run -d <device-id>
```

---

## Provider Configuration Matrix

| Provider | Provider Slug | Transport / Format | Target Base URL | Key / Auth Required | Streaming | Tool Calling |
|---|---|---|---|---|---|---|
| **Google Cloud Code (OAuth Pool)** | `google` | Cloud Code / Gemini | `https://daily-cloudcode-pa.googleapis.com` | OAuth Token | Yes | Yes |
| **Google AI Studio** | `google-gemini` | Gemini REST | `https://generativelanguage.googleapis.com` | API Key (`AIza...`) | Yes | Yes |
| **Gemini CLI (OAuth)** | `gemini-cli` | Cloud Code / Gemini | `https://cloudcode-pa.googleapis.com/v1internal` | OAuth Token | Yes | Yes |
| **OpenAI** | `openai` | OpenAI | `https://api.openai.com/v1` | Yes | Yes | Yes |
| **Anthropic** | `anthropic` | Anthropic | `https://api.anthropic.com/v1` | Yes | Yes | Yes |
| **OpenRouter** | `openrouter` | OpenAI | `https://openrouter.ai/api/v1` | Yes | Yes | Yes |
| **DeepSeek** | `deepseek` | OpenAI | `https://api.deepseek.com/v1` | Yes | Yes | Yes |
| **Groq** | `groq` | OpenAI | `https://api.groq.com/openai/v1` | Yes | Yes | Yes |
| **Mistral AI** | `mistral` | OpenAI | `https://api.mistral.ai/v1` | Yes | Yes | Yes |
| **Codestral** | `codestral` | OpenAI | `https://codestral.mistral.ai/v1` | Yes | Yes | Yes |
| **xAI (Grok)** | `xai` | OpenAI | `https://api.x.ai/v1` | Yes | Yes | Yes |
| **Cohere** | `cohere` | OpenAI | `https://api.cohere.com/v1` | Yes | Yes | Yes |
| **Cerebras** | `cerebras` | OpenAI | `https://api.cerebras.ai/v1` | Yes | Yes | Yes |
| **NVIDIA NIM** | `nvidia` | OpenAI | `https://integrate.api.nvidia.com/v1` | Yes | Yes | Yes |
| **OpenCode** | `opencode` | OpenAI | Custom Endpoint | Yes | Yes | Yes |
| **Kimi (Moonshot)** | `kimi` | Anthropic / OpenAI | `https://api.moonshot.ai/v1` | Yes | Yes | Yes |
| **Fireworks AI** | `fireworks` | Anthropic / OpenAI | `https://api.fireworks.ai/inference/v1` | Yes | Yes | Yes |
| **MiniMax** | `minimax` | OpenAI | `https://api.minimaxi.chat/v1` | Yes | Yes | Yes |
| **Ollama** | `ollama` | OpenAI / Ollama | `http://localhost:11434` | No | Yes | Yes |
| **LM Studio** | `lmstudio` | OpenAI | `http://localhost:1234/v1` | No | Yes | Yes |
| **Llama.cpp** | `llamacpp` | OpenAI | `http://localhost:8080/v1` | No | Yes | Yes |
| **Custom / OpenAI-compat** | `custom` | OpenAI | Custom Endpoint | Optional | Yes | Yes |

---

## `custom_models.json` Schema Reference

Configurations are saved under `~/.gemini/antigravity/custom_models.json` (or `%USERPROFILE%\.gemini\antigravity\custom_models.json` on Windows):

```json
{
  "providers": [
    {
      "id": "provider-1720000000000-1",
      "name": "Anthropic",
      "provider": "anthropic",
      "apiUrl": "https://api.anthropic.com/v1/messages",
      "apiKey": "enc:gcm:...",
      "enabled": true,
      "models": [
        {
          "id": "claude-3-5-sonnet-20241022",
          "displayName": "Claude 3.5 Sonnet",
          "enabled": true
        }
      ]
    }
  ]
}
```

> **Backward Compatibility**: The proxy automatically detects and migrates legacy flat array schemas (`[{"name": "...", "provider": "..."}]`) to the modern provider hierarchy on startup.

---

## Developer Guide

### Codebase Structure

```
├── ag-doctor/             # Diagnostic CLI suite & worker daemon
├── scripts/               # Repack, deploy, auto-heal, and MITM launcher scripts
├── src/
│   ├── main.ts            # Electron main process bootstrap & interceptors
│   ├── proxy.ts           # Core HTTP proxy server orchestration & interception
│   ├── constants.ts       # Central source of truth (Providers, default ports, timeouts)
│   ├── preload.ts         # Injected Custom Models Settings UI & contextBridge
│   ├── ipcHandlers.ts     # Canonical IPC registry & handler dispatcher
│   ├── schemaValidator.ts # Runtime response & model schema validation
│   ├── services/          # Core domain services (modelStore, cryptoStore, settingsService)
│   ├── proxy/
│   │   ├── registry.ts    # Translator auto-discovery registry & router
│   │   ├── protoInjector.ts # Protobuf payload injection for IDE picker
│   │   ├── protobuf.ts    # Manual varint protobuf encoding
│   │   ├── jsonRepair.ts  # Safe non-eval SSE JSON repair
│   │   ├── circuitBreaker.ts # Per-provider failure isolation
│   │   ├── retryStrategy.ts # Exponential backoff retry logic
│   │   └── translators/   # Format translators (openai, anthropic, google, ollama)
│   └── __tests__/         # 60 test files, 1400+ unit tests (Vitest)
```

### Building & Watch Mode

```bash
# Compile TypeScript files (src/ -> dist/)
npm run build

# Watch mode for iterative code changes
npm run watch
```

### Running Tests

The test suite runs via **Vitest**:

```bash
# Run all unit tests across 60 test files
npm test

# Run tests in watch mode
npm run test:watch
```

### Adding a New Translator Module

To add support for a new LLM provider format:
1. Add provider name to `PROVIDERS` and `ALL_PROVIDERS` in [src/constants.ts](src/constants.ts).
2. If compatible with OpenAI or Anthropic formats, add it to `OPENAI_COMPAT` or `ANTHROPIC_COMPAT` in [src/constants.ts](src/constants.ts) (handled automatically by `src/proxy/registry.ts`).
3. If the provider uses a unique wire protocol:
   - Create `src/proxy/translators/<provider>.ts` exporting mapping functions (`mapGeminiTo<Provider>`, `map<Provider>ToGemini`, `map<Provider>ChunkToGemini`).
   - Register the translator in [src/proxy/registry.ts](src/proxy/registry.ts).
4. Add presets to [src/presets.ts](src/presets.ts) (optional) and tests in `src/__tests__/`.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `AG_PROXY_PORT` | `51074` | Local proxy listen port |
| `AG_BIND_HOST` | `127.0.0.1` | Bind interface for the proxy, MITM, stub, and daemon probes |
| `AG_MITM_PORT` | `443` | MITM HTTPS listener port |
| `AG_STUB_PORT` | `51999` | Emergency proxy stub port |
| `AG_DAEMON_PORT` | `8090` | Remote daemon WebSocket port |
| `AG_DAEMON_TOKEN` | — | Auth token for daemon remote access |

Setting `AG_BIND_HOST` to `0.0.0.0` exposes the proxy on all interfaces (required for WSL2 or LAN access).

> For advanced options (retry budgets, timeout tuning, certificate pinning, daemon parameters), refer to the comprehensive [.env.example](.env.example) configuration template.

---

## Troubleshooting & Diagnostics

| Symptom | Cause | Solution |
|---|---|---|
| Models missing from chat dropdown | IDE update overwrote `app.asar` | Run `npm run doctor:repair` or `repatch.bat` |
| Connection test failed (401/403) | Invalid or expired API Key | Check key in Settings or `npm run doctor:models` |
| `${AG_PROXY_PORT:-51074}` in use | Another proxy instance active | `ag-doctor` automatically picks fallback port |
| `ERR_HTTP_HEADERS_SENT` in logs | Upstream response race condition | Handled automatically by `safeWriteHead` helpers |
| SSL / Certificate error | Corporate proxy SSL interception | Enable MITM mode via `"Start Antigravity MITM.bat"` |

Full troubleshooting guides are detailed in [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

---

## Frequently Asked Questions (FAQ)

### How do I add Anthropic Claude 3.5 Sonnet or DeepSeek R1 to Google Antigravity IDE?
You can add Claude 3.5 Sonnet, DeepSeek R1, OpenAI GPT-4o, or any custom LLM model by opening the custom model settings modal in Google Antigravity IDE, entering your API key and provider base URL, and running the automatic patcher (`repatch.bat` on Windows or `npm run repack:mac` on macOS).

### Are my provider API keys secure?
Yes. All custom model configurations and API keys are stored locally and encrypted at rest using **AES-256-GCM** via Electron `safeStorage` (backed by Windows DPAPI, macOS Keychain, or Linux Secret Service). Keys are never sent to third-party tracking servers.

### Can I run local LLMs with Ollama or LM Studio in Google Antigravity?
Yes. Set the provider to `ollama` or `openai` with endpoint `http://localhost:11434` (Ollama) or `http://localhost:1234/v1` (LM Studio). No API keys are required for offline local inference.

### How does auto-fallback and failover work?
If a primary custom model returns a `429 Rate Limit`, quota overage, or timeout, the proxy automatically retries the prompt with your configured secondary fallback model and renders a native warning banner in the chat stream without breaking conversation history.

### How does Google Multi-Account Quota Pooling work?
You can connect multiple Google accounts (via 1-click Google Sign-in in `ag-doctor-ui` or Google AI Studio developer API keys). The proxy aggregates their quotas using Power of Two Choices (P2C) load balancing, automatically penalizes accounts handling concurrent active requests, and rotates accounts when rate limits (429) or quotas are reached. If all Google Gemini accounts are exhausted, it cascades to Claude Sonnet/Opus 4.6.

### How does Antigravity IDE (VS Code) auto-start the proxy?
An autonomous hook embedded in `out/main.js` checks if the local proxy port `51074` is active on boot. If the proxy isn't already running, it immediately spawns the detached background proxy runner from `~/.gemini/antigravity/proxy/` before extensions activate, eliminating initial connection refused (`ECONNREFUSED`) errors.

### Why does `ag-doctor db:prune` reconcile both SQLite and Protobuf summaries?
Starting in Antigravity v2.18+, the Language Server synchronizes sessions across two stores: `conversation_summaries.db` (SQLite) and `agyhub_summaries_proto.pb` (Protobuf). Cleaning only SQLite causes deleted or archived sessions to resurrect from Protobuf upon IDE reboot. `ag-doctor db:prune` cleans both stores simultaneously, embeds archive flags into protobuf tag `0x7a`, and scrubs `app_storage.json` so archived sessions never reload.

---

## GitHub Search & Topics Metadata

For maximum repository discoverability on GitHub Search and Google SERP, ensure the following repository topics are assigned under **GitHub Repository Settings > About**:

`google-antigravity` • `antigravity-ide` • `custom-models` • `claude-3-5-sonnet` • `deepseek-r1` • `openai-gpt4o` • `ollama` • `openrouter` • `llm-proxy` • `cloudcode-patch`

---

## License & Acknowledgments

- **License**: Distributed under the **Apache-2.0 License**. See [LICENSE](LICENSE) for details.
- **Original Repository & Credits**: Special thanks to **Abdulvahap OGUT** for the original project repository: [vahapogut/antigravity-add-model](https://github.com/vahapogut/antigravity-add-model).
