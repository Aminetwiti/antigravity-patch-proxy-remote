# Autonomous Agent Execution Engine

## 1. Overview

The **Autonomous Agent Execution Engine** (`pkg/agent`) provides the reasoning and tool-execution loop on the remote server host/VPS.

Unlike traditional IDE plugins where the agent execution is tied to the desktop GUI lifecycle, the `ag-agentd` execution loop runs in an **isolated server-side background goroutine** per session.

```
Desktop / Mobile Client (WebSocket)
            │
            ▼
┌─────────────────────────────────────────────────────────────┐
│                    RuntimeServer (/v2/ws)                   │
│                              │                              │
│                              ▼                              │
│                         AgentEngine                         │
│                              │                              │
│   ┌──────────────────────────┴──────────────────────────┐   │
│   ▼                                                     ▼   │
│ LLMClient (ReAct loop)                        tools.Registry│
│   │                                                     │   │
│   ▼                                                     ▼   │
│ session.EmitEvent                             approval.Manager
│   │                                                     │   │
│   ▼                                                     ▼   │
│ EventStore (SQLite WAL) ──▶ BroadcastEvent ──▶ Clients Live │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. The Execution Loop Lifecycle

1. **Trigger**:
   A client sends a `session.prompt` command via WebSocket.
2. **State Transition**:
   - The session state transitions: `CREATED`/`WAITING_INPUT` $\longrightarrow$ `STARTING` $\longrightarrow$ `RUNNING`.
   - A `user.message` event is recorded in the EventStore.
3. **Background Goroutine Spawn**:
   `go e.runExecutionLoop(turnCtx, sessionID, workspaceID)` is launched.
   - If the client drops its network connection, the goroutine **continues running uninterrupted**.
4. **Context Gathering**:
   - The engine queries `sessionSvc.GetCatchupEvents` to reconstruct conversational and tool context.
5. **LLM Generation**:
   - Invokes `LLMClient.Generate(...)`.
   - Streams thoughts via `agent.thought_chunk` and commits `agent.thought`.
6. **Tool Execution & Human-in-the-Loop Approval**:
   - For each tool call:
     - Check `toolsReg.NeedsApproval(name, args)`.
     - If approval required: FSM transitions to `WAITING_APPROVAL`, emits `approval.requested`, and blocks until a client sends `approval.respond` or timeout occurs.
     - Upon approval: FSM transitions back to `RUNNING`.
     - Executes tool in the session's workspace.
     - Streams stdout/stderr chunks via `tool.output`.
     - Emits `tool.result`.
7. **Turn Completion**:
   - When the agent produces its final answer without further tool calls:
     - Emits `agent.completed`.
     - FSM transitions to `WAITING_INPUT` (ready for subsequent user turns).
8. **Cancellation**:
   - A `session.cancel` command invokes the context cancel function, terminates active child processes, and sets the FSM to `CANCELLED`.
