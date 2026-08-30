// ─── Constants ─────────────────────────────────────────────────────────────

import * as http from 'http';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import log from 'electron-log';
import { createLogger } from './logger';

function traceLog(...args: unknown[]): void {
  // ponytail: keeps the 'app' import (and thus the electron require) out of
  // proxy.ts's module graph when tracing is disabled; upgrade path: replace
  // with a real log-level switch if verbose tracing is ever needed.
  if (process.env.AG_PROXY_TRACE === '1') {
    // eslint-disable-next-line no-console
    console.log('[proxy-trace]', ...args);
  }
}
import { startTimer as metricTimer, inc as metricInc, observe as metricObserve } from './metrics';
import { randomBytes } from 'crypto';

const proxyLog = createLogger('Proxy');

/** 16-char hex request id used for tracing. Cheap, sortable by time. */
function newTraceId(): string {
  return randomBytes(8).toString('hex');
}

let server: http.Server | null = null;
let proxyPort = 0;

import {
  GOOGLE_PROXY_TIMEOUT_MS,
  FILE_DOWNLOAD_TIMEOUT_MS,
  STREAM_IDLE_TIMEOUT_MS,
  DEFAULT_PROXY_PORT,
  ACTIVE_PORT_FILE,
} from './constants';

// ─── Types ────────────────────────────────────────────────────────────────

import type { CustomModel, GeminiRequestBody, GeminiCandidate, CloudCodeResponse } from './proxy/types';
export type { CustomModel, GeminiRequestBody, GeminiCandidate, CloudCodeResponse };

// ─── Module Imports ───────────────────────────────────────────────────────

// Shared cross-turn state
import {
  modelToolCallIds,
  modelReasoningContent,
  activeStreamContexts,
  translatedToolCalls,
  stateTimestamps,
  touchStateTimestamp,
  getSessionModelKey,
  startCleanupInterval,
  stopCleanupInterval,
} from './proxy/shared';


// Provider translator registry (auto-discovers translators from proxy/translators/)
import * as registry from './proxy/registry';

// Protobuf injection (extracted from proxy.ts)
import { injectCustomModelsIntoResponse } from './proxy/protoInjector';

// Custom model loading (extracted from proxy.ts)
import { loadCustomModels, getCustomModelsPath } from './proxy/modelLoader';
import { invalidateModelStoreCache } from './services/modelStore';
import { invalidateHealthCache } from './proxy/modelHealthChecker';
import { recordProviderUsage } from './customModelStore';
import { classifyError, ErrorDiagnostic, type ErrorType } from './proxy/errorClassifier';
import { shouldRetryStatus, computeRetryDelay, type RetryStrategy } from './proxy/retryStrategy';
import { getOpenBreaker, recordFailure, recordSuccess } from './proxy/circuitBreaker';
import { IdleTimeoutGuard } from './proxy/idleTimeout';
import { resolveClientForUrl, disposeAll as disposeAgentPool } from './proxy/agentPool';
import { EmptyStreamGuard } from './proxy/emptyStream';
import { getRetryBudget, RETRY_BUDGET_BASE } from './proxy/retryBudget';
import { snapshot as diagnosticsSnapshot, formatSnapshot as diagnosticsFormat } from './proxy/diagnostics';
import {
  flush as flushPersisted,
  gather as gatherPersisted,
  loadOrInit as loadPersisted,
  fromFile as fromPersistedFile,
  applyBudgetPatch,
  applyBreakerPatch,
  stateFilePath,
  MIN_FLUSH_INTERVAL_MS,
} from './proxy/persistedState';
import { metricsEnabled, getMetricsSnapshot, formatPrometheus, negotiateContentType } from './proxy/metricsRoute';
import { CIRCUIT_BREAKER_RESET_MS } from './proxy/circuitBreaker';

function generateGracefulMarkdown(diagnostic: ErrorDiagnostic): string {
  let md = `🚨 **${diagnostic.title}**\n\n${diagnostic.message}\n\n`;
  if (diagnostic.suggestions && diagnostic.suggestions.length > 0) {
    md += `**Suggested Actions:**\n`;
    diagnostic.suggestions.forEach(s => md += `- ${s}\n`);
  }
  if (diagnostic.actionUrl) {
    md += `\n🔗 [Manage Billing & Credits](${diagnostic.actionUrl})`;
  }
  md += `\n\n<span class="ag-system-error-marker" data-type="${diagnostic.errorType}" style="display:none;"></span>`;
  return md;
}

// URL construction for custom model requests (extracted from proxy.ts)
import {
  resolveProvider,
  resolveCustomModelUrl,
  resolveMaxRetries,
  resolveRequestTimeout,
  getBaseModelId,
} from './proxy/urlBuilder';


// ID generation is now strictly in idGenerator.ts
import { generateModelPlaceholderId, toSlug } from './proxy/idGenerator';
import { expandModelsWithEffort } from './proxy/effortExpander';

// DNS resolution bypasses the poisoned hosts file (extracted from proxy.ts)
import { resolveGoogleIp } from './proxy/dnsResolver';

// Smart model routing and rate-limit tracking
import { markProviderRateLimited } from './proxy/modelRouter';
import { trimContextPayload } from './proxy/contextTrimmer';
import { checkAllModelsHealth } from './proxy/modelHealthChecker';
import { recordRecentModel, restoreRecentModels } from './proxy/recentModelsStore';

// MCP relay bridge (mobile companion): lists MCP servers configured on the
// desktop session and forwards tool calls to the local MCP runtime.
import { mcpListServers, mcpCallTool } from './proxy/mcpRelay';

// ─── Proxy Error Emitter ──────────────────────────────────────────────────
// Lets the main process fan-out notable diagnostics to the renderer without
// proxy.ts depending on Electron directly. ipcHandlers.ts calls
// setProxyErrorEmitter(...) once on boot. Default is a no-op so unit tests
// don't need a stub.
export type ProxyErrorPayload = {
  traceId: string;
  provider: string;
  status?: number;
  errorType: ErrorType;
  rawError: string;
  title: string;
  message: string;
  suggestions: string[];
  actionUrl?: string;
};

let proxyErrorEmitter: ((p: ProxyErrorPayload) => void) | null = null;
export function setProxyErrorEmitter(fn: ((p: ProxyErrorPayload) => void) | null): void {
  proxyErrorEmitter = fn;
}

function emitProxyError(p: ProxyErrorPayload): void {
  // 1) In-process fan-out (Electron main → renderer via setProxyErrorEmitter).
  if (proxyErrorEmitter) proxyErrorEmitter(p);
  // 2) Mirror to stderr as a single-line JSON payload so the proxy child
  //    spawned by ag-doctor-ui's ProxyManager reaches the same handler.
  //    Pure JSON, no whitespace, so a `line.startsWith('{')` filter in the
  //    consumer can route the structured payload while leaving human logs
  //    alone. Safe to ignore if the host doesn't watch stderr.
  try {
    process.stderr.write(JSON.stringify(p) + '\n');
  } catch {
    // stdio might be closed in unit tests — swallow.
  }
}

// Build a payload from a raw error triple + provider. Used at the 6 sites
// in proxy.ts where classifyError() is called and the diagnostic is
// considered "notable" (i.e. surfaced to the user via the response). We
// keep this single function so the emission contract is identical across
// all call sites.
export function buildProxyErrorPayload(
  traceId: string,
  status: number | undefined,
  bodyOrErr: unknown,
  provider: string | undefined,
  fallbackMessage?: string,
): ProxyErrorPayload {
  const rawText = typeof bodyOrErr === 'string'
    ? bodyOrErr
    : bodyOrErr instanceof Error
      ? bodyOrErr.message
      : fallbackMessage ?? '';
  const diagnostic = classifyError(status, bodyOrErr, typeof bodyOrErr === 'string' ? bodyOrErr : undefined, provider);
  return {
    traceId,
    provider: provider ?? 'unknown',
    status,
    errorType: diagnostic.errorType,
    rawError: rawText,
    title: diagnostic.title,
    message: diagnostic.message,
    suggestions: diagnostic.suggestions ?? [],
    actionUrl: diagnostic.actionUrl,
  };
}

// ─── Safe Response Helpers ─────────────────────────────────────────────────
import { safeWriteHead, safeEnd } from './proxy/httpUtils';
import { mergeModels, getMappedCustomModels, getCustomModelsList } from './proxy/modelInjector';

// ─── Model Helpers ────────────────────────────────────────────────────────

// generateModelPlaceholderId and toSlug are now in ./proxy/idGenerator.ts (re-exported above)

// ─── Google Proxy ─────────────────────────────────────────────────────────

