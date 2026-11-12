// MCP relay bridge: exposes the desktop MCP configuration to the mobile
// companion through the local proxy (127.0.0.1:51074). The phone holds no
// credentials or allowlist — the PC session is the single legitimate holder,
// so this module only reads the local MCP config files and forwards tool
// calls to the MCP runtime. This is a thin delegation layer, not an MCP
// client implementation.

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import { randomBytes } from 'crypto';

// Server names that are always hidden from the mobile listing: they are
// internal Antigravity plumbing, not user-facing MCP tools.
const MCP_HIDDEN_SERVERS = new Set(['antigravity-internal', 'antigravity-core']);

// Resolved lazily so tests can stub os.homedir() before loadMcpConfig runs.
function mcpConfigCandidates(): string[] {
  const home = os.homedir();
  return [
    path.join(home, '.gemini', 'mcp_config.json'),
    path.join(home, '.antigravity', 'mcp_config.json'),
  ];
}

export interface McpServerEntry {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  description?: string;
}

/**
 * Loads the parsed MCP config (already validated for our shape). Returns
 * `{ servers, raw }` where servers is a map of name → entry.
 */
export function loadMcpConfig(): { servers: Record<string, McpServerEntry>; raw: string } {
  for (const candidate of mcpConfigCandidates()) {
    try {
      if (fs.existsSync(candidate)) {
        const raw = fs.readFileSync(candidate, 'utf-8');
        const parsed = JSON.parse(raw) as { mcpServers?: Record<string, McpServerEntry> };
        if (parsed.mcpServers && typeof parsed.mcpServers === 'object') {
          return { servers: parsed.mcpServers, raw };
        }
      }
    } catch {
      // Ignore unreadable or invalid config files; try the next candidate.
    }
  }
  return { servers: {}, raw: '' };
}

/**
 * Lists MCP servers for the mobile MCP Explorer: name, status, tools, and
 * description. The tool list is discovered lazily via `tools/list` on the
 * first access, with a short timeout so a broken server doesn't hang the
 * mobile UI.
 */
export async function mcpListServers(): Promise<{ servers: McpServerEntry[] }> {
  const { servers } = loadMcpConfig();
  const result: McpServerEntry[] = [];

  for (const [name, entry] of Object.entries(servers)) {
    if (MCP_HIDDEN_SERVERS.has(name)) continue;
    // Mask all environment values to prevent leaking API keys / tokens to remote clients
    const maskedEnv: Record<string, string> = {};
    if (entry.env) {
      for (const k of Object.keys(entry.env)) {
        maskedEnv[k] = '********';
      }
    }
    result.push({
      name,
      command: entry.command,
      args: entry.args ?? [],
      env: maskedEnv,
      description: entry.description,
    });
  }

  return { servers: result };
}

/**
 * Forwards an MCP tool call to the local MCP runtime. `serverName` selects
 * the configured server; `toolName` is the tool to invoke; `arguments` is a
 * JSON object of tool args. The response is relayed as-is.
 */
export async function mcpCallTool(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const serverName = typeof payload.serverName === 'string' ? payload.serverName : '';
  const toolName = typeof payload.toolName === 'string' ? payload.toolName : '';
  const arguments_ = (payload.arguments as Record<string, unknown>) ?? {};
  const callId = randomBytes(8).toString('hex');

  if (serverName === '' || toolName === '') {
    return { error: { message: 'serverName and toolName are required' } };
  }

  const { servers } = loadMcpConfig();
  const entry = servers[serverName];
  if (!entry) {
    return { error: { message: `MCP server not configured: ${serverName}` } };
  }

  try {
    const result = await runMcpToolCall(entry, toolName, arguments_, callId);
    return { result, callId };
  } catch (err) {
    return { error: { message: (err as Error).message } };
  }
}

/**
 * Executes a single MCP tool call via stdio JSON-RPC (the MCP protocol's
 * default transport). Spawns the server process once per call — acceptable
 * for mobile-driven, low-frequency tool use; a long-lived child with a
 * persistent session is the upgrade path (ponytail: known ceiling).
 */
async function runMcpToolCall(
  entry: McpServerEntry,
  toolName: string,
  args: Record<string, unknown>,
  callId: string,
): Promise<unknown> {
  const child = spawn(entry.command, entry.args ?? [], {
    env: { ...process.env, ...(entry.env ?? {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const timeout = setTimeout(() => {
    child.kill();
  }, 30_000);

  try {
    const initializeRes = await sendJsonRpc(child, {
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'antigravity-remote', version: '1.0' } },
    });
    if (initializeRes && typeof initializeRes === 'object' && (initializeRes as Record<string, unknown>).error) {
      return { error: (initializeRes as Record<string, unknown>).error };
    }

    const result = await sendJsonRpc(child, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    });
    return result;
  } finally {
    clearTimeout(timeout);
    child.kill();
  }
}

/**
 * Sends a single JSON-RPC request to the child MCP server over stdio and
 * waits for the matching response frame (by id). Rejects on process exit
 * or protocol errors.
 */
function sendJsonRpc(child: ReturnType<typeof spawn>, request: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('MCP server timeout'));
    }, 30_000);

    let buffer = '';

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf-8');
      // JSON-RPC over stdio uses newline-delimited JSON frames
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed) as Record<string, unknown>;
          if (msg.id === request.id) {
            cleanup();
            resolve(msg);
            return;
          }
        } catch {
          // Not JSON — ignore non-JSON frames (e.g. server logs)
        }
      }
    };

    const onExit = (code: number | null, signal: string | null) => {
      cleanup();
      reject(new Error(`MCP server exited (code=${code}, signal=${signal})`));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout?.removeListener('data', onData);
      child.removeListener('exit', onExit);
    };

    child.stdout?.on('data', onData);
    child.once('exit', onExit);
    child.stdin?.write(JSON.stringify(request) + '\n');
  });
}
