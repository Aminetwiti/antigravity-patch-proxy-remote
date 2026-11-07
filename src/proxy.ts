import {
  setupCustomModelsWatcher,
  stopCustomModelsWatcher,
  startQuotaPollingInterval,
  stopQuotaPollingInterval,
  loadPersistedState,
  flushPersistedState,
  startProxyServer,
  stopProxyServer,
  getProxyPort,
  isProxyRunning,
} from './proxy/serverLifecycle';

export {
  setupCustomModelsWatcher,
  stopCustomModelsWatcher,
  startQuotaPollingInterval,
  stopQuotaPollingInterval,
  loadPersistedState,
  flushPersistedState,
  getProxyPort,
  isProxyRunning,
};

// ─── Constants & Imports ───────────────────────────────────────────────────

import * as http from 'http';
import https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as zlib from 'zlib';
import { StringDecoder } from 'string_decoder';
import { randomBytes } from 'crypto';

import log from 'electron-log';

if (log.transports?.file && log.transports.file.level === 'silly') {
  log.transports.file.level = (process.env.AG_LOG_LEVEL as any) || 'info';
}
if (log.transports?.console && log.transports.console.level === 'silly') {
  log.transports.console.level = (process.env.AG_LOG_LEVEL as any) || 'info';
}
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
  GOOGLE_POOL_HEADER_TIMEOUT_MS,
  GOOGLE_POOL_HEADER_TIMEOUT_FLASH_MS,
  GOOGLE_POOL_HEADER_TIMEOUT_LARGE_PROMPT_MS,
  RATE_LIMIT_RELIEF_WAIT_MS,
  FILE_DOWNLOAD_TIMEOUT_MS,
  STREAM_IDLE_TIMEOUT_MS,
  ACTIVE_PORT_FILE,
  DEFAULT_MAX_BODY_SIZE,
  HEDGED_REQUEST_DELAY_MS,
  CAPACITY_503_CASCADE_THRESHOLD,
  CONSECUTIVE_504_CASCADE_THRESHOLD,
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
  ANTI_HALLUCINATION_TOOL_INSTRUCTION,
  detectAndMitigateToolLoops,
  markConvCorruptedSignatures,
  isConvCorruptedSignatures,
  touchStateTimestamp,
  getSessionModelKey,
  startCleanupInterval,
  stopCleanupInterval,
} from './proxy/shared';
import * as registry from './proxy/registry';
import { injectCustomModelsIntoResponse, injectCustomModelsIntoUserStatus } from './proxy/protoInjector';
import { loadCustomModels, getCustomModelsPath, loadDisabledModelIds, getLastCustomModelsContentOnDisk, setLastCustomModelsContentOnDisk } from './proxy/modelLoader';
import { invalidateModelStoreCache } from './services/modelStore';
import { invalidateHealthCache } from './proxy/modelHealthChecker';
import { recordProviderUsage } from './customModelStore';
import { classifyError, ErrorDiagnostic, type ErrorType } from './proxy/errorClassifier';
import { readBodyWithLimit } from './proxy/bodyLimitGuard';
import { saveRemoteStateAsync } from './proxy/remoteSessionStore';
import { shouldRetryStatus, computeRetryDelay, isRetryableNetworkError, type RetryStrategy } from './proxy/retryStrategy';
import { getOpenBreaker, recordFailure, recordSuccess, CIRCUIT_BREAKER_RESET_MS } from './proxy/circuitBreaker';
import { IdleTimeoutGuard } from './proxy/idleTimeout';
import { resolveClientForUrl, getHttpsAgent, evictAgent, disposeAll as disposeAgentPool, warmTlsConnection } from './proxy/agentPool';
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
import { handleInternalApiRoute } from './proxy/internalApiRoutes';
import {
  resolveProvider,
  resolveCustomModelUrl,
  resolveMaxRetries,
  resolveRequestTimeout,
  getBaseModelId,
} from './proxy/urlBuilder';
import { generateModelPlaceholderId, toSlug } from './proxy/idGenerator';
import { expandModelsWithEffort } from './proxy/effortExpander';
import { isNativeCloudCodeModel, extractModelNameFromPayload, clampSubagentReasoning, isSubagentRequest, matchesCustomModel } from './proxy/modelUtils';
export { isNativeCloudCodeModel, extractModelNameFromPayload, clampSubagentReasoning, isSubagentRequest, matchesCustomModel };
import { resolveGoogleIp, invalidateCachedDns } from './proxy/dnsResolver';
import { markProviderRateLimited, isProviderRateLimited } from './proxy/modelRouter';
import { trimContextPayload } from './proxy/contextTrimmer';
import { checkAllModelsHealth, getFastOrCachedHealth } from './proxy/modelHealthChecker';
import { recordRecentModel, restoreRecentModels } from './proxy/recentModelsStore';
import { mcpListServers, mcpCallTool } from './proxy/mcpRelay';
import {
  getValidGoogleAccessToken,
  normalizeCloudCodeModelId,
  normalizeGoogleModelId,
  isGoogleCloudCodeModel,
  isGeminiCliModel,
  sanitizeCloudCodeGenerationConfig,
  normalizeConversationTurns,
  prewarmGoogleAccounts,
  isTokenCached,
  isTokenRevoked,
  getLiveAccountQuota,
  updateLiveAccountQuota,
  pollAllGoogleQuotas,
  AccountLiveQuota,
  isAccountEntitledToClaude55,
  applyAntiTruncation,
  extractSyntheticToolContent,
  SYNTHETIC_TOOL_NAME,
  onboardUserAndAcceptTerms,
} from './services/googleAuth';
import { loadPersistentQuotaCache } from './services/quotaCacheStore';
import {
  registerAccountRefreshToken,
  getAccountQuotaKey,
  isAccountUnlicensed,
  markAccountUnlicensed,
  unmarkAccountUnlicensed,
  probeGoogleAccountPreflight,
  probeAllGoogleAccountsPreflight,
  startPreflightHealthCheckInterval,
  stopPreflightHealthCheckInterval,
  getUnlicensedAccountKeys,
  restoreUnlicensedAccountKeys,
  markAccountQuotaExhausted,
  isAccountInProbation,
  endAccountProbation,
  isAccountInCooldown,
  setAccountCooldown,
  getAccountCooldownRemaining,
  getSoonestAccountCooldownRemaining,
  clearAccountCooldown,
  clearAccountCooldownByKey,
  getActiveAccountCooldowns,
  restoreActiveAccountCooldowns,
  verifyAndReconcileCooldowns,
  autoHealAccountOnQuotaRecovery,
  getAccountInFlight,
  MAX_CONCURRENT_PER_ACCOUNT,
  notifySlotAvailable,
  waitForAccountSlot,
  incrementAccountInFlight,
  decrementAccountInFlight,
  recordAccountRequest,
  getAccountLastUsed,
  getAccountRpmCount,
  getModelQuotaScore,
  EWMA_DECAY_THRESHOLD_MS,
  recordAccountLatency,
  getAccountAvgLatency,
  isPoolUnderQuotaStress,
  resolveGoogleProjectId,
  getAccountVirtualDeviceHeaders,
  getAccountDynamicScore,
  classifyGoogleCloudCode429,
  selectCandidateP2C,
  selectBestModelByQuota,
  getGoogleAccountPool,
  isAccountEligibleForPool,
  persistAccountChallengeToDisk,
  persistAccountQuotaExhaustedToDisk,
  clearAccountQuotaExhaustedFromDisk,
  recordAccountBurst,
  clearAccountBurst,
  _resetAccountBurst,
  isAccountNearExhaustion,
  PREVENTIVE_QUOTA_THRESHOLD_PCT,
  PREVENTIVE_COOLDOWN_MS,
} from './proxy/googlePool';
import { safeWriteHead, safeEnd, parseRetryAfter, isAllowedOrigin } from './proxy/httpUtils';
export { parseRetryAfter, isAllowedOrigin };

import {
  ResponseClaimer,
  createResponseClaimer,
  trimOldestHistory,
  resolveFileData,
  downloadFileContent,
} from './proxy/historyTrimmer';

export {
  ResponseClaimer,
  createResponseClaimer,
  trimOldestHistory,
};
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

import {
  isRemoteVpsActive,
  remoteVpsHost,
  remoteVpsToken,
  remoteSessionsMap,
  TokenUsageEvent,
  loadRemoteState,
  saveRemoteState,
  executeOnRemoteDaemon,
  getRemoteStatePath,
  getTokenEventsLogPath,
  logTokenUsageEvent,
  ensureRemoteExecScriptOnDisk,
  updateRemoteVpsConfig,
  remoteVpsState,
} from './proxy/remoteState';

export {
  isRemoteVpsActive,
  remoteVpsHost,
  remoteVpsToken,
  remoteSessionsMap,
  TokenUsageEvent,
  loadRemoteState,
  saveRemoteState,
  executeOnRemoteDaemon,
  getRemoteStatePath,
  getTokenEventsLogPath,
  logTokenUsageEvent,
  ensureRemoteExecScriptOnDisk,
  updateRemoteVpsConfig,
  remoteVpsState,
};

import {
  enrichExperimentsPayload,
  unlockCodeAssistPayload,
  isTelemetryRpcUrl,
  loadCachedExperiments,
  saveCachedExperiments,
  loadCachedCodeAssist,
  saveCachedCodeAssist,
  loadCachedAvailableModels,
  saveCachedAvailableModels,
  handleGetAvailableModelsProxy,
  handleGetUserStatusProxy,
  memoryListExperimentsTime,
  memoryFetchAvailableModelsTime,
  memoryLoadCodeAssistTime,
} from './proxy/endpointHandlers';

export {
  enrichExperimentsPayload,
  unlockCodeAssistPayload,
  isTelemetryRpcUrl,
  loadCachedExperiments,
  saveCachedExperiments,
  loadCachedCodeAssist,
  saveCachedCodeAssist,
  loadCachedAvailableModels,
  saveCachedAvailableModels,
  handleGetAvailableModelsProxy,
  handleGetUserStatusProxy,
  memoryListExperimentsTime,
  memoryFetchAvailableModelsTime,
  memoryLoadCodeAssistTime,
};

// Initialize on boot
loadRemoteState();

import {
  generateGracefulMarkdown,
  ProxyErrorPayload,
  ProxyErrorEmitter,
  setProxyErrorEmitter,
  emitProxyError,
  buildProxyErrorPayload,
  sendGracefulStreamError,
  sendGracefulNonStreamError,
  sendGracefulError,
  parseBalancedJson,
  extractAllPseudoToolCalls,
  sanitizeCandidatesInResponse,
  writeSafeSseChunk,
  injectAntiHallucinationInstruction,
  autoUnstickConversation,
  transformGoogleStreamForRemote,
} from './proxy/streamPipeline';

export {
  generateGracefulMarkdown,
  ProxyErrorPayload,
  ProxyErrorEmitter,
  setProxyErrorEmitter,
  buildProxyErrorPayload,
  sendGracefulStreamError,
  sendGracefulNonStreamError,
  sendGracefulError,
  parseBalancedJson,
  extractAllPseudoToolCalls,
  sanitizeCandidatesInResponse,
  writeSafeSseChunk,
  injectAntiHallucinationInstruction,
  autoUnstickConversation,
  transformGoogleStreamForRemote,
};

// ─── Thought Signature Cache Helpers ──────────────────────────────────────