async function proxyToGoogle(req: http.IncomingMessage, res: http.ServerResponse, reqBody: Buffer): Promise<void> {
  const traceId = newTraceId();
  const isCloudCodeUrl = req.url!.includes('v1internal') || req.url!.includes('daily-cloudcode');
  const targetHost = isCloudCodeUrl ? 'daily-cloudcode-pa.googleapis.com' : 'generativelanguage.googleapis.com';
  const targetUrl = `https://${targetHost}`;
  const parsedUrl = new URL(req.url!, targetUrl);
  const endTimer = metricTimer('proxy_request_ms', { upstream: targetHost });
  const traceLog = proxyLog;
  proxyLog.debug('req', traceId, req.method, req.url, '→', targetHost);

  try {
    const realIp = await resolveGoogleIp(targetHost);
    parsedUrl.hostname = realIp;
  } catch (e) {
    metricInc('proxy_errors_total', { upstream: targetHost, stage: 'dns', trace_id: traceId });
    const ms = endTimer();
    traceLog.error('DNS resolution failed for', targetHost, 'traceId=', traceId, '(in', ms, 'ms)');
    log.error(`[Proxy] Could not resolve upstream IP for ${targetHost}:`, e);
    if (safeWriteHead(res, 500, { 'Content-Type': 'application/json' })) {
      safeEnd(res, JSON.stringify({ error: { message: 'DNS resolution failed for ' + targetHost, traceId } }));
    }
    return;
  }

  const headers: Record<string, string | string[] | undefined> = {
    ...(req.headers as Record<string, string | string[] | undefined>),
  };
  headers['host'] = targetHost;
  delete headers['connection'];
  delete headers['keep-alive'];

  const isGeneration = req.url!.includes('generateContent') || req.url!.includes('streamGenerateContent');
  const shouldBufferAndModify = isCloudCodeUrl && !isGeneration;

  if (shouldBufferAndModify) {
    delete headers['accept-encoding'];
  }

  const options: https.RequestOptions = {
    method: req.method,
    headers: headers as Record<string, string>,
    servername: targetHost,
  };

  // Guard flag to prevent ERR_HTTP_HEADERS_SENT when timeout and response race
  const safeHead = (status: number, headers?: Record<string, string>): boolean =>
    safeWriteHead(res, status, headers);

  const proxyReq = https.request(parsedUrl, options, (proxyRes) => {
    proxyReq.setTimeout(GOOGLE_PROXY_TIMEOUT_MS, () => {
      log.error(`[Proxy] Google proxy request timed out after ${GOOGLE_PROXY_TIMEOUT_MS / 1000}s`);
      proxyReq.destroy();
      if (safeHead(504, { 'Content-Type': 'application/json' })) {
        safeEnd(res, JSON.stringify({ error: { message: 'Google API request timed out' } }));
      }
    });

    if (shouldBufferAndModify) {
      const responseChunks: Buffer[] = [];
      proxyRes.on('data', (chunk) => responseChunks.push(chunk));
      proxyRes.on('end', () => {
        if (res.headersSent || res.writableEnded) {
          log.debug('[Proxy] Skipping buffered modify: response already terminated');
          return;
        }
        const fullResBody = Buffer.concat(responseChunks);
        let text: string;
        const encoding = proxyRes.headers['content-encoding'];
        if (encoding === 'gzip') {
          try {
            const zlib = require('zlib');
            text = zlib.gunzipSync(fullResBody).toString('utf-8');
          } catch (e) {
            log.error('[Proxy] gunzipSync failed:', e);
            if (safeHead(502, { 'Content-Type': 'application/json' })) {
              safeEnd(res, JSON.stringify({ error: { message: `Failed to decompress upstream response: ${(e as Error).message}` } }));
            }
            return;
          }
        } else {
          text = fullResBody.toString('utf-8');
        }

        log.info(
          `[Proxy] Response for ${req.url} (status: ${proxyRes.statusCode}, encoding: ${encoding}, length: ${text.length})`,
        );
        // P0-3: Response body content is NOT logged to disk. Only metadata.

        const proxyHost = req.headers.host || 'localhost';
        const proxyProto = proxyHost.endsWith('.googleapis.com') ? 'https:' : 'http:';
        text = text.replace(/https:(\/\/)daily-cloudcode-pa\.googleapis\.com/g, `${proxyProto}$1${proxyHost}`);
        text = text.replace(/https:(\/\/)cloudcode-pa\.googleapis\.com/g, `${proxyProto}$1${proxyHost}`);
        text = text.replace(/https:(\/\/)generativelanguage\.googleapis\.com/g, `${proxyProto}$1${proxyHost}`);

        const modifiedHeaders: Record<string, string | string[] | undefined> = { ...proxyRes.headers };
        delete modifiedHeaders['content-encoding'];
        delete modifiedHeaders['transfer-encoding'];

        const modifiedBuffer = Buffer.from(text, 'utf-8');
        modifiedHeaders['content-length'] = String(modifiedBuffer.length);

        if (safeWriteHead(res, proxyRes.statusCode || 200, modifiedHeaders as Record<string, string>)) {
          safeEnd(res, modifiedBuffer);
        }
      });
    } else {
      if (safeHead(proxyRes.statusCode || 200, proxyRes.headers as Record<string, string>)) {
        proxyRes.pipe(res);
      }
    }
  });

  proxyReq.on('error', (err) => {
    metricInc('proxy_errors_total', { upstream: targetHost, stage: 'forward', trace_id: traceId });
    const ms = endTimer();
    traceLog.error('Google forwarding error traceId=', traceId, 'after', ms, 'ms:', err.message);
    log.error('[Proxy] Google Forwarding Error:', err);
    if (safeWriteHead(res, 500, { 'Content-Type': 'application/json' })) {
      safeEnd(res, JSON.stringify({ error: { message: 'Proxy forwarding failed: ' + err.message, traceId } }));
    }
  });

  proxyReq.on('close', () => {
    const ms = endTimer();
    metricObserve('proxy_upstream_ms', ms, { upstream: targetHost, trace_id: traceId });
    traceLog.debug('Upstream request closed traceId=', traceId, 'after', ms, 'ms');
  });

  if (reqBody) {
    proxyReq.write(reqBody);
  }
  proxyReq.end();
}

// ─── File Data Resolver ────────────────────────────────────────────────────

async function resolveFileData(body: GeminiRequestBody, reqHeaders: Record<string, string | string[] | undefined>): Promise<void> {
  const contents = body.contents;
  if (!contents) return;
  const authHeader = (reqHeaders['authorization'] || reqHeaders['Authorization'] || '') as string;
  for (const item of contents) {
    if (!item.parts) continue;
    for (let i = 0; i < item.parts.length; i++) {
      const p = item.parts[i] as Record<string, unknown>;
      const fd = p.fileData as { mimeType?: string; fileUri?: string } | undefined;
      if (!fd?.fileUri) continue;
      // Keep image fileData intact so provider translators can map it natively.
      if (fd.mimeType?.startsWith('image/')) continue;
      try {
        const uri = fd.fileUri; let fileContent = '';
        if (uri.startsWith('file://')) {
          const fp = uri.replace('file://', '').replace(/\//g, path.sep);
          if (fs.existsSync(fp)) fileContent = fs.readFileSync(fp, 'utf-8');
        } else if (authHeader && uri.startsWith('https://')) {
          fileContent = await downloadFileContent(uri, authHeader);
        }
        if (fileContent) {
          (item.parts[i] as Record<string, unknown>) = { text: '[File content]:\n\n' + fileContent };
        }
      } catch (e) { throw new Error(`[Proxy] File resolve failed: ${(e as Error).message}`); }
    }
  }
}

function downloadFileContent(url: string, authHeader: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    (u.protocol === 'https:' ? https : http).request({
      hostname: u.hostname, path: u.pathname + u.search,
      method: 'GET', headers: { 'Authorization': authHeader }, timeout: FILE_DOWNLOAD_TIMEOUT_MS,
    }, (res) => {
      if (res.statusCode !== 200) { reject(new Error('HTTP ' + res.statusCode)); return; }
      let d = ''; let bytes = 0;
      res.on('data', (c: Buffer) => {
        bytes += c.length;
        if (bytes > 10 * 1024 * 1024) { reject(new Error('File too large')); res.destroy(); return; }
        d += c.toString();
      });
      res.on('end', () => resolve(d));
    }).on('error', reject).end();
  });
}

// Fix 6 helper extraction — spliced into src/proxy.ts at module level
// (inserted between `downloadFileContent` and the `handleCustomModelRequest` banner).
// Envelope: Cloud Code `{"response":{...},"traceId":"","metadata":{}}` preserved verbatim.

type RetryDispatch = (
  retryCount: number,
  delayMs: number,
  logReason: string,
) => void;

interface StreamRequestCtx {
  res: http.ServerResponse;
  model: CustomModel;
  geminiBody: GeminiRequestBody;
  isStream: boolean;
  retryCount: number;
  maxRetries: number;
  provider: string;
  traceId: string;
  attemptFallback: (d: ErrorDiagnostic) => boolean;
  retry: RetryDispatch;
}

/** Shared helper to record failure to both breaker and budget */
function recordModelFailure(model: CustomModel, errorType: ErrorType): void {
  recordFailure(model, errorType);
  getRetryBudget().recordFailure(model);
}

/** Shared retry dispatcher — schedules a re-dispatch with a jittered delay. */
function scheduleRetry(
  ctx: StreamRequestCtx,
  retryCount: number,
  delayMs: number,
  logReason: string,
): void {
  log.warn(`[Proxy] ${logReason} for ${ctx.model.name}, retrying (${retryCount + 1}/${ctx.maxRetries})...`);
  setTimeout(
    () => handleCustomModelRequest(ctx.res, ctx.model, ctx.geminiBody, ctx.isStream, ctx.retryCount + 1),
    delayMs,
  );
}

/** Helper to log detailed diagnostics for 401 Unauthorized errors */
function log401Diagnostic(model: CustomModel, finalUrlStr: string, apiRes: http.IncomingMessage): void {
  const apiKeyInfo = model.apiKey && model.apiKey !== 'none'
    ? `<set, len=${model.apiKey.length > 50 ? '>50' : model.apiKey.length <= 20 ? '≤20' : '21-50'}>`
    : '<empty or none>';
  log.error(`[Proxy] 401 Unauthorized from ${model.name} (${model.provider})`);
  log.error(`[Proxy]   URL: ${finalUrlStr}`);
  log.error(`[Proxy]   API key: ${apiKeyInfo}`);
  log.error(`[Proxy]   Headers sent: ${Object.keys(registry.getProviderHeaders(model.provider, model.apiKey, model.extraHeaders)).join(', ')}`);
  log.error(`[Proxy]   Possible causes:`);
  log.error(`[Proxy]     - Missing or invalid API key (check custom_models.json)`);
  log.error(`[Proxy]     - Wrong header name for this provider (e.g. 'Authorization' vs 'x-api-key')`);
  log.error(`[Proxy]     - Expired or revoked token`);
  log.error(`[Proxy]     - Account suspended or rate-limited`);
  log.error(`[Proxy]     - Wrong endpoint URL (${finalUrlStr})`);
  log.error(`[Proxy]   Upstream response: ${JSON.stringify(apiRes.headers).slice(0, 200)}`);
}

/** Upstream response error (mid-stream connection drop) — emits, ends, logs 401 context. */
function handleApiResError(err: Error, apiRes: http.IncomingMessage, ctx: StreamRequestCtx, finalUrlStr: string): void {
  const { model, res } = ctx;
  log.error(`[Proxy] Upstream stream error for ${model.name}:`, err.message);
  const diagnostic = classifyError(500, err, undefined, model.provider);
  emitProxyError(buildProxyErrorPayload(ctx.traceId, 500, err, model.provider));
  if (safeWriteHead(res, 500, {
    'Content-Type': 'application/json',
    'X-AG-Error-Type': diagnostic.errorType,
  })) {
    safeEnd(res, JSON.stringify({
      error: { message: 'Upstream connection error: ' + err.message },
      _agDiagnostic: diagnostic,
    }));
  } else if (!res.writableEnded) {
    safeEnd(res);
  }

  // P3: Log 401 errors with detailed diagnostic context to help users
  // understand why their custom endpoint rejected the request.
  // Common causes: missing API key, wrong header name, expired token,
  // wrong endpoint URL, account suspended.
  const status = apiRes.statusCode || 0;
  if (status === 401) {
    log401Diagnostic(model, finalUrlStr, apiRes);
  }
}

