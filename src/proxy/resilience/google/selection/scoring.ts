import type { CustomModel } from '../../../core/types';
import {
  isGoogleCloudCodeModel,
  isGeminiCliModel,
  isTokenRevoked,
  getLiveAccountQuota,
} from '../../../../services/auth/googleAuth';
import {
  PREVENTIVE_QUOTA_THRESHOLD_PCT,
  PREVENTIVE_COOLDOWN_MS,
} from '../../../../constants';
import { getOpenBreaker } from '../../circuit/circuitBreaker';
import { getAccountQuotaKey } from '../identity/accountKeys';
import { isAccountUnlicensed } from '../identity/licensing';
import { isAccountInCooldown } from '../cooldown/cooldownRegistry';
import { isAccountInProbation } from '../cooldown/probationRegistry';
import { getAccountInFlight, MAX_CONCURRENT_PER_ACCOUNT } from '../concurrency/inFlightManager';
import { getAccountAvgLatency } from '../concurrency/latencyTracker';
import { getAccountRpmCount, getAccountBurstCount } from '../concurrency/rateLimiter';

export { PREVENTIVE_QUOTA_THRESHOLD_PCT, PREVENTIVE_COOLDOWN_MS };

/**
 * Checks whether an account is near quota exhaustion (at or below PREVENTIVE_QUOTA_THRESHOLD_PCT).
 * Used to avoid selecting this account when healthier alternatives exist, protecting against
 * Google's 7-day (167-hour) hard lockout.
 */
export function isAccountNearExhaustion(candidate: CustomModel, modelFamily?: string): boolean {
  if (!candidate) return false;
  const key = getAccountQuotaKey(candidate);
  const live = getLiveAccountQuota(key);
  const q = (live || candidate.quotas) as Record<string, any> | undefined;
  if (!q) return false;

  const isArgon = modelFamily
    ? modelFamily.toLowerCase().includes('argon')
    : (candidate.externalModelName || candidate.name || '').toLowerCase().includes('argon');
  const isClaude = !isArgon && (modelFamily
    ? modelFamily.toLowerCase().includes('claude')
    : (candidate.externalModelName || candidate.name || '').toLowerCase().includes('claude'));

  const fiveHour = isArgon
    ? (typeof q.argonFiveHourPct === 'number'
        ? q.argonFiveHourPct
        : (typeof q.geminiFiveHourPct === 'number'
          ? q.geminiFiveHourPct
          : (typeof q.fiveHourPercentage === 'number' ? q.fiveHourPercentage : 100)))
    : (isClaude
      ? (typeof q.claudeFiveHourPct === 'number' ? q.claudeFiveHourPct : 0)
      : (typeof q.geminiFiveHourPct === 'number'
        ? q.geminiFiveHourPct
        : (typeof q.fiveHourPercentage === 'number' ? q.fiveHourPercentage : 100)));

  const weekly = isArgon
    ? (typeof q.argonWeeklyPct === 'number'
        ? q.argonWeeklyPct
        : (typeof q.geminiWeeklyPct === 'number'
          ? q.geminiWeeklyPct
          : (typeof q.weeklyPercentage === 'number' ? q.weeklyPercentage : 100)))
    : (typeof (isClaude ? q.claudeWeeklyPct : q.geminiWeeklyPct) === 'number'
      ? (isClaude ? q.claudeWeeklyPct : q.geminiWeeklyPct)
      : typeof q.weeklyPercentage === 'number'
        ? q.weeklyPercentage
        : 100);

  const now = Date.now();
  const fiveHourResetStr = isArgon
    ? (q.argonFiveHourReset || q.geminiFiveHourReset || q.fiveHourResetTime)
    : (isClaude ? q.claudeFiveHourReset : (q.geminiFiveHourReset || q.fiveHourResetTime));
  const fiveHourResetTs = fiveHourResetStr ? new Date(fiveHourResetStr).getTime() : 0;
  const fiveHourResetPassed = Boolean(fiveHourResetTs > 0 && (!q.updatedAt || fiveHourResetTs > q.updatedAt) && fiveHourResetTs <= now);

  const weeklyResetStr = isArgon
    ? (q.argonWeeklyReset || q.geminiWeeklyReset || q.weeklyResetTime)
    : (isClaude ? q.claudeWeeklyReset : (q.geminiWeeklyReset || q.weeklyResetTime));
  const weeklyResetTs = weeklyResetStr ? new Date(weeklyResetStr).getTime() : 0;
  const weeklyResetPassed = Boolean(weeklyResetTs > 0 && (!q.updatedAt || weeklyResetTs > q.updatedAt) && weeklyResetTs <= now);

  const isWeeklyDepleted = typeof weekly === 'number' && weekly <= PREVENTIVE_QUOTA_THRESHOLD_PCT && !weeklyResetPassed;
  const isFiveHourDepleted = typeof fiveHour === 'number' && fiveHour <= PREVENTIVE_QUOTA_THRESHOLD_PCT && !fiveHourResetPassed;

  return isWeeklyDepleted || isFiveHourDepleted;
}