export async function proxyToGoogle(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  reqBody: Buffer,
  isRemoteSession = false,
  customAuthHeader?: string,
  convId = '',
  hostOverride?: string,
  sessId = '',
  originalModel = '',
): Promise<void> {
  const traceId = newTraceId();
  const isCloudCodeUrl = req.url!.includes('v1internal') || req.url!.includes('daily-cloudcode') || req.url!.includes('cloudcode');
  const targetHost = hostOverride || (isCloudCodeUrl ? GOOGLE_HOSTS.CLOUD_CODE : GOOGLE_HOSTS.GENERATIVE_LANGUAGE);
  const targetUrl = `https://${targetHost}`;
  const parsedUrl = new URL(req.url!, targetUrl);
  const endTimer = metricTimer('proxy_request_ms', { upstream: targetHost });
  log.debug('[Proxy] req', traceId, req.method, req.url, '→', targetHost);

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
    agent: getHttpsAgent({ host: targetHost }),
  };

  // Guard flag to prevent ERR_HTTP_HEADERS_SENT when timeout and response race
  const safeHead = (status: number, headers?: Record<string, string>): boolean =>
    safeWriteHead(res, status, headers);

  const proxyReq = https.request(parsedUrl, options, (proxyRes) => {
    proxyReq.setTimeout(0);
    if (!hostOverride && isCloudCodeUrl && !isGeneration && (proxyRes.statusCode === 503 || proxyRes.statusCode === 502)) {
      log.warn(`[Proxy] Google Cloud Code returned ${proxyRes.statusCode} on ${targetHost}. Trying production endpoint ${GOOGLE_HOSTS.CLOUD_CODE_PROD} for non-generation request...`);
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

        log.debug(
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
          text = unlockCodeAssistPayload(text);
          saveCachedCodeAssist(text);
        }

        if (safeWriteHead(res, proxyRes.statusCode || 200, modifiedHeaders as Record<string, string>)) {
          safeEnd(res, modifiedBuffer);
        }
      });
    } else if (isGeneration) {
      const reqModelName = extractModelNameFromPayload(reqBody);
      const effectiveModel = reqModelName || originalModel || '';
      const reqStart = Date.now();
      const isStream = req.url!.includes('streamGenerateContent') || req.url!.includes('alt=sse');
      if (proxyRes.statusCode && proxyRes.statusCode >= 400) {
        log.warn(
          `[Proxy] Google returned upstream error status ${proxyRes.statusCode} for model [${effectiveModel || 'unknown'}] (${req.url}). Forwarding official error directly to client.`
        );
        let isAuxiliaryReq = false;
        try {
          const parsed = typeof reqBody === 'string' ? JSON.parse(reqBody) : (Buffer.isBuffer(reqBody) ? JSON.parse(reqBody.toString('utf-8')) : reqBody);
          const rType = String(parsed?.requestType || parsed?.request?.requestType || '').toUpperCase();
          isAuxiliaryReq = rType === 'CONVERSATION_TITLE' || rType === 'TITLE' || rType === 'SUMMARY' || rType === 'CONVERSATION_SUMMARY' || rType === 'SEARCH' || rType === 'INDEX';
        } catch {}

        if (!isAuxiliaryReq) {
          // Synchronously record immediately so any racing fallback from the Language Server is blocked!
          if (convId) {
            recordNativeSessionError(convId, proxyRes.statusCode!, proxyRes.headers as Record<string, string>, Buffer.alloc(0), effectiveModel);
          }
          if (sessId && sessId !== convId) {
            recordNativeSessionError(sessId, proxyRes.statusCode!, proxyRes.headers as Record<string, string>, Buffer.alloc(0), effectiveModel);
          }
          if (!convId && !sessId) {
            recordLatestNativeError(proxyRes.statusCode!, proxyRes.headers as Record<string, string>, Buffer.alloc(0), effectiveModel);
          }
        }

        const errChunks: Buffer[] = [];
        proxyRes.on('data', (chunk) => errChunks.push(chunk));
        proxyRes.on('end', () => {
          const fullErr = Buffer.concat(errChunks);
          let errDetail = '';
          try {
            const parsed = JSON.parse(fullErr.toString('utf-8'));
            errDetail = parsed?.error?.message || parsed?.message || (typeof parsed?.error === 'string' ? parsed.error : '');
          } catch {}
          if (errDetail) {
            log.warn(`[Proxy] Upstream Google error details for [${effectiveModel || 'unknown'}]: ${errDetail}`);
          }
          if (!isAuxiliaryReq) {
            if (convId) {
              recordNativeSessionError(convId, proxyRes.statusCode!, proxyRes.headers as Record<string, string>, fullErr, effectiveModel);
            }
            if (sessId && sessId !== convId) {
              recordNativeSessionError(sessId, proxyRes.statusCode!, proxyRes.headers as Record<string, string>, fullErr, effectiveModel);
            }
            if (!convId && !sessId) {
              updateLatestNativeErrorBody(fullErr);
            }
          }
        });
        if (safeHead(proxyRes.statusCode, proxyRes.headers as Record<string, string>)) {
          proxyRes.pipe(res);
        }
        return;
      }
      if (isStream) {
        transformGoogleStreamForRemote(proxyRes, res, convId, isRemoteSession, reqModelName, reqStart);
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
            const usage = data?.response?.usageMetadata || data?.usageMetadata;
            if (usage) {
              const pTokens = usage.promptTokenCount || 0;
              const cTokens = usage.candidatesTokenCount || 0;
              const tTokens = usage.totalTokenCount || (pTokens + cTokens);
              if (tTokens > 0 || pTokens > 0) {
                logTokenUsageEvent({
                  id: `req-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
                  timestamp: Date.now(),
                  conversationId: convId || undefined,
                  provider: 'google',
                  model: reqModelName || data?.response?.modelVersion || data?.modelVersion || 'gemini-3.8-flash',
                  promptTokens: pTokens,
                  completionTokens: cTokens,
                  totalTokens: tTokens,
                  cachedTokens: usage.cachedContentTokenCount || 0,
                  latencyMs: Math.max(1, Date.now() - reqStart),
                  status: proxyRes.statusCode || 200,
                  endpoint: '/v1internal:generateContent',
                });
              }
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
    if (!hostOverride && isCloudCodeUrl && !isGeneration && !res.headersSent && !res.writableEnded) {
      log.warn(`[Proxy] Google Cloud Code network error on ${targetHost} (${err.message}). Trying production endpoint ${GOOGLE_HOSTS.CLOUD_CODE_PROD} for non-generation request...`);
      proxyToGoogle(req, res, reqBody, isRemoteSession, customAuthHeader, convId, GOOGLE_HOSTS.CLOUD_CODE_PROD, sessId, originalModel);
      return;
    }
    metricInc('proxy_errors_total', { upstream: targetHost, stage: 'forward', trace_id: traceId });
    const ms = endTimer();
    proxyLog.error('Google forwarding error traceId=', traceId, 'after', ms, 'ms:', err.message);
    log.error('[Proxy] Google Forwarding Error:', err);
    const effectiveModel = originalModel || '';
    if (convId) {
      recordNativeSessionError(convId, 502, {}, Buffer.from(err.message), effectiveModel);
    }
    if (sessId && sessId !== convId) {
      recordNativeSessionError(sessId, 502, {}, Buffer.from(err.message), effectiveModel);
    }
    recordLatestNativeError(502, {}, Buffer.from(err.message), effectiveModel);
    if (safeWriteHead(res, 500, { 'Content-Type': 'application/json' })) {
      safeEnd(res, JSON.stringify({ error: { message: 'Proxy forwarding failed: ' + err.message, traceId } }));
    }
  });

  proxyReq.on('close', () => {
    const ms = endTimer();
    metricObserve('proxy_upstream_ms', ms, { upstream: targetHost, trace_id: traceId });
    log.debug('[Proxy] Upstream request closed traceId=', traceId, 'after', ms, 'ms');
  });

  const isFlashDirect = /flash/i.test(originalModel || '');
  const isDirectLargeOrThinking = (reqBody && reqBody.length > 120_000) ||
    /thinking|thought|-high$|-medium$/i.test(originalModel || '') ||
    (reqBody && reqBody.includes(Buffer.from('/think-')));
  const forwardTimeoutMs = isFlashDirect
    ? (isDirectLargeOrThinking ? Math.min(65_000, GOOGLE_PROXY_TIMEOUT_MS) : Math.min(35_000, GOOGLE_PROXY_TIMEOUT_MS))
    : GOOGLE_PROXY_TIMEOUT_MS;
  proxyReq.setTimeout(forwardTimeoutMs, () => {
    log.error(`[Proxy] Google proxy request timed out after ${forwardTimeoutMs / 1000}s (${req.method} ${req.url})`);
    proxyReq.destroy();
    const effectiveModel = originalModel || '';
    if (convId) {
      recordNativeSessionError(convId, 504, {}, Buffer.from('Google API request timed out'), effectiveModel);
    }
    if (sessId && sessId !== convId) {
      recordNativeSessionError(sessId, 504, {}, Buffer.from('Google API request timed out'), effectiveModel);
    }
    recordLatestNativeError(504, {}, Buffer.from('Google API request timed out'), effectiveModel);
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
  isTransportError?: boolean;
}

export function executeGoogleCloudCodeRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  reqBody: Buffer,
  isRemoteSession = false,
  customAuthHeader?: string,
  convId = '',
  hostOverride?: string,
  timeoutMs?: number,
  modelName = '',
  startTime = Date.now(),
  responseClaimer?: ResponseClaimer,
  candidate?: CustomModel,
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

    const onClientClose = () => {
      // Only treat as genuine client abort if the downstream client response socket is genuinely ended/destroyed.
      const clientTrulyClosed = res?.writableEnded || res?.destroyed || Boolean(res?.socket && res.socket.destroyed);
      if (!settled && clientTrulyClosed) {
        try { proxyReq?.destroy(); } catch (_) {}
        finish({ success: false, statusCode: 499, error: 'Client closed request before completion' });
      }
    };
    // Do NOT attach onClientClose to req.once('close')! In Node.js HTTP servers, req emits 'close'
    // when incoming POST body is consumed, which would falsely report client aborts.
    if (typeof res?.once === 'function') res.once('close', onClientClose);

    const finish = (outcome: GoogleRequestOutcome) => {
      if (settled) return;
      settled = true;
      try {
        if (typeof res?.off === 'function') res.off('close', onClientClose);
      } catch (_) {}
      if (proxyReq) {
        try { proxyReq.setTimeout(0); } catch (_) {}
        if (!outcome.success) {
          try { proxyReq.destroy(); } catch (_) {}
        }
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
      delete headers['Authorization'];
      delete headers['authorization'];
      if (customAuthHeader) {
        headers['authorization'] = customAuthHeader;
      }
      if (isCloudCodeUrl) {
        delete headers['User-Agent'];
        delete headers['user-agent'];
        headers['user-agent'] = 'antigravity';
        if (candidate) {
          const virtualDevHeaders = getAccountVirtualDeviceHeaders(candidate);
          Object.assign(headers, virtualDevHeaders);
        }
      }
      log.info(`[CloudCode Dispatch Detail] host=${targetHost} ip=${realIp} url=${req.url} customAuth=${Boolean(customAuthHeader)} headers=${Object.keys(headers).join(',')}`);

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
        agent: getHttpsAgent({ host: targetHost }),
      };

      proxyReq = https.request(parsedUrl, options, (proxyRes) => {
        if (responseClaimer) {
          responseClaimer.registerAbort(traceId, () => {
            try { proxyReq?.destroy(); } catch (_) {}
          });
        }
        // Disable request socket timeout once response headers start streaming in
        proxyReq?.setTimeout(0);

        const status = proxyRes.statusCode || 200;

        // If upstream error (429, 400, 401, 403, 404, 500, 502, 503, 504):
        // Intercept BEFORE writing anything to client res!
        if (status >= 400) {
          proxyReq?.setTimeout(15_000, () => {
            try { proxyReq?.destroy(); } catch (_) {}
            finish({ success: false, statusCode: status, error: 'Timed out waiting for error body', isTransportError: true });
          });
          const errChunks: Buffer[] = [];
          proxyRes.on('data', (c: Buffer) => errChunks.push(c));
          proxyRes.on('error', (err) => {
            finish({ success: false, statusCode: status, error: 'Proxy response stream error: ' + (err?.message || 'unknown'), isTransportError: true });
          });
          proxyRes.on('close', () => {
            if (!settled) {
              const errText = Buffer.concat(errChunks).toString('utf-8');
              finish({ success: false, statusCode: status, error: errText || 'Upstream error response closed prematurely', isTransportError: true });
            }
          });
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
          proxyRes.on('error', (err) => {
            if (safeWriteHead(res, 502, { 'Content-Type': 'application/json' })) {
              safeEnd(res, JSON.stringify({ error: { message: `Upstream response stream error: ${err.message}` } }));
            }
            finish({ success: false, statusCode: 502, error: err.message, isTransportError: true });
          });
          proxyRes.on('close', () => {
            if (!settled) {
              finish({ success: false, statusCode: 502, error: 'Upstream connection closed prematurely', isTransportError: true });
            }
          });
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
            transformGoogleStreamForRemote(proxyRes, res, convId, isRemoteSession, modelName, startTime);
            finish({ success: true, statusCode: status });
          } else {
            const responseChunks: Buffer[] = [];
            proxyRes.on('data', (chunk: Buffer) => responseChunks.push(chunk));
            proxyRes.on('error', (err) => {
              finish({ success: false, statusCode: 502, error: 'Upstream generation stream error: ' + err.message, isTransportError: true });
            });
            proxyRes.on('close', () => {
              if (!settled) {
                finish({ success: false, statusCode: 502, error: 'Upstream generation connection closed prematurely', isTransportError: true });
              }
            });
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
                const usage = data?.response?.usageMetadata || data?.usageMetadata;
                if (usage) {
                  const pTokens = usage.promptTokenCount || 0;
                  const cTokens = usage.candidatesTokenCount || 0;
                  const tTokens = usage.totalTokenCount || (pTokens + cTokens);
                  if (tTokens > 0 || pTokens > 0) {
                    logTokenUsageEvent({
                      id: `req-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
                      timestamp: Date.now(),
                      conversationId: convId || undefined,
                      provider: 'google',
                      model: modelName || data?.response?.modelVersion || data?.modelVersion || 'gemini-3.8-flash',
                      promptTokens: pTokens,
                      completionTokens: cTokens,
                      totalTokens: tTokens,
                      cachedTokens: usage.cachedContentTokenCount || 0,
                      latencyMs: Math.max(1, Date.now() - startTime),
                      status,
                      endpoint: '/v1internal:generateContent',
                    });
                  }
                }
              } catch (_) {}
              const modifiedHeaders = { ...proxyRes.headers };
              delete modifiedHeaders['content-encoding'];
              delete modifiedHeaders['transfer-encoding'];
              const modifiedBuffer = Buffer.from(text, 'utf-8');
              modifiedHeaders['content-length'] = String(modifiedBuffer.length);
              if (responseClaimer) {
                if (!responseClaimer.claim(traceId)) {
                  try { proxyReq?.destroy(); } catch (_) {}
                  finish({ success: false, statusCode: 499, error: 'Cancelled by winning hedged request' });
                  return;
                }
                responseClaimer.abortOthers(traceId);
              }
              if (safeWriteHead(res, status, modifiedHeaders as Record<string, string>)) {
                safeEnd(res, modifiedBuffer);
              }
              finish({ success: true, statusCode: status });
            });
          }
        } else {
          proxyRes.on('error', (err) => {
            finish({ success: false, statusCode: 502, error: 'Upstream stream error: ' + err.message, isTransportError: true });
          });
          if (responseClaimer) {
            if (!responseClaimer.claim(traceId)) {
              try { proxyReq?.destroy(); } catch (_) {}
              finish({ success: false, statusCode: 499, error: 'Cancelled by winning hedged request' });
              return;
            }
            responseClaimer.abortOthers(traceId);
          }
          if (safeWriteHead(res, status, proxyRes.headers as Record<string, string>)) {
            proxyRes.pipe(res);
          }
          finish({ success: true, statusCode: status });
        }
      });

      let isTimedOut = false;

      proxyReq.on('error', (err) => {
        if (settled || isTimedOut) return;
        try { proxyReq?.destroy(); } catch (_) {}
        metricInc('proxy_errors_total', { upstream: targetHost, stage: 'forward', trace_id: traceId });
        const ms = endTimer();
        proxyLog.error('Google forwarding error traceId=', traceId, 'after', ms, 'ms:', err.message);
        const errMsg = err.message || '';
        const isTransport =
          isRetryableNetworkError(err) ||
          /ENETUNREACH|EHOSTUNREACH|ENETDOWN|ECONNREFUSED|ECONNABORTED|ECONNRESET|socket hang up/i.test(errMsg);
        if (isTransport) {
          try {
            evictAgent({ host: targetHost });
            invalidateCachedDns(targetHost);
          } catch (_) {}
        }
        finish({
          success: false,
          statusCode: 502,
          error: 'Proxy forwarding failed: ' + errMsg,
          isTransportError: isTransport,
        });
      });

      proxyReq.on('close', () => {
        const ms = endTimer();
        metricObserve('proxy_upstream_ms', ms, { upstream: targetHost, trace_id: traceId });
      });

      // ponytail: respect explicit caller timeout (pool header timeout, large payload, or thinking config)
      // up to GOOGLE_PROXY_TIMEOUT_MS. Only clamp to 35s when timeoutMs was omitted for standard flash requests.
      let effectiveTimeout: number;
      if (typeof timeoutMs === 'number' && timeoutMs > 0) {
        effectiveTimeout = Math.min(timeoutMs, GOOGLE_PROXY_TIMEOUT_MS);
      } else {
        effectiveTimeout = /flash/i.test(modelName) ? 35_000 : GOOGLE_PROXY_TIMEOUT_MS;
      }
      if (typeof proxyReq?.setTimeout === 'function') {
        proxyReq.setTimeout(effectiveTimeout, () => {
          isTimedOut = true;
          log.error(`[Proxy] Google pool request timed out waiting for response headers on ${targetHost} after ${effectiveTimeout / 1000}s`);
          proxyReq?.destroy();
          finish({ success: false, statusCode: 504, error: 'Google API request timed out' });
        });
      }

      proxyReq.on('socket', (socket) => {
        try {
          if (typeof socket.setNoDelay === 'function') socket.setNoDelay(true);
        } catch (_) {}
      });

      if (reqBody) {
        proxyReq.write(reqBody);
      }
      proxyReq.end();
    }).catch((dnsErr) => {
      metricInc('proxy_errors_total', { upstream: targetHost, stage: 'dns', trace_id: traceId });
      const ms = endTimer();
      proxyLog.error('DNS resolution failed for', targetHost, 'traceId=', traceId, '(in', ms, 'ms)');
      try {
        invalidateCachedDns(targetHost);
      } catch (_) {}
      finish({ success: false, statusCode: 500, error: 'DNS resolution failed: ' + (dnsErr as Error).message, isTransportError: true });
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
  attemptedModels: Set<string> = new Set(),
  fallbackDepth = 0,
): Promise<boolean> {
  // Normalize payload: If caller provided a flat Gemini request (contents at root), wrap it inside reqJson.request
  if (!reqJson.request && Array.isArray((reqJson as any).contents)) {
    const { contents, generationConfig, tools, safetySettings, systemInstruction } = reqJson as any;
    reqJson.request = {
      contents,
      ...(generationConfig ? { generationConfig } : {}),
      ...(tools ? { tools } : {}),
      ...(safetySettings ? { safetySettings } : {}),
      ...(systemInstruction ? { systemInstruction } : {}),
    };
    delete (reqJson as any).contents;
    delete (reqJson as any).generationConfig;
    delete (reqJson as any).tools;
    delete (reqJson as any).safetySettings;
    delete (reqJson as any).systemInstruction;
  }

  // Optimize prompt payload by removing redundant duplicate file injections
  reqJson = trimContextPayload(reqJson as unknown as GeminiRequestBody) as unknown as Record<string, unknown>;

  // Proactive History Trimming: If session has accumulated heavy history (>50 turns),
  // proactively trim historical turns before the first network dispatch to prevent 35s-60s TTFT timeouts.
  const initialContents = (reqJson.request as any)?.contents || (reqJson as any).contents;
  if (Array.isArray(initialContents) && initialContents.length > 35) {
    const turnsCount = initialContents.length;
    // Cap history to 40 turns (+ initial prompt = 41 turns) to keep TTFT well under 10s on Google Cloud Code
    if (trimOldestHistory(reqJson, 30)) {
      const remainingTurns = ((reqJson.request || reqJson) as any)?.contents?.length;
      log.info(`[Proxy] ⚡ [Proactive Context Trimmer] Heavy session detected (${turnsCount} turns). Proactively trimmed oldest history to ${remainingTurns} turns before first network dispatch.`);
    }
  }

  let targetRaw = String(reqJson.model || (reqJson.request as any)?.model || '');
  if (/MODEL_PLACEHOLDER_/i.test(targetRaw) || !targetRaw) {
    const poolCandidate = accountPool?.[0]?.externalModelName || accountPool?.[0]?.name;
    if (poolCandidate) {
      targetRaw = poolCandidate;
      reqJson.model = targetRaw;
      if (reqJson.request && typeof reqJson.request === 'object') {
        (reqJson.request as Record<string, unknown>).model = targetRaw;
      }
    }
  }
  const resolvedTarget = normalizeCloudCodeModelId(targetRaw).toLowerCase();
  if (resolvedTarget) {
    reqJson.model = resolvedTarget;
    if (reqJson.request && typeof reqJson.request === 'object') {
      (reqJson.request as Record<string, unknown>).model = resolvedTarget;
    }
    attemptedModels.add(resolvedTarget);
  }

  if (resolvedTarget.includes('argon')) {
    log.warn(`[Proxy] ⛔ Argon model [${resolvedTarget}] cannot be served by multi-account pool (not available on Google Cloud Code PA accounts). Refusing futile pool rotation.`);
    return false;
  }

  const isClaude = resolvedTarget.includes('claude');
  const modelFamily = isClaude ? 'claude' : 'gemini';


  // Eco-Routing / Graceful Degradation: If pool is under severe quota stress (<15% average),
  // downgrade background / auxiliary tasks (summaries, titles) to Flash to preserve Pro quota.
  // Guard: only redirect if at least one account is still available — redirecting into a fully
  // exhausted pool just wastes a retry slot on the same drained accounts.
  if (process.env.AG_ENABLE_CROSS_MODEL_FALLBACK === '1' && isPoolUnderQuotaStress(accountPool, modelFamily)) {
    const hasAnyAvailable = accountPool.some(
      (a) => !isAccountInCooldown(a, modelFamily) && !getOpenBreaker(a) && !isTokenRevoked(a.refreshToken),
    );
    const reqType = String(reqJson.requestType || (reqJson.request as any)?.requestType || '').toUpperCase();
    const isAuxiliary = reqType === 'CONVERSATION_TITLE' || reqType === 'TITLE' || reqType === 'SUMMARY' || reqType === 'CONVERSATION_SUMMARY';
    const isAlreadyFlash = resolvedTarget.includes('flash') || resolvedTarget.includes('lite');
    if (isAuxiliary && !isAlreadyFlash && hasAnyAvailable) {
      log.info('[Proxy] [Eco-Routing] Pool under quota stress (<15% avg): routing auxiliary request to gemini-3.8-flash-tiered.');
      reqJson.model = 'gemini-3.8-flash-tiered';
      if (reqJson.request && typeof reqJson.request === 'object') {
        (reqJson.request as Record<string, unknown>).model = 'gemini-3.8-flash-tiered';
      }
    } else if (isAuxiliary && !hasAnyAvailable) {
      log.debug('[Proxy] [Eco-Routing] Pool fully exhausted — skipping flash redirect, fast-fail will handle it.');
    }
  }

  // Dedicated 5.5 Routing: When requesting Claude 5.5 (Opus 5.5 / Sonnet 5.5),
  // strictly filter candidate pool to accounts entitled to 5.5 (e.g. family group or direct Pro)
  // to avoid instant 429 quota exhaustion from standard Jio trial parent accounts.
  const isClaude55 =
    targetRaw.includes('5-5') ||
    targetRaw.includes('5.5') ||
    resolvedTarget.includes('5-5') ||
    (typeof reqJson.requestedModel === 'string' && (reqJson.requestedModel.includes('5.5') || reqJson.requestedModel.includes('5-5'))) ||
    (typeof reqJson.model === 'string' && (reqJson.model.includes('5.5') || reqJson.model.includes('5-5')));
  const activePool = accountPool.filter((a) => {
    const qKey = getAccountQuotaKey(a);
    const liveQ = (getLiveAccountQuota(qKey) || a.quotas) as Record<string, any> | undefined;
    return (
      (a as any).enabled !== false &&
      (a as any).status !== 'unhealthy' &&
      !(a as any).isValidationRequired &&
      (a as any).status !== 'validation_required' &&
      !(a as any).isUnlicensed &&
      !liveQ?.isUnlicensed &&
      !isAccountUnlicensed(a)
    );
  });
  let eligibleAccounts = activePool.length > 0 ? activePool : accountPool.filter((a) => (a as any).enabled !== false && !isAccountUnlicensed(a));
  if (isClaude55) {
    const candidates55 = eligibleAccounts.filter((a) => isAccountEntitledToClaude55(a));
    const otherCandidates = eligibleAccounts.filter((a) => !isAccountEntitledToClaude55(a));
    const healthy55 = candidates55.filter((a) => !isAccountInCooldown(a, modelFamily) && getModelQuotaScore(a, modelFamily) > 0);
    if (healthy55.length > 0) {
      log.info(
        `[Proxy] [5.5 Routing] Prioritizing ${healthy55.length}/${candidates55.length} healthy 5.5-entitled account(s) (PARTAGE), retaining ${otherCandidates.length} account(s) as pool fallback.`,
      );
      eligibleAccounts = [...candidates55, ...otherCandidates];
    } else if (candidates55.length > 0) {
      log.warn(
        `[Proxy] [5.5 Routing] 5.5-entitled account(s) have 0% quota or are in cooldown; falling back to remaining pool (${otherCandidates.length} account(s)).`,
      );
      eligibleAccounts = [...otherCandidates, ...candidates55];
    } else {
      log.warn(`[Proxy] [5.5 Routing] No accounts auto-detected with 5.5 entitlement; falling back to full pool.`);
      eligibleAccounts = accountPool;
    }
  }

  const sortedAccounts = [...eligibleAccounts].sort((a, b) => {
    const cdA = isAccountInCooldown(a, modelFamily) ? 1 : 0;
    const cdB = isAccountInCooldown(b, modelFamily) ? 1 : 0;
    if (cdA !== cdB) return cdA - cdB;
    const breakerA = getOpenBreaker(a) ? 1 : 0;
    const breakerB = getOpenBreaker(b) ? 1 : 0;
    if (breakerA !== breakerB) return breakerA - breakerB;
    const hasQuotaA = getModelQuotaScore(a, modelFamily) > 0 ? 1 : 0;
    const hasQuotaB = getModelQuotaScore(b, modelFamily) > 0 ? 1 : 0;
    if (hasQuotaA !== hasQuotaB) return hasQuotaB - hasQuotaA;
    const exhA = isAccountNearExhaustion(a, modelFamily) ? 1 : 0;
    const exhB = isAccountNearExhaustion(b, modelFamily) ? 1 : 0;
    if (exhA !== exhB) return exhA - exhB;
    const maxA = isAccountInProbation(a, modelFamily) ? 1 : MAX_CONCURRENT_PER_ACCOUNT;
    const maxB = isAccountInProbation(b, modelFamily) ? 1 : MAX_CONCURRENT_PER_ACCOUNT;
    const satA = getAccountInFlight(a) >= maxA ? 1 : 0;
    const satB = getAccountInFlight(b) >= maxB ? 1 : 0;
    if (satA !== satB) return satA - satB;
    if (isClaude55) {
      const entA = isAccountEntitledToClaude55(a) ? 1 : 0;
      const entB = isAccountEntitledToClaude55(b) ? 1 : 0;
      if (entA !== entB) {
        const scoreA = getModelQuotaScore(a, modelFamily);
        const scoreB = getModelQuotaScore(b, modelFamily);
        if (entA > entB && scoreA > 0) return -1;
        if (entB > entA && scoreB > 0) return 1;
      }
    }
    return getAccountDynamicScore(b, modelFamily) - getAccountDynamicScore(a, modelFamily);
  });

  let boundAccount: CustomModel | undefined;
  const useStickySessions = process.env.AG_STICKY_GOOGLE_ACCOUNTS !== '0';
  if (sessId && useStickySessions) {
    const affinity = sessionAffinities.get(sessId);
    if (affinity) {
      boundAccount = sortedAccounts.find((m) => {
        return (
          getAccountQuotaKey(m) === affinity.accountKey &&
          (m as any).enabled !== false &&
          !isAccountUnlicensed(m) &&
          !getOpenBreaker(m) &&
          !isAccountInCooldown(m, modelFamily) &&
          !isAccountNearExhaustion(m, modelFamily) &&
          getModelQuotaScore(m, modelFamily) > 0
        );
      });
      if (boundAccount) {
        const idx = sortedAccounts.indexOf(boundAccount);
        if (idx > 0) {
          sortedAccounts.splice(idx, 1);
          sortedAccounts.unshift(boundAccount);
        }
      } else {
        const boundCandidate = sortedAccounts.find((m) => getAccountQuotaKey(m) === affinity.accountKey);
        if (boundCandidate && ((boundCandidate as any).enabled === false || isAccountUnlicensed(boundCandidate) || isTokenRevoked(boundCandidate.refreshToken))) {
          sessionAffinities.delete(sessId);
        }
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
    log.debug(`[Proxy] All eligible accounts in Google pool are saturated (${MAX_CONCURRENT_PER_ACCOUNT} in-flight reqs). Waiting up to 1500ms for an available slot...`);
    await waitForAccountSlot(sortedAccounts, modelFamily, 1500);
    // Re-sort after waiting so the newly freed account rises to the top
    sortedAccounts.sort((a, b) => {
      const cdA = isAccountInCooldown(a, modelFamily) ? 1 : 0;
      const cdB = isAccountInCooldown(b, modelFamily) ? 1 : 0;
      if (cdA !== cdB) return cdA - cdB;
      const breakerA = getOpenBreaker(a) ? 1 : 0;
      const breakerB = getOpenBreaker(b) ? 1 : 0;
      if (breakerA !== breakerB) return breakerA - breakerB;
      const hasQuotaA = getModelQuotaScore(a, modelFamily) > 0 ? 1 : 0;
      const hasQuotaB = getModelQuotaScore(b, modelFamily) > 0 ? 1 : 0;
      if (hasQuotaA !== hasQuotaB) return hasQuotaB - hasQuotaA;
      const exhA = isAccountNearExhaustion(a, modelFamily) ? 1 : 0;
      const exhB = isAccountNearExhaustion(b, modelFamily) ? 1 : 0;
      if (exhA !== exhB) return exhA - exhB;
      const maxA = isAccountInProbation(a, modelFamily) ? 1 : MAX_CONCURRENT_PER_ACCOUNT;
      const maxB = isAccountInProbation(b, modelFamily) ? 1 : MAX_CONCURRENT_PER_ACCOUNT;
      const satA = getAccountInFlight(a) >= maxA ? 1 : 0;
      const satB = getAccountInFlight(b) >= maxB ? 1 : 0;
      if (satA !== satB) return satA - satB;
      return getAccountDynamicScore(b, modelFamily) - getAccountDynamicScore(a, modelFamily);
    });
  }

  let lastStatus = 500;
  let lastErrorText = 'All accounts in Google Cloud Code pool exhausted';
  const totalAttempts = sortedAccounts.length;
  let consecutive429Count = 0;
  let consecutiveQuotaExhausted = 0;
  let consecutiveTimeoutCount = 0;
  let consecutive504TimeoutCount = 0;
  let consecutiveTransportErrorCount = 0;
  let consecutive503CapacityCount = 0;
  let testedAccountsCount = 0;

  const initialHealthyCount = sortedAccounts.filter(
    (a) => !isAccountInCooldown(a, modelFamily) && !getOpenBreaker(a) && getModelQuotaScore(a, modelFamily) > 0,
  ).length;
  if (initialHealthyCount === 0 && sortedAccounts.length > 0) {
    lastStatus = 429;
    lastErrorText = `All ${sortedAccounts.length} accounts in Google Cloud Code pool are in cooldown or near-exhaustion (<= ${PREVENTIVE_QUOTA_THRESHOLD_PCT}% quota) for ${modelFamily}`;
    log.warn(
      `[Proxy] All ${sortedAccounts.length} accounts in Google Cloud Code pool are unavailable (cooldown or <= ${PREVENTIVE_QUOTA_THRESHOLD_PCT}% quota) for ${modelFamily}. Fast-failing pool to trigger immediate fallback and prevent 7-day lockout.`,
    );
  } else if (initialHealthyCount > 0 && initialHealthyCount < 3) {
    log.warn(
      `[Proxy] ⚠️ Low pool headroom for ${modelFamily}: only ${initialHealthyCount} healthy account(s) available. Cascade fallback is armed.`,
    );
  }

  const poolLoopStartTime = Date.now();
  const MAX_POOL_LOOP_DURATION_MS = 280_000; // 3m30s max: prevents Go Language Server 5m0s stream idle timeout

  let networkAttemptCount = 0;
  let busyEligibleAccountsCount = 0;
  const busyCandidateAccounts: CustomModel[] = [];
  let hasRetriedBusyPool = false;
  for (let i = 0; i < sortedAccounts.length && networkAttemptCount < totalAttempts; i++) {
    if (initialHealthyCount === 0) break;
    if (Date.now() - poolLoopStartTime >= MAX_POOL_LOOP_DURATION_MS) {
      log.warn(`[Proxy] Account pool loop safety budget reached (${Math.round((Date.now() - poolLoopStartTime) / 1000)}s). Halting account rotation to prevent Go Language Server 5m0s context deadline timeout.`);
      if (!lastStatus || lastStatus === 200) lastStatus = 504;
      if (!lastErrorText) lastErrorText = 'Account pool loop safety budget expired before upstream response';
      break;
    }
    const candidate = sortedAccounts[i];
    const candidateName =
      candidate.accountEmail ||
      candidate.accountName ||
      (candidate.refreshToken ? `token:..${candidate.refreshToken.slice(-6)}` : '') ||
      candidate.displayName ||
      candidate.name;

    // Fast-skip: if this candidate is disabled, unlicensed, or has a pending security challenge
    if ((candidate as any).enabled === false || isAccountUnlicensed(candidate) || (candidate as any).isValidationRequired === true || (candidate as any).status === 'validation_required') {
      log.info(`[Proxy] Fast-skipping candidate ${candidateName}: account is disabled, unlicensed, or requires security validation`);
      continue;
    }

    // Fast-skip: if this candidate is already in active cooldown for this model family
    if (isAccountInCooldown(candidate, modelFamily)) {
      const hasOtherEligibleInPool = sortedAccounts.some(
        (c, idx) =>
          idx !== i &&
          (c as any).enabled !== false &&
          !isAccountUnlicensed(c) &&
          !(c as any).isValidationRequired &&
          (c as any).status !== 'validation_required' &&
          !isAccountInCooldown(c, modelFamily) &&
          getModelQuotaScore(c, modelFamily) > 0,
      );
      if (!hasOtherEligibleInPool && busyEligibleAccountsCount === 0) {
        lastStatus = 429;
        lastErrorText = `All accounts in Google Cloud Code pool are in active cooldown for ${modelFamily}`;
        log.warn(`[Proxy] All accounts in pool are in cooldown for ${modelFamily}. Stopping pool search.`);
        break;
      }
      continue;
    }

    // Fast-skip: if this candidate has 0% quota remaining and reset has not passed
    const candidateQuotaScore = getModelQuotaScore(candidate, modelFamily);
    if (candidateQuotaScore <= 0) {
      log.info(`[Proxy] Fast-skipping candidate ${candidateName}: 0% quota remaining for ${modelFamily}`);
      const hasOtherEligibleInPool = sortedAccounts.some(
        (c, idx) =>
          idx !== i &&
          (c as any).enabled !== false &&
          !isAccountUnlicensed(c) &&
          !(c as any).isValidationRequired &&
          (c as any).status !== 'validation_required' &&
          !isAccountInCooldown(c, modelFamily) &&
          getModelQuotaScore(c, modelFamily) > 0,
      );
      if (!hasOtherEligibleInPool && busyEligibleAccountsCount === 0) {
        lastStatus = 429;
        lastErrorText = `All accounts in Google Cloud Code pool have exhausted quota for ${modelFamily}`;
        log.warn(`[Proxy] All accounts in pool have exhausted quota for ${modelFamily}. Stopping pool search.`);
        break;
      }
      continue;
    }

    // Fast-skip: if this candidate reached max concurrent in-flight slots (2, or 1 in probation)
    // and other healthy candidates have free slots available, divert to an idle account to prevent Google 504 overload.
    const baseMaxSlots = isAccountInProbation(candidate, modelFamily) ? 1 : MAX_CONCURRENT_PER_ACCOUNT;
    const candidateMaxSlots = (fallbackDepth > 0 && !isAccountInProbation(candidate, modelFamily))
      ? baseMaxSlots + 1
      : baseMaxSlots;
    if (getAccountInFlight(candidate) >= candidateMaxSlots) {
      // If this candidate is the session's sticky account holding the KV-cache, give it a brief chance
      // (up to 2500ms) to release an in-flight slot before diverting, preventing KV-cache cache misses and 18s+ TTFT.
      const isStickyBound = Boolean(boundAccount && candidate === boundAccount);
      if (isStickyBound) {
        log.debug(`[Proxy] Sticky session account [${candidateName}] is at capacity (${getAccountInFlight(candidate)}/${candidateMaxSlots}). Micro-waiting for slot to preserve KV-cache...`);
        await waitForAccountSlot([candidate], modelFamily, 2500);
      }

      if (getAccountInFlight(candidate) >= candidateMaxSlots) {
        const hasOtherFreeAccount = sortedAccounts.some(
          (c) =>
            c !== candidate &&
            (c as any).enabled !== false &&
            !isAccountUnlicensed(c) &&
            !(c as any).isValidationRequired &&
            (c as any).status !== 'validation_required' &&
            !isAccountInCooldown(c, modelFamily) &&
            !getOpenBreaker(c) &&
            getModelQuotaScore(c, modelFamily) > 0 &&
            getAccountInFlight(c) < (isAccountInProbation(c, modelFamily) ? 1 : MAX_CONCURRENT_PER_ACCOUNT),
        );
        if (hasOtherFreeAccount) {
          log.info(
            `[Proxy] Account [${candidateName}] reached max concurrent in-flight limit (${getAccountInFlight(candidate)}/${candidateMaxSlots}). Diverting to available idle account in pool.`,
          );
          if (!busyCandidateAccounts.includes(candidate)) {
            busyCandidateAccounts.push(candidate);
          }
          continue;
        }

        // If no other account currently has free slots, wait briefly for any slot in the pool to release
        log.debug(`[Proxy] Account [${candidateName}] at max capacity (${getAccountInFlight(candidate)}/${candidateMaxSlots}) with no idle accounts. Waiting for slot...`);
        await waitForAccountSlot(sortedAccounts, modelFamily, 2000);

        // Re-check after waiting: if this candidate is STILL at max capacity, check if another account freed up
        if (getAccountInFlight(candidate) >= candidateMaxSlots) {
          const freedAccount = sortedAccounts.some(
            (c) =>
              c !== candidate &&
              (c as any).enabled !== false &&
              !isAccountUnlicensed(c) &&
              !(c as any).isValidationRequired &&
              (c as any).status !== 'validation_required' &&
              !isAccountInCooldown(c, modelFamily) &&
              !getOpenBreaker(c) &&
              getModelQuotaScore(c, modelFamily) > 0 &&
              getAccountInFlight(c) < (isAccountInProbation(c, modelFamily) ? 1 : MAX_CONCURRENT_PER_ACCOUNT),
          );
          if (freedAccount) {
            log.info(`[Proxy] A slot freed up in pool after waiting. Diverting from [${candidateName}].`);
            if (!busyCandidateAccounts.includes(candidate)) {
              busyCandidateAccounts.push(candidate);
            }
            continue;
          }

          // Hard limit: do NOT send request if account is strictly at or over capacity
          busyEligibleAccountsCount++;
          if (!busyCandidateAccounts.includes(candidate)) {
            busyCandidateAccounts.push(candidate);
          }
          log.warn(
            `[Proxy] Account [${candidateName}] is at maximum in-flight capacity (${getAccountInFlight(candidate)}/${candidateMaxSlots}) with no pool slots available. Skipping candidate (concurrency saturated).`,
          );
          if (i === sortedAccounts.length - 1 && networkAttemptCount === 0 && !hasRetriedBusyPool && Date.now() - poolLoopStartTime < MAX_POOL_LOOP_DURATION_MS) {
            hasRetriedBusyPool = true;
            log.info(`[Proxy] All healthy candidate accounts in pool are at max in-flight capacity. Waiting up to 2500ms in microqueue for a slot to free up...`);
            const slotFreed = await waitForAccountSlot(busyCandidateAccounts, modelFamily, 2500);
            if (slotFreed) {
              log.info(`[Proxy] A slot freed up in pool during microqueue wait. Re-scanning candidate accounts.`);
              busyCandidateAccounts.length = 0;
              busyEligibleAccountsCount = 0;
              i = -1;
              continue;
            }
          }
          continue;
        }
      }
    }

    const targetModel = normalizeCloudCodeModelId(candidate.externalModelName || candidate.name);
    const currentFamily = targetModel.toLowerCase().includes('claude') ? 'claude' : (targetModel ? 'gemini' : modelFamily);
    const quotaScore = getModelQuotaScore(candidate, currentFamily);
    const formattedQuota = Number(quotaScore.toFixed(1));

    const qKey = getAccountQuotaKey(candidate);
    const liveQ = (getLiveAccountQuota(qKey) || candidate.quotas) as Record<string, any> | undefined;
    let quotaRemark = '';
    if (liveQ) {
      const isClaude = modelFamily
        ? modelFamily.toLowerCase().includes('claude')
        : (candidate.externalModelName || candidate.name || '').toLowerCase().includes('claude');
      const fiveH = typeof (isClaude ? liveQ.claudeFiveHourPct : liveQ.geminiFiveHourPct) === 'number'
        ? (isClaude ? liveQ.claudeFiveHourPct : liveQ.geminiFiveHourPct)
        : liveQ.fiveHourPercentage;
      const week = typeof (isClaude ? liveQ.claudeWeeklyPct : liveQ.geminiWeeklyPct) === 'number'
        ? (isClaude ? liveQ.claudeWeeklyPct : liveQ.geminiWeeklyPct)
        : liveQ.weeklyPercentage;
      if (typeof fiveH === 'number' || typeof week === 'number') {
        const parts: string[] = [];
        if (typeof fiveH === 'number') parts.push(`5h=${fiveH}%`);
        if (typeof week === 'number') parts.push(`week=${week}%`);
        quotaRemark = ` [Quota: ${parts.join(', ')}]`;
      }
    }
    if (!quotaRemark && quotaScore > 0) {
      quotaRemark = ` [Quota: ${formattedQuota}%]`;
    }
    const rotationTag = networkAttemptCount > 0 ? '🔄 [Account Rotation]' : '➡️ [Request]';
    log.info(`[Proxy] ${rotationTag} Model: [${targetModel}] | Account: [${candidateName}] (attempt ${networkAttemptCount + 1}/${totalAttempts})${quotaRemark}`);
    networkAttemptCount++;

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

    reqJson.model = targetModel;
    if (typeof reqJson.requestedModel === 'string' && /MODEL_PLACEHOLDER_/i.test(reqJson.requestedModel)) {
      reqJson.requestedModel = targetModel;
    }
    if (typeof reqJson.planModel === 'string' && /MODEL_PLACEHOLDER_/i.test(reqJson.planModel)) {
      reqJson.planModel = targetModel;
    }
    const reqObj = (reqJson.request && typeof reqJson.request === 'object')
      ? (reqJson.request as Record<string, unknown>)
      : (reqJson as Record<string, unknown>);
    if (reqJson.request && typeof reqJson.request === 'object') {
      reqObj.model = targetModel;
      if (typeof reqObj.requestedModel === 'string' && /MODEL_PLACEHOLDER_/i.test(reqObj.requestedModel)) {
        reqObj.requestedModel = targetModel;
      }
      if (typeof reqObj.planModel === 'string' && /MODEL_PLACEHOLDER_/i.test(reqObj.planModel)) {
        reqObj.planModel = targetModel;
      }
      sanitizeCloudCodeGenerationConfig(reqObj, targetModel);

      // Support Anti-Truncation if requested via header, model suffix/prefix or env
      const wantsAntiTrunc =
        Boolean(req?.headers?.['x-anti-truncation']) ||
        targetModel.includes('anti-trunc') ||
        targetModel.includes('抗截断') ||
        process.env.AG_ENABLE_ANTI_TRUNCATION === '1';
      if (wantsAntiTrunc) {
        applyAntiTruncation(reqObj);
      }

      // Anti-Loop Guardrail: detect repetitive tool calls (e.g. 3+ identical consecutive reads)
      const targetContents = reqObj.contents || reqJson.contents;
      if (Array.isArray(targetContents)) {
        const loopMitigated = detectAndMitigateToolLoops(targetContents);
        if (loopMitigated) {
          log.warn(`[Proxy] 🛡️ [Anti-Loop Guardrail] Repetitive tool calls detected in conversation. Injected anti-loop advisory for ${candidateName}`);
        }
      }
    }
    reqJson.project = resolveGoogleProjectId(candidate);
    if (!isGeminiCliModel(candidate) && !reqJson.enabledCreditTypes) {
      reqJson.enabledCreditTypes = ['GOOGLE_ONE_AI'];
    }

    const updatedBody = Buffer.from(JSON.stringify(reqJson), 'utf-8');
    const authHeader = `Bearer ${accessToken}`;

    testedAccountsCount++;
    recordAccountRequest(candidate);
    incrementAccountInFlight(candidate);
    const startReqTime = Date.now();
    let candidateInFlightReleased = false;
    const releaseCandidateInFlight = () => {
      if (!candidateInFlightReleased) {
        candidateInFlightReleased = true;
        decrementAccountInFlight(candidate);
      }
    };
    const candidateHost = candidate.apiUrl ? (() => {
      try {
        const u = new URL(candidate.apiUrl);
        const host = u.hostname;
        if (!host || host.includes('generativelanguage')) return undefined;
        if (!isGeminiCliModel(candidate) && host === 'cloudcode-pa.googleapis.com') return undefined;
        return host.includes('cloudcode') ? host : undefined;
      } catch { return undefined; }
    })() : undefined;
    const isUpstreamDegraded = consecutive504TimeoutCount > 0 || consecutiveTimeoutCount > 0;
    const hostOverride = isGeminiCliModel(candidate)
      ? GOOGLE_HOSTS.CLOUD_CODE_PROD
      : (candidateHost || (isUpstreamDegraded ? GOOGLE_HOSTS.CLOUD_CODE_PROD : GOOGLE_HOSTS.CLOUD_CODE));
    if (isUpstreamDegraded && !candidateHost && !isGeminiCliModel(candidate)) {
      log.info(`[Proxy] Upstream daily endpoint experienced timeout. Routing candidate [${candidateName}] via production endpoint (${GOOGLE_HOSTS.CLOUD_CODE_PROD}).`);
    }
    const hasOtherCandidates = sortedAccounts.slice(i + 1).some((c) => {
      if (isAccountInCooldown(c, modelFamily) || getOpenBreaker(c) || getModelQuotaScore(c, modelFamily) <= 0) return false;
      if ((c as any).enabled === false || isAccountUnlicensed(c) || (c as any).isValidationRequired) return false;
      return true;
    });
    const healthySiblingAccountsCount = sortedAccounts.slice(i + 1).filter(
      (c) => !isAccountInCooldown(c, modelFamily) && !getOpenBreaker(c) && getModelQuotaScore(c, modelFamily) >= 50,
    ).length;
    const isStreamReq = req.url!.includes('streamGenerateContent') || req.url!.includes('alt=sse');
    const isFlash = /flash/i.test(targetModel);
    const candidateReqObj = (reqJson.request && typeof reqJson.request === 'object') ? reqJson.request as Record<string, unknown> : undefined;
    const candidateGenConfig = (candidateReqObj?.generationConfig || candidateReqObj?.generation_config || reqJson?.generationConfig || reqJson?.generation_config) as Record<string, unknown> | undefined;
    const hasThinkingConfig = Boolean(candidateGenConfig?.thinkingConfig || candidateGenConfig?.thinking_config);
    const reqContents = (candidateReqObj?.contents || reqJson.contents) as any[] | undefined;
    const isMultiTurn = Array.isArray(reqContents) && reqContents.length > 1;
    const isContextualPayload = updatedBody.length > 8_000 || isMultiTurn;
    const rawModelIdentifiers = `${targetModel} ${reqJson.requestedModel || ''} ${reqJson.model || ''} ${targetRaw || ''} ${candidate.name || ''} ${candidate.displayName || ''}`;
    const isThinkingModel = /thinking|thought|-high$|-medium$|\(medium\)|\(high\)|-tiered$|tiered/i.test(rawModelIdentifiers) || hasThinkingConfig || updatedBody.includes('/think-');
    const isFlashModel = isFlash;
    // Dynamic Adaptive Sizing: consider >60 KB as heavy payload to account for TPU prefill latency
    const isLargePayload = updatedBody.length > 60_000;
    const isLargePayloadOrThinking = isLargePayload || isThinkingModel;
    const effectiveFlashTimeout = Math.max(25_000, GOOGLE_POOL_HEADER_TIMEOUT_FLASH_MS);
    
    // Dynamic Adaptive Timeout based on payload size and thinking tier:
    let dynamicAdaptiveTimeout: number;
    if (updatedBody.length > 150_000) {
      dynamicAdaptiveTimeout = 85_000;
    } else if (updatedBody.length > 60_000 || isThinkingModel) {
      dynamicAdaptiveTimeout = 60_000;
    } else if (isContextualPayload || updatedBody.length > 25_000) {
      dynamicAdaptiveTimeout = 45_000;
    } else {
      dynamicAdaptiveTimeout = 35_000;
    }
    const flashTimeoutMs = hasOtherCandidates
      ? (healthySiblingAccountsCount >= 1
          ? (isLargePayloadOrThinking ? Math.min(40_000, Math.max(30_000, dynamicAdaptiveTimeout)) : dynamicAdaptiveTimeout)
          : (isLargePayloadOrThinking ? Math.max(55_000, dynamicAdaptiveTimeout) : dynamicAdaptiveTimeout))
      : (isLargePayloadOrThinking ? 65_000 : Math.min(50_000, GOOGLE_PROXY_TIMEOUT_MS));
    const largeTimeoutMs = Math.min(
      isFlashModel
        ? (hasOtherCandidates && healthySiblingAccountsCount >= 1
            ? (isThinkingModel ? 42_000 : 35_000)
            : (isThinkingModel ? (updatedBody.length > 100_000 ? 80_000 : 65_000) : 55_000))
        : 85_000,
      GOOGLE_PROXY_TIMEOUT_MS,
    );
    const standardTimeoutMs = hasOtherCandidates
      ? (healthySiblingAccountsCount >= 1 ? Math.max(GOOGLE_POOL_HEADER_TIMEOUT_MS, dynamicAdaptiveTimeout) : dynamicAdaptiveTimeout)
      : Math.min(dynamicAdaptiveTimeout, GOOGLE_PROXY_TIMEOUT_MS);

    const baseCandidateTimeout = isFlashModel
      ? (hasOtherCandidates
          ? (isLargePayloadOrThinking ? largeTimeoutMs : flashTimeoutMs)
          : Math.min(65_000, GOOGLE_PROXY_TIMEOUT_MS))
      : (isLargePayloadOrThinking ? largeTimeoutMs : standardTimeoutMs);

    // When no other candidates exist, fallback to the full proxy timeout for non-flash models,
    // but keep flash models strictly bounded to prevent freezing the agent session.
    let poolHeaderTimeout = hasOtherCandidates
      ? baseCandidateTimeout
      : (isFlashModel ? (isLargePayloadOrThinking ? 60_000 : flashTimeoutMs) : Math.min(65_000, GOOGLE_PROXY_TIMEOUT_MS));

    // Escalating retry timeout on 504: If a prior candidate experienced a timeout on this payload,
    // escalate candidate timeout to allow larger prompts to finish prefill, safely bounded by remainingPoolBudgetMs.
    if (consecutive504TimeoutCount > 0) {
      // In pools with >= 2 healthy candidates, bound escalation on Flash models so slow/stalled nodes fail fast
      const flashEscalation = (hasOtherCandidates && healthySiblingAccountsCount >= 2)
        ? 35_000
        : (isLargePayloadOrThinking ? 50_000 : 40_000);
      const maxEscalation = (hasOtherCandidates && healthySiblingAccountsCount >= 2)
        ? (isFlashModel ? flashEscalation : 45_000)
        : (isFlashModel ? (isLargePayloadOrThinking ? 65_000 : 45_000) : 75_000);
      const escalatingTimeout = Math.min(maxEscalation, GOOGLE_PROXY_TIMEOUT_MS);
      if (escalatingTimeout > poolHeaderTimeout) {
        log.info(`[Proxy] Prior candidate experienced 504 timeout. Escalating candidate timeout to ${escalatingTimeout / 1000}s for [${candidateName}]`);
        poolHeaderTimeout = escalatingTimeout;
      }
    }

    // Safety Cap: Bound poolHeaderTimeout by remaining pool loop safety budget (MAX_POOL_LOOP_DURATION_MS = 210s)
    // with an 8s margin to allow graceful error responses before the Go Language Server 5m0s context deadline
    const remainingPoolBudgetMs = MAX_POOL_LOOP_DURATION_MS - (Date.now() - poolLoopStartTime) - 8_000;
    const minViableTimeout = isFlashModel ? 8_000 : (isLargePayloadOrThinking ? 20_000 : 12_000);

    if (remainingPoolBudgetMs < minViableTimeout && i > 0) {
      log.warn(`[Proxy] Remaining pool loop budget (${Math.round(remainingPoolBudgetMs / 1000)}s) is below minimum viable inference timeout (${minViableTimeout / 1000}s). Halting rotation to avoid guaranteed timeout failure.`);
      if (!lastStatus || lastStatus === 200) lastStatus = 504;
      if (!lastErrorText) lastErrorText = 'Pool loop budget exhausted before minimum viable inference timeout';
      break;
    }

    const wasTimeoutCappedByBudget = poolHeaderTimeout > remainingPoolBudgetMs;
    if (wasTimeoutCappedByBudget) {
      log.info(`[Proxy] Capping candidate timeout from ${Math.round(poolHeaderTimeout / 1000)}s to ${Math.round(remainingPoolBudgetMs / 1000)}s based on remaining pool loop budget`);
      poolHeaderTimeout = Math.max(minViableTimeout, remainingPoolBudgetMs);
    }

    // AUDIT-001: Under Low Headroom (<= 2 healthy accounts), strictly cap candidate timeout to 25s
    // to guarantee that total attempts remain well under the client IDE abort threshold (~90-120s).
    const isLowHeadroom = initialHealthyCount > 0 && initialHealthyCount <= 2;
    if (isLowHeadroom && poolHeaderTimeout > 25_000) {
      log.info(`[Proxy] Low headroom pool (only ${initialHealthyCount} healthy accounts). Capping candidate timeout from ${Math.round(poolHeaderTimeout / 1000)}s to 25s to prevent client HTTP 499 disconnect.`);
      poolHeaderTimeout = 25_000;
    }

    const initialTurnsCount = Array.isArray((reqJson.request as any)?.contents || (reqJson as any)?.contents)
      ? ((reqJson.request as any)?.contents || (reqJson as any)?.contents).length
      : 0;
    const isHeavyHistory = initialTurnsCount > 40;
    const isFlashThinkingHedgeable = isFlashModel && isThinkingModel && !isLargePayload && !isHeavyHistory;
    const canHedge =
      isStreamReq &&
      hasOtherCandidates &&
      isFlashModel &&
      (!isLargePayloadOrThinking || isFlashThinkingHedgeable) &&
      !isLargePayload &&
      !isHeavyHistory &&
      !res.headersSent &&
      !res.writableEnded &&
      poolHeaderTimeout > HEDGED_REQUEST_DELAY_MS;

    let outcome: GoogleRequestOutcome;
    let successfulCandidate = candidate;
    try {
      log.info(`[CloudCode Candidate Dispatch] acc=${candidateName} model=${targetModel} host=${hostOverride} project=${reqJson.project} cli=${isGeminiCliModel(candidate)}`);
      if (!canHedge) {
        outcome = await executeGoogleCloudCodeRequest(
          req,
          res,
          updatedBody,
          isSessionRemote,
          authHeader,
          convId,
          hostOverride,
          poolHeaderTimeout,
          targetModel,
          startReqTime,
          undefined,
          candidate,
        );
      } else {
        const claimer = createResponseClaimer();
        let hedgeTimer: NodeJS.Timeout | undefined;

        const candidate1Promise = executeGoogleCloudCodeRequest(
          req,
          res,
          updatedBody,
          isSessionRemote,
          authHeader,
          convId,
          hostOverride,
          poolHeaderTimeout,
          targetModel,
          startReqTime,
          claimer,
          candidate,
        );

        const baseHedgeDelay = isFlashThinkingHedgeable
          ? Math.max(HEDGED_REQUEST_DELAY_MS, 15_000)
          : (isContextualPayload ? Math.max(HEDGED_REQUEST_DELAY_MS, 8_000) : HEDGED_REQUEST_DELAY_MS);
        const hedgeDelay = Math.min(baseHedgeDelay, Math.floor(poolHeaderTimeout * 0.6));

        const hedgePromise = new Promise<GoogleRequestOutcome>((resolveHedge) => {
          hedgeTimer = setTimeout(async () => {
            if (claimer.isClaimed() || res.headersSent || res.writableEnded) {
              resolveHedge({ success: false, statusCode: 499, error: 'Hedge aborted: already claimed or response finished' });
              return;
            }

            const sibling = sortedAccounts.slice(i + 1).find(
              (c) => !isAccountInCooldown(c, modelFamily) && getModelQuotaScore(c, modelFamily) > 0,
            );
            if (!sibling) {
              resolveHedge({ success: false, statusCode: 504, error: 'Hedge skipped: no eligible sibling accounts' });
              return;
            }

            const siblingName = sibling.accountEmail || sibling.name || 'sibling';
            log.info(
              `[Proxy] ⚡ [Hedged Request] Account [${candidateName}] did not send headers within ${hedgeDelay}ms. Launching speculative candidate [${siblingName}]...`,
            );

            let siblingToken: string | null = null;
            try {
              siblingToken = await getValidGoogleAccessToken(sibling);
            } catch (_) {}

            if (!siblingToken || claimer.isClaimed() || res.headersSent || res.writableEnded) {
              resolveHedge({ success: false, statusCode: 504, error: 'Hedge skipped: token unavailable or already claimed' });
              return;
            }

            const siblingReqJson = JSON.parse(JSON.stringify(reqJson));
            siblingReqJson.project = resolveGoogleProjectId(sibling);
            if (!isGeminiCliModel(sibling) && !siblingReqJson.enabledCreditTypes) {
              siblingReqJson.enabledCreditTypes = ['GOOGLE_ONE_AI'];
            }
            const siblingBody = Buffer.from(JSON.stringify(siblingReqJson), 'utf-8');
            const siblingAuth = `Bearer ${siblingToken}`;
            const siblingHost = isGeminiCliModel(sibling) ? GOOGLE_HOSTS.CLOUD_CODE_PROD : GOOGLE_HOSTS.CLOUD_CODE;

            testedAccountsCount++;
            recordAccountRequest(sibling);
            incrementAccountInFlight(sibling);
            const siblingStart = Date.now();
            let siblingInFlightReleased = false;
            const releaseSiblingInFlight = () => {
              if (!siblingInFlightReleased) {
                siblingInFlightReleased = true;
                decrementAccountInFlight(sibling);
              }
            };

            try {
              const siblingOutcome = await executeGoogleCloudCodeRequest(
                req,
                res,
                siblingBody,
                isSessionRemote,
                siblingAuth,
                convId,
                siblingHost,
                poolHeaderTimeout,
                targetModel,
                siblingStart,
                claimer,
                sibling,
              );
              if (siblingOutcome.success) {
                successfulCandidate = sibling;
                recordAccountLatency(sibling, Date.now() - siblingStart);
                recordSuccess(sibling);
                unmarkAccountUnlicensed(sibling);
                log.warn(
                  `[Proxy] 🏆 [Hedged Request Winner] Speculative candidate [${siblingName}] won race against [${candidateName}]!`,
                );
                setAccountCooldown(candidate, 60_000, currentFamily, true);
              }
              resolveHedge(siblingOutcome);
            } finally {
              const siblingStreamActive =
                isStreamReq &&
                successfulCandidate === sibling &&
                !res.writableEnded &&
                !res.destroyed &&
                typeof res.once === 'function';
              if (siblingStreamActive) {
                res.once('finish', () => {
                  recordAccountLatency(sibling, Date.now() - siblingStart);
                  releaseSiblingInFlight();
                });
                res.once('close', releaseSiblingInFlight);
              } else {
                releaseSiblingInFlight();
              }
            }
          }, hedgeDelay);
        });

        let candidate1Settled = false;
        let candidate1Result: GoogleRequestOutcome | undefined;
        const candidate1Watched = candidate1Promise.then((res1) => {
          candidate1Settled = true;
          candidate1Result = res1;
          if (res1.success && hedgeTimer) clearTimeout(hedgeTimer);
          return res1;
        });

        const firstOutcome = await Promise.race([
          candidate1Watched,
          hedgePromise,
        ]);

        if (firstOutcome.success) {
          outcome = firstOutcome;
          if (hedgeTimer) clearTimeout(hedgeTimer);
        } else {
          // If the first candidate to settle failed (e.g. Candidate 1 timed out or 504'd),
          // wait for the speculative candidate in hedgePromise before returning failure!
          if (candidate1Settled && candidate1Result && !candidate1Result.success) {
            log.info(`[Proxy] Candidate [${candidateName}] did not succeed. Awaiting speculative hedged candidate in flight...`);
            const hedgeOutcome = await hedgePromise;
            outcome = (hedgeOutcome && hedgeOutcome.success) ? hedgeOutcome : firstOutcome;
          } else {
            outcome = firstOutcome;
          }
        }
        if (hedgeTimer) clearTimeout(hedgeTimer);
      }

      const reqDuration = Date.now() - startReqTime;
      if (outcome.success || outcome.statusCode === 200) {
        recordAccountLatency(successfulCandidate, reqDuration);
      } else if (outcome.statusCode === 504 || (outcome.error && /timed out/i.test(outcome.error))) {
        metricObserve('proxy_upstream_ms', reqDuration, { upstream: hostOverride || 'cloudcode', status: '504', type: 'raw' });
        recordAccountLatency(candidate, Math.max(reqDuration, poolHeaderTimeout));
      }
    } finally {
      const candidateStreamActive =
        isStreamReq &&
        outcome?.success &&
        successfulCandidate === candidate &&
        !res.writableEnded &&
        !res.destroyed &&
        typeof res.once === 'function';
      if (candidateStreamActive) {
        res.once('finish', () => {
          recordAccountLatency(candidate, Date.now() - startReqTime);
          releaseCandidateInFlight();
        });
        res.once('close', releaseCandidateInFlight);
      } else {
        releaseCandidateInFlight();
      }
    }

    const elapsedMs = Date.now() - startReqTime;
    if (outcome.success) {
      consecutiveTimeoutCount = 0;
      consecutiveTransportErrorCount = 0;
      consecutive503CapacityCount = 0;
      recordSuccess(successfulCandidate);
      unmarkAccountUnlicensed(successfulCandidate);
      clearAccountCooldown(successfulCandidate, currentFamily);
      endAccountProbation(successfulCandidate, currentFamily);
      if (sessId && useStickySessions) {
        const existingAffinity = sessionAffinities.get(sessId);
        const isDivertedFromHealthySticky = Boolean(
          boundAccount &&
          successfulCandidate !== boundAccount &&
          existingAffinity &&
          existingAffinity.accountKey === getAccountQuotaKey(boundAccount) &&
          !isAccountInCooldown(boundAccount, currentFamily) &&
          !getOpenBreaker(boundAccount) &&
          !isAccountUnlicensed(boundAccount) &&
          getModelQuotaScore(boundAccount, currentFamily) > 0
        );
        if (!isDivertedFromHealthySticky) {
          bindSessionToModel(sessId, successfulCandidate);
        } else {
          log.debug(`[Proxy] Preserving sticky session binding to [${boundAccount.accountEmail || boundAccount.name}] after concurrency diversion to [${successfulCandidate.accountEmail || candidateName}].`);
        }
      }
      clearAccountBurst(successfulCandidate);
      log.info(`[Proxy] ✅ [Feedback] Model: [${targetModel}] | Account: [${successfulCandidate.accountEmail || candidateName}] -> HTTP 200 OK (${elapsedMs}ms)`);
      return true;
    }

    // If response was already sent or committed, we cannot rotate to another account
    if (res.headersSent || res.writableEnded) {
      return outcome.success;
    }

    // Downstream client socket check: only halt rotation if the IDE genuinely destroyed the connection
    const isClientSocketAlive = !res.writableEnded && !res.destroyed && Boolean(res.socket && !res.socket.destroyed && res.socket.writable !== false);

    // If client actually dropped connection (IDE closed window, cancelled prompt):
    if (!isClientSocketAlive) {
      const isGenuineUpstreamStall = outcome.statusCode === 504 || (elapsedMs >= poolHeaderTimeout && !res.headersSent);
      if (isGenuineUpstreamStall) {
        log.warn(`[Proxy] Account [${candidateName}] genuinely stalled upstream for ${Math.round(elapsedMs / 1000)}s before client closed (HTTP 499). Placing in 30s cooldown to protect pool from black-hole accounts.`);
        setAccountCooldown(candidate, 30_000, currentFamily, false);
        // ponytail: recording 60s latency permanently harms P2C ranking via EWMA for 15min. Record actual elapsedMs capped at 20s.
        recordAccountLatency(candidate, Math.min(elapsedMs, 20_000));
      }
      log.info(`[Proxy] 🛑 Client cancelled or closed connection (HTTP 499). Halting account rotation loop.`);
      return false;
    }

    // Upstream reset / abort occurred while downstream client socket is STILL HEALTHY:
    // Do NOT halt the rotation loop! Cool down candidate and try next account immediately.
    if (outcome.statusCode === 499 || (outcome.error && /Client closed request/i.test(outcome.error))) {
      log.warn(`[Proxy] Upstream socket disconnected on [${candidateName}] but downstream client is still active. Cooling down candidate and continuing rotation...`);
      setAccountCooldown(candidate, 60_000, currentFamily, true);
      continue;
    }

    if (outcome.statusCode === 429) {
      consecutiveTimeoutCount = 0;
      consecutiveTransportErrorCount = 0;
      const retryAfterHeader = outcome.headers?.['retry-after'];
      let decision = classifyGoogleCloudCode429(outcome.error, retryAfterHeader);

      // Strict 429 Isolation: An HTTP 429 is treated as genuine multi-hour quota exhaustion ONLY if
      // Google explicitly specified a reset duration >= 1h (or credit exhaustion) AND the candidate's
      // quota is genuinely depleted (currentQuotaScore <= 0).
      // Otherwise, it is an isolated burst/RPM rate limit: apply a brief pause of a few seconds (5-10s)
      // ONLY to this candidate, keeping all other pool accounts fully active and unpenalized.
      const currentQuotaScore = getModelQuotaScore(candidate, currentFamily);
      const isExplicitMultiHourReset =
        (Boolean(decision.isExplicitReset) && (decision.rawRetryAfterMs ?? 0) >= 3600_000) ||
        Boolean(decision.weeklyResetMs && decision.weeklyResetMs >= 3600_000);
      const isCreditExhausted = /insufficient.*credit|credit.*exhausted|g1_credits|minimum.*credit|not enough credit/i.test(outcome.error || '');
      const isIndividualQuotaMessage = /individual quota reached|upgrade your subscription|quota reached|resets in \d+h/i.test(outcome.error || '');
      const isGenuineQuotaExhaustion =
        decision.category === 'quota_exhausted' ||
        isIndividualQuotaMessage ||
        isExplicitMultiHourReset ||
        isCreditExhausted ||
        currentQuotaScore <= 0;

      if (isGenuineQuotaExhaustion) {
        decision.category = 'quota_exhausted';
        const liveKeyForCd = getAccountQuotaKey(candidate);
        const existingLive = getLiveAccountQuota(liveKeyForCd);
        const existingResetStr = currentFamily === 'claude'
          ? (existingLive?.claudeFiveHourReset || existingLive?.claudeResetTime)
          : (existingLive?.geminiFiveHourReset || existingLive?.geminiResetTime);
        const existingResetTs = existingResetStr ? Date.parse(existingResetStr) : 0;
        const nowMs = Date.now();
        const remainingUntilReset = (existingResetTs > nowMs) ? (existingResetTs - nowMs) : 0;

        const effectiveCooldown = decision.weeklyResetMs ||
          (decision.cooldownMs > 5 * 60_000 ? decision.cooldownMs : (remainingUntilReset > 5 * 60_000 ? remainingUntilReset : 5 * 3600_000));

        decision.cooldownMs = effectiveCooldown;
        decision.reason = decision.reason || `Quota exhausted — ${Math.round(effectiveCooldown / 3600_000)}h cooldown`;
      } else {
        const burstCount = recordAccountBurst(candidate);
        let burstCooldownMs = 10_000;
        if (retryAfterHeader && !isNaN(Number(retryAfterHeader))) {
          const parsedSec = Number(retryAfterHeader);
          if (parsedSec > 0 && parsedSec <= 15) burstCooldownMs = parsedSec * 1000;
          else if (parsedSec > 15) burstCooldownMs = Math.min(60_000, parsedSec * 1000);
        } else if (burstCount === 2) {
          burstCooldownMs = 25_000;
        } else if (burstCount === 3) {
          burstCooldownMs = 50_000;
        } else if (burstCount >= 4) {
          burstCooldownMs = 100_000;
        }
        decision = {
          category: 'rate_limited',
          cooldownMs: burstCooldownMs,
          reason: `Rate limit 429 (pause isolée ${Math.round(burstCooldownMs / 1000)}s — autres comptes actifs)`,
          isExplicitReset: decision.isExplicitReset,
          rawRetryAfterMs: decision.rawRetryAfterMs,
        };
      }

      log.warn(
        `[Proxy] ⚠️ [Feedback] Model: [${targetModel}] | Account: [${candidateName}] (${currentFamily}) -> HTTP 429 (${decision.category}: ${decision.reason}, cooldown: ${Math.round(decision.cooldownMs / 1000)}s) (${elapsedMs}ms)${outcome.error ? ` | Upstream: ${outcome.error.replace(/\s+/g, ' ').slice(0, 160)}` : ''}`
      );
      const isRateLimit = decision.category === 'rate_limited' || decision.category === 'soft_rate_limit';
      setAccountCooldown(candidate, decision.cooldownMs, currentFamily, isRateLimit);

      if (decision.category === 'quota_exhausted') {
        recordFailure(candidate, 'rate_limit');
        consecutiveQuotaExhausted++;
        const liveKey = getAccountQuotaKey(candidate);
        markAccountQuotaExhausted(liveKey, currentFamily);
        const targetEmail = candidate.accountEmail || (candidateName.includes('@') ? candidateName : '');
        if (targetEmail) {
          markAccountQuotaExhausted(targetEmail, currentFamily);
        }
        if (sessId) {
          sessionAffinities.delete(sessId);
        }

        const existingQuota = getLiveAccountQuota(liveKey);
        const rawWeekly = decision.weeklyResetMs || ((decision.rawRetryAfterMs ?? 0) > 24 * 3600 * 1000 ? decision.rawRetryAfterMs! : null);
        const isWeekly = decision.cooldownMs > 24 * 3600 * 1000 || rawWeekly !== null;
        const nowMs = Date.now();
        const weeklyDuration = rawWeekly || decision.cooldownMs;
        const existingResetIso = currentFamily === 'claude'
          ? (existingQuota?.claudeFiveHourReset || existingQuota?.claudeResetTime)
          : (existingQuota?.geminiFiveHourReset || existingQuota?.geminiResetTime);
        const existingResetTs = existingResetIso ? Date.parse(existingResetIso) : 0;
        const cooldownDuration = isWeekly
          ? weeklyDuration
          : (decision.cooldownMs > 0 ? decision.cooldownMs : 5 * 3600_000);
        const resetIso = (existingResetTs > nowMs + 5 * 60_000 && !isWeekly)
          ? existingResetIso!
          : new Date(nowMs + cooldownDuration).toISOString();
        if (isWeekly) {
          setAccountCooldown(candidate, Math.min(weeklyDuration, 7 * 24 * 3600 * 1000), currentFamily);
        }
        if (currentFamily === 'gemini') {
          updateLiveAccountQuota(liveKey, {
            ...existingQuota,
            geminiFiveHourPct: 0,
            geminiWeeklyPct: isWeekly ? 0 : (existingQuota?.geminiWeeklyPct ?? 100),
            fiveHourPercentage: 0,
            weeklyPercentage: isWeekly ? 0 : (existingQuota?.weeklyPercentage ?? 100),
            geminiFiveHourReset: resetIso,
            geminiWeeklyReset: isWeekly ? resetIso : existingQuota?.geminiWeeklyReset,
            geminiResetTime: resetIso,
            updatedAt: nowMs,
          } as AccountLiveQuota);
        } else if (currentFamily === 'claude') {
          updateLiveAccountQuota(liveKey, {
            ...existingQuota,
            claudeFiveHourPct: 0,
            claudeWeeklyPct: isWeekly ? 0 : (existingQuota?.claudeWeeklyPct ?? 100),
            fiveHourPercentage: 0,
            weeklyPercentage: isWeekly ? 0 : (existingQuota?.weeklyPercentage ?? 100),
            claudeFiveHourReset: resetIso,
            claudeWeeklyReset: isWeekly ? resetIso : existingQuota?.claudeWeeklyReset,
            claudeResetTime: resetIso,
            updatedAt: nowMs,
          } as AccountLiveQuota);
        }

        if (targetEmail && (isWeekly || cooldownDuration >= 3600_000)) {
          persistAccountQuotaExhaustedToDisk(targetEmail, resetIso);
        }

        // Fast-fail if 3 consecutive accounts hit quota exhaustion for this model in a larger pool
        // only when no healthy accounts with positive quota remain
        const remainingHealthyWithQuota = sortedAccounts.slice(i + 1).some(
          (c) => !isAccountInCooldown(c, currentFamily) && getModelQuotaScore(c, currentFamily) > 20,
        );
        if (consecutiveQuotaExhausted >= 3 && !remainingHealthyWithQuota && sortedAccounts.length > 3) {
          lastStatus = 429;
          lastErrorText = outcome.error || `HTTP 429 (${decision.reason})`;
          log.warn(
            `[Proxy] Model ${targetModel} hit quota exhaustion across ${consecutiveQuotaExhausted} consecutive accounts with no healthy accounts remaining. Fast-failing pool to trigger immediate fallback.`,
          );
          break;
        }
      } else {
        consecutiveQuotaExhausted = 0;
      }

      // Circuit breaker: Only stop rotation if there are NO remaining healthy accounts with positive quota (>20%).
      // Fleet Protection Circuit Breaker: If 4 consecutive accounts receive burst 429s,
      // halt rotation to protect remaining healthy accounts from cascading freeze.
      const isGenuineQuotaExhausted = decision.category === 'quota_exhausted';
      if (!isGenuineQuotaExhausted) {
        consecutive429Count++;
      } else {
        consecutive429Count = 0;
      }

      // Dynamic pool threshold (AUDIT-006): protect both large pools (4 accounts cap) and small pools
      const burst429Threshold = sortedAccounts.length > 4 ? 4 : Math.max(2, sortedAccounts.length);
      if (consecutive429Count >= burst429Threshold && sortedAccounts.length > 1) {
        lastStatus = 429;
        lastErrorText = outcome.error || `HTTP 429 (${decision.reason} across ${consecutive429Count} accounts - IP/client rate limit protected)`;
        log.warn(
          `[Proxy] 🛑 429 Fleet Circuit Breaker: Model ${targetModel} hit rate limits across ${consecutive429Count} consecutive accounts. Stopping rotation to protect remaining ${sortedAccounts.length - (i + 1)} pool accounts and trigger fallback.`,
        );
        break;
      }

      if (consecutive429Count === 3) {
        // Guard against phantom upstream requests if client canceled in IDE (AUDIT-007)
        const clientClosedBefore = res.destroyed || Boolean(res.socket && res.socket.destroyed);
        if (clientClosedBefore) {
          log.info(`[Proxy] 🛑 Client disconnected before IP throttle drain. Halting rotation.`);
          return false;
        }
        log.warn(`[Proxy] ⏳ [IP Throttle Defense] 3 consecutive burst 429s encountered. Applying 2.5s IP token bucket drain before attempting candidate 4...`);
        await new Promise((r) => setTimeout(r, 2500));
        const clientClosedAfter = res.destroyed || Boolean(res.socket && res.socket.destroyed);
        if (clientClosedAfter) {
          log.info(`[Proxy] 🛑 Client disconnected during IP throttle drain. Halting rotation.`);
          return false;
        }
      }

      lastStatus = 429;
      lastErrorText = outcome.error || `HTTP 429 (${decision.reason})`;

      // If all remaining candidates are in cooldown, break early to save latency
      const hasEligibleRemaining = sortedAccounts.slice(i + 1).some((c) => !isAccountInCooldown(c, currentFamily));
      if (!hasEligibleRemaining && busyEligibleAccountsCount === 0) {
        log.warn(`[Proxy] No remaining healthy accounts left in pool for ${currentFamily}. Fast-failing pool.`);
        break;
      }

      if (i + 1 < totalAttempts) {
        // Genuine quota exhaustion: NEVER pace, rotate immediately (0ms) to next candidate
        if (isGenuineQuotaExhaustion || decision.category === 'quota_exhausted') {
          log.info(`[Proxy] ⚡ Quota exhausted on [${candidateName}] (${currentFamily}). Immediate 0ms rotation to next available account.`);
          continue;
        }

        // Anti-domino pacing: When Google triggers a burst/RPM rate limit, pause ONLY if there are NO OTHER
        // healthy sibling accounts available in the pool. If other healthy accounts exist, rotate immediately (0ms).
        const hasAvailableSibling = sortedAccounts.slice(i + 1).some(
          (c) => !isAccountInCooldown(c, currentFamily) && !getOpenBreaker(c) && !isAccountUnlicensed(c) && (c as any).enabled !== false,
        );
        if (!hasAvailableSibling) {
          const isBurst429 = decision.category === 'rate_limited' || decision.category === 'soft_rate_limit';
          if (isBurst429) {
            const pacingMs = consecutive429Count > 1
              ? 2000 + Math.floor(Math.random() * 800)
              : 1000 + Math.floor(Math.random() * 400);
            log.info(
              `[Proxy] ⏳ [IP Bucket Drain] Burst 429 détecté sans compte libre. Pause préventive de ${pacingMs}ms pour vider le seau IP Google avant rotation.`
            );
            const clientTrulyClosed = res.destroyed || Boolean(res.socket && res.socket.destroyed);
            if (clientTrulyClosed) {
              log.info(`[Proxy] 🛑 Client disconnected before pacing. Halting rotation.`);
              return false;
            }
            await new Promise((r) => setTimeout(r, pacingMs));
            const clientStillClosed = res.destroyed || Boolean(res.socket && res.socket.destroyed);
            if (clientStillClosed) {
              log.info(`[Proxy] 🛑 Client disconnected after pacing. Halting rotation.`);
              return false;
            }
          }
        }
      }
      continue;
    } else {
      consecutive429Count = 0;
    }

    const isSignatureOrFormat400 =
      outcome.statusCode === 400 &&
      (/thought.*signature|signature.*thought|signature.*thinking|thinking.*signature|corrupted.*signature|invalid.*signature/i.test(
        outcome.error || '',
      ) ||
      /invalid.*argument|INVALID_ARGUMENT/i.test(outcome.error || ''));

    if (isSignatureOrFormat400) {
      log.warn(`[Proxy] Detected payload validation / thought signature issue from Vertex AI on ${candidateName} (${(outcome.error || '').slice(0, 100)}). Auto-repairing...`);
      const isMissingSig = /missing.*thought_signature|thought_signature.*missing/i.test(outcome.error || '');
      // Deep clone to prevent mutating original payload for subsequent pool candidates (AUDIT-010)
      const repairedReqJson = JSON.parse(JSON.stringify(reqJson));
      const targetContents = (repairedReqJson.request as any)?.contents || repairedReqJson.contents;
      let repaired = false;

      const activeConvKey = convId || sessId || '';

      // 1. If signature was missing on functionCall parts, try restoring from cache / sibling parts first
      if (isMissingSig && Array.isArray(targetContents)) {
        repaired = restoreThoughtSignatures(targetContents, activeConvKey, 'gemini');
        if (repaired) {
          log.info(`[Proxy] Successfully restored missing thought signature(s) from cache/siblings for ${candidateName}`);
        }
      }

      // 2. If restore was not applicable, signature corrupted, or INVALID_ARGUMENT returned, convert unverified tool calls in history
      // to plain text and strip thinkingConfig so Vertex AI accepts the request without signature errors
      if (!repaired) {
        log.warn(`[Proxy] Converting unverified tool calls in history to text to bypass Vertex AI payload validation for ${candidateName}`);
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
          if (obj.systemInstruction && typeof obj.systemInstruction === 'object') {
            const si = obj.systemInstruction as { parts?: Array<Record<string, unknown>> };
            if (Array.isArray(si.parts)) {
              for (const p of si.parts) {
                if (p && typeof p === 'object') {
                  delete p.thought_signature;
                  delete p.thoughtSignature;
                  delete p.signature;
                  delete p.thought;
                }
              }
            }
          }
          if (Array.isArray(obj.contents)) {
            for (const c of obj.contents) {
              if (Array.isArray(c.parts)) {
                c.parts = c.parts.filter((p: any) => !p?.thought && p?.type !== 'thinking');
                if (c.parts.length === 0) c.parts = [{ text: '.' }];
                for (const p of c.parts) {
                  if (p && typeof p === 'object') {
                    delete p.thought_signature;
                    delete p.thoughtSignature;
                    delete p.signature;
                    delete p.thought;
                  }
                }
              }
            }
            flattenAllToolCallsToText(obj.contents);
            normalizeConversationTurns(obj.contents);
          }
          if (obj.request && typeof obj.request === 'object') {
            sanitizeObj(obj.request);
          }
        };
        sanitizeObj(repairedReqJson);
      }

      const retryBody = Buffer.from(JSON.stringify(repairedReqJson), 'utf-8');
      const retryOutcome = await executeGoogleCloudCodeRequest(
        req,
        res,
        retryBody,
        isSessionRemote,
        authHeader,
        activeConvKey,
        hostOverride,
        poolHeaderTimeout,
        targetModel,
        startReqTime,
      );
      if (retryOutcome.success) {
        recordSuccess(candidate);
        clearAccountCooldown(candidate, currentFamily);
        if (activeConvKey) {
          markConvCorruptedSignatures(activeConvKey);
        }
        if (sessId) {
          bindSessionToModel(sessId, candidate);
        }
        log.info(`[Proxy] Self-healing retry after payload repair SUCCEEDED on account ${candidateName}`);
        return true;
      }
      // If the retry after thought repair failed with another error (e.g. 504/429),
      // update outcome so pool rotation can handle it appropriately instead of stalling on stale 400
      outcome = retryOutcome;
      if (activeConvKey) {
        markConvCorruptedSignatures(activeConvKey);
      }
    }

    if (outcome.statusCode === 400 && /context.*length|token.*limit|payload.*exceed|too large|request.*large|exceeds.*limit/i.test(outcome.error || '')) {
      log.warn(`[Proxy] Detected Context/Token limit error from upstream on ${candidateName}. Trimming 30% oldest history and retrying...`);
      trimOldestHistory(reqJson);
      const retryBody = Buffer.from(JSON.stringify(reqJson), 'utf-8');
      const retryOutcome = await executeGoogleCloudCodeRequest(
        req,
        res,
        retryBody,
        isSessionRemote,
        authHeader,
        convId,
        hostOverride,
        poolHeaderTimeout,
        targetModel,
        startReqTime,
      );
      if (retryOutcome.success) {
        recordSuccess(candidate);
        clearAccountCooldown(candidate, currentFamily);
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
      `[Proxy] ⚠️ [Feedback] Model: [${targetModel}] | Account: [${candidateName}] -> HTTP ${lastStatus} (${lastErrorText.slice(0, 150)}) (${elapsedMs}ms). Rotating to next account...`
    );

    if (lastStatus === 404) {
      log.warn(
        `[Proxy] 🛑 Model [${targetModel}] is not available on Cloud Code API (HTTP 404: ${lastErrorText.slice(0, 100)}). Halting account pool loop immediately to avoid futile rotations and trigger fast fallback.`
      );
      break;
    }

    const isTransportError =
      !!outcome.isTransportError ||
      /ENETUNREACH|EHOSTUNREACH|ENETDOWN|ECONNREFUSED|ECONNABORTED|ECONNRESET|socket hang up|DNS resolution failed/i.test(lastErrorText);

    if (lastStatus !== 429 && !isTransportError) {
      recordFailure(candidate, 'server');
    }

    if (isTransportError) {
      consecutiveTransportErrorCount++;
      log.warn(
        `[Proxy] Transport/network error on account ${candidateName} (${lastErrorText.slice(0, 120)}). Preserving account quota state without cooldown.`
      );
      // Evict cached socket and invalidate stale Anycast DNS
      try {
        evictAgent({ host: hostOverride || GOOGLE_HOSTS.CLOUD_CODE });
        invalidateCachedDns(hostOverride || GOOGLE_HOSTS.CLOUD_CODE);
      } catch (_) {}

      // Short progressive backoff to allow network adapter / VPN to re-establish
      const transportBackoffMs = Math.min(800, 200 * Math.pow(1.4, consecutiveTransportErrorCount));
      await new Promise((r) => setTimeout(r, transportBackoffMs));

      // Only trip the transport breaker if transport error persists across multiple distinct accounts
      const maxTransportThreshold = Math.max(4, Math.min(6, sortedAccounts.length));
      if (consecutiveTransportErrorCount >= maxTransportThreshold) {
        log.warn(
          `[Proxy] 🛑 Local Network Transport Circuit Breaker: Model [${targetModel}] encountered persistent transport failures across ${consecutiveTransportErrorCount} consecutive accounts. Halting pool loop to trigger recovery.`
        );
        break;
      }
    } else {
      consecutiveTransportErrorCount = 0;

      // Specialized handler for Google Cloud Code per-account capacity exhaustion:
      // Google returns HTTP 503 with reason "MODEL_CAPACITY_EXHAUSTED" / "No capacity available for model ... on the server"
      // even when retrieveUserQuotaSummary reports positive quota. This is a per-account model allocation exhaustion,
      // NOT a global Google service outage!
      const isCapacityExhausted =
        lastStatus === 503 ||
        /MODEL_CAPACITY_EXHAUSTED|no capacity available|overloaded|unavailable/i.test(lastErrorText);

      if (isCapacityExhausted) {
        consecutive503CapacityCount++;
        log.warn(
          `[Proxy] ⚠️ Account [${candidateName}] hit MODEL_CAPACITY_EXHAUSTED / 503 Overload for [${targetModel}]. Placing in 45s cooldown without clearing quota. (Capacity 503 count: ${consecutive503CapacityCount}/${CAPACITY_503_CASCADE_THRESHOLD})`,
        );
        // Do not zero out the account's real 5-hour quota for transient upstream cluster capacity saturation.
        // Instead, cool down briefly (45s) and penalize latency to give the TPU pod time to shed load.
        setAccountCooldown(candidate, 45_000, currentFamily, true);
        recordAccountLatency(candidate, 45_000);

        const combinedOutageCount = consecutive503CapacityCount + consecutive504TimeoutCount;
        if (consecutive503CapacityCount >= CAPACITY_503_CASCADE_THRESHOLD || combinedOutageCount >= Math.max(2, CAPACITY_503_CASCADE_THRESHOLD)) {
          log.warn(
            `[Proxy] ⚠️ Global TPU/Cluster Capacity Exhaustion detected on [${targetModel}] (${consecutive503CapacityCount} consecutive 503s, ${combinedOutageCount} total outages). Triggering immediate cross-family cascade to Claude...`,
          );
          lastStatus = 503;
          lastErrorText = `Google Cloud Code API capacity unavailable across ${consecutive503CapacityCount} consecutive accounts`;
          break;
        }
        continue;
      }

      // On HTTP 500 / 502 / 503 / 504 (Internal Error / Gateway Timeout / Service Unavailable / Bad Gateway / Overloaded):
      const isServerOutage =
        lastStatus === 500 ||
        lastStatus === 502 ||
        lastStatus === 503 ||
        lastStatus === 504 ||
        /timed out|unavailable|overloaded|service unavailable|backend error|internal error/i.test(lastErrorText);

      if (isServerOutage) {
        consecutiveTimeoutCount++;
        const maxOutageLimit = Math.max(4, Math.min(6, Math.ceil(sortedAccounts.length * 0.4)));
        const configuredOutage = Number(process.env.AG_OUTAGE_CONSECUTIVE_TIMEOUTS || 0);
        const upstreamOutageThreshold = configuredOutage >= 4 ? configuredOutage : maxOutageLimit;
        const isUpstreamOutage = consecutiveTimeoutCount >= upstreamOutageThreshold;
        // For HTTP 500 internal errors: 20s cooldown; 504 timeouts (transient server/thinking latency): 45s cooldown; outages: 45s.
        const timeoutCooldownMs = lastStatus === 500 ? 20_000 : (lastStatus === 504 ? 45_000 : (isUpstreamOutage ? 45_000 : 30_000));
        const isPayloadInducedTimeout = lastStatus === 504 && (isLargePayload || isContextualPayload || isMultiTurn || consecutive504TimeoutCount > 0);
        const isCappedTimeout = wasTimeoutCappedByBudget || (lastStatus === 504 && poolHeaderTimeout < baseCandidateTimeout);
        if (lastStatus === 504) {
          log.info(
            `[Proxy] Account ${candidateName} timed out (HTTP 504, ${elapsedMs}ms). Placing in 30s transient cooldown to avoid immediate repeat stall.`,
          );
          setAccountCooldown(candidate, 30_000, currentFamily, false);
        } else {
          log.warn(
            `[Proxy] Account ${candidateName} failed with HTTP ${lastStatus}. Placing in ${timeoutCooldownMs / 1000}s cooldown (${isUpstreamOutage ? 'upstream outage detected' : 'transient server issue'}).`,
          );
          setAccountCooldown(candidate, timeoutCooldownMs, currentFamily, true);
        }
        if (lastStatus === 504) {
          metricObserve('proxy_upstream_ms', elapsedMs, { upstream: hostOverride || 'cloudcode', status: '504', type: 'raw' });
          recordAccountLatency(candidate, (isCappedTimeout || isPayloadInducedTimeout) ? Math.min(elapsedMs, 25_000) : 60_000);
          if (sessId) {
            sessionAffinities.delete(sessId);
          }
          // On 504 on a large context payload, compact historical turns & trim oldest turns before candidate rotation
          const reqObj = (reqJson.request || reqJson) as any;
          if (Array.isArray(reqObj?.contents) && reqObj.contents.length > 4) {
            log.info(`[Proxy] 504 timeout on heavy session (${reqObj.contents.length} turns). Running context trimmer & history compaction before rotating to next account...`);
            trimContextPayload(reqJson as unknown as GeminiRequestBody);
            // On 504, aggressively cap remaining history to 30 turns to immediately break prefill timeout cascade
            const didTrim = trimOldestHistory(reqJson, 30);
            if (didTrim) {
              const remainingTurns = ((reqJson.request || reqJson) as any)?.contents?.length;
              log.warn(`[Proxy] ✂️ [Context Auto-Trimmer] Trimmed history (${remainingTurns} turns remaining) to break 504 timeout cascade for subsequent pool candidates.`);
              consecutive504TimeoutCount = Math.min(consecutive504TimeoutCount, 1);
            }
            normalizeConversationTurns(reqObj.contents);
          }
        }

        const remainingHealthyWithQuota = sortedAccounts.slice(i + 1).some(
          (c) => !isAccountInCooldown(c, currentFamily) && getModelQuotaScore(c, currentFamily) > 0,
        );
        if (isUpstreamOutage && !remainingHealthyWithQuota) {
          lastStatus = lastStatus;
          lastErrorText = `Google Cloud Code API upstream service failure (HTTP ${lastStatus}) across ${consecutiveTimeoutCount} consecutive accounts with no healthy accounts remaining`;
          log.warn(
            `[Proxy] 🛑 Upstream Server Failure Circuit Breaker: Model [${targetModel}] failed with HTTP ${lastStatus} across ${consecutiveTimeoutCount} consecutive accounts. Fast-failing pool to trigger immediate fallback cascade / AI Studio recovery.`,
          );
          break;
        }

        // Fast-fail 504 timeout cascade: If multiple accounts consecutively time out on the same model/payload,
        // the upstream TPU cluster is saturated. Trigger immediate fallback cascade instead of exhausting all accounts in the pool.
        if (lastStatus === 504 || /timed out|deadline exceeded|gateway timeout/i.test(lastErrorText)) {
          // AUDIT-001 & AUDIT-002: In low headroom (<= 2 healthy accounts), only break immediately if NO healthy sibling candidate remains in pool
          // to prevent abandoning healthy accounts, while still preventing compounding silence when the pool is truly exhausted.
          if (isLowHeadroom && !remainingHealthyWithQuota) {
            log.warn(`[Proxy] ⚠️ Low headroom pool candidate timed out (${elapsedMs}ms) with no remaining healthy accounts. Triggering immediate cascade fallback to prevent client HTTP 499 disconnect...`);
            break;
          }
          consecutive504TimeoutCount++;
          const combinedOutageCount = consecutive504TimeoutCount + consecutive503CapacityCount;
          // Fast-fail to Claude fallback after at most 3 consecutive timeouts on heavy sessions/clusters
          const dynamicPoolThreshold = Math.min(CONSECUTIVE_504_CASCADE_THRESHOLD, Math.max(3, Math.ceil(sortedAccounts.length * 0.25)));
          const outageThreshold = dynamicPoolThreshold;
          if (consecutive504TimeoutCount >= outageThreshold || combinedOutageCount >= outageThreshold) {
            log.warn(
              `[Proxy] ⚠️ Cluster Failure Spike on [${targetModel}] (${consecutive504TimeoutCount} consecutive 504 timeouts, ${combinedOutageCount} total outages). Triggering fast failover / cascade to prevent pool freeze across ${totalAttempts} accounts...`,
            );
            lastStatus = 504;
            lastErrorText = `Google Cloud Code API gateway timeout (504) across ${consecutive504TimeoutCount} consecutive accounts`;
            break;
          }
        }
      } else {
        consecutiveTimeoutCount = 0;
        consecutive504TimeoutCount = 0;
      }
    }

    // On HTTP 403 licensing/forbidden failure:
    if (lastStatus === 403) {
      if (sessId) {
        sessionAffinities.delete(sessId);
      }
      const isValidationRequired = /validation_required|verify.*account|verification.*required/i.test(lastErrorText);
      const isLicenseError = /license|licens|permission|unauthorized|forbidden|not have a valid|account.*restricted|restricted|unavailable tier|suspended|denied access/i.test(lastErrorText) || isValidationRequired;
      
      // If the error is VALIDATION_REQUIRED / missing onboarding consent, attempt automatic background activation
      if (isValidationRequired && isGoogleCloudCodeModel(candidate)) {
        let validationUrl = '';
        try {
          const parsed = JSON.parse(lastErrorText);
          const errInfo = parsed.error?.details?.find((d: any) => d['@type']?.includes('ErrorInfo'));
          validationUrl = errInfo?.metadata?.validation_url || '';
          if (!validationUrl) {
            const help = parsed.error?.details?.find((d: any) => d['@type']?.includes('Help'));
            validationUrl = help?.links?.[0]?.url || '';
          }
        } catch (_) {}

        if (validationUrl) {
          log.warn(`[Proxy] 🚨 Compte ${candidateName} requiert une validation Google (Challenge interactif / plt) !`);
          log.warn(`[Proxy] 🔗 Lien de déblocage direct navigateur : ${validationUrl}`);
        } else {
          log.warn(`[Proxy] Account ${candidateName} encountered VALIDATION_REQUIRED ("Get started" pending). Triggering automatic background onboarding & TOS registration...`);
        }

        getValidGoogleAccessToken(candidate).then((token) => {
          if (token) {
            onboardUserAndAcceptTerms(token).catch((err) => {
              log.warn(`[Proxy] Auto-onboarding failed for ${candidateName}:`, err?.message || err);
            });
          }
        }).catch(() => {});
      }

      const quarantineMs = isLicenseError ? 7 * 24 * 3600 * 1000 : 24 * 3600 * 1000;
      log.warn(
        `[Proxy] Account ${candidateName} received HTTP 403 (${isLicenseError ? 'license/permission/verification challenge' : 'forbidden'}). Placing in ${Math.round(quarantineMs / 3600000)}h quarantine to eliminate failover latency.`,
      );
      if (isLicenseError) {
        markAccountUnlicensed(candidate);
      }
      setAccountCooldown(candidate, quarantineMs);
      setAccountCooldown(candidate, quarantineMs, 'gemini');
      setAccountCooldown(candidate, quarantineMs, 'claude');
      if (modelFamily) setAccountCooldown(candidate, quarantineMs, modelFamily);
      continue;
    }

    // On HTTP 402 payment / credit depletion, quarantine account for 24h to avoid wasting failovers
    if (lastStatus === 402 || (lastStatus === 400 && /prepayment.*depleted|credit.*depleted|insufficient.*credit|billing.*closed/i.test(lastErrorText))) {
      if (sessId) {
        sessionAffinities.delete(sessId);
      }
      const quarantineMs = 24 * 3600 * 1000;
      log.warn(`[Proxy] Account ${candidateName} hit HTTP 402 / credit depletion (${lastErrorText.slice(0, 100)}). Placing in 24h quarantine.`);
      setAccountCooldown(candidate, quarantineMs);
      setAccountCooldown(candidate, quarantineMs, 'gemini');
      setAccountCooldown(candidate, quarantineMs, 'claude');
      if (modelFamily) setAccountCooldown(candidate, quarantineMs, modelFamily);
      continue;
    }

    // On HTTP 400, distinguish between account-level precondition failure (e.g. location, regional eligibility, age)
    // and true payload format errors. Account-level failures place that candidate in cooldown and continue pool rotation.
    const isPrecondition400 = /failed_precondition|location is not supported|user location|unsupported region|underage|minor/i.test(lastErrorText);
    const isThoughtSignature400 = /thought.*signature|signature.*thought|corrupted.*signature|invalid.*signature|invalid.*argument|INVALID_ARGUMENT/i.test(lastErrorText);

    if (lastStatus === 400 && isPrecondition400) {
      log.warn(
        `[Proxy] Account ${candidateName} failed precondition (location/eligibility: ${lastErrorText.slice(0, 100)}). Placing in 24h cooldown and continuing pool rotation.`,
      );
      const quarantineMs = 24 * 3600 * 1000;
      setAccountCooldown(candidate, quarantineMs);
      setAccountCooldown(candidate, quarantineMs, 'gemini');
      setAccountCooldown(candidate, quarantineMs, 'claude');
      if (modelFamily) setAccountCooldown(candidate, quarantineMs, modelFamily);
      continue;
    }

    if (lastStatus === 400 && !isThoughtSignature400) {
      log.warn(`[Proxy] HTTP 400 indicates a payload format error on ${candidateName}. Aborting account pool rotation to trigger immediate fallback recovery.`);
      break;
    }

    if (i + 1 < totalAttempts) {
      // Sub-second silent failover between accounts in the pool
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  if (networkAttemptCount === 0 && busyEligibleAccountsCount > 0 && (!lastStatus || lastStatus === 500)) {
    lastStatus = 429;
    lastErrorText = `All eligible accounts in Google Cloud Code pool for ${modelFamily} reached maximum in-flight capacity (${MAX_CONCURRENT_PER_ACCOUNT}/${MAX_CONCURRENT_PER_ACCOUNT} concurrent requests). Preserving accounts without cooldown.`;
    log.warn(`[Proxy] Concurrency limit reached: ${busyEligibleAccountsCount} eligible account(s) for ${modelFamily} are busy with in-flight requests. Preserving accounts without cooldown.`);
  }

  // Strict Model Locking: NEVER cascade or degrade to another model family or version.
  // The user selected this exact model; when its pool accounts fail, report the error directly without substituting another model.
  const allowCrossModelFallback = process.env.AG_ENABLE_CROSS_MODEL_FALLBACK !== '0';
  const allCustomModels = expandModelsWithEffort(loadCustomModels(true));
  const currentBase = normalizeCloudCodeModelId((reqJson.model as string) || (reqJson.request as any)?.model || '');
  if (currentBase) attemptedModels.add(currentBase.toLowerCase());
  const isClaudeRequest = currentBase.toLowerCase().includes('claude');

  // Discover configured Google AI Studio keys for same-family Gemini recovery
  const aiStudioRecoveryModels = allCustomModels.filter(
    (m) =>
      m.provider === 'google-gemini' &&
      !m._poolOnly &&
      !getOpenBreaker(m) &&
      m.apiKey &&
      m.apiKey !== 'auto',
  );

  const isPreconditionLocationError = /location is not supported|user location|unsupported region/i.test(lastErrorText);
  const canAttemptSameFamilyRecovery = !isClaudeRequest && aiStudioRecoveryModels.length > 0;
  const canAttemptFallback =
    fallbackDepth === 0 &&
    attemptedModels.size <= 3 &&
    !res.writableEnded &&
    !res.destroyed &&
    (allowCrossModelFallback || canAttemptSameFamilyRecovery || isPreconditionLocationError);

  if (!canAttemptFallback && !allowCrossModelFallback) {
    log.warn(`[Proxy] Strict model locking: Cross-model fallback disabled. Reporting error for [${targetRaw}] without model substitution.`);
  } else if (canAttemptFallback) {
    const isStream = req.url!.includes('streamGenerateContent') || req.url!.includes('alt=sse');

    if (allowCrossModelFallback && attemptedModels.size <= 1) {
      // Dynamic fallback: discover all available Cloud Code model families,
      // same family first (Gemini→other Gemini, Claude→other Claude), then cross-family.
      // Guard: prevent infinite recursive fallback cascades across models
      if (attemptedModels.size > 3) {
        log.warn(`[Proxy] Agent resilience: Max fallback depth reached (${attemptedModels.size} models attempted). Stopping fallback cascade.`);
        return false;
      }

      // Emergency cross-family fallback: include ALL model IDs, including enabled:false ones.
      // The enabled flag controls normal routing UI preference; it must not block emergency quota fallback.
      const allModelBases = [...new Set(
        allCustomModels
          .filter(m => isGoogleCloudCodeModel(m) && !getOpenBreaker(m) && m.apiKey !== 'auto')
          .map(m => normalizeCloudCodeModelId(m.externalModelName || m.name))
          .filter(b => b && !b.includes('3.7') && !b.includes('3.6') && !attemptedModels.has(b.toLowerCase()) && !attemptedModels.has(b)),
      )];
    const sameFamily = allModelBases.filter(m => m.toLowerCase().includes('claude') === isClaudeRequest);
    const crossFamily = allModelBases.filter(m => m.toLowerCase().includes('claude') !== isClaudeRequest);
    // On HTTP 429 quota exhaustion, 503 capacity exhaustion, or 504 cluster timeouts, sibling models in the same family share the exact same exhausted quota pool or overloaded TPU cluster.
    // Skip same-family to avoid pointless ping-pong retry loops and cascade directly to cross-family (Gemini <-> Claude).
    const eligibleFallbacks = (lastStatus === 429 || lastStatus === 503 || lastStatus === 504) ? crossFamily : [...sameFamily, ...crossFamily];

    if (eligibleFallbacks.length > 0) {
      for (const fallbackModel of eligibleFallbacks) {
        const fbFamily = fallbackModel.toLowerCase().includes('claude') ? 'claude' : 'gemini';
        const isFb55 = fallbackModel.includes('5.5') || fallbackModel.includes('5-5');
        // Include disabled models in quota check — same reason as allModelBases above.
        const hasAnyQuotaInFamily = allCustomModels.some(
          (m) => isGoogleCloudCodeModel(m) && getModelQuotaScore(m, fbFamily) > 0,
        );
        if (!hasAnyQuotaInFamily) {
          log.info(`[Proxy] Skipping fallback model ${fallbackModel}: 0% quota available for ${fbFamily} across entire pool.`);
          continue;
        }

        let fallbackCandidates = allCustomModels.filter(
          (m) =>
            isGoogleCloudCodeModel(m) &&
            (m as any).enabled !== false &&
            (m as any).status !== 'unhealthy' &&
            !(m as any).isValidationRequired &&
            (m as any).status !== 'validation_required' &&
            !isAccountUnlicensed(m) &&
            !normalizeCloudCodeModelId(m.externalModelName || m.name).toLowerCase().includes('3.7') &&
            !normalizeCloudCodeModelId(m.externalModelName || m.name).toLowerCase().includes('3.6') &&
            normalizeCloudCodeModelId(m.externalModelName || m.name).toLowerCase() === fallbackModel.toLowerCase() &&
            (!isFb55 || isAccountEntitledToClaude55(m)) &&
            !getOpenBreaker(m) &&
            !isAccountInCooldown(m, fbFamily) &&
            getModelQuotaScore(m, fbFamily) > 0,
        );

        if (fallbackCandidates.length === 0) {
          log.info(`[Proxy] Skipping fallback model ${fallbackModel}: no available accounts in pool with positive quota for ${fbFamily}`);
          continue;
        }

        log.warn(
          `[Proxy] 🔀 [Model Fallback] Pool exhausted for [${currentBase}] across candidate accounts (${lastErrorText.slice(0, 80)}). Switching to fallback model: [${fallbackModel}]...`,
        );

        if (fallbackCandidates.length > 0) {
          const selectedFallback =
            selectBestModelByQuota(fallbackCandidates, allCustomModels, fbFamily) || fallbackCandidates[0];
          const fallbackPool = getGoogleAccountPool(selectedFallback, allCustomModels);

          reqJson.model = fallbackModel;
          if (reqJson.request && typeof reqJson.request === 'object') {
            (reqJson.request as Record<string, unknown>).model = fallbackModel;
            sanitizeCloudCodeGenerationConfig(reqJson.request as Record<string, unknown>, fallbackModel);
          }
          const fbContents = (reqJson.request as any)?.contents || reqJson.contents;
          if (Array.isArray(fbContents)) {
            const isFbClaude = fallbackModel.toLowerCase().includes('claude');
            if (isFbClaude) {
              sanitizeCloudCodeGenerationConfig((reqJson.request as Record<string, unknown>) || reqJson, fallbackModel);
            } else {
              if (lastStatus === 400) {
                // If original model failed with HTTP 400, unverified/corrupted tool calls in history
                // must be flattened to plain text so fallback Gemini does not repeat the same 400 failure
                flattenAllToolCallsToText(fbContents);
                injectAntiHallucinationInstruction((reqJson.request as Record<string, unknown>) || reqJson);
              } else {
                restoreThoughtSignatures(fbContents, convId || '', fallbackModel);
                if (sanitizeUnsignedToolCalls(fbContents)) {
                  injectAntiHallucinationInstruction((reqJson.request as Record<string, unknown>) || reqJson);
                }
              }
            }
            normalizeConversationTurns(fbContents);
          }

          const sessionKey = convId || sessId;
          const existingFallback = sessionKey ? getSessionModelFallback(sessionKey) : undefined;
          const alreadyNotified = existingFallback?.notified === true;

          const wantsFallbackNotice = process.env.AG_ENABLE_FALLBACK_NOTICE === '1';
          if (wantsFallbackNotice && isStream && !res.writableEnded && !res.destroyed && !alreadyNotified) {
            if (!res.headersSent) {
              safeWriteHead(res, 200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive',
              });
            }
            const isClaude = currentBase.toLowerCase().includes('claude');
            const fbNotice = isClaude
              ? `> 🔄 **Quota Claude atteint** — Poursuite automatique de la conversation avec **${fallbackModel}**.\n\n`
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
            const nextAttempted = new Set(attemptedModels);
            nextAttempted.add(fallbackModel.toLowerCase());
            nextAttempted.add(fallbackModel);
            const fallbackOk = await executeGoogleCloudCodeWithPool(
              req,
              res,
              reqJson,
              fallbackPool,
              isSessionRemote,
              convId,
              sessId,
              nextAttempted,
              fallbackDepth + 1,
            );
            if (fallbackOk) {
              if (sessionKey) {
                const existing = getSessionModelFallback(sessionKey);
                if (existing && normalizeCloudCodeModelId(fallbackModel).toLowerCase() === normalizeCloudCodeModelId(existing.originalModel).toLowerCase()) {
                  log.info(`[Proxy] 🟢 Session ${sessionKey} successfully recovered back to original model [${existing.originalModel}]. Clearing fallback.`);
                  clearSessionModelFallback(sessionKey);
                } else {
                  setSessionModelFallback(sessionKey, currentBase, fallbackModel, true);
                }
              }
              log.info(`[Proxy] ✅ [Model Fallback] Cross-model fallback to ${fallbackModel} SUCCEEDED! Agent saved from termination.`);
              return true;
            }
          } catch (fbErr) {
            log.warn(`[Proxy] Fallback to ${fallbackModel} failed:`, (fbErr as Error).message);
          }
        }
      }
    }
    }

    // If all Google accounts and internal Google Cloud Code fallbacks failed,
    // try configured Google AI Studio accounts first (independent quota, same Gemini family),
    // then fall through to OpenAI / Anthropic / DeepSeek / Ollama / OpenRouter / etc.
    // Note: google-gemini (AI Studio) uses a per-account API key — rotate across all configured accounts.
    const nonGoogleFallbacks = allCustomModels.filter(
      (m) =>
        (m.provider !== 'google' || !isGoogleCloudCodeModel(m)) &&
        (!m._poolOnly || m.provider === 'google-gemini') &&
        !getOpenBreaker(m) &&
        m.apiKey !== 'auto' &&
        (allowCrossModelFallback || (!isClaudeRequest && m.provider === 'google-gemini') || isPreconditionLocationError),
    );

    if (nonGoogleFallbacks.length > 0) {
      // Prioritise AI Studio accounts (google-gemini) — same model family, independent quota.
      // Rotate through all of them before falling to third-party providers.
      const aiStudioFallbacks = nonGoogleFallbacks.filter((m) => m.provider === 'google-gemini');
      const otherFallbacks = nonGoogleFallbacks.filter((m) => m.provider !== 'google-gemini');
      const orderedFallbacks = [...aiStudioFallbacks, ...otherFallbacks];

      const sessionKey = convId || sessId;
      const existingFallback = sessionKey ? getSessionModelFallback(sessionKey) : undefined;
      const alreadyNotified = existingFallback?.notified === true;
      const actualGeminiBody = (reqJson.request as GeminiRequestBody) || (reqJson as unknown as GeminiRequestBody);

      for (let fi = 0; fi < orderedFallbacks.length; fi++) {
        const fallbackModel = orderedFallbacks[fi];
        const isAiStudio = fallbackModel.provider === 'google-gemini';

        // Skip any provider whose host is currently rate-limited — avoids burning
        // through all AI Studio accounts sequentially when the host is already banned.
        if (isProviderRateLimited(fallbackModel.apiUrl)) {
          log.debug(`[Proxy] Cascade skip ${fallbackModel.displayName || fallbackModel.name}: host rate-limited`);
          continue;
        }

        log.warn(
          `[Proxy] 🔀 [Account Cascade] Cascading to ${isAiStudio ? 'Google AI Studio' : fallbackModel.provider} account [${fallbackModel.displayName || fallbackModel.name}] (${fallbackModel.provider}) [${fi + 1}/${orderedFallbacks.length}]...`,
        );

        const wantsFallbackNotice = process.env.AG_ENABLE_FALLBACK_NOTICE === '1';
        if (wantsFallbackNotice && fi === 0 && isStream && !res.writableEnded && !res.destroyed && !alreadyNotified) {
          if (!res.headersSent) {
            safeWriteHead(res, 200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
            });
          }
          const notice = isAiStudio
            ? `> 🔄 **Pool Cloud Code saturé** — Poursuite avec **Google AI Studio** (${fallbackModel.displayName || fallbackModel.name}).\n\n`
            : `> 🌐 **Pool Google saturé** — Poursuite automatique avec **${fallbackModel.displayName || fallbackModel.name}** (${fallbackModel.provider}).\n\n`;
          writeSafeSseChunk(res, {
            response: {
              candidates: [{ content: { parts: [{ text: notice }], role: 'model' }, index: 0 }],
            },
          });
        }

        try {
          handleCustomModelRequest(res, fallbackModel, actualGeminiBody, isStream);
          if (sessionKey && fi === 0) {
            setSessionModelFallback(sessionKey, currentBase, fallbackModel.displayName || fallbackModel.name, true);
          }
          return true;
        } catch (tpErr) {
          log.warn(`[Proxy] Fallback to ${fallbackModel.name} (${fallbackModel.provider}) failed: ${(tpErr as Error).message}. Trying next...`);
          if (res.writableEnded || res.destroyed) return true;
        }
      }
    }
  }

  // ── Rate Limit (429) Relief Wait & Automatic Recovery ──
  // If all candidate accounts and cross-model fallbacks failed due to 429 rate limits,
  // do NOT crash or terminate the user's ongoing conversation!
  // If an account in the pool has a short burst cooldown expiring soon (<= 65s),
  // hold the client socket alive, wait for cooldown relief, and seamlessly retry.
  if (
    lastStatus === 429 &&
    fallbackDepth === 0 &&
    process.env.AG_DISABLE_RATE_LIMIT_RELIEF !== '1' &&
    process.env.NODE_ENV !== 'test' &&
    !process.env.VITEST &&
    !res.writableEnded &&
    !res.destroyed &&
    Boolean(res.socket && !res.socket.destroyed)
  ) {
    const soonest = getSoonestAccountCooldownRemaining(accountPool, modelFamily, RATE_LIMIT_RELIEF_WAIT_MS);
    if (soonest) {
      const waitMs = soonest.remainingMs > 0 ? Math.min(soonest.remainingMs + 800, RATE_LIMIT_RELIEF_WAIT_MS) : 15_000;
      const waitSec = Math.ceil(waitMs / 1000);
      const accName =
        soonest.candidate.accountEmail ||
        soonest.candidate.accountName ||
        soonest.candidate.displayName ||
        soonest.candidate.name;
      log.warn(
        `[Proxy] ⏳ [Rate Limit Relief] All pool accounts and fallbacks in cooldown. Waiting ${waitSec}s for account [${accName}] cooldown relief to prevent conversation crash...`,
      );

      if (res.socket) res.socket.setTimeout(Math.max(120_000, waitMs + 30_000));

      await new Promise<void>((resolve) => {
        let timer: NodeJS.Timeout | null = null;
        const cleanup = () => {
          if (timer) clearTimeout(timer);
          if (typeof res?.removeListener === 'function') res.removeListener('close', onClose);
        };
        const onClose = () => {
          cleanup();
          resolve();
        };
        timer = setTimeout(() => {
          cleanup();
          resolve();
        }, waitMs);
        if (timer.unref) timer.unref();
        if (typeof res?.once === 'function') res.once('close', onClose);
      });

      if (!res.writableEnded && !res.destroyed && Boolean(res.socket && !res.socket.destroyed)) {
        log.info(`[Proxy] 🟢 [Rate Limit Relief] Cooldown expired! Retrying request on recovered Google pool...`);
        // Restore original target model in reqJson if fallback attempts modified it
        if (targetRaw) {
          reqJson.model = targetRaw;
          if (typeof reqJson.requestedModel === 'string') {
            reqJson.requestedModel = targetRaw;
          }
          if (reqJson.request && typeof reqJson.request === 'object') {
            (reqJson.request as Record<string, unknown>).model = targetRaw;
            if (typeof (reqJson.request as any).requestedModel === 'string') {
              (reqJson.request as any).requestedModel = targetRaw;
            }
          }
        }
        const retryOk = await executeGoogleCloudCodeWithPool(
          req,
          res,
          reqJson,
          accountPool,
          isSessionRemote,
          convId,
          sessId,
          new Set(),
          fallbackDepth + 1,
        );
        if (retryOk) {
          log.info(`[Proxy] ✅ [Rate Limit Relief] Request SUCCEEDED after rate limit cooldown relief! Agent saved from crash.`);
          return true;
        }
      }
    }
  }

  // If this request is an explicit background summarization task and all accounts/relief failed:
  // Return a synthetic summary SSE stream so the background summarization hook never crashes the IDE.
  // Note: Only triggered on explicit background SUMMARY requestTypes, never on regular user chat turns!
  const reqType = String(reqJson.requestType || (reqJson.request as any)?.requestType || '').toUpperCase();
  const isExplicitSummary = reqType === 'SUMMARY' || reqType === 'CONVERSATION_SUMMARY';

  if (isExplicitSummary && !res.writableEnded && !res.destroyed) {
    log.warn('[Proxy] Context summarization hook failed upstream after pool exhaustion. Returning synthetic summary to prevent agent termination.');
    const isStream = req.url!.includes('streamGenerateContent') || req.url!.includes('alt=sse');
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
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 30, totalTokenCount: 130 },
      },
      candidates: [summaryCand],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 30, totalTokenCount: 130 },
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

  log.error(`[Proxy] Google Cloud Code pool exhausted (${testedAccountsCount}/${totalAttempts} tested). Returning HTTP ${lastStatus}`);
  if (!res.writableEnded && !res.destroyed) {
    const isStream = req.url!.includes('streamGenerateContent') || req.url!.includes('alt=sse');
    const requestedName = (typeof reqJson.requestedModel === 'string' && reqJson.requestedModel)
      ? reqJson.requestedModel
      : (typeof reqJson.model === 'string' ? reqJson.model : '');
    const failedModel: CustomModel = {
      ...(sortedAccounts[0] || {}),
      name: requestedName || sortedAccounts[0]?.name || 'gemini-3.8-flash-tiered',
      displayName: requestedName || sortedAccounts[0]?.displayName || 'Gemini 3.8 Flash',
      provider: 'google',
    } as CustomModel;
    const diagnostic = classifyError(lastStatus, lastErrorText, undefined, 'google');
    if (totalAttempts > 1) {
      const countLabel = testedAccountsCount > 0 && testedAccountsCount < totalAttempts
        ? `${testedAccountsCount}/${totalAttempts}`
        : `${totalAttempts}/${totalAttempts}`;
      diagnostic.title = `${diagnostic.title} (${countLabel} comptes vérifiés)`;
      diagnostic.message = testedAccountsCount < totalAttempts && lastStatus === 504
        ? `Le service Google Cloud Code a expiré sur ${testedAccountsCount} comptes consécutifs (coupure amont détectée). Les ${totalAttempts - testedAccountsCount} comptes restants ont été préservés sans être bloqués.`
        : `L'ensemble des ${totalAttempts} comptes configurés ont été testés automatiquement en arrière-plan, mais aucun n'est actuellement disponible (${diagnostic.errorType}).`;
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
  const streamStartTime = Date.now();
  let streamPromptTokens = 0;
  let streamCompletionTokens = 0;
  let streamTotalTokens = 0;
  let streamCachedTokens = 0;
  let streamOutputChars = 0;

  // Check for API errors BEFORE writing streaming headers
  if (apiRes.statusCode! >= 400) {
    let errorBody = '';
    apiRes.on('data', (chunk: Buffer) => errorBody += chunk.toString());
    apiRes.on('end', () => {
      const accountLabel = model.accountEmail || model.accountName || model.displayName || model.name;
      log.error(`[Proxy] ⚠️ [Feedback] Model: [${model.name}] | Account: [${accountLabel}] -> HTTP ${apiRes.statusCode}: ${errorBody.substring(0, 150)}`);
      const streamDiagnostic = classifyError(apiRes.statusCode!, null, errorBody, model.provider);
      emitProxyError(buildProxyErrorPayload(traceId, apiRes.statusCode!, errorBody, model.provider));

      // Trip the breaker on the first hard failure so subsequent
      // requests short-circuit instead of piling up against a stuck upstream.
      if (
        streamDiagnostic.errorType === 'server' ||
        streamDiagnostic.errorType === 'rate_limit' ||
        streamDiagnostic.errorType === 'timeout' ||
        streamDiagnostic.errorType === 'network' ||
        streamDiagnostic.errorType === 'billing'
      ) {
        recordModelFailure(model, streamDiagnostic.errorType === 'billing' ? 'rate_limit' : streamDiagnostic.errorType);
        if (streamDiagnostic.errorType === 'rate_limit' || streamDiagnostic.errorType === 'billing') {
          markProviderRateLimited(model.apiUrl);
        }
      }

      const isNonRetryable = streamDiagnostic.errorType === 'billing' || streamDiagnostic.retryable === false;
      if (!isNonRetryable && shouldRetryStatus(apiRes.statusCode!, ctx.retryCount, ctx.maxRetries)) {
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
    const accountLabel = model.accountEmail || model.accountName || model.displayName || model.name;
    log.info(`[Proxy] ✅ [Feedback] Model: [${model.name}] | Account: [${accountLabel}] -> HTTP 200 OK (stream started)`);
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
    if (res?.socket && typeof res.socket.setNoDelay === 'function') {
      try { res.socket.setNoDelay(true); } catch (_) {}
    }
  }

  // Phase 2: Per-chunk idle timeout guard. Vendor pattern from
  // `withIdleTimeout`'s stream wrapper. If no SSE chunk arrives for
  // STREAM_IDLE_TIMEOUT_MS, treat the upstream as stuck and abort.
  const isExtendedThinkingCustom = /thinking|opus|thought/i.test(model?.name || '');
  const effectiveIdleTimeoutMsCustom = isExtendedThinkingCustom
    ? Math.max(STREAM_IDLE_TIMEOUT_MS, 180_000)
    : STREAM_IDLE_TIMEOUT_MS;

  const idleGuard = new IdleTimeoutGuard(apiRes, {
    idleTimeoutMs: effectiveIdleTimeoutMsCustom,
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

  // 3s periodic SSE keepalive heartbeat (inspired by Antigravity-Manager stream lifecycle)
  // Keeps downstream connections alive during long thinking pauses (e.g. Claude 3.7 Thinking, DeepSeek R1).
  const HEARTBEAT_INTERVAL_MS = 3000;
  let lastChunkTime = Date.now();
  const heartbeatTimer = setInterval(() => {
    if (res.writableEnded || res.destroyed) {
      clearInterval(heartbeatTimer);
      return;
    }
    if (Date.now() - lastChunkTime >= HEARTBEAT_INTERVAL_MS) {
      try {
        res.write(': ping\n\n');
        if (typeof (res as any).flush === 'function') {
          try { (res as any).flush(); } catch (_) {}
        }
      } catch {
        clearInterval(heartbeatTimer);
      }
    }
  }, HEARTBEAT_INTERVAL_MS);

  if (typeof (heartbeatTimer as any)?.unref === 'function') {
    (heartbeatTimer as any).unref();
  }

  const cleanupHeartbeat = () => {
    clearInterval(heartbeatTimer);
  };
  const onClientDisconnect = () => {
    cleanupHeartbeat();
    try { idleGuard.dispose(); } catch (_) {}
    try { request.destroy(); } catch (_) {}
    try { apiRes.destroy(); } catch (_) {}
  };
  res.on('close', onClientDisconnect);
  res.on('finish', cleanupHeartbeat);
  apiRes.on('close', cleanupHeartbeat);

  let streamHasThought = false;
  let streamHasTextOrToolCall = false;

  let buffer = '';
  apiRes.on('data', (chunk: Buffer) => {
    lastChunkTime = Date.now();
    // Observe first, then forward. The guard splits SSE frames on
    // newlines so a frame that spans two chunks is still counted.
    emptyGuard.observe(chunk);
    buffer += chunk.toString('utf-8');
    let lineEndIdx: number;
    while ((lineEndIdx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, lineEndIdx);
      buffer = buffer.slice(lineEndIdx + 1);
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('data: ')) {
        const dataStr = trimmed.substring(6).trim();
        if (dataStr === '[DONE]') continue;
        try {
          let parsed = JSON.parse(dataStr);
          if (parsed && typeof parsed === 'object') {
            if (parsed.usage && typeof parsed.usage === 'object') {
              if (typeof parsed.usage.prompt_tokens === 'number') streamPromptTokens = parsed.usage.prompt_tokens;
              if (typeof parsed.usage.completion_tokens === 'number') streamCompletionTokens = parsed.usage.completion_tokens;
              if (typeof parsed.usage.total_tokens === 'number') streamTotalTokens = parsed.usage.total_tokens;
            }
            if (parsed.usageMetadata && typeof parsed.usageMetadata === 'object') {
              if (typeof parsed.usageMetadata.promptTokenCount === 'number') streamPromptTokens = parsed.usageMetadata.promptTokenCount;
              if (typeof parsed.usageMetadata.candidatesTokenCount === 'number') streamCompletionTokens = parsed.usageMetadata.candidatesTokenCount;
              if (typeof parsed.usageMetadata.totalTokenCount === 'number') streamTotalTokens = parsed.usageMetadata.totalTokenCount;
              if (typeof parsed.usageMetadata.cachedContentTokenCount === 'number') streamCachedTokens = parsed.usageMetadata.cachedContentTokenCount;
            }
          }
          const mapped = registry.translateStreamChunk(provider, parsed, model.name);

          if (mapped) {
            const candidateParts = (mapped as any).content?.parts;
            if (Array.isArray(candidateParts)) {
              for (const p of candidateParts) {
                if (p && (p.thought || p.type === 'thinking' || (p as any).thoughtSignature)) {
                  streamHasThought = true;
                }
                if (p && typeof p.text === 'string' && p.text.trim().length > 0 && !p.thought) {
                  streamHasTextOrToolCall = true;
                  streamOutputChars += p.text.length;
                }
                if (p && (p.functionCall || p.function_call)) {
                  streamHasTextOrToolCall = true;
                }
              }
            }
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
    cleanupHeartbeat();
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
    const drainTrimmed = buffer.trim();
    if (drainTrimmed.startsWith('data: ')) {
      const dataStr = drainTrimmed.startsWith('data: ') ? drainTrimmed.substring(6).trim() : drainTrimmed;
      if (dataStr !== '[DONE]') {
        try {
          let parsed = JSON.parse(dataStr);

          const mapped = parsed === null ? null : registry.translateStreamChunk(provider, parsed, model.name);
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


    // Thinking Dropout Auto-Healing (inspired by Antigravity-Manager auto_heal.rs):
    // When a model finishes thinking but emits STOP with zero text and zero tool calls,
    // inject a fallback non-empty content part so the Language Server state machine progresses smoothly.
    if (streamHasThought && !streamHasTextOrToolCall) {
      log.warn(`[Proxy] ⚠️ [Auto-Heal] Thinking dropout detected for ${model.name}: model emitted thinking but zero content/toolCall. Injecting auto-heal text frame.`);
      const healChunk = {
        response: {
          candidates: [
            {
              content: { parts: [{ text: ' ' }], role: 'model' },
              finishReason: 'STOP',
              index: 0,
            },
          ],
        },
        traceId: '',
        metadata: {},
      };
      sanitizeCandidatesInResponse(healChunk);
      writeSafeSseChunk(res, healChunk);
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
    const accountLabel = model.accountEmail || model.accountName || model.displayName || model.name;
    log.info(`[Proxy] ✅ [Feedback] Model: [${model.name}] | Account: [${accountLabel}] -> Stream completed successfully`);
    const pId = model.name.includes('-') ? model.name.split('-')[0] : model.provider;
    void recordProviderUsage(pId);

    const latencyMs = Math.max(1, Date.now() - streamStartTime);
    if (streamTotalTokens === 0 && streamCompletionTokens === 0 && streamOutputChars > 0) {
      streamCompletionTokens = Math.max(1, Math.round(streamOutputChars / 4));
      streamTotalTokens = streamPromptTokens + streamCompletionTokens;
    }
    logTokenUsageEvent({
      id: `req-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      timestamp: Date.now(),
      conversationId: (ctx.geminiBody as any)?.conversationId || (ctx.geminiBody as any)?.sessionId || undefined,
      provider: model.provider,
      model: model.displayName || model.name,
      promptTokens: streamPromptTokens,
      completionTokens: streamCompletionTokens,
      totalTokens: streamTotalTokens || (streamPromptTokens + streamCompletionTokens),
      cachedTokens: streamCachedTokens,
      latencyMs,
      status: apiRes.statusCode || 200,
      endpoint: '/v1internal:streamGenerateContent',
    });
  });
}

/** Non-stream response branch — JSON translate, retry on error status, graceful envelope. */
function handleNonStreamResponse(apiRes: http.IncomingMessage, ctx: StreamRequestCtx): void {
  const { model, res, provider, traceId } = ctx;
  const nonStreamStartTime = Date.now();
  let body = '';
  apiRes.on('data', (chunk: Buffer) => (body += chunk));
  apiRes.on('end', () => {
    const accountLabel = model.accountEmail || model.accountName || model.displayName || model.name;
    if (apiRes.statusCode! >= 400) {
      const diagnostic = classifyError(apiRes.statusCode!, null, body, model.provider);
      log.error(`[Proxy] ⚠️ [Feedback] Model: [${model.name}] | Account: [${accountLabel}] -> HTTP ${apiRes.statusCode} (${diagnostic.title}: ${diagnostic.message})`);
      emitProxyError(buildProxyErrorPayload(traceId, apiRes.statusCode!, body, model.provider));

      // Trip the breaker on hard failures so subsequent requests
      // short-circuit instead of piling up against a stuck upstream.
      if (
        diagnostic.errorType === 'server' ||
        diagnostic.errorType === 'rate_limit' ||
        diagnostic.errorType === 'timeout' ||
        diagnostic.errorType === 'network' ||
        diagnostic.errorType === 'billing'
      ) {
        recordModelFailure(model, diagnostic.errorType === 'billing' ? 'rate_limit' : diagnostic.errorType);
        if (diagnostic.errorType === 'rate_limit' || diagnostic.errorType === 'billing') {
          markProviderRateLimited(model.apiUrl);
        }
      }

      // Retry if eligible based on status code and NOT a permanent billing/quota failure
      if (diagnostic.errorType !== 'billing' && shouldRetryStatus(apiRes.statusCode!, ctx.retryCount, ctx.maxRetries)) {
        const retryAfterMs = parseRetryAfter(apiRes.headers);
        const delay = computeRetryDelay('rate-limit', ctx.retryCount, retryAfterMs);
        ctx.retry(ctx.retryCount, delay, `Upstream error status ${apiRes.statusCode}`);
        return;
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
      const accountLabel = model.accountEmail || model.accountName || model.displayName || model.name;
      log.info(`[Proxy] ✅ [Feedback] Model: [${model.name}] | Account: [${accountLabel}] -> HTTP 200 OK`);
      // P5-2: feed the per-model retry budget a success sample so the
      // model's trust score recovers after a hard stretch of failures.
      getRetryBudget().recordSuccess(model);

      if (safeWriteHead(res, 200, { 'Content-Type': 'application/json' })) {
        safeEnd(res, JSON.stringify(cloudCodeResponse));
      }

      const usage = (mapped as any)?.usageMetadata;
      const pTokens = usage?.promptTokenCount || 0;
      const cTokens = usage?.candidatesTokenCount || 0;
      const tTokens = usage?.totalTokenCount || (pTokens + cTokens);
      logTokenUsageEvent({
        id: `req-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
        timestamp: Date.now(),
        conversationId: (ctx.geminiBody as any)?.conversationId || (ctx.geminiBody as any)?.sessionId || undefined,
        provider: model.provider,
        model: model.displayName || model.name,
        promptTokens: pTokens,
        completionTokens: cTokens,
        totalTokens: tTokens,
        cachedTokens: usage?.cachedContentTokenCount || 0,
        latencyMs: Math.max(1, Date.now() - nonStreamStartTime),
        status: 200,
        endpoint: '/v1internal:generateContent',
      });
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

// ─── Google Account Pool (re-exported from src/proxy/googlePool.ts) ────────────
export {
  registerAccountRefreshToken,
  getAccountQuotaKey,
  isAccountUnlicensed,
  markAccountUnlicensed,
  unmarkAccountUnlicensed,
  probeGoogleAccountPreflight,
  probeAllGoogleAccountsPreflight,
  startPreflightHealthCheckInterval,
  stopPreflightHealthCheckInterval,
  getUnlicensedAccountKeys,
  restoreUnlicensedAccountKeys,
  markAccountQuotaExhausted,
  _resetUnlicensedAccounts,
  isAccountInProbation,
  endAccountProbation,
  _resetAccountProbation,
  isAccountInCooldown,
  setAccountCooldown,
  getAccountCooldownRemaining,
  getSoonestAccountCooldownRemaining,
  clearAccountCooldown,
  getActiveAccountCooldowns,
  restoreActiveAccountCooldowns,
  verifyAndReconcileCooldowns,
  _resetAllAccountCooldowns,
  autoHealAccountOnQuotaRecovery,
  getAccountInFlight,
  MAX_CONCURRENT_PER_ACCOUNT,
  notifySlotAvailable,
  _clearSlotWaitersForTests,
  waitForAccountSlot,
  incrementAccountInFlight,
  decrementAccountInFlight,
  _resetAccountInFlight,
  recordAccountRequest,
  getAccountLastUsed,
  getAccountRpmCount,
  _resetAccountRpm,
  getModelQuotaScore,
  EWMA_DECAY_THRESHOLD_MS,
  recordAccountLatency,
  getAccountAvgLatency,
  _resetAccountLatencies,
  isPoolUnderQuotaStress,
  resolveGoogleProjectId,
  getAccountDynamicScore,
  classifyGoogleCloudCode429,
  selectCandidateP2C,
  selectBestModelByQuota,
  getGoogleAccountPool,
  recordAccountBurst,
  clearAccountBurst,
  liftBurstCooldowns,
  _resetAccountBurst,
  isAccountNearExhaustion,
  PREVENTIVE_QUOTA_THRESHOLD_PCT,
  PREVENTIVE_COOLDOWN_MS,
} from './proxy/googlePool';
export type { Google429Category, Google429Decision } from './proxy/googlePool';


import {
  extractSessionId,
  SESSION_AFFINITY_TTL_MS,
  SESSION_MODEL_FALLBACK_TTL_MS,
  NATIVE_SESSION_TTL_MS,
  NATIVE_CASCADE_BLOCK_WINDOW_MS,
  SessionEffortEntry,
  setSessionEffortAffinity,
  getSessionEffortAffinity,
  clearSessionEffortAffinity,
  clearAllSessionEffortAffinities,
  SessionModelFallback,
  getSessionModelFallback,
  clearSessionModelFallback,
  setSessionModelFallback,
  clearSessionModelFallbacks,
  getActiveSessionModelFallbacks,
  getSessionBoundModel,
  bindSessionToModel,
  clearSessionAffinities,
  sessionAffinities,
  sessionModelFallbacks,
  sessionEffortAffinities,
  NativeSessionRecord,
  markNativeSession,
  getNativeSession,
  recordLatestNativeError,
  updateLatestNativeErrorBody,
  getLatestNativeErrorAsSession,
  recordNativeSessionError,
  clearNativeSessions,
  nativeSessions,
  latestNativeGlobalError,
  clearLatestNativeGlobalError,
} from './proxy/sessionAffinities';

export {
  extractSessionId,
  SESSION_AFFINITY_TTL_MS,
  SESSION_MODEL_FALLBACK_TTL_MS,
  NATIVE_SESSION_TTL_MS,
  NATIVE_CASCADE_BLOCK_WINDOW_MS,
  SessionEffortEntry,
  setSessionEffortAffinity,
  getSessionEffortAffinity,
  clearSessionEffortAffinity,
  clearAllSessionEffortAffinities,
  SessionModelFallback,
  getSessionModelFallback,
  clearSessionModelFallback,
  setSessionModelFallback,
  clearSessionModelFallbacks,
  getActiveSessionModelFallbacks,
  getSessionBoundModel,
  bindSessionToModel,
  clearSessionAffinities,
  sessionAffinities,
  sessionModelFallbacks,
  sessionEffortAffinities,
  NativeSessionRecord,
  markNativeSession,
  getNativeSession,
  recordLatestNativeError,
  updateLatestNativeErrorBody,
  getLatestNativeErrorAsSession,
  recordNativeSessionError,
  clearNativeSessions,
  nativeSessions,
};


function handleCustomModelRequest(
  res: http.ServerResponse,
  model: CustomModel,
  rawGeminiBody: GeminiRequestBody,
  isStream: boolean,
  retryCount = 0,
  fallbackDepth = 0,
): void {

  // Virtual auto-pool entries have no API key and must be dispatched via executeGoogleCloudCodeWithPool
  if (model.name?.includes(':auto-pool') || model.apiKey === 'auto' || !model.apiKey || model.apiKey === 'none') {
    if (isGoogleCloudCodeModel(model) || model.name?.includes(':auto-pool') || model.apiKey === 'auto') {
      const allCustomModels = expandModelsWithEffort(loadCustomModels());
      const accountPool = getGoogleAccountPool(model, allCustomModels);
      const targetModel = normalizeCloudCodeModelId(model.externalModelName || model.name);
      sanitizeCloudCodeGenerationConfig(rawGeminiBody as Record<string, unknown>, targetModel);
      const cloudCodePayload = {
        project: (model as { projectId?: string }).projectId || process.env.AG_CLOUD_CODE_PROJECT_ID || 'bamboo-precept-lgxtn',
        model: targetModel,
        request: rawGeminiBody,
      };
      const fakeReq = {
        url: isStream ? '/v1internal:streamGenerateContent?alt=sse' : '/v1internal:generateContent',
        method: 'POST',
        headers: {},
      } as unknown as http.IncomingMessage;
      void executeGoogleCloudCodeWithPool(fakeReq, res, cloudCodePayload, accountPool, false, '', null);
      return;
    }
    log.error(`[Proxy] Cannot route virtual auto-pool or keyless model ${model.name} to translator without valid API key.`);
    if (!res.headersSent && !res.writableEnded) {
      safeWriteHead(res, 503, { 'Content-Type': 'application/json' });
      safeEnd(res, JSON.stringify({ error: { message: 'All Google Cloud Code accounts in pool are in cooldown and no valid API key is available.' } }));
    }
    return;
  }

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
      const targetNorm = normalizeCloudCodeModelId(targetBase);

      // Sibling accounts in the pool offering the exact same model, sorted by remaining quota score.
      // ponytail: match both raw base model ID and canonical Cloud Code model ID (e.g. gemini-3.8-flash == gemini-3.8-flash-tiered)
      // so if a direct Google AI Studio key fails with 429/503, the proxy falls back immediately to Cloud Code accounts
      // for the SAME Gemini model instead of needlessly jumping to Claude.
      const poolSiblings = allModels
        .filter((m) => {
          if (m.name === model.name) return false;
          if (m.name?.includes(':auto-pool') || m.apiKey === 'auto' || !m.apiKey || m.apiKey === 'none') return false;
          const mBase = getBaseModelId(m.externalModelName || m.name);
          const mNorm = normalizeCloudCodeModelId(mBase);
          const isSameModel = mBase === targetBase || (targetNorm && mNorm === targetNorm);
          return isSameModel && getAccountQuotaKey(m) !== currentAccountKey && !getOpenBreaker(m);
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
      } else if (model.provider === 'google' && !isGoogleCloudCodeModel(model)) {
        // Intelligent default fallback cascade for Google AI Studio models (e.g. 503 high demand or 429)
        const norm = (model.externalModelName || model.name || '').toLowerCase();
        if (norm.includes('gemini-3.8-flash')) {
          chainItems.push('gemini-3.8-pro');
        }
      }

      const allowCrossModel = process.env.AG_ENABLE_CROSS_MODEL_FALLBACK === '1';
      if (allowCrossModel && (poolSiblings.length > 0 || chainItems.length > 0)) {
        const chainModels: CustomModel[] = [];
        for (const item of chainItems) {
          const matches = allModels.filter(
            (m) =>
              !chainModels.includes(m) &&
              !poolSiblings.includes(m) &&
              !m.name?.includes(':auto-pool') &&
              m.apiKey !== 'auto' &&
              m.apiKey !== 'none' &&
              Boolean(m.apiKey) &&
              (m.name === item ||
                m.displayName === item ||
                m.externalModelName === item ||
                m.name.endsWith(`/${item}`) ||
                getBaseModelId(m.externalModelName || m.name) === getBaseModelId(item))
          );
          chainModels.push(...matches);
        }
        const rest = allModels.filter((m) => !poolSiblings.includes(m) && !chainModels.includes(m) && !m.name?.includes(':auto-pool') && m.apiKey !== 'auto');
        orderedModels = [...poolSiblings, ...chainModels, ...rest];
      } else {
        // Strict model locking: only rotate among accounts offering the exact same model!
        orderedModels = poolSiblings;
      }

      // ponytail: skip same account on rate_limit if it's the exact same base model (shared quota).
      // On billing/credit exhaustion, skip the ENTIRE account regardless of model tier.
      const isBillingOrRateLimit = diagnostic.errorType === 'rate_limit' || diagnostic.errorType === 'billing';
      const failedAccountKey = isBillingOrRateLimit ? getAccountQuotaKey(model) : null;
      for (const m of orderedModels) {
        if (
          m.name !== model.name &&
          !m.name?.includes(':auto-pool') &&
          m.apiKey &&
          m.apiKey !== 'auto' &&
          m.apiKey !== 'none' &&
          !m.apiKey.startsWith('fallback:')
        ) {
          if (
            failedAccountKey &&
            getAccountQuotaKey(m) === failedAccountKey &&
            (diagnostic.errorType === 'billing' || getBaseModelId(m.name) === targetBase)
          ) {
            log.warn(`[Proxy] Auto-fallback: skipping ${m.displayName || m.name} (same account credentials, ${diagnostic.errorType === 'billing' ? 'billing/credits exhausted' : 'shared quota on ' + targetBase})`);
            continue;
          }
          const mFamily = (m.externalModelName || m.name || '').toLowerCase().includes('claude') ? 'claude' : 'gemini';
          if (
            isAccountInCooldown(m, mFamily) ||
            getOpenBreaker(m) ||
            (isGoogleCloudCodeModel(m) && getModelQuotaScore(m, mFamily) <= 0) ||
            isProviderRateLimited(m.apiUrl)
          ) {
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
          const wantsFallbackNotice = process.env.AG_ENABLE_FALLBACK_NOTICE === '1';
          if (wantsFallbackNotice && isStream && !res.headersSent && !alreadyNotified) {
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

  const accountLabel = model.accountEmail || model.accountName || model.displayName || model.name;
  log.info(
    `[Proxy] ➡️ [Request] Model: [${cleanModelName || model.name}] | Account/Provider: [${accountLabel}] (${model.provider}) (stream: ${!!isStream})${retryCount > 0 ? ` (retry ${retryCount})` : ''}`,
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
  request.on('socket', (socket) => {
    try {
      if (typeof socket.setNoDelay === 'function') socket.setNoDelay(true);
    } catch (_) {}
  });

  request.on('error', (err) => handleRequestError(err, ctx));
  request.write(JSON.stringify(payload));
  request.end();
}

// ─── Main Request Handler ─────────────────────────────────────────────────

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
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
    return;
  }

  // Health check — keep this FIRST so the LS sees a live port even if other
  // initialization (padding strip, model loading, etc.) is delayed or fails.
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
    return;
  }

  if (handleInternalApiRoute(req, res)) {
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
  req.url = req.url!.replace(/\/v1internal\/x+/, '');

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

    const isRoutineNoise =
      req.url?.includes('Heartbeat') ||
      req.url?.includes('GetUserStatus') ||
      req.url?.includes('listExperiments') ||
      req.url?.includes('loadCodeAssist') ||
      req.url?.includes('recordTrajectoryAnalytics') ||
      req.url?.includes('writeTrajectoryAcls') ||
      req.url?.includes('retrieveUserQuotaSummary') ||
      req.url?.includes('fetchAvailableModels') ||
      req.url?.includes('fetchAdminControls') ||
      req.url?.includes('buildWithGooglePlugins') ||
      req.url?.includes('cascadeNuxes') ||
      req.url?.includes('fetchUserInfo') ||
      req.url === '/health';
    if (isRoutineNoise) {
      log.debug(`[Proxy] Request: ${req.method} ${req.url}`);
    } else {
      log.info(`[Proxy] Request: ${req.method} ${req.url}`);
    }

    // Zero latency: Short-circuit DeepMind / Trajectory telemetry and analytics reporting
    if (
      req.url?.includes('recordTrajectoryAnalytics') ||
      req.url?.includes('writeTrajectoryAcls') ||
      req.url?.includes('analytics')
    ) {
      if (safeWriteHead(res, 200, { 'Content-Type': 'application/json' })) {
        safeEnd(res, JSON.stringify({ ok: true, status: 'RECORDED_NOOP' }));
      }
      return;
    }

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

    // Fast-Ack for Language Server telemetry & shadow eval RPCs
    if (process.env.AG_FAST_ACK_TELEMETRY !== '0' && isTelemetryRpcUrl(req.url)) {
      log.debug(`[Proxy] Fast-Ack telemetry RPC intercepted: ${req.url}`);
      const isJson = !req.headers['content-type'] || req.headers['content-type'].includes('application/json');
      if (isJson) {
        if (safeWriteHead(res, 200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        })) {
          safeEnd(res, '{}');
        }
      } else {
        if (safeWriteHead(res, 200, {
          'Content-Type': req.headers['content-type'] || 'application/connect+proto',
          'Access-Control-Allow-Origin': '*',
          'grpc-status': '0',
        })) {
          safeEnd(res, Buffer.from([0, 0, 0, 0, 0]));
        }
      }
      return;
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

    // 0.5. Intercept /v1internal:listExperiments with caching, enrichment, and fallback
    if (req.url!.includes('/v1internal:listExperiments')) {
      log.debug('[Proxy] Intercepting listExperiments request');

      const buildDefaultExperimentsFallback = () => {
        const flags = [
          { name: 'shadow-call-aicode-mendel', boolValue: false },
          { name: 'mendel_aicode_shadow_diff', boolValue: false },
          { name: 'enable-battle-mode-auto-trigger', boolValue: false },
          { name: 'supercomplete-fast-debounce', boolValue: true },
          { name: 'command-prompt-cache-config', stringValue: '{"enabled": true, "ttl_seconds": 3600}' },
          { name: 'context-force-local-context', boolValue: true },
          { name: 'use-special-edit-code-block', boolValue: true },
          { name: 'use-slash-plan', boolValue: true },
          { name: 'customization-token-budget', intValue: 20000 },
          { name: 'rules-token-budget', intValue: 20000 },
          { name: 'enable-subagent-hub', boolValue: true },
          { name: 'enable-skill-search-tool', boolValue: true },
          { name: 'enable-owl-slash-command', boolValue: true },
          { name: 'enable-browser-subagent-v2', boolValue: true },
          { name: 'enable-customization-load-error-notice', boolValue: true },
          { name: 'send-subagent-initial-prompt-as-message', boolValue: true },
          { name: 'enable-battle-mode-custom-agents', boolValue: true },
          { name: 'enable-command-assessor', boolValue: true },
          { name: 'enable-daemon-commands', boolValue: true },
          { name: 'enable-hook-status', boolValue: true },
          { name: 'enable-mcp-non-blocking-turn-load', boolValue: true },
          { name: 'enable-model-capacity-exhausted-retries', boolValue: true },
          { name: 'enable-persistent-terminals', boolValue: true },
          { name: 'enable-pty', boolValue: true },
          { name: 'enable-sidecars', boolValue: true },
          { name: 'enable-ui-sidecars', boolValue: true },
          { name: 'deprecate-workflows', boolValue: true },
          { name: 'use-core-direct', boolValue: true },
          { name: 'tool-output-max-bytes', intValue: 46080 },
          { name: 'max-tokens-per-step', intValue: 16384 },
          { name: 'show-model-selection-change', boolValue: true },
          { name: 'scheduled-tasks-v2', boolValue: true },
          { name: 'enable-tasks', boolValue: true },
          { name: 'enable-conversation-search-v2', boolValue: true },
          { name: 'enable-background-task-accumulator', boolValue: true },
          { name: 'enable-aux-pane-redesign', boolValue: true },
          { name: 'enable-split-view', boolValue: true },
          // Antigravity 2.25+ Features
          { name: 'enable-permissions-selector', boolValue: true },
          { name: 'jetski-unified-customizations-panel-enabled', boolValue: true },
          { name: 'enable-plugin-sidebar-section', boolValue: true },
          { name: 'enable-plugins', boolValue: true },
          { name: 'enable-auto-permission-preset', boolValue: true },
          { name: 'permission-v2', boolValue: true },
          { name: 'enable-audio-transcription', boolValue: true },
          { name: 'enable-voice-relay', boolValue: true },
          { name: 'enable-marketplace-search-tool', boolValue: true },
          { name: 'google-workspace-mentions', boolValue: true },
          { name: 'enable-customization-skills', boolValue: true },
          { name: 'enable-developer-mode', boolValue: true },
          { name: 'enable-trajectory-debug-tools', boolValue: true },
          { name: 'enable-conversation-forking', boolValue: true },
          { name: 'enable-fork-at-historical-step', boolValue: true },
          { name: 'enable-fork-in-new-worktree', boolValue: true },
          { name: 'enable-conversation-selection-quoting', boolValue: true },
          { name: 'enable-resume-conversations-from-restart', boolValue: true },
          { name: 'enable-thought-editing', boolValue: true },
          { name: 'enable-thought-steering-from-selection', boolValue: true },
          { name: 'enable-input-autocomplete', boolValue: true },
          { name: 'enable-input-draft-persistence', boolValue: true },
          { name: 'context-window-selector', boolValue: true },
          { name: 'show-all-models-in-gemini-app', boolValue: true },
          { name: 'enable-battle-mode', boolValue: true },
          { name: 'enable-battle-contrib-variants', boolValue: true },
          { name: 'jetski-autonomous-mode', boolValue: true },
          { name: 'labs-autonomous-mode', boolValue: true },
          { name: 'enable-agent-team', boolValue: true },
          { name: 'enable-swarm-monitor', boolValue: true },
          { name: 'enable-critique-preview', boolValue: true },
          { name: 'enable-sidebar-unread-dot', boolValue: true },
          { name: 'enable-file-explorer-tab', boolValue: true },
          { name: 'enable-code-search-palette', boolValue: true },
          { name: 'enable-git-vcs-ui', boolValue: true },
          { name: 'enable-jj-vcs-ui', boolValue: true },
          { name: 'enable-file-viewer-keyboard-navigation', boolValue: true },
          { name: 'markdown-table-v2', boolValue: true },
          { name: 'enable-pdf-viewer', boolValue: true },
          { name: 'enable-notebook-rendering', boolValue: true },
          { name: 'enable-upload-html-artifact-to-drive', boolValue: true },
          { name: 'enable-hub-builtin-browser', boolValue: true },
      { name: 'enable-browser-subagent-webview-ux', boolValue: true },
          { name: 'enable-jetbox-terminal-v2', boolValue: true },
          { name: 'remote-control-setting-enabled', boolValue: true },
          { name: 'enable-remote-control-audio-transcription', boolValue: true },
          { name: 'enable-plugin-context-providers', boolValue: true },
          { name: 'enable-mcp-plugin-auth', boolValue: true },
          { name: 'enable-mcp-non-blocking-turn-load', boolValue: true },
          { name: 'enable-remote-ai', boolValue: true },
          { name: 'enable-conversation-sharing-prototype', boolValue: true },
          { name: 'enable-terminal-setup-script', boolValue: true },
          { name: 'enable-context-menu-system', boolValue: true },
          { name: 'configure-artifact-width', boolValue: true },
          { name: 'enable-sidecar-pill-auto-open', boolValue: true },
          { name: 'enable-notifications-settings', boolValue: true },
          { name: 'enable-plugin-auth', boolValue: true },
          { name: 'enable-text-transitions', boolValue: true },
          { name: 'enable-catch-file-viewer', boolValue: true },
          { name: 'enable-project-4k', boolValue: false },
          { name: 'project-4k', boolValue: false },
          { name: 'enable-workspace-scoped-jetski-extension', boolValue: true },
          { name: 'auto-command-config', stringValue: '{"system_allowlist": [], "sandbox_system_allowlist": ["head", "tail", "mkdir", "cd", "cp", "mv", "cat", "find", "grep", "rm", "touch", "less", "clear", "ls"]}' },
          { name: 'cascade-conversation-history-config', stringValue: '{"enabled": true, "max_conversations": 20}' },
          { name: 'invoke-subagent-config', stringValue: '{"enabled": true, "always_inherit_model": false}' },
          { name: 'log-artifacts-config', stringValue: '{"enabled": true, "hideNominalToolSteps": false, "hidePlannerResponseText": false, "maxBytesPerStep": 4096, "maxBytesPerToolArg": 2048, "hideSystemSteps": false, "hideUserImplicitSteps": false}' },
        ];
        return JSON.stringify({
          experimentIds: ['antigravity-2.21-full', 'plan-enabled', 'customizations-unlocked', 'automations-enabled'],
          flags,
        });
      };

      const enrichExperiments = enrichExperimentsPayload;

      // If we have a fresh cache (< 3 minutes), serve it immediately (ensuring enrichment)
      const freshCache = (Date.now() - memoryListExperimentsTime < 180_000) ? loadCachedExperiments() : null;
      if (freshCache) {
        log.debug('[Proxy] Serving fresh cached listExperiments response');
        const enrichedCache = enrichExperiments(freshCache);
        if (safeWriteHead(res, 200, { 'Content-Type': 'application/json' })) {
          safeEnd(res, enrichedCache);
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
        log.warn(`[Proxy] DNS resolution failed for ${targetHost} on listExperiments:`, e);
        const cached = loadCachedExperiments() || buildDefaultExperimentsFallback();
        const enrichedDns = enrichExperiments(cached);
        if (safeWriteHead(res, 200, { 'Content-Type': 'application/json' })) {
          safeEnd(res, enrichedDns);
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
        const cached = loadCachedExperiments() || buildDefaultExperimentsFallback();
        log.debug('[Proxy] Upstream listExperiments fallback active, serving 2.21 enabled flags');
        const enrichedFallback = enrichExperiments(cached);
        if (safeWriteHead(res, 200, { 'Content-Type': 'application/json' })) {
          safeEnd(res, enrichedFallback);
        }
      };

      let completed = false;
      const googleReq = https.request(parsedUrl, fwdOptions, (googleRes) => {
        if (googleRes.statusCode === 429 || googleRes.statusCode === 503 || googleRes.statusCode === 401) {
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
            const enriched = enrichExperiments(body);
            saveCachedExperiments(enriched);
            if (safeWriteHead(res, 200, { 'Content-Type': 'application/json' })) {
              safeEnd(res, enriched);
            }
          } else if (googleRes.statusCode && googleRes.statusCode < 500) {
            fallback();
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
          log.warn('[Proxy] Upstream listExperiments network error:', err.message);
          fallback();
        }
      });

      if (fullBody && fullBody.length > 0) {
        googleReq.write(fullBody);
      }
      googleReq.end();
      return;
    }

    // 0.6. Intercept telemetry metrics & AGI-Control shadow evaluation to avoid noisy upstream 503 UNAVAILABLE errors
    if (
      req.url!.includes('/v1internal:recordCodeAssistMetrics') ||
      req.url!.includes('/v1internal:recordTrajectoryAnalytics') ||
      req.url!.includes('/v1internal:recordClientEvent') ||
      req.url!.includes('/v1internal:uploadPerformanceProfile') ||
      req.url!.includes('/v1internal:checkUrlDenylist') ||
      req.url!.includes('/v1internal:fetchFromTrawlerCache') ||
      req.url!.includes('/v1internal:batchFetchFromTrawlerCache')
    ) {
      if (safeWriteHead(res, 200, { 'Content-Type': 'application/json' })) {
        safeEnd(res, JSON.stringify({}));
      }
      return;
    }

    // 0.7. Intercept /v1internal:loadCodeAssist with caching and fast fallback
    if (req.url!.includes('/v1internal:loadCodeAssist')) {
      log.debug('[Proxy] Intercepting loadCodeAssist request');

      const buildDefaultFallback = () => {
        const customModels = loadCustomModels();
        const googleAccount = customModels.find((m) => (m as any).accountProject || (m as any).projectId);
        const projectId = (googleAccount as any)?.accountProject || (googleAccount as any)?.projectId || 'projects/antigravity-local';
        return JSON.stringify({
          cloudaicompanionProject: projectId,
          allowedTiers: [
            { id: 'free-tier', isDefault: false },
            { id: 'standard-tier', isDefault: false },
            { id: 'g1-pro-tier', isDefault: true },
          ],
          currentTier: { id: 'g1-pro-tier', name: 'Google AI Pro' },
          paidTier: { id: 'g1-pro-tier', name: 'Google AI Pro' },
        });
      };

      // If we have cached code assist (disk or memory), serve it immediately to guarantee zero-latency response (< 2ms)
      const cached = loadCachedCodeAssist();
      if (cached) {
        log.debug('[Proxy] Serving cached loadCodeAssist response instantly (prevents LS deadline exceeded)');
        if (safeWriteHead(res, 200, { 'Content-Type': 'application/json' })) {
          safeEnd(res, cached);
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

      const fallback = (isLocationBlocked?: boolean) => {
        if (res.headersSent || res.writableEnded) return;
        const cached = loadCachedCodeAssist() || buildDefaultFallback();
        log.warn(
          isLocationBlocked
            ? '[Proxy] Upstream loadCodeAssist blocked by LOCATION/GEO. Serving fallback (an egress VPN/proxy may be required for downstream inference).'
            : '[Proxy] Upstream loadCodeAssist failed/timed out, serving fallback response',
        );
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (isLocationBlocked) {
          headers['X-Antigravity-Location-Warning'] = 'LOCATION_BLOCKED';
        }
        if (safeWriteHead(res, 200, headers)) {
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
            const unlockedBody = unlockCodeAssistPayload(body);
            saveCachedCodeAssist(unlockedBody);
            if (safeWriteHead(res, 200, { 'Content-Type': 'application/json' })) {
              safeEnd(res, unlockedBody);
            }
          } else if (
            googleRes.statusCode === 403 ||
            (googleRes.statusCode === 400 && (body.includes('LOCATION') || body.includes('1008') || body.toLowerCase().includes('location')))
          ) {
            log.warn(`[Proxy] Upstream loadCodeAssist rejected with HTTP ${googleRes.statusCode} (${body.slice(0, 150)}). Serving unlocked fallback with location warning.`);
            fallback(true);
          } else if (googleRes.statusCode && googleRes.statusCode < 500) {
            if (safeWriteHead(res, googleRes.statusCode, { 'Content-Type': 'application/json' })) {
              safeEnd(res, body);
            }
          } else {
            fallback();
          }
        });
      });

      googleReq.setTimeout(2_500, () => {
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
      log.debug('[Proxy] Intercepting fetchAvailableModels request');

      // If we have a fresh in-memory cache (< 60s), serve it immediately to prevent LS WaitForReady deadline exceeded
      const cachedModels = loadCachedAvailableModels();
      if (cachedModels && memoryFetchAvailableModelsTime && Date.now() - memoryFetchAvailableModelsTime < 60_000) {
        log.debug('[Proxy] Serving fresh cached fetchAvailableModels response instantly (prevents LS WaitForReady deadline exceeded)');
        if (safeWriteHead(res, 200, { 'Content-Type': 'application/json' })) {
          safeEnd(res, cachedModels);
        }
        return;
      }

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
        log.warn(`[Proxy] DNS resolution failed for ${targetHost}, serving cached/synthetic custom models:`, e);
        if (!res.headersSent && !res.writableEnded) {
          const customModels = loadCustomModels();
          const fallbackPayload = loadCachedAvailableModels() || JSON.stringify(buildSyntheticModelsResponse(customModels));
          safeWriteHead(res, 200, { 'Content-Type': 'application/json' });
          safeEnd(res, fallbackPayload);
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
            log.debug(
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

            log.debug(`[Proxy] Loaded custom models count: ${customModels.length}`);


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

            // Sanitize modelExperiments: replace any unresolvable placeholder IDs in experiment strings
            // (e.g. CASCADE_USE_EXPERIMENT_CHECKPOINTER checkpoint_model: MODEL_PLACEHOLDER_M50) with gemini-3.8-flash
            if (googleJson.models && typeof googleJson.models === 'object') {
              for (const mEntry of Object.values(googleJson.models as Record<string, any>)) {
                if (mEntry?.modelExperiments?.experiments) {
                  for (const exp of Object.values(mEntry.modelExperiments.experiments as Record<string, any>)) {
                    if (typeof exp?.stringValue === 'string' && exp.stringValue.includes('MODEL_PLACEHOLDER_')) {
                      exp.stringValue = exp.stringValue.replace(
                        /"checkpoint_model":\s*"MODEL_PLACEHOLDER_[^"]+"/g,
                        '"checkpoint_model": "gemini-3.8-flash"',
                      );
                    }
                  }
                }
              }
            }

            // Unlock any Ultra-gated models (e.g. Gemini 4 Argon) so they appear active and selectable in IDE
            const unlockModelsMap = (modelsMap: any) => {
              if (!modelsMap || typeof modelsMap !== 'object') return;
              for (const [mId, mEntry] of Object.entries(modelsMap as Record<string, any>)) {
                if (!mEntry || typeof mEntry !== 'object') continue;
                const mDisp = String(mEntry.displayName || '');
                const mTag = String(mEntry.tagTitle || '');
                const mDesc = String(mEntry.tagDescription || '');
                if (
                  mId.toLowerCase().includes('argon') ||
                  mDisp.toLowerCase().includes('argon') ||
                  mTag.toLowerCase().includes('unavailable') ||
                  mDesc.toLowerCase().includes('ultra') ||
                  mEntry.disabled === true
                ) {
                  delete mEntry.disabled;
                  if (mTag.toLowerCase().includes('unavailable') || mDesc.toLowerCase().includes('ultra')) {
                    delete mEntry.tagTitle;
                    delete mEntry.tagDescription;
                  }
                  if (!mEntry.quotaInfo) {
                    mEntry.quotaInfo = {
                      remainingFraction: 1,
                      resetTime: '2099-01-01T00:00:00Z',
                    };
                  }
                }
              }
            };
            unlockModelsMap(googleJson.models);
            unlockModelsMap(googleJson.availableModels);
            unlockModelsMap(googleJson.available_models);

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

            const finalPayload = JSON.stringify(googleJson);
            saveCachedAvailableModels(finalPayload);
            safeWriteHead(res, 200, { 'Content-Type': 'application/json' });
            safeEnd(res, finalPayload);
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
            const fallbackStr = JSON.stringify(responsePayload);
            saveCachedAvailableModels(fallbackStr);
            safeWriteHead(res, 200, { 'Content-Type': 'application/json' });
            safeEnd(res, fallbackStr);
          }
        });
      });

      googleReq.on('error', (err) => {
        log.error('[Proxy] Forwarding fetchAvailableModels failed:', err.message);
        if (!res.headersSent && !res.writableEnded) {
          const customModels = loadCustomModels();
          const fallbackPayload = loadCachedAvailableModels() || JSON.stringify(buildSyntheticModelsResponse(customModels));
          safeWriteHead(res, 200, { 'Content-Type': 'application/json' });
          safeEnd(res, fallbackPayload);
        }
      });

      // Bound upstream timeout to 3,500ms to stay safely below Go Language Server's 5s WaitForReady context deadline
      const FETCH_AVAILABLE_MODELS_TIMEOUT_MS = 3_500;
      googleReq.setTimeout(FETCH_AVAILABLE_MODELS_TIMEOUT_MS, () => {
        log.warn(`[Proxy] fetchAvailableModels forward request timed out after ${FETCH_AVAILABLE_MODELS_TIMEOUT_MS}ms. Serving cached/synthetic models to prevent LS WaitForReady deadline exceeded.`);
        googleReq.destroy();
        if (!res.headersSent && !res.writableEnded) {
          const customModels = loadCustomModels();
          const fallbackPayload = loadCachedAvailableModels() || JSON.stringify(buildSyntheticModelsResponse(customModels));
          safeWriteHead(res, 200, { 'Content-Type': 'application/json' });
          safeEnd(res, fallbackPayload);
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
      log.debug('[Proxy] Intercepting models list request');

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
      googleReq.end();
      return;
    }

    // 3. Intercept Cloud Code generation stream or non-stream requests
    let isSessionRemote = false;
    let convId: string | null = null;
    let sessId = '';
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
          reqJson.selectedModel,
          reqJson.requestedModel,
          reqJson.modelId,
          reqJson.model_id,
          reqJson.agentModel,
          targetReq.model,
          targetReq.selectedModel,
          targetReq.requestedModel,
          targetReq.modelId,
          targetReq.model_id,
          targetReq.agentModel,
        ].filter((x): x is string => typeof x === 'string' && Boolean(x));

        // Fast-path for IDE internal command input detection (run_command_handler.go)
        const isInputDetection = candidateNames.some((cn) =>
          /2[_\-]5[_\-]flash[_\-]lite|flash[_\-]lite|input[_\-]detect/i.test(cn) ||
          /MODEL_GOOGLE_GEMINI_2_5_FLASH_LITE/i.test(cn)
        );
        if (isInputDetection) {
          const detectedSess = extractSessionId(targetReq, req.headers as Record<string, unknown>) || '';
          log.info(`[Proxy] ⚡ Instant mock resolution for input-detection model call (0ms) [model=${candidateNames[0] || 'input-detect'}${detectedSess ? ` session=${detectedSess}` : ''}]`);
          const isStream = req.url!.includes('streamGenerateContent') || req.url!.includes('alt=sse');
          if (isStream) {
            if (safeWriteHead(res, 200, {
              'Content-Type': 'text/event-stream; charset=utf-8',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
            })) {
              const sseChunk = `data: ${JSON.stringify({
                response: {
                  candidates: [{
                    content: { parts: [{ text: 'false' }], role: 'model' },
                    finishReason: 'STOP',
                    index: 0,
                  }],
                },
              })}\n\n`;
              res.write(sseChunk);
              safeEnd(res);
            }
          } else {
            const jsonResp = Buffer.from(JSON.stringify({
              response: {
                candidates: [{
                  content: { parts: [{ text: 'false' }], role: 'model' },
                  finishReason: 'STOP',
                  index: 0,
                }],
              },
            }), 'utf-8');
            if (safeWriteHead(res, 200, {
              'Content-Type': 'application/json; charset=utf-8',
              'Content-Length': String(jsonResp.length),
            })) {
              safeEnd(res, jsonResp);
            }
          }
          return;
        }

        log.debug(
          `[Proxy] Cloud Code generation request candidates: ${candidateNames.join(', ')}, url: ${req.url}, bodyKeys: ${Object.keys(reqJson).join(',')}`,
        );

        const customModels = expandModelsWithEffort(loadCustomModels());
        let actualGeminiBody: GeminiRequestBody | undefined;
        let sessionKey = '';
        let isAuxiliaryReq = false;
        let auxiliaryType = '';

        if (candidateNames.length > 0) {
          actualGeminiBody = (reqJson.request || reqJson) as GeminiRequestBody;
          sessId = extractSessionId(actualGeminiBody as Record<string, unknown>, req.headers as Record<string, unknown>) || '';
          sessionKey = convId || sessId;

          const rType = String(
            targetReq.requestType ||
            reqJson.requestType ||
            (targetReq as any).type ||
            ''
          ).toUpperCase();
          if (
            rType === 'CONVERSATION_TITLE' ||
            rType === 'TITLE' ||
            rType === 'SUMMARY' ||
            rType === 'CONVERSATION_SUMMARY' ||
            rType === 'SEARCH' ||
            rType === 'INDEX' ||
            rType === 'CORTEX' ||
            rType === 'SONAR'
          ) {
            isAuxiliaryReq = true;
            auxiliaryType = rType;
          } else {
            const siText = (targetReq.systemInstruction as any)?.parts?.[0]?.text || '';
            if (
              /generate a (?:short |concise )?title/i.test(siText) ||
              /summarize the conversation/i.test(siText)
            ) {
              isAuxiliaryReq = true;
              auxiliaryType = /title/i.test(siText) ? 'TITLE' : 'SUMMARY';
            }
          }

          const customCandidate = candidateNames.find(
            (cn) => /MODEL_PLACEHOLDER_/i.test(cn) || cn.startsWith('custom-') || customModels.some((m) => matchesCustomModel(m, cn))
          );
          const requestedRaw = String(
            customCandidate ||
            reqJson.selectedModel ||
            targetReq.selectedModel ||
            reqJson.model ||
            targetReq.model ||
            reqJson.requestedModel ||
            targetReq.requestedModel ||
            candidateNames[0] ||
            ''
          ).toLowerCase();
          const cleanRequested = requestedRaw.replace(/^models\//, '').trim();
          const isExplicitCustom = Boolean(customCandidate);
          const isPrimaryNative = !isExplicitCustom && (isNativeCloudCodeModel(cleanRequested) || cleanRequested.includes('argon'));
          const isNativeCloudCode = isPrimaryNative || (!isExplicitCustom && (
            cleanRequested.includes('argon') ||
            candidateNames.some((cn) => isNativeCloudCodeModel(cn.replace(/^models\//, '').trim()))
          ));

          // Check if this request is an automated Language Server fallback on a failed native session
          const activeNative = (sessionKey ? getNativeSession(sessionKey) : undefined) ||
                               (convId ? getNativeSession(convId) : undefined) ||
                               (sessId ? getNativeSession(sessId) : undefined) ||
                               (!sessionKey && !convId && !sessId ? getLatestNativeErrorAsSession() : undefined);
          const isNativeProtected = Boolean(
            activeNative &&
            activeNative.lastError &&
            activeNative.originalModel &&
            isNativeCloudCodeModel(activeNative.originalModel)
          );
          const normOrig = isNativeProtected ? (normalizeCloudCodeModelId(activeNative!.originalModel) || activeNative!.originalModel.toLowerCase()) : '';
          const normCurrent = normalizeCloudCodeModelId(cleanRequested) || cleanRequested.toLowerCase();
          const isSameModel = isNativeProtected && (
            normOrig === normCurrent ||
            (normOrig.includes('sonnet') && normCurrent.includes('sonnet')) ||
            (normOrig.includes('opus') && normCurrent.includes('opus')) ||
            (normOrig.includes('flash') && normCurrent.includes('flash') && !normOrig.includes('pro'))
          );
          const isExplicitUserCustom = isExplicitCustom;

          if (isExplicitUserCustom) {
            // User explicitly switched to a custom model from the UI!
            // Clear any native session lock so user's explicit selection is honored immediately.
            if (sessionKey) nativeSessions.delete(sessionKey);
            if (convId) nativeSessions.delete(convId);
            if (sessId) nativeSessions.delete(sessId);
            clearLatestNativeGlobalError();
          }

          const isFallbackToDifferentModel = isNativeProtected && !isSameModel && !isExplicitUserCustom;

          if (isFallbackToDifferentModel) {
            const timeSinceNative = Date.now() - activeNative!.lastSeen;
            if (timeSinceNative < NATIVE_CASCADE_BLOCK_WINDOW_MS) {
              log.warn(
                `[Proxy] ⛔ Blocked automated Language Server fallback to [${requestedRaw}] on native session [${sessionKey || convId || sessId || 'unknown'}] (original model: [${activeNative!.originalModel}], within cascade window). Strict ZERO fallback rule: rejecting fallback to report original error directly.`
              );
              const err = activeNative!.lastError;
              if (err && err.body && err.body.length > 0) {
                const respHeaders = { ...err.headers };
                delete respHeaders['transfer-encoding'];
                respHeaders['content-length'] = String(err.body.length);
                if (safeWriteHead(res, err.statusCode, respHeaders)) {
                  safeEnd(res, err.body);
                }
                return;
              } else {
                const errCode = err?.statusCode || 429;
                const fallbackPayload = Buffer.from(
                  JSON.stringify({
                    error: {
                      code: errCode,
                      message: errCode === 404
                        ? `Model ${activeNative!.originalModel || cleanRequested} is not available.`
                        : `Resource has been exhausted (e.g. check quota) for model ${activeNative!.originalModel || cleanRequested}.`,
                      status: errCode === 404 ? 'NOT_FOUND' : 'RESOURCE_EXHAUSTED',
                    },
                  }),
                  'utf-8',
                );
                if (safeWriteHead(res, errCode, { 'Content-Type': 'application/json; charset=UTF-8', 'Content-Length': String(fallbackPayload.length) })) {
                  safeEnd(res, fallbackPayload);
                }
                return;
              }
            }
          }

          if (isNativeCloudCode) {
            reqJson.model = cleanRequested;
            if (targetReq && typeof targetReq === 'object') {
              targetReq.model = cleanRequested;
            }
            // Strip any stale custom placeholder models from previous conversation turns
            for (let i = candidateNames.length - 1; i >= 0; i--) {
              if (/MODEL_PLACEHOLDER_/i.test(candidateNames[i]) || candidateNames[i].startsWith('custom-')) {
                candidateNames.splice(i, 1);
              }
            }
            if (!candidateNames.includes(cleanRequested)) {
              candidateNames.unshift(cleanRequested);
            }

            // Fresh native turn: mark native session
            if (sessionKey) markNativeSession(sessionKey, cleanRequested);
            if (convId && convId !== sessionKey) markNativeSession(convId, cleanRequested);
            if (sessId && sessId !== sessionKey) markNativeSession(sessId, cleanRequested);

            if (sessionKey) clearSessionModelFallback(sessionKey);
            if (convId) clearSessionModelFallback(convId);
            if (sessId) clearSessionModelFallback(sessId);
          } else {
            // User explicitly requested a custom model: clear any native session lock
            if (sessionKey) nativeSessions.delete(sessionKey);
            if (convId) nativeSessions.delete(convId);
            if (sessId) nativeSessions.delete(sessId);
          }

          if (sessionKey && !isNativeCloudCode) {
            const allowCrossModel = process.env.AG_ENABLE_CROSS_MODEL_FALLBACK === '1';
            if (!allowCrossModel) {
              clearSessionModelFallback(sessionKey);
            } else {
              const explicitSelected = (
                reqJson.model ||
                reqJson.selectedModel ||
                targetReq.model ||
                targetReq.selectedModel ||
                reqJson.requestedModel ||
                targetReq.requestedModel
              ) as string | undefined;

              const activeFallback = getSessionModelFallback(sessionKey);
              if (activeFallback && explicitSelected) {
                const normExplicit = normalizeCloudCodeModelId(explicitSelected);
                const isNative = isNativeCloudCodeModel(explicitSelected.replace(/^models\//, ''));
                if (isNative) {
                  log.info(
                    `[Proxy] 🎯 User switched to native model [${explicitSelected}]. Clearing active session fallback [${activeFallback.originalModel} -> ${activeFallback.fallbackModel}].`,
                  );
                  clearSessionModelFallback(sessionKey);
                } else {
                  const isFallback = normExplicit === normalizeCloudCodeModelId(activeFallback.fallbackModel);
                  const isOriginal = normExplicit === normalizeCloudCodeModelId(activeFallback.originalModel);
                  if (!isFallback && !isOriginal) {
                    log.info(
                      `[Proxy] 🎯 User explicitly selected different model [${explicitSelected}]. Clearing active session fallback [${activeFallback.originalModel} -> ${activeFallback.fallbackModel}].`,
                    );
                    clearSessionModelFallback(sessionKey);
                  }
                }
              }
            }
          }
        }

        const customCandidate = candidateNames.find(
          (cn) => /MODEL_PLACEHOLDER_/i.test(cn) || cn.startsWith('custom-') || customModels.some((m) => matchesCustomModel(m, cn))
        );
        const requestedRaw = String(
          customCandidate ||
          reqJson.selectedModel ||
          targetReq.selectedModel ||
          reqJson.model ||
          targetReq.model ||
          reqJson.requestedModel ||
          targetReq.requestedModel ||
          candidateNames[0] ||
          ''
        ).toLowerCase();
        let cleanRequested = requestedRaw.replace(/^models\//, '').trim();

        let detectedExplicitEffort: string | undefined;
        if (customCandidate) {
          const matchedExplicit = customModels.find((m) => matchesCustomModel(m, customCandidate));
          if (matchedExplicit) {
            detectedExplicitEffort = (matchedExplicit._effortSuffix?.replace('-', '') || matchedExplicit.reasoningEffort || '').toLowerCase();
          }
        }
        if (!detectedExplicitEffort) {
          for (const cn of candidateNames) {
            const mEff = /(?:^|[-_ (])(low|medium|high)(?:$|[-_ )])/i.exec(cn)?.[1]?.toLowerCase();
            if (mEff) {
              detectedExplicitEffort = mEff;
              break;
            }
          }
        }

        if (detectedExplicitEffort && !isAuxiliaryReq) {
          if (sessionKey) setSessionEffortAffinity(sessionKey, detectedExplicitEffort);
          if (sessId && sessId !== sessionKey) setSessionEffortAffinity(sessId, detectedExplicitEffort);
        }

        const inheritedEffort = (!detectedExplicitEffort && !isAuxiliaryReq && (sessionKey || sessId))
          ? (getSessionEffortAffinity(sessionKey) || (sessId ? getSessionEffortAffinity(sessId) : undefined))
          : undefined;

        const activeFallback = sessionKey ? getSessionModelFallback(sessionKey) : undefined;
        if (activeFallback) {
          const normReq = normalizeCloudCodeModelId(cleanRequested);
          const normOrig = normalizeCloudCodeModelId(activeFallback.originalModel);
          const isOrigClaude = activeFallback.originalModel.toLowerCase().includes('claude');
          const matchesOrig = normReq === normOrig || candidateNames.some((cn) => {
            const norm = normalizeCloudCodeModelId(cn);
            return norm === normOrig || (isOrigClaude && cn.toLowerCase().includes('claude'));
          });
          if (matchesOrig) {
            log.info(
              `[Proxy] 🔀 [Active Session Fallback] Seamlessly routing session ${sessionKey} to [${activeFallback.fallbackModel}] (primary [${activeFallback.originalModel}] in temporary fallback cooldown)`
            );
            cleanRequested = activeFallback.fallbackModel;
          }
        }
        const isExplicitCustom = Boolean(customCandidate);
        const isPrimaryNative = !isExplicitCustom && (isNativeCloudCodeModel(cleanRequested) || cleanRequested.includes('argon'));
        const isNativeCloudCode = isPrimaryNative || (!isExplicitCustom && (
          cleanRequested.includes('argon') ||
          candidateNames.some((cn) => isNativeCloudCodeModel(cn.replace(/^models\//, '').trim()))
        ));

        let matchingCandidates: typeof customModels = [];
        let isNativeRoutedToPool = false;
        if (isNativeCloudCode) {
          const googlePoolCandidates = customModels.filter(
            (m) => (m.provider === 'google' || m.apiKey === 'auto') &&
                   m.enabled !== false &&
                   !(m as any)._poolOnly
          );
          if (googlePoolCandidates.length > 0 && process.env.AG_POOL_NATIVE_MODELS !== '0') {
            const normReq = normalizeCloudCodeModelId(cleanRequested);
            const matchedPool = googlePoolCandidates.filter((m) => {
              const mTarget = (m.externalModelName || m.name || (m as any).id || '').replace(/^models\//, '').toLowerCase();
              return mTarget === cleanRequested.toLowerCase() ||
                     (normReq && normalizeCloudCodeModelId(mTarget) === normReq);
            });
            let effectivePool = matchedPool;
            if (inheritedEffort && matchedPool.some((m) => (m._effortSuffix || m.reasoningEffort || '').toLowerCase().includes(inheritedEffort))) {
              effectivePool = matchedPool.filter((m) => (m._effortSuffix || m.reasoningEffort || '').toLowerCase().includes(inheritedEffort));
            }
            if (effectivePool.length > 0) {
              log.info(`[Proxy] 🌐 Routing native model [${requestedRaw}] through Google multi-account pool (${effectivePool.length} candidate(s))${inheritedEffort ? ` [Inherited Effort: ${inheritedEffort}]` : ''}.`);
              matchingCandidates = effectivePool;
              isNativeRoutedToPool = true;
            } else {
              log.info(`[Proxy] ⚡ Native Antigravity model requested [${requestedRaw}]. Bypassing multi-account pool and transparently proxying to Google. (Strict: NO fallback on failure/quota).`);
            }
          } else {
            log.info(`[Proxy] ⚡ Native Antigravity model requested [${requestedRaw}]. Bypassing multi-account pool and transparently proxying to Google. (Strict: NO fallback on failure/quota).`);
          }
        } else {
          // Strictly prioritize the model matching cleanRequested (the directly requested model)
          let candidates = customModels.filter((m) => matchesCustomModel(m, cleanRequested));
          if (inheritedEffort && candidates.some((m) => (m._effortSuffix || m.reasoningEffort || '').toLowerCase().includes(inheritedEffort))) {
            candidates = candidates.filter((m) => (m._effortSuffix || m.reasoningEffort || '').toLowerCase().includes(inheritedEffort));
          }
          matchingCandidates = candidates;
          if (matchingCandidates.length === 0) {
            // Check candidateNames in precedence order without mixing disparate models
            for (const cn of candidateNames) {
              let matched = customModels.filter((m) => matchesCustomModel(m, cn));
              if (inheritedEffort && matched.some((m) => (m._effortSuffix || m.reasoningEffort || '').toLowerCase().includes(inheritedEffort))) {
                matched = matched.filter((m) => (m._effortSuffix || m.reasoningEffort || '').toLowerCase().includes(inheritedEffort));
              }
              if (matched.length > 0) {
                matchingCandidates = matched;
                break;
              }
            }
          }
          if (matchingCandidates.length === 0) {
            for (const cn of candidateNames) {
              if (/MODEL_PLACEHOLDER_/i.test(cn) || cn.startsWith('custom-')) continue;
              const norm = normalizeGoogleModelId(cn);
              if (norm) {
                const matched = customModels.filter((m) => matchesCustomModel(m, norm) || matchesCustomModel(m, `models/${norm}`));
                if (matched.length > 0) {
                  matchingCandidates = matched;
                  break;
                }
              }
            }
          }
        }
        const targetFam = (cleanRequested || candidateNames[0] || '').toLowerCase().includes('claude') ? 'claude' : 'gemini';
        let matchedCustomModel = (isNativeCloudCode && !isNativeRoutedToPool) ? undefined : selectBestModelByQuota(matchingCandidates, customModels, targetFam);
        // Fallback: if a conversation references a placeholder (e.g. M299/M298/M50/M319/M565)
        if (!isNativeCloudCode && !matchedCustomModel && candidateNames.some((cn) => /MODEL_PLACEHOLDER_/i.test(cn))) {
          const activePool = customModels.filter((m) => !(m as any)._poolOnly && m.enabled !== false);
          matchedCustomModel = selectBestModelByQuota(activePool.length > 0 ? activePool : customModels, customModels, targetFam) || activePool[0] || customModels[0];
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
          if (normalizeConversationTurns(targetReq.contents)) {
            contentsNormalized = true;
          }
          if (isClaudeRequest) {
            sanitizeCloudCodeGenerationConfig(targetReq, effectiveModelName);
            contentsNormalized = true;
          } else if (sessionKey && isConvCorruptedSignatures(sessionKey)) {
            // This conversation already experienced rejected/corrupted thought signatures upstream.
            // Proactively flatten tool calls in past history to plain text to prevent doomed 400 errors and retries.
            if (flattenAllToolCallsToText(targetReq.contents)) {
              contentsNormalized = true;
              normalizeConversationTurns(targetReq.contents);
              injectAntiHallucinationInstruction(targetReq);
            }
          } else {
            signaturesRestored = restoreThoughtSignatures(targetReq.contents, sessionKey, effectiveModelName);
            if (sanitizeUnsignedToolCalls(targetReq.contents)) {
              contentsNormalized = true;
              normalizeConversationTurns(targetReq.contents);
              injectAntiHallucinationInstruction(targetReq);
            }
          }
        }

        // Subagent Effort Governor: only clamp if AG_CLAMP_SUBAGENTS=1 is explicitly set
        // Disabled by default to strictly honor user-selected reasoning effort without quota throttling
        if (process.env.AG_CLAMP_SUBAGENTS === '1' && clampSubagentReasoning(targetReq)) {
          log.info(`[Proxy] 🛡️ Subagent detected: clamped thinking budget to 2048 tokens to conserve quota`);
          contentsNormalized = true;
        }

        if (!isClaudeRequest && (targetReq.tools || targetReq.toolConfig)) {
            injectAntiHallucinationInstruction(targetReq);
            contentsNormalized = true;
          }

          if (signaturesRestored || contentsNormalized) {
          fullBody = Buffer.from(JSON.stringify(reqJson), 'utf-8');
          log.debug(`[Proxy] Re-encoded Cloud Code request with normalized turns/signatures (convId=${sessionKey || 'draft'}, model=${effectiveModelName})`);
        }

          if (matchedCustomModel && (matchedCustomModel.apiKey === 'auto' || matchedCustomModel.name.includes(':auto-pool'))) {
            const rawTarget = (matchedCustomModel.externalModelName || matchedCustomModel.name)
              .replace(/^models\//, '')
              .replace(/^google:/, '')
              .replace(/:auto-pool.*$/, '');
            const baseName = getBaseModelId(rawTarget);
            const baseNorm = normalizeCloudCodeModelId(baseName);
            const targetEffort = matchedCustomModel._effortSuffix || matchedCustomModel.reasoningEffort || '';
            const realSiblings = customModels.filter((m) => {
              if (m.apiKey === 'auto' || m.name.includes(':auto-pool') || getOpenBreaker(m)) return false;
              const mRaw = (m.externalModelName || m.name)
                .replace(/^models\//, '')
                .replace(/^google:/, '')
                .replace(/:auto-pool.*$/, '');
              const mBase = getBaseModelId(mRaw);
              const mNorm = normalizeCloudCodeModelId(mBase);
              const mEffort = m._effortSuffix || m.reasoningEffort || '';
              return (mBase === baseName || (baseNorm && mNorm === baseNorm)) && mEffort === targetEffort;
            });
            matchedCustomModel = selectBestModelByQuota(realSiblings, customModels, isClaudeRequest ? 'claude' : 'gemini') || matchedCustomModel;
          }

          if (matchedCustomModel) {
            const isStream = req.url!.includes('streamGenerateContent') || req.url!.includes('alt=sse');

            // Apply Sticky Session affinity (preserves Cloud Code prompt cache)
            if (sessId) {
              matchedCustomModel = getSessionBoundModel(sessId, matchedCustomModel, customModels);
              bindSessionToModel(sessId, matchedCustomModel);
            }

            // Propagate reasoning effort / thinking level from matched model to Cloud Code payload
            const modelEffort = matchedCustomModel.reasoningEffort;
            const modelBudget = matchedCustomModel.thinkingBudget;
            if (modelEffort || modelBudget) {
              const target = (reqJson.request || reqJson) as Record<string, any>;
              if (!target.generationConfig) target.generationConfig = {};
              if (!target.generationConfig.thinkingConfig) target.generationConfig.thinkingConfig = {};
              if (modelEffort) {
                target.generationConfig.thinkingConfig.thinkingLevel = modelEffort;
              }
              if (modelBudget && !target.generationConfig.thinkingConfig.thinkingBudget) {
                target.generationConfig.thinkingConfig.thinkingBudget = modelBudget;
              }
            }

            const auxTag = isAuxiliaryReq ? ` [Auxiliary Task: ${auxiliaryType || 'BACKGROUND'}]` : '';
            log.info(
              `[Proxy] 📥 [Incoming Request]${auxTag} Model requested: [${matchedCustomModel.displayName || matchedCustomModel.name}]${sessId ? ` (session: ${sessId})` : ''}`,
            );

            // Resolve fileData URIs then route to translator
            resolveFileData(actualGeminiBody, req.headers as Record<string, string | string[] | undefined>).then(async () => {
              if (isGoogleCloudCodeModel(matchedCustomModel) || matchedCustomModel.name.includes(':auto-pool') || matchedCustomModel.apiKey === 'auto') {
                try {
                  const accountPool = getGoogleAccountPool(matchedCustomModel, customModels);
                  const resolvedModelName = normalizeCloudCodeModelId(matchedCustomModel.externalModelName || matchedCustomModel.name);
                  if (resolvedModelName) {
                    reqJson.model = resolvedModelName;
                    if (reqJson.request && typeof reqJson.request === 'object') {
                      (reqJson.request as Record<string, unknown>).model = resolvedModelName;
                    }
                  }
                  log.debug(`[Proxy] Forwarding Cloud Code request via multi-account pool (${accountPool.length} candidate accounts) for model ${resolvedModelName || matchedCustomModel.name}`);
                  await executeGoogleCloudCodeWithPool(
                    req,
                    res,
                    reqJson,
                    accountPool,
                    isSessionRemote,
                    sessionKey,
                    sessId,
                  );
                  return;
                } catch (err) {
                  log.error('[Proxy] Failed to execute Cloud Code request with pool, falling back to translator:', err);
                }
              }
              if (matchedCustomModel.apiKey === 'auto' || matchedCustomModel.name?.includes(':auto-pool')) {
                log.warn(`[Proxy] Cloud Code pool exhausted and no valid API key on ${matchedCustomModel.name}. Terminating gracefully.`);
                if (!res.headersSent && !res.writableEnded) {
                  safeWriteHead(res, 503, { 'Content-Type': 'application/json' });
                  safeEnd(res, JSON.stringify({ error: { message: 'All Google Cloud Code accounts are currently unavailable or in cooldown.' } }));
                }
                return;
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
      const isNative = !matchedModelName.startsWith('custom-') && isNativeCloudCodeModel(matchedModelName);
      let matchedCustomModel: CustomModel | undefined;
      let customModels: CustomModel[] = [];

      customModels = expandModelsWithEffort(loadCustomModels());
      if (isNative) {
        const googlePoolCandidates = customModels.filter(
          (m) => (m.provider === 'google' || m.apiKey === 'auto') &&
                 m.enabled !== false &&
                 !(m as any)._poolOnly
        );
        const cleanMatched = matchedModelName.replace(/^models\//, '').toLowerCase();
        const normMatched = normalizeCloudCodeModelId(cleanMatched);
        const matchedPool = googlePoolCandidates.filter((m) => {
          const mTarget = (m.externalModelName || m.name || (m as any).id || '').replace(/^models\//, '').toLowerCase();
          return mTarget === cleanMatched || (normMatched && normalizeCloudCodeModelId(mTarget) === normMatched);
        });
        if (matchedPool.length > 0 && process.env.AG_POOL_NATIVE_MODELS !== '0') {
          log.info(`[Proxy] 🌐 Routing native model [${matchedModelName}] on direct URL through Google multi-account pool.`);
          matchedCustomModel = selectBestModelByQuota(matchedPool, customModels);
        } else {
          log.info(`[Proxy] ⚡ Native Antigravity model requested on direct URL [${matchedModelName}]. Bypassing multi-account pool and transparently proxying to Google. (Strict: NO fallback on failure/quota).`);
        }
      } else {
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
        const directFam = (matchedModelName || '').toLowerCase().includes('claude') ? 'claude' : 'gemini';
        matchedCustomModel = selectBestModelByQuota(matchingCandidates, customModels, directFam);
        if (!matchedCustomModel && /MODEL_PLACEHOLDER_/i.test(matchedModelName)) {
          const activePool = customModels.filter((m) => !(m as any)._poolOnly && m.enabled !== false);
          matchedCustomModel = selectBestModelByQuota(activePool.length > 0 ? activePool : customModels, customModels, directFam) || activePool[0] || customModels[0];
        }

        if (matchedCustomModel && matchedCustomModel.apiKey === 'auto') {
          const baseName = getBaseModelId(matchedCustomModel.externalModelName || matchedCustomModel.name);
          const baseNorm = normalizeCloudCodeModelId(baseName);
          const realSiblings = customModels.filter((m) => {
            if (m.apiKey === 'auto' || getOpenBreaker(m)) return false;
            const mBase = getBaseModelId(m.externalModelName || m.name);
            const mNorm = normalizeCloudCodeModelId(mBase);
            return mBase === baseName || (baseNorm && mNorm === baseNorm);
          });
          matchedCustomModel = selectBestModelByQuota(realSiblings, customModels, directFam) || matchedCustomModel;
        }
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

            if (matchedCustomModel.apiKey === 'auto' || matchedCustomModel.name?.includes(':auto-pool')) {
              log.warn(`[Proxy] Cloud Code pool exhausted and no valid API key on ${matchedCustomModel.name}. Terminating gracefully.`);
              if (!res.headersSent && !res.writableEnded) {
                safeWriteHead(res, 503, { 'Content-Type': 'application/json' });
                safeEnd(res, JSON.stringify({ error: { message: 'All Google Cloud Code accounts are currently unavailable or in cooldown.' } }));
              }
              return;
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
    let rawModelName = '';
    try {
      const fallbackJson = JSON.parse(bodyStr) as Record<string, unknown>;
      const fallbackReq = (fallbackJson.request || fallbackJson) as Record<string, unknown>;
      rawModelName = extractModelNameFromPayload(fallbackJson).toLowerCase();
      if (typeof fallbackJson.planModel === 'string' && /MODEL_PLACEHOLDER_/i.test(fallbackJson.planModel)) {
        delete fallbackJson.planModel;
        fullBody = Buffer.from(JSON.stringify(fallbackJson), 'utf-8');
      }
      if (typeof fallbackReq.planModel === 'string' && /MODEL_PLACEHOLDER_/i.test(fallbackReq.planModel)) {
        delete fallbackReq.planModel;
        fullBody = Buffer.from(JSON.stringify(fallbackJson), 'utf-8');
      }
      if (rawModelName.includes('claude') && Array.isArray(fallbackReq.contents)) {
        sanitizeCloudCodeGenerationConfig(fallbackReq, rawModelName);
        fullBody = Buffer.from(JSON.stringify(fallbackJson), 'utf-8');
      }
      if (rawModelName.includes('2_5_flash_lite') || rawModelName.includes('2-5-flash-lite') || rawModelName.includes('flash_lite') || rawModelName.includes('flash-lite')) {
        const rewrittenModel = 'gemini-3.8-flash-tiered';
        fallbackJson.model = rewrittenModel;
        if (fallbackJson.request && typeof fallbackJson.request === 'object') {
          (fallbackJson.request as Record<string, unknown>).model = rewrittenModel;
        }
        rawModelName = rewrittenModel;
        fullBody = Buffer.from(JSON.stringify(fallbackJson), 'utf-8');
      }
    } catch { /* not JSON — continue as-is */ }

    // Intercept unresolved placeholder models so internal placeholders never leak to Google upstream
    if (/MODEL_PLACEHOLDER_/i.test(rawModelName) || /MODEL_PLACEHOLDER_/i.test(req.url || '')) {
      log.warn(`[Proxy] Unresolved custom model placeholder [${rawModelName}] reached fallback proxy. Rejecting locally with 503 rather than forwarding invalid placeholder to Google.`);
      if (!res.headersSent && !res.writableEnded) {
        safeWriteHead(res, 503, { 'Content-Type': 'application/json' });
        safeEnd(res, JSON.stringify({
          error: {
            code: 503,
            status: 'UNAVAILABLE',
            message: `Custom model placeholder [${rawModelName}] could not be resolved by local proxy. The model store may be reloading.`,
          },
        }));
      }
      return;
    }

    await proxyToGoogle(req, res, fullBody, isSessionRemote, undefined, convId || '', undefined, sessId || '', rawModelName);

  });
}


export function startProxy(): Promise<number> {
  return startProxyServer(handleRequest);
}

export function stopProxy(): Promise<void> {
  return stopProxyServer();
}
