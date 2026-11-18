import type * as http from 'http';
import log from 'electron-log';
import type { CustomModel } from '../../../../core/types';
import type { GoogleRequestOutcome } from '../../direct/types';
import type { PoolLoopState } from '../types';
import {
  classifyGoogleCloudCode429,
  setAccountCooldown,
  setFleetModelCooldown,
  recordAccountBurst,
  getAccountQuotaKey,
  markAccountQuotaExhausted,
  persistAccountQuotaExhaustedToDisk,
  getModelQuotaScore,
  isAccountInCooldown,
} from '../../../../resilience/pools/googlePool';
import { recordFailure } from '../../../../resilience/circuit/circuitBreaker';
import {
  getLiveAccountQuota,
  updateLiveAccountQuota,
  type AccountLiveQuota,
} from '../../../../../services/auth/googleAuth';
import { sessionAffinities } from '../../../../resilience/pools/sessionAffinities';
import { ROTATION_JITTER_MS } from '../../../../../constants';

function interruptibleDelay(res: http.ServerResponse | any, ms: number): Promise<void> {
  if (!res || res.destroyed || res.writableEnded || (res.socket && res.socket.destroyed)) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    let timer: NodeJS.Timeout | null = null;
    const onClose = () => {
      if (timer) clearTimeout(timer);
      resolve();
    };
    timer = setTimeout(() => {
      if (typeof res?.removeListener === 'function') {
        res.removeListener('close', onClose);
      }
      resolve();
    }, ms);
    if (typeof res?.once === 'function') {
      res.once('close', onClose);
    }
  });
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
      persistAccountQuotaExhaustedToDisk(targetEmail, resetIso, modelFamily);
    }

    const remainingHealthyWithQuota = sortedAccounts.slice(candidateIndex + 1).some(
      (c) => !isAccountInCooldown(c, modelFamily) && getModelQuotaScore(c, modelFamily) > 20,
    );
    const fastFailThreshold = Math.max(3, Math.ceil(sortedAccounts.length * 0.4));
    if (state.consecutiveQuotaExhausted >= fastFailThreshold && !remainingHealthyWithQuota && sortedAccounts.length > 3) {
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

  const dynamicBurstThreshold = process.env.AG_BURST_429_THRESHOLD
    ? Math.max(2, parseInt(process.env.AG_BURST_429_THRESHOLD, 10))
    : Math.max(4, Math.ceil(sortedAccounts.length * 0.4));

  const maxConsecutiveCap = process.env.AG_BURST_429_MAX_CAP
    ? parseInt(process.env.AG_BURST_429_MAX_CAP, 10)
    : 6;

  const hasRemainingHealthy = sortedAccounts.slice(candidateIndex + 1).some(
    (c) => !isAccountInCooldown(c, modelFamily) && (c as any).enabled !== false && getModelQuotaScore(c, modelFamily) > 0,
  );

  const reachedFleetCap = state.consecutive429Count >= maxConsecutiveCap;

  const shouldBreakFleet = (state.consecutive429Count >= dynamicBurstThreshold && !hasRemainingHealthy) || reachedFleetCap;

  if (shouldBreakFleet && sortedAccounts.length > 1) {
    state.lastStatus = 429;
    state.lastErrorText = outcome.error || `HTTP 429 (${decision.reason} across ${state.consecutive429Count} accounts)`;
    log.warn(`[Proxy] 🛑 429 Fleet Circuit Breaker: Model ${targetModel} hit rate limits across ${state.consecutive429Count} accounts. Stopping rotation.`);
    // Enforce fleet-wide cooldown on model and family to prevent subsequent requests from repeating 429 storm
    const fleetCooldownMs = process.env.AG_FLEET_429_COOLDOWN_MS
      ? parseInt(process.env.AG_FLEET_429_COOLDOWN_MS, 10)
      : 30_000;
    setFleetModelCooldown(targetModel, fleetCooldownMs, `Fleet 429 burst across ${state.consecutive429Count} accounts`);
    if (modelFamily) {
      setFleetModelCooldown(modelFamily, Math.min(25_000, fleetCooldownMs), `Fleet 429 burst across ${state.consecutive429Count} accounts`);
    }
    return { breakLoop: true, continueNext: false };
  }

  if (state.consecutive429Count === 3) {
    if (res.destroyed || Boolean(res.socket && res.socket.destroyed)) return { breakLoop: true, continueNext: false };
    log.warn(`[Proxy] ⏳ [IP Throttle Defense] 3 consecutive burst 429s encountered. Applying 2.5s IP token bucket drain...`);
    await interruptibleDelay(res, 2500);
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
      const baseJitter = ROTATION_JITTER_MS;
      const jitterMs =
        baseJitter > 0
          ? baseJitter + Math.floor(Math.random() * 200)
          : state.consecutiveQuotaExhausted > 2
          ? 400 + Math.floor(Math.random() * 300)
          : 0;

      if (jitterMs > 0 && !res.destroyed && Boolean(res.socket && !res.socket.destroyed)) {
        log.info(
          `[Proxy] ⚡ Quota exhausted on [${candidateName}] (${modelFamily}). Anti-cascade jitter ${jitterMs}ms before next account.`,
        );
        await interruptibleDelay(res, jitterMs);
        if (res.destroyed || Boolean(res.socket && res.socket.destroyed)) return { breakLoop: true, continueNext: false };
      } else {
        log.info(`[Proxy] ⚡ Quota exhausted on [${candidateName}] (${modelFamily}). Immediate 0ms rotation.`);
      }
      return { breakLoop: false, continueNext: true };
    }

    const hasAvailableSibling = sortedAccounts.slice(candidateIndex + 1).some(
      (c) => !isAccountInCooldown(c, modelFamily) && (c as any).enabled !== false,
    );
    if (!hasAvailableSibling) {
      const pacingMs = state.consecutive429Count > 1 ? 2000 + Math.floor(Math.random() * 800) : 1000 + Math.floor(Math.random() * 400);
      log.info(`[Proxy] ⏳ [IP Bucket Drain] Pause préventive de ${pacingMs}ms pour vider le seau IP Google.`);
      if (res.destroyed || Boolean(res.socket && res.socket.destroyed)) return { breakLoop: true, continueNext: false };
      await interruptibleDelay(res, pacingMs);
      if (res.destroyed || Boolean(res.socket && res.socket.destroyed)) return { breakLoop: true, continueNext: false };
    }
  }

  return { breakLoop: false, continueNext: true };
}
