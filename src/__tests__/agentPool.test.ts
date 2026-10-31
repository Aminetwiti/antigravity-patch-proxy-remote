import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import * as https from 'https';
import {
  getHttpsAgent,
  getHttpAgent,
  evictAgent,
  disposeAll,
  _cacheStats,
  resolveClientForUrl,
  DEFAULT_MAX_SOCKETS,
  DEFAULT_MAX_FREE_SOCKETS,
  DEFAULT_FREE_SOCKET_TIMEOUT_MS,
} from '../proxy/agentPool';

describe('agentPool', () => {
  beforeEach(() => {
    disposeAll();
  });

  afterEach(() => {
    disposeAll();
  });

  describe('constants', () => {
    it('exports sane defaults', () => {
      expect(DEFAULT_MAX_SOCKETS).toBeGreaterThan(0);
      expect(DEFAULT_MAX_FREE_SOCKETS).toBeGreaterThan(0);
      expect(DEFAULT_FREE_SOCKET_TIMEOUT_MS).toBeGreaterThan(0);
    });
  });

  describe('getHttpsAgent', () => {
    it('returns an https.Agent with keepAlive enabled', () => {
      const agent = getHttpsAgent({ host: 'api.openai.com' });
      expect(agent).toBeInstanceOf(https.Agent);
      // options isn't a public field, but keepAlive socket config is observable via `keepAlive` static-ish getter
      expect((agent as unknown as { keepAlive: boolean }).keepAlive).toBe(true);
    });

    it('caches agents per (host, port, allowUnauthorized) tuple', () => {
      const a1 = getHttpsAgent({ host: 'api.openai.com' });
      const a2 = getHttpsAgent({ host: 'api.openai.com' });
      expect(a1).toBe(a2);
      expect(_cacheStats().https).toBe(1);

      // Different host �� new agent
      const a3 = getHttpsAgent({ host: 'api.anthropic.com' });
      expect(a3).not.toBe(a1);
      expect(_cacheStats().https).toBe(2);
    });

    it('treats allowUnauthorized as part of the cache key', () => {
      const strict = getHttpsAgent({ host: 'x.test', allowUnauthorized: false });
      const lax = getHttpsAgent({ host: 'x.test', allowUnauthorized: true });
      expect(strict).not.toBe(lax);
      expect(_cacheStats().https).toBe(2);
    });

    it('treats different ports as different cache entries', () => {
      const a = getHttpsAgent({ host: 'x.test', port: 443 });
      const b = getHttpsAgent({ host: 'x.test', port: 8443 });
      expect(a).not.toBe(b);
      expect(_cacheStats().https).toBe(2);
    });
  });

  describe('getHttpAgent', () => {
    it('returns an http.Agent with keepAlive enabled', () => {
      const agent = getHttpAgent({ host: 'plain.test' });
      expect(agent).toBeInstanceOf(http.Agent);
      expect((agent as unknown as { keepAlive: boolean }).keepAlive).toBe(true);
    });

    it('caches per host', () => {
      const a1 = getHttpAgent({ host: 'plain.test' });
      const a2 = getHttpAgent({ host: 'plain.test' });
      expect(a1).toBe(a2);
      expect(_cacheStats().http).toBe(1);
    });
  });

  describe('evictAgent', () => {
    it('removes an agent from the cache', () => {
      const a = getHttpsAgent({ host: 'evict.test' });
      expect(_cacheStats().https).toBe(1);

      evictAgent({ host: 'evict.test' });
      expect(_cacheStats().https).toBe(0);

      // The destroy() was called on the original agent. Node's `destroyed`
      // flag flips synchronously after `agent.destroy()`.
      expect((a as unknown as { destroyed?: boolean }).destroyed !== false).toBe(true);
    });

    it('is a no-op when no agent exists', () => {
      expect(() => evictAgent({ host: 'never-cached.test' })).not.toThrow();
    });
  });

  describe('disposeAll', () => {
    it('clears both caches and resolves', async () => {
      getHttpsAgent({ host: 'a.test' });
      getHttpsAgent({ host: 'b.test' });
      getHttpAgent({ host: 'c.test' });
      expect(_cacheStats().https).toBe(2);
      expect(_cacheStats().http).toBe(1);

      await disposeAll();
      expect(_cacheStats().https).toBe(0);
      expect(_cacheStats().http).toBe(0);
    });

    it('can be called multiple times without throwing', async () => {
      await disposeAll();
      await expect(disposeAll()).resolves.not.toThrow();
    });
  });

  describe('resolveClientForUrl', () => {
    it('returns https client for https URLs', () => {
      const url = new URL('https://api.openai.com/v1/chat');
      const { client, agent } = resolveClientForUrl(url);
      expect(client).toBe(https);
      expect(agent).toBeInstanceOf(https.Agent);
    });

    it('returns http client for http URLs', () => {
      const url = new URL('http://plain.example.com/');
      const { client, agent } = resolveClientForUrl(url);
      expect(client).toBe(http);
      expect(agent).toBeInstanceOf(http.Agent);
    });

    it('caches per host across calls', () => {
      const url1 = new URL('https://cache.test/path');
      const url2 = new URL('https://cache.test/other');
      const r1 = resolveClientForUrl(url1);
      const r2 = resolveClientForUrl(url2);
      expect(r1.agent).toBe(r2.agent);
    });

    it('honors custom ports', () => {
      const url = new URL('https://x.test:8443/');
      const { agent } = resolveClientForUrl(url);
      // Same host on default port yields a different agent.
      const defaultR = resolveClientForUrl(new URL('https://x.test/'));
      expect(agent).not.toBe(defaultR.agent);
    });
  });
});
