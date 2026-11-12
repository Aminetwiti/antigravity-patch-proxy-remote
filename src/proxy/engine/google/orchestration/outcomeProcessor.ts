import type * as http from 'http';
import log from 'electron-log';
import type { CustomModel } from '../../../core/types';
import type { GoogleRequestOutcome } from '../direct/types';
import type { PoolLoopState } from './types';
import {
  clearAccountCooldown,
  endAccountProbation,
  clearAccountBurst,
  classifyGoogleCloudCode429,
  setAccountCooldown,
  recordAccountBurst,
  getAccountQuotaKey,
  markAccountQuotaExhausted,
  persistAccountQuotaExhaustedToDisk,
  getModelQuotaScore,
  isAccountInCooldown,
  isAccountUnlicensed,
  markAccountUnlicensed,
  unmarkAccountUnlicensed,
  recordAccountLatency,
} from '../../../resilience/pools/googlePool';
import { recordSuccess, recordFailure } from '../../../resilience/circuit/circuitBreaker';
import {
  getLiveAccountQuota,
  updateLiveAccountQuota,
  isGoogleCloudCodeModel,
  getValidGoogleAccessToken,
  onboardUserAndAcceptTerms,
  type AccountLiveQuota,
} from '../../../../services/auth/googleAuth';
import { sessionAffinities, bindSessionToModel } from '../../../resilience/pools/sessionAffinities';
import { evictAgent } from '../../../resilience/pools/agentPool';
import { invalidateCachedDns } from '../../../http/dnsResolver';
import { observe as metricObserve } from '../../../../metrics';
import { trimContextPayload } from '../../contextTrimmer';
import { trimOldestHistory } from '../../historyTrimmer';
import { normalizeConversationTurns } from '../../../../services/auth/googleAuth';
import { CAPACITY_503_CASCADE_THRESHOLD, CONSECUTIVE_504_CASCADE_THRESHOLD, GOOGLE_HOSTS } from '../../../../constants';

export async function handleRequestSuccess(
  candidate: CustomModel,
  modelFamily: string,
  targetModel: string,
  elapsedMs: number,
  sessId: string | null,
  boundAccount: CustomModel | undefined,
  useStickySessions: boolean,
  state: PoolLoopState,
): Promise<void> {
  state.consecutiveTimeoutCount = 0;
  state.consecutiveTransportErrorCount = 0;
  state.consecutive503CapacityCount = 0;
  recordSuccess(candidate);
  unmarkAccountUnlicensed(candidate);
  clearAccountCooldown(candidate, modelFamily);
  endAccountProbation(candidate, modelFamily);

  if (sessId && useStickySessions) {
    const existingAffinity = sessionAffinities.get(sessId);
    const isDivertedFromHealthySticky = Boolean(
      boundAccount &&
      candidate !== boundAccount &&
      existingAffinity &&
      existingAffinity.accountKey === getAccountQuotaKey(boundAccount) &&
      !isAccountInCooldown(boundAccount, modelFamily) &&
      !isAccountUnlicensed(boundAccount) &&
      getModelQuotaScore(boundAccount, modelFamily) > 0,
    );
    if (!isDivertedFromHealthySticky) {
      bindSessionToModel(sessId, candidate);
    } else {
      log.debug(`[Proxy] Preserving sticky session binding to [${boundAccount.accountEmail || boundAccount.name}] after concurrency diversion.`);
    }
  }

  clearAccountBurst(candidate);
  log.info(`[Proxy] ✅ [Feedback] Model: [${targetModel}] | Account: [${candidate.accountEmail || candidate.name}] -> HTTP 200 OK (${elapsedMs}ms)`);
}

