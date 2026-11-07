import * as http from 'http';
import log from 'electron-log';
import { LOOPBACK_HOSTS } from '../constants';

// ─── Safe Response Helpers ─────────────────────────────────────────────────
// Guard flag pattern to prevent ERR_HTTP_HEADERS_SENT when timeout and
// upstream response race. Returns true if the operation succeeded, false if
// the response was already terminated.

export function safeWriteHead(
  res: http.ServerResponse,
  status: number,
  headers?: Record<string, string>,
): boolean {
  if (res.headersSent || res.writableEnded) {
    return false;
  }
  try {
    res.writeHead(status, headers);
    return true;
  } catch (err) {
    log.warn('[Proxy] safeWriteHead failed:', (err as Error).message);
    return false;
  }
}

export function safeEnd(res: http.ServerResponse, data?: string | Buffer): boolean {
  if (res.writableEnded) {
    return false;
  }
  try {
    res.end(data);
    return true;
  } catch (err) {
    log.warn('[Proxy] safeEnd failed:', (err as Error).message);
    return false;
  }
}

/**
 * Parses the Retry-After header from upstream responses (RFC 7231 §7.1.3).
 * Returns delay in milliseconds, or 0 if no valid header is present.
 */
export function parseRetryAfter(headers: Record<string, string | string[] | undefined>): number {
  const val = headers['retry-after'];
  if (!val) return 0;

  const raw = Array.isArray(val) ? val[0] : val;
  if (!raw) return 0;

  // Try delta-seconds (e.g. "120")
  const seconds = parseInt(raw.trim(), 10);
  if (!isNaN(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  // Try HTTP-date (e.g. "Wed, 21 Oct 2015 07:28:00 GMT")
  const date = new Date(raw);
  if (!isNaN(date.getTime())) {
    const delay = date.getTime() - Date.now();
    return delay > 0 ? delay : 0;
  }

  return 0;
}

/**
 * Validates request Host, Origin, and remote IP against allowed loopback hosts
 * to protect against DNS rebinding, CSRF, and unauthorized external requests.
 */
export function isAllowedOrigin(req: http.IncomingMessage): boolean {
  const rawHost = (req.headers.host || '').toLowerCase();
  // Strip port from Host header before validation (handling IPv6 brackets and bare IPv6)
  let hostname = rawHost;
  if (rawHost.startsWith('[') && rawHost.includes(']')) {
    hostname = rawHost.slice(1, rawHost.indexOf(']'));
  } else if (rawHost.includes(':')) {
    const parts = rawHost.split(':');
    if (parts.length === 2) {
      hostname = parts[0];
    }
  }

  const origin = ((req.headers.origin || req.headers.referer || '') as string).toLowerCase();

  // 1. Validate Host header strictly against allowed loopback hosts or googleapis upstream
  const isHostAllowed =
    LOOPBACK_HOSTS.includes(hostname as typeof LOOPBACK_HOSTS[number]) ||
    hostname === 'googleapis.com' ||
    hostname.endsWith('.googleapis.com');
  if (!isHostAllowed) return false;

  // Verify socket remoteAddress if available: when socket is present and claims loopback Host,
  // ensure the actual remote IP is also loopback, preventing LAN spoofing.
  const remoteAddr = req.socket?.remoteAddress;
  if (remoteAddr) {
    const isLoopbackIp =
      remoteAddr === '127.0.0.1' ||
      remoteAddr === '::1' ||
      remoteAddr === '::ffff:127.0.0.1';
    if (LOOPBACK_HOSTS.includes(hostname as typeof LOOPBACK_HOSTS[number]) && !isLoopbackIp) {
      return false;
    }
  }

  // 2. Direct requests without Origin/Referer (Language Server Go, internal gRPC/HTTP)
  if (!origin) return true;

  // 3. Validate Origin/Referer header strictly against allowed loopback origins
  try {
    const parsed = new URL(origin);
    const h = parsed.hostname.toLowerCase();
    return LOOPBACK_HOSTS.includes(h as typeof LOOPBACK_HOSTS[number]);
  } catch {
    return false;
  }
}