/** Stream response branch — SSE translation, idle/empty guards, error envelope. */
function handleStreamResponse(apiRes: http.IncomingMessage, request: http.ClientRequest, ctx: StreamRequestCtx): void {
  const { model, res, provider, traceId } = ctx;

  // Check for API errors BEFORE writing streaming headers
  if (apiRes.statusCode! >= 400) {
    let errorBody = '';
    apiRes.on('data', (chunk: Buffer) => errorBody += chunk.toString());
    apiRes.on('end', () => {
      log.error(`[Proxy] Stream API error (${apiRes.statusCode}) for ${model.name}: ${errorBody.substring(0, 300)}`);
      const streamDiagnostic = classifyError(apiRes.statusCode!, null, errorBody, model.provider);
      emitProxyError(buildProxyErrorPayload(traceId, apiRes.statusCode!, errorBody, model.provider));

      // Trip the breaker on the first hard failure so subsequent
      // requests short-circuit instead of piling up against a stuck upstream.
      if (
        streamDiagnostic.errorType === 'server' ||
        streamDiagnostic.errorType === 'rate_limit' ||
        streamDiagnostic.errorType === 'timeout' ||
        streamDiagnostic.errorType === 'network'
      ) {
        recordModelFailure(model, streamDiagnostic.errorType);
        if (streamDiagnostic.errorType === 'rate_limit') {
          markProviderRateLimited(model.apiUrl);
        }
      }

      if (shouldRetryStatus(apiRes.statusCode!, ctx.retryCount, ctx.maxRetries)) {
        const retryAfterMs = parseRetryAfter(apiRes.headers);
        const delay = computeRetryDelay('rate-limit', ctx.retryCount, retryAfterMs);
        ctx.retry(ctx.retryCount, delay, `Stream error ${apiRes.statusCode} (rate-limit)`);
        return;
      }
      const diagnostic = streamDiagnostic;

      if (ctx.attemptFallback(diagnostic)) return;

      if (diagnostic.errorType === 'billing' || diagnostic.errorType === 'auth' || diagnostic.errorType === 'forbidden') {
        const errResponse = {
          response: {
            candidates: [
              {
                content: { parts: [{ text: generateGracefulMarkdown(diagnostic) }], role: 'model' },
                finishReason: 'STOP',
                index: 0,
              },
            ],
          },
          traceId: '',
          metadata: {},
          _agDiagnostic: diagnostic,
        };
        if (safeWriteHead(res, 200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-AG-Error-Type': diagnostic.errorType,
        })) {
          res.write('data: ' + JSON.stringify(errResponse) + '\n\n');
          safeEnd(res);
        }
        return;
      }

      let responseJson = { error: { message: `Upstream error: ${errorBody}` } };
      try {
        responseJson = JSON.parse(errorBody);
      } catch {
        // not JSON
      }
      if (typeof responseJson === 'object' && responseJson !== null) {
        (responseJson as any)._agDiagnostic = diagnostic;
      }
      if (safeWriteHead(res, apiRes.statusCode!, {
        'Content-Type': 'application/json',
        'X-AG-Error-Type': diagnostic.errorType,
      })) {
        safeEnd(res, JSON.stringify(responseJson));
      }
    });
    return;
  }

  if (apiRes.statusCode === 200) {
    // Any successful response proves the upstream is healthy again;
    // clear the breaker so subsequent requests don't short-circuit.
    recordSuccess(model);
  }

  if (!safeWriteHead(res, 200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })) {
    return;
  }

  // Phase 2: Per-chunk idle timeout guard. Vendor pattern from
  // `withIdleTimeout`'s stream wrapper. If no SSE chunk arrives for
  // STREAM_IDLE_TIMEOUT_MS, treat the upstream as stuck and abort.
  const idleGuard = new IdleTimeoutGuard(apiRes, {
    idleTimeoutMs: STREAM_IDLE_TIMEOUT_MS,
    label: model.name,
    onTimeout: (err) => {
      log.warn(`[Proxy] ${err.message} — aborting request for ${model.name}`);
      recordModelFailure(model, 'timeout');
      try {
        request.destroy(err);
      } catch { /* already destroyed */ }
    },
  });

  // Phase 4: Empty-stream guard. Track raw chunks + SSE frames so we can
  // detect a 200 OK stream that contains no usable content (e.g. upstream
  // returns `[DONE]` immediately, or only keep-alive comments, or zero
  // non-empty chunks). Vendor pattern: "did we get something useful?" AND
  // gate from `vscode-unify-chat-provider`.
  const emptyGuard = new EmptyStreamGuard();

  let buffer = '';
  apiRes.on('data', (chunk: Buffer) => {
    // Observe first, then forward. The guard splits SSE frames on
    // newlines so a frame that spans two chunks is still counted.
    emptyGuard.observe(chunk);
    buffer += chunk.toString('utf-8');
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('data: ')) {
        const dataStr = trimmed.substring(6).trim();
        if (dataStr === '[DONE]') continue;
        try {
          const parsed = JSON.parse(dataStr);
          const mapped = registry.translateStreamChunk(provider, parsed, model.name);

          if (mapped) {
            const cloudCodeResponse = {
              response: { candidates: [mapped] },
              traceId: '',
              metadata: {},
            };
            res.write(`data: ${JSON.stringify(cloudCodeResponse)}\n\n`);
          }
        } catch (err) {
          // Partial/invalid JSON chunks are normal during streaming; debug-level only
          log.debug(`[Proxy] Stream chunk parse warning for ${model.name}:`, (err as Error).message);
        }
      }
    }
  });

  apiRes.on('end', () => {
    idleGuard.dispose();
    emptyGuard.observe(Buffer.from('')); // no-op, but tightens API

    // Phase 4: Detect empty streams BEFORE finalizing the response.
    // An empty stream is a 200 OK response with no SSE data frames.
    // We retry once (unless MAX_RETRIES is already exhausted) to give
    // flaky upstreams a second chance before surfacing an error.
    const verdict = emptyGuard.finalize({ statusCode: apiRes.statusCode ?? 0 });
    if (verdict.isEmpty && ctx.retryCount < ctx.maxRetries) {
      log.warn(
        `[Proxy] Empty stream from ${model.name}: ${verdict.reason} ` +
        `(0 frames, ${verdict.bytesReceived}B) — retrying (${ctx.retryCount + 1}/${ctx.maxRetries}).`,
      );
      recordModelFailure(model, 'empty_stream');
      ctx.retry(ctx.retryCount, computeRetryDelay('stream-error', ctx.retryCount, 0), `Empty stream: ${verdict.reason}`);
      return;
    }
    if (verdict.isEmpty) {
      log.warn(
        `[Proxy] Empty stream from ${model.name}: ${verdict.reason} ` +
        `(0 frames, ${verdict.bytesReceived}B) — max retries exhausted.`,
      );
      // Final attempt exhausted: count it as a failure so the budget
      // can downgrade the model's trust on the next request.
      recordModelFailure(model, 'empty_stream');
    }
    if (buffer.trim().startsWith('data: ')) {
      const dataStr = buffer.trim().substring(6).trim();
      if (dataStr !== '[DONE]') {
        try {
          const parsed = JSON.parse(dataStr);
          const mapped = registry.translateStreamChunk(provider, parsed, model.name);
          if (mapped) {
            const cloudCodeResponse = {
              response: { candidates: [mapped] },
              traceId: '',
              metadata: {},
            };
            res.write(`data: ${JSON.stringify(cloudCodeResponse)}\n\n`);
          }
        } catch (e) {
          log.debug(`[Proxy] Stream buffer drain parse warning for ${model.name}:`, (e as Error).message);
        }
      }
    }

    const finalChunk = {
      response: {
        candidates: [
          {
            content: { parts: [], role: 'model' },
            finishReason: 'STOP',
            index: 0,
          },
        ],
      },
      traceId: '',
      metadata: {},
    };
    res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
    res.end();
    const pId = model.name.includes('-') ? model.name.split('-')[0] : model.provider;
    void recordProviderUsage(pId, 100, 150);
  });
}

