import type * as http from 'http';
import log from 'electron-log';
import type { CustomModel } from '../../../../core/types';
import type { GoogleRequestOutcome } from '../../direct/types';
import { executeGoogleCloudCodeRequest } from '../../direct/singleRequestExecutor';
import {
  normalizeGeminiPayload,
  optimizePayloadContext,
  resolveTargetModelName,
  applyEcoRoutingIfEligible,
  prepareCandidatePayload,
  filterAndPrioritizeEligibleAccounts,
  sortCandidateAccounts,
  applyStickySessionAndP2C,
  shouldSkipSaturatedCandidate,
  computeCandidateHeaderTimeout,
  MAX_POOL_LOOP_DURATION_MS,
} from '../../preparation';
import { createInitialPoolLoopState } from '../types';
import {
  handleRequestSuccess,
  processOutcome429,
  processOutcome403,
  processOutcomeCapacityOrTimeout,
} from '../outcomes';
import { attemptThoughtSignatureRepair, attemptTokenLimitHistoryTrim } from './repairHandler';
import { dispatchWithHedge } from './hedgedDispatcher';
import { attemptFallbackCascade } from '../fallback';
import { handleSyntheticSummaryIfRequested, handleTerminalGracefulError } from './syntheticHandler';
import { getValidGoogleAccessToken, isGeminiCliModel } from '../../../../../services/auth/googleAuth';
import {
  isAccountInCooldown,
  getModelQuotaScore,
  recordAccountRequest,
  incrementAccountInFlight,
  decrementAccountInFlight,
  recordAccountLatency,
  setAccountCooldown,
  getSoonestAccountCooldownRemaining,
} from '../../../../resilience/googlePool';
import { getOpenBreaker, recordFailure } from '../../../../resilience/circuitBreaker';
import { evictAgent } from '../../../../resilience/agentPool';
import { invalidateCachedDns } from '../../../../http/dnsResolver';
import { sessionAffinities } from '../../../../resilience/sessionAffinities';
import { GOOGLE_HOSTS, RATE_LIMIT_RELIEF_WAIT_MS, MAX_RELIEF_WAIT_MS } from '../../../../../constants';

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
    log.warn(`[Proxy] ⛔ Argon model [${resolvedTarget}] cannot be served by multi-account pool.`);
    return false;
  }
  applyEcoRoutingIfEligible(reqJson, accountPool, modelFamily, resolvedTarget);

  const { eligibleAccounts, isClaude55 } = filterAndPrioritizeEligibleAccounts(accountPool, targetRaw, resolvedTarget, reqJson, modelFamily);
  const sortedAccounts = sortCandidateAccounts(eligibleAccounts, modelFamily, isClaude55);
  const boundAccount = applyStickySessionAndP2C(sortedAccounts, sessId, modelFamily);

  const state = createInitialPoolLoopState();
  const totalAttempts = sortedAccounts.length;
  const initialHealthyCount = sortedAccounts.filter((a) => !isAccountInCooldown(a, modelFamily) && !getOpenBreaker(a) && getModelQuotaScore(a, modelFamily) > 0).length;
  const allowOptimisticProbe = initialHealthyCount === 0 && sortedAccounts.length > 0;

  if (initialHealthyCount === 0 && sortedAccounts.length > 0) {
    state.lastStatus = 429;
    state.lastErrorText = `All ${sortedAccounts.length} accounts in Google Cloud Code pool are unavailable for ${modelFamily}`;
    if (allowOptimisticProbe) {
      log.info(`[Proxy] ⚡ All accounts marked exhausted/in cooldown for ${modelFamily}. Engaging optimistic probe on top candidate(s) to verify actual upstream status.`);
    }
  }

  const poolLoopStartTime = Date.now();
  const useStickySessions = process.env.AG_STICKY_GOOGLE_ACCOUNTS !== '0';

  for (let i = 0; i < sortedAccounts.length && state.networkAttemptCount < totalAttempts; i++) {
    if (initialHealthyCount === 0 && !allowOptimisticProbe) break;
    if (allowOptimisticProbe && state.networkAttemptCount >= 2) break;
    if (Date.now() - poolLoopStartTime >= MAX_POOL_LOOP_DURATION_MS) {
      if (!state.lastStatus || state.lastStatus === 200) state.lastStatus = 504;
      state.lastErrorText = 'Account pool loop safety budget expired before upstream response';
      break;
    }

    const candidate = sortedAccounts[i];
    const candidateName = candidate.accountEmail || candidate.accountName || candidate.displayName || candidate.name;
    if ((candidate as any).enabled === false || (candidate as any).isValidationRequired || (candidate as any).status === 'validation_required') continue;
    if (!allowOptimisticProbe && (isAccountInCooldown(candidate, modelFamily) || getModelQuotaScore(candidate, modelFamily) <= 0)) continue;

    const skipSaturated = await shouldSkipSaturatedCandidate(candidate, modelFamily, fallbackDepth, boundAccount, sortedAccounts, state.busyCandidateAccounts);
    if (skipSaturated) {
      state.busyEligibleAccountsCount++;
      continue;
    }

    const targetModel = candidate.externalModelName || candidate.name;
    const currentFamily = targetModel.toLowerCase().includes('claude') ? 'claude' : (targetModel ? 'gemini' : modelFamily);
    state.networkAttemptCount++;

    let accessToken: string | null = null;
    try { accessToken = await getValidGoogleAccessToken(candidate); } catch (_) {}
    if (!accessToken) { recordFailure(candidate, 'auth'); continue; }

    const updatedBody = prepareCandidatePayload(reqJson, candidate, targetModel, req);
    const authHeader = `Bearer ${accessToken}`;

    state.testedAccountsCount++;
    recordAccountRequest(candidate);
    incrementAccountInFlight(candidate);
    const startReqTime = Date.now();
    let inFlightReleased = false;
    const releaseInFlight = () => {
      if (!inFlightReleased) {
        inFlightReleased = true;
        decrementAccountInFlight(candidate);
      }
    };

    const isUpstreamDegraded = state.consecutive504TimeoutCount > 0 || state.consecutiveTimeoutCount > 0;
    const hostOverride = isGeminiCliModel(candidate) ? GOOGLE_HOSTS.CLOUD_CODE_PROD : (isUpstreamDegraded ? GOOGLE_HOSTS.CLOUD_CODE_PROD : GOOGLE_HOSTS.CLOUD_CODE);
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
    const turnsCount = Array.isArray((reqJson.request as any)?.contents || (reqJson as any)?.contents) ? ((reqJson.request as any)?.contents || (reqJson as any)?.contents).length : 0;
    const isFlashThinkingHedgeable = timeoutInfo.isFlashModel && timeoutInfo.isThinkingModel && !timeoutInfo.isLargePayload && turnsCount <= 40;
    const canHedge = isStreamReq && hasOtherCandidates && timeoutInfo.isFlashModel && (!timeoutInfo.isLargePayload || isFlashThinkingHedgeable) && turnsCount <= 40 && !res.headersSent && !res.writableEnded;

    let outcome: GoogleRequestOutcome;
    let successfulCandidate = candidate;
    try {
      if (!canHedge) {
        outcome = await executeGoogleCloudCodeRequest(req, res, updatedBody, isSessionRemote, authHeader, convId, hostOverride, timeoutInfo.poolHeaderTimeout, targetModel, startReqTime, undefined, candidate);
      } else {
        const hedged = await dispatchWithHedge({ req, res, reqJson, updatedBody, candidate, candidateName, targetModel, modelFamily, currentFamily, authHeader, convId, hostOverride, poolHeaderTimeout: timeoutInfo.poolHeaderTimeout, startReqTime, isSessionRemote, isStreamReq, isFlashThinkingHedgeable, isContextualPayload: timeoutInfo.isContextualPayload, sortedAccounts, candidateIndex: i });
        outcome = hedged.outcome;
        successfulCandidate = hedged.successfulCandidate;
      }
    } finally {
      const isStreamActive = isStreamReq && outcome?.success && successfulCandidate === candidate && !res.writableEnded && !res.destroyed && typeof res.once === 'function';
      if (isStreamActive) {
        res.once('finish', () => { recordAccountLatency(candidate, Date.now() - startReqTime); releaseInFlight(); });
        res.once('close', releaseInFlight);
      } else {
        releaseInFlight();
      }
    }

    const elapsedMs = Date.now() - startReqTime;
    if (outcome.success) {
      await handleRequestSuccess(successfulCandidate, currentFamily, targetModel, elapsedMs, sessId, boundAccount, useStickySessions, state);
      return true;
    }

    if (res.headersSent || res.writableEnded) return outcome.success;
    const isSocketAlive = !res.writableEnded && !res.destroyed && Boolean(res.socket && !res.socket.destroyed && res.socket.writable !== false);
    if (!isSocketAlive) {
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
      if (res429.continueNext) {
        // Anti-burst jitter to prevent triggering Google Edge velocity/scraping heuristics (Issue #408)
        await new Promise((r) => setTimeout(r, Math.floor(150 + Math.random() * 200)));
        continue;
      }
    }

    const sigRes = await attemptThoughtSignatureRepair(req, res, reqJson, candidate, candidateName, currentFamily, targetModel, authHeader, convId, sessId, hostOverride, timeoutInfo.poolHeaderTimeout, startReqTime, isSessionRemote, outcome);
    if (sigRes.success) return true;
    if (sigRes.newOutcome) outcome = sigRes.newOutcome;

    const trimRes = await attemptTokenLimitHistoryTrim(req, res, reqJson, candidate, candidateName, currentFamily, targetModel, authHeader, convId, sessId, hostOverride, timeoutInfo.poolHeaderTimeout, startReqTime, isSessionRemote, outcome);
    if (trimRes) return true;

    state.lastStatus = outcome.statusCode || 500;
    state.lastErrorText = outcome.error || `HTTP ${state.lastStatus}`;
    if (state.lastStatus === 404) break;

    const isTransport = !!outcome.isTransportError || /ENETUNREACH|EHOSTUNREACH|ENETDOWN|ECONNREFUSED|ECONNABORTED|ECONNRESET|socket hang up|DNS resolution failed/i.test(state.lastErrorText);
    if (state.lastStatus !== 429 && !isTransport) recordFailure(candidate, 'server');

    if (isTransport) {
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

    const isPrecon400 = /failed_precondition|location is not supported|user location|unsupported region|underage|minor/i.test(state.lastErrorText);
    const isSig400 = /thought.*signature|signature.*thought|corrupted.*signature|invalid.*signature|invalid.*argument|INVALID_ARGUMENT/i.test(state.lastErrorText);
    if (state.lastStatus === 400 && isPrecon400) {
      setAccountCooldown(candidate, 24 * 3600 * 1000);
      continue;
    }
    if (state.lastStatus === 400 && !isSig400) break;
    if (i + 1 < totalAttempts) await new Promise((r) => setTimeout(r, 50));
  }

  const fbOk = await attemptFallbackCascade({
    req, res, reqJson, accountPool, isSessionRemote, convId, sessId, attemptedModels, fallbackDepth,
    lastStatus: state.lastStatus, lastErrorText: state.lastErrorText, targetRaw, poolExecutor: executeGoogleCloudCodeWithPool,
  });
  if (fbOk) return true;

  if (state.lastStatus === 429 && fallbackDepth === 0 && process.env.AG_DISABLE_RATE_LIMIT_RELIEF !== '1' && process.env.NODE_ENV !== 'test' && !process.env.VITEST && !res.writableEnded && !res.destroyed && Boolean(res.socket && !res.socket.destroyed)) {
    const elapsedSoFar = Date.now() - poolLoopStartTime;
    const maxReliefWaitMs = Math.min(MAX_RELIEF_WAIT_MS, RATE_LIMIT_RELIEF_WAIT_MS);
    if (elapsedSoFar < 50_000) {
      const soonest = getSoonestAccountCooldownRemaining(accountPool, modelFamily, maxReliefWaitMs);
      if (soonest && soonest.remainingMs > 0 && (elapsedSoFar + soonest.remainingMs) < 65_000) {
        const waitMs = Math.min(soonest.remainingMs + 800, maxReliefWaitMs);
        log.info(`[Proxy] ⏳ All accounts rate-limited for ${modelFamily}. Soonest cooldown expires in ${Math.round(waitMs / 1000)}s (${soonest.candidate.accountEmail || soonest.candidate.name}). Waiting for relief...`);
        await new Promise<void>((resolve) => {
          let timer: NodeJS.Timeout | null = null;
          const onClose = () => {
            if (timer) clearTimeout(timer);
            resolve();
          };
          timer = setTimeout(() => {
            if (typeof res?.removeListener === 'function') res.removeListener('close', onClose);
            resolve();
          }, waitMs);
          if (typeof res?.once === 'function') res.once('close', onClose);
        });
        if (!res.writableEnded && !res.destroyed && Boolean(res.socket && !res.socket.destroyed)) {
          return executeGoogleCloudCodeWithPool(req, res, reqJson, accountPool, isSessionRemote, convId, sessId, attemptedModels, fallbackDepth + 1);
        }
      }
    }
  }

  if (handleSyntheticSummaryIfRequested(req, res, reqJson)) return true;
  handleTerminalGracefulError(req, res, reqJson, sortedAccounts, state.lastStatus, state.lastErrorText);
  return false;
}