/**
 * Evaluates whether an account is healthy, eligible, and available to be pooled/dispatched.
 * Accounts requiring challenge validation, in active cooldown, suspended, or at 0% quota
 * are strictly disqualified.
 */
export function isAccountEligibleForPool(candidate: CustomModel, modelFamily = 'gemini'): boolean {
  if (!candidate) return false;
  if ((candidate as any).enabled === false) return false;
  if (
    (candidate as any).isValidationRequired === true ||
    (candidate as any).status === 'validation_required' ||
    (candidate as any).errorDetails?.status === 'VALIDATION_REQUIRED'
  ) return false;
  if (isAccountUnlicensed(candidate)) return false;
  if (isAccountInCooldown(candidate, modelFamily)) return false;
  if (getOpenBreaker(candidate)) return false;
  if (getModelQuotaScore(candidate, modelFamily) <= 0) return false;
  return true;
}

export function getModelQuotaScore(m: CustomModel, modelFamily?: string): number {
  if (isGoogleCloudCodeModel(m) && !m.refreshToken && (!m.apiKey || !m.apiKey.startsWith('ya29.'))) {
    return 0;
  }
  if ((m as any).enabled === false || isAccountUnlicensed(m)) {
    return 0;
  }
  const key = getAccountQuotaKey(m);
  const live = getLiveAccountQuota(key);
  const q = (live || m.quotas) as Record<string, any> | undefined;
  if (!q) {
    const isAiStudioKey = m.apiKey && (m.apiKey.startsWith('AIzaSy') || m.apiKey.startsWith('AQ'));
    return isAiStudioKey ? 25 : 50;
  }
  if (q.isUnlicensed) {
    return 0;
  }

  const isArgon = modelFamily
    ? modelFamily.toLowerCase().includes('argon')
    : (m.externalModelName || m.name || '').toLowerCase().includes('argon');

  const isClaude = !isArgon && (modelFamily
    ? modelFamily.toLowerCase().includes('claude')
    : (m.externalModelName || m.name || '').toLowerCase().includes('claude'));

  const fiveHour = isArgon
    ? (typeof q.argonFiveHourPct === 'number'
        ? q.argonFiveHourPct
        : (typeof q.geminiFiveHourPct === 'number'
          ? q.geminiFiveHourPct
          : (typeof q.fiveHourPercentage === 'number' ? q.fiveHourPercentage : 50)))
    : (isClaude
      ? (typeof q.claudeFiveHourPct === 'number' ? q.claudeFiveHourPct : 0)
      : (typeof q.geminiFiveHourPct === 'number'
        ? q.geminiFiveHourPct
        : (typeof q.fiveHourPercentage === 'number' ? q.fiveHourPercentage : 50)));

  const weekly = isArgon
    ? (typeof q.argonWeeklyPct === 'number'
        ? q.argonWeeklyPct
        : (typeof q.geminiWeeklyPct === 'number'
          ? q.geminiWeeklyPct
          : (typeof q.weeklyPercentage === 'number' ? q.weeklyPercentage : 50)))
    : (isClaude
      ? (typeof q.claudeWeeklyPct === 'number' ? q.claudeWeeklyPct : 0)
      : (typeof q.geminiWeeklyPct === 'number'
        ? q.geminiWeeklyPct
        : (typeof q.weeklyPercentage === 'number' ? q.weeklyPercentage : 50)));

  const now = Date.now();
  const fiveHourResetStr = isArgon
    ? (q.argonFiveHourReset || q.geminiFiveHourReset || q.fiveHourResetTime)
    : (isClaude ? q.claudeFiveHourReset : (q.geminiFiveHourReset || q.fiveHourResetTime));
  const fiveHourResetTs = fiveHourResetStr ? new Date(fiveHourResetStr).getTime() : 0;
  const fiveHourResetPassed = Boolean(fiveHourResetTs > 0 && fiveHourResetTs <= now);

  const weeklyResetStr = isArgon
    ? (q.argonWeeklyReset || q.geminiWeeklyReset || q.weeklyResetTime)
    : (isClaude ? q.claudeWeeklyReset : (q.geminiWeeklyReset || q.weeklyResetTime));
  const weeklyResetTs = weeklyResetStr ? new Date(weeklyResetStr).getTime() : 0;
  const weeklyResetPassed = Boolean(weeklyResetTs > 0 && weeklyResetTs <= now);

  const quotaAge = now - (typeof q.updatedAt === 'number' ? q.updatedAt : 0);
  const FIVE_H_WINDOW_MS = 18_900_000;
  const quotaIsStaleWindow = quotaAge >= FIVE_H_WINDOW_MS;

  if (fiveHour <= 0 && !fiveHourResetPassed) {
    if (!fiveHourResetStr && typeof q.updatedAt === 'number' && q.updatedAt > 0 && quotaIsStaleWindow) return 20;
    return 0;
  }
  if (weekly <= 0 && !weeklyResetPassed) return 0;

  if (typeof weekly === 'number' && weekly <= PREVENTIVE_QUOTA_THRESHOLD_PCT && !weeklyResetPassed) {
    return 0;
  }
  if (typeof fiveHour === 'number' && fiveHour <= PREVENTIVE_QUOTA_THRESHOLD_PCT && !fiveHourResetPassed) {
    return 0;
  }

  const effFiveHour = (fiveHour <= 0 && fiveHourResetPassed) ? 50 : fiveHour;
  const effWeekly = (weekly <= 0 && weeklyResetPassed) ? 50 : weekly;
  return (effFiveHour * 0.7) + (effWeekly * 0.3);
}