/** Non-stream response branch — JSON translate, retry on error status, graceful envelope. */
function handleNonStreamResponse(apiRes: http.IncomingMessage, ctx: StreamRequestCtx): void {
  const { model, res, provider, traceId } = ctx;
  let body = '';
  apiRes.on('data', (chunk: Buffer) => (body += chunk));
  apiRes.on('end', () => {
    // Retry if eligible based on status code
    if (shouldRetryStatus(apiRes.statusCode!, ctx.retryCount, ctx.maxRetries)) {
      const retryAfterMs = parseRetryAfter(apiRes.headers);
      const delay = computeRetryDelay('rate-limit', ctx.retryCount, retryAfterMs);
      ctx.retry(ctx.retryCount, delay, `Upstream error status ${apiRes.statusCode}`);
      return;
    }

    if (apiRes.statusCode! >= 400) {
      // P0-3: Only log status code and model name, NOT response body content
      log.error(`[Proxy] API error (${apiRes.statusCode}) for ${model.name}`);

      const diagnostic = classifyError(apiRes.statusCode!, null, body, model.provider);
      emitProxyError(buildProxyErrorPayload(traceId, apiRes.statusCode!, body, model.provider));

      // Trip the breaker on hard failures so subsequent requests
      // short-circuit instead of piling up against a stuck upstream.
      if (
        diagnostic.errorType === 'server' ||
        diagnostic.errorType === 'rate_limit' ||
        diagnostic.errorType === 'timeout' ||
        diagnostic.errorType === 'network'
      ) {
        recordModelFailure(model, diagnostic.errorType);
      }

      if (ctx.attemptFallback(diagnostic)) return;

      if (diagnostic.errorType === 'billing' || diagnostic.errorType === 'auth' || diagnostic.errorType === 'forbidden') {
        const errResponse = {
          response: {
            candidates: [
              {
                content: { parts: [{ text: generateGracefulMarkdown(diagnostic) }], role: 'model' },
                finishReason: 'STOP',
                index: 0,
              },
            ],
          },
          traceId: '',
          metadata: {},
          _agDiagnostic: diagnostic,
        };
        if (safeWriteHead(res, 200, {
          'Content-Type': 'application/json',
          'X-AG-Error-Type': diagnostic.errorType,
        })) {
          safeEnd(res, JSON.stringify(errResponse));
        }
        return;
      }

      let responseJson = { error: { message: `Upstream error: ${body}` } };
      try {
        responseJson = JSON.parse(body);
      } catch {
        // not JSON
      }
      if (typeof responseJson === 'object' && responseJson !== null) {
        (responseJson as any)._agDiagnostic = diagnostic;
      }

      if (safeWriteHead(res, apiRes.statusCode!, {
        'Content-Type': 'application/json',
        'X-AG-Error-Type': diagnostic.errorType,
      })) {
        safeEnd(res, JSON.stringify(responseJson));
      }
      return;
    }

    try {
      const parsed = JSON.parse(body) as Record<string, unknown>;

      const reasoning =
        (parsed as { choices?: { message?: { reasoning_content?: string; reasoning?: string } }[] }).choices?.[0]
          ?.message?.reasoning_content ||
        (parsed as { choices?: { message?: { reasoning_content?: string; reasoning?: string } }[] }).choices?.[0]
          ?.message?.reasoning;
      if (reasoning) {
        const modelKey = getSessionModelKey(model.name, (ctx.geminiBody as any)?.sessionId || (ctx.geminiBody as any)?.conversationId);
        modelReasoningContent.set(modelKey, reasoning);
        if (modelKey !== model.name) {
          modelReasoningContent.set(model.name, reasoning);
        }
        touchStateTimestamp(stateTimestamps.reasoning, modelKey);
      }

      const providerForResponse =
        model.provider === 'custom' || model.provider === 'openrouter' ? 'openai' : model.provider;
      const mapped = registry.translateResponse(providerForResponse, parsed, model.name);

      const cloudCodeResponse = {
        response: mapped,
        traceId: '',
        metadata: {},
      };

      // Successful 2xx response — clear breaker for this model.
      recordSuccess(model);
      // P5-2: feed the per-model retry budget a success sample so the
      // model's trust score recovers after a hard stretch of failures.
      getRetryBudget().recordSuccess(model);

      if (safeWriteHead(res, 200, { 'Content-Type': 'application/json' })) {
        safeEnd(res, JSON.stringify(cloudCodeResponse));
      }
    } catch (e) {
      log.error('[Proxy] Failed to map response:', e);

      if (ctx.retryCount < ctx.maxRetries) {
        ctx.retry(ctx.retryCount, computeRetryDelay('server-error', ctx.retryCount, 0), 'Parse error');
        return;
      }

      const diagnostic = classifyError(500, e, body, model.provider);

      if (ctx.attemptFallback(diagnostic)) return;

      if (safeWriteHead(res, 500, {
        'Content-Type': 'application/json',
        'X-AG-Error-Type': diagnostic.errorType,
      })) {
        safeEnd(res, JSON.stringify({
          error: { message: 'Failed to translate model response' },
          _agDiagnostic: diagnostic,
        }));
      }
    }
  });
}

/** Request-level timeout — breaker + budget + retry or 504. */
function handleRequestTimeout(request: http.ClientRequest, ctx: StreamRequestCtx): void {
  const { model, res } = ctx;
  log.error(`[Proxy] Request timeout (${resolveRequestTimeout(model)}ms) for ${model.name}`);
  request.destroy();
  // Trip the breaker immediately on timeout — these are the worst offender
  // in retry storms (the request holds the proxy open for the full timeout).
  recordModelFailure(model, 'timeout');

  if (ctx.retryCount < ctx.maxRetries) {
    ctx.retry(ctx.retryCount, computeRetryDelay('server-error', ctx.retryCount, 0), 'Timeout');
    return;
  }

  const diagnostic = classifyError(504, 'ETIMEDOUT', undefined, model.provider);

  if (ctx.attemptFallback(diagnostic)) return;

  if (safeWriteHead(res, 504, {
    'Content-Type': 'application/json',
    'X-AG-Error-Type': diagnostic.errorType,
  })) {
    safeEnd(res, JSON.stringify({
      error: { message: `Request timeout after ${resolveRequestTimeout(model) / 1000}s` },
      _agDiagnostic: diagnostic,
    }));
  }
}

/** Request-level network error — breaker + budget + retry or 502 envelope. */
function handleRequestError(err: Error, ctx: StreamRequestCtx): void {
  const { model, res } = ctx;
  log.error('[Proxy] Custom Model Request Error:', err);
  // Trip the breaker on network errors so the proxy stops hammering the
  // dead upstream. Use the error's code when present, default to 'network'.
  const code = (err as NodeJS.ErrnoException).code?.toUpperCase();
  const breakerType: ErrorType =
    code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT' ? 'timeout' :
    code === 'ENOTFOUND' || code === 'EAI_AGAIN' ? 'dns' :
    'network';
  recordModelFailure(model, breakerType);

  if (ctx.retryCount < ctx.maxRetries) {
    ctx.retry(ctx.retryCount, computeRetryDelay('network' as RetryStrategy, ctx.retryCount, 0), 'Network error');
    return;
  }

  const diagnostic = classifyError(undefined, err, undefined, model.provider);
  emitProxyError(buildProxyErrorPayload(ctx.traceId, undefined, err, model.provider));

  if (ctx.attemptFallback(diagnostic)) return;

  if (ctx.isStream) {
    if (!res.headersSent && !res.writableEnded) {
      const errResponse = {
        response: {
          candidates: [
            {
              content: { parts: [{ text: 'Network error: ' + err.message }], role: 'model' },
              finishReason: 'STOP',
              index: 0,
            },
          ],
        },
        traceId: '',
        metadata: {},
        _agDiagnostic: diagnostic,
      };
      safeWriteHead(res, 502, {
        'Content-Type': 'text/event-stream',
        'X-AG-Error-Type': diagnostic.errorType,
      });
      res.write('data: ' + JSON.stringify(errResponse) + '\n\n');
    }
    safeEnd(res);
  } else {
    if (safeWriteHead(res, 502, {
      'Content-Type': 'application/json',
      'X-AG-Error-Type': diagnostic.errorType,
    })) {
      safeEnd(res, JSON.stringify({
        error: { message: 'Custom model request failed: ' + err.message },
        _agDiagnostic: diagnostic,
      }));
    }
  }
}

// ─── Custom Model Request Handler ─────────────────────────────────────────

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