export async function processOutcome429(
  candidate: CustomModel,
  candidateName: string,
  modelFamily: string,
  targetModel: string,
  outcome: GoogleRequestOutcome,
  elapsedMs: number,
  sessId: string | null,
  sortedAccounts: CustomModel[],
  candidateIndex: number,
  totalAttempts: number,
  res: http.ServerResponse,
  state: PoolLoopState,
): Promise<{ breakLoop: boolean; continueNext: boolean }> {
  state.consecutiveTimeoutCount = 0;
  state.consecutiveTransportErrorCount = 0;
  const retryAfterHeader = outcome.headers?.['retry-after'];
  let decision = classifyGoogleCloudCode429(outcome.error, retryAfterHeader);

  const currentQuotaScore = getModelQuotaScore(candidate, modelFamily);
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
    const existingResetStr = modelFamily === 'claude'
      ? (existingLive?.claudeFiveHourReset || existingLive?.claudeResetTime)
      : (existingLive?.geminiFiveHourReset || existingLive?.geminiResetTime);
    const existingResetTs = existingResetStr ? Date.parse(existingResetStr) : 0;
    const nowMs = Date.now();
    const remainingUntilReset = existingResetTs > nowMs ? existingResetTs - nowMs : 0;

    const effectiveCooldown =
      decision.weeklyResetMs ||
      (decision.cooldownMs > 5 * 60_000
        ? decision.cooldownMs
        : remainingUntilReset > 5 * 60_000
        ? remainingUntilReset
        : 5 * 3600_000);

    decision.cooldownMs = effectiveCooldown;
    decision.reason = decision.reason || `Quota exhausted — ${Math.round(effectiveCooldown / 3600_000)}h cooldown`;
  } else {
    const burstCount = recordAccountBurst(candidate);
    let burstCooldownMs = 10_000;
    if (retryAfterHeader && !isNaN(Number(retryAfterHeader))) {
      const parsedSec = Number(retryAfterHeader);
      if (parsedSec > 0 && parsedSec <= 15) burstCooldownMs = parsedSec * 1000;
      else if (parsedSec > 15) burstCooldownMs = Math.min(60_000, parsedSec * 1000);
    } else if (burstCount === 2) burstCooldownMs = 25_000;
    else if (burstCount === 3) burstCooldownMs = 50_000;
    else if (burstCount >= 4) burstCooldownMs = 100_000;

    decision = {
      category: 'rate_limited',
      cooldownMs: burstCooldownMs,
      reason: `Rate limit 429 (pause isolée ${Math.round(burstCooldownMs / 1000)}s — autres comptes actifs)`,
      isExplicitReset: decision.isExplicitReset,
      rawRetryAfterMs: decision.rawRetryAfterMs,
    };
  }

  log.warn(
    `[Proxy] ⚠️ [Feedback] Model: [${targetModel}] | Account: [${candidateName}] (${modelFamily}) -> HTTP 429 (${decision.category}: ${decision.reason}, cooldown: ${Math.round(decision.cooldownMs / 1000)}s) (${elapsedMs}ms)`,
  );
  const isRateLimit = decision.category === 'rate_limited' || decision.category === 'soft_rate_limit';
  setAccountCooldown(candidate, decision.cooldownMs, modelFamily, isRateLimit);

  if (decision.category === 'quota_exhausted') {
    recordFailure(candidate, 'rate_limit');
    state.consecutiveQuotaExhausted++;
    const liveKey = getAccountQuotaKey(candidate);
    markAccountQuotaExhausted(liveKey, modelFamily);
    const targetEmail = candidate.accountEmail || (candidateName.includes('@') ? candidateName : '');
    if (targetEmail) markAccountQuotaExhausted(targetEmail, modelFamily);
    if (sessId) sessionAffinities.delete(sessId);

    const existingQuota = getLiveAccountQuota(liveKey);
    const rawWeekly = decision.weeklyResetMs || ((decision.rawRetryAfterMs ?? 0) > 24 * 3600 * 1000 ? decision.rawRetryAfterMs! : null);
    const isWeekly = decision.cooldownMs > 24 * 3600 * 1000 || rawWeekly !== null;
    const nowMs = Date.now();
    const weeklyDuration = rawWeekly || decision.cooldownMs;
    const existingResetIso = modelFamily === 'claude'
      ? (existingQuota?.claudeFiveHourReset || existingQuota?.claudeResetTime)
      : (existingQuota?.geminiFiveHourReset || existingQuota?.geminiResetTime);
    const existingResetTs = existingResetIso ? Date.parse(existingResetIso) : 0;
    const cooldownDuration = isWeekly ? weeklyDuration : decision.cooldownMs > 0 ? decision.cooldownMs : 5 * 3600_000;
    const resetIso = existingResetTs > nowMs + 5 * 60_000 && !isWeekly ? existingResetIso! : new Date(nowMs + cooldownDuration).toISOString();

    if (isWeekly) setAccountCooldown(candidate, Math.min(weeklyDuration, 7 * 24 * 3600 * 1000), modelFamily);

    const updatedQ: Partial<AccountLiveQuota> = {
      ...existingQuota,
      fiveHourPercentage: 0,
      weeklyPercentage: isWeekly ? 0 : existingQuota?.weeklyPercentage ?? 100,
      updatedAt: nowMs,
    };
    if (modelFamily === 'gemini') {
      updatedQ.geminiFiveHourPct = 0;
      updatedQ.geminiWeeklyPct = isWeekly ? 0 : existingQuota?.geminiWeeklyPct ?? 100;
      updatedQ.geminiFiveHourReset = resetIso;
      updatedQ.geminiWeeklyReset = isWeekly ? resetIso : existingQuota?.geminiWeeklyReset;
      updatedQ.geminiResetTime = resetIso;
    } else {
      updatedQ.claudeFiveHourPct = 0;
      updatedQ.claudeWeeklyPct = isWeekly ? 0 : existingQuota?.claudeWeeklyPct ?? 100;
      updatedQ.claudeFiveHourReset = resetIso;
      updatedQ.claudeWeeklyReset = isWeekly ? resetIso : existingQuota?.claudeWeeklyReset;
      updatedQ.claudeResetTime = resetIso;
    }
    updateLiveAccountQuota(liveKey, updatedQ as AccountLiveQuota);

    if (targetEmail && (isWeekly || cooldownDuration >= 3600_000)) {
      persistAccountQuotaExhaustedToDisk(targetEmail, resetIso);
    }

    const remainingHealthyWithQuota = sortedAccounts.slice(candidateIndex + 1).some(
      (c) => !isAccountInCooldown(c, modelFamily) && getModelQuotaScore(c, modelFamily) > 20,
    );
    if (state.consecutiveQuotaExhausted >= 3 && !remainingHealthyWithQuota && sortedAccounts.length > 3) {
      state.lastStatus = 429;
      state.lastErrorText = outcome.error || `HTTP 429 (${decision.reason})`;
      log.warn(`[Proxy] Model ${targetModel} hit quota exhaustion across ${state.consecutiveQuotaExhausted} consecutive accounts. Fast-failing pool.`);
      return { breakLoop: true, continueNext: false };
    }
  } else {
    state.consecutiveQuotaExhausted = 0;
  }

  const isGenuineQuotaExhausted = decision.category === 'quota_exhausted';
  if (!isGenuineQuotaExhausted) state.consecutive429Count++;
  else state.consecutive429Count = 0;

  const burst429Threshold = sortedAccounts.length > 4 ? 4 : Math.max(2, sortedAccounts.length);
  if (state.consecutive429Count >= burst429Threshold && sortedAccounts.length > 1) {
    state.lastStatus = 429;
    state.lastErrorText = outcome.error || `HTTP 429 (${decision.reason} across ${state.consecutive429Count} accounts)`;
    log.warn(`[Proxy] 🛑 429 Fleet Circuit Breaker: Model ${targetModel} hit rate limits across ${state.consecutive429Count} accounts. Stopping rotation.`);
    return { breakLoop: true, continueNext: false };
  }

  if (state.consecutive429Count === 3) {
    if (res.destroyed || Boolean(res.socket && res.socket.destroyed)) return { breakLoop: true, continueNext: false };
    log.warn(`[Proxy] ⏳ [IP Throttle Defense] 3 consecutive burst 429s encountered. Applying 2.5s IP token bucket drain...`);
    await new Promise((r) => setTimeout(r, 2500));
    if (res.destroyed || Boolean(res.socket && res.socket.destroyed)) return { breakLoop: true, continueNext: false };
  }

  state.lastStatus = 429;
  state.lastErrorText = outcome.error || `HTTP 429 (${decision.reason})`;

  const hasEligibleRemaining = sortedAccounts.slice(candidateIndex + 1).some((c) => !isAccountInCooldown(c, modelFamily));
  if (!hasEligibleRemaining && state.busyEligibleAccountsCount === 0) {
    log.warn(`[Proxy] No remaining healthy accounts left in pool for ${modelFamily}. Fast-failing pool.`);
    return { breakLoop: true, continueNext: false };
  }

  if (candidateIndex + 1 < totalAttempts) {
    if (isGenuineQuotaExhaustion || decision.category === 'quota_exhausted') {
      log.info(`[Proxy] ⚡ Quota exhausted on [${candidateName}] (${modelFamily}). Immediate 0ms rotation.`);
      return { breakLoop: false, continueNext: true };
    }

    const hasAvailableSibling = sortedAccounts.slice(candidateIndex + 1).some(
      (c) => !isAccountInCooldown(c, modelFamily) && !isAccountUnlicensed(c) && (c as any).enabled !== false,
    );
    if (!hasAvailableSibling) {
      const pacingMs = state.consecutive429Count > 1 ? 2000 + Math.floor(Math.random() * 800) : 1000 + Math.floor(Math.random() * 400);
      log.info(`[Proxy] ⏳ [IP Bucket Drain] Pause préventive de ${pacingMs}ms pour vider le seau IP Google.`);
      if (res.destroyed || Boolean(res.socket && res.socket.destroyed)) return { breakLoop: true, continueNext: false };
      await new Promise((r) => setTimeout(r, pacingMs));
      if (res.destroyed || Boolean(res.socket && res.socket.destroyed)) return { breakLoop: true, continueNext: false };
    }
  }

  return { breakLoop: false, continueNext: true };
}

