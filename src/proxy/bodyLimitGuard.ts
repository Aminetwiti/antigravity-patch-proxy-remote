/**
 * Utility for reading incoming HTTP request bodies with strict size boundary enforcement.
 * Protects against unbounded memory consumption and Out-Of-Memory (OOM) denial-of-service attacks.
 */

import type * as http from 'http';

export const DEFAULT_AUX_MAX_BODY_BYTES = 5 * 1024 * 1024; // 5 MB default for config & admin routes

/**
 * Reads request body safely up to maxBytes.
 * If exceeded, immediately responds with HTTP 413 (Payload Too Large) and resolves to null.
 */
export function readBodyWithLimit(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  maxBytes: number = DEFAULT_AUX_MAX_BODY_BYTES,
): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let aborted = false;

    const onData = (chunk: Buffer) => {
      if (aborted) return;
      total += chunk.length;
      if (total > maxBytes) {
        aborted = true;
        req.removeListener('data', onData);
        req.removeListener('end', onEnd);
        try { req.resume(); } catch (_) {}
        if (!res.headersSent && !res.writableEnded) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Payload too large. Maximum allowed size is ${maxBytes} bytes.` }));
        }
        resolve(null);
        return;
      }
      chunks.push(chunk);
    };

    const onEnd = () => {
      if (aborted) return;
      resolve(Buffer.concat(chunks));
    };

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', () => {
      if (!aborted) resolve(null);
    });
  });
}