function handleCustomModelRequest(
  res: http.ServerResponse,
  model: CustomModel,
  rawGeminiBody: GeminiRequestBody,
  isStream: boolean,
  retryCount = 0,
  fallbackDepth = 0,
): void {
  const geminiBody = trimContextPayload(rawGeminiBody);
  const traceId = (geminiBody as Record<string, unknown>)?.requestId as string || '';

  // P3-18: Configurable max retries per model (default 1, min 0, max 5).
  // Lowered from 3 to 1 to prevent retry storms saturating the proxy.
  // P5-2: Seed the per-model retry budget from the configured value. The
  // budget then scales that base according to observed trust — flaky models
  // get fewer retries, consistent models get more.
  const CONFIGURED_MAX_RETRIES = resolveMaxRetries(model);
  const MAX_RETRIES = getRetryBudget().getMaxRetries(
    model,
    CONFIGURED_MAX_RETRIES || RETRY_BUDGET_BASE,
  );
  const REQUEST_TIMEOUT_MS = resolveRequestTimeout(model);

  // Circuit breaker: if this model just failed hard, short-circuit before
  // touching the upstream. This keeps the proxy responsive so the rest of
  // the model dropdown (and fetchAvailableModels) keeps working.
  const openBreaker = getOpenBreaker(model);
  if (openBreaker && retryCount === 0 && fallbackDepth === 0) {
    const cached = classifyError(
      openBreaker.errorType === 'rate_limit' ? 429 : 500,
      openBreaker.errorType,
      undefined,
      model.provider,
    );
    log.warn(
      `[Proxy] Circuit OPEN for ${model.name} (${openBreaker.errorType}, tripped ${Math.round((Date.now() - openBreaker.trippedAt) / 1000)}s ago). Short-circuiting request.`,
    );

    if (attemptFallback(cached)) {
      return;
    }

    const statusCode = openBreaker.errorType === 'rate_limit' ? 429 : 503;
    if (safeWriteHead(res, statusCode, {
      'Content-Type': 'application/json',
      'X-AG-Error-Type': cached.errorType,
      'X-AG-Circuit': 'open',
    })) {
      safeEnd(res, JSON.stringify({
        error: {
          message: `Model ${model.name} is temporarily unavailable (${cached.title}). Retried shortly.`,
        },
        _agDiagnostic: cached,
      }));
    }
    return;
  }

  // Shared by both the open-breaker short-circuit path and the regular
  // upstream-error paths. It only picks a different model and re-dispatches.
  function attemptFallback(diagnostic: ErrorDiagnostic): boolean {
    if (fallbackDepth >= 2) return false;
    const isEligibleForFallback =
      diagnostic.errorType === 'rate_limit' ||
      diagnostic.errorType === 'server' ||
      diagnostic.errorType === 'network' ||
      diagnostic.errorType === 'billing' ||
      diagnostic.errorType === 'timeout';
    if (!isEligibleForFallback) return false;

    try {
      const allModels = loadCustomModels();
      // If a specific fallback model is configured on the model, prioritize it!
      let orderedModels = allModels;
      if (model.fallbackModel) {
        const preferred = allModels.filter(m =>
          m.name === model.fallbackModel ||
          m.displayName === model.fallbackModel ||
          m.externalModelName === model.fallbackModel ||
          m.name.endsWith(`/${model.fallbackModel}`)
        );
        const rest = allModels.filter(m => !preferred.includes(m));
        orderedModels = [...preferred, ...rest];
      }

      // ponytail: skip same-provider on rate_limit — shared quota, fallback is a no-op
      const sameProviderRateLimit = diagnostic.errorType === 'rate_limit'
        ? new URL(model.apiUrl).hostname
        : null;
      for (const m of orderedModels) {
        if (m.name !== model.name && m.apiKey && !m.apiKey.startsWith('fallback:')) {
          if (sameProviderRateLimit && new URL(m.apiUrl).hostname === sameProviderRateLimit) {
            log.warn(`[Proxy] Auto-fallback: skipping ${m.displayName || m.name} (same provider ${sameProviderRateLimit}, shared quota)`);
            continue;
          }
          const fromName = model.displayName || model.name;
          const toName = m.displayName || m.name;
          log.warn(`[Proxy] Auto-fallback: ${fromName} → ${toName} (reason: ${diagnostic.errorType} — ${diagnostic.title})`);

          // L-1: Notify the user in the stream so the fallback is transparent.
          // We send a brief markdown notice as the first SSE event before
          // delegating to the fallback model handler.
          if (isStream && !res.headersSent) {
            if (safeWriteHead(res, 200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
              'X-Accel-Buffering': 'no',
              'X-AG-Fallback': 'true',
            })) {
              const noticeText = `> ⚡ **Smart Proxy Switch**\n> \`Provider Notice\`: \`${fromName}\` is temporarily rate-limited (${diagnostic.errorType}).\n> 🔄 **Rerouted to**: \`${toName}\` (Zero downtime, uninterrupted session)\n\n`;
              const notice = {
                response: {
                  candidates: [{
                    content: {
                      parts: [{ text: noticeText }],
                      role: 'model',
                    },
                    finishReason: 'STOP',
                    index: 0,
                  }],
                },
                traceId: '',
                metadata: {},
              };
              res.write('data: ' + JSON.stringify(notice) + '\n\n');
            }
          }

          handleCustomModelRequest(res, m, geminiBody, isStream, 0, fallbackDepth + 1);
          return true;
        }
      }
    } catch (e) {
      log.error('[Proxy] Auto-fallback exception:', e);
    }
    return false;
  }

  const provider = resolveProvider(model);
  const cleanModelName = getBaseModelId(model.externalModelName);

  const payload = registry.translateRequest(provider, geminiBody, cleanModelName, model.extraBody);
  const headers = registry.getProviderHeaders(provider, model.apiKey, model.extraHeaders);

  if (isStream && registry.supportsStreaming(provider)) {
    (payload as Record<string, unknown>).stream = true;
  }


  const finalUrlStr = resolveCustomModelUrl(
    model,
    isStream,
    (apiUrl, externalModelName, stream, translator) =>
      registry.getProviderUrl(apiUrl, externalModelName, stream, translator as Parameters<typeof registry.getProviderUrl>[3]),
  );
  const url = new URL(finalUrlStr);
  // Phase 3: per-host connection pooling via the agent cache. This avoids
  // a fresh TLS handshake on every chat turn (vendor pattern ported from
  // vscode-unify-chat-provider's `undici.Agent` cache). Default Node
  // globalAgent has keepAlive=false on Node 18+, so we use a stable,
  // keep-alive enabled agent per (scheme, host, port) tuple.
  const { client: pooledClient, agent } = resolveClientForUrl(
    finalUrlStr,
    !!model.allowUnauthorized,
  );

  const options: https.RequestOptions = {
    method: 'POST',
    headers: headers as Record<string, string>,
    agent,
  };

  // P0-2: SSL bypass ONLY when user explicitly opts in via allowUnauthorized.
  // Custom providers no longer bypass SSL automatically.
  if (model.allowUnauthorized) {
    log.warn(
      `[Proxy] SSL verification DISABLED for ${model.name} (allowUnauthorized=true). Connection is vulnerable to MITM.`,
    );
    (options as Record<string, unknown>).rejectUnauthorized = false;
  }

  log.info(
    `[Proxy] Routing ${model.name} to ${model.provider} (${model.apiUrl}) (isStream: ${!!isStream})${retryCount > 0 ? ` (retry ${retryCount})` : ''}`,
  );
  recordRecentModel(model.name);

  // Fix 6: dispatch through the extracted SRP helpers. The request-level
  // timeout/error handlers and the pooled request dispatch stay here.
  const ctx: StreamRequestCtx = {
    res,
    model,
    geminiBody,
    isStream,
    retryCount,
    maxRetries: MAX_RETRIES,
    provider,
    traceId,
    attemptFallback,
    retry: (rc, delayMs, logReason) => scheduleRetry(ctx, rc, delayMs, logReason),
  };

  const request = pooledClient.request(finalUrlStr, options, (apiRes) => {
    apiRes.on('error', (err) => handleApiResError(err, apiRes, ctx, finalUrlStr));
    const status = apiRes.statusCode || 0;

    // P3: Log 401 errors with detailed diagnostic context to help users
    // understand why their custom endpoint rejected the request.
    // Common causes: missing API key, wrong header name, expired token,
    // wrong endpoint URL, account suspended.
    if (status === 401) {
      // S-2: Never log actual key material â€” only presence and length bucket.
      const apiKeyInfo = model.apiKey && model.apiKey !== 'none'
        ? `<set, len=${model.apiKey.length > 50 ? '>50' : model.apiKey.length <= 20 ? 'â‰¤20' : '21-50'}>`
        : '<empty or none>';
      log.error(`[Proxy] 401 Unauthorized from ${model.name} (${model.provider})`);
      log.error(`[Proxy]   URL: ${finalUrlStr}`);
      log.error(`[Proxy]   API key: ${apiKeyInfo}`);
      log.error(`[Proxy]   Headers sent: ${Object.keys(headers).join(', ')}`);
      log.error(`[Proxy]   Possible causes:`);
      log.error(`[Proxy]     - Missing or invalid API key (check custom_models.json)`);
      log.error(`[Proxy]     - Wrong header name for this provider (e.g. 'Authorization' vs 'x-api-key')`);
      log.error(`[Proxy]     - Expired or revoked token`);
      log.error(`[Proxy]     - Account suspended or rate-limited`);
      log.error(`[Proxy]     - Wrong endpoint URL (${finalUrlStr})`);
      log.error(`[Proxy]   Upstream response: ${JSON.stringify(apiRes.headers).slice(0, 200)}`);
    }

    if (isStream) {
      handleStreamResponse(apiRes, request, ctx);
    } else {
      handleNonStreamResponse(apiRes, ctx);
    }
  });

  request.setTimeout(REQUEST_TIMEOUT_MS, () => handleRequestTimeout(request, ctx));

  request.on('error', (err) => handleRequestError(err, ctx));
  request.write(JSON.stringify(payload));
  request.end();
}

// ─── GetAvailableModels Proxy Handler ───────────────────────────────────────

function handleGetAvailableModelsProxy(
  res: http.ServerResponse,
  reqBody: Buffer,
  lsUrl: string,
): void {
  const lsParsed = new URL(lsUrl);
  const client = lsParsed.protocol === 'https:' ? https : http;

  const options: https.RequestOptions = {
    method: 'POST',
    hostname: lsParsed.hostname,
    port: lsParsed.port || (lsParsed.protocol === 'https:' ? '443' : '80'),
    path: lsParsed.pathname + lsParsed.search,
    headers: {
      'Content-Type': 'application/grpc-web+proto',
      'Accept': 'application/grpc-web+proto',
      'Content-Length': String(reqBody.length),
    },
    rejectUnauthorized: false,
  };

  const lsReq = client.request(options, (lsRes) => {
    let lsResErrored = false;
    lsRes.on('error', (err) => {
      lsResErrored = true;
      log.error('[Proxy] LS error for GetAvailableModels:', err.message);
      if (!res.headersSent && !res.writableEnded) {
        safeWriteHead(res, 502);
        safeEnd(res);
      }
    });

    const chunks: Buffer[] = [];
    lsRes.on('data', (chunk: Buffer) => chunks.push(chunk));
    lsRes.on('end', () => {
      // Guard: timeout or error may have already terminated the response
      if (lsResErrored || res.headersSent || res.writableEnded) {
        log.debug('[Proxy] GetAvailableModels: skipping end handler (response terminated)');
        return;
      }
      const responseBuf = Buffer.concat(chunks);
      const customModels = loadCustomModels();
      // Run concurrent health checks (cached with 30s TTL, max 800ms wait)
      checkAllModelsHealth(customModels).then((healthMap) => {
        const { buffer: modifiedBuf } = injectCustomModelsIntoResponse(responseBuf, customModels, healthMap);
        if (
          safeWriteHead(res, lsRes.statusCode || 200, {
            'Content-Type': 'application/grpc-web+proto',
            'Content-Length': String(modifiedBuf.length),
          })
        ) {
          safeEnd(res, modifiedBuf);
        }
      }).catch(() => {
        const { buffer: modifiedBuf } = injectCustomModelsIntoResponse(responseBuf, customModels);
        if (
          safeWriteHead(res, lsRes.statusCode || 200, {
            'Content-Type': 'application/grpc-web+proto',
            'Content-Length': String(modifiedBuf.length),
          })
        ) {
          safeEnd(res, modifiedBuf);
        }
      });
    });
  });

  lsReq.setTimeout(30_000, () => {
    log.error('[Proxy] GetAvailableModels forward timed out');
    lsReq.destroy();
    if (!res.headersSent && !res.writableEnded) {
      safeWriteHead(res, 504);
      safeEnd(res);
    }
  });

  lsReq.on('error', (err) => {
    log.error('[Proxy] GetAvailableModels forward error:', err.message);
    if (!res.headersSent && !res.writableEnded) {
      safeWriteHead(res, 502);
      safeEnd(res);
    }
  });

  lsReq.write(reqBody);
  lsReq.end();
}

// ─── Main Request Handler ─────────────────────────────────────────────────