export async function processOutcome403(
  candidate: CustomModel,
  candidateName: string,
  modelFamily: string,
  sessId: string | null,
  state: PoolLoopState,
): Promise<void> {
  if (sessId) sessionAffinities.delete(sessId);
  const isValidationRequired = /validation_required|verify.*account|verification.*required/i.test(state.lastErrorText);
  const isLicenseError = /license|licens|permission|unauthorized|forbidden|not have a valid|account.*restricted|restricted|unavailable tier|suspended|denied access/i.test(state.lastErrorText) || isValidationRequired;

  if (isValidationRequired && isGoogleCloudCodeModel(candidate)) {
    let validationUrl = '';
    try {
      const parsed = JSON.parse(state.lastErrorText);
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
      log.warn(`[Proxy] Account ${candidateName} encountered VALIDATION_REQUIRED. Triggering automatic background onboarding...`);
    }

    getValidGoogleAccessToken(candidate).then((token) => {
      if (token) onboardUserAndAcceptTerms(token).catch(() => {});
    }).catch(() => {});
  }

  const quarantineMs = isLicenseError ? 7 * 24 * 3600 * 1000 : 24 * 3600 * 1000;
  log.warn(`[Proxy] Account ${candidateName} received HTTP 403. Placing in ${Math.round(quarantineMs / 3600000)}h quarantine.`);
  if (isLicenseError) markAccountUnlicensed(candidate);
  setAccountCooldown(candidate, quarantineMs);
  setAccountCooldown(candidate, quarantineMs, 'gemini');
  setAccountCooldown(candidate, quarantineMs, 'claude');
  if (modelFamily) setAccountCooldown(candidate, quarantineMs, modelFamily);
}

