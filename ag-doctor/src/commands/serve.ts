/**
 * Doctor-as-a-Service — HTTP server exposing ag-doctor over a REST API.
 *
 * Endpoints:
 *   GET  /                  HTML dashboard (status overview)
 *   GET  /health            Liveness probe (always 200 if server is up)
 *   GET  /ready             Readiness probe (200 only if last doctor run was OK)
 *   GET  /doctor            Full diagnostic (cached, with plugins)
 *   GET  /doctor/quick      Quick check (built-in only, no plugins)
 *   GET  /doctor/run        Force a fresh diagnostic run (no cache)
 *   GET  /plugins           List installed plugins
 *   GET  /history           Recent doctor history
 *   GET  /metrics           Prometheus-format metrics
 *   GET  /version           ag-doctor version + uptime
 *
 * Auth:
 *   If --token is provided, all endpoints (except /health) require
 *   `Authorization: Bearer <token>` header.
 *
 * Usage:
 *   ag-doctor serve --port 51000 --token secret123
 *   ag-doctor serve --port 51000 --host 0.0.0.0
 */
import http from 'http';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { URL } from 'url';
import type { CommandContext } from '../types';
import { checkEnvironment } from '../checks/environment';
import { checkInstallation } from '../checks/installation';
import { checkPatch } from '../checks/patch';
import { checkProxy } from '../checks/proxy';
import { checkModels } from '../checks/models';
import { checkEncryption } from '../checks/encryption';
import { checkConnectivity } from '../checks/connectivity';
import { checkMitm } from '../checks/mitm';
import { loadPlugins, runPlugin } from '../core/plugins';
import { listHistory } from '../core/history';
import { loadConfig } from '../core/config';
import { ok, info, warn, error, header, c } from '../cli/output';

export const DEFAULT_SERVE_PORT = 51000;
export const DEFAULT_SERVE_HOST = '127.0.0.1';

interface CachedResult {
  results: any[];
  summary: { ok: number; warn: number; error: number; info: number; code: number };
  ranAt: string;
  durationMs: number;
}

interface ServeOptions {
  port: number;
  host: string;
  token?: string;
  cacheTtlMs: number;
  quiet: boolean;
}

let cache: CachedResult | null = null;
let cacheConfigMtime = 0;
let serverInstance: http.Server | null = null;

async function runAllChecks(): Promise<any[]> {
  const builtIn = await Promise.all([
    Promise.resolve(checkEnvironment()),
    Promise.resolve(checkInstallation()),
    Promise.resolve(checkPatch()),
    checkProxy(),
    Promise.resolve(checkModels()),
    Promise.resolve(checkEncryption()),
    checkConnectivity(),
    checkMitm(),
  ]);

  const { plugins, errors } = loadPlugins();
  if (errors.length > 0) {
    for (const e of errors) {
      builtIn.push({
        id: `plugin-error-${e}`,
        title: `Plugin load error: ${e}`,
        status: 'warn',
        message: 'Plugin file failed validation',
        fixable: false,
        source: 'plugin',
      });
    }
  }

  const pluginResults = await Promise.all(plugins.map(runPlugin));
  return [...builtIn, ...pluginResults];
}

async function runQuickChecks(): Promise<any[]> {
  return Promise.all([
    Promise.resolve(checkEnvironment()),
    Promise.resolve(checkInstallation()),
    Promise.resolve(checkPatch()),
    Promise.resolve(checkModels()),
    Promise.resolve(checkEncryption()),
  ]);
}

function summarize(results: any[]): CachedResult['summary'] {
  const errors = results.filter((r) => r.status === 'error').length;
  const warns = results.filter((r) => r.status === 'warn').length;
  const okCount = results.filter((r) => r.status === 'ok').length;
  const infoCount = results.filter((r) => r.status === 'info').length;
  return {
    ok: okCount,
    warn: warns,
    error: errors,
    info: infoCount,
    code: errors > 0 ? 2 : warns > 0 ? 1 : 0,
  };
}

async function getCachedDoctor(opts: ServeOptions, force = false): Promise<CachedResult> {
  const now = Date.now();
  const configMtime = getConfigMtime();
  if (!force && cache && now - new Date(cache.ranAt).getTime() < opts.cacheTtlMs && cacheConfigMtime === configMtime) {
    return cache;
  }
  const start = Date.now();
  const results = await runAllChecks();
  const summary = summarize(results);
  cache = {
    results,
    summary,
    ranAt: new Date().toISOString(),
    durationMs: Date.now() - start,
  };
  cacheConfigMtime = configMtime;
  return cache;
}

