/**
 * Per-host socket pool manager for the proxy layer.
 *
 * ────────────��────────────────────────────────────────────────────────────────
 * Why this exists
 * ─────────────────────────────────────────────────────────────────────────────
 * The previous `proxy.ts` code called `https.request(url, opts, cb)` on every
 * upstream call. Node's default `https.Agent` (globalAgent) does keep sockets
 * alive, BUT:
 *
 *   1. The default `maxSockets` is `Infinity`, which is fine in steady state
 *      but does nothing about per-host coalescing.
 *   2. Default `keepAlive` is `false` on Node 18+. Every streaming call paid
 *      a fresh TLS handshake (~50-100ms locally, often 200-400ms across
 *      continents).
 *   3. There is no per-host bound �� a misbehaving upstream can saturate file
 *      descriptors before anyone notices.
 *   4. There is no structured way to propagate `rejectUnauthorized: false`
 *      across the entire forward layer.
 *
 * The vendor codebase solves this with `undici.Agent` + a cache keyed by
 * host. We replicate the same idea with the built-in `https.Agent` /
 * `http.Agent` to keep the change dependency-free.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Behavior
 * ─────────────────────────────────────────────────────────────────────────────
 *   - `getHttpsAgent({ host, port, allowUnauthorized })` returns a stable
 *     `https.Agent` instance per host+port+security tuple.
 *   - `getHttpAgent(...)` mirrors for plain HTTP.
 *   - Each agent is configured with `keepAlive: true`, a bounded
 *     `maxSockets` and `maxFreeSockets` (from `DEFAULT_*_POOL_SIZE`).
 *   - `evictAgent({ host })` removes a host's agent (e.g., for testing or
 *     on TLS error recovery).
 *   - `disposeAll()` closes every cached agent (call from graceful shutdown).
 *   - The pool is **process-global** (mirrors undici's per-instance caches
 *     but simpler).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Safety
 * ─────────────────────────────────────────────────────────────────────────────
 *   - All agents use `keepAlive: true` with a 30s free-socket timeout —
 *     long enough to amortize across typical multi-turn chat, short enough
 *     to release dead connections before DNS or IP changes become a problem.
 *   - `maxSockets: 32` per host is more than enough for any single chat
 *     client while preventing runaway FD growth.
 *   - `maxFreeSockets: 8` keeps warm sockets for spiky traffic without
 *     hoarding memory.
 */

import * as http from 'http';
import * as https from 'https';

/** Maximum concurrent sockets per host (open + in-flight). */
export const DEFAULT_MAX_SOCKETS = 32;

/** Maximum idle (keep-alive) sockets retained per host. */
export const DEFAULT_MAX_FREE_SOCKETS = 8;

/** Keep-alive timeout for free sockets, in milliseconds. */
export const DEFAULT_FREE_SOCKET_TIMEOUT_MS = 30_000;

export interface AgentOptions {
  /** Hostname (used as the cache key alongside port). */
  host: string;
  /** Port (defaults to 443 for https / 80 for http). */
  port?: number;
  /**
   * When true, skip TLS certificate verification.
   * IMPORTANT: This is opt-in. The caller decides whether the user
   * consented to TLS bypass (mirrors `customModels.allowUnauthorized`).
   */
  allowUnauthorized?: boolean;
}

interface CacheKey {
  scheme: 'http' | 'https';
  host: string;
  port: number;
  allowUnauthorized: boolean;
}

/** Per-host agent cache. Keyed by tuple of (scheme, host, port, allowUnauthorized). */
const httpsCache = new Map<string, https.Agent>();
const httpCache = new Map<string, http.Agent>();

function buildKey(k: CacheKey): string {
  return `${k.scheme}://${k.host}:${k.port}?insecure=${k.allowUnauthorized ? '1' : '0'}`;
}

function defaultPort(scheme: 'http' | 'https', port?: number): number {
  if (port !== undefined) return port;
  return scheme === 'https' ? 443 : 80;
}

/**
 * Return a stable `https.Agent` for the given host with keep-alive enabled.
 *
 * The agent is cached for the process lifetime; callers must NOT call
 * `agent.destroy()` themselves (use `evictAgent` or `disposeAll`).
 */
