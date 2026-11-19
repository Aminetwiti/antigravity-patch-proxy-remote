import { describe, expect, it, vi, beforeEach } from 'vitest';
import net from 'net';
import { getProxyManager, ProxyManager } from './proxy-manager';
import { EnvironmentConfig } from './config/environment';

describe('ProxyManager', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('Singleton & Configuration', () => {
    it('returns a persistent singleton instance across invocations', () => {
      const instance1 = getProxyManager();
      const instance2 = getProxyManager();
      expect(instance1).toBe(instance2);
    });

    it('honors custom options when instantiated directly', () => {
      const custom = new ProxyManager({ port: 54321, host: '0.0.0.0', scriptPath: '/custom/path.js' });
      expect(custom).toBeInstanceOf(ProxyManager);
    });
  });

  describe('getStatus', () => {
    it('reports not running when process is uninitialized', async () => {
      const mgr = new ProxyManager({ port: 9999 });
      vi.spyOn(mgr, 'isListening').mockResolvedValue(false);

      const status = await mgr.getStatus();
      expect(status.running).toBe(false);
      expect(status.port).toBe(9999);
      expect(status.pid).toBeUndefined();
      expect(status.error).toBeUndefined();
    });

    it('reports error when child process exists but is not listening', async () => {
      const mgr = new ProxyManager({ port: 9999 });
      (mgr as any).proxyProcess = { exitCode: null, pid: 12345 };
      vi.spyOn(mgr, 'isListening').mockResolvedValue(false);

      const status = await mgr.getStatus();
      expect(status.running).toBe(false);
      expect(status.pid).toBe(12345);
      expect(status.error).toBe('Server process running but not listening');
    });

    it('reports running when child process is active and socket is listening', async () => {
      const mgr = new ProxyManager({ port: 9999 });
      (mgr as any).proxyProcess = { exitCode: null, pid: 54321 };
      vi.spyOn(mgr, 'isListening').mockResolvedValue(true);

      const status = await mgr.getStatus();
      expect(status.running).toBe(true);
      expect(status.pid).toBe(54321);
      expect(status.error).toBeUndefined();
    });
  });

  describe('isListening boundary check', () => {
    it('resolves true when socket connects successfully', async () => {
      const mgr = new ProxyManager({ port: 9999, host: '127.0.0.1' });

      vi.spyOn(net, 'Socket').mockImplementation(function (this: any) {
        const handlers: Record<string, () => void> = {};
        return {
          connect: vi.fn(() => {
            setTimeout(() => handlers['connect']?.(), 5);
          }),
          on: vi.fn((event: string, cb: () => void) => {
            handlers[event] = cb;
          }),
          destroy: vi.fn(),
        } as unknown as net.Socket;
      } as any);

      const listening = await mgr.isListening();
      expect(listening).toBe(true);
    });

    it('resolves false when socket emits connection error', async () => {
      const mgr = new ProxyManager({ port: 9999, host: '127.0.0.1' });

      vi.spyOn(net, 'Socket').mockImplementation(function (this: any) {
        const handlers: Record<string, (err?: any) => void> = {};
        return {
          connect: vi.fn(() => {
            setTimeout(() => handlers['error']?.(new Error('ECONNREFUSED')), 5);
          }),
          on: vi.fn((event: string, cb: (err?: any) => void) => {
            handlers[event] = cb;
          }),
          destroy: vi.fn(),
        } as unknown as net.Socket;
      } as any);

      const listening = await mgr.isListening();
      expect(listening).toBe(false);
    });
  });

  describe('start & stop lifecycle guards', () => {
    it('fails to start when proxy script file does not exist', async () => {
      const mgr = new ProxyManager({ scriptPath: '/non/existent/script_mitm.js' });
      const res = await mgr.start();
      expect(res.ok).toBe(false);
      expect(res.message).toBeDefined();
    });

    it('returns ok on stop when no process is running', async () => {
      const mgr = new ProxyManager();
      const res = await mgr.stop();
      expect(res.ok).toBe(true);
      expect(res.message).toContain('not running');
    });
  });
});
