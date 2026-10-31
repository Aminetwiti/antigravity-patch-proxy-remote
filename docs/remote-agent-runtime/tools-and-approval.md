# Tools Registry, Workspace Confinement & Approvals

## 1. Built-in Tools

| Tool | Parameters | Description | Approval Policy |
|---|---|---|---|
| `run_command` | `command`, `cwd?`, `timeoutSec?` | Executes shell commands in workspace root, streaming live stdout/stderr chunks. | **Required** (except safe read-only commands like `pwd`, `git status`, `echo`) |
| `view_file` | `path`, `startLine?`, `endLine?` | Safely reads workspace file lines. | Safe (Auto-approved) |
| `write_to_file` | `path`, `content` | Atomically writes content to file in workspace. | **Required** |
| `replace_file_content` | `path`, `target`, `replacement` | Precise search-and-replace edit in file. | **Required** |
| `list_dir` | `path?`, `depth?` | Recursively lists files with ignore filtering (`.git`, `node_modules`). | Safe (Auto-approved) |
| `grep_search` | `query`, `maxResults?` | Searches workspace text files for pattern. | Safe (Auto-approved) |

---

## 2. Workspace Confinement

All filesystem operations are strictly validated using `workspace.ResolveAndValidatePath(workspaceRoot, targetPath)`:
- Strips `file://` URIs and normalizes relative paths.
- Computes `filepath.Rel(cleanRoot, resolved)`.
- Rejects any path evaluating to `..` or leading outside the registered workspace root.
- Throws typed error `workspace.ErrPathOutsideRoot`.

---

## 3. Human-in-the-Loop Approval Interception

When an agent invokes a mutating tool:
1. `tools.Registry.NeedsApproval` returns `true`.
2. `approval.Manager.RequestApproval` generates a unique approval ID (`appr_<nano>_<tool>`).
3. FSM state transitions to `WAITING_APPROVAL`.
4. Event `approval.requested` is appended to `EventStore` and broadcast live to Desktop/Mobile.
5. Execution blocks on an in-memory response channel with configurable timeout (default 5m).
6. Client transmits:
   ```json
   {
     "version": 2,
     "type": "approval.respond",
     "sessionId": "sess_123",
     "payload": {
       "approvalId": "appr_...",
       "approved": true,
       "reason": "approved by user"
     }
   }
   ```
7. `approval.Manager.ResolveApproval` unblocks the channel.
8. FSM state transitions back to `RUNNING`.
9. If approved, the tool executes; if denied, a tool error is fed back to the LLM.
