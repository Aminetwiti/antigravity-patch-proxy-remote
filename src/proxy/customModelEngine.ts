import * as http from 'http';
import https from 'https';
import * as path from 'path';
import log from 'electron-log';
import { STREAM_IDLE_TIMEOUT_MS } from '../constants';
import type { CustomModel, GeminiRequestBody, GeminiCandidate, CloudCodeResponse } from './types';
import {
  modelReasoningContent,
  stateTimestamps,
  extractAndCacheThoughtSignatures,
  restoreThoughtSignatures,
  touchStateTimestamp,
  getSessionModelKey,
} from './shared';
import * as registry from './registry';
import { loadCustomModels } from './modelLoader';
import { recordProviderUsage } from '../customModelStore';
import { classifyError, ErrorDiagnostic, type ErrorType } from './errorClassifier';
import { shouldRetryStatus, computeRetryDelay, type RetryStrategy } from './retryStrategy';
import { getOpenBreaker, recordFailure, recordSuccess } from './circuitBreaker';
import { IdleTimeoutGuard } from './idleTimeout';
import { resolveClientForUrl } from './agentPool';
import { EmptyStreamGuard } from './emptyStream';
import { getRetryBudget, RETRY_BUDGET_BASE } from './retryBudget';
import {
  resolveProvider,
  resolveCustomModelUrl,
  resolveMaxRetries,
  resolveRequestTimeout,
  getBaseModelId,
} from './urlBuilder';
import { expandModelsWithEffort } from './effortExpander';
import { markProviderRateLimited, isProviderRateLimited } from './modelRouter';
import { trimContextPayload } from './contextTrimmer';
import { recordRecentModel } from './recentModelsStore';
import {
  normalizeCloudCodeModelId,
  isGoogleCloudCodeModel,
  sanitizeCloudCodeGenerationConfig,
  normalizeConversationTurns,
} from '../services/googleAuth';
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
  getAccountDynamicScore,
  classifyGoogleCloudCode429,
  selectCandidateP2C,
  selectBestModelByQuota,
  getGoogleAccountPool,
  recordAccountBurst,
  clearAccountBurst,
  _resetAccountBurst,
  isAccountNearExhaustion,
  PREVENTIVE_QUOTA_THRESHOLD_PCT,
  PREVENTIVE_COOLDOWN_MS,
} from './googlePool';
import { safeWriteHead, safeEnd, parseRetryAfter, proxyLog } from './httpUtils';
import { logTokenUsageEvent } from './remoteState';
import {
  generateGracefulMarkdown,
  emitProxyError,
  buildProxyErrorPayload,
  sendGracefulStreamError,
  sendGracefulNonStreamError,
  sanitizeCandidatesInResponse,
  writeSafeSseChunk,
} from './streamPipeline';
import { executeGoogleCloudCodeWithPool } from './googleCloudEngine';

export type { RetryDispatch, StreamRequestCtx };




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
} from './googlePool';
export type { Google429Category, Google429Decision } from './googlePool';


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
} from './sessionAffinities';

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


export function handleCustomModelRequest(
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