export function getHttpsAgent(opts: AgentOptions): https.Agent {
  const port = defaultPort('https', opts.port);
  const allowUnauthorized = !!opts.allowUnauthorized;
  const key = buildKey({ scheme: 'https', host: opts.host, port, allowUnauthorized });

  const cached = httpsCache.get(key);
  if (cached) return cached;

  const agent = new https.Agent({
    keepAlive: true,
    maxSockets: DEFAULT_MAX_SOCKETS,
    maxFreeSockets: DEFAULT_MAX_FREE_SOCKETS,
    keepAliveMsecs: DEFAULT_FREE_SOCKET_TIMEOUT_MS,
    rejectUnauthorized: !allowUnauthorized,
  });

  httpsCache.set(key, agent);
  return agent;
}

/**
 * Return a stable `http.Agent` for the given host with keep-alive enabled.
 */
export function getHttpAgent(opts: AgentOptions): http.Agent {
  const port = defaultPort('http', opts.port);
  const allowUnauthorized = !!opts.allowUnauthorized; // unused for http, but kept for symmetry
  const key = buildKey({ scheme: 'http', host: opts.host, port, allowUnauthorized });

  const cached = httpCache.get(key);
  if (cached) return cached;

  const agent = new http.Agent({
    keepAlive: true,
    maxSockets: DEFAULT_MAX_SOCKETS,
    maxFreeSockets: DEFAULT_MAX_FREE_SOCKETS,
    // Node uses `keepAliveMsecs` as the free-socket timeout (ms).
    keepAliveMsecs: DEFAULT_FREE_SOCKET_TIMEOUT_MS,
  });

  httpCache.set(key, agent);
  return agent;
}

/**
 * Drop the cached agent for a host so the next call gets a fresh one.
 * Useful after TLS errors or for tests.
 */
export function evictAgent(opts: AgentOptions): void {
  const httpsPort = defaultPort('https', opts.port);
  const httpPort = defaultPort('http', opts.port);
  const keyHttps = buildKey({ scheme: 'https', host: opts.host, port: httpsPort, allowUnauthorized: !!opts.allowUnauthorized });
  const keyHttp = buildKey({ scheme: 'http', host: opts.host, port: httpPort, allowUnauthorized: !!opts.allowUnauthorized });

  const a = httpsCache.get(keyHttps);
  if (a) {
    a.destroy();
    httpsCache.delete(keyHttps);
  }
  const b = httpCache.get(keyHttp);
  if (b) {
    b.destroy();
    httpCache.delete(keyHttp);
  }
}

/**
 * Close every cached agent. Call from graceful shutdown paths.
 */
export function disposeAll(): Promise<void> {
  const tasks: Promise<unknown>[] = [];
  for (const agent of httpsCache.values()) {
    tasks.push(new Promise<void>((resolve) => {
      try {
        agent.destroy();
        resolve();
      } catch {
        resolve();
      }
    }));
  }
  for (const agent of httpCache.values()) {
    tasks.push(new Promise<void>((resolve) => {
      try {
        agent.destroy();
        resolve();
      } catch {
        resolve();
      }
    }));
  }
  httpsCache.clear();
  httpCache.clear();
  return Promise.all(tasks).then(() => undefined);
}

/**
 * Internal: returns the current cache size (used by tests + diagnostics).
 */
export function _cacheStats(): { https: number; http: number } {
  return { https: httpsCache.size, http: httpCache.size };
}

/**
 * Resolve the correct http vs https module + cached agent for a URL.
 *
 * Returns `{ client, agent, port }`. The caller passes `agent` as the
 * `agent` field of `https.RequestOptions` / `http.RequestOptions`.
 *
 * Note: We still return `client` (the module) because `https.request(url,
 * options, cb)` accepts an `agent` field but the *module* owns the request
 * constructor. We could also call `agent.request(...)` directly, which is
 * equivalent.
 */
export function resolveClientForUrl(rawUrl: string | URL, allowUnauthorized = false): {
  client: typeof https | typeof http;
  agent: https.Agent | http.Agent;
} {
  const parsedUrl = typeof rawUrl === 'string' ? new URL(rawUrl) : rawUrl;
  const scheme = parsedUrl.protocol === 'https:' ? 'https' : 'http';
  const host = parsedUrl.hostname;
  const port = parsedUrl.port
    ? parseInt(parsedUrl.port, 10)
    : (scheme === 'https' ? 443 : 80);

  if (scheme === 'https') {
    return {
      client: https,
      agent: getHttpsAgent({ host, port, allowUnauthorized }),
    };
  }
  return {
    client: http,
    agent: getHttpAgent({ host, port, allowUnauthorized }),
  };
}
