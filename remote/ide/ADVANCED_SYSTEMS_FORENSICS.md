# ADVANCED SYSTEMS FORENSICS & DEEP ENGINE INTERNALS
## Antigravity IDE, Language Server Go Binary, Trajectory DB & Reasoning Protocols

> **Scope**: Advanced Deep Forensic Analysis of the internal execution engines, sandbox permissions, SQLite storage (`dbtrajectory`), context compaction, and thinking/reasoning protocol bridging.  
> **Source**: Reverse-engineered Go binary 1.28 RC (`language_server.exe`), 50 decoded `.proto` descriptors in `remote/proto/`, and minified AST of `jetskiAgent/main.js`.

---

## 1. TOOL EXECUTION ENGINE & SANDBOX PERMISSIONS

The Language Server Go binary contains a multi-tier tool execution pipeline that bridges LLM outputs, IDE terminal APIs, native operating system processes, and browser automation.

```
                  ┌────────────────────────────────────────┐
                  │          LLM GENERATOR OUTPUT          │
                  │  (XML `<tool_call>` or Structured RPC) │
                  └───────────────────┬────────────────────┘
                                      │
                                      ▼
                  ┌────────────────────────────────────────┐
                  │       PRE-TOOL HOOKS EVALUATION        │
                  │  (`pre_tool_hook_names` / Interceptors)│
                  └───────────────────┬────────────────────┘
                                      │
                                      ▼
                  ┌────────────────────────────────────────┐
                  │       POLICY GUARDIAN & SANDBOX        │
                  │  (`PolicyGuardianConfig` / Allowlist)  │
                  └─────────┬────────────────────┬─────────┘
                            │ (Auto-run)         │ (Requires Approval)
                            │                    ▼
                            │          ┌───────────────────┐
                            │          │ ASK PERMISSION UI │
                            │          │  (`AskQuestion` / │
                            │          │   Diff Zones)     │
                            │          └─────────┬─────────┘
                            ▼                    │ (Approved)
                  ┌──────────────────────────────▼─────────┐
                  │           EXECUTION TARGET             │
                  ├───────────────────┬────────────────────┤
                  │ Terminal / PTY    │ `RunCommandTool`   │
                  │ File System       │ `CodeTool` (sed)   │
                  │ Browser Engine    │ Playwright-Go (CDP)│
                  │ MCP Sidecars      │ `SidecarConfig`    │
                  └───────────────────┴────────────────────┘
```

### 1.1 Tool Call Wire Formats
The Go binary supports dual parsing modes via `TrajectoryConversionConfig`:
1. **XML Streaming Format**:
   - Request: `Assistant: <tool_call><tool_code_run_command>{"CommandLine":"..."}</tool_code_run_command></tool_call>`
   - Response: `USER: <tool_response>{"output":"..."}</tool_response>`
2. **Structured Protobuf Format**:
   - `exa.codeium_common_pb.ChatToolCall` with `id`, `name`, `json_arguments`.
   - Tool outputs wrapped in `exa.gemini_coder.proto.Step` with `TaskDetails` (`requires_input_approval`, `progress`, `log_uri`).

### 1.2 Permission & Safety Policy Guardian
Defined in `exa.cortex_pb.PermissionConfig` and `exa.cortex_pb.AllowAlwaysConfig`:
- **Dangerous Binaries Filter**: Blacklists destructive system commands (`rm -rf`, `format`, `dd`, `rundll32.exe`) via `dangerous_binaries`.
- **Subcommand Granularity**: `dangerous_subcommands` (e.g. allowing `git status` / `git log` automatically while blocking `git push --force` or `git reset --hard` without explicit UI approval).
- **Policy Guardian Model**: Dedicated low-latency model evaluation (`PolicyGuardianConfig.model`) running in parallel to assess command intent before execution.

