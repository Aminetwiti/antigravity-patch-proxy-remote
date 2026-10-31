import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Temp home dir for the duration of the suite. Must be `mock`-prefixed so the
// hoisted vi.mock('os') factory can reference it.
const mockHome = path.join(os.tmpdir(), 'ag-mcp-relay-test-' + process.pid);
const CONFIG_PATH = path.join(mockHome, '.gemini', 'mcp_config.json');

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, homedir: () => mockHome };
});

function writeConfig(servers: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ mcpServers: servers }), 'utf-8');
}

beforeEach(() => {
  fs.rmSync(mockHome, { recursive: true, force: true });
});

afterEach(() => {
  fs.rmSync(mockHome, { recursive: true, force: true });
});

describe('loadMcpConfig', () => {
  it('parses a valid mcp_config.json', async () => {
    const { loadMcpConfig } = await import('../proxy/mcpRelay');
    writeConfig({
      coolify: { command: 'coolify-mcp', env: { COOLIFY_BASE_URL: 'https://x' } },
    });
    const { servers } = loadMcpConfig();
    expect(servers.coolify.command).toBe('coolify-mcp');
  });

  it('returns empty map when config is missing', async () => {
    const { loadMcpConfig } = await import('../proxy/mcpRelay');
    const { servers } = loadMcpConfig();
    expect(servers).toEqual({});
  });

  it('returns empty map on invalid JSON', async () => {
    const { loadMcpConfig } = await import('../proxy/mcpRelay');
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, '{not json', 'utf-8');
    const { servers } = loadMcpConfig();
    expect(servers).toEqual({});
  });
});

describe('mcpListServers', () => {
  it('lists configured servers with command and args', async () => {
    const { mcpListServers } = await import('../proxy/mcpRelay');
    writeConfig({
      coolify: { command: 'coolify-mcp', args: ['--port', '9999'], env: {} },
      filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'], env: {} },
    });
    const res = await mcpListServers();
    expect(res.servers).toHaveLength(2);
    const names = res.servers.map((s) => s.name);
    expect(names).toContain('coolify');
    expect(names).toContain('filesystem');
    const coolify = res.servers.find((s) => s.name === 'coolify')!;
    expect(coolify.args).toEqual(['--port', '9999']);
  });

  it('hides internal servers from the mobile listing', async () => {
    const { mcpListServers } = await import('../proxy/mcpRelay');
    writeConfig({
      'antigravity-internal': { command: 'internal' },
      'user-server': { command: 'npx', args: ['x'] },
    });
    const res = await mcpListServers();
    expect(res.servers.map((s) => s.name)).toEqual(['user-server']);
  });

  it('returns empty list when no config', async () => {
    const { mcpListServers } = await import('../proxy/mcpRelay');
    const res = await mcpListServers();
    expect(res.servers).toEqual([]);
  });
});
