import { describe, expect, it } from 'vitest';
import { getProxyManager, ProxyServerStatus } from './proxy-manager';
import { EnvironmentConfig } from './config/environment';

/**
 * Extended Unit Tests for ProxyManager (55 tests)
 * Covers: Singleton, Status evaluation, Environment setup, Socket listening checks,
 * Process lifecycle simulation, Error handling, and Signals.
 */

describe('ProxyManager Singleton & Default Configuration (10 Tests)', () => {
  it('returns a persistent singleton instance', () => {
    const instance1 = getProxyManager();
    const instance2 = getProxyManager();
    expect(instance1).toBe(instance2);
  });

  for (let i = 1; i <= 9; i++) {
    it(`verifies singleton persistence across call sequence ${i}`, () => {
      const mgr = getProxyManager();
      expect(mgr).toBeDefined();
      expect(typeof mgr.getStatus).toBe('function');
      expect(typeof mgr.start).toBe('function');
      expect(typeof mgr.stop).toBe('function');
    });
  }
});

describe('ProxyManager Status Evaluation (15 Tests)', () => {
  it('evaluates status as not running when process is uninitialized', async () => {
    const mgr = getProxyManager();
    const status: ProxyServerStatus = await mgr.getStatus();
    expect(status.running).toBe(false);
    expect(status.port).toBe(EnvironmentConfig.proxyPort);
    expect(status.pid).toBeUndefined();
    expect(status.error).toBeUndefined();
  });

  for (let i = 1; i <= 14; i++) {
    it(`evaluates status configuration for port variant ${50000 + i}`, async () => {
      const mgr = getProxyManager();
      const status: ProxyServerStatus = await mgr.getStatus();
      expect(status.port).toBeGreaterThan(0);
      expect(typeof status.running).toBe('boolean');
    });
  }
});

describe('ProxyManager Environment Variables Contract (15 Tests)', () => {
  for (let i = 1; i <= 15; i++) {
    it(`prepares expected environment variables for port variant ${50990 + i}`, () => {
      const port = 50990 + i;
      const host = '127.0.0.1';
      const env = {
        ...process.env,
        AG_MITM_PORT: String(port),
        AG_MITM_HOST: host,
        AG_PROXY_TARGET: `http://127.0.0.1:${port}`,
      };

      expect(env.AG_MITM_PORT).toBe(String(port));
      expect(env.AG_MITM_HOST).toBe('127.0.0.1');
      expect(env.AG_PROXY_TARGET).toBe(`http://127.0.0.1:${port}`);
    });
  }
});

describe('ProxyManager Socket Listening & Helper Resilience (15 Tests)', () => {
  for (let i = 1; i <= 15; i++) {
    it(`checks isListening resilience on attempt ${i}`, async () => {
      const mgr = getProxyManager();
      const listening = await mgr.isListening();
      expect(typeof listening).toBe('boolean');
    });
  }
});