### 1.3 Execution Hosts
The tool runner supports two execution backends:
- **IDE Terminal Execution** (`enable_ide_terminal_execution = true`): Dispatches execution to the VS Code Extension Host via `ExtensionServerService`, running inside the user's visible terminal emulator.
- **Persistent Go PTY Execution** (`force_go_terminal_execution = true`, `enable_pty = true`): The Go binary spawns headless pseudo-terminals with persistent environment tracking, capturing raw ANSI streams, output stabilization timeouts, and midpoint cancellation signals.

---

## 2. CONTEXT WINDOW COMPACTION & CACHE BREAKPOINTS

To manage very long agentic tasks (thousands of steps) within token limits, the Language Server uses an intelligent compaction and prompt caching pipeline.

```
                      FULL CONVERSATION TRAJECTORY
  ┌────────┬────────┬────────┬────────┬────────┬────────┬────────┬────────┐
  │ Step 1 │ Step 2 │ Step 3 │ Step 4 │ Step 5 │ Step 6 │ Step 7 │ Step 8 │
  └────────┴────────┴────────┴────────┴────────┴────────┴────────┴────────┘
                                  │
                                  ▼ Compaction Point (Threshold Exceeded)
  ┌───────────────────────────────┐┌────────┬────────┬────────┬────────┐
  │   SYNTHESIZED SUMMARY STEP    ││ Step 5 │ Step 6 │ Step 7 │ Step 8 │
  │    (`CompactionInfo` Blob)    ││ (Active Working Context Window)   │
  └───────────────────────────────┘└────────┴────────┴────────┴────────┘
                  ▲                               ▲
                  │                               │
       System Prompt Cache Breakpoint    Stable Context Breakpoint
        (`system_prompt_cache`)            (`cache_breakpoints`)
```

### 2.1 Prompt Cache Breakpoints
Defined in `exa.cortex_pb.ChatStartMetadata`:
- **`system_prompt_cache`**: Marks the fixed system instruction prefix for provider KV-caching (Anthropic Prompt Caching / Google Gemini Context Caching).
- **`cache_breakpoints`** (`repeated CacheBreakpointMetadata`): Checkpoint indexes with content checksums (`content_checksum`), allowing incremental prompt cache reuse across iterative tool turns.

### 2.2 Dynamic Trajectory Compaction
When context tokens reach `truncation_threshold_tokens` (or `max_context_tokens`):
1. The server triggers a distillation pass (`add_distill_node = true`, `distill_config`).
2. Steps $1 \dots K$ are collapsed into a compact structural checkpoint (`CompactionInfo`).
3. Slices are updated in `AgentStateUpdate.compaction_info`.
4. Subsequent calls supply the compacted summary followed only by steps $> K$.

---

## 3. PERSISTENCE FORENSICS (`dbtrajectory` SQLite ENGINE)

The Go Language Server persists all conversation trajectories locally in SQLite databases (`dbtrajectory`).

### 3.1 Database Topology & Invariants
- **Location**: `%APPDATA%\Antigravity\dbtrajectory\*.db` or `~/.gemini/antigravity/dbtrajectory/`
- **Schema Migration**: Verified by string `db version too new: got %d`.
- **Lazy Page Loading**: Steps are fetched in chunks: `lazy: failed to load steps [%d, %d)`.