function isAllowedOrigin(req: http.IncomingMessage): boolean {
  const host = (req.headers.host || '').toLowerCase();
  const origin = ((req.headers.origin || req.headers.referer || '') as string).toLowerCase();

  // 1. Validate Host header — local loopback or googleapis upstream
  const allowedHostPrefixes = ['127.0.0.1', 'localhost', '::1'];
  const isHostAllowed = allowedHostPrefixes.some((h) => host.startsWith(h)) || host.endsWith('.googleapis.com');
  if (!isHostAllowed) return false;

  // 2. Direct requests without Origin/Referer (Language Server Go, internal gRPC/HTTP)
  if (!origin) return true;

  // 3. Validate Origin/Referer header against known trusted local and Google origins
  try {
    const parsed = new URL(origin);
    const h = parsed.hostname.toLowerCase();
    return (
      h === '127.0.0.1' ||
      h === 'localhost' ||
      h === '::1' ||
      h === 'googleapis.com' ||
      h.endsWith('.googleapis.com')
    );
  } catch {
    return false;
  }
}

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  // CSRF / Origin Guard: Reject unauthorized external origins attempting local proxy abuse
  if (!isAllowedOrigin(req)) {
    log.warn(`[Proxy] Blocked request with unauthorized Host/Origin: host=${req.headers.host} origin=${req.headers.origin}`);
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Forbidden: Unauthorized origin' } }));
    return;
  }

  // Health check — keep this FIRST so the LS sees a live port even if other
  // initialization (padding strip, model loading, etc.) is delayed or fails.
  if (req.method === 'GET' && (req.url === '/health' || req.url === '/healthz')) {
    log.info(`[Proxy] /health hit from ${req.socket.remoteAddress || 'unknown'}`);
    const memUsage = process.memoryUsage();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'ok',
        uptime: process.uptime(),
        port: proxyPort,
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
    return;
  }

  if (req.method === 'GET' && (req.url === '/__diag__' || req.url?.startsWith('/__diag__?'))) {
    try {
      const accept = String(req.headers['accept'] ?? '');
      const snapshot = diagnosticsSnapshot();
      if (accept.includes('text/markdown') || accept.includes('text/plain')) {
        res.writeHead(200, {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(diagnosticsFormat(snapshot));
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(snapshot, null, 2));
      return;
    } catch (e) {
      proxyLog.error('Failed to render /__diag__', (e as Error).message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'failed to render diagnostics', detail: (e as Error).message }));
      return;
    }
  }

  // Phase 7.1: live counter / histogram inspection. Off by default;
  // enable with AG_METRICS_ENABLED=1 when debugging a noisy upstream.
  if (req.method === 'GET' && req.url === '/__metrics__') {
    try {
      if (!metricsEnabled()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not enabled. Set AG_METRICS_ENABLED=1 to expose /__metrics__.\n');
        return;
      }
      const accept = req.headers['accept'] ? String(req.headers['accept']) : undefined;
      const ct = negotiateContentType(accept);
      if (ct === 'text/plain') {
        res.writeHead(200, {
          'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(formatPrometheus(getMetricsSnapshot()));
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(getMetricsSnapshot(), null, 2));
      return;
    } catch (e) {
      proxyLog.error('Failed to render /__metrics__', (e as Error).message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'failed to render metrics', detail: (e as Error).message }));
      return;
    }
  }

  // Per-model health status — returns circuit breaker state for each custom
  // model so the renderer dropdown can show live green/red indicators.
  // Reads only in-memory state, no upstream calls, ~1ms response time.
  if (req.method === 'GET' && req.url === '/model-health') {
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
    return;
  }

  req.url = req.url!.replace(/^.*\/dummy_path_padding/, '');
  // Strip binary patch padding (from LS hostname replacement)
  req.url = req.url!.replace(/\/v1internal\/x{7}/, '');

  // P0-4: Enforce maximum request body size to prevent memory exhaustion DoS
  const MAX_BODY_SIZE = 10 * 1024 * 1024;
  let bodyLength = 0;
  let bodyRejected = false;

  const bodyChunks: Buffer[] = [];
  req.on('data', (chunk) => {
    bodyLength += chunk.length;
    if (bodyLength > MAX_BODY_SIZE) {
      if (!bodyRejected) {
        bodyRejected = true;
        log.warn(`[Proxy] Request body exceeds ${MAX_BODY_SIZE / 1024 / 1024}MB limit (${req.method} ${req.url})`);
        req.destroy();
        if (!res.headersSent) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({ error: { message: `Request body too large. Maximum: ${MAX_BODY_SIZE / 1024 / 1024}MB` } }),
          );
        }
      }
      return;
    }
    bodyChunks.push(chunk);
  });
  req.on('end', async () => {
    if (bodyRejected) return;

    const fullBody = Buffer.concat(bodyChunks);
    const bodyStr = fullBody.toString('utf-8');

    log.info(`[Proxy] Request: ${req.method} ${req.url}`);

    // MCP relay: the mobile companion asks the desktop session for the list
    // of configured MCP servers (name + tools + status) because the phone
    // holds no credentials or allowlist. The actual MCP runtime is the
    // Antigravity IDE sidecar; we simply delegate and relay its JSON.
    if (req.method === 'GET' && (req.url === '/list_mcp_servers' || req.url === '/mcp_servers')) {
      const listRes = await mcpListServers();
      if (safeWriteHead(res, 200, { 'Content-Type': 'application/json' })) {
        safeEnd(res, JSON.stringify(listRes));
      }
      return;
    }

    // MCP tool relay (same shape the daemon sends): serverName, toolName,
    // arguments. The proxy forwards to the MCP runtime and relays the JSON.
    if (req.method === 'POST' && req.url === '/call_mcp_tool') {
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(bodyStr || '{}');
      } catch (e) {
        if (safeWriteHead(res, 400, { 'Content-Type': 'application/json' })) {
          safeEnd(res, JSON.stringify({ error: { message: 'Invalid JSON body' } }));
        }
        return;
      }
      const callRes = await mcpCallTool(payload);
      if (safeWriteHead(res, 200, { 'Content-Type': 'application/json' })) {
        safeEnd(res, JSON.stringify(callRes));
      }
      return;
    }

    // 0. Intercept GetAvailableModels (redirected from Electron webRequest)
    if (req.url!.startsWith('/GetAvailableModels')) {
      const gavParsed = new URL(req.url!, 'http://127.0.0.1');
      const lsUrl = gavParsed.searchParams.get('ls');
      if (lsUrl) {
        handleGetAvailableModelsProxy(res, fullBody, lsUrl);
        return;
      }
      if (safeWriteHead(res, 400, { 'Content-Type': 'application/json' })) {
        safeEnd(res, JSON.stringify({ error: 'Missing ls parameter' }));
      }
      return;
    }

    // 0.5. Intercept /v1internal:listExperiments
    if (req.url!.includes('/v1internal:listExperiments')) {
      if (safeWriteHead(res, 200, { 'Content-Type': 'application/json' })) {
        safeEnd(res, JSON.stringify({ experiments: [] }));
      }
      return;
    }

    // 1. Intercept /v1internal:fetchAvailableModels
    if (req.url!.includes('/v1internal:fetchAvailableModels')) {
      log.info('[Proxy] Intercepting fetchAvailableModels request');

      // Fire async health check (non-blocking)
      const customModelsForHealth = loadCustomModels();
      if (customModelsForHealth.length > 0) {
        checkAllModelsHealth(customModelsForHealth).catch((err) => {
          log.error('[Proxy] Background health check failed:', err);
        });
      }

      const targetHost = 'daily-cloudcode-pa.googleapis.com';
      const targetUrl = `https://${targetHost}`;
      let parsedUrl: URL;
      try {
        const realIp = await resolveGoogleIp(targetHost);
        parsedUrl = new URL(req.url!, targetUrl);
        parsedUrl.hostname = realIp;
      } catch (e) {
        log.error(`[Proxy] Could not resolve upstream IP for ${targetHost}:`, e);
        if (safeWriteHead(res, 500, { 'Content-Type': 'application/json' })) {
          safeEnd(res, JSON.stringify({ error: { message: 'DNS resolution failed for ' + targetHost } }));
        }
        return;
      }
      const fwdHeaders: Record<string, string | string[] | undefined> = {
        ...(req.headers as Record<string, string | string[] | undefined>),
      };
      fwdHeaders['host'] = targetHost;
      delete fwdHeaders['connection'];
      delete fwdHeaders['keep-alive'];
      delete fwdHeaders['accept-encoding'];

      const fwdOptions: https.RequestOptions = {
        method: req.method,
        headers: fwdHeaders as Record<string, string>,
        servername: targetHost,
      };

      const googleReq = https.request(parsedUrl, fwdOptions, (googleRes) => {
        let googleResErrored = false;
        googleRes.on('error', (err) => {
          googleResErrored = true;
          log.error('[Proxy] fetchAvailableModels upstream error:', err.message);
        });

        // P0-5: Timeout for fetchAvailableModels forward request (30s)
        googleReq.setTimeout(30_000, () => {
          log.error('[Proxy] fetchAvailableModels forward request timed out');
          googleReq.destroy();
          if (!res.headersSent && !res.writableEnded) {
            const customModels = loadCustomModels();
            const mappedCustom: Record<string, unknown> = {};
            customModels.forEach((m) => {
              const slug = toSlug(m);
              const pid = generateModelPlaceholderId(m);
              mappedCustom[slug] = {
                displayName: m.displayName,
                maxTokens: 1048576,
                maxOutputTokens: 4096,
                model: pid,
                planModel: pid,
                requestedModel: pid,
                apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
                modelProvider: 'MODEL_PROVIDER_GOOGLE',
              };
            });
            safeWriteHead(res, 200, { 'Content-Type': 'application/json' });
            safeEnd(res, JSON.stringify({ models: mappedCustom }));
          }
        });

        let googleBody = '';
        googleRes.on('data', (chunk) => (googleBody += chunk));
        googleRes.on('end', () => {
          // Guard: timeout or upstream error may have already terminated the response
          if (googleResErrored || res.headersSent || res.writableEnded) {
            log.debug('[Proxy] fetchAvailableModels: skipping end handler (response terminated)');
            return;
          }
          try {
            log.info(
              `[Proxy] fetchAvailableModels response status: ${googleRes.statusCode}, body length: ${googleBody.length}`,
            );

            let googleJson: Record<string, unknown>;
            try {
              googleJson = JSON.parse(googleBody) as Record<string, unknown>;
            } catch {
              log.warn(
                `[Proxy] fetchAvailableModels: non-JSON response from upstream (status: ${googleRes.statusCode}), generating synthetic models map`,
              );
              googleJson = { models: {} };
            }
            // DEBUG: dump raw upstream fetchAvailableModels response for diagnosis
            fs.promises
              .writeFile(path.join(os.tmpdir(), 'ag-fetchAvailableModels-dump.json'), JSON.stringify(googleJson, null, 2))
              .catch(() => {});
            const customModels = loadCustomModels();

            log.info(`[Proxy] Loaded custom models count: ${customModels.length}`);

            let merged = false;
            if (googleJson.models) {
              googleJson.models = mergeModels(googleJson.models, customModels);
              merged = true;
            }
            if (googleJson.availableModels) {
              googleJson.availableModels = mergeModels(googleJson.availableModels, customModels);
              merged = true;
            }
            if (googleJson.available_models) {
              googleJson.available_models = mergeModels(googleJson.available_models, customModels);
              merged = true;
            }

            if (!merged) {
              const modelsMap: Record<string, unknown> = {};
              customModels.forEach((m) => {
                const slug = toSlug(m);
                modelsMap[slug] = {
                  displayName: m.displayName,
                  recommended: true,
                  maxTokens: 1048576,
                  maxOutputTokens: 4096,
                  tokenizerType: 'LLAMA_WITH_SPECIAL',
                  model: generateModelPlaceholderId(m),
                  apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
                  modelProvider: 'MODEL_PROVIDER_GOOGLE',
                };
                m._slug = slug;
              });
              googleJson.models = modelsMap;
            }

            // Inject custom model slugs into agentModelSorts
            const customSlugs = customModels.map((m) => m._slug).filter(Boolean) as string[];
            if (customSlugs.length > 0) {
              if (googleJson.agentModelSorts && Array.isArray(googleJson.agentModelSorts)) {
                (googleJson.agentModelSorts as { groups?: { modelIds?: string[] }[] }[]).forEach((sort) => {
                  if (sort.groups && Array.isArray(sort.groups)) {
                    sort.groups.forEach((group) => {
                      if (group.modelIds && Array.isArray(group.modelIds)) {
                        customSlugs.forEach((slug) => {
                          if (!group.modelIds!.includes(slug)) {
                            group.modelIds!.push(slug);
                          }
                        });
                      }
                    });
                  }
                });
              }
            }

            // P1: Strip Google's upstream error from the response. When Google
            // returns 401/403/etc., the proxy forwards that error object alongside
            // our injected custom models. The Antigravity frontend treats any
            // `error` key as a hard failure and hides the entire model list,
            // even though we successfully injected valid models. Removing the
            // error key lets the frontend render the merged model list normally.
            if (googleJson.error) {
              log.warn(
                `[Proxy] fetchAvailableModels: stripping upstream error from response (status: ${googleRes.statusCode})`,
              );
              delete (googleJson as Record<string, unknown>).error;
            }

            safeWriteHead(res, 200, { 'Content-Type': 'application/json' });
            safeEnd(res, JSON.stringify(googleJson));
          } catch (err) {
            log.error('[Proxy] Parsing fetchAvailableModels failed:', err);
            if (res.headersSent || res.writableEnded) return;
            const customModels = loadCustomModels();
            const mappedCustom: Record<string, unknown> = {};
            customModels.forEach((m) => {
              const slug = toSlug(m);
              const pid = generateModelPlaceholderId(m);
              mappedCustom[slug] = {
                displayName: m.displayName,
                maxTokens: 1048576,
                maxOutputTokens: 4096,
                model: pid,
                planModel: pid,
                requestedModel: pid,
                apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
                modelProvider: 'MODEL_PROVIDER_GOOGLE',
              };
            });
            safeWriteHead(res, 200, { 'Content-Type': 'application/json' });
            safeEnd(res, JSON.stringify({ models: mappedCustom }));
          }
        });
      });

      googleReq.on('error', (err) => {
        log.error('[Proxy] Forwarding fetchAvailableModels failed:', err);
        if (!res.headersSent && !res.writableEnded) {
          const customModels = loadCustomModels();
          const mappedCustom: Record<string, unknown> = {};
          customModels.forEach((m) => {
            const slug = toSlug(m);
            const pid = generateModelPlaceholderId(m);
            mappedCustom[slug] = {
              displayName: m.displayName,
              maxTokens: 1048576,
              maxOutputTokens: 4096,
              model: pid,
              planModel: pid,
              requestedModel: pid,
              apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
              modelProvider: 'MODEL_PROVIDER_GOOGLE',
            };
          });
          safeWriteHead(res, 200, { 'Content-Type': 'application/json' });
          safeEnd(res, JSON.stringify({ models: mappedCustom }));
        }
      });

      if (fullBody && fullBody.length > 0) {
        googleReq.write(fullBody);
      }
      googleReq.end();
      return;
    }

    // 2. Intercept /v1beta/models or /v1/models list request
    if (req.method === 'GET' && (req.url!.endsWith('/models') || req.url!.includes('/models?'))) {
      log.info('[Proxy] Intercepting models list request');

      const targetHost = 'generativelanguage.googleapis.com';
      const targetUrl = `https://${targetHost}`;
      let parsedUrl: URL;
      try {
        const realIp = await resolveGoogleIp(targetHost);
        parsedUrl = new URL(req.url!, targetUrl);
        parsedUrl.hostname = realIp;
      } catch (e) {
        log.error(`[Proxy] Could not resolve upstream IP for ${targetHost}:`, e);
        if (safeWriteHead(res, 500, { 'Content-Type': 'application/json' })) {
          safeEnd(res, JSON.stringify({ error: { message: 'DNS resolution failed for ' + targetHost } }));
        }
        return;
      }
      const mdlHeaders: Record<string, string | string[] | undefined> = {
        ...(req.headers as Record<string, string | string[] | undefined>),
      };
      mdlHeaders['host'] = targetHost;
      delete mdlHeaders['connection'];
      delete mdlHeaders['accept-encoding'];

      const mdlOptions: https.RequestOptions = {
        method: 'GET',
        headers: mdlHeaders as Record<string, string>,
        servername: targetHost,
      };

      const googleReq = https.request(parsedUrl, mdlOptions, (googleRes) => {
        let googleResErrored = false;
        googleRes.on('error', (err) => {
          googleResErrored = true;
          log.error('[Proxy] Models list upstream error:', err.message);
        });

        // P0-5: Timeout for models list forward request (30s)
        googleReq.setTimeout(30_000, () => {
          log.error('[Proxy] Models list forward request timed out');
          googleReq.destroy();
          if (!res.headersSent && !res.writableEnded) {
            const customModels = loadCustomModels();
            safeWriteHead(res, 200, { 'Content-Type': 'application/json' });
            safeEnd(
              res,
              JSON.stringify({
                models: customModels.map((m) => ({
                  name: m.name,
                  displayName: m.displayName,
                  description: m.description,
                  supportedGenerationMethods: ['generateContent'],
                })),
              }),
            );
          }
        });

        let googleBody = '';
        googleRes.on('data', (chunk) => (googleBody += chunk));
        googleRes.on('end', () => {
          // Guard: timeout or upstream error may have already terminated the response
          if (googleResErrored || res.headersSent || res.writableEnded) {
            log.debug('[Proxy] Models list: skipping end handler (response terminated)');
            return;
          }
          try {
            const googleJson = JSON.parse(googleBody) as { models?: unknown[] };
            const customModels = loadCustomModels();

            const mappedCustom = customModels.map((m) => ({
              name: 'models/' + generateModelPlaceholderId(m),
              version: '1.0',
              displayName: m.displayName,
              description: m.description,
              inputTokenLimit: 1048576,
              outputTokenLimit: 4096,
              supportedGenerationMethods: ['generateContent', 'countTokens'],
              temperature: 0.7,
              topP: 0.9,
              topK: 40,
            }));

            if (googleJson.models) {
              googleJson.models = [...mappedCustom, ...googleJson.models];
            } else {
              googleJson.models = mappedCustom;
            }

            safeWriteHead(res, 200, { 'Content-Type': 'application/json' });
            safeEnd(res, JSON.stringify(googleJson));
          } catch (err) {
            log.error('[Proxy] Google list models failed:', err);
            if (res.headersSent || res.writableEnded) return;
            safeWriteHead(res, 502, { 'Content-Type': 'application/json' });
            safeEnd(res, JSON.stringify({ error: { message: `Upstream models parse error: ${(err as Error).message}` } }));
          }
        });
      });

      googleReq.on('error', (err) => {
        log.error('[Proxy] Google models list request error:', err);
        if (!res.headersSent && !res.writableEnded) {
          const customModels = loadCustomModels();
          safeWriteHead(res, 200, { 'Content-Type': 'application/json' });
          safeEnd(
            res,
            JSON.stringify({
              models: customModels.map((m) => ({
                name: m.name,
                displayName: m.displayName,
                description: m.description,
                supportedGenerationMethods: ['generateContent'],
              })),
            }),
          );
        }
      });
      googleReq.end();
      return;
    }

    // 3. Intercept Cloud Code generation stream or non-stream requests
    const isCloudCodeStream =
      req.url!.includes('/v1internal:streamGenerateContent') || req.url!.includes('/v1internal:generateContent');
    if (req.method === 'POST' && isCloudCodeStream) {
      try {
        const reqJson = JSON.parse(bodyStr) as Record<string, unknown>;
        const targetReq = (reqJson.request || reqJson) as Record<string, unknown>;

        const candidateNames = [
          reqJson.model,
          reqJson.requestedModel,
          reqJson.planModel,
          reqJson.requested_model,
          reqJson.plan_model,
          reqJson.modelId,
          reqJson.model_id,
          targetReq.model,
          targetReq.requestedModel,
          targetReq.planModel,
          targetReq.requested_model,
          targetReq.plan_model,
          targetReq.modelId,
          targetReq.model_id,
        ].filter((x): x is string => typeof x === 'string' && Boolean(x));

        log.info(
          `[Proxy] Cloud Code generation request candidates: ${candidateNames.join(', ')}, url: ${req.url}, bodyKeys: ${Object.keys(reqJson).join(',')}`,
        );

        if (candidateNames.length > 0) {
          const customModels = expandModelsWithEffort(loadCustomModels());
          const matchedCustomModel = customModels.find((m) => {
            const enumName = generateModelPlaceholderId(m);
            return candidateNames.some(
              (cn) =>
                m.name === cn ||
                toSlug(m) === cn ||
                enumName === cn ||
                `models/${enumName}` === cn ||
                cn.endsWith(enumName),
            );
          });
          if (matchedCustomModel) {
            log.info(
              `[Proxy] Intercepting Cloud Code generation for custom model: ${matchedCustomModel.displayName}`,
            );
            const isStream = req.url!.includes('streamGenerateContent') || req.url!.includes('alt=sse');
            const actualGeminiBody = (reqJson.request || reqJson) as GeminiRequestBody;
            // Resolve fileData URIs then route to translator
            resolveFileData(actualGeminiBody, req.headers as Record<string, string | string[] | undefined>).then(() => {
              handleCustomModelRequest(res, matchedCustomModel, actualGeminiBody, isStream);
            });
            return;
          }
        }
      } catch (err) {
        log.error('[Proxy] Failed to parse Cloud Code stream body:', err);
      }
    }

    // 4. Intercept standard generateContent / streamGenerateContent request
    const generateMatch = req.url!.match(/\/(?:v1|v1beta)\/(models\/[^:]+):generateContent/);
    const streamMatch = req.url!.match(/\/(?:v1|v1beta)\/(models\/[^:]+):streamGenerateContent/);

    const isGenerate = !!generateMatch;
    const isStandardStream = !!streamMatch;

    if (req.method === 'POST' && (isGenerate || isStandardStream)) {
      const matchedModelName = isGenerate ? generateMatch![1] : streamMatch![1];
      const customModels = expandModelsWithEffort(loadCustomModels());
      const matchedCustomModel = customModels.find((m) => {
        const enumName = generateModelPlaceholderId(m);
        return (
          m.name === matchedModelName ||
          toSlug(m) === matchedModelName ||
          enumName === matchedModelName ||
          'models/' + enumName === matchedModelName
        );
      });

      if (matchedCustomModel) {
        try {
          const geminiBody = JSON.parse(bodyStr) as GeminiRequestBody;
          resolveFileData(geminiBody, req.headers as Record<string, string | string[] | undefined>).then(() => {
            handleCustomModelRequest(res, matchedCustomModel, geminiBody, isStandardStream);
          });
          return;
        } catch (e) {
          log.error('[Proxy] JSON parse error in request body:', e);
          if (safeWriteHead(res, 400, { 'Content-Type': 'application/json' })) {
            safeEnd(res, JSON.stringify({ error: { message: 'Invalid JSON request body' } }));
          }
          return;
        }
      }
    }

    // 5. Fallback: transparent proxy to Google
    await proxyToGoogle(req, res, fullBody);
  });
}

