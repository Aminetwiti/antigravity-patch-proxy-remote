import { beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'path';
import fs from 'fs';

const { mockProbe, mockSpawn } = vi.hoisted(() => ({
  mockProbe: vi.fn(),
  mockSpawn: vi.fn(),
}));

vi.mock('../core/probe', () => ({ probe: mockProbe }));
vi.mock('../core/config', () => ({ DEFAULT_MITM_PORT: 51074 }));
vi.mock('child_process', () => ({ spawn: mockSpawn }));

import { checkProxy, findProxyStubScript } from './proxy';

const refused = { ok: false as const, error: 'connect ECONNREFUSED 127.0.0.1:51074' };
const healthy = { ok: true as const, latencyMs: 12, headers: {} };

describe('checkProxy stub self-heal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: spawn succeeds and returns a detached handle.
    mockSpawn.mockReturnValue({ unref: () => {} });
  });

  it('finds the real proxy-stub.js shipped with the repo', () => {
    const script = findProxyStubScript();
    expect(script).not.toBeNull();
    expect(script).toMatch(/proxy-stub\.js$/);
    // It must resolve to an existing file deep inside ag-doctor/scripts, not
    // a repo-root or cwd placeholder that never exists.
    expect(fs.existsSync(script as string)).toBe(true);
    expect(path.basename(script as string)).toBe('proxy-stub.js');
    expect(script).toContain('scripts');
  });

  it('automatically starts the stub from the correct location when the port is refused', async () => {
    mockProbe
      .mockResolvedValueOnce(refused) // initial probe
      .mockResolvedValueOnce(healthy); // post-start retry

    const result = await checkProxy(51074);

    expect(result.status).toBe('ok');
    expect(result.message).toContain('stub auto-started');
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const [bin, args] = mockSpawn.mock.calls[0] as [string, string[]];
    expect(bin).toBe(process.execPath);
    expect(args[0]).toMatch(/proxy-stub\.js$/);
    expect(args[1]).toBe('51074');
  });

  it('reports the warn fallback when the stub spawn fails', async () => {
    mockProbe.mockResolvedValue(refused);
    mockSpawn.mockImplementation(() => {
      throw new Error('spawn failed');
    });

    const result = await checkProxy(51074);

    expect(result.status).toBe('warn');
    expect(result.message).toContain('Not reachable on port 51074');
    expect(result.details).toContain('could not be started');
  });
});