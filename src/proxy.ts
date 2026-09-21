// ─── Constants & Imports ───────────────────────────────────────────────────

import * as http from 'http';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as zlib from 'zlib';
import { StringDecoder } from 'string_decoder';
import { randomBytes, randomInt } from 'crypto';

import log from 'electron-log';
import { createLogger } from './logger';
import { startTimer as metricTimer, inc as metricInc, observe as metricObserve } from './metrics';
import {
  GOOGLE_HOSTS,
  DEFAULT_PROXY_PORT,
  WINDOW_ORIGIN,
  LOOPBACK_HOSTS,
  DEFAULT_REMOTE_HOST,
  DEFAULT_REMOTE_TOKEN,
  GOOGLE_PROXY_TIMEOUT_MS,
  FILE_DOWNLOAD_TIMEOUT_MS,
  STREAM_IDLE_TIMEOUT_MS,
  ACTIVE_PORT_FILE,
  DEFAULT_MAX_BODY_SIZE,
} from './constants';
import { wrapCommandForRemoteExec } from './proxy/translators/utils';

// Types
import type { CustomModel, GeminiRequestBody, GeminiCandidate, CloudCodeResponse } from './proxy/types';
export type { CustomModel, GeminiRequestBody, GeminiCandidate, CloudCodeResponse };

// Shared cross-turn state & resilience
import {
  modelToolCallIds,
  modelReasoningContent,
  activeStreamContexts,
  translatedToolCalls,
  stateTimestamps,
  thoughtSignatureCache,
  extractAndCacheThoughtSignatures,
  restoreThoughtSignatures,
  sanitizeUnsignedToolCalls,
  flattenAllToolCallsToText,
  touchStateTimestamp,
  getSessionModelKey,
  startCleanupInterval,
  stopCleanupInterval,
} from './proxy/shared';
import * as registry from './proxy/registry';
import { injectCustomModelsIntoResponse, injectCustomModelsIntoUserStatus } from './proxy/protoInjector';
import { loadCustomModels, getCustomModelsPath } from './proxy/modelLoader';
import { invalidateModelStoreCache } from './services/modelStore';
import { invalidateHealthCache } from './proxy/modelHealthChecker';
import { recordProviderUsage } from './customModelStore';
import { classifyError, ErrorDiagnostic, type ErrorType } from './proxy/errorClassifier';
import { shouldRetryStatus, computeRetryDelay, type RetryStrategy } from './proxy/retryStrategy';
import { getOpenBreaker, recordFailure, recordSuccess, CIRCUIT_BREAKER_RESET_MS } from './proxy/circuitBreaker';
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
import {
  resolveProvider,
  resolveCustomModelUrl,
  resolveMaxRetries,
  resolveRequestTimeout,
  getBaseModelId,
} from './proxy/urlBuilder';
import { generateModelPlaceholderId, toSlug } from './proxy/idGenerator';
import { expandModelsWithEffort } from './proxy/effortExpander';
import { resolveGoogleIp } from './proxy/dnsResolver';
import { markProviderRateLimited } from './proxy/modelRouter';
import { trimContextPayload } from './proxy/contextTrimmer';
import { checkAllModelsHealth, getFastOrCachedHealth } from './proxy/modelHealthChecker';
import { recordRecentModel, restoreRecentModels } from './proxy/recentModelsStore';
import { mcpListServers, mcpCallTool } from './proxy/mcpRelay';
import {
  getValidGoogleAccessToken,
  normalizeCloudCodeModelId,
  normalizeGoogleModelId,
  isGoogleCloudCodeModel,
  sanitizeCloudCodeGenerationConfig,
  normalizeConversationTurns,
  prewarmGoogleAccounts,
  isTokenCached,
  isTokenRevoked,
  getLiveAccountQuota,
  updateLiveAccountQuota,
  pollAllGoogleQuotas,
  AccountLiveQuota,
} from './services/googleAuth';
import { safeWriteHead, safeEnd } from './proxy/httpUtils';
import {
  mergeModels,
  getMappedCustomModels,
  getCustomModelsList,
  injectCustomSlugsIntoAgentModelSorts,
  buildSyntheticModelsResponse,
} from './proxy/modelInjector';
import { detectModelCapabilities } from './proxy/modelUtils';

function traceLog(...args: unknown[]): void {
  // ponytail: keeps the 'app' import (and thus the electron require) out of
  // proxy.ts's module graph when tracing is disabled; upgrade path: replace
  // with a real log-level switch if verbose tracing is ever needed.
  if (process.env.AG_PROXY_TRACE === '1') {
    // eslint-disable-next-line no-console
    console.log('[proxy-trace]', ...args);
  }
}

const proxyLog = createLogger('Proxy');

/** 16-char hex request id used for tracing. Cheap, sortable by time. */
function newTraceId(): string {
  return randomBytes(8).toString('hex');
}

let server: http.Server | null = null;
let proxyPort = 0;
let isRemoteVpsActive = false;
let remoteVpsHost = DEFAULT_REMOTE_HOST;
let remoteVpsToken = DEFAULT_REMOTE_TOKEN;
let remoteSessionsMap: Record<string, boolean> = {};

function getRemoteStatePath(): string {
  const home = os.homedir();
  const dir = path.join(home, '.gemini', 'antigravity');
  if (!fs.existsSync(dir)) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {
      log.warn('[Proxy] Failed to create ~/.gemini/antigravity dir:', e);
    }
  }
  return path.join(dir, 'remote_vps_state.json');
}

function ensureRemoteExecScriptOnDisk(): void {
  try {
    const targetDir = path.join(os.homedir(), '.gemini', 'antigravity', 'scripts');
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    const targetPath = path.join(targetDir, 'remote-exec.js');
    const candidates = [
      path.resolve(__dirname, '../scripts/remote-exec.js'),
      path.resolve(__dirname, '../../scripts/remote-exec.js'),
      path.resolve(__dirname, 'scripts/remote-exec.js'),
    ];
    for (const src of candidates) {
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, targetPath);
        break;
      }
    }
  } catch (e) {
    log.warn('[Proxy] Could not sync remote-exec.js to ~/.gemini/antigravity/scripts:', e);
  }
}

function loadRemoteState(): void {
  try {
    ensureRemoteExecScriptOnDisk();
    const p = getRemoteStatePath();
    if (fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
      isRemoteVpsActive = !!data.active;
      if (data.host) remoteVpsHost = String(data.host);
      if (data.token && data.token !== 'null' && data.token !== 'undefined' && String(data.token).trim().length > 0) {
        remoteVpsToken = String(data.token).trim();
      } else {
        remoteVpsToken = DEFAULT_REMOTE_TOKEN;
      }
      if (data.remoteSessions && typeof data.remoteSessions === 'object') {
        remoteSessionsMap = data.remoteSessions;
      }
      log.info(`[Proxy] Loaded Remote VPS state: active=${isRemoteVpsActive}, host=${remoteVpsHost}, tokenSet=${!!remoteVpsToken}, remoteSessionsCount=${Object.keys(remoteSessionsMap).length}`);
    }
  } catch (e) {
    log.warn('[Proxy] Failed to load remote VPS state from disk:', e);
  }
}

function saveRemoteState(): void {
  try {
    const p = getRemoteStatePath();
    fs.writeFileSync(p, JSON.stringify({
      active: isRemoteVpsActive,
      host: remoteVpsHost,
      token: remoteVpsToken || DEFAULT_REMOTE_TOKEN,
      remoteSessions: remoteSessionsMap,
    }, null, 2), 'utf-8');
  } catch (e) {
    log.warn('[Proxy] Failed to save remote VPS state to disk:', e);
  }
}

// ─── loadCodeAssist Cache (Login Resilience) ────────────────────────────────

let memoryLoadCodeAssistCache: string | null = null;
let memoryLoadCodeAssistTime = 0;

function getLoadCodeAssistCachePath(): string {
  const home = os.homedir();
  const dir = path.join(home, '.gemini', 'antigravity');
  if (!fs.existsSync(dir)) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {
      log.warn('[Proxy] Failed to create cache directory:', e);
    }
  }
  return path.join(dir, 'load_code_assist_cache.json');
}

function loadCachedCodeAssist(): string | null {
  if (memoryLoadCodeAssistCache) return memoryLoadCodeAssistCache;
  try {
    const p = getLoadCodeAssistCachePath();
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, 'utf-8').trim();
      if (content.startsWith('{')) {
        memoryLoadCodeAssistCache = content;
        return content;
      }
    }
  } catch (e) {
    log.debug('[Proxy] Failed to load cached code assist:', e);
  }
  return null;
}

function saveCachedCodeAssist(content: string): void {
  try {
    memoryLoadCodeAssistCache = content;
    memoryLoadCodeAssistTime = Date.now();
    const p = getLoadCodeAssistCachePath();
    fs.writeFileSync(p, content, 'utf-8');
  } catch (e) {
    log.warn('[Proxy] Failed to save cached code assist:', e);
  }
}

export async function executeOnRemoteDaemon(
  rawHost: string,
  token: string,
  command: string,
  workspaceId?: string,
  sessionId?: string,
  timeoutMs = 15000,
): Promise<{ ok: boolean; stdout: string; stderr: string; exitCode: number; error?: string }> {
  let cleanHost = (rawHost || DEFAULT_REMOTE_HOST).trim().replace(/\/+$/, '');
  if (!cleanHost.startsWith('http://') && !cleanHost.startsWith('https://')) {
    cleanHost = 'https://' + cleanHost;
  }
  const url = new URL(cleanHost + '/v2/terminal/exec');
  const isHttps = url.protocol === 'https:';
  const transport = isHttps ? https : http;

  const payload = JSON.stringify({
    command,
    workspaceId: (workspaceId && workspaceId !== 'default') ? workspaceId : 'antigravity-add-model-main',
    sessionId: sessionId || '',
    timeoutMs,
  });

  return new Promise((resolve) => {
    const r = transport.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          Authorization: `Bearer ${token || DEFAULT_REMOTE_TOKEN}`,
          'User-Agent': 'AntigravityPatchProxy/3.6.0',
        },
        timeout: timeoutMs,
      },
      (resp) => {
        const chunks: Buffer[] = [];
        resp.on('data', (c) => chunks.push(c));
        resp.on('end', () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
            resolve(data);
          } catch {
            const raw = Buffer.concat(chunks).toString('utf-8');
            resolve({
              ok: resp.statusCode === 200,
              stdout: raw,
              stderr: '',
              exitCode: resp.statusCode === 200 ? 0 : 1,
            });
          }
        });
      },
    );

    r.on('error', (err) => {
      resolve({ ok: false, stdout: '', stderr: err.message, exitCode: 1, error: err.message });
    });

    r.on('timeout', () => {
      r.destroy();
      resolve({ ok: false, stdout: '', stderr: 'Request timed out', exitCode: 124, error: 'timeout' });
    });

    r.write(payload);
    r.end();
  });
}

// Initialize on boot
loadRemoteState();

function generateGracefulMarkdown(diagnostic: ErrorDiagnostic, model?: CustomModel): string {
  const alertType = diagnostic.severity === 'warning' ? 'WARNING' : 'CAUTION';
  const rawTitle = diagnostic.title.replace(/^Model unavailable:\s*/i, '');
  const title = `Model unavailable: ${rawTitle}`;

  let md = `> [!${alertType}]\n`;
  md += `> **${title}**\n>\n`;
  if (model) {
    const modelName = model.displayName || model.name;
    const providerStr = model.provider ? ` · **Provider:** \`${model.provider}\`` : '';
    md += `> **Model:** \`${modelName}\`${providerStr}\n>\n`;
  }
  md += `> ${diagnostic.message}\n`;

  if (diagnostic.suggestions && diagnostic.suggestions.length > 0) {
    md += `>\n> **Suggested Actions:**\n`;
    diagnostic.suggestions.forEach(s => {
      md += `> - ${s}\n`;
    });
  }

  if (diagnostic.actionUrl) {
    md += `>\n> 🔗 [Manage Billing & Credits](${diagnostic.actionUrl})\n`;
  }

  md += `\n<span class="ag-system-error-marker" data-type="${diagnostic.errorType}" style="display:none;"></span>`;
  return md;
}



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



function sendGracefulStreamError(res: http.ServerResponse, diagnostic: ErrorDiagnostic, model?: CustomModel): void {
  if (res.writableEnded) return;
  const errResponse = {
    response: {
      candidates: [
        {
          content: { parts: [{ text: generateGracefulMarkdown(diagnostic, model) }], role: 'model' },
          finishReason: 'STOP',
          index: 0,
        },
      ],
    },
    traceId: '',
    metadata: {},
    _agDiagnostic: diagnostic,
  };
  sanitizeCandidatesInResponse(errResponse);
  if (!res.headersSent) {
    safeWriteHead(res, 200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-AG-Error-Type': diagnostic.errorType,
    });
  }
  writeSafeSseChunk(res, errResponse);
  safeEnd(res);
}

function sendGracefulNonStreamError(res: http.ServerResponse, diagnostic: ErrorDiagnostic, model?: CustomModel): void {
  if (res.writableEnded) return;
  const errResponse = {
    response: {
      candidates: [
        {
          content: { parts: [{ text: generateGracefulMarkdown(diagnostic, model) }], role: 'model' },
          finishReason: 'STOP',
          index: 0,
        },
      ],
    },
    traceId: '',
    metadata: {},
    _agDiagnostic: diagnostic,
  };
  sanitizeCandidatesInResponse(errResponse);
  if (!res.headersSent) {
    safeWriteHead(res, 200, {
      'Content-Type': 'application/json',
      'X-AG-Error-Type': diagnostic.errorType,
    });
  }
  safeEnd(res, JSON.stringify(errResponse));
}

/**
 * Dispatch error response based on stream mode.
 * Prefers explicit stream or non-stream call at call sites to avoid boolean flags.
 */
function sendGracefulError(res: http.ServerResponse, isStream: boolean, diagnostic: ErrorDiagnostic, model?: CustomModel): void {
  if (isStream) {
    sendGracefulStreamError(res, diagnostic, model);
  } else {
    sendGracefulNonStreamError(res, diagnostic, model);
  }
}

// ─── Model Helpers ────────────────────────────────────────────────────────

// generateModelPlaceholderId and toSlug are now in ./proxy/idGenerator.ts (re-exported above)

// ─── Google Proxy ─────────────────────────────────────────────────────────

export function sanitizeCandidatesInResponse(data: any): boolean {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  let modified = false;

  // 1. Antigravity Language Server crash protection:
  // In codeassistclient.(*CodeAssistClient).getStreamingTextCompletion-range1 at generation.go:673,
  // the Go language server unmarshals v1internal_prediction_service_go_proto.GenerateContentResponse
  // and accesses resp.Response.UsageMetadata at offset 0x50 without checking if resp.Response is nil.
  // If data.response is absent or null, resp.Response is nil, triggering panic 0xc0000005 (addr 0x50),
  // which crashes the language server and causes Antigravity IDE to reload.
  // Ensure data.response is ALWAYS a non-null object.
  if (!data.response || typeof data.response !== 'object') {
    data.response = {};
    modified = true;
  }

  // 2. Mirror candidates between root and data.response
  if (Array.isArray(data.candidates) && (!Array.isArray(data.response.candidates) || data.response.candidates.length === 0)) {
    data.response.candidates = data.candidates;
    modified = true;
  } else if (Array.isArray(data.response.candidates) && (!Array.isArray(data.candidates) || data.candidates.length === 0)) {
    data.candidates = data.response.candidates;
    modified = true;
  }
  if (!Array.isArray(data.response.candidates)) {
    data.response.candidates = [];
    modified = true;
  }
  if (!Array.isArray(data.candidates)) {
    data.candidates = data.response.candidates;
    modified = true;
  }

  // 3. Guarantee usageMetadata is non-null on both root and data.response to prevent nil dereference at generation.go:673
  if (!data.response.usageMetadata || typeof data.response.usageMetadata !== 'object') {
    data.response.usageMetadata = data.usageMetadata && typeof data.usageMetadata === 'object'
      ? data.usageMetadata
      : { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 };
    modified = true;
  }
  if (!data.usageMetadata || typeof data.usageMetadata !== 'object') {
    data.usageMetadata = data.response.usageMetadata;
    modified = true;
  }

  // 4. Mirror promptFeedback between root and data.response
  if (data.promptFeedback && !data.response.promptFeedback) {
    data.response.promptFeedback = data.promptFeedback;
    modified = true;
  } else if (data.response.promptFeedback && !data.promptFeedback) {
    data.promptFeedback = data.response.promptFeedback;
    modified = true;
  }

  // 5. Mirror modelVersion
  if (data.modelVersion && !data.response.modelVersion) {
    data.response.modelVersion = data.modelVersion;
    modified = true;
  } else if (data.response.modelVersion && !data.modelVersion) {
    data.modelVersion = data.response.modelVersion;
    modified = true;
  }

  const sanitizeList = (candidatesList: any[], container: any, key: string): any[] => {
    if (!Array.isArray(candidatesList)) return [];
    let filtered = candidatesList.filter((c) => c && typeof c === 'object');
    if (filtered.length !== candidatesList.length) {
      container[key] = filtered;
      modified = true;
    }
    if (candidatesList.length === 0) {
      filtered = [{ content: { parts: [{ text: '' }], role: 'model' }, index: 0 }];
      container[key] = filtered;
      modified = true;
    }
    for (const cand of filtered) {
      if (!cand.content || typeof cand.content !== 'object') {
        cand.content = { parts: [{ text: '' }], role: 'model' };
        modified = true;
      } else {
        if (!Array.isArray(cand.content.parts) || cand.content.parts.length === 0) {
          cand.content.parts = [{ text: '' }];
          modified = true;
        } else {
          for (let pIdx = 0; pIdx < cand.content.parts.length; pIdx++) {
            const p = cand.content.parts[pIdx];
            if (!p || typeof p !== 'object') {
              cand.content.parts[pIdx] = { text: '' };
              modified = true;
            } else if (
              p.text === undefined &&
              !p.functionCall &&
              !p.functionResponse &&
              !p.fileData &&
              !p.inlineData &&
              !p.executableCode &&
              !p.codeExecutionResult
            ) {
              p.text = '';
              modified = true;
            }
          }
        }
        if (!cand.content.role) {
          cand.content.role = 'model';
          modified = true;
        }
      }
    }
    return filtered;
  };

  if (data.candidates) {
    data.candidates = sanitizeList(data.candidates, data, 'candidates');
  }
  if (data.response && typeof data.response === 'object' && data.response.candidates) {
    data.response.candidates = sanitizeList(data.response.candidates, data.response, 'candidates');
  }

  return modified;
}

