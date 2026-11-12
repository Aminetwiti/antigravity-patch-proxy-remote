import type * as http from 'http';
import log from 'electron-log';
import type { CustomModel } from '../../../core/types';
import type { GoogleRequestOutcome } from '../direct/types';
import { executeGoogleCloudCodeRequest } from '../direct/singleRequestExecutor';
import {
  normalizeGeminiPayload,
  optimizePayloadContext,
  resolveTargetModelName,
  applyEcoRoutingIfEligible,
  prepareCandidatePayload,
} from '../preparation/payloadPreparation';
import {
  filterAndPrioritizeEligibleAccounts,
  sortCandidateAccounts,
  applyStickySessionAndP2C,
  handleSaturatedCandidateSlots,
} from '../preparation/candidateResolver';
import {
  computeCandidateHeaderTimeout,
  MAX_POOL_LOOP_DURATION_MS,
} from '../preparation/timeoutCalculator';
import { createInitialPoolLoopState } from './types';
import {
  handleRequestSuccess,
  processOutcome429,
  processOutcome403,
  processOutcomeCapacityOrTimeout,
} from './outcomeProcessor';
import {
  attemptThoughtSignatureRepair,
  attemptTokenLimitHistoryTrim,
} from './repairHandler';
import { dispatchWithHedge } from './hedgedDispatcher';
import { attemptFallbackCascade } from './fallbackCascade';
import {
  getValidGoogleAccessToken,
  isGeminiCliModel,
} from '../../../../services/auth/googleAuth';
import {
  isAccountInCooldown,
  getModelQuotaScore,
  isAccountInProbation,
  getAccountInFlight,
  waitForAccountSlot,
  recordAccountRequest,
  incrementAccountInFlight,
  decrementAccountInFlight,
  recordAccountLatency,
  setAccountCooldown,
  getSoonestAccountCooldownRemaining,
  MAX_CONCURRENT_PER_ACCOUNT,
  PREVENTIVE_QUOTA_THRESHOLD_PCT,
} from '../../../resilience/googlePool';
import { getOpenBreaker, recordFailure } from '../../../resilience/circuitBreaker';
import { evictAgent } from '../../../resilience/agentPool';
import { invalidateCachedDns } from '../../../http/dnsResolver';
import { safeWriteHead, safeEnd } from '../../../http/httpUtils';
import {
  sendGracefulStreamError,
  sendGracefulNonStreamError,
  sanitizeCandidatesInResponse,
  writeSafeSseChunk,
} from '../../streamPipeline';
import { sessionAffinities } from '../../../resilience/sessionAffinities';
import { classifyError } from '../../../resilience/errorClassifier';
import { GOOGLE_HOSTS, RATE_LIMIT_RELIEF_WAIT_MS } from '../../../../constants';

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
  reqJson = normalizeGeminiPayload(reqJson);
  reqJson = optimizePayloadContext(reqJson);

  const { targetRaw, resolvedTarget, modelFamily } = resolveTargetModelName(reqJson, accountPool, attemptedModels);

  if (resolvedTarget.includes('argon')) {
    log.warn(`[Proxy] ⛔ Argon model [${resolvedTarget}] cannot be served by multi-account pool. Refusing rotation.`);
    return false;
  }

  applyEcoRoutingIfEligible(reqJson, accountPool, modelFamily, resolvedTarget);

  const { eligibleAccounts, isClaude55 } = filterAndPrioritizeEligibleAccounts(
    accountPool,
    targetRaw,
    resolvedTarget,
    reqJson,
    modelFamily,
  );
  const sortedAccounts = sortCandidateAccounts(eligibleAccounts, modelFamily, isClaude55);
  const boundAccount = applyStickySessionAndP2C(sortedAccounts, sessId, modelFamily);
  await handleSaturatedCandidateSlots(sortedAccounts, modelFamily);

  const state = createInitialPoolLoopState();
  const totalAttempts = sortedAccounts.length;
  const initialHealthyCount = sortedAccounts.filter(
    (a) => !isAccountInCooldown(a, modelFamily) && !getOpenBreaker(a) && getModelQuotaScore(a, modelFamily) > 0,
  ).length;

  if (initialHealthyCount === 0 && sortedAccounts.length > 0) {
    state.lastStatus = 429;
    state.lastErrorText = `All ${sortedAccounts.length} accounts in Google Cloud Code pool are in cooldown or near-exhaustion (<= ${PREVENTIVE_QUOTA_THRESHOLD_PCT}% quota) for ${modelFamily}`;
    log.warn(`[Proxy] All ${sortedAccounts.length} accounts in Google Cloud Code pool are unavailable for ${modelFamily}. Fast-failing.`);
  }

  const poolLoopStartTime = Date.now();
  const useStickySessions = process.env.AG_STICKY_GOOGLE_ACCOUNTS !== '0';

  for (let i = 0; i < sortedAccounts.length && state.networkAttemptCount < totalAttempts; i++) {
    if (initialHealthyCount === 0) break;
    if (Date.now() - poolLoopStartTime >= MAX_POOL_LOOP_DURATION_MS) {
      log.warn(`[Proxy] Account pool loop safety budget reached. Halting account rotation.`);
      if (!state.lastStatus || state.lastStatus === 200) state.lastStatus = 504;
      state.lastErrorText = 'Account pool loop safety budget expired before upstream response';
      break;
    }

    const candidate = sortedAccounts[i];
    const candidateName = candidate.accountEmail || candidate.accountName || candidate.displayName || candidate.name;

    if ((candidate as any).enabled === false || (candidate as any).isValidationRequired || (candidate as any).status === 'validation_required') {
      continue;
    }
    if (isAccountInCooldown(candidate, modelFamily)) {
      const hasOther = sortedAccounts.some((c, idx) => idx !== i && (c as any).enabled !== false && !isAccountInCooldown(c, modelFamily) && getModelQuotaScore(c, modelFamily) > 0);
      if (!hasOther && state.busyEligibleAccountsCount === 0) {
        state.lastStatus = 429;
        state.lastErrorText = `All accounts in pool are in cooldown for ${modelFamily}`;
        break;
      }
      continue;
    }
    if (getModelQuotaScore(candidate, modelFamily) <= 0) {
      const hasOther = sortedAccounts.some((c, idx) => idx !== i && (c as any).enabled !== false && !isAccountInCooldown(c, modelFamily) && getModelQuotaScore(c, modelFamily) > 0);
      if (!hasOther && state.busyEligibleAccountsCount === 0) {
        state.lastStatus = 429;
        state.lastErrorText = `All accounts in pool have exhausted quota for ${modelFamily}`;
        break;
      }
      continue;
    }

    const baseMaxSlots = isAccountInProbation(candidate, modelFamily) ? 1 : MAX_CONCURRENT_PER_ACCOUNT;
    const candidateMaxSlots = fallbackDepth > 0 && !isAccountInProbation(candidate, modelFamily) ? baseMaxSlots + 1 : baseMaxSlots;

    if (getAccountInFlight(candidate) >= candidateMaxSlots) {
      if (boundAccount && candidate === boundAccount) {
        await waitForAccountSlot([candidate], modelFamily, 2500);
      }
      if (getAccountInFlight(candidate) >= candidateMaxSlots) {
        const hasOtherFree = sortedAccounts.some((c) => c !== candidate && (c as any).enabled !== false && !isAccountInCooldown(c, modelFamily) && getModelQuotaScore(c, modelFamily) > 0 && getAccountInFlight(c) < (isAccountInProbation(c, modelFamily) ? 1 : MAX_CONCURRENT_PER_ACCOUNT));
        if (hasOtherFree) {
          if (!state.busyCandidateAccounts.includes(candidate)) state.busyCandidateAccounts.push(candidate);
          continue;
        }
        await waitForAccountSlot(sortedAccounts, modelFamily, 2000);
        if (getAccountInFlight(candidate) >= candidateMaxSlots) {
          state.busyEligibleAccountsCount++;
          if (!state.busyCandidateAccounts.includes(candidate)) state.busyCandidateAccounts.push(candidate);
          if (i === sortedAccounts.length - 1 && state.networkAttemptCount === 0 && !state.hasRetriedBusyPool) {
            state.hasRetriedBusyPool = true;
            const slotFreed = await waitForAccountSlot(state.busyCandidateAccounts, modelFamily, 2500);
            if (slotFreed) {
              state.busyCandidateAccounts.length = 0;
              state.busyEligibleAccountsCount = 0;
              i = -1;
              continue;
            }
          }
          continue;
        }
      }
    }

    const targetModel = candidate.externalModelName || candidate.name;
    const currentFamily = targetModel.toLowerCase().includes('claude') ? 'claude' : (targetModel ? 'gemini' : modelFamily);
    state.networkAttemptCount++;

    let accessToken: string | null = null;
    try {
      accessToken = await getValidGoogleAccessToken(candidate);
    } catch (_) {}
    if (!accessToken) {
      recordFailure(candidate, 'auth');
      continue;
    }

    const updatedBody = prepareCandidatePayload(reqJson, candidate, targetModel, req);
    const authHeader = `Bearer ${accessToken}`;

    state.testedAccountsCount++;
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

    const isUpstreamDegraded = state.consecutive504TimeoutCount > 0 || state.consecutiveTimeoutCount > 0;
    const hostOverride = isGeminiCliModel(candidate)
      ? GOOGLE_HOSTS.CLOUD_CODE_PROD
      : (isUpstreamDegraded ? GOOGLE_HOSTS.CLOUD_CODE_PROD : GOOGLE_HOSTS.CLOUD_CODE);
    const hasOtherCandidates = sortedAccounts.slice(i + 1).some((c) => !isAccountInCooldown(c, modelFamily) && getModelQuotaScore(c, modelFamily) > 0);
    const healthySiblingAccountsCount = sortedAccounts.slice(i + 1).filter((c) => !isAccountInCooldown(c, modelFamily) && getModelQuotaScore(c, modelFamily) >= 50).length;

    const timeoutInfo = computeCandidateHeaderTimeout({
      targetModel,
      updatedBody,
      reqJson,
      targetRaw,
      hasOtherCandidates,
      healthySiblingAccountsCount,
      consecutive504TimeoutCount: state.consecutive504TimeoutCount,
      poolLoopStartTime,
      initialHealthyCount,
      attemptIndex: i,
    });

    if (timeoutInfo.shouldHaltDueToBudget) {
      state.lastStatus = 504;
      state.lastErrorText = timeoutInfo.haltReason || 'Pool loop budget exhausted';
      break;
    }

    const isStreamReq = req.url!.includes('streamGenerateContent') || req.url!.includes('alt=sse');
    const initialTurnsCount = Array.isArray((reqJson.request as any)?.contents || (reqJson as any)?.contents) ? ((reqJson.request as any)?.contents || (reqJson as any)?.contents).length : 0;
    const isHeavyHistory = initialTurnsCount > 40;
    const isFlashThinkingHedgeable = timeoutInfo.isFlashModel && timeoutInfo.isThinkingModel && !timeoutInfo.isLargePayload && !isHeavyHistory;
    const canHedge = isStreamReq && hasOtherCandidates && timeoutInfo.isFlashModel && (!timeoutInfo.isLargePayload || isFlashThinkingHedgeable) && !isHeavyHistory && !res.headersSent && !res.writableEnded;

    let outcome: GoogleRequestOutcome;
    let successfulCandidate = candidate;
    try {
      if (!canHedge) {
        outcome = await executeGoogleCloudCodeRequest(
          req,
          res,
          updatedBody,
          isSessionRemote,
          authHeader,
          convId,
          hostOverride,
          timeoutInfo.poolHeaderTimeout,
          targetModel,
          startReqTime,
          undefined,
          candidate,
        );
      } else {
        const hedged = await dispatchWithHedge({
          req,
          res,
          reqJson,
          updatedBody,
          candidate,
          candidateName,
          targetModel,
          modelFamily,
          currentFamily,
          authHeader,
          convId,
          hostOverride,
          poolHeaderTimeout: timeoutInfo.poolHeaderTimeout,
          startReqTime,
          isSessionRemote,
          isStreamReq,
          isFlashThinkingHedgeable,
          isContextualPayload: timeoutInfo.isContextualPayload,
          sortedAccounts,
          candidateIndex: i,
        });
        outcome = hedged.outcome;
        successfulCandidate = hedged.successfulCandidate;
      }
    } finally {
      const candidateStreamActive = isStreamReq && outcome?.success && successfulCandidate === candidate && !res.writableEnded && !res.destroyed && typeof res.once === 'function';
      if (candidateStreamActive) {
        res.once('finish', () => { recordAccountLatency(candidate, Date.now() - startReqTime); releaseCandidateInFlight(); });
        res.once('close', releaseCandidateInFlight);
      } else {
        releaseCandidateInFlight();
      }
    }

    const elapsedMs = Date.now() - startReqTime;
    if (outcome.success) {
      await handleRequestSuccess(successfulCandidate, currentFamily, targetModel, elapsedMs, sessId, boundAccount, useStickySessions, state);
      return true;
    }

    if (res.headersSent || res.writableEnded) return outcome.success;
    const isClientSocketAlive = !res.writableEnded && !res.destroyed && Boolean(res.socket && !res.socket.destroyed && res.socket.writable !== false);
    if (!isClientSocketAlive) {
      if (outcome.statusCode === 504 || elapsedMs >= timeoutInfo.poolHeaderTimeout) {
        setAccountCooldown(candidate, 30_000, currentFamily, false);
        recordAccountLatency(candidate, Math.min(elapsedMs, 20_000));
      }
      return false;
    }

    if (outcome.statusCode === 499 || (outcome.error && /Client closed request/i.test(outcome.error))) {
      setAccountCooldown(candidate, 60_000, currentFamily, true);
      continue;
    }

    if (outcome.statusCode === 429) {
      const res429 = await processOutcome429(candidate, candidateName, currentFamily, targetModel, outcome, elapsedMs, sessId, sortedAccounts, i, totalAttempts, res, state);
      if (res429.breakLoop) break;
      if (res429.continueNext) continue;
    }

    const repairRes = await attemptThoughtSignatureRepair(req, res, reqJson, candidate, candidateName, currentFamily, targetModel, authHeader, convId, sessId, hostOverride, timeoutInfo.poolHeaderTimeout, startReqTime, isSessionRemote, outcome);
    if (repairRes.success) return true;
    if (repairRes.newOutcome) outcome = repairRes.newOutcome;

    const trimRes = await attemptTokenLimitHistoryTrim(req, res, reqJson, candidate, candidateName, currentFamily, targetModel, authHeader, convId, sessId, hostOverride, timeoutInfo.poolHeaderTimeout, startReqTime, isSessionRemote, outcome);
    if (trimRes) return true;

    state.lastStatus = outcome.statusCode || 500;
    state.lastErrorText = outcome.error || `HTTP ${state.lastStatus}`;

    if (state.lastStatus === 404) break;

    const isTransportError = !!outcome.isTransportError || /ENETUNREACH|EHOSTUNREACH|ENETDOWN|ECONNREFUSED|ECONNABORTED|ECONNRESET|socket hang up|DNS resolution failed/i.test(state.lastErrorText);
    if (state.lastStatus !== 429 && !isTransportError) recordFailure(candidate, 'server');

    if (isTransportError) {
      state.consecutiveTransportErrorCount++;
      try { evictAgent({ host: hostOverride || GOOGLE_HOSTS.CLOUD_CODE }); invalidateCachedDns(hostOverride || GOOGLE_HOSTS.CLOUD_CODE); } catch (_) {}
      await new Promise((r) => setTimeout(r, Math.min(800, 200 * Math.pow(1.4, state.consecutiveTransportErrorCount))));
      if (state.consecutiveTransportErrorCount >= Math.max(4, Math.min(6, sortedAccounts.length))) break;
    } else {
      state.consecutiveTransportErrorCount = 0;
      const resCap = await processOutcomeCapacityOrTimeout(candidate, candidateName, currentFamily, targetModel, elapsedMs, sessId, sortedAccounts, i, timeoutInfo.wasTimeoutCappedByBudget, timeoutInfo.isLargePayload, timeoutInfo.isContextualPayload, timeoutInfo.poolHeaderTimeout, timeoutInfo.poolHeaderTimeout, hostOverride, reqJson, state);
      if (resCap.breakLoop) break;
    }

    if (state.lastStatus === 403) {
      await processOutcome403(candidate, candidateName, modelFamily, sessId, state);
      continue;
    }

    if (state.lastStatus === 402 || (state.lastStatus === 400 && /prepayment.*depleted|credit.*depleted|insufficient.*credit|billing.*closed/i.test(state.lastErrorText))) {
      if (sessId) sessionAffinities.delete(sessId);
      setAccountCooldown(candidate, 24 * 3600 * 1000);
      continue;
    }

    const isPrecondition400 = /failed_precondition|location is not supported|user location|unsupported region|underage|minor/i.test(state.lastErrorText);
    const isThoughtSignature400 = /thought.*signature|signature.*thought|corrupted.*signature|invalid.*signature|invalid.*argument|INVALID_ARGUMENT/i.test(state.lastErrorText);
    if (state.lastStatus === 400 && isPrecondition400) {
      setAccountCooldown(candidate, 24 * 3600 * 1000);
      continue;
    }
    if (state.lastStatus === 400 && !isThoughtSignature400) break;

    if (i + 1 < totalAttempts) await new Promise((r) => setTimeout(r, 50));
  }

  const fallbackSuccess = await attemptFallbackCascade({
    req,
    res,
    reqJson,
    accountPool,
    isSessionRemote,
    convId,
    sessId,
    attemptedModels,
    fallbackDepth,
    lastStatus: state.lastStatus,
    lastErrorText: state.lastErrorText,
    targetRaw,
    poolExecutor: executeGoogleCloudCodeWithPool,
  });
  if (fallbackSuccess) return true;

  if (state.lastStatus === 429 && fallbackDepth === 0 && process.env.AG_DISABLE_RATE_LIMIT_RELIEF !== '1' && process.env.NODE_ENV !== 'test' && !process.env.VITEST && !res.writableEnded && !res.destroyed && Boolean(res.socket && !res.socket.destroyed)) {
    const soonest = getSoonestAccountCooldownRemaining(accountPool, modelFamily, RATE_LIMIT_RELIEF_WAIT_MS);
    if (soonest) {
      const waitMs = soonest.remainingMs > 0 ? Math.min(soonest.remainingMs + 800, RATE_LIMIT_RELIEF_WAIT_MS) : 15_000;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, waitMs);
        if (typeof res?.once === 'function') res.once('close', () => { clearTimeout(timer); resolve(); });
      });
      if (!res.writableEnded && !res.destroyed && Boolean(res.socket && !res.socket.destroyed)) {
        return executeGoogleCloudCodeWithPool(req, res, reqJson, accountPool, isSessionRemote, convId, sessId, attemptedModels, fallbackDepth + 1);
      }
    }
  }

  const reqType = String(reqJson.requestType || (reqJson.request as any)?.requestType || '').toUpperCase();
  if ((reqType === 'SUMMARY' || reqType === 'CONVERSATION_SUMMARY') && !res.writableEnded && !res.destroyed) {
    const summaryCand = { content: { parts: [{ text: 'Summary of previous steps: The agent investigated the task, inspected files, and continues execution.' }], role: 'model' }, finishReason: 'STOP', index: 0 };
    const syntheticChunk = { response: { candidates: [summaryCand] }, candidates: [summaryCand] };
    sanitizeCandidatesInResponse(syntheticChunk);
    if (req.url!.includes('streamGenerateContent') || req.url!.includes('alt=sse')) {
      if (!res.headersSent) safeWriteHead(res, 200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      writeSafeSseChunk(res, syntheticChunk);
      safeEnd(res);
    } else {
      if (!res.headersSent) safeWriteHead(res, 200, { 'Content-Type': 'application/json' });
      safeEnd(res, JSON.stringify(syntheticChunk));
    }
    return true;
  }

  if (!res.writableEnded && !res.destroyed) {
    const isStream = req.url!.includes('streamGenerateContent') || req.url!.includes('alt=sse');
    const requestedName = (typeof reqJson.requestedModel === 'string' && reqJson.requestedModel) ? reqJson.requestedModel : (typeof reqJson.model === 'string' ? reqJson.model : '');
    const failedModel = { ...(sortedAccounts[0] || {}), name: requestedName || 'gemini-3.8-flash-tiered', displayName: requestedName || 'Gemini 3.8 Flash', provider: 'google' } as CustomModel;
    const diagnostic = classifyError(state.lastStatus, state.lastErrorText, undefined, 'google');
    if (!res.headersSent) {
      if (isStream) sendGracefulStreamError(res, diagnostic, failedModel);
      else sendGracefulNonStreamError(res, diagnostic, failedModel);
    } else if (isStream) {
      sendGracefulStreamError(res, diagnostic, failedModel);
    } else {
      safeEnd(res);
    }
  }
  return false;
}