### 3.2 Physical Storage Schema
```sql
-- Reconstructed Forensic SQLite Schema for dbtrajectory

CREATE TABLE IF NOT EXISTS conversation_metadata (
    conversation_id TEXT PRIMARY KEY,
    cascade_id TEXT NOT NULL,
    root_conversation_id TEXT,
    parent_conversation_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    status INTEGER NOT NULL,
    metadata_blob BLOB -- Serialized CortexTrajectoryMetadata
);

CREATE TABLE IF NOT EXISTS trajectory_steps (
    conversation_id TEXT NOT NULL,
    step_index INTEGER NOT NULL,
    step_type INTEGER NOT NULL,
    step_status INTEGER NOT NULL,
    step_data BLOB NOT NULL, -- Serialized exa.gemini_coder.proto.Step
    created_at INTEGER NOT NULL,
    PRIMARY KEY (conversation_id, step_index)
);

CREATE TABLE IF NOT EXISTS step_generator_metadata (
    conversation_id TEXT NOT NULL,
    metadata_index INTEGER NOT NULL,
    step_indices TEXT NOT NULL, -- JSON array of uint32
    generator_blob BLOB NOT NULL, -- Serialized CortexStepGeneratorMetadata
    PRIMARY KEY (conversation_id, metadata_index)
);

CREATE TABLE IF NOT EXISTS checkpoints (
    conversation_id TEXT NOT NULL,
    checkpoint_index INTEGER NOT NULL,
    state_id TEXT NOT NULL,
    step_count INTEGER NOT NULL,
    compaction_blob BLOB, -- Serialized CompactionInfo
    created_at INTEGER NOT NULL,
    PRIMARY KEY (conversation_id, checkpoint_index)
);

CREATE INDEX IF NOT EXISTS idx_steps_convo ON trajectory_steps(conversation_id);
CREATE INDEX IF NOT EXISTS idx_gen_meta_convo ON step_generator_metadata(conversation_id);
```

---

## 4. THINKING & REASONING PROTOCOL BRIDGING

The binary features explicit support for extended thinking and reasoning models via `ThinkingConfig` and `reasoning_content`.

### 4.1 Wire Schema for Thinking Configuration
In `exa.cortex_pb.ChatModelMetadata` and `exa.codeium_common_pb.CompletionConfiguration`:
```protobuf
message ThinkingConfig {
  int32 thinking_budget = 1; // Required token budget for reasoning (e.g. 1024 to 32768)
  bool include_thoughts = 2; // Stream reasoning thoughts alongside final content
}
```

### 4.2 Patch Proxy Reasoning Normalization Table

The `antigravity-patch-proxy` bridges thinking tokens across diverse provider schemas:

| Provider / Model | Reasoning Wire Format In | Transformed Wire Format Out |
|---|---|---|
| **Anthropic Claude 3.7 Sonnet** | `thinking: { type: "enabled", budget_tokens: N }` | Content block `type: "thinking"`, `thinking: "..."` |
| **DeepSeek R1** | Standard completion payload with reasoning | `delta.reasoning_content: "..."` |
| **OpenAI o1 / o3-mini** | `reasoning_effort: "low" \| "medium" \| "high"` | Encapsulated in `<thought>` tags or `thought` message parts |
| **Google Gemini (Flash Thinking)** | `generationConfig.thinkingConfig` | Parts with `thought: true` |

---

## 5. SIDECARS, PLUGINS & MCP BRIDGE ARCHITECTURE

The Language Server implements a full micro-process orchestration layer for external tools, sidecars, and MCP servers (`PROTOCOL_MCP`).

```protobuf
message SidecarConfig {
  string command = 1;
  repeated string args = 3;
  repeated EnvEntry env = 7;
  string restart_policy = 2;
  bool has_web_ui = 6;
  SidecarUIConfig ui_config = 10;
  SidecarAgentPermissions agent_permissions = 11;
  repeated SidecarArgumentDefinition arguments = 12;
}

message McpServerSpec {
  string server_name = 1;
  string command = 2;
  repeated string args = 3;
  map<string, string> env = 4;
  bool lazy_load = 5;
  int32 timeout_seconds = 6;
}
```

### PROVEN Capabilities:
1. **Dynamic Web Port Discovery**: Sidecars expose web UIs (`has_web_ui = true`) whose ephemeral ports are registered dynamically in `SidecarStatusInfo.web_port` and proxied through IDE webview tabs.
2. **Lazy MCP Loading**: MCP servers are discovered at startup but spawned only on first tool invocation if `lazy_load = true`, keeping memory footprint minimal.
3. **Multi-Agent Message Passing**: Subagents and sidecars communicate through `SendMessageEvent` (`recipient_id`, `content`) and `NewConversationEvent`, creating hierarchical trees of autonomous agents.

---
*Generated directly from forensic binary symbols, decompiled ConnectRPC descriptors, and live IDE traces.*