export function writeSafeSseChunk(res: http.ServerResponse, chunk: any): boolean {
  if (res.writableEnded || res.destroyed) return false;
  if (Array.isArray(chunk)) {
    let ok = true;
    for (const item of chunk) {
      if (item && typeof item === 'object') {
        ok = writeSafeSseChunk(res, item) && ok;
      }
    }
    return ok;
  }
  sanitizeCandidatesInResponse(chunk);
  try {
    return res.write('data: ' + JSON.stringify(chunk) + '\n\n');
  } catch (err) {
    log.warn('[Proxy] writeSafeSseChunk failed:', (err as Error).message);
    return false;
  }
}

export function transformGoogleStreamForRemote(
  proxyRes: http.IncomingMessage,
  clientRes: http.ServerResponse,
  convId = '',
  isRemote = true,
): void {
  const headers = { ...proxyRes.headers };
  delete headers['content-length'];
  delete headers['content-encoding'];
  safeWriteHead(clientRes, proxyRes.statusCode || 200, headers as Record<string, string>);

  const encoding = (proxyRes.headers['content-encoding'] || '').toLowerCase();
  let stream: NodeJS.ReadableStream = proxyRes;
  if (encoding === 'gzip') {
    const gunzip = zlib.createGunzip();
    proxyRes.pipe(gunzip);
    stream = gunzip;
  } else if (encoding === 'deflate') {
    const inflate = zlib.createInflate();
    proxyRes.pipe(inflate);
    stream = inflate;
  }

  const decoder = new StringDecoder('utf-8');
  let buffer = '';

  let sawFinishReason = false;
  const inspectFinishReason = (obj: any): void => {
    if (!obj || typeof obj !== 'object') return;
    const cands = obj.candidates || (obj.response && obj.response.candidates);
    if (Array.isArray(cands)) {
      for (const c of cands) {
        if (c && c.finishReason) {
          sawFinishReason = true;
          return;
        }
      }
    }
  };

  const processLine = (line: string): void => {
    const trimmed = line.trimEnd();
    if (trimmed.startsWith('data:')) {
      const jsonStr = trimmed.slice(5).trim();
      if (jsonStr === '[DONE]') {
        // Drop OpenAI-style [DONE] marker — Google Language Server parses all SSE data as protojson
        // messages (GenerateContentResponse) and crashes with "proto: syntax error (line 1:1): unexpected token [" if it receives [DONE].
        return;
      }
      if (!jsonStr) {
        clientRes.write(': ping\n');
        return;
      }
      try {
        const data = JSON.parse(jsonStr);
        // If data is an array of responses, unwrap each item individually to avoid emitting a JSON array as a proto message
        if (Array.isArray(data)) {
          const eol = line.endsWith('\r') ? '\r\n' : '\n';
          for (const item of data) {
            if (item && typeof item === 'object') {
              inspectFinishReason(item);
              extractAndCacheThoughtSignatures(item, convId);
              sanitizeCandidatesInResponse(item);
              clientRes.write('data: ' + JSON.stringify(item) + eol);
            }
          }
          return;
        }

        // Cache any thought_signature values from this response chunk
        inspectFinishReason(data);
        extractAndCacheThoughtSignatures(data, convId);

        // Antigravity Language Server crash protection:
        // In codeassistclient.(*CodeAssistClient).getStreamingTextCompletion-range1,
        // the language server iterates over chunk.Candidates and accesses
        // candidate.Content.Parts at offset 0x50 without nil checking.
        // If Content or Parts is missing/nil/empty, Go panics with signal 0xc0000005.
        sanitizeCandidatesInResponse(data);
        const eol = line.endsWith('\r') ? '\r\n' : '\n';
        clientRes.write('data: ' + JSON.stringify(data) + eol);
        return;
      } catch (e) {
        log.warn('[Proxy] Malformed SSE data chunk from upstream Google:', jsonStr.slice(0, 100));
        return;
      }
    }
    // Only forward valid SSE control lines or empty lines.
    // Never forward arbitrary raw text (like raw JSON brackets '[' or '{') into the SSE stream!
    if (trimmed.startsWith(':') || trimmed.startsWith('event:') || trimmed.startsWith('id:') || trimmed.startsWith('retry:') || !trimmed) {
      clientRes.write(line + '\n');
    } else {
      log.debug('[Proxy] Suppressed non-SSE upstream line from stream:', trimmed.slice(0, 60));
    }
  };

  stream.on('data', (chunk: Buffer) => {
    buffer += decoder.write(chunk);
    let lineEndIdx: number;
    while ((lineEndIdx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, lineEndIdx);
      buffer = buffer.slice(lineEndIdx + 1);
      processLine(line);
    }
  });

  stream.on('end', () => {
    buffer += decoder.end();
    if (buffer.length > 0) {
      processLine(buffer);
      if (buffer.trim().startsWith('data:') && buffer.trim().slice(5).trim() !== '[DONE]') {
        clientRes.write('\n\n');
      }
      buffer = '';
    }
    if (!sawFinishReason && !clientRes.writableEnded) {
      const finalChunk = {
        response: {
          candidates: [
            {
              content: { parts: [{ text: '' }], role: 'model' },
              finishReason: 'STOP',
              index: 0,
            },
          ],
        },
        traceId: '',
        metadata: {},
      };
      sanitizeCandidatesInResponse(finalChunk);
      writeSafeSseChunk(clientRes, finalChunk);
    }
    safeEnd(clientRes);
  });

  stream.on('error', (err) => {
    log.error('[Proxy] Upstream Google stream error:', err);
    if (!sawFinishReason && !clientRes.writableEnded && !clientRes.destroyed) {
      const finalChunk = {
        response: {
          candidates: [
            {
              content: { parts: [{ text: '' }], role: 'model' },
              finishReason: 'STOP',
              index: 0,
            },
          ],
        },
        traceId: '',
        metadata: {},
      };
      sanitizeCandidatesInResponse(finalChunk);
      writeSafeSseChunk(clientRes, finalChunk);
      safeEnd(clientRes);
    } else {
      clientRes.destroy(err);
    }
  });
}

// ─── Thought Signature Cache Helpers ──────────────────────────────────────

async function proxyToGoogle(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  reqBody: Buffer,
  isRemoteSession = false,
  customAuthHeader?: string,
  convId = '',
  hostOverride?: string,
): Promise<void> {
  const traceId = newTraceId();
  const isCloudCodeUrl = req.url!.includes('v1internal') || req.url!.includes('daily-cloudcode');
  const targetHost = hostOverride || (isCloudCodeUrl ? GOOGLE_HOSTS.CLOUD_CODE : GOOGLE_HOSTS.GENERATIVE_LANGUAGE);
  const targetUrl = `https://${targetHost}`;
  const parsedUrl = new URL(req.url!, targetUrl);
  const endTimer = metricTimer('proxy_request_ms', { upstream: targetHost });
  proxyLog.debug('req', traceId, req.method, req.url, '→', targetHost);

  try {
    const realIp = await resolveGoogleIp(targetHost);
    parsedUrl.hostname = realIp;
  } catch (e) {
    metricInc('proxy_errors_total', { upstream: targetHost, stage: 'dns', trace_id: traceId });
    const ms = endTimer();
    proxyLog.error('DNS resolution failed for', targetHost, 'traceId=', traceId, '(in', ms, 'ms)');
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
  headers['content-length'] = String(reqBody.length);
  delete headers['connection'];
  delete headers['keep-alive'];
  if (customAuthHeader) {
    headers['authorization'] = customAuthHeader;
    headers['Authorization'] = customAuthHeader;
  }
  if (isCloudCodeUrl) {
    headers['user-agent'] = 'antigravity';
    headers['User-Agent'] = 'antigravity';
  }

  const isGeneration = req.url!.includes('generateContent') || req.url!.includes('streamGenerateContent');
  const shouldBufferAndModify = isCloudCodeUrl && !isGeneration;

  if (shouldBufferAndModify || isGeneration) {
    delete headers['accept-encoding'];
    delete headers['Accept-Encoding'];
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
    proxyReq.setTimeout(0);
    if (!hostOverride && isCloudCodeUrl && (proxyRes.statusCode === 503 || proxyRes.statusCode === 502)) {
      log.warn(`[Proxy] Google Cloud Code returned ${proxyRes.statusCode} on ${targetHost}. Auto-failing over to production endpoint ${GOOGLE_HOSTS.CLOUD_CODE_PROD}...`);
      proxyToGoogle(req, res, reqBody, isRemoteSession, customAuthHeader, convId, GOOGLE_HOSTS.CLOUD_CODE_PROD);
      return;
    }

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

        if (req.url!.includes('loadCodeAssist') && proxyRes.statusCode === 200 && text.startsWith('{')) {
          saveCachedCodeAssist(text);
        }

        if (safeWriteHead(res, proxyRes.statusCode || 200, modifiedHeaders as Record<string, string>)) {
          safeEnd(res, modifiedBuffer);
        }
      });
    } else if (isGeneration) {
      const isStream = req.url!.includes('streamGenerateContent') || req.url!.includes('alt=sse');
      if (isStream) {
        transformGoogleStreamForRemote(proxyRes, res, convId, isRemoteSession);
      } else {
        const responseChunks: Buffer[] = [];
        proxyRes.on('data', (chunk) => responseChunks.push(chunk));
        proxyRes.on('end', () => {
          if (res.headersSent || res.writableEnded) return;
          const fullResBody = Buffer.concat(responseChunks);
          let text = fullResBody.toString('utf-8');
          try {
            const data = JSON.parse(text);
            // Cache any thought_signature values from this response
            extractAndCacheThoughtSignatures(data, convId);
            if (sanitizeCandidatesInResponse(data)) {
              text = JSON.stringify(data);
            }
          } catch (_) {}
          const modifiedHeaders = { ...proxyRes.headers };
          delete modifiedHeaders['content-encoding'];
          delete modifiedHeaders['transfer-encoding'];
          const modifiedBuffer = Buffer.from(text, 'utf-8');
          modifiedHeaders['content-length'] = String(modifiedBuffer.length);
          if (safeWriteHead(res, proxyRes.statusCode || 200, modifiedHeaders as Record<string, string>)) {
            safeEnd(res, modifiedBuffer);
          }
        });
      }
    } else {
      if (safeHead(proxyRes.statusCode || 200, proxyRes.headers as Record<string, string>)) {
        proxyRes.pipe(res);
      }
    }
  });

  proxyReq.on('error', (err) => {
    if (!hostOverride && isCloudCodeUrl && !res.headersSent && !res.writableEnded) {
      log.warn(`[Proxy] Google Cloud Code network error on ${targetHost} (${err.message}). Auto-failing over to production endpoint ${GOOGLE_HOSTS.CLOUD_CODE_PROD}...`);
      proxyToGoogle(req, res, reqBody, isRemoteSession, customAuthHeader, convId, GOOGLE_HOSTS.CLOUD_CODE_PROD);
      return;
    }
    metricInc('proxy_errors_total', { upstream: targetHost, stage: 'forward', trace_id: traceId });
    const ms = endTimer();
    proxyLog.error('Google forwarding error traceId=', traceId, 'after', ms, 'ms:', err.message);
    log.error('[Proxy] Google Forwarding Error:', err);
    if (safeWriteHead(res, 500, { 'Content-Type': 'application/json' })) {
      safeEnd(res, JSON.stringify({ error: { message: 'Proxy forwarding failed: ' + err.message, traceId } }));
    }
  });

  proxyReq.on('close', () => {
    const ms = endTimer();
    metricObserve('proxy_upstream_ms', ms, { upstream: targetHost, trace_id: traceId });
    proxyLog.debug('Upstream request closed traceId=', traceId, 'after', ms, 'ms');
  });

  proxyReq.setTimeout(25_000, () => {
    log.error(`[Proxy] Google proxy request timed out after 25s (${req.method} ${req.url})`);
    proxyReq.destroy();
    if (safeHead(504, { 'Content-Type': 'application/json' })) {
      safeEnd(res, JSON.stringify({ error: { message: 'Google API request timed out' } }));
    }
  });

  if (reqBody) {
    proxyReq.write(reqBody);
  }
  proxyReq.end();
}

export interface GoogleRequestOutcome {
  success: boolean;
  statusCode?: number;
  error?: string;
  headers?: http.IncomingHttpHeaders;
}

export function executeGoogleCloudCodeRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  reqBody: Buffer,
  isRemoteSession = false,
  customAuthHeader?: string,
  convId = '',
  hostOverride?: string,
): Promise<GoogleRequestOutcome> {
  return new Promise((resolve) => {
    const traceId = newTraceId();
    const isCloudCodeUrl = req.url!.includes('v1internal') || req.url!.includes('daily-cloudcode') || req.url!.includes('cloudcode');
    const targetHost = hostOverride || (isCloudCodeUrl ? GOOGLE_HOSTS.CLOUD_CODE : GOOGLE_HOSTS.GENERATIVE_LANGUAGE);
    const targetUrl = `https://${targetHost}`;
    const parsedUrl = new URL(req.url!, targetUrl);
    const endTimer = metricTimer('proxy_request_ms', { upstream: targetHost });

    let settled = false;
    let proxyReq: http.ClientRequest | undefined;
    const finish = (outcome: GoogleRequestOutcome) => {
      if (settled) return;
      settled = true;
      if (proxyReq) {
        try { proxyReq.setTimeout(0); } catch (_) {}
      }
      resolve(outcome);
    };

    resolveGoogleIp(targetHost).then((realIp) => {
      parsedUrl.hostname = realIp;

      const headers: Record<string, string | string[] | undefined> = {
        ...(req.headers as Record<string, string | string[] | undefined>),
      };
      headers['host'] = targetHost;
      headers['content-length'] = String(reqBody.length);
      delete headers['connection'];
      delete headers['keep-alive'];
      if (customAuthHeader) {
        headers['authorization'] = customAuthHeader;
        headers['Authorization'] = customAuthHeader;
      }
      if (isCloudCodeUrl) {
        headers['user-agent'] = 'antigravity';
        headers['User-Agent'] = 'antigravity';
      }

      const isGeneration = req.url!.includes('generateContent') || req.url!.includes('streamGenerateContent');
      const isStream = req.url!.includes('streamGenerateContent') || req.url!.includes('alt=sse');
      const shouldBufferAndModify = isCloudCodeUrl && !isGeneration;

      if (shouldBufferAndModify || isGeneration) {
        delete headers['accept-encoding'];
        delete headers['Accept-Encoding'];
      }

      const options: https.RequestOptions = {
        method: req.method,
        headers: headers as Record<string, string>,
        servername: targetHost,
      };

      proxyReq = https.request(parsedUrl, options, (proxyRes) => {
        // Disable request socket timeout once response headers start streaming in
        proxyReq?.setTimeout(0);

        const status = proxyRes.statusCode || 200;

        // If upstream error (429, 400, 401, 403, 404, 500, 503):
        // Intercept BEFORE writing anything to client res!
        if (status >= 400) {
          if (!hostOverride && isCloudCodeUrl && (status === 503 || status === 502)) {
            log.warn(`[Proxy] Google Cloud Code returned ${status} on ${targetHost}. Auto-failing over to production endpoint ${GOOGLE_HOSTS.CLOUD_CODE_PROD}...`);
            executeGoogleCloudCodeRequest(req, res, reqBody, isRemoteSession, customAuthHeader, convId, GOOGLE_HOSTS.CLOUD_CODE_PROD)
              .then(finish);
            return;
          }

          const errChunks: Buffer[] = [];
          proxyRes.on('data', (c: Buffer) => errChunks.push(c));
          proxyRes.on('end', () => {
            const errText = Buffer.concat(errChunks).toString('utf-8');
            finish({ success: false, statusCode: status, error: errText, headers: proxyRes.headers });
          });
          return;
        }

        // Upstream returned 2xx: Success!
        if (shouldBufferAndModify) {
          const responseChunks: Buffer[] = [];
          proxyRes.on('data', (chunk: Buffer) => responseChunks.push(chunk));
          proxyRes.on('end', () => {
            if (res.headersSent || res.writableEnded) {
              finish({ success: true, statusCode: status });
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
                if (safeWriteHead(res, 502, { 'Content-Type': 'application/json' })) {
                  safeEnd(res, JSON.stringify({ error: { message: `Decompression failed: ${(e as Error).message}` } }));
                }
                finish({ success: true, statusCode: 502 });
                return;
              }
            } else {
              text = fullResBody.toString('utf-8');
            }

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

            if (safeWriteHead(res, status, modifiedHeaders as Record<string, string>)) {
              safeEnd(res, modifiedBuffer);
            }
            finish({ success: true, statusCode: status });
          });
        } else if (isGeneration) {
          if (isStream) {
            transformGoogleStreamForRemote(proxyRes, res, convId, isRemoteSession);
            finish({ success: true, statusCode: status });
          } else {
            const responseChunks: Buffer[] = [];
            proxyRes.on('data', (chunk: Buffer) => responseChunks.push(chunk));
            proxyRes.on('end', () => {
              if (res.headersSent || res.writableEnded) {
                finish({ success: true, statusCode: status });
                return;
              }
              const fullResBody = Buffer.concat(responseChunks);
              let text = fullResBody.toString('utf-8');
              try {
                const data = JSON.parse(text);
                extractAndCacheThoughtSignatures(data, convId);
                let modified = sanitizeCandidatesInResponse(data);
                if (isRemoteSession && Array.isArray(data.candidates)) {
                  for (const cand of data.candidates) {
                    if (cand?.content?.parts && Array.isArray(cand.content.parts)) {
                      for (const part of cand.content.parts) {
                        if (part.functionCall) {
                          const fnName = (part.functionCall.name || '').toLowerCase();
                          const isRunCmd =
                            fnName === 'run_command' ||
                            fnName.endsWith(':run_command') ||
                            fnName === 'bash' ||
                            fnName === 'sh' ||
                            fnName.endsWith(':bash') ||
                            fnName.endsWith(':sh');
                          if (isRunCmd) {
                            const args = part.functionCall.args as Record<string, unknown> | undefined;
                            if (args) {
                              const originalCmd = (args.CommandLine || args.commandLine || args.command || args.cmd) as string | undefined;
                              if (typeof originalCmd === 'string' && originalCmd.trim()) {
                                const remoteCwd = (args.Cwd || args.cwd) as string | undefined;
                                // REMOTE EXECUTION DISABLED BY USER REQUEST
                                // const wrapped = wrapCommandForRemoteExec(originalCmd.trim(), remoteCwd);
                                // if (wrapped !== originalCmd) {
                                //   args.CommandLine = wrapped;
                                //   if (args.commandLine !== undefined) args.commandLine = wrapped;
                                //   if (args.command !== undefined) args.command = wrapped;
                                //   if (args.cmd !== undefined) args.cmd = wrapped;
                                //   if (args.Cwd !== undefined) args.Cwd = '.';
                                //   if (args.cwd !== undefined) args.cwd = '.';
                                //   modified = true;
                                //   log.info(`[Proxy] Google Cloud Code JSON: Bridged run_command "${originalCmd}" (cwd=${remoteCwd || '.'}) -> remote VPS`);
                                // }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
                if (modified) {
                  text = JSON.stringify(data);
                }
              } catch (_) {}
              const modifiedHeaders = { ...proxyRes.headers };
              delete modifiedHeaders['content-encoding'];
              delete modifiedHeaders['transfer-encoding'];
              const modifiedBuffer = Buffer.from(text, 'utf-8');
              modifiedHeaders['content-length'] = String(modifiedBuffer.length);
              if (safeWriteHead(res, status, modifiedHeaders as Record<string, string>)) {
                safeEnd(res, modifiedBuffer);
              }
              finish({ success: true, statusCode: status });
            });
          }
        } else {
          if (safeWriteHead(res, status, proxyRes.headers as Record<string, string>)) {
            proxyRes.pipe(res);
          }
          finish({ success: true, statusCode: status });
        }
      });

      proxyReq.on('error', (err) => {
        if (!hostOverride && isCloudCodeUrl && !res.headersSent && !res.writableEnded) {
          log.warn(`[Proxy] Google Cloud Code network error on ${targetHost} (${err.message}). Auto-failing over to production endpoint ${GOOGLE_HOSTS.CLOUD_CODE_PROD}...`);
          executeGoogleCloudCodeRequest(req, res, reqBody, isRemoteSession, customAuthHeader, convId, GOOGLE_HOSTS.CLOUD_CODE_PROD)
            .then(finish);
          return;
        }
        metricInc('proxy_errors_total', { upstream: targetHost, stage: 'forward', trace_id: traceId });
        const ms = endTimer();
        proxyLog.error('Google forwarding error traceId=', traceId, 'after', ms, 'ms:', err.message);
        finish({ success: false, statusCode: 502, error: 'Proxy forwarding failed: ' + err.message });
      });

      proxyReq.on('close', () => {
        const ms = endTimer();
        metricObserve('proxy_upstream_ms', ms, { upstream: targetHost, trace_id: traceId });
      });

      proxyReq.setTimeout(GOOGLE_PROXY_TIMEOUT_MS, () => {
        log.error(`[Proxy] Google pool request timed out waiting for response headers after ${GOOGLE_PROXY_TIMEOUT_MS / 1000}s`);
        proxyReq?.destroy();
        finish({ success: false, statusCode: 504, error: 'Google API request timed out' });
      });

      if (reqBody) {
        proxyReq.write(reqBody);
      }
      proxyReq.end();
    }).catch((dnsErr) => {
      metricInc('proxy_errors_total', { upstream: targetHost, stage: 'dns', trace_id: traceId });
      const ms = endTimer();
      proxyLog.error('DNS resolution failed for', targetHost, 'traceId=', traceId, '(in', ms, 'ms)');
      finish({ success: false, statusCode: 500, error: 'DNS resolution failed: ' + (dnsErr as Error).message });
    });
  });
}

export async function executeGoogleCloudCodeWithPool(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  reqJson: Record<string, unknown>,
  accountPool: CustomModel[],
  isSessionRemote: boolean,
  convId: string,
  sessId: string | null,
): Promise<boolean> {
  const targetRaw = String(reqJson.model || (reqJson.request as any)?.model || '');
  const isClaude = targetRaw.toLowerCase().includes('claude');
  const modelFamily = isClaude ? 'claude' : 'gemini';

  const sortedAccounts = [...accountPool].sort((a, b) => {
    const cdA = isAccountInCooldown(a, modelFamily) ? 1 : 0;
    const cdB = isAccountInCooldown(b, modelFamily) ? 1 : 0;
    if (cdA !== cdB) return cdA - cdB;
    const breakerA = getOpenBreaker(a) ? 1 : 0;
    const breakerB = getOpenBreaker(b) ? 1 : 0;
    if (breakerA !== breakerB) return breakerA - breakerB;
    return getAccountDynamicScore(b, modelFamily) - getAccountDynamicScore(a, modelFamily);
  });

  let boundAccount: CustomModel | undefined;
  if (sessId) {
    boundAccount = sortedAccounts.find((m) => {
      const affinity = sessionAffinities.get(sessId);
      return affinity && getAccountQuotaKey(m) === affinity.accountKey && !getOpenBreaker(m) && !isAccountInCooldown(m, modelFamily) && getModelQuotaScore(m) > 0;
    });
    if (boundAccount) {
      const idx = sortedAccounts.indexOf(boundAccount);
      if (idx > 0) {
        sortedAccounts.splice(idx, 1);
        sortedAccounts.unshift(boundAccount);
      }
    }
  }

  // If no bound account from session affinity, use P2C to pick the lead account among top available
  if (!boundAccount && sortedAccounts.length > 1) {
    const lead = selectCandidateP2C(sortedAccounts, modelFamily);
    if (lead) {
      const idx = sortedAccounts.indexOf(lead);
      if (idx > 0) {
        sortedAccounts.splice(idx, 1);
        sortedAccounts.unshift(lead);
      }
    }
  }

  // If the pool has eligible accounts but all are temporarily saturated by in-flight concurrency,
  // wait up to 1500ms in a micro-wait queue for an in-flight slot to release before attempting requests.
  const hasEligibleAccounts = sortedAccounts.some(
    (a) => !isAccountInCooldown(a, modelFamily) && !getOpenBreaker(a) && getModelQuotaScore(a, modelFamily) > 0,
  );
  const allSaturated = hasEligibleAccounts && sortedAccounts.every((a) => {
    if (isAccountInCooldown(a, modelFamily) || getOpenBreaker(a) || getModelQuotaScore(a, modelFamily) <= 0) {
      return true;
    }
    const max = isAccountInProbation(a, modelFamily) ? 1 : MAX_CONCURRENT_PER_ACCOUNT;
    return getAccountInFlight(a) >= max;
  });

  if (allSaturated) {
    log.info(`[Proxy] All eligible accounts in Google pool are saturated (${MAX_CONCURRENT_PER_ACCOUNT} in-flight reqs). Waiting up to 1500ms for an available slot...`);
    await waitForAccountSlot(sortedAccounts, modelFamily, 1500);
    // Re-sort after waiting so the newly freed account rises to the top
    sortedAccounts.sort((a, b) => {
      const cdA = isAccountInCooldown(a, modelFamily) ? 1 : 0;
      const cdB = isAccountInCooldown(b, modelFamily) ? 1 : 0;
      if (cdA !== cdB) return cdA - cdB;
      const breakerA = getOpenBreaker(a) ? 1 : 0;
      const breakerB = getOpenBreaker(b) ? 1 : 0;
      if (breakerA !== breakerB) return breakerA - breakerB;
      return getAccountDynamicScore(b, modelFamily) - getAccountDynamicScore(a, modelFamily);
    });
  }

  let lastStatus = 500;
  let lastErrorText = 'All accounts in Google Cloud Code pool exhausted';
  const totalAttempts = Math.min(sortedAccounts.length, 10);
  let consecutive429Count = 0;

  for (let i = 0; i < totalAttempts; i++) {
    const candidate = sortedAccounts[i];
    const candidateName = candidate.accountEmail || candidate.accountName || candidate.displayName || candidate.name;

    // Fast-skip: if this candidate is already in active cooldown for this model family
    if (isAccountInCooldown(candidate, modelFamily)) {
      const hasEligibleRemaining = sortedAccounts.slice(i).some((c) => !isAccountInCooldown(c, modelFamily));
      if (!hasEligibleRemaining) {
        log.warn(`[Proxy] All remaining accounts in pool are in cooldown for ${modelFamily}. Stopping pool search.`);
        break;
      }
      continue;
    }

    log.info(`[Proxy] Google account pool: trying candidate ${candidateName} (attempt ${i + 1}/${totalAttempts})`);

    let accessToken: string | null = null;
    try {
      accessToken = await getValidGoogleAccessToken(candidate);
    } catch (e) {
      log.warn(`[Proxy] Could not get access token for ${candidateName}:`, (e as Error).message);
    }

    if (!accessToken) {
      log.warn(`[Proxy] Skipping account ${candidateName}: no valid access token available`);
      recordFailure(candidate, 'auth');
      continue;
    }

    const targetModel = normalizeCloudCodeModelId(candidate.externalModelName || candidate.name);
    reqJson.model = targetModel;
    if (typeof reqJson.requestedModel === 'string' && /MODEL_PLACEHOLDER_/i.test(reqJson.requestedModel)) {
      reqJson.requestedModel = targetModel;
    }
    if (typeof reqJson.planModel === 'string' && /MODEL_PLACEHOLDER_/i.test(reqJson.planModel)) {
      reqJson.planModel = targetModel;
    }
    if (reqJson.request && typeof reqJson.request === 'object') {
      const reqObj = reqJson.request as Record<string, unknown>;
      reqObj.model = targetModel;
      if (typeof reqObj.requestedModel === 'string' && /MODEL_PLACEHOLDER_/i.test(reqObj.requestedModel)) {
        reqObj.requestedModel = targetModel;
      }
      if (typeof reqObj.planModel === 'string' && /MODEL_PLACEHOLDER_/i.test(reqObj.planModel)) {
        reqObj.planModel = targetModel;
      }
      sanitizeCloudCodeGenerationConfig(reqObj, targetModel);
    }
    reqJson.project = (candidate as { projectId?: string }).projectId || process.env.AG_CLOUD_CODE_PROJECT_ID || 'bamboo-precept-lgxtn';

    const updatedBody = Buffer.from(JSON.stringify(reqJson), 'utf-8');
    const authHeader = `Bearer ${accessToken}`;

    recordAccountRequest(candidate);
    incrementAccountInFlight(candidate);
    let outcome: GoogleRequestOutcome;
    try {
      outcome = await executeGoogleCloudCodeRequest(
        req,
        res,
        updatedBody,
        isSessionRemote,
        authHeader,
        convId,
      );
    } finally {
      decrementAccountInFlight(candidate);
    }

    if (outcome.success) {
      recordSuccess(candidate);
      clearAccountCooldown(candidate, modelFamily);
      endAccountProbation(candidate, modelFamily);
      if (sessId) {
        bindSessionToModel(sessId, candidate);
      }
      log.info(`[Proxy] Google Cloud Code request SUCCEEDED on account ${candidateName}`);
      return true;
    }

    if (outcome.statusCode === 429) {
      consecutive429Count++;
      const retryAfterHeader = outcome.headers?.['retry-after'];
      const decision = classifyGoogleCloudCode429(outcome.error, retryAfterHeader);

      log.warn(
        `[Proxy] 429 on ${candidateName} (${modelFamily}): ${decision.category} — ${decision.reason} (cooldown: ${Math.round(decision.cooldownMs / 1000)}s)`
      );
      setAccountCooldown(candidate, decision.cooldownMs, modelFamily);
      recordFailure(candidate, 'rate_limit');

      if (decision.category === 'quota_exhausted') {
        const liveKey = getAccountQuotaKey(candidate);
        const existingLive = getLiveAccountQuota(liveKey);
        if (existingLive) {
          if (isClaude) {
            existingLive.claudeFiveHourPct = 0;
          } else {
            existingLive.geminiFiveHourPct = 0;
          }
          updateLiveAccountQuota(liveKey, existingLive);
        }
        if (candidate.quotas) {
          if (isClaude) {
            (candidate.quotas as any).claudeFiveHourPct = 0;
          } else {
            (candidate.quotas as any).geminiFiveHourPct = 0;
          }
        }
        if (sessId) {
          sessionAffinities.delete(sessId);
        }
      }

      lastStatus = 429;
      lastErrorText = outcome.error || `HTTP 429 (${decision.reason})`;

      // If all remaining candidates are in cooldown, break early to save latency
      const hasEligibleRemaining = sortedAccounts.slice(i + 1).some((c) => !isAccountInCooldown(c, modelFamily));
      if (!hasEligibleRemaining) {
        log.warn(`[Proxy] No remaining healthy accounts left in pool for ${modelFamily}. Fast-failing pool.`);
        break;
      }

      if (i + 1 < totalAttempts) {
        await new Promise((r) => setTimeout(r, 50));
      }
      continue;
    } else {
      consecutive429Count = 0;
    }

    if (
      outcome.statusCode === 400 &&
      /thought.*signature|signature.*thought|signature.*thinking|thinking.*signature|corrupted.*signature|invalid.*signature/i.test(
        outcome.error || '',
      )
    ) {
      log.warn(`[Proxy] Detected thought signature issue from Vertex AI on ${candidateName} (${(outcome.error || '').slice(0, 100)}). Auto-repairing...`);
      const isMissingSig = /missing.*thought_signature|thought_signature.*missing/i.test(outcome.error || '');
      const targetContents = (reqJson.request as any)?.contents || reqJson.contents;
      let repaired = false;

      // 1. If signature was missing on functionCall parts, try restoring from cache / sibling parts first
      if (isMissingSig && Array.isArray(targetContents)) {
        repaired = restoreThoughtSignatures(targetContents, convId || '', 'gemini');
        if (repaired) {
          log.info(`[Proxy] Successfully restored missing thought signature(s) from cache/siblings for ${candidateName}`);
        }
      }

      // 2. If restore was not applicable or signature was corrupted, convert unverified tool calls in history
      // to plain text and strip thinkingConfig so Vertex AI accepts the request without signature errors
      if (!repaired) {
        log.warn(`[Proxy] Converting unverified tool calls in history to text to bypass Vertex AI thought signature validation for ${candidateName}`);
        const sanitizeObj = (obj: any) => {
          if (!obj || typeof obj !== 'object') return;
          if (obj.generationConfig) {
            delete obj.generationConfig.thinkingConfig;
            delete obj.generationConfig.thinking_config;
          }
          if (obj.generation_config) {
            delete obj.generation_config.thinkingConfig;
            delete obj.generation_config.thinking_config;
          }
          if (Array.isArray(obj.contents)) {
            for (const c of obj.contents) {
              if (Array.isArray(c.parts)) {
                c.parts = c.parts.filter((p: any) => !p?.thought && p?.type !== 'thinking');
                if (c.parts.length === 0) c.parts = [{ text: '.' }];
              }
            }
            flattenAllToolCallsToText(obj.contents);
            normalizeConversationTurns(obj.contents);
          }
          if (obj.request && typeof obj.request === 'object') {
            sanitizeObj(obj.request);
          }
        };
        sanitizeObj(reqJson);
      }

      const retryBody = Buffer.from(JSON.stringify(reqJson), 'utf-8');
      const retryOutcome = await executeGoogleCloudCodeRequest(
        req,
        res,
        retryBody,
        isSessionRemote,
        authHeader,
        convId,
      );
      if (retryOutcome.success) {
        recordSuccess(candidate);
        clearAccountCooldown(candidate, modelFamily);
        if (sessId) {
          bindSessionToModel(sessId, candidate);
        }
        log.info(`[Proxy] Self-healing retry after thought signature repair SUCCEEDED on account ${candidateName}`);
        return true;
      }
    }

    if (outcome.statusCode === 400 && /context.*length|token.*limit|payload.*exceed|too large|request.*large|exceeds.*limit/i.test(outcome.error || '')) {
      log.warn(`[Proxy] Detected Context/Token limit error from upstream on ${candidateName}. Trimming 30% oldest history and retrying...`);
      const trimHistory = (obj: any) => {
        if (!obj || typeof obj !== 'object') return;
        const contents = obj.contents || obj.request?.contents;
        if (Array.isArray(contents) && contents.length > 4) {
          const first = contents[0];
          const keepCount = Math.max(3, Math.floor(contents.length * 0.7));
          const trimmed = [first, ...contents.slice(contents.length - keepCount)];
          if (obj.contents) obj.contents = trimmed;
          if (obj.request?.contents) obj.request.contents = trimmed;
        }
      };
      trimHistory(reqJson);
      const retryBody = Buffer.from(JSON.stringify(reqJson), 'utf-8');
      const retryOutcome = await executeGoogleCloudCodeRequest(
        req,
        res,
        retryBody,
        isSessionRemote,
        authHeader,
        convId,
      );
      if (retryOutcome.success) {
        recordSuccess(candidate);
        clearAccountCooldown(candidate, modelFamily);
        if (sessId) {
          bindSessionToModel(sessId, candidate);
        }
        log.info(`[Proxy] History trimming retry SUCCEEDED on account ${candidateName}`);
        return true;
      }
    }

    lastStatus = outcome.statusCode || 500;
    lastErrorText = outcome.error || `HTTP ${lastStatus}`;
    log.warn(
      `[Proxy] Account ${candidateName} failed with HTTP ${lastStatus} (${lastErrorText.slice(0, 150)}). Failing over to next account in pool...`
    );

    if (lastStatus !== 429) {
      recordFailure(candidate, 'server');
    }

    // On HTTP 400 (Bad Request / payload format error), trying other accounts in the pool will produce
    // the exact same 400 error. Abort rotation to fast-trigger fallback model recovery.
    if (lastStatus === 400) {
      log.warn(`[Proxy] HTTP 400 indicates a payload format error on ${candidateName}. Aborting account pool rotation to trigger immediate fallback recovery.`);
      break;
    }

    if (i + 1 < totalAttempts) {
      // Sub-second silent failover between accounts in the pool
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  // ── Bulletproof Zero-Downtime Agent Resilience ──
  // If all candidate accounts for the requested model failed (e.g. Claude quota exhausted or Vertex 400/429),
  // do NOT immediately return an error that kills the agent executor!
  // Fall back to healthy Gemini models (Gemini Flash / Pro) which have independent quota.
  if (!res.writableEnded && !res.destroyed) {
    const isStream = req.url!.includes('streamGenerateContent') || req.url!.includes('alt=sse');
    const allCustomModels = expandModelsWithEffort(loadCustomModels());
    const fallbackTargets = ['gemini-3.8-flash-tiered', 'gemini-3.7-flash-tiered', 'gemini-2.0-flash'];
    const currentBase = normalizeCloudCodeModelId((reqJson.model as string) || '');
    const eligibleFallbacks = fallbackTargets.filter((m) => m !== currentBase);

    if (eligibleFallbacks.length > 0) {
      for (const fallbackModel of eligibleFallbacks) {
        log.warn(
          `[Proxy] Agent resilience: Requested model ${currentBase} failed across accounts (${lastErrorText.slice(0, 80)}). Auto-recovering with fallback model ${fallbackModel}...`,
        );
        const fallbackCandidates = allCustomModels.filter(
          (m) =>
            isGoogleCloudCodeModel(m) &&
            normalizeCloudCodeModelId(m.externalModelName || m.name) === fallbackModel &&
            !getOpenBreaker(m) &&
            getModelQuotaScore(m) > 0,
        );

        if (fallbackCandidates.length > 0) {
          const selectedFallback =
            selectBestModelByQuota(fallbackCandidates, allCustomModels) || fallbackCandidates[0];
          const fallbackPool = getGoogleAccountPool(selectedFallback, allCustomModels);

          reqJson.model = fallbackModel;
          if (reqJson.request && typeof reqJson.request === 'object') {
            (reqJson.request as Record<string, unknown>).model = fallbackModel;
            sanitizeCloudCodeGenerationConfig(reqJson.request as Record<string, unknown>, fallbackModel);
          }
          const fbContents = (reqJson.request as any)?.contents || reqJson.contents;
          if (Array.isArray(fbContents)) {
            restoreThoughtSignatures(fbContents, convId || '', fallbackModel);
            sanitizeUnsignedToolCalls(fbContents);
            normalizeConversationTurns(fbContents);
          }

          const sessionKey = convId || sessId;
          const existingFallback = sessionKey ? getSessionModelFallback(sessionKey) : undefined;
          const alreadyNotified = existingFallback?.notified === true;

          if (sessionKey) {
            setSessionModelFallback(sessionKey, currentBase, fallbackModel, true);
          }

          if (isStream && !res.writableEnded && !res.destroyed && !alreadyNotified) {
            if (!res.headersSent) {
              safeWriteHead(res, 200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive',
              });
            }
            const isClaude = currentBase.toLowerCase().includes('claude');
            const fbNotice = isClaude
              ? `> 🔄 **Quota Claude atteint** — Poursuite automatique de la conversation avec **Gemini 3.8 Flash**.\n\n`
              : `> 🔄 **Modèle temporairement indisponible** — Poursuite automatique avec **${fallbackModel}**.\n\n`;
            const chunk = {
              response: {
                candidates: [
                  {
                    content: { parts: [{ text: fbNotice }], role: 'model' },
                    index: 0,
                  },
                ],
              },
            };
            writeSafeSseChunk(res, chunk);
          }

          try {
            const fallbackOk = await executeGoogleCloudCodeWithPool(
              req,
              res,
              reqJson,
              fallbackPool,
              isSessionRemote,
              convId,
              sessId,
            );
            if (fallbackOk || res.writableEnded) {
              log.info(`[Proxy] Cross-model fallback to ${fallbackModel} SUCCEEDED! Agent saved from termination.`);
              return true;
            }
          } catch (fbErr) {
            log.warn(`[Proxy] Fallback to ${fallbackModel} failed:`, (fbErr as Error).message);
          }
        }
      }
    }

    // If this request is a context summarization hook and everything else failed:
    // Return a synthetic summary SSE stream instead of HTTP 400/500 so the agent pre-invocation hook never crashes!
    const reqStr = JSON.stringify(reqJson);
    const isSummarization = /summariz|summary|trajectory/i.test(reqStr);

    if (isSummarization) {
      log.warn('[Proxy] Context summarization hook failed upstream. Returning synthetic summary to prevent agent termination.');
      const summaryCand = {
        content: {
          parts: [{ text: 'Summary of previous steps: The agent investigated the task, inspected files, executed commands, and continues with the implementation.' }],
          role: 'model',
        },
        finishReason: 'STOP',
        index: 0,
      };
      const syntheticChunk = {
        response: {
          candidates: [summaryCand],
          usageMetadata: {
            promptTokenCount: 100,
            candidatesTokenCount: 30,
            totalTokenCount: 130,
          },
        },
        candidates: [summaryCand],
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 30,
          totalTokenCount: 130,
        },
      };
      sanitizeCandidatesInResponse(syntheticChunk);
      if (isStream) {
        if (!res.headersSent) {
          safeWriteHead(res, 200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          });
        }
        writeSafeSseChunk(res, syntheticChunk);
        safeEnd(res);
      } else {
        if (!res.headersSent) {
          safeWriteHead(res, 200, { 'Content-Type': 'application/json' });
        }
        safeEnd(res, JSON.stringify(syntheticChunk));
      }
      return true;
    }
  }

  log.error(`[Proxy] All ${totalAttempts} Google Cloud Code accounts in the pool failed. Returning HTTP ${lastStatus}`);
  if (!res.writableEnded && !res.destroyed) {
    const isStream = req.url!.includes('streamGenerateContent') || req.url!.includes('alt=sse');
    const failedModel = sortedAccounts[0] || ({
      name: (reqJson.model as string) || 'google-model',
      displayName: (reqJson.model as string) || 'Google Model',
      provider: 'google',
    } as CustomModel);
    const diagnostic = classifyError(lastStatus, lastErrorText, undefined, 'google');
    if (totalAttempts > 1) {
      diagnostic.title = `${diagnostic.title} (${totalAttempts}/${totalAttempts} comptes vérifiés)`;
      diagnostic.message = `L'ensemble des ${totalAttempts} comptes configurés ont été testés automatiquement en arrière-plan, mais aucun n'est actuellement disponible (${diagnostic.errorType}).`;
    }
    if (!res.headersSent) {
      if (isStream) {
        sendGracefulStreamError(res, diagnostic, failedModel);
      } else {
        sendGracefulNonStreamError(res, diagnostic, failedModel);
      }
    } else {
      if (isStream) {
        sendGracefulStreamError(res, diagnostic, failedModel);
      } else {
        safeEnd(res);
      }
    }
  }
  return false;
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
      if (fd.mimeType?.startsWith('image/')) continue;
      try {
        const uri = fd.fileUri; let fileContent = '';
        if (uri.startsWith('file://')) {
          const fp = uri.replace('file://', '').replace(/\//g, path.sep);
          try {
            await fs.promises.access(fp);
            fileContent = await fs.promises.readFile(fp, 'utf-8');
          } catch {
            fileContent = '';
          }
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
  const attempt = retryCount + 1;
  const maxAttempts = ctx.maxRetries;
  log.warn(`[Proxy] ${logReason} for ${ctx.model.name}, retrying silently in ${delayMs}ms (${attempt}/${maxAttempts})...`);

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
  if (!res.headersSent) {
    sendGracefulStreamError(res, diagnostic, model);
  } else if (!res.writableEnded) {
    const errChunk = {
      response: {
        candidates: [
          {
            content: { parts: [{ text: '\n\n' + generateGracefulMarkdown(diagnostic, model) }], role: 'model' },
            finishReason: 'STOP',
            index: 0,
          },
        ],
      },
      traceId: '',
      metadata: {},
    };
    sanitizeCandidatesInResponse(errChunk);
    writeSafeSseChunk(res, errChunk);
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

      sendGracefulStreamError(res, diagnostic, model);
    });
    return;
  }

  if (apiRes.statusCode === 200) {
    // Any successful response proves the upstream is healthy again;
    // clear the breaker so subsequent requests don't short-circuit.
    recordSuccess(model);
  }

  if (!res.headersSent) {
    if (!safeWriteHead(res, 200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })) {
      return;
    }
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
            extractAndCacheThoughtSignatures({ candidates: [mapped] }, '');
            const cloudCodeResponse = {
              response: { candidates: [mapped] },
              traceId: '',
              metadata: {},
            };
            sanitizeCandidatesInResponse(cloudCodeResponse);
            writeSafeSseChunk(res, cloudCodeResponse);
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
      const emptyDiag = classifyError(undefined, undefined, 'empty_stream', model.provider);
      emptyDiag.title = 'Empty Model Response';
      emptyDiag.message = `Model "${model.displayName || model.name}" responded with HTTP 200 OK but returned 0 tokens of content (${verdict.reason}).`;
      emptyDiag.suggestions = [
        'Check if this model requires a different prompt or format.',
        'Verify that the upstream provider API is responding correctly.',
        'Try switching to a different model.'
      ];
      sendGracefulStreamError(res, emptyDiag, model);
      return;
    }
    if (buffer.trim().startsWith('data: ')) {
      const dataStr = buffer.trim().substring(6).trim();
      if (dataStr !== '[DONE]') {
        try {
          const parsed = JSON.parse(dataStr);
          const mapped = registry.translateStreamChunk(provider, parsed, model.name);
          if (mapped) {
            extractAndCacheThoughtSignatures({ candidates: [mapped] }, '');
            const cloudCodeResponse = {
              response: { candidates: [mapped] },
              traceId: '',
              metadata: {},
            };
            sanitizeCandidatesInResponse(cloudCodeResponse);
            writeSafeSseChunk(res, cloudCodeResponse);
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
            content: { parts: [{ text: '' }], role: 'model' },
            finishReason: 'STOP',
            index: 0,
          },
        ],
      },
      traceId: '',
      metadata: {},
    };
    sanitizeCandidatesInResponse(finalChunk);
    writeSafeSseChunk(res, finalChunk);
    res.end();
    safeEnd(res);
    const pId = model.name.includes('-') ? model.name.split('-')[0] : model.provider;
    void recordProviderUsage(pId);
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

      sendGracefulNonStreamError(res, diagnostic, model);
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
      sanitizeCandidatesInResponse(cloudCodeResponse);

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

      sendGracefulNonStreamError(res, diagnostic, model);
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

  if (ctx.isStream) {
    sendGracefulStreamError(res, diagnostic, model);
  } else {
    sendGracefulNonStreamError(res, diagnostic, model);
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
    sendGracefulStreamError(res, diagnostic, model);
  } else {
    sendGracefulNonStreamError(res, diagnostic, model);
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

// ─── Multi-Account Session Affinity (Sticky Sessions) ─────────────────────────

export function getAccountQuotaKey(item: CustomModel): string {
  if (item.accountEmail) return `google:${item.accountEmail.toLowerCase()}`;
  if (item.refreshToken) return `google:refresh:${item.refreshToken.slice(-15)}`;
  try {
    const host = new URL(item.apiUrl).hostname;
    return `${host}:${item.apiKey || 'none'}`;
  } catch {
    return item.apiUrl || item.name || '';
  }
}

// ─── Google Account 429 Cooldown & Probation Registry ─────────────────────────
const googleAccountCooldowns = new Map<string, number>();
const accountProbationUntil = new Map<string, number>();

export function isAccountInProbation(candidate: CustomModel, modelFamily?: string): boolean {
  const baseKey = getAccountQuotaKey(candidate);
  const key = modelFamily ? `${baseKey}:${modelFamily}` : baseKey;
  const until = accountProbationUntil.get(key) || (modelFamily ? accountProbationUntil.get(baseKey) : undefined);
  if (!until) return false;
  if (Date.now() >= until) {
    accountProbationUntil.delete(key);
    return false;
  }
  return true;
}

export function endAccountProbation(candidate: CustomModel, modelFamily?: string): void {
  const baseKey = getAccountQuotaKey(candidate);
  if (modelFamily) {
    accountProbationUntil.delete(`${baseKey}:${modelFamily}`);
  }
  accountProbationUntil.delete(baseKey);
}

export function _resetAccountProbation(): void {
  accountProbationUntil.clear();
}

export function isAccountInCooldown(candidate: CustomModel, modelFamily?: string): boolean {
  const baseKey = getAccountQuotaKey(candidate);
  const key = modelFamily ? `${baseKey}:${modelFamily}` : baseKey;
  const until = googleAccountCooldowns.get(key) || (modelFamily ? googleAccountCooldowns.get(baseKey) : undefined);
  if (!until) return false;
  if (Date.now() >= until) {
    googleAccountCooldowns.delete(key);
    // Transition to 15s half-open probation to prevent thundering herd stampede
    accountProbationUntil.set(key, Date.now() + 15_000);
    return false;
  }
  return true;
}

export function setAccountCooldown(candidate: CustomModel, durationMs = 10 * 60_000, modelFamily?: string): void {
  const baseKey = getAccountQuotaKey(candidate);
  const key = modelFamily ? `${baseKey}:${modelFamily}` : baseKey;
  accountProbationUntil.delete(key);
  // Add 1-5s random jitter to desynchronize account recovery stampedes
  const jitterMs = durationMs > 5_000 ? randomInt(1_000, 5_000) : 0;
  googleAccountCooldowns.set(key, Date.now() + durationMs + jitterMs);
}

export function getAccountCooldownRemaining(candidate: CustomModel, modelFamily?: string): number {
  const baseKey = getAccountQuotaKey(candidate);
  const key = modelFamily ? `${baseKey}:${modelFamily}` : baseKey;
  const until = googleAccountCooldowns.get(key) || (modelFamily ? googleAccountCooldowns.get(baseKey) : undefined);
  if (!until) return 0;
  const remaining = until - Date.now();
  return remaining > 0 ? remaining : 0;
}

export function clearAccountCooldown(candidate: CustomModel, modelFamily?: string): void {
  const baseKey = getAccountQuotaKey(candidate);
  if (modelFamily) {
    googleAccountCooldowns.delete(`${baseKey}:${modelFamily}`);
    accountProbationUntil.delete(`${baseKey}:${modelFamily}`);
  }
  googleAccountCooldowns.delete(baseKey);
  accountProbationUntil.delete(baseKey);
}

export function _resetAllAccountCooldowns(): void {
  googleAccountCooldowns.clear();
  accountProbationUntil.clear();
}

/**
 * Automatically lifts cooldowns and probation when the Quota Poller detects
 * that an account's quota has replenished (e.g. after 5h or weekly bucket reset).
 */
export function autoHealAccountOnQuotaRecovery(accountKey: string, quota: AccountLiveQuota): void {
  if (!quota || !accountKey) return;

  // If Gemini quota recovered above 20%, heal Gemini-specific cooldown
  if (quota.geminiFiveHourPct > 20) {
    const geminiKey = `${accountKey}:gemini`;
    if (googleAccountCooldowns.has(geminiKey)) {
      log.info(`[Proxy] Auto-healing Gemini cooldown for ${accountKey}: quota recovered to ${quota.geminiFiveHourPct}%`);
      googleAccountCooldowns.delete(geminiKey);
      accountProbationUntil.delete(geminiKey);
    }
  }

  // If Claude quota recovered above 20%, heal Claude-specific cooldown
  if (quota.claudeFiveHourPct > 20) {
    const claudeKey = `${accountKey}:claude`;
    if (googleAccountCooldowns.has(claudeKey)) {
      log.info(`[Proxy] Auto-healing Claude cooldown for ${accountKey}: quota recovered to ${quota.claudeFiveHourPct}%`);
      googleAccountCooldowns.delete(claudeKey);
      accountProbationUntil.delete(claudeKey);
    }
  }

  // If either major quota recovered, heal general account cooldown
  if (quota.geminiFiveHourPct > 20 || quota.claudeFiveHourPct > 20) {
    if (googleAccountCooldowns.has(accountKey)) {
      log.info(`[Proxy] Auto-healing general cooldown for ${accountKey}`);
      googleAccountCooldowns.delete(accountKey);
      accountProbationUntil.delete(accountKey);
    }
  }
}

// ─── Google Account In-Flight Concurrency Tracker ──────────────────────────────
const accountInFlightRequests = new Map<string, number>();

export function getAccountInFlight(candidate: CustomModel): number {
  const key = getAccountQuotaKey(candidate);
  return accountInFlightRequests.get(key) || 0;
}

export const MAX_CONCURRENT_PER_ACCOUNT = Number(process.env.AG_MAX_CONCURRENT_PER_ACCOUNT) || 2;

interface SlotWaiter {
  resolve: (hasSlot: boolean) => void;
  timer: NodeJS.Timeout;
}

const slotWaiters: SlotWaiter[] = [];

export function notifySlotAvailable(): void {
  while (slotWaiters.length > 0) {
    const waiter = slotWaiters.shift();
    if (waiter) {
      clearTimeout(waiter.timer);
      waiter.resolve(true);
    }
  }
}

export function _clearSlotWaitersForTests(): void {
  for (const w of slotWaiters) {
    clearTimeout(w.timer);
  }
  slotWaiters.length = 0;
}

export async function waitForAccountSlot(
  accounts: CustomModel[],
  modelFamily?: string,
  maxWaitMs = 1500,
): Promise<boolean> {
  const hasAvailableSlot = accounts.some((a) => {
    if (isAccountInCooldown(a, modelFamily) || getOpenBreaker(a)) return false;
    if (getModelQuotaScore(a, modelFamily) <= 0) return false;
    const max = isAccountInProbation(a, modelFamily) ? 1 : MAX_CONCURRENT_PER_ACCOUNT;
    return getAccountInFlight(a) < max;
  });

  if (hasAvailableSlot) return true;
  if (maxWaitMs <= 0) return false;

  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      const idx = slotWaiters.findIndex((w) => w.timer === timer);
      if (idx !== -1) {
        slotWaiters.splice(idx, 1);
      }
      resolve(false);
    }, maxWaitMs);
    if (timer.unref) timer.unref();

    slotWaiters.push({ resolve, timer });
  });
}

export function incrementAccountInFlight(candidate: CustomModel): void {
  const key = getAccountQuotaKey(candidate);
  accountInFlightRequests.set(key, (accountInFlightRequests.get(key) || 0) + 1);
}

export function decrementAccountInFlight(candidate: CustomModel): void {
  const key = getAccountQuotaKey(candidate);
  const current = accountInFlightRequests.get(key) || 0;
  if (current <= 1) {
    accountInFlightRequests.delete(key);
  } else {
    accountInFlightRequests.set(key, current - 1);
  }
  notifySlotAvailable();
}

export function _resetAccountInFlight(): void {
  accountInFlightRequests.clear();
}

// ─── Google Account RPM Governor (Sliding Window 60s) ─────────────────────────
const accountRequestTimestamps = new Map<string, number[]>();

export function recordAccountRequest(candidate: CustomModel): void {
  const key = getAccountQuotaKey(candidate);
  const now = Date.now();
  const list = accountRequestTimestamps.get(key) || [];
  const recent = list.filter((t) => now - t < 60_000);
  recent.push(now);
  accountRequestTimestamps.set(key, recent);
}

export function getAccountRpmCount(candidate: CustomModel): number {
  const key = getAccountQuotaKey(candidate);
  const list = accountRequestTimestamps.get(key);
  if (!list || list.length === 0) return 0;
  const now = Date.now();
  const valid = list.filter((t) => now - t < 60_000);
  if (valid.length !== list.length) {
    accountRequestTimestamps.set(key, valid);
  }
  return valid.length;
}

export function _resetAccountRpm(): void {
  accountRequestTimestamps.clear();
}

export function getModelQuotaScore(m: CustomModel, modelFamily?: string): number {
  if (isGoogleCloudCodeModel(m) && !m.refreshToken && (!m.apiKey || !m.apiKey.startsWith('ya29.'))) {
    return 0;
  }
  const key = getAccountQuotaKey(m);
  const live = getLiveAccountQuota(key);
  const q = (live || m.quotas) as Record<string, any> | undefined;
  if (!q) return 50;

  const isClaude = modelFamily
    ? modelFamily.toLowerCase().includes('claude')
    : (m.externalModelName || m.name || '').toLowerCase().includes('claude');

  const fiveHour = typeof (isClaude ? q.claudeFiveHourPct : q.geminiFiveHourPct) === 'number'
    ? (isClaude ? q.claudeFiveHourPct : q.geminiFiveHourPct)
    : typeof q.fiveHourPercentage === 'number'
      ? q.fiveHourPercentage
      : 50;

  const weekly = typeof (isClaude ? q.claudeWeeklyPct : q.geminiWeeklyPct) === 'number'
    ? (isClaude ? q.claudeWeeklyPct : q.geminiWeeklyPct)
    : typeof q.weeklyPercentage === 'number'
      ? q.weeklyPercentage
      : 50;

  if (fiveHour === 0) return 0;
  return (fiveHour * 0.7) + (weekly * 0.3);
}

// ─── Google Account Dynamic Health Scoring ─────────────────────────────────────
export function getAccountDynamicScore(m: CustomModel, modelFamily?: string): number {
  if (isAccountInCooldown(m, modelFamily) || getOpenBreaker(m) || isTokenRevoked(m.refreshToken)) {
    return 0;
  }
  const baseScore = getModelQuotaScore(m, modelFamily);
  if (baseScore <= 0) return 0;
  const inFlight = getAccountInFlight(m);

  // During Half-Open probation: strictly max 1 probe request allowed; score capped at 60%
  if (isAccountInProbation(m, modelFamily)) {
    if (inFlight >= 1) return 0;
    const probationScore = Math.floor(baseScore * 0.6);
    return Math.max(1, probationScore - inFlight * 20);
  }

  // Account reached max concurrent requests slot limit: mark score 0 to route to free accounts
  if (inFlight >= MAX_CONCURRENT_PER_ACCOUNT) {
    return 0;
  }

  const rpmCount = getAccountRpmCount(m);
  // Each active request penalizes dynamic score by 20 points;
  // each request served in the last 60 seconds penalizes by 2 points (RPM governor)
  return Math.max(1, baseScore - inFlight * 20 - rpmCount * 2);
}

// ─── Intelligent 429 Classification (OmniRoute Parity) ─────────────────────────
export type Google429Category = 'soft_rate_limit' | 'rate_limited' | 'quota_exhausted' | 'unknown';

export interface Google429Decision {
  category: Google429Category;
  cooldownMs: number;
  reason: string;
}

export function classifyGoogleCloudCode429(
  errorMessage?: string,
  retryAfterHeader?: string | string[] | number | null,
): Google429Decision {
  const msg = (errorMessage || '').toLowerCase();

  let retryAfterMs: number | null = null;
  if (retryAfterHeader !== null && retryAfterHeader !== undefined) {
    const rawVal = Array.isArray(retryAfterHeader) ? retryAfterHeader[0] : String(retryAfterHeader);
    const parsedSec = parseFloat(rawVal);
    if (!isNaN(parsedSec) && parsedSec >= 0) {
      retryAfterMs = Math.round(parsedSec * 1000);
    } else {
      const parsedDate = Date.parse(rawVal);
      if (!isNaN(parsedDate) && parsedDate > Date.now()) {
        retryAfterMs = parsedDate - Date.now();
      }
    }
  }

  // 1. Soft / burst rate limit (micro-throttle, e.g. reset in 0s, try again, or retryAfter <= 3s)
  if (
    /\breset\s+(?:after|in)\s+0s\b/.test(msg) ||
    msg.includes('try again') ||
    msg.includes('temporarily') ||
    (retryAfterMs !== null && retryAfterMs <= 3000)
  ) {
    return {
      category: 'soft_rate_limit',
      cooldownMs: retryAfterMs && retryAfterMs > 0 ? retryAfterMs : 3000,
      reason: 'Soft burst throttle — momentary pause',
    };
  }

  // 2. RPM / Short-term rate limit indicators (e.g. "Requests per minute quota exceeded")
  if (
    msg.includes('per minute') ||
    msg.includes('per_minute') ||
    msg.includes('rpm') ||
    msg.includes('rate limit') ||
    msg.includes('rate_limit') ||
    msg.includes('too many requests')
  ) {
    return {
      category: 'rate_limited',
      cooldownMs: retryAfterMs && retryAfterMs > 0 ? retryAfterMs : 60_000,
      reason: 'RPM limit — 60s cooldown',
    };
  }

  // 3. Daily or 5-hour quota exhaustion
  const QUOTA_EXHAUSTED_KEYWORDS = [
    'quota_exhausted',
    'quota exhausted',
    'quota reached',
    'enable overages',
    'individual quota',
    'resource_exhausted',
    'resource has been exhausted',
    'quota exceeded',
    'google_one_ai',
    'insufficient credit',
    'insufficient credits',
    'not enough credit',
    'not enough credits',
    'credit exhausted',
    'credits exhausted',
    'credit balance',
    'minimumcreditamountforusage',
    'minimum credit amount for usage',
    'minimum credit',
    'insufficient_g1_credits_balance',
    'g1_credits',
    'daily limit',
    'exhausted your capacity',
    'free tier',
  ];

  for (const kw of QUOTA_EXHAUSTED_KEYWORDS) {
    if (msg.includes(kw)) {
      return {
        category: 'quota_exhausted',
        cooldownMs: retryAfterMs && retryAfterMs > 60_000 ? retryAfterMs : 5 * 60 * 60 * 1000,
        reason: 'Quota exhausted — 5h cooldown and switch account',
      };
    }
  }

  // 4. Default / Unknown 429
  return {
    category: 'unknown',
    cooldownMs: retryAfterMs && retryAfterMs > 0 ? retryAfterMs : 60_000,
    reason: 'Generic 429 rate limit',
  };
}

// ─── Power of Two Choices (P2C) Candidate Selection ────────────────────────────
export function selectCandidateP2C(candidates: CustomModel[], modelFamily = 'gemini'): CustomModel | undefined {
  if (!candidates || candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];

  const available = candidates.filter((m) => !isAccountInCooldown(m, modelFamily) && !getOpenBreaker(m));
  const pool = available.length > 0 ? available : candidates;
  if (pool.length === 1) return pool[0];

  const sorted = [...pool].sort((a, b) => getAccountDynamicScore(b, modelFamily) - getAccountDynamicScore(a, modelFamily));
  const topScore = getAccountDynamicScore(sorted[0], modelFamily);

  const topTier = sorted.filter((m) => topScore - getAccountDynamicScore(m, modelFamily) <= 15);
  if (topTier.length <= 1) {
    return sorted[0];
  }

  const i = randomInt(topTier.length);
  let j = randomInt(topTier.length - 1);
  if (j >= i) j++;

  const candA = topTier[i];
  const candB = topTier[j];

  const scoreA = getAccountDynamicScore(candA, modelFamily);
  const scoreB = getAccountDynamicScore(candB, modelFamily);

  return scoreA >= scoreB ? candA : candB;
}


let roundRobinCounter = 0;

export function selectBestModelByQuota(candidates: CustomModel[], allModels?: CustomModel[]): CustomModel | undefined {
  if (!candidates || candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];

  const healthy = candidates.filter((m) => !getOpenBreaker(m));
  const pool = healthy.length > 0 ? healthy : candidates;

  // Prefer candidates with refreshable credentials if Google Cloud Code
  const withRefresh = pool.filter((m) => !isGoogleCloudCodeModel(m) || Boolean(m.refreshToken));
  const candidatePool = withRefresh.length > 0 ? withRefresh : pool;

  const withQuota = candidatePool.filter((m) => getModelQuotaScore(m) > 0);
  const candidatesToSort = withQuota.length > 0 ? withQuota : candidatePool;

  const sorted = [...candidatesToSort].sort((a, b) => getModelQuotaScore(b) - getModelQuotaScore(a));
  const topScore = getModelQuotaScore(sorted[0]);
  const topTier = sorted.filter((m) => topScore - getModelQuotaScore(m) <= 5);

  if (topTier.length > 1) {
    const selected = topTier[Math.abs(roundRobinCounter++) % topTier.length];
    return selected;
  }

  return sorted[0];
}

export function getGoogleAccountPool(
  matchedModel: CustomModel,
  allModels: CustomModel[],
): CustomModel[] {
  if (!allModels || allModels.length === 0) return [matchedModel];
  const targetBase = getBaseModelId(matchedModel.externalModelName || matchedModel.name);
  const targetNorm = normalizeCloudCodeModelId(targetBase);

  // Pool all Google Cloud Code accounts offering this model or compatible
  const pool = allModels.filter((m) => {
    if (!isGoogleCloudCodeModel(m)) return false;
    const mBase = getBaseModelId(m.externalModelName || m.name);
    const mNorm = normalizeCloudCodeModelId(mBase);
    return mBase === targetBase || mNorm === targetNorm;
  });

  // Deduplicate by unique account credentials
  const seenAccounts = new Set<string>();
  const distinctPool: CustomModel[] = [];
  for (const m of pool) {
    const accKey = getAccountQuotaKey(m);
    if (!seenAccounts.has(accKey)) {
      seenAccounts.add(accKey);
      distinctPool.push(m);
    }
  }

  return distinctPool.length > 0 ? distinctPool : [matchedModel];
}

interface SessionAffinity {
  modelName: string;
  accountKey: string;
  lastUsed: number;
}

const sessionAffinities = new Map<string, SessionAffinity>();
const SESSION_AFFINITY_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

export function extractSessionId(body: Record<string, unknown>, headers?: Record<string, unknown>): string | null {
  if (body?.sessionId && typeof body.sessionId === 'string') return body.sessionId;
  if ((body?.context as any)?.sessionId && typeof (body.context as any).sessionId === 'string') {
    return (body.context as any).sessionId;
  }
  if (headers) {
    const h = headers['x-session-id'] || headers['x-request-session-id'];
    if (typeof h === 'string' && h) return h;
  }
  const contents = body?.contents as Array<any> | undefined;
  if (Array.isArray(contents) && contents.length > 0) {
    const firstUser = contents.find((c) => c && c.role === 'user');
    if (firstUser && Array.isArray(firstUser.parts) && firstUser.parts[0]?.text) {
      const snippet = String(firstUser.parts[0].text).slice(0, 120);
      let hash = 5381;
      for (let i = 0; i < snippet.length; i++) {
        hash = ((hash << 5) + hash) + snippet.charCodeAt(i);
        hash |= 0;
      }
      return 'conv_' + (hash >>> 0).toString(16);
    }
  }
  return null;
}

export function getSessionBoundModel(
  sessionId: string,
  targetModel: CustomModel,
  allModels: CustomModel[],
): CustomModel {
  const now = Date.now();
  const affinity = sessionAffinities.get(sessionId);
  if (!affinity) return targetModel;

  if (now - affinity.lastUsed > SESSION_AFFINITY_TTL_MS) {
    sessionAffinities.delete(sessionId);
    return targetModel;
  }

  // Find candidate models that share the same base external model (e.g. Gemini 3.1 Pro High across accounts)
  const targetBase = getBaseModelId(targetModel.externalModelName);
  const bound = allModels.find((m) => {
    const mBase = getBaseModelId(m.externalModelName);
    return mBase === targetBase && getAccountQuotaKey(m) === affinity.accountKey;
  });

  if (bound && !getOpenBreaker(bound) && getModelQuotaScore(bound) > 0) {
    affinity.lastUsed = now;
    return bound;
  }

  return targetModel;
}

export function bindSessionToModel(sessionId: string, model: CustomModel): void {
  sessionAffinities.set(sessionId, {
    modelName: model.name,
    accountKey: getAccountQuotaKey(model),
    lastUsed: Date.now(),
  });
}

export function clearSessionAffinities(): void {
  sessionAffinities.clear();
  sessionModelFallbacks.clear();
}

export interface SessionModelFallback {
  originalModel: string;
  fallbackModel: string;
  notified: boolean;
  lastUsed: number;
}

const sessionModelFallbacks = new Map<string, SessionModelFallback>();

export function getSessionModelFallback(sessionKey: string): SessionModelFallback | undefined {
  if (!sessionKey) return undefined;
  const fb = sessionModelFallbacks.get(sessionKey);
  if (!fb) return undefined;
  if (Date.now() - fb.lastUsed > SESSION_AFFINITY_TTL_MS) {
    sessionModelFallbacks.delete(sessionKey);
    return undefined;
  }
  return fb;
}

export function setSessionModelFallback(
  sessionKey: string,
  originalModel: string,
  fallbackModel: string,
  notified = false,
): void {
  if (!sessionKey) return;
  sessionModelFallbacks.set(sessionKey, {
    originalModel,
    fallbackModel,
    notified,
    lastUsed: Date.now(),
  });
}

export function clearSessionModelFallbacks(): void {
  sessionModelFallbacks.clear();
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
  const bodyContents = geminiBody.contents || ((geminiBody as Record<string, unknown>).request as Record<string, unknown> | undefined)?.contents;
  if (Array.isArray(bodyContents)) {
    normalizeConversationTurns(bodyContents);
    const sessId = extractSessionId(geminiBody as Record<string, unknown>, {});
    restoreThoughtSignatures(bodyContents, sessId || '', model.name || '');
  }
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

    if (isStream) {
      sendGracefulStreamError(res, cached, model);
    } else {
      sendGracefulNonStreamError(res, cached, model);
    }
    return;
  }

  // Shared by both the open-breaker short-circuit path and the regular
  // upstream-error paths. It only picks a different model and re-dispatches.
  function attemptFallback(diagnostic: ErrorDiagnostic): boolean {
    if (fallbackDepth >= 5) return false;
    const isEligibleForFallback =
      diagnostic.errorType === 'rate_limit' ||
      diagnostic.errorType === 'server' ||
      diagnostic.errorType === 'network' ||
      diagnostic.errorType === 'billing' ||
      diagnostic.errorType === 'timeout' ||
      diagnostic.title.includes('404') ||
      diagnostic.message.includes('404');
    if (!isEligibleForFallback) return false;

    try {
      const allModels = loadCustomModels();
      const currentAccountKey = getAccountQuotaKey(model);
      const targetBase = getBaseModelId(model.externalModelName || model.name);

      // Sibling accounts in the pool offering the exact same model, sorted by remaining quota score
      const poolSiblings = allModels
        .filter((m) => {
          if (m.name === model.name) return false;
          const mBase = getBaseModelId(m.externalModelName || m.name);
          return mBase === targetBase && getAccountQuotaKey(m) !== currentAccountKey && !getOpenBreaker(m);
        })
        .sort((a, b) => getModelQuotaScore(b) - getModelQuotaScore(a));

      let orderedModels = allModels;
      const chainItems: string[] = [];
      if (model.fallbackChain) {
        if (Array.isArray(model.fallbackChain)) {
          chainItems.push(...model.fallbackChain);
        } else if (typeof model.fallbackChain === 'string') {
          chainItems.push(...(model.fallbackChain as string).split(',').map((s) => s.trim()).filter(Boolean));
        }
      } else if (model.fallbackModel) {
        chainItems.push(model.fallbackModel);
      }

      if (poolSiblings.length > 0 || chainItems.length > 0) {
        const chainModels: CustomModel[] = [];
        for (const item of chainItems) {
          const matches = allModels.filter(
            (m) =>
              !chainModels.includes(m) &&
              !poolSiblings.includes(m) &&
              (m.name === item ||
                m.displayName === item ||
                m.externalModelName === item ||
                m.name.endsWith(`/${item}`) ||
                getBaseModelId(m.externalModelName || m.name) === getBaseModelId(item))
          );
          chainModels.push(...matches);
        }
        const rest = allModels.filter((m) => !poolSiblings.includes(m) && !chainModels.includes(m));
        orderedModels = [...poolSiblings, ...chainModels, ...rest];
      }

      // ponytail: skip same account on rate_limit — shared quota, fallback is a no-op.
      // Separate accounts (different API keys) on the same provider have independent quotas.
      const failedAccountKey = diagnostic.errorType === 'rate_limit'
        ? getAccountQuotaKey(model)
        : null;
      for (const m of orderedModels) {
        if (m.name !== model.name && m.apiKey && !m.apiKey.startsWith('fallback:')) {
          if (failedAccountKey && getAccountQuotaKey(m) === failedAccountKey) {
            log.warn(`[Proxy] Auto-fallback: skipping ${m.displayName || m.name} (same account credentials, shared quota)`);
            continue;
          }
          const fromName = model.displayName || model.name;
          const toName = m.displayName || m.name;
          log.warn(`[Proxy] Auto-fallback: ${fromName} → ${toName} (reason: ${diagnostic.errorType} — ${diagnostic.title})`);

          // Update session affinity on fallback to preserve subsequent queries on healthy account
          const sessId = extractSessionId(geminiBody as Record<string, unknown>);
          if (sessId) {
            bindSessionToModel(sessId, m);
          }

          const alreadyNotified = sessId ? getSessionModelFallback(sessId)?.notified === true : false;
          if (sessId) {
            setSessionModelFallback(sessId, model.name, m.name, true);
          }

          // L-1: Notify the user in the stream so the fallback is transparent.
          // We send a brief markdown notice as the first SSE event before
          // delegating to the fallback model handler (only once per session).
          if (isStream && !res.headersSent && !alreadyNotified) {
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
                    index: 0,
                  }],
                },
                traceId: '',
                metadata: {},
              };
              sanitizeCandidatesInResponse(notice);
              writeSafeSseChunk(res, notice);
            }
          }

          if (isGoogleCloudCodeModel(m)) {
            const allCustomModels = expandModelsWithEffort(loadCustomModels());
            const accountPool = getGoogleAccountPool(m, allCustomModels);
            const targetModel = normalizeCloudCodeModelId(m.externalModelName || m.name);
            sanitizeCloudCodeGenerationConfig(geminiBody as Record<string, unknown>, targetModel);
            const cloudCodePayload = {
              project: (m as { projectId?: string }).projectId || process.env.AG_CLOUD_CODE_PROJECT_ID || 'bamboo-precept-lgxtn',
              model: targetModel,
              request: geminiBody,
            };
            const fakeReq = {
              url: isStream ? '/v1internal:streamGenerateContent?alt=sse' : '/v1internal:generateContent',
              method: 'POST',
              headers: {},
            } as unknown as http.IncomingMessage;
            executeGoogleCloudCodeWithPool(fakeReq, res, cloudCodePayload, accountPool, false, '', sessId);
            return true;
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
  let cleanModelName = getBaseModelId(model.externalModelName);

  // Auto-fallback for reasoning models when tools are present (avoids HTTP 400 Bad Request)
  if (geminiBody.tools && Array.isArray(geminiBody.tools) && geminiBody.tools.length > 0) {
    if (cleanModelName.includes('thinking')) {
      cleanModelName = cleanModelName.replace('-thinking', '');
      log.info(`[Proxy] Tools detected in payload. Downgrading thinking model to ${cleanModelName}`);
    } else if (cleanModelName === 'deepseek-reasoner') {
      cleanModelName = 'deepseek-chat';
      log.info(`[Proxy] Tools detected in payload. Downgrading deepseek-reasoner to ${cleanModelName}`);
    }
  }

  const payload = registry.translateRequest(provider, geminiBody, cleanModelName, model.extraBody);
  const headers = registry.getProviderHeaders(provider, model.apiKey, model.extraHeaders);

  if (isStream && registry.supportsStreaming(provider) && provider !== 'google') {
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
      // S-2: Never log actual key material — only presence and length bucket.
      const apiKeyInfo = model.apiKey && model.apiKey !== 'none'
        ? `<set, len=${model.apiKey.length > 50 ? '>50' : model.apiKey.length <= 20 ? '≤20' : '21-50'}>`
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
  reqHeaders: Record<string, string | string[] | undefined>,
): void {
  const lsParsed = new URL(lsUrl);
  const client = lsParsed.protocol === 'https:' ? https : http;
  const bodyToSend = reqBody && reqBody.length > 0 ? reqBody : Buffer.from([0, 0, 0, 0, 0]);

  const options: https.RequestOptions = {
    method: 'POST',
    hostname: lsParsed.hostname,
    port: lsParsed.port || (lsParsed.protocol === 'https:' ? '443' : '80'),
    path: lsParsed.pathname + lsParsed.search,
    headers: {
      'Content-Type': 'application/grpc-web+proto',
      'Accept': 'application/grpc-web+proto',
      'Content-Length': String(bodyToSend.length),
      ...(reqHeaders['x-codeium-csrf-token'] ? { 'x-codeium-csrf-token': String(reqHeaders['x-codeium-csrf-token']) } : {}),
      ...(reqHeaders['Connect-Protocol-Version'] ? { 'Connect-Protocol-Version': String(reqHeaders['Connect-Protocol-Version']) } : {}),
      ...(reqHeaders['X-Grpc-Web'] ? { 'X-Grpc-Web': String(reqHeaders['X-Grpc-Web']) } : {}),
    },
    rejectUnauthorized: !LOOPBACK_HOSTS.includes(lsParsed.hostname as typeof LOOPBACK_HOSTS[number]),
  };

  const lsReq = client.request(options, (lsRes) => {
    let lsResErrored = false;
    lsRes.on('error', (err) => {
      lsResErrored = true;
      log.error('[Proxy] LS error for GetAvailableModels:', err.message);
      if (!res.headersSent && !res.writableEnded) {
        safeWriteHead(res, 502, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': '*',
        });
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
      // Run concurrent health checks (cached with TTL, max 800ms wait)
      getFastOrCachedHealth(customModels, 800).then((healthMap) => {
        const { buffer: modifiedBuf } = injectCustomModelsIntoResponse(responseBuf, customModels, healthMap, true);
        if (
          safeWriteHead(res, lsRes.statusCode || 200, {
            'Content-Type': 'application/grpc-web+proto',
            'Content-Length': String(modifiedBuf.length),
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Expose-Headers': '*',
          })
        ) {
          safeEnd(res, modifiedBuf);
        }
      }).catch(() => {
        const { buffer: modifiedBuf } = injectCustomModelsIntoResponse(responseBuf, customModels, undefined, true);
        if (
          safeWriteHead(res, lsRes.statusCode || 200, {
            'Content-Type': 'application/grpc-web+proto',
            'Content-Length': String(modifiedBuf.length),
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Expose-Headers': '*',
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
      safeWriteHead(res, 504, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
      });
      safeEnd(res);
    }
  });

  lsReq.on('error', (err) => {
    log.error('[Proxy] GetAvailableModels forward error:', err.message);
    if (!res.headersSent && !res.writableEnded) {
      safeWriteHead(res, 502, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
      });
      safeEnd(res);
    }
  });

  lsReq.write(bodyToSend);
  lsReq.end();
}

// ─── GetUserStatus Proxy Handler ─────────────────────────────────────────────

function handleGetUserStatusProxy(
  res: http.ServerResponse,
  reqBody: Buffer,
  lsUrl: string,
  reqHeaders: Record<string, string | string[] | undefined>,
): void {
  const lsParsed = new URL(lsUrl);
  const client = lsParsed.protocol === 'https:' ? https : http;
  const bodyToSend = reqBody && reqBody.length > 0 ? reqBody : Buffer.from([0, 0, 0, 0, 0]);

  const options: https.RequestOptions = {
    method: 'POST',
    hostname: lsParsed.hostname,
    port: lsParsed.port || (lsParsed.protocol === 'https:' ? '443' : '80'),
    path: lsParsed.pathname + lsParsed.search,
    headers: {
      'Content-Type': 'application/grpc-web+proto',
      'Accept': 'application/grpc-web+proto',
      'Content-Length': String(bodyToSend.length),
      ...(reqHeaders['x-codeium-csrf-token'] ? { 'x-codeium-csrf-token': String(reqHeaders['x-codeium-csrf-token']) } : {}),
      ...(reqHeaders['Connect-Protocol-Version'] ? { 'Connect-Protocol-Version': String(reqHeaders['Connect-Protocol-Version']) } : {}),
      ...(reqHeaders['X-Grpc-Web'] ? { 'X-Grpc-Web': String(reqHeaders['X-Grpc-Web']) } : {}),
    },
    rejectUnauthorized: !LOOPBACK_HOSTS.includes(lsParsed.hostname as typeof LOOPBACK_HOSTS[number]),
  };

  const lsReq = client.request(options, (lsRes) => {
    let lsResErrored = false;
    lsRes.on('error', (err) => {
      lsResErrored = true;
      log.error('[Proxy] LS error for GetUserStatus:', err.message);
      if (!res.headersSent && !res.writableEnded) {
        safeWriteHead(res, 502, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': '*',
        });
        safeEnd(res);
      }
    });

    const chunks: Buffer[] = [];
    lsRes.on('data', (chunk: Buffer) => chunks.push(chunk));
    lsRes.on('end', () => {
      if (lsResErrored || res.headersSent || res.writableEnded) {
        log.debug('[Proxy] GetUserStatus: skipping end handler (response terminated)');
        return;
      }
      const responseBuf = Buffer.concat(chunks);
      const customModels = loadCustomModels();
      getFastOrCachedHealth(customModels, 800).then((healthMap) => {
        const { buffer: modifiedBuf, injectedCount } = injectCustomModelsIntoUserStatus(responseBuf, customModels, healthMap);
        log.info(`[Proxy] GetUserStatus injected ${injectedCount} custom models`);
        if (
          safeWriteHead(res, lsRes.statusCode || 200, {
            'Content-Type': 'application/grpc-web+proto',
            'Content-Length': String(modifiedBuf.length),
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Expose-Headers': '*',
          })
        ) {
          safeEnd(res, modifiedBuf);
        }
      }).catch(() => {
        const { buffer: modifiedBuf, injectedCount } = injectCustomModelsIntoUserStatus(responseBuf, customModels);
        log.info(`[Proxy] GetUserStatus injected ${injectedCount} custom models (fallback)`);
        if (
          safeWriteHead(res, lsRes.statusCode || 200, {
            'Content-Type': 'application/grpc-web+proto',
            'Content-Length': String(modifiedBuf.length),
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Expose-Headers': '*',
          })
        ) {
          safeEnd(res, modifiedBuf);
        }
      });
    });
  });

  lsReq.setTimeout(30_000, () => {
    log.error('[Proxy] GetUserStatus forward timed out');
    lsReq.destroy();
    if (!res.headersSent && !res.writableEnded) {
      safeWriteHead(res, 504, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
      });
      safeEnd(res);
    }
  });

  lsReq.on('error', (err) => {
    log.error('[Proxy] GetUserStatus forward error:', err.message);
    if (!res.headersSent && !res.writableEnded) {
      safeWriteHead(res, 502, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
      });
      safeEnd(res);
    }
  });

  lsReq.write(bodyToSend);
  lsReq.end();
}

// ─── Main Request Handler ─────────────────────────────────────────────────

export function matchesCustomModel(m: CustomModel, candidate: string): boolean {
  if (!candidate || typeof candidate !== 'string') return false;
  const enumName = generateModelPlaceholderId(m);
  const slug = toSlug(m);
  const clean = candidate.replace(/^models\//, '');
  const cleanLower = clean.toLowerCase();
  const candLower = candidate.toLowerCase();
  const extLower = (m.externalModelName || '').toLowerCase();
  const idLower = ((m as { id?: string }).id || '').toLowerCase();
  const dispLower = (m.displayName || '').toLowerCase();
  const slugLower = slug.toLowerCase();
  const mSlugLower = (m._slug || '').toLowerCase();

  const isCandidateGemini = cleanLower.startsWith('gemini-');
  const isModelGemini = m.provider === 'google' || (!m.provider && (extLower.startsWith('gemini-') || idLower.startsWith('gemini-')));

  const normCand = isCandidateGemini ? normalizeGoogleModelId(cleanLower) : '';
  const normExt = (isModelGemini && extLower) ? normalizeGoogleModelId(extLower) : '';
  const normId = (isModelGemini && idLower) ? normalizeGoogleModelId(idLower) : '';

  return (
    m.name === candidate ||
    m.name === clean ||
    slug === candidate ||
    slug === clean ||
    slugLower === candLower ||
    slugLower === cleanLower ||
    enumName === candidate ||
    enumName === clean ||
    `models/${enumName}` === candidate ||
    candidate.endsWith(enumName) ||
    (Boolean(extLower) && (candLower === extLower || cleanLower === extLower || candLower === `models/${extLower}`)) ||
    (Boolean(idLower) && (candLower === idLower || cleanLower === idLower || candLower === `models/${idLower}`)) ||
    (Boolean(dispLower) && (candLower === dispLower || cleanLower === dispLower)) ||
    (Boolean(mSlugLower) && (candLower === mSlugLower || cleanLower === mSlugLower)) ||
    (isCandidateGemini && isModelGemini && Boolean(normExt) && normCand === normExt) ||
    (isCandidateGemini && isModelGemini && Boolean(normId) && normCand === normId) ||
    (isModelGemini && candLower.includes('gemini-3.8-flash') && (extLower.includes('gemini-3.8-flash') || idLower.includes('gemini-3.8-flash') || dispLower.includes('gemini 3.8 flash'))) ||
    (isModelGemini && candLower.includes('gemini-3.7-flash') && (extLower.includes('gemini-3.7-flash') || idLower.includes('gemini-3.7-flash') || dispLower.includes('gemini 3.7 flash')))
  );
}

function isAllowedOrigin(req: http.IncomingMessage): boolean {
  const host = (req.headers.host || '').toLowerCase();
  const origin = ((req.headers.origin || req.headers.referer || '') as string).toLowerCase();

  // 1. Validate Host header — local loopback or googleapis upstream
  const isHostAllowed = LOOPBACK_HOSTS.some((h) => host.startsWith(h)) || host.endsWith('.googleapis.com');
  if (!isHostAllowed) return false;

  // 2. Direct requests without Origin/Referer (Language Server Go, internal gRPC/HTTP)
  if (!origin) return true;

  // 3. Validate Origin/Referer header against known trusted local and Google origins
  try {
    const parsed = new URL(origin);
    const h = parsed.hostname.toLowerCase();
    return (
      LOOPBACK_HOSTS.includes(h as typeof LOOPBACK_HOSTS[number]) ||
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

  // Remote VPS Agent State Sync (from IDE Webview or preload)
  if (req.url === '/api/remote/status' || req.url?.startsWith('/api/remote/status?')) {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ active: isRemoteVpsActive, host: remoteVpsHost, token: remoteVpsToken || DEFAULT_REMOTE_TOKEN, remoteSessions: remoteSessionsMap }));
      return;
    }
    if (req.method === 'POST') {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        try {
          const b = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as {
            active?: boolean;
            host?: string;
            token?: string;
            remoteSessions?: Record<string, boolean>;
          };
          if (b.active !== undefined) isRemoteVpsActive = !!b.active;
          if (b.host) remoteVpsHost = String(b.host);
          if (b.token && b.token !== 'null' && b.token !== 'undefined' && String(b.token).trim().length > 0) {
            remoteVpsToken = String(b.token).trim();
          }
          if (b.remoteSessions && typeof b.remoteSessions === 'object') {
            remoteSessionsMap = { ...remoteSessionsMap, ...b.remoteSessions };
          }
          saveRemoteState();
          log.info(`[Proxy] Remote VPS session status updated: active=${isRemoteVpsActive}, host=${remoteVpsHost}, tokenSet=${!!remoteVpsToken}, remoteSessionsCount=${Object.keys(remoteSessionsMap).length}`);
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ ok: true, active: isRemoteVpsActive, host: remoteVpsHost, token: remoteVpsToken || DEFAULT_REMOTE_TOKEN, remoteSessions: remoteSessionsMap }));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }
  }

  // Remote VPS Command Execution Bridge (POST /api/remote/cmd)
  if (req.url === '/api/remote/cmd' || req.url?.startsWith('/api/remote/cmd?')) {
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
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify(result));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ ok: false, error: (e as Error).message }));
        }
      });
      return;
    }
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

  // Multi-account pool live telemetry & health inspection endpoint
  if (req.method === 'GET' && (req.url === '/pool-status' || req.url === '/pool/status')) {
    const customModels = expandModelsWithEffort(loadCustomModels());
    const googleModels = customModels.filter((m) => isGoogleCloudCodeModel(m));
    const seenAccounts = new Set<string>();
    const poolStats: Array<{
      accountKey: string;
      email: string;
      name: string;
      dynamicScore: number;
      baseScore: number;
      geminiQuotaPct: number;
      claudeQuotaPct: number;
      quotaSource: 'LIVE' | 'STATIC';
      inFlight: number;
      inProbation: boolean;
      maxConcurrent: number;
      slotAvailable: boolean;
      reauthRequired: boolean;
      rpmLastMinute: number;
      cooldownRemainingSec: number;
      tokenCached: boolean;
      status: 'HEALTHY' | 'PROBATION' | 'COOLDOWN' | 'BREAKER_OPEN' | 'REAUTH_REQUIRED';
    }> = [];

    for (const m of googleModels) {
      const key = getAccountQuotaKey(m);
      if (seenAccounts.has(key)) continue;
      seenAccounts.add(key);

      const email = m.accountEmail || (m as any).email || '';
      const name = m.accountName || m.displayName || m.name;
      const inFlight = getAccountInFlight(m);
      const inProbation = isAccountInProbation(m);
      const rpmLastMinute = getAccountRpmCount(m);
      const dynamicScore = getAccountDynamicScore(m);
      const baseScore = getModelQuotaScore(m);
      const cooldownMs = getAccountCooldownRemaining(m);
      const breaker = getOpenBreaker(m);

      const live = getLiveAccountQuota(key);
      const q = (live || m.quotas) as Record<string, any> | undefined;
      const geminiQuotaPct = typeof q?.geminiFiveHourPct === 'number'
        ? q.geminiFiveHourPct
        : typeof q?.fiveHourPercentage === 'number'
          ? q.fiveHourPercentage
          : 50;
      const claudeQuotaPct = typeof q?.claudeFiveHourPct === 'number' ? q.claudeFiveHourPct : 50;
      const quotaSource: 'LIVE' | 'STATIC' = live ? 'LIVE' : 'STATIC';

      const revoked = isTokenRevoked(m.refreshToken);
      let status: 'HEALTHY' | 'PROBATION' | 'COOLDOWN' | 'BREAKER_OPEN' | 'REAUTH_REQUIRED' = 'HEALTHY';
      if (revoked) {
        status = 'REAUTH_REQUIRED';
      } else if (breaker) {
        status = 'BREAKER_OPEN';
      } else if (cooldownMs > 0) {
        status = 'COOLDOWN';
      } else if (inProbation) {
        status = 'PROBATION';
      }

      poolStats.push({
        accountKey: key,
        email,
        name,
        dynamicScore,
        baseScore,
        geminiQuotaPct,
        claudeQuotaPct,
        quotaSource,
        inFlight,
        inProbation,
        maxConcurrent: MAX_CONCURRENT_PER_ACCOUNT,
        slotAvailable: inFlight < MAX_CONCURRENT_PER_ACCOUNT,
        reauthRequired: revoked,
        rpmLastMinute,
        cooldownRemainingSec: Math.ceil(cooldownMs / 1000),
        tokenCached: isTokenCached(m.refreshToken),
        status,
      });
    }

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(
      JSON.stringify({
        poolSize: poolStats.length,
        maxConcurrentPerAccount: MAX_CONCURRENT_PER_ACCOUNT,
        timestamp: Date.now(),
        accounts: poolStats,
      }),
    );
    return;
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
    return;
  }

  req.url = req.url!.replace(/^.*\/dummy_path_padding/, '');
  // Strip binary patch padding (from LS hostname replacement)
  req.url = req.url!.replace(/\/v1internal\/x{7}/, '');

  // P0-4: Enforce maximum request body size to prevent memory exhaustion DoS
  const MAX_BODY_SIZE = DEFAULT_MAX_BODY_SIZE;
  let bodyLength = 0;
  let bodyRejected = false;

  const bodyChunks: Buffer[] = [];
  req.on('data', (chunk) => {
    bodyLength += chunk.length;
    if (bodyLength > MAX_BODY_SIZE) {
      if (!bodyRejected) {
        bodyRejected = true;
        const maxMb = Math.round(MAX_BODY_SIZE / (1024 * 1024));
        log.warn(`[Proxy] Request body exceeds ${maxMb}MB limit (${req.method} ${req.url})`);
        if (!res.headersSent) {
          res.writeHead(413, {
            'Content-Type': 'application/json',
            'Connection': 'close',
          });
          res.end(
            JSON.stringify({ error: { message: `Request body too large. Maximum: ${maxMb}MB` } }),
          );
        }
        req.resume();
        res.on('finish', () => {
          req.destroy();
        });
      }
      return;
    }
    bodyChunks.push(chunk);
  });
  req.on('end', async () => {
    if (bodyRejected) return;

    let fullBody = Buffer.concat(bodyChunks);
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

    // OpenAI /chat/completions relay: sanitizes reasoning_content and forwards to upstream provider
    if (req.method === 'POST' && req.url!.includes('/chat/completions')) {
      try {
        const payload = JSON.parse(bodyStr || '{}');
        if (payload.model && /MODEL_PLACEHOLDER_/i.test(payload.model)) {
          const allModels = loadCustomModels();
          const found = allModels.find(
            (m) => generateModelPlaceholderId(m) === payload.model || m.name === payload.model || m.name.endsWith('/' + payload.model),
          );
          if (found && found.externalModelName) {
            payload.model = found.externalModelName;
          } else {
            const active = allModels.filter(m => m.enabled !== false && m.externalModelName);
            const defaultModel = active[0] || allModels[0];
            if (defaultModel && defaultModel.externalModelName) {
              payload.model = defaultModel.externalModelName;
            }
          }
        }
        if (Array.isArray(payload.messages)) {
          for (const msg of payload.messages) {
            delete msg.reasoning_content;
          }
        }
        // Modern reasoning models (gpt-6, astra, luna, o-series) reject non-default temperature
        if (payload.temperature !== undefined && payload.temperature !== 1) {
          delete payload.temperature;
        }
        if (payload.max_tokens && !payload.max_completion_tokens) {
          payload.max_completion_tokens = payload.max_tokens;
          delete payload.max_tokens;
        }
        log.info(`[Relay on 51074] Forwarding request for model: ${payload.model}`);
        const cleanedBody = JSON.stringify(payload);
        const upstreamTarget = (req.headers['x-upstream-url'] as string) || 'https://api.experientiallabs.ai/v1/chat/completions';
        const upstreamUrl = new URL(upstreamTarget);
        const forwardHeaders: Record<string, string> = {
          host: upstreamUrl.host,
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(cleanedBody)),
        };
        for (const [k, v] of Object.entries(req.headers)) {
          const lk = k.toLowerCase();
          if (
            lk !== 'host' &&
            lk !== 'content-length' &&
            lk !== 'transfer-encoding' &&
            lk !== 'connection' &&
            lk !== 'accept-encoding' &&
            lk !== 'x-upstream-url' &&
            typeof v === 'string'
          ) {
            forwardHeaders[lk] = v;
          }
        }

        const isHttps = upstreamUrl.protocol === 'https:';
        const client = isHttps ? https : http;
        const upstreamReq = client.request(upstreamUrl, {
          method: 'POST',
          headers: forwardHeaders,
        }, (upstreamRes) => {
          safeWriteHead(res, upstreamRes.statusCode || 200, upstreamRes.headers as any);
          upstreamRes.pipe(res);
        });
        upstreamReq.on('error', (err) => {
          log.error('[Proxy] /chat/completions relay network error:', err);
          if (safeWriteHead(res, 502, { 'Content-Type': 'application/json' })) {
            safeEnd(res, JSON.stringify({ error: { message: err.message } }));
          }
        });
        upstreamReq.write(cleanedBody);
        upstreamReq.end();
        return;
      } catch (err) {
        log.error('[Proxy] /chat/completions relay error:', err);
      }
    }

    // 0. Intercept GetAvailableModels (redirected from Electron webRequest)
    if (req.url!.startsWith('/GetAvailableModels')) {
      const gavParsed = new URL(req.url!, `http://${LOOPBACK_HOSTS[0]}`);
      const lsUrl = gavParsed.searchParams.get('ls');
      if (lsUrl) {
        handleGetAvailableModelsProxy(res, fullBody, lsUrl, req.headers as Record<string, string | string[] | undefined>);
        return;
      }
      if (safeWriteHead(res, 400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })) {
        safeEnd(res, JSON.stringify({ error: 'Missing ls parameter' }));
      }
      return;
    }

    // 0.1. Intercept GetUserStatus (redirected from Electron webRequest for Antigravity 2.5+/2.12+)
    if (req.url!.startsWith('/GetUserStatus')) {
      const gusParsed = new URL(req.url!, `http://${LOOPBACK_HOSTS[0]}`);
      const lsUrl = gusParsed.searchParams.get('ls');
      if (lsUrl) {
        handleGetUserStatusProxy(res, fullBody, lsUrl, req.headers as Record<string, string | string[] | undefined>);
        return;
      }
      if (safeWriteHead(res, 400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })) {
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

    // 0.6. Intercept telemetry metrics to avoid noisy upstream 503 UNAVAILABLE errors
    if (
      req.url!.includes('/v1internal:recordCodeAssistMetrics') ||
      req.url!.includes('/v1internal:recordTrajectoryAnalytics')
    ) {
      if (safeWriteHead(res, 200, { 'Content-Type': 'application/json' })) {
        safeEnd(res, JSON.stringify({}));
      }
      return;
    }

    // 0.7. Intercept /v1internal:loadCodeAssist with caching and fast fallback
    if (req.url!.includes('/v1internal:loadCodeAssist')) {
      log.info('[Proxy] Intercepting loadCodeAssist request');

      const buildDefaultFallback = () => {
        const customModels = loadCustomModels();
        const googleAccount = customModels.find((m) => (m as any).accountProject || (m as any).projectId);
        const projectId = (googleAccount as any)?.accountProject || (googleAccount as any)?.projectId || 'projects/antigravity-local';
        return JSON.stringify({
          cloudaicompanionProject: projectId,
          allowedTiers: [{ id: 'free-tier', isDefault: true }],
          currentTier: { id: 'free-tier' },
        });
      };

      // If we have a fresh cache (< 3 minutes), serve it immediately to avoid upstream 429
      const freshCache = (Date.now() - memoryLoadCodeAssistTime < 180_000) ? loadCachedCodeAssist() : null;
      if (freshCache) {
        log.info('[Proxy] Serving fresh cached loadCodeAssist response');
        if (safeWriteHead(res, 200, { 'Content-Type': 'application/json' })) {
          safeEnd(res, freshCache);
        }
        return;
      }

      const targetHost = GOOGLE_HOSTS.CLOUD_CODE;
      const targetUrl = `https://${targetHost}`;
      let parsedUrl: URL;
      try {
        const realIp = await resolveGoogleIp(targetHost);
        parsedUrl = new URL(req.url!, targetUrl);
        parsedUrl.hostname = realIp;
      } catch (e) {
        log.warn(`[Proxy] DNS resolution failed for ${targetHost} on loadCodeAssist:`, e);
        const cached = loadCachedCodeAssist() || buildDefaultFallback();
        if (safeWriteHead(res, 200, { 'Content-Type': 'application/json' })) {
          safeEnd(res, cached);
        }
        return;
      }

      const fwdHeaders: Record<string, string | string[] | undefined> = {
        ...(req.headers as Record<string, string | string[] | undefined>),
      };
      fwdHeaders['host'] = targetHost;
      fwdHeaders['user-agent'] = 'antigravity';
      delete fwdHeaders['connection'];
      delete fwdHeaders['keep-alive'];
      delete fwdHeaders['accept-encoding'];

      const fwdOptions: https.RequestOptions = {
        method: req.method,
        headers: fwdHeaders as Record<string, string>,
        servername: targetHost,
      };

      const fallback = () => {
        if (res.headersSent || res.writableEnded) return;
        const cached = loadCachedCodeAssist() || buildDefaultFallback();
        log.warn('[Proxy] Upstream loadCodeAssist failed/timed out, serving fallback response');
        if (safeWriteHead(res, 200, { 'Content-Type': 'application/json' })) {
          safeEnd(res, cached);
        }
      };

      let completed = false;
      const googleReq = https.request(parsedUrl, fwdOptions, (googleRes) => {
        if (googleRes.statusCode === 429 || googleRes.statusCode === 503) {
          completed = true;
          fallback();
          return;
        }

        const chunks: Buffer[] = [];
        googleRes.on('data', (c) => chunks.push(c));
        googleRes.on('end', () => {
          if (completed || res.headersSent || res.writableEnded) return;
          completed = true;
          const body = Buffer.concat(chunks).toString('utf-8');
          if (googleRes.statusCode === 200 && body.startsWith('{')) {
            saveCachedCodeAssist(body);
            if (safeWriteHead(res, 200, { 'Content-Type': 'application/json' })) {
              safeEnd(res, body);
            }
          } else if (googleRes.statusCode && googleRes.statusCode < 500) {
            if (safeWriteHead(res, googleRes.statusCode, { 'Content-Type': 'application/json' })) {
              safeEnd(res, body);
            }
          } else {
            fallback();
          }
        });
      });

      googleReq.setTimeout(8_000, () => {
        if (!completed) {
          completed = true;
          googleReq.destroy();
          fallback();
        }
      });

      googleReq.on('error', (err) => {
        if (!completed) {
          completed = true;
          log.warn('[Proxy] Upstream loadCodeAssist network error:', err.message);
          fallback();
        }
      });

      if (fullBody && fullBody.length > 0) {
        googleReq.write(fullBody);
      }
      googleReq.end();
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

      const targetHost = GOOGLE_HOSTS.CLOUD_CODE;
      const targetUrl = `https://${targetHost}`;
      let parsedUrl: URL;
      try {
        const realIp = await resolveGoogleIp(targetHost);
        parsedUrl = new URL(req.url!, targetUrl);
        parsedUrl.hostname = realIp;
      } catch (e) {
        log.warn(`[Proxy] DNS resolution failed for ${targetHost}, serving offline custom models:`, e);
        if (!res.headersSent && !res.writableEnded) {
          const customModels = loadCustomModels();
          safeWriteHead(res, 200, { 'Content-Type': 'application/json' });
          safeEnd(res, JSON.stringify(buildSyntheticModelsResponse(customModels)));
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
            safeWriteHead(res, 200, { 'Content-Type': 'application/json' });
            safeEnd(res, JSON.stringify(buildSyntheticModelsResponse(customModels)));
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
          let googleJson: Record<string, unknown> | null = null;
          try {
            log.info(
              `[Proxy] fetchAvailableModels response status: ${googleRes.statusCode}, body length: ${googleBody.length}`,
            );

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
              const synth = buildSyntheticModelsResponse(customModels);
              googleJson.models = synth.models;
              if (!googleJson.agentModelSorts) googleJson.agentModelSorts = synth.agentModelSorts;
            }

            // 2. Injecter les modèles personnalisés dans agentModelSorts (menu déroulant Antigravity IDE)
            // Modèles originaux en tête de liste, modèles personnalisés ajoutés sans duplication
            try {
              if (typeof injectCustomSlugsIntoAgentModelSorts === 'function') {
                injectCustomSlugsIntoAgentModelSorts(googleJson, customModels);
              }
            } catch (sortErr) {
              log.warn('[Proxy] Failed to inject custom slugs into agentModelSorts:', sortErr);
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
              const entry = {
                displayName: m.displayName,
                maxTokens: 1048576,
                maxOutputTokens: 4096,
                model: pid,
                planModel: pid,
                requestedModel: pid,
                apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
                modelProvider: 'MODEL_PROVIDER_GOOGLE',
              };
              mappedCustom[slug] = entry;
              mappedCustom[pid] = entry;
            });
            // If googleJson has models, preserve them!
            let responsePayload: Record<string, unknown> = { models: mappedCustom };
            if (googleJson && typeof googleJson === 'object') {
              if (googleJson.models && typeof googleJson.models === 'object') {
                responsePayload = { ...googleJson, models: { ...(googleJson.models as Record<string, unknown>), ...mappedCustom } };
              } else {
                responsePayload = { ...googleJson, models: mappedCustom };
              }
            }
            safeWriteHead(res, 200, { 'Content-Type': 'application/json' });
            safeEnd(res, JSON.stringify(responsePayload));
          }
        });
      });

      googleReq.on('error', (err) => {
        log.error('[Proxy] Forwarding fetchAvailableModels failed:', err);
        if (!res.headersSent && !res.writableEnded) {
          const customModels = loadCustomModels();
          safeWriteHead(res, 200, { 'Content-Type': 'application/json' });
          safeEnd(res, JSON.stringify(buildSyntheticModelsResponse(customModels)));
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

      const targetHost = GOOGLE_HOSTS.GENERATIVE_LANGUAGE;
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
    let isSessionRemote = false;
    let convId: string | null = null;
    const isCloudCodeStream =
      (req.url!.includes('v1internal') || req.url!.includes('cloudcode')) &&
      (req.url!.includes('streamGenerateContent') || req.url!.includes('generateContent'));
    if (req.method === 'POST' && isCloudCodeStream) {
      try {
        const reqJson = JSON.parse(bodyStr) as Record<string, unknown>;
        const targetReq = (reqJson.request || reqJson) as Record<string, unknown>;

        if (targetReq.systemInstruction && typeof targetReq.systemInstruction === 'object') {
          const si = targetReq.systemInstruction as { parts?: Array<{ text?: string }> };
          const fullSysText = (si.parts || []).map((p) => p.text || '').join('\n');
          const match = fullSysText.match(/Conversation ID:\s*([a-f0-9\-]+)/i);
          if (match) convId = match[1];
        }

        const candidateNames = [
          reqJson.model,
          reqJson.requestedModel,
          reqJson.planModel,
          reqJson.requested_model,
          reqJson.plan_model,
          reqJson.modelId,
          reqJson.model_id,
          reqJson.agentModel,
          reqJson.selectedModel,
          targetReq.model,
          targetReq.requestedModel,
          targetReq.planModel,
          targetReq.requested_model,
          targetReq.plan_model,
          targetReq.modelId,
          targetReq.model_id,
          targetReq.agentModel,
          targetReq.selectedModel,
        ].filter((x): x is string => typeof x === 'string' && Boolean(x));

        log.info(
          `[Proxy] Cloud Code generation request candidates: ${candidateNames.join(', ')}, url: ${req.url}, bodyKeys: ${Object.keys(reqJson).join(',')}`,
        );

        const customModels = expandModelsWithEffort(loadCustomModels());
        let actualGeminiBody: GeminiRequestBody | undefined;
        let sessId = '';
        let sessionKey = '';

        if (candidateNames.length > 0) {
          actualGeminiBody = (reqJson.request || reqJson) as GeminiRequestBody;
          sessId = extractSessionId(actualGeminiBody as Record<string, unknown>, req.headers as Record<string, unknown>);
          sessionKey = convId || sessId;

          if (sessionKey) {
            const activeFallback = getSessionModelFallback(sessionKey);
            if (activeFallback) {
              const isOrigClaude = activeFallback.originalModel.toLowerCase().includes('claude');
              const matchesOrig = candidateNames.some((cn) => {
                const norm = normalizeCloudCodeModelId(cn);
                return norm === activeFallback.originalModel || (isOrigClaude && cn.toLowerCase().includes('claude'));
              });
              if (matchesOrig) {
                log.info(`[Proxy] Active session fallback for ${sessionKey}: transparently routing ${activeFallback.originalModel} -> ${activeFallback.fallbackModel}`);
                candidateNames.unshift(activeFallback.fallbackModel);
                reqJson.model = activeFallback.fallbackModel;
                if (reqJson.request && typeof reqJson.request === 'object') {
                  (reqJson.request as Record<string, unknown>).model = activeFallback.fallbackModel;
                }
              }
            }
          }
        }

        let matchingCandidates = customModels.filter((m) =>
          candidateNames.some((cn) => matchesCustomModel(m, cn)),
        );
        if (matchingCandidates.length === 0) {
          matchingCandidates = customModels.filter((m) =>
            candidateNames.some((cn) => {
              const norm = normalizeGoogleModelId(cn);
              return norm && (matchesCustomModel(m, norm) || matchesCustomModel(m, `models/${norm}`));
            }),
          );
        }
        let matchedCustomModel = selectBestModelByQuota(matchingCandidates, customModels);
        // Fallback: if an older conversation references a legacy placeholder (e.g. M299/M298/M50/M565)
        if (!matchedCustomModel && candidateNames.some((cn) => /MODEL_PLACEHOLDER_/i.test(cn))) {
          const activePool = customModels.filter(m => !(m as any)._poolOnly && m.enabled !== false);
          matchedCustomModel = selectBestModelByQuota(activePool.length > 0 ? activePool : customModels, customModels) || activePool[0] || customModels[0];
        }

        const effectiveModelName = (
          matchedCustomModel?.externalModelName ||
          matchedCustomModel?.name ||
          candidateNames[0] ||
          ''
        ).toLowerCase();
        const isClaudeRequest = effectiveModelName.includes('claude');

        // Restore any missing thought_signatures in conversation history for Gemini 3+ function calls
        let signaturesRestored = false;
        let contentsNormalized = false;
        if (Array.isArray(targetReq.contents)) {
          if (isClaudeRequest) {
            sanitizeCloudCodeGenerationConfig(targetReq, effectiveModelName);
            contentsNormalized = true;
          } else {
            signaturesRestored = restoreThoughtSignatures(targetReq.contents, convId || '', effectiveModelName);
            if (sanitizeUnsignedToolCalls(targetReq.contents)) {
              contentsNormalized = true;
              normalizeConversationTurns(targetReq.contents);
            }
          }
        }

        if (signaturesRestored || contentsNormalized) {
          fullBody = Buffer.from(JSON.stringify(reqJson), 'utf-8');
          log.info(`[Proxy] Re-encoded Cloud Code request with normalized turns/signatures (convId=${convId || 'draft'}, model=${effectiveModelName})`);
        }

          if (matchedCustomModel && matchedCustomModel.apiKey === 'auto') {
            const baseName = getBaseModelId(matchedCustomModel.externalModelName || matchedCustomModel.name);
            const realSiblings = customModels.filter(m => m.apiKey !== 'auto' && getBaseModelId(m.externalModelName || m.name) === baseName && !getOpenBreaker(m));
            matchedCustomModel = selectBestModelByQuota(realSiblings, customModels) || matchedCustomModel;
          }

          if (matchedCustomModel) {
            const isStream = req.url!.includes('streamGenerateContent') || req.url!.includes('alt=sse');

            // Apply Sticky Session affinity (preserves Cloud Code prompt cache)
            if (sessId) {
              matchedCustomModel = getSessionBoundModel(sessId, matchedCustomModel, customModels);
              bindSessionToModel(sessId, matchedCustomModel);
            }

            log.info(
              `[Proxy] Intercepting Cloud Code generation for custom model: ${matchedCustomModel.displayName}${sessId ? ` (session: ${sessId})` : ''}`,
            );

            // Resolve fileData URIs then route to translator
            resolveFileData(actualGeminiBody, req.headers as Record<string, string | string[] | undefined>).then(async () => {
              if (isGoogleCloudCodeModel(matchedCustomModel)) {
                try {
                  const accountPool = getGoogleAccountPool(matchedCustomModel, customModels);
                  log.info(`[Proxy] Forwarding Cloud Code request via multi-account pool (${accountPool.length} candidate accounts) for model ${matchedCustomModel.externalModelName || matchedCustomModel.name}`);
                  await executeGoogleCloudCodeWithPool(
                    req,
                    res,
                    reqJson,
                    accountPool,
                    isSessionRemote,
                    convId || '',
                    sessId,
                  );
                  return;
                } catch (err) {
                  log.error('[Proxy] Failed to execute Cloud Code request with pool, falling back to translator:', err);
                }
              }

              handleCustomModelRequest(res, matchedCustomModel, actualGeminiBody, isStream);
            });
            return;
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
      let matchingCandidates = customModels.filter((m) =>
        matchesCustomModel(m, matchedModelName),
      );
      if (matchingCandidates.length === 0) {
        const norm = normalizeGoogleModelId(matchedModelName);
        if (norm) {
          matchingCandidates = customModels.filter((m) =>
            matchesCustomModel(m, norm) || matchesCustomModel(m, `models/${norm}`),
          );
        }
      }
      let matchedCustomModel = selectBestModelByQuota(matchingCandidates, customModels);
      if (!matchedCustomModel && /MODEL_PLACEHOLDER_/i.test(matchedModelName)) {
        const activePool = customModels.filter(m => !(m as any)._poolOnly && m.enabled !== false);
        matchedCustomModel = selectBestModelByQuota(activePool.length > 0 ? activePool : customModels, customModels) || activePool[0] || customModels[0];
      }

      if (matchedCustomModel && matchedCustomModel.apiKey === 'auto') {
        const baseName = getBaseModelId(matchedCustomModel.externalModelName || matchedCustomModel.name);
        const realSiblings = customModels.filter(m => m.apiKey !== 'auto' && getBaseModelId(m.externalModelName || m.name) === baseName && !getOpenBreaker(m));
        matchedCustomModel = selectBestModelByQuota(realSiblings, customModels) || matchedCustomModel;
      }

      if (matchedCustomModel) {
        try {
          const geminiBody = JSON.parse(bodyStr) as GeminiRequestBody;
          if (Array.isArray(geminiBody.contents)) {
            normalizeConversationTurns(geminiBody.contents);
          }

          // Apply Sticky Session affinity (preserves prompt cache across multi-account pool)
          const sessId = extractSessionId(geminiBody as Record<string, unknown>, req.headers as Record<string, unknown>);
          if (sessId) {
            matchedCustomModel = getSessionBoundModel(sessId, matchedCustomModel, customModels);
            bindSessionToModel(sessId, matchedCustomModel);
          }

          resolveFileData(geminiBody, req.headers as Record<string, string | string[] | undefined>).then(async () => {
            if (isGoogleCloudCodeModel(matchedCustomModel)) {
              try {
                const accountPool = getGoogleAccountPool(matchedCustomModel, customModels);
                const targetModel = normalizeCloudCodeModelId(matchedCustomModel.externalModelName || matchedCustomModel.name);
                sanitizeCloudCodeGenerationConfig(geminiBody as Record<string, unknown>, targetModel);
                const cloudCodePayload = {
                  project: (matchedCustomModel as { projectId?: string }).projectId || process.env.AG_CLOUD_CODE_PROJECT_ID || 'bamboo-precept-lgxtn',
                  model: targetModel,
                  request: geminiBody,
                };

                const origUrl = req.url;
                req.url = isStandardStream ? '/v1internal:streamGenerateContent?alt=sse' : '/v1internal:generateContent';
                await executeGoogleCloudCodeWithPool(
                  req,
                  res,
                  cloudCodePayload,
                  accountPool,
                  false,
                  convId || '',
                  sessId,
                );
                req.url = origUrl;
                return;
              } catch (err) {
                log.error('[Proxy] Failed to route standard generateContent to Cloud Code natively:', err);
              }
            }

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
    // Strip any Claude thinking blocks before forwarding — they carry account-specific HMAC
    // signatures that become invalid if the account differs from the one that generated them.
    try {
      const fallbackJson = JSON.parse(bodyStr) as Record<string, unknown>;
      const fallbackReq = (fallbackJson.request || fallbackJson) as Record<string, unknown>;
      const rawModelName = String(
        fallbackJson.model ||
        fallbackJson.requestedModel ||
        fallbackReq.model ||
        fallbackReq.requestedModel ||
        ''
      ).toLowerCase();
      if (rawModelName.includes('claude') && Array.isArray(fallbackReq.contents)) {
        sanitizeCloudCodeGenerationConfig(fallbackReq, rawModelName);
        fullBody = Buffer.from(JSON.stringify(fallbackJson), 'utf-8');
      }
    } catch { /* not JSON — continue as-is */ }
    await proxyToGoogle(req, res, fullBody, isSessionRemote, undefined, convId || '');

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
              prewarmGoogleAccounts(models);
              pollAllGoogleQuotas(models, autoHealAccountOnQuotaRecovery).catch(() => {});
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

// ─── Live Quota Polling Interval (Every 3 minutes) ─────────────────────────
let quotaPollTimer: NodeJS.Timeout | null = null;

export function startQuotaPollingInterval(intervalMs = 180_000): void {
  stopQuotaPollingInterval();
  try {
    const models = loadCustomModels();
    pollAllGoogleQuotas(models, autoHealAccountOnQuotaRecovery).catch((err) => {
      log.debug('[Proxy] Initial quota polling skipped:', err?.message || err);
    });
  } catch (_) {}

  quotaPollTimer = setInterval(() => {
    try {
      const models = loadCustomModels();
      pollAllGoogleQuotas(models, autoHealAccountOnQuotaRecovery).catch((err) => {
        log.debug('[Proxy] Quota polling tick skipped:', err?.message || err);
      });
    } catch (_) {}
  }, intervalMs);

  if (quotaPollTimer.unref) quotaPollTimer.unref();
}

export function stopQuotaPollingInterval(): void {
  if (quotaPollTimer) {
    clearInterval(quotaPollTimer);
    quotaPollTimer = null;
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
      const defaultHost = process.env.AG_PROXY_HOST || LOOPBACK_HOSTS[0];

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
            startQuotaPollingInterval();
            setupCustomModelsWatcher();
            const models = loadCustomModels();
            prewarmGoogleAccounts(models);
          } catch (err) {
            log.error('[Proxy] Failed to start cleanup interval / pre-warm:', err);
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
    stopQuotaPollingInterval();
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
