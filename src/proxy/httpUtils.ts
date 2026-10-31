import * as http from 'http';
import log from 'electron-log';

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
