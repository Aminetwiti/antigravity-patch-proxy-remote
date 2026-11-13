import * as http from 'http';
import log from 'electron-log';
import { DEFAULT_MAX_BODY_SIZE } from '../../../../constants';
import { safeWriteHead, safeEnd, isAllowedOrigin } from '../httpUtils';
import { handleInternalApiRoute } from '../../routes/internalApiRoutes';
import { getProxyPort } from '../serverLifecycle';
import {
  modelToolCallIds,
  modelReasoningContent,
  activeStreamContexts,
  translatedToolCalls,
} from '../../../core/shared';

export function runPreflightGuards(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): boolean {
  // Ultra-low latency: Disable Nagle algorithm on loopback sockets immediately
  if (req.socket && typeof req.socket.setNoDelay === 'function') {
    req.socket.setNoDelay(true);
  }
  if (res.socket && typeof res.socket.setNoDelay === 'function') {
    res.socket.setNoDelay(true);
  }

  // CSRF / Origin Guard: Reject unauthorized external origins attempting local proxy abuse
  if (!isAllowedOrigin(req)) {
    const host = (req.headers.host || '').toLowerCase();
    const isSystemCertNoise =
      host.includes('digicert.com') ||
      host.includes('windowsupdate.com') ||
      host.includes('symcb.com') ||
      host.includes('verisign.com') ||
      host.includes('pki.goog') ||
      host.includes('globalsign.com') ||
      host.includes('sectigo.com');
    if (isSystemCertNoise) {
      log.debug(`[Proxy] Ignored background OS certificate/CRL check: host=${req.headers.host}`);
    } else {
      log.warn(`[Proxy] Blocked request with unauthorized Host/Origin: host=${req.headers.host} origin=${req.headers.origin}`);
    }
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Forbidden: Unauthorized origin' } }));
    return true;
  }

  // Health check
  if (req.method === 'GET' && (req.url === '/health' || req.url === '/healthz')) {
    log.debug(`[Proxy] /health hit from ${req.socket.remoteAddress || 'unknown'}`);
    const memUsage = process.memoryUsage();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'ok',
        uptime: process.uptime(),
        port: getProxyPort(),
        pid: process.pid,
        memory: {
          rssMB: Math.round(memUsage.rss / 1024 / 1024),
          heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
          heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
        },
        state: {
          activeStreamContexts: activeStreamContexts.size,
          modelToolCallIds: modelToolCallIds.size,
          translatedToolCalls: translatedToolCalls.size,
          modelReasoningContent: modelReasoningContent.size,
        },
        timestamp: new Date().toISOString(),
      }),
    );
    return true;
  }

  if (handleInternalApiRoute(req, res)) {
    return true;
  }

  // CORS Preflight handler for browser-initiated requests
  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Max-Age': '86400',
    });
    res.end();
    return true;
  }

  return false;
}
