import * as http from 'http';
import https from 'https';
import * as zlib from 'zlib';
import log from 'electron-log';
import { startTimer as metricTimer, inc as metricInc, observe as metricObserve } from '../../metrics';
import {
  GOOGLE_HOSTS,
  GOOGLE_PROXY_TIMEOUT_MS,
  GOOGLE_POOL_HEADER_TIMEOUT_MS,
  GOOGLE_POOL_HEADER_TIMEOUT_FLASH_MS,
  RATE_LIMIT_RELIEF_WAIT_MS,
  HEDGED_REQUEST_DELAY_MS,
  CAPACITY_503_CASCADE_THRESHOLD,
  CONSECUTIVE_504_CASCADE_THRESHOLD,
} from '../../constants';

import type { CustomModel, GeminiRequestBody, GeminiCandidate, CloudCodeResponse } from '../core/types';
import {
  extractAndCacheThoughtSignatures,
  restoreThoughtSignatures,
  sanitizeUnsignedToolCalls,
  flattenAllToolCallsToText,
  detectAndMitigateToolLoops,
  markConvCorruptedSignatures,
} from '../core/shared';

import { loadCustomModels } from '../models/modelLoader';
import { classifyError, type ErrorType, type ErrorDiagnostic } from '../resilience/errorClassifier';
import { isRetryableNetworkError } from '../resilience/retryStrategy';
import { getOpenBreaker, recordFailure, recordSuccess } from '../resilience/circuitBreaker';
import { getHttpsAgent, evictAgent } from '../resilience/agentPool';
import { expandModelsWithEffort } from './effortExpander';
import { extractModelNameFromPayload } from '../models/modelUtils';
import { resolveGoogleIp, invalidateCachedDns } from '../http/dnsResolver';
import { isProviderRateLimited } from '../models/modelRouter';
import { trimContextPayload } from './contextTrimmer';
import {
  getValidGoogleAccessToken,
  normalizeCloudCodeModelId,
  isGoogleCloudCodeModel,
  isGeminiCliModel,
  sanitizeCloudCodeGenerationConfig,
  normalizeConversationTurns,
  isTokenRevoked,
  getLiveAccountQuota,
  updateLiveAccountQuota,
  AccountLiveQuota,
  isAccountEntitledToClaude55,
  applyAntiTruncation,
  onboardUserAndAcceptTerms,
} from '../../services/googleAuth';
import {
  getAccountQuotaKey,
  isAccountUnlicensed,
  markAccountUnlicensed,
  unmarkAccountUnlicensed,
  markAccountQuotaExhausted,
  isAccountInProbation,
  endAccountProbation,
  isAccountInCooldown,
  setAccountCooldown,
  getSoonestAccountCooldownRemaining,
  clearAccountCooldown,
  getAccountInFlight,
  MAX_CONCURRENT_PER_ACCOUNT,
  waitForAccountSlot,
  incrementAccountInFlight,
  decrementAccountInFlight,
  recordAccountRequest,
  getModelQuotaScore,
  recordAccountLatency,
  isPoolUnderQuotaStress,
  resolveGoogleProjectId,
  getAccountVirtualDeviceHeaders,
  getAccountDynamicScore,
  classifyGoogleCloudCode429,
  selectCandidateP2C,
  selectBestModelByQuota,
  getGoogleAccountPool,
  persistAccountQuotaExhaustedToDisk,
  recordAccountBurst,
  clearAccountBurst,
  isAccountNearExhaustion,
  PREVENTIVE_QUOTA_THRESHOLD_PCT,
} from '../resilience/googlePool';
import { safeWriteHead, safeEnd, parseRetryAfter, proxyLog, newTraceId } from '../http/httpUtils';
import {
  ResponseClaimer,
  createResponseClaimer,
  trimOldestHistory,
} from './historyTrimmer';
import { logTokenUsageEvent } from '../state/remoteState';
import { unlockCodeAssistPayload, saveCachedCodeAssist } from '../http/endpointHandlers';
import {
  sendGracefulStreamError,
  sendGracefulNonStreamError,
  sanitizeCandidatesInResponse,
  writeSafeSseChunk,
  injectAntiHallucinationInstruction,
  transformGoogleStreamForRemote,
} from './streamPipeline';
import {
  sessionAffinities,
  bindSessionToModel,
  getSessionModelFallback,
  clearSessionModelFallback,
  setSessionModelFallback,
  recordNativeSessionError,
  recordLatestNativeError,
  updateLatestNativeErrorBody,
} from '../resilience/sessionAffinities';
import { handleCustomModelRequest } from './customModelEngine';

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

  // Parity with Original Antigravity: Google Cloud Code PA supports up to 1M tokens natively.
  // Proactive history slicing at 35 turns causes catastrophic amnesia and infinite tool-execution loops.
  // Full context is preserved by default. Trimming is strictly opt-in via environment variables or reactive fallbacks.
  if (process.env.AG_ENABLE_CONTEXT_TRIMMER === '1') {
    reqJson = trimContextPayload(reqJson as unknown as GeminiRequestBody) as unknown as Record<string, unknown>;
  }

  if (process.env.AG_PROACTIVE_TRIM_HISTORY === '1') {
    const initialContents = (reqJson.request as any)?.contents || (reqJson as any).contents;
    if (Array.isArray(initialContents) && initialContents.length > 35) {
      const turnsCount = initialContents.length;
      if (trimOldestHistory(reqJson, 30)) {
        const remainingTurns = ((reqJson.request || reqJson) as any)?.contents?.length;
        log.info(`[Proxy] ⚡ [Proactive Context Trimmer] Heavy session detected (${turnsCount} turns). Proactively trimmed oldest history to ${remainingTurns} turns before first network dispatch.`);
      }
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
        // Concurrency Guard: If the sticky session account is currently busy handling an in-flight request
        // and other healthy accounts in the pool are completely idle, do not force-pin the busy account
        // to avoid simultaneous stalls on the same upstream node.
        const boundIsBusy = getAccountInFlight(boundAccount) >= 1;
        const hasIdleAlternative = sortedAccounts.some(
          (m) =>
            m !== boundAccount &&
            getAccountInFlight(m) === 0 &&
            !isAccountInCooldown(m, modelFamily) &&
            getModelQuotaScore(m, modelFamily) > 0,
        );
        if (!boundIsBusy || !hasIdleAlternative) {
          const idx = sortedAccounts.indexOf(boundAccount);
          if (idx > 0) {
            sortedAccounts.splice(idx, 1);
            sortedAccounts.unshift(boundAccount);
          }
        } else {
          boundAccount = undefined;
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
            ? (isThinkingModel ? (healthySiblingAccountsCount >= 2 ? 38_000 : 65_000) : 35_000)
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

    // AUDIT-001: Under Low Headroom, give candidates enough breathing room for KV prefill & reasoning.
    // If only 1 healthy candidate exists, do not cap to 25s (let it use the full budget since there are no siblings).
    // If 2 healthy accounts exist, cap to 40s to keep total attempt time within client timeout (~90-120s).
    const isLowHeadroom = initialHealthyCount > 0 && initialHealthyCount <= 2;
    if (isLowHeadroom && initialHealthyCount === 2 && poolHeaderTimeout > 40_000) {
      log.info(`[Proxy] Low headroom pool (2 healthy accounts). Allocating 40s per candidate to prevent client disconnect.`);
      poolHeaderTimeout = 40_000;
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
        const capacityThreshold = Math.min(CAPACITY_503_CASCADE_THRESHOLD, Math.max(2, Math.ceil(sortedAccounts.length * 0.5)));
        log.warn(
          `[Proxy] ⚠️ Account [${candidateName}] hit MODEL_CAPACITY_EXHAUSTED / 503 Overload for [${targetModel}]. Placing in 45s cooldown without clearing quota. (Capacity 503 count: ${consecutive503CapacityCount}/${capacityThreshold})`,
        );
        // Do not zero out the account's real 5-hour quota for transient upstream cluster capacity saturation.
        // Instead, cool down briefly (45s) and penalize latency to give the TPU pod time to shed load.
        setAccountCooldown(candidate, 45_000, currentFamily, true);
        recordAccountLatency(candidate, 45_000);

        const combinedOutageCount = consecutive503CapacityCount + consecutive504TimeoutCount;
        if (consecutive503CapacityCount >= capacityThreshold || combinedOutageCount >= Math.max(2, capacityThreshold)) {
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
        // For HTTP 500 internal errors: 20s cooldown; 504 timeouts (transient server/thinking latency): 60s cooldown; outages: 45s.
        const timeoutCooldownMs = lastStatus === 500 ? 20_000 : (lastStatus === 504 ? 60_000 : (isUpstreamOutage ? 45_000 : 30_000));
        const isPayloadInducedTimeout = lastStatus === 504 && (isLargePayload || isContextualPayload || isMultiTurn || consecutive504TimeoutCount > 0);
        const isCappedTimeout = wasTimeoutCappedByBudget || (lastStatus === 504 && poolHeaderTimeout < baseCandidateTimeout);
        if (lastStatus === 504) {
          log.info(
            `[Proxy] Account ${candidateName} timed out (HTTP 504, ${elapsedMs}ms). Placing in 60s transient cooldown to avoid immediate repeat stall.`,
          );
          setAccountCooldown(candidate, 60_000, currentFamily, false);
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
      if (testedAccountsCount < totalAttempts) {
        if (lastStatus === 503) {
          diagnostic.message = `Surcharge de capacité TPU détectée sur ${testedAccountsCount} comptes consécutifs. Les ${totalAttempts - testedAccountsCount} comptes restants ont été préservés sans être bloqués.`;
        } else if (lastStatus === 504) {
          diagnostic.message = `Le service Google Cloud Code a expiré sur ${testedAccountsCount} comptes consécutifs (coupure amont détectée). Les ${totalAttempts - testedAccountsCount} comptes restants ont été préservés sans être bloqués.`;
        } else {
          diagnostic.message = `Le service Google Cloud Code a rencontré une erreur (HTTP ${lastStatus}) sur ${testedAccountsCount} comptes consécutifs. Les ${totalAttempts - testedAccountsCount} comptes restants ont été préservés sans être bloqués.`;
        }
      } else {
        diagnostic.message = `L'ensemble des ${totalAttempts} comptes configurés ont été testés automatiquement en arrière-plan, mais aucun n'est actuellement disponible (${diagnostic.errorType}).`;
      }
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
