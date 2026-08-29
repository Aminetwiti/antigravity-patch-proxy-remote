/**
 * Connectivity probe — pings an endpoint and reports latency / status.
 * Uses Node's built-in http/https modules, no third-party deps.
 *
 * Reachability semantics:
 *   - 2xx → reachable (success)
 *   - 3xx → reachable (redirect; not followed for a connectivity probe)
 *   - 4xx → reachable (server responded, path not found / unauthorized)
 *   - 5xx → reachable (server responded, upstream error)
 *   - network error / timeout → unreachable
 *
 * This matches the spirit of "is the endpoint up?" rather than
 * "does this specific path return 200?".
 *
 * Improvements over the original:
 *   - Distinguishes reachable vs unreachable (was: any response = ok).
 *   - `probeWithProxy` no longer leaks sockets on error paths.
 *   - Adds an explicit socket timeout with cleanup.
 *   - Avoids hanging on unreachable proxies via a hard deadline.
 *   - Optionally injects provider-specific auth headers so /v1/models probes
 *     mirror the requests the Electron app actually makes.
 *   - Adds `Accept: application/json` so APIs return JSON error bodies
 *     instead of HTML 404 pages.
 *   - Classifies low-level errors (`errorCategory`) so the doctor check
 *     can give actionable advice:
 *       dns      → ENOTFOUND / EAI_AGAIN (host doesn't resolve)
 *       refused  → ECONNREFUSED (port closed, e.g. local proxy down)
 *       timeout  → ETIMEDOUT / hard deadline
 *       tls      → CERT_* errors or TLS handshake failures
 *       reset    → ECONNRESET (peer dropped the connection)
 *       other    → anything else
 */
import http from 'http';
import https from 'https';
import { URL } from 'url';
import type { ConnectivityResult } from '../types';

/** Coarse-grained category for a failed probe. Drives recovery advice. */
export type ProbeErrorCategory = 'dns' | 'refused' | 'timeout' | 'tls' | 'reset' | 'other';

/** Map a Node error to a coarse category, or 'other' if we can't tell. */
export function classifyError(err: NodeJS.ErrnoException | Error | undefined): ProbeErrorCategory {
  if (!err) return 'other';
  const code = (err as NodeJS.ErrnoException).code ?? '';
  const msg = (err.message ?? '').toLowerCase();
  if (
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    code === 'EADDRINFO' ||
    msg.includes('getaddrinfo') ||
    msg.includes('dns')
  ) {
    return 'dns';
  }
  if (code === 'ECONNREFUSED' || msg.includes('econnrefused') || msg.includes('refused')) {
    return 'refused';
  }
  if (
    code === 'ETIMEDOUT' ||
    code === 'ESOCKETTIMEDOUT' ||
    msg.includes('timeout') ||
    msg.includes('hard deadline')
  ) {
    return 'timeout';
  }
  if (
    code === 'ECONNRESET' ||
    msg.includes('econnreset') ||
    msg.includes('socket hang up')
  ) {
    return 'reset';
  }
  if (
    code === 'CERT_HAS_EXPIRED' ||
    code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
    code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
    code === 'ERR_TLS_CERT_ALTNAME_INVALID' ||
    msg.includes('cert') ||
    msg.includes('tls')
  ) {
    return 'tls';
  }
  return 'other';
}

export interface ProbeOptions {
  /** Extra headers merged into the request. */
  headers?: Record<string, string>;
  /** Provider id; used to pick the right auth header name. */
  provider?: string;
  /** API key. Encrypted blobs (`enc:`) are ignored. */
  apiKey?: string;
}

/** Build auth headers for a provider/apiKey pair. Returns empty for encrypted keys. */
export function authHeaders(provider: string | undefined, apiKey: string | undefined): Record<string, string> {
  if (!apiKey || apiKey.startsWith('enc:')) return {};
  if (provider === 'anthropic') {
    return { 'x-api-key': apiKey, 'anthropic-version': '2025-04-01' };
  }
  if (provider === 'google') {
    return { 'x-goog-api-key': apiKey };
  }
  return { Authorization: `Bearer ${apiKey}` };
}

/** A response counts as "reachable" if we got any HTTP status back. */
function isReachable(code: number | undefined): boolean {
  return typeof code === 'number' && code >= 200 && code < 600;
}

/** A response counts as "success" only for 2xx. */
function isSuccess(code: number | undefined): boolean {
  return typeof code === 'number' && code >= 200 && code < 300;
}