export function isPoolUnderQuotaStress(accounts: CustomModel[], modelFamily?: string): boolean {
  if (!accounts || accounts.length === 0) return true;
  let totalScore = 0;
  let validCount = 0;
  for (const acc of accounts) {
    if (isAccountInCooldown(acc, modelFamily) || getOpenBreaker(acc) || isTokenRevoked(acc.refreshToken)) {
      continue;
    }
    const score = getModelQuotaScore(acc, modelFamily);
    totalScore += score;
    validCount++;
  }
  if (validCount === 0) return true;
  const avg = totalScore / validCount;
  return avg < 15;
}

// --- Multi-Project Balancing --------------------------------------------------
let multiProjectIndex = 0;

export function resolveGoogleProjectId(candidate: CustomModel): string {
  if (isGeminiCliModel(candidate)) {
    if (candidate.projectId && candidate.projectId !== 'aicode-consumers') {
      return candidate.projectId;
    }
    return 'gemini-cli-users';
  }
  if (candidate.projectIds && candidate.projectIds.length > 0) {
    const idx = (multiProjectIndex++) % candidate.projectIds.length;
    return candidate.projectIds[idx];
  }
  if (candidate.projectId) {
    return candidate.projectId;
  }
  const envProjects = (process.env.AG_CLOUD_CODE_PROJECT_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (envProjects.length > 0) {
    const idx = (multiProjectIndex++) % envProjects.length;
    return envProjects[idx];
  }
  return 'bamboo-precept-lgxtn';
}

// --- Google Account Dynamic Health Scoring -------------------------------------
export function getAccountDynamicScore(m: CustomModel, modelFamily?: string): number {
  if (isAccountInCooldown(m, modelFamily) || getOpenBreaker(m) || isTokenRevoked(m.refreshToken)) {
    return 0;
  }
  const baseScore = getModelQuotaScore(m, modelFamily);
  if (baseScore <= 0) return 0;
  const inFlight = getAccountInFlight(m);

  const priorityBonus =
    m.isPro || m.isPaid || m.tier === 'pro' || m.tier === 'paid' || (typeof m.priority === 'number' && m.priority > 0)
      ? (typeof m.priority === 'number' && m.priority > 0 ? m.priority : 15)
      : 0;

  const avgLatency = getAccountAvgLatency(m);
  const latencyPenalty = avgLatency > 500 ? Math.min(70, Math.floor((avgLatency - 500) / 100)) : 0;

  if (isAccountInProbation(m, modelFamily)) {
    if (inFlight >= 1) return 0;
    const probationScore = Math.floor((baseScore + priorityBonus) * 0.6);
    return Math.max(1, probationScore - inFlight * 20 - latencyPenalty);
  }

  if (inFlight >= MAX_CONCURRENT_PER_ACCOUNT) {
    return 0;
  }

  const rpmCount = getAccountRpmCount(m);

  const isArgon = modelFamily
    ? modelFamily.toLowerCase().includes('argon')
    : (m.externalModelName || m.name || '').toLowerCase().includes('argon');
  const isClaude = !isArgon && (modelFamily
    ? modelFamily.toLowerCase().includes('claude')
    : (m.externalModelName || m.name || '').toLowerCase().includes('claude'));
  const qKey = getAccountQuotaKey(m);
  const live = getLiveAccountQuota(qKey);
  const q = (live || m.quotas) as Record<string, any> | undefined;
  const weeklyPct = q
    ? (isArgon
      ? (typeof q.argonWeeklyPct === 'number'
          ? q.argonWeeklyPct
          : (typeof q.geminiWeeklyPct === 'number'
            ? q.geminiWeeklyPct
            : (typeof q.weeklyPercentage === 'number' ? q.weeklyPercentage : 100)))
      : (isClaude
        ? (typeof q.claudeWeeklyPct === 'number' ? q.claudeWeeklyPct : 0)
        : (typeof q.geminiWeeklyPct === 'number'
          ? q.geminiWeeklyPct
          : (typeof q.weeklyPercentage === 'number' ? q.weeklyPercentage : 100))))
    : 100;

  let weeklyPenalty = 0;
  if (weeklyPct <= 5 && weeklyPct > 0) {
    weeklyPenalty = 25 + Math.floor((5 - weeklyPct) * 2);
  } else if (weeklyPct < 15 && weeklyPct > 5) {
    weeklyPenalty = 7 + Math.floor((15 - weeklyPct) * 1.5);
  } else if (weeklyPct < 30 && weeklyPct >= 15) {
    weeklyPenalty = Math.floor((30 - weeklyPct) * 0.5);
  }
  const burstCount = getAccountBurstCount(m);
  const burstPenalty = burstCount > 0 ? Math.min(30, burstCount * 10) : 0;

  return Math.max(1, baseScore + priorityBonus - inFlight * 20 - rpmCount * 2 - burstPenalty - latencyPenalty - weeklyPenalty);
}
