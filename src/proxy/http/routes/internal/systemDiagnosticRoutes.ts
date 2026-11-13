import * as http from 'http';
import { DEFAULT_REMOTE_HOST, DEFAULT_REMOTE_TOKEN } from '../../../../constants';
import { readBodyWithLimit } from '../bodyLimitGuard';
import {
  isRemoteVpsActive,
  remoteVpsHost,
  remoteVpsToken,
  remoteSessionsMap,
  updateRemoteVpsConfig,
  executeOnRemoteDaemon,
} from '../../../state/remote/remoteState';
import { snapshot as diagnosticsSnapshot, formatSnapshot as diagnosticsFormat } from '../../../state/observability/diagnostics';
import { metricsEnabled, getMetricsSnapshot, formatPrometheus, negotiateContentType } from '../metricsRoute';
import { loadCustomModels } from '../../../models/catalog/modelLoader';
import { generateModelPlaceholderId } from '../../../models/catalog/idGenerator';
import { getOpenBreaker } from '../../../resilience/circuit/circuitBreaker';

export function handleSystemDiagnosticRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): boolean {
  const url = req.url || '';

  // Remote VPS Agent State Sync (from IDE Webview or preload)
  if (url === '/api/remote/status' || url.startsWith('/api/remote/status?')) {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          active: isRemoteVpsActive,
          host: remoteVpsHost,
          hasToken: Boolean(remoteVpsToken || DEFAULT_REMOTE_TOKEN),
          remoteSessions: remoteSessionsMap,
        }),
      );
      return true;
    }
    if (req.method === 'POST') {
      readBodyWithLimit(req, res).then((buf) => {
        if (!buf) return;
        try {
          const b = JSON.parse(buf.toString('utf-8')) as {
            active?: boolean;
            host?: string;
            token?: string;
            remoteSessions?: Record<string, boolean>;
          };
          updateRemoteVpsConfig(b);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, active: isRemoteVpsActive, host: remoteVpsHost }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid payload', detail: (e as Error).message }));
        }
      });
      return true;
    }
    return true;
  }

  // Remote VPS Command Execution Bridge (POST /api/remote/cmd)
  if (url === '/api/remote/cmd' || url.startsWith('/api/remote/cmd?')) {
    if (req.method === 'POST') {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', async () => {
        try {
          const b = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as {
            command?: string;
            host?: string;
            token?: string;
            workspaceId?: string;
            sessionId?: string;
            timeoutMs?: number;
          };
          const targetHost = b.host || remoteVpsHost || DEFAULT_REMOTE_HOST;
          const rawToken = b.token ? String(b.token).trim() : '';
          const token = (rawToken && rawToken !== 'null' && rawToken !== 'undefined')
            ? rawToken
            : (remoteVpsToken || DEFAULT_REMOTE_TOKEN);
          const cmd = b.command || '';
          const result = await executeOnRemoteDaemon(targetHost, token, cmd, b.workspaceId, b.sessionId, b.timeoutMs);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: (e as Error).message }));
        }
      });
      return true;
    }
    return true;
  }

  // Diagnostics (__diag__)
  if (req.method === 'GET' && (url === '/__diag__' || url.startsWith('/__diag__?'))) {
    try {
      const accept = String(req.headers['accept'] ?? '');
      const snapshot = diagnosticsSnapshot();
      if (accept.includes('text/markdown') || accept.includes('text/plain')) {
        res.writeHead(200, {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(diagnosticsFormat(snapshot));
        return true;
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(snapshot, null, 2));
      return true;
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'failed to render diagnostics', detail: (e as Error).message }));
      return true;
    }
  }

  // Prometheus Metrics (__metrics__)
  if (req.method === 'GET' && (url === '/__metrics__' || url.startsWith('/__metrics__?'))) {
    if (!metricsEnabled()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('metrics disabled; set AG_METRICS_ENABLED=1 to enable\n');
      return true;
    }
    try {
      const snap = getMetricsSnapshot();
      const ct = negotiateContentType(String(req.headers['accept'] ?? ''));
      if (ct.includes('json')) {
        res.writeHead(200, { 'Content-Type': ct, 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(snap, null, 2));
        return true;
      }
      res.writeHead(200, { 'Content-Type': ct, 'Cache-Control': 'no-store' });
      res.end(formatPrometheus(snap));
      return true;
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'failed to render metrics', detail: (e as Error).message }));
      return true;
    }
  }

  // Per-model health status
  if (req.method === 'GET' && url === '/model-health') {
    const customModels = loadCustomModels();
    const statuses: Record<string, { status: string; errorType?: string; trippedAt?: number; failures?: number }> = {};
    for (const m of customModels) {
      const placeholderId = generateModelPlaceholderId(m);
      const breaker = getOpenBreaker(m);
      if (breaker) {
        statuses[placeholderId] = {
          status: 'error',
          errorType: breaker.errorType,
          trippedAt: breaker.trippedAt,
          failures: breaker.failures,
        };
      } else {
        statuses[placeholderId] = { status: 'healthy' };
      }
    }
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify({ models: statuses, timestamp: Date.now() }));
    return true;
  }

  return false;
}