export async function probe(
  url: string,
  timeoutMs = 5000,
  options: ProbeOptions = {},
): Promise<ConnectivityResult> {
  const started = Date.now();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (e) {
    return { url, ok: false, error: `invalid URL: ${(e as Error).message}` };
  }
  const extraHeaders = { ...(options.headers ?? {}), ...authHeaders(options.provider, options.apiKey) };
  return new Promise((resolve) => {
    let settled = false;
    const deadline = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ url, ok: false, latencyMs: Date.now() - started, error: 'hard deadline reached', errorCategory: 'timeout' });
    }, timeoutMs * 2 + 1000);
    const finish = (res: ConnectivityResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolve(res);
    };
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        method: 'GET',
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        timeout: timeoutMs,
        headers: {
          'User-Agent': 'ag-doctor/1.0',
          // Ask the API for JSON so we get structured error bodies instead of
          // an HTML 404 page when the path is wrong.
          'Accept': 'application/json, text/plain;q=0.9, */*;q=0.5',
          ...extraHeaders,
        },
      },
      (res) => {
        // Drain body to free the socket
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => { body += chunk; });
        res.on('end', () => {
          const reachable = isReachable(res.statusCode);
          const success = isSuccess(res.statusCode);
          // Expose selected headers for callers (e.g. X-Proxy-Stub detection)
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            if (v != null) headers[k] = Array.isArray(v) ? v[0] : String(v);
          }
          finish({
            url,
            ok: reachable,
            latencyMs: Date.now() - started,
            statusCode: res.statusCode,
            headers,
            body: body.slice(0, 512), // first 512 chars for diagnostics
            ...(success ? {} : { error: `HTTP ${res.statusCode}` }),
          });
        });
        res.on('error', (err) => {
          finish({ url, ok: false, latencyMs: Date.now() - started, error: err.message, errorCategory: classifyError(err) });
        });
      },
    );
    req.on('timeout', () => {
      finish({ url, ok: false, latencyMs: Date.now() - started, error: 'timeout', errorCategory: 'timeout' });
      try { req.destroy(); } catch { /* ignore */ }
    });
    req.on('error', (err) => {
      finish({ url, ok: false, latencyMs: Date.now() - started, error: err.message, errorCategory: classifyError(err) });
    });
    req.on('close', () => {
      finish({ url, ok: false, latencyMs: Date.now() - started, error: 'connection closed', errorCategory: 'reset' });
    });
    req.end();
  });
}


export async function probeWithProxy(
  url: string,
  timeoutMs = 5000,
  proxyUrl?: string,
  options: ProbeOptions = {},
): Promise<ConnectivityResult> {
  if (!proxyUrl) return probe(url, timeoutMs, options);
  const started = Date.now();
  let parsed: URL;
  let proxyParsed: URL;
  try {
    parsed = new URL(url);
    proxyParsed = new URL(proxyUrl);
  } catch (e) {
    return { url, ok: false, error: `invalid URL: ${(e as Error).message}` };
  }

  const extraHeaders = { ...(options.headers ?? {}), ...authHeaders(options.provider, options.apiKey) };

  // Hard deadline: if neither CONNECT nor the inner TLS request completes in
  // `timeoutMs`, we resolve with an error rather than hanging forever.
  return new Promise<ConnectivityResult>((resolve) => {
    let settled = false;
    // Absolute deadline: guarantees the promise resolves within 2*timeoutMs
    // even if every event handler fails to fire (e.g., socket in a bad state).
    const deadline = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ url, ok: false, latencyMs: Date.now() - started, error: 'hard deadline reached', errorCategory: 'timeout' });
    }, timeoutMs * 2 + 1000);
    const settle = (res: ConnectivityResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolve(res);
    };
    const proxyReq = http.request(
      {
        method: 'CONNECT',
        hostname: proxyParsed.hostname,
        port: proxyParsed.port || 80,
        path: `${parsed.hostname}:${parsed.port || 443}`,
        timeout: timeoutMs,
        headers: { 'User-Agent': 'ag-doctor/1.0' },
        agent: false,
      },
      (proxyRes) => {
        if (settled) return;
        if (proxyRes.statusCode !== 200) {
          proxyRes.socket?.destroy();
          proxyRes.destroy();
          settle({
            url,
            ok: false,
            latencyMs: Date.now() - started,
            error: `proxy CONNECT ${proxyRes.statusCode}`,
            errorCategory: 'refused',
          });
          return;
        }
        const socket = proxyRes.socket;
        if (!socket) {
          settle({ url, ok: false, latencyMs: Date.now() - started, error: 'proxy returned no socket', errorCategory: 'other' });
          return;
        }
        const tlsReq = https.request(
          {
            method: 'GET',
            hostname: parsed.hostname,
            port: Number(parsed.port || 443),
            path: parsed.pathname + parsed.search,
            timeout: timeoutMs,
            headers: {
              'User-Agent': 'ag-doctor/1.0',
              'Accept': 'application/json, text/plain;q=0.9, */*;q=0.5',
              ...extraHeaders,
            },
            createConnection: () => socket,
            agent: false,
          } as https.RequestOptions,
          (res) => {
            res.resume();
            const reachable = isReachable(res.statusCode);
            const success = isSuccess(res.statusCode);
            settle({
              url,
              ok: reachable,
              latencyMs: Date.now() - started,
              statusCode: res.statusCode,
              ...(success ? {} : { error: `HTTP ${res.statusCode}` }),
            });
          },
        );
        tlsReq.on('timeout', () => {
          settle({ url, ok: false, latencyMs: Date.now() - started, error: 'TLS timeout', errorCategory: 'timeout' });
          try { tlsReq.destroy(); } catch { /* ignore */ }
        });
        tlsReq.on('error', (err) => {
          settle({ url, ok: false, latencyMs: Date.now() - started, error: err.message, errorCategory: classifyError(err) });
        });
        tlsReq.on('close', () => {
          // Safety net: if neither timeout nor error fired, resolve with a generic error.
          settle({ url, ok: false, latencyMs: Date.now() - started, error: 'TLS connection closed', errorCategory: 'reset' });
        });
        tlsReq.end();
      },
    );
    proxyReq.on('timeout', () => {
      settle({ url, ok: false, latencyMs: Date.now() - started, error: 'proxy timeout', errorCategory: 'timeout' });
      try { proxyReq.destroy(); } catch { /* ignore */ }
    });
    proxyReq.on('error', (err) => {
      settle({ url, ok: false, latencyMs: Date.now() - started, error: err.message, errorCategory: classifyError(err) });
    });
    proxyReq.on('close', () => {
      // Safety net: if neither timeout nor error fired, resolve with a generic error.
      settle({ url, ok: false, latencyMs: Date.now() - started, error: 'proxy connection closed', errorCategory: 'reset' });
    });
    proxyReq.end();
  });
}