// ─── File Watcher for custom_models.json ──────────────────────────────────

let customModelsWatcher: fs.FSWatcher | null = null;
let customModelsWatcherDebounce: NodeJS.Timeout | null = null;

export function setupCustomModelsWatcher(): void {
  try {
    const customModelsPath = getCustomModelsPath();
    const customModelsDir = path.dirname(customModelsPath);
    if (!fs.existsSync(customModelsDir)) {
      fs.mkdirSync(customModelsDir, { recursive: true });
    }

    if (customModelsWatcher) {
      customModelsWatcher.close();
      customModelsWatcher = null;
    }

    customModelsWatcher = fs.watch(customModelsDir, (_eventType, filename) => {
      if (filename && filename.includes('custom_models.json')) {
        if (customModelsWatcherDebounce) clearTimeout(customModelsWatcherDebounce);
        customModelsWatcherDebounce = setTimeout(() => {
          log.info('[Proxy] custom_models.json changed on disk. Invalidating model caches...');
          invalidateModelStoreCache();
          invalidateHealthCache();
          try {
            const models = loadCustomModels();
            if (models.length > 0) {
              checkAllModelsHealth(models).catch(() => {});
            }
          } catch (err) {
            log.warn('[Proxy] Failed to reload/health-check models after file change:', err);
          }
        }, 200);
      }
    });
  } catch (err) {
    log.warn('[Proxy] Failed to setup custom_models.json watcher:', err);
  }
}