function getConfigMtime(): number {
  try {
    const stat = fs.statSync(getConfigPath());
    return stat.mtimeMs;
  } catch {
    return 0;
  }
}

function getConfigPath(): string {
  try {
    return require('path').join(require('os').homedir(), '.gemini', 'antigravity', 'config.json');
  } catch {
    return '';
  }
}

function renderPrometheusMetrics(c: CachedResult, uptimeSec: number): string {
  const lines: string[] = [];
  lines.push('# HELP ag_doctor_up 1 if the server is running');
  lines.push('# TYPE ag_doctor_up gauge');
  lines.push('ag_doctor_up 1');
  lines.push('');
  lines.push('# HELP ag_doctor_uptime_seconds Server uptime in seconds');
  lines.push('# TYPE ag_doctor_uptime_seconds counter');
  lines.push(`ag_doctor_uptime_seconds ${uptimeSec}`);
  lines.push('');
  lines.push('# HELP ag_doctor_last_run_timestamp_seconds Unix timestamp of last doctor run');
  lines.push('# TYPE ag_doctor_last_run_timestamp_seconds gauge');
  lines.push(`ag_doctor_last_run_timestamp_seconds ${Math.floor(new Date(c.ranAt).getTime() / 1000)}`);
  lines.push('');
  lines.push('# HELP ag_doctor_checks_total Total checks by status');
  lines.push('# TYPE ag_doctor_checks_total gauge');
  lines.push(`ag_doctor_checks_total{status="ok"} ${c.summary.ok}`);
  lines.push(`ag_doctor_checks_total{status="warn"} ${c.summary.warn}`);
  lines.push(`ag_doctor_checks_total{status="error"} ${c.summary.error}`);
  lines.push(`ag_doctor_checks_total{status="info"} ${c.summary.info}`);
  lines.push('');
  lines.push('# HELP ag_doctor_check_status Individual check status (1=ok, 2=warn, 3=error, 0=info)');
  lines.push('# TYPE ag_doctor_check_status gauge');
  const statusMap: Record<string, number> = { ok: 1, warn: 2, error: 3, info: 0 };
  for (const r of c.results) {
    const safeId = (r.id || 'unknown').replace(/[^a-zA-Z0-9_]/g, '_');
    const title = (r.title || '').replace(/"/g, '\\"');
    const status = typeof r.status === 'string' ? r.status : 'info';
    lines.push(`ag_doctor_check_status{id="${safeId}",title="${title}"} ${statusMap[status] ?? 0}`);
  }
  lines.push('');
  lines.push('# HELP ag_doctor_last_duration_ms Duration of the last doctor run in ms');
  lines.push('# TYPE ag_doctor_last_duration_ms gauge');
  lines.push(`ag_doctor_last_duration_ms ${c.durationMs}`);
  return lines.join('\n') + '\n';
}

function renderDashboardHtml(c: CachedResult | null, port: number, host: string, hasToken: boolean): string {
  const statusColor = !c ? '#888' : c.summary.error > 0 ? '#ef4444' : c.summary.warn > 0 ? '#f59e0b' : '#22c55e';
  const statusText = !c ? 'no data' : c.summary.error > 0 ? 'ERRORS' : c.summary.warn > 0 ? 'WARNINGS' : 'OK';
  const ranAt = c ? new Date(c.ranAt).toLocaleString() : 'never';

  const checksHtml = !c
    ? '<tr><td colspan="3" style="text-align:center;color:#888;padding:2rem">No run yet. Hit /doctor/run to trigger one.</td></tr>'
    : c.results
        .map((r: any) => {
          const icon = r.status === 'ok' ? '✓' : r.status === 'warn' ? '⚠' : r.status === 'error' ? '✗' : 'ℹ';
          const color = r.status === 'ok' ? '#22c55e' : r.status === 'warn' ? '#f59e0b' : r.status === 'error' ? '#ef4444' : '#3b82f6';
          return `<tr><td style="color:${color};font-weight:bold">${icon}</td><td>${escapeHtml(r.title)}</td><td>${escapeHtml(r.message)}</td></tr>`;
        })
        .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>ag-doctor — service</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; padding: 2rem; line-height: 1.5; }
  h1 { font-size: 1.75rem; margin-bottom: 0.5rem; }
  h2 { font-size: 1.25rem; margin: 2rem 0 0.75rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; }
  .meta { color: #94a3b8; font-size: 0.9rem; margin-bottom: 1.5rem; }
  .status { display: inline-block; padding: 0.4rem 1rem; border-radius: 6px; background: ${statusColor}; color: #0f172a; font-weight: 700; font-size: 1rem; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 1rem; margin: 1.5rem 0; }
  .card { background: #1e293b; padding: 1.25rem; border-radius: 8px; border: 1px solid #334155; }
  .card-label { color: #94a3b8; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; }
  .card-value { font-size: 2rem; font-weight: 700; margin-top: 0.25rem; }
  .card.ok .card-value { color: #22c55e; }
  .card.warn .card-value { color: #f59e0b; }
  .card.err .card-value { color: #ef4444; }
  table { width: 100%; border-collapse: collapse; background: #1e293b; border-radius: 8px; overflow: hidden; }
  th, td { padding: 0.75rem 1rem; text-align: left; border-bottom: 1px solid #334155; }
  th { background: #0f172a; color: #94a3b8; font-weight: 600; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; }
  tr:last-child td { border-bottom: none; }
  .endpoints { background: #1e293b; padding: 1.25rem; border-radius: 8px; border: 1px solid #334155; }
  .endpoint { display: flex; justify-content: space-between; padding: 0.4rem 0; font-family: ui-monospace, 'Cascadia Code', 'Source Code Pro', monospace; font-size: 0.9rem; }
  .method { color: #22c55e; font-weight: 600; width: 60px; }
  .path { color: #e2e8f0; }
  .desc { color: #94a3b8; font-size: 0.85rem; }
  code { background: #0f172a; padding: 0.15rem 0.4rem; border-radius: 4px; font-size: 0.85rem; }
  .refresh-btn { background: #3b82f6; color: white; border: none; padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer; font-size: 0.9rem; margin-left: 1rem; }
  .refresh-btn:hover { background: #2563eb; }
</style>
</head>
<body>
  <h1>ag-doctor <span style="color:#64748b;font-size:1rem;font-weight:400">— service</span></h1>
  <div class="meta">
    Listening on <code>${escapeHtml(host)}:${port}</code> ·
    Last run: <code>${escapeHtml(ranAt)}</code> ·
    ${hasToken ? '<code>auth: token required</code>' : '<code>auth: open</code>'}
    <button class="refresh-btn" onclick="location.reload()">Refresh</button>
  </div>

  <div><span class="status">${statusText}</span></div>

  <div class="cards">
    <div class="card ok"><div class="card-label">OK</div><div class="card-value">${c?.summary.ok ?? 0}</div></div>
    <div class="card warn"><div class="card-label">Warnings</div><div class="card-value">${c?.summary.warn ?? 0}</div></div>
    <div class="card err"><div class="card-label">Errors</div><div class="card-value">${c?.summary.error ?? 0}</div></div>
    <div class="card"><div class="card-label">Info</div><div class="card-value">${c?.summary.info ?? 0}</div></div>
  </div>

  <h2>Checks</h2>
  <table>
    <thead><tr><th style="width:40px"></th><th>Title</th><th>Message</th></tr></thead>
    <tbody>${checksHtml}</tbody>
  </table>

  <h2>Endpoints</h2>
  <div class="endpoints">
    <div class="endpoint"><span class="method">GET</span><span class="path">/health</span><span class="desc">Liveness probe</span></div>
    <div class="endpoint"><span class="method">GET</span><span class="path">/ready</span><span class="desc">Readiness probe</span></div>
    <div class="endpoint"><span class="method">GET</span><span class="path">/doctor</span><span class="desc">Full diagnostic (cached)</span></div>
    <div class="endpoint"><span class="method">GET</span><span class="path">/doctor/quick</span><span class="desc">Quick check (no plugins)</span></div>
    <div class="endpoint"><span class="method">GET</span><span class="path">/doctor/run</span><span class="desc">Force fresh run</span></div>
    <div class="endpoint"><span class="method">GET</span><span class="path">/plugins</span><span class="desc">List installed plugins</span></div>
    <div class="endpoint"><span class="method">GET</span><span class="path">/history</span><span class="desc">Recent doctor runs</span></div>
    <div class="endpoint"><span class="method">GET</span><span class="path">/metrics</span><span class="desc">Prometheus metrics</span></div>
    <div class="endpoint"><span class="method">GET</span><span class="path">/version</span><span class="desc">Version + uptime</span></div>
  </div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function checkAuth(req: http.IncomingMessage, token: string | undefined): boolean {
  if (!token) return true;
  const auth = req.headers['authorization'];
  if (!auth) return false;
  const expected = `Bearer ${token}`;
  // Constant-time comparison
  if (auth.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < auth.length; i++) {
    diff |= auth.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Returns true if the response has already finished or headers were sent.
 * All send helpers must check this before touching `res` to avoid
 * `ERR_HTTP_HEADERS_SENT` when an async handler races with itself
 * (e.g. an error fires after the response was already ended).
 */
function isResponseDone(res: http.ServerResponse): boolean {
  return res.headersSent || res.writableEnded || res.destroyed;
}

function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  if (isResponseDone(res)) return;
  const body = JSON.stringify(data, null, 2);
  try {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(body);
  } catch {
    // Socket may have been closed by the peer mid-write — swallow.
  }
}

function sendText(res: http.ServerResponse, status: number, contentType: string, body: string): void {
  if (isResponseDone(res)) return;
  try {
    res.writeHead(status, {
      'Content-Type': contentType,
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    // Socket may have been closed by the peer mid-write — swallow.
  }
}

function sendError(res: http.ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: message, status });
}

function parsePort(value: unknown): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return n;
}

export async function runServe(ctx: CommandContext, args: string[]): Promise<number> {
  const opts: ServeOptions = {
    port: DEFAULT_SERVE_PORT,
    host: DEFAULT_SERVE_HOST,
    token: undefined,
    cacheTtlMs: 30_000,
    quiet: false,
  };

  // Parse args
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--port' || a === '-p') {
      opts.port = parsePort(args[++i]);
    } else if (a === '--host' || a === '-H') {
      opts.host = String(args[++i]);
    } else if (a === '--token' || a === '-t') {
      opts.token = String(args[++i]);
    } else if (a === '--cache-ttl') {
      opts.cacheTtlMs = Number(args[++i]) || 30_000;
    } else if (a === '--quiet' || a === '-q') {
      opts.quiet = true;
    } else if (a === '--help' || a === '-h') {
      console.log(`ag-doctor serve — start Doctor-as-a-Service HTTP server

Usage:
  ag-doctor serve [--port <n>] [--host <h>] [--token <t>] [--cache-ttl <ms>]

Options:
  --port, -p <n>       Port to listen on (default: ${DEFAULT_SERVE_PORT})
  --host, -H <h>       Host to bind to (default: ${DEFAULT_SERVE_HOST}, use 0.0.0.0 for all)
  --token, -t <t>      Bearer token required for all endpoints except /health
  --cache-ttl <ms>     Cache TTL for /doctor (default: 30000)
  --quiet, -q          Suppress request logs
  --help, -h           Show this help

Endpoints:
  GET /                HTML dashboard
  GET /health          Liveness probe
  GET /ready           Readiness probe
  GET /doctor          Full diagnostic (cached)
  GET /doctor/quick    Quick check (no plugins)
  GET /doctor/run      Force fresh run
  GET /plugins         List installed plugins
  GET /history         Recent runs
  GET /metrics         Prometheus metrics
  GET /version         Version + uptime
`);
      return 0;
    }
  }

  if (!ctx.json) {
    header('ag-doctor — Doctor-as-a-Service');
    info(`Binding to http://${opts.host}:${opts.port}`);
    if (opts.token) info('Auth: Bearer token required');
    else warn('Auth: open (no token) — set --token for production use');
    info(`Cache TTL: ${opts.cacheTtlMs}ms`);
  }

  const startedAt = Date.now();
  const pkg = require('../../package.json') as { version: string };

  const server = http.createServer(async (req, res) => {
    // Prevent unhandled socket / request errors from crashing the process.
    // Without these, an aborted client (e.g. browser closes the connection
    // mid-response) bubbles up as an `uncaughtException` and kills the server.
    req.on('error', () => {
      if (!isResponseDone(res)) {
        try { res.destroy(); } catch { /* ignore */ }
      }
    });
    res.on('error', () => {
      // EPIPE / ECONNRESET — nothing useful we can do, just stop writing.
    });

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = url.pathname;

    // Log request (unless quiet)
    if (!opts.quiet) {
      const ts = new Date().toISOString().split('T')[1].slice(0, 12);
      console.log(`[${ts}] ${req.method} ${pathname}`);
    }

    try {
      // /health is always open (for k8s liveness probes)
      if (pathname === '/health') {
        sendJson(res, 200, { status: 'ok', uptime: Math.floor((Date.now() - startedAt) / 1000) });
        return;
      }

      // All other endpoints require auth if token is set
      if (!checkAuth(req, opts.token)) {
        sendJson(res, 401, { error: 'unauthorized' });
        if (!res.headersSent) {
          res.setHeader('WWW-Authenticate', 'Bearer realm="ag-doctor"');
        }
        return;
      }

      if (pathname === '/') {
        const c = await getCachedDoctor(opts);
        sendText(res, 200, 'text/html; charset=utf-8', renderDashboardHtml(c, opts.port, opts.host, !!opts.token));
        return;
      }

      if (pathname === '/ready') {
        const c = await getCachedDoctor(opts);
        if (c.summary.error > 0) {
          sendJson(res, 503, { status: 'not_ready', errors: c.summary.error, ranAt: c.ranAt });
        } else {
          sendJson(res, 200, { status: 'ready', ranAt: c.ranAt });
        }
        return;
      }

      if (pathname === '/doctor') {
        const c = await getCachedDoctor(opts);
        sendJson(res, 200, c);
        return;
      }

      if (pathname === '/doctor/quick') {
        const start = Date.now();
        const results = await runQuickChecks();
        const summary = summarize(results);
        sendJson(res, 200, {
          results,
          summary,
          ranAt: new Date().toISOString(),
          durationMs: Date.now() - start,
        });
        return;
      }

      if (pathname === '/doctor/run') {
        const c = await getCachedDoctor(opts, true);
        sendJson(res, 200, c);
        return;
      }

      if (pathname === '/plugins') {
        const { plugins, errors } = loadPlugins();
        sendJson(res, 200, { plugins, errors, count: plugins.length });
        return;
      }

      if (pathname === '/history') {
        const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 100);
        const all = listHistory();
        sendJson(res, 200, { entries: all.slice(0, limit), total: all.length });
        return;
      }

      if (pathname === '/metrics') {
        const c = await getCachedDoctor(opts);
        const uptime = Math.floor((Date.now() - startedAt) / 1000);
        sendText(res, 200, 'text/plain; version=0.0.4; charset=utf-8', renderPrometheusMetrics(c, uptime));
        return;
      }

      if (pathname === '/version') {
        sendJson(res, 200, {
          name: 'ag-doctor',
          version: pkg.version,
          node: process.version,
          platform: process.platform,
          arch: process.arch,
          hostname: os.hostname(),
          uptime: Math.floor((Date.now() - startedAt) / 1000),
          startedAt: new Date(startedAt).toISOString(),
        });
        return;
      }

      sendError(res, 404, `Not found: ${pathname}`);
    } catch (e) {
      error(`Handler error: ${(e as Error).message}`);
      // Guard against double-send: if the response was already ended by a
      // successful send earlier in the handler (or by the client aborting),
      // attempting to write again throws ERR_HTTP_HEADERS_SENT.
      if (!isResponseDone(res)) {
        sendError(res, 500, (e as Error).message);
      }
    }
  });

  serverInstance = server;

  // Pre-warm cache
  if (!ctx.json) info('Pre-warming doctor cache…');
  try {
    await getCachedDoctor(opts, true);
    if (!ctx.json) ok('Cache ready.');
  } catch (e) {
    if (!ctx.json) warn(`Pre-warm failed: ${(e as Error).message}`);
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, opts.host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  if (!ctx.json) {
    ok(`Server listening on http://${opts.host}:${opts.port}`);
    info('Press Ctrl+C to stop.');
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    if (!ctx.json) info(`\nReceived ${signal}, shutting down…`);
    server.close(() => {
      if (!ctx.json) ok('Server stopped.');
      process.exit(0);
    });
    // Force exit after 5s
    setTimeout(() => process.exit(0), 5000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Keep alive
  return new Promise<number>(() => {
    /* never resolves */
  });
}