export async function processOutcomeCapacityOrTimeout(
  candidate: CustomModel,
  candidateName: string,
  modelFamily: string,
  targetModel: string,
  elapsedMs: number,
  sessId: string | null,
  sortedAccounts: CustomModel[],
  candidateIndex: number,
  wasTimeoutCappedByBudget: boolean,
  isLargePayload: boolean,
  isContextualPayload: boolean,
  poolHeaderTimeout: number,
  baseCandidateTimeout: number,
  hostOverride: string | undefined,
  reqJson: Record<string, unknown>,
  state: PoolLoopState,
): Promise<{ breakLoop: boolean }> {
  const isCapacityExhausted =
    state.lastStatus === 503 ||
    /MODEL_CAPACITY_EXHAUSTED|no capacity available|overloaded|unavailable/i.test(state.lastErrorText);

  if (isCapacityExhausted) {
    state.consecutive503CapacityCount++;
    const capacityThreshold = Math.min(CAPACITY_503_CASCADE_THRESHOLD, Math.max(2, Math.ceil(sortedAccounts.length * 0.5)));
    log.warn(`[Proxy] ⚠️ Account [${candidateName}] hit MODEL_CAPACITY_EXHAUSTED / 503 Overload for [${targetModel}]. Placing in 45s cooldown.`);
    setAccountCooldown(candidate, 45_000, modelFamily, true);
    recordAccountLatency(candidate, 45_000);

    const combinedOutageCount = state.consecutive503CapacityCount + state.consecutive504TimeoutCount;
    if (state.consecutive503CapacityCount >= capacityThreshold || combinedOutageCount >= Math.max(2, capacityThreshold)) {
      log.warn(`[Proxy] ⚠️ Global TPU/Cluster Capacity Exhaustion detected on [${targetModel}]. Triggering immediate cascade...`);
      state.lastStatus = 503;
      state.lastErrorText = `Google Cloud Code API capacity unavailable across ${state.consecutive503CapacityCount} consecutive accounts`;
      return { breakLoop: true };
    }
    return { breakLoop: false };
  }

  const isServerOutage =
    state.lastStatus === 500 ||
    state.lastStatus === 502 ||
    state.lastStatus === 503 ||
    state.lastStatus === 504 ||
    /timed out|unavailable|overloaded|service unavailable|backend error|internal error/i.test(state.lastErrorText);

  if (isServerOutage) {
    state.consecutiveTimeoutCount++;
    const maxOutageLimit = Math.max(4, Math.min(6, Math.ceil(sortedAccounts.length * 0.4)));
    const configuredOutage = Number(process.env.AG_OUTAGE_CONSECUTIVE_TIMEOUTS || 0);
    const upstreamOutageThreshold = configuredOutage >= 4 ? configuredOutage : maxOutageLimit;
    const isUpstreamOutage = state.consecutiveTimeoutCount >= upstreamOutageThreshold;
    const timeoutCooldownMs = state.lastStatus === 500 ? 20_000 : state.lastStatus === 504 ? 60_000 : isUpstreamOutage ? 45_000 : 30_000;
    const isPayloadInducedTimeout = state.lastStatus === 504 && (isLargePayload || isContextualPayload || state.consecutive504TimeoutCount > 0);
    const isCappedTimeout = wasTimeoutCappedByBudget || (state.lastStatus === 504 && poolHeaderTimeout < baseCandidateTimeout);

    if (state.lastStatus === 504) {
      const cooldownDuration = isPayloadInducedTimeout ? 15_000 : 60_000;
      setAccountCooldown(candidate, cooldownDuration, modelFamily, false);
      metricObserve('proxy_upstream_ms', elapsedMs, { upstream: hostOverride || 'cloudcode', status: '504', type: 'raw' });
      recordAccountLatency(candidate, isCappedTimeout || isPayloadInducedTimeout ? Math.min(elapsedMs, 25_000) : 60_000);
      if (sessId) sessionAffinities.delete(sessId);

      const reqObj = (reqJson.request || reqJson) as any;
      if (Array.isArray(reqObj?.contents) && reqObj.contents.length > 4) {
        trimContextPayload(reqJson as any);
        const didTrim = trimOldestHistory(reqJson, 30);
        if (didTrim) {
          state.consecutive504TimeoutCount = Math.min(state.consecutive504TimeoutCount, 1);
        }
        normalizeConversationTurns(reqObj.contents);
      }
    } else {
      setAccountCooldown(candidate, timeoutCooldownMs, modelFamily, true);
    }

    const remainingHealthyWithQuota = sortedAccounts.slice(candidateIndex + 1).some(
      (c) => !isAccountInCooldown(c, modelFamily) && getModelQuotaScore(c, modelFamily) > 0,
    );
    if (isUpstreamOutage && !remainingHealthyWithQuota) {
      state.lastErrorText = `Google Cloud Code API upstream failure (HTTP ${state.lastStatus}) across ${state.consecutiveTimeoutCount} accounts`;
      return { breakLoop: true };
    }

    if (state.lastStatus === 504 || /timed out|deadline exceeded|gateway timeout/i.test(state.lastErrorText)) {
      state.consecutive504TimeoutCount++;
      const combinedOutageCount = state.consecutive504TimeoutCount + state.consecutive503CapacityCount;
      const dynamicPoolThreshold = Math.min(CONSECUTIVE_504_CASCADE_THRESHOLD, Math.max(3, Math.ceil(sortedAccounts.length * 0.25)));
      if (state.consecutive504TimeoutCount >= dynamicPoolThreshold || combinedOutageCount >= dynamicPoolThreshold) {
        state.lastStatus = 504;
        state.lastErrorText = `Google Cloud Code API gateway timeout (504) across ${state.consecutive504TimeoutCount} consecutive accounts`;
        return { breakLoop: true };
      }
    }
  } else {
    state.consecutiveTimeoutCount = 0;
    state.consecutive504TimeoutCount = 0;
  }

  return { breakLoop: false };
}
