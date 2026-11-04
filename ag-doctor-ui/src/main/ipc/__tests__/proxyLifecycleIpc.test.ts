import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DOCTOR_IPC_CHANNELS } from '../../../ipc/channels';

const handlers: Record<string, Function> = {};

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/mock/path') },
  ipcMain: {
    handle: vi.fn((channel: string, handler: Function) => {
      handlers[channel] = handler;
    }),
  },
}));

const mockProxyManager = {
  start: vi.fn().mockResolvedValue({ ok: true, message: 'Started', pid: 1234 }),
  stop: vi.fn().mockResolvedValue({ ok: true, message: 'Stopped' }),
  getStatus: vi.fn().mockResolvedValue({ running: true, port: 51074, pid: 1234 }),
  restart: vi.fn().mockResolvedValue({ ok: true, message: 'Restarted' }),
};

vi.mock('../../../proxy-manager', () => ({
  getProxyManager: () => mockProxyManager,
}));

import { registerProxyLifecycleIpc, isPortInUse } from '../system/proxyLifecycleIpc';

describe('proxyLifecycleIpc', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerProxyLifecycleIpc({} as any);
  });

  it('registers handlers for PROXY_START, PROXY_STOP, and PROXY_STATUS', () => {
    expect(handlers[DOCTOR_IPC_CHANNELS.PROXY_START]).toBeDefined();
    expect(handlers[DOCTOR_IPC_CHANNELS.PROXY_STOP]).toBeDefined();
    expect(handlers[DOCTOR_IPC_CHANNELS.PROXY_STATUS]).toBeDefined();
    expect(handlers[DOCTOR_IPC_CHANNELS.PROXY_RESTART]).toBeDefined();
  });

  it('delegates PROXY_START to ProxyManager and returns success response', async () => {
    const res = await handlers[DOCTOR_IPC_CHANNELS.PROXY_START]();
    expect(mockProxyManager.start).toHaveBeenCalled();
    expect(res).toEqual({ ok: true, message: 'Started', pid: 1234 });
  });

  it('handles exceptions in PROXY_START gracefully', async () => {
    mockProxyManager.start.mockRejectedValueOnce(new Error('Permission denied'));
    const res = await handlers[DOCTOR_IPC_CHANNELS.PROXY_START]();
    expect(res.ok).toBe(false);
    expect(res.message).toContain('Permission denied');
  });

  it('delegates PROXY_STATUS to ProxyManager and formats output', async () => {
    const res = await handlers[DOCTOR_IPC_CHANNELS.PROXY_STATUS]();
    expect(mockProxyManager.getStatus).toHaveBeenCalled();
    expect(res).toEqual({ ok: true, data: { running: true, port: 51074, pid: 1234 } });
  });

  it('delegates PROXY_STOP to ProxyManager and returns success', async () => {
    const res = await handlers[DOCTOR_IPC_CHANNELS.PROXY_STOP]();
    expect(mockProxyManager.stop).toHaveBeenCalled();
    expect(res).toEqual({ ok: true, message: 'Stopped' });
  });

  it('detects available port via isPortInUse', async () => {
    // Port 0 in Node lets the OS assign an ephemeral port that closes immediately
    const inUse = await isPortInUse(0, '127.0.0.1');
    expect(typeof inUse).toBe('boolean');
  });
});