export function stopCustomModelsWatcher(): void {
  if (customModelsWatcherDebounce) {
    clearTimeout(customModelsWatcherDebounce);
    customModelsWatcherDebounce = null;
  }
  if (customModelsWatcher) {
    try {
      customModelsWatcher.close();
    } catch {}
    customModelsWatcher = null;
  }
}

// ─── Server Start/Stop ────────────────────────────────────────────────────

export function startProxy(): Promise<number> {
  return new Promise((resolve, reject) => {
    try {
      server = http.createServer(handleRequest);

      // The Antigravity language server multiplexes many requests over a few
      // keep-alive sockets and pipelines them aggressively (state page updates
      // every ~200ms, back-to-back streamGenerateContent). Node's default
      // keepAliveTimeout (5s) destroys idle sockets under the LS's next write;
      // Windows then aborts that write with WSAECONNABORTED, the Go client
      // retries, and we get a retry flood + CPU burn. Disable all three
      // reaping timeouts: the proxy binds 127.0.0.1 only, and the idle guard
      // on upstream streams handles stuck providers.
      // ponytail: 0 disables reaping → a broken local client could hold
      // sockets open forever. Acceptable on loopback; re-enable with
      // keepAliveTimeout=60_000 if the proxy is ever exposed beyond localhost.
      server.keepAliveTimeout = 0;
      server.headersTimeout = 0;
      server.requestTimeout = 0;

      // P2: Make port/host configurable via env vars so the proxy can be
      // tuned per-machine without recompiling. Defaults preserve legacy behavior.
      const envPort = parseInt(process.env.AG_PROXY_PORT || '', 10);
      const defaultPort = Number.isFinite(envPort) && envPort > 0 ? envPort : DEFAULT_PROXY_PORT;
      const defaultHost = process.env.AG_PROXY_HOST || '127.0.0.1';

      let primaryPort = defaultPort;
      let primaryHost = defaultHost;

      const portCandidates: number[] = [defaultPort];
      portCandidates.push(0); // 0 = OS-assigned dynamic port (last resort)

      let attemptIdx = 0;

      const tryListen = (port: number, host: string): void => {
        server!.listen(port, host, () => {
          proxyPort = (server!.address() as import('net').AddressInfo).port;
          const isFallback = port !== defaultPort && port !== 0;
          const isDynamic = port === 0;
          if (isFallback) {
            log.warn(`[Proxy] Default port ${defaultPort} unavailable. Using fallback port ${proxyPort}.`);
            log.warn(`[Proxy] Set AG_PROXY_PORT=${proxyPort} in your environment to silence this warning.`);
          } else if (isDynamic) {
            log.warn(`[Proxy] All configured ports in use. Using OS-assigned dynamic port ${proxyPort}.`);
          } else {
            log.info(`[Proxy] Server listening on http://${host}:${proxyPort}`);
          }

          // Persist the active port so other processes (ag-doctor-ui, scripts)
          // can discover which port the proxy is actually bound to.
          try {
            const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
            const portFile = path.join(home, ACTIVE_PORT_FILE);
            fs.mkdirSync(path.dirname(portFile), { recursive: true });
            fs.writeFileSync(portFile, String(proxyPort), 'utf-8');
            log.debug(`[Proxy] Active port persisted to ${portFile}`);
          } catch (err) {
            log.warn('[Proxy] Could not persist active port:', (err as Error).message);
          }

          // Execute cleanup initialization after the server is already listening
          // so that failures here don't prevent the port from binding.
          try {
            startCleanupInterval();
            setupCustomModelsWatcher();
          } catch (err) {
            log.error('[Proxy] Failed to start cleanup interval:', err);
          }

          resolve(proxyPort);
        });
      };

      server.on('error', (err: NodeJS.ErrnoException) => {
        // Log full error details for diagnostics on new machines.
        log.error(`[Proxy] Server error: code=${err.code} message=${err.message} syscall=${err.syscall || ''} address=${(err as any).address || ''} port=${(err as any).port || ''}`);
        if (err.code === 'EADDRINUSE' && attemptIdx + 1 < portCandidates.length) {
          const triedPort = portCandidates[attemptIdx];
          const nextPort = portCandidates[attemptIdx + 1];
          log.warn(`[Proxy] Port ${triedPort} is already in use. Trying ${nextPort === 0 ? 'OS-assigned dynamic port' : 'port ' + nextPort}...`);
          attemptIdx += 1;
          tryListen(nextPort, primaryHost);
        } else if (err.code === 'EACCES') {
          log.warn(`[Proxy] Permission denied binding to ${primaryHost}:${primaryPort}. Trying fallback ports...`);
          if (attemptIdx + 1 < portCandidates.length) {
            const triedPort = portCandidates[attemptIdx];
            const nextPort = portCandidates[attemptIdx + 1];
            log.warn(`[Proxy] Port ${triedPort} access denied. Trying ${nextPort === 0 ? 'OS-assigned dynamic port' : 'port ' + nextPort}...`);
            attemptIdx += 1;
            tryListen(nextPort, primaryHost);
          } else {
            log.error(`[Proxy] Permission denied binding to ${primaryHost}:${primaryPort}. Try a different port (AG_PROXY_PORT) or run with sufficient privileges.`);
            reject(err);
          }
        } else {
          log.error('[Proxy] Startup failed:', err);
          reject(err);
        }
      });

      primaryPort = portCandidates[0];
      // Hot-reload persisted state from disk before we start accepting
      // requests. This restores any breakers that were tripped before the
      // last shutdown, so the proxy doesn't immediately re-fail on a
      // model the user already determined was broken.
      loadPersistedState();
      tryListen(primaryPort, primaryHost);
    } catch (err) {
      log.error('[Proxy] Unexpected error during startProxy:', err);
      reject(err);
    }
  });
}

/**
 * Reads the persisted state file and applies it to the live singletons.
 * Called once on startup. Safe to call again — re-loads idempotently.
 */
export function loadPersistedState(): void {
  try {
    const path = stateFilePath();
    const file = loadPersisted(path);
    const { retryBudgetPatch, breakerPatch } = fromPersistedFile(
      file,
      Date.now(),
      CIRCUIT_BREAKER_RESET_MS,
    );
    applyBudgetPatch(retryBudgetPatch);
    applyBreakerPatch(breakerPatch);
    if (file.recentModels) {
      restoreRecentModels(file.recentModels);
    }
    log.info(
      `[Proxy] loaded persisted state: budget=${retryBudgetPatch.size} breakers=${breakerPatch.size}`,
    );
  } catch (err) {
    log.warn('[Proxy] could not restore persisted state:', err);
  }
}

/**
 * Persist the current in-memory retry budget + breaker state to disk.
 * Throttled by `MIN_FLUSH_INTERVAL_MS` unless `force` is set.
 */
export function flushPersistedState(opts: { force?: boolean } = {}): void {
  try {
    const path = stateFilePath();
    const file = gatherPersisted();
    const ok = flushPersisted(path, file);
    if (!ok && !opts.force) {
      // Throttled — that's fine. The next mutation will flush.
      return;
    }
  } catch (err) {
    log.warn('[Proxy] could not persist state:', err);
  }
}

export function stopProxy(): Promise<void> {
  return new Promise((resolve) => {
    // P1-9: Stop cleanup interval to prevent orphaned timers
    stopCleanupInterval();
    stopCustomModelsWatcher();

    const finish = (): void => {
      // Phase 6.3: flush any pending persisted state (force, ignore throttle)
      // so the next startProxy() can re-load the same breakers / budgets.
      flushPersistedState({ force: true });
      // Phase 3: close per-host https/http agent pools so file descriptors
      // are released on graceful shutdown (mirrors undici.Agent.close()).
      disposeAgentPool()
        .then(() => resolve())
        .catch((err) => {
          log.warn('[Proxy] Agent pool dispose error (non-fatal):', err);
          resolve();
        });
    };

    if (server) {
      // Forcefully close idle connections to release sockets immediately
      if (typeof (server as any).closeIdleConnections === 'function') {
        (server as any).closeIdleConnections();
      }
      server.close(() => {
        log.info('[Proxy] Server stopped');
        server = null;
        finish();
      });
    } else {
      finish();
    }
  });
}

export function getProxyPort(): number {
  return proxyPort;
}
