// ─── Google Account Pool — extracted from proxy.ts ────────────────────────────
// All pool/cooldown/scoring/P2C logic lives here.
// proxy.ts re-exports everything; existing callers are unaffected.

import { randomInt } from 'crypto';
import log from 'electron-log';
import type { CustomModel } from './types';
import { getOpenBreaker } from './circuitBreaker';
import {
  getLiveAccountQuota,
  getAllLiveAccountQuotas,
  isGeminiCliModel,
  isGoogleCloudCodeModel,
  isTokenRevoked,
  normalizeCloudCodeModelId,
  type AccountLiveQuota,
} from '../services/googleAuth';
import { getBaseModelId } from './urlBuilder';
import {
  triggerQuotaCachePersist,
  registerUnlicensedAccountsHandlers,
  registerAccountCooldownHandlers,
} from '../services/quotaCacheStore';
import { P2C_SCORE_DELTA } from '../constants';

// ─── Multi-Account Session Affinity (Sticky Sessions) ─────────────────────────

const refreshTokenToEmail = new Map<string, string>();

export function registerAccountRefreshToken(refreshToken?: string, email?: string): void {
  if (refreshToken && email && email.includes('@')) {
    refreshTokenToEmail.set(refreshToken.trim(), email.trim().toLowerCase());
  }
}

export function getAccountQuotaKey(item: CustomModel): string {
  const prefix = isGeminiCliModel(item) ? 'gemini-cli' : 'google';
  if (item.accountEmail) {
    if (item.refreshToken) registerAccountRefreshToken(item.refreshToken, item.accountEmail);
    return `${prefix}:${item.accountEmail.toLowerCase()}`;
  }
  if (item.refreshToken) {
    const knownEmail = refreshTokenToEmail.get(item.refreshToken.trim());
    if (knownEmail) {
      return `${prefix}:${knownEmail}`;
    }
    return `${prefix}:refresh:${item.refreshToken.slice(-15)}`;
  }
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
// Tracks accounts that just received a quota_exhausted 429 so concurrent requests
// already past the cooldown snapshot can fast-skip them without an extra network round-trip.
// ponytail: global Set, cleared when setAccountCooldown is called — O(1) lookup, zero overhead.
const quotaExhaustedAccountKeys = new Set<string>();
// Tracks accounts placed in short rate-limit/burst cooldowns so quota poller doesn't prematurely wake them
const rateLimitedCooldownKeys = new Set<string>();

// Tracks accounts that lack a valid product license (HTTP 403) so they are quarantined
// permanently rather than wasting round trips on every request attempt.
const unlicensedAccountKeys = new Set<string>();

export function isAccountUnlicensed(candidate: CustomModel): boolean {
  const key = getAccountQuotaKey(candidate);
  const email = (candidate.accountEmail || '').toLowerCase();
  return unlicensedAccountKeys.has(key) ||
         (email !== '' && (unlicensedAccountKeys.has(email) ||
                           unlicensedAccountKeys.has(`google:${email}`) ||
                           unlicensedAccountKeys.has(`gemini-cli:${email}`)));
}

export function markAccountUnlicensed(candidate: CustomModel): void {
  const key = getAccountQuotaKey(candidate);
  const email = (candidate.accountEmail || '').toLowerCase();
  unlicensedAccountKeys.add(key);
  if (email) {
    unlicensedAccountKeys.add(email);
    unlicensedAccountKeys.add(`google:${email}`);
    unlicensedAccountKeys.add(`gemini-cli:${email}`);
  }
  triggerQuotaCachePersist();
}

export function getUnlicensedAccountKeys(): string[] {
  return Array.from(unlicensedAccountKeys);
}

export function restoreUnlicensedAccountKeys(keys: string[]): void {
  for (const k of keys) {
    if (typeof k === 'string' && k.trim()) {
      unlicensedAccountKeys.add(k.trim());
    }
  }
}

export function markAccountQuotaExhausted(key: string, modelFamily?: string): void {
  if (modelFamily) {
    quotaExhaustedAccountKeys.add(`${key}:${modelFamily}`);
  } else {
    quotaExhaustedAccountKeys.add(key);
  }
}

// Wire persistence handlers into quotaCacheStore
registerUnlicensedAccountsHandlers(getUnlicensedAccountKeys, restoreUnlicensedAccountKeys);

export function _resetUnlicensedAccounts(): void {
  unlicensedAccountKeys.clear();
}

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
  if (isAccountUnlicensed(candidate)) {
    return true;
  }
  const baseKey = getAccountQuotaKey(candidate);
  const key = modelFamily ? `${baseKey}:${modelFamily}` : baseKey;
  const until = googleAccountCooldowns.get(key) || (modelFamily ? googleAccountCooldowns.get(baseKey) : undefined);

  if (until && Date.now() >= until) {
    googleAccountCooldowns.delete(key);
    quotaExhaustedAccountKeys.delete(key);
    if (modelFamily) {
      googleAccountCooldowns.delete(baseKey);
      quotaExhaustedAccountKeys.delete(baseKey);
    }
    rateLimitedCooldownKeys.delete(key);
    if (modelFamily) rateLimitedCooldownKeys.delete(baseKey);
    // Transition to 15s half-open probation to prevent thundering herd stampede
    accountProbationUntil.set(key, Date.now() + 15_000);
    return false;
  }

  if (quotaExhaustedAccountKeys.has(key) || (!modelFamily && quotaExhaustedAccountKeys.has(baseKey))) {
    return true;
  }
  return Boolean(until);
}

export function setAccountCooldown(candidate: CustomModel, durationMs = 10 * 60_000, modelFamily?: string, isRateLimit = false): void {
  const baseKey = getAccountQuotaKey(candidate);
  const key = modelFamily ? `${baseKey}:${modelFamily}` : baseKey;
  accountProbationUntil.delete(key);
  // Add 1-5s random jitter only to long cooldowns, never blow up short micro-pauses
  const jitterMs = durationMs > 15_000 ? randomInt(1_000, 5_000) : 0;
  googleAccountCooldowns.set(key, Date.now() + durationMs + jitterMs);
  if (isRateLimit) {
    rateLimitedCooldownKeys.add(key);
  } else {
    rateLimitedCooldownKeys.delete(key);
  }
  triggerQuotaCachePersist();
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
    quotaExhaustedAccountKeys.delete(`${baseKey}:${modelFamily}`);
    rateLimitedCooldownKeys.delete(`${baseKey}:${modelFamily}`);
  }
  googleAccountCooldowns.delete(baseKey);
  accountProbationUntil.delete(baseKey);
  quotaExhaustedAccountKeys.delete(baseKey);
  rateLimitedCooldownKeys.delete(baseKey);
  triggerQuotaCachePersist();
}

export function clearAllAccountCooldowns(): number {
  const totalCleared = googleAccountCooldowns.size;
  googleAccountCooldowns.clear();
  accountProbationUntil.clear();
  quotaExhaustedAccountKeys.clear();
  rateLimitedCooldownKeys.clear();
  triggerQuotaCachePersist();
  return totalCleared;
}

export function getActiveAccountCooldowns(): Record<string, number> {
  const now = Date.now();
  const res: Record<string, number> = {};
  for (const [k, until] of googleAccountCooldowns.entries()) {
    if (until > now) {
      res[k] = until;
    }
  }
  return res;
}

export function restoreActiveAccountCooldowns(cooldowns: Record<string, number>, persistedQuotas?: Map<string, AccountLiveQuota>): void {
  if (!cooldowns || typeof cooldowns !== 'object') return;
  const now = Date.now();
  for (const [k, until] of Object.entries(cooldowns)) {
    if (typeof until === 'number' && until > now) {
      const durationMs = until - now;
      // Skip restoring quota-exhausted cooldowns (> 5h) if the persisted quota
      // for this account is still fresh and shows positive remaining quota.
      // The quota poller runs within 3 minutes and will confirm the real state.
      // ponytail: avoids false "all accounts in cooldown" when quota refreshed while proxy was down.
      if (durationMs > 5 * 3600_000 && persistedQuotas) {
        const accKey = k.endsWith(':gemini') ? k.slice(0, -7) : k.endsWith(':claude') ? k.slice(0, -7) : k;
        const normKey = accKey.startsWith('google:') ? accKey : `google:${accKey}`;
        const rawKey = accKey.replace(/^google:/, '');
        const q = persistedQuotas.get(normKey) || persistedQuotas.get(rawKey) || persistedQuotas.get(accKey);
        if (q && typeof q.updatedAt === 'number') {
          const age = now - q.updatedAt;
          const family = k.endsWith(':gemini') ? 'gemini' : k.endsWith(':claude') ? 'claude' : null;
          const fiveHourPct = family === 'claude' ? q.claudeFiveHourPct : q.geminiFiveHourPct;
          // If quota is fresh (< 6h) and shows >= 5%, don't restore the cooldown
          if (age < 6 * 3600_000 && typeof fiveHourPct === 'number' && fiveHourPct >= 5) {
            log.info(`[GooglePool] Skipping stale quota-exhausted cooldown restore for ${k} (live quota: ${fiveHourPct}%, age=${Math.round(age / 60_000)}min)`);
            continue;
          }
        }
      }
      googleAccountCooldowns.set(k, until);
      if (durationMs > 5 * 3600 * 1000) {
        quotaExhaustedAccountKeys.add(k);
      }
    }
  }
}

// Wire persistence handlers for cooldowns into quotaCacheStore
registerAccountCooldownHandlers(getActiveAccountCooldowns, restoreActiveAccountCooldowns);

/**
 * Finds the candidate with the soonest expiring cooldown within maxWaitMs.
 * If any eligible candidate is already free (0ms cooldown), returns it immediately with remainingMs = 0.
 * Ignores unlicensed accounts and accounts with 0% daily/weekly quota.
 */
export function getSoonestAccountCooldownRemaining(
  candidates: CustomModel[],
  modelFamily?: string,
  maxWaitMs = 65_000,
): { candidate: CustomModel; remainingMs: number } | null {
  let soonestCandidate: CustomModel | null = null;
  let minRemainingMs = Infinity;

  for (const candidate of candidates) {
    if (isAccountUnlicensed(candidate) || getOpenBreaker(candidate)) continue;
    if (getModelQuotaScore(candidate, modelFamily) <= 0) continue;

    const remaining = getAccountCooldownRemaining(candidate, modelFamily);
    if (remaining === 0 && !isAccountInCooldown(candidate, modelFamily)) {
      return { candidate, remainingMs: 0 };
    }
    if (remaining > 0 && remaining <= maxWaitMs) {
      if (remaining < minRemainingMs) {
        minRemainingMs = remaining;
        soonestCandidate = candidate;
      }
    }
  }

  if (soonestCandidate && minRemainingMs !== Infinity) {
    return { candidate: soonestCandidate, remainingMs: minRemainingMs };
  }
  return null;
}

export function _resetAllAccountCooldowns(): void {
  googleAccountCooldowns.clear();
  accountProbationUntil.clear();
  quotaExhaustedAccountKeys.clear();
  accountRecentBurstCount.clear();
}

/**
 * Lifts short burst rate limit cooldowns (<= 2 minutes) across accounts,
 * preserving genuine multi-hour or weekly quota exhaustion cooldowns.
 */
export function liftBurstCooldowns(): { cleared: number; removedKeys: string[] } {
  const now = Date.now();
  const MAX_BURST_CD_MS = 2 * 60_000;
  let cleared = 0;
  const removedKeys: string[] = [];

  for (const [key, until] of Array.from(googleAccountCooldowns.entries())) {
    const remaining = until - now;
    // Only lift short burst cooldowns and ensure not marked as quota exhausted
    if (remaining > 0 && remaining <= MAX_BURST_CD_MS && !quotaExhaustedAccountKeys.has(key)) {
      googleAccountCooldowns.delete(key);
      accountProbationUntil.delete(key);
      cleared++;
      removedKeys.push(key);
    }
  }

  accountRecentBurstCount.clear();
  if (cleared > 0) {
    triggerQuotaCachePersist();
  }
  return { cleared, removedKeys };
}

/**
 * Verifies all active account cooldowns on startup / wake-up and periodic ticks.
 * Lifts expired cooldowns, cleans orphan quota-exhausted markers, and wakes up
 * accounts whose Google reset timestamps have passed or whose live quotas are healthy.
 */
export function verifyAndReconcileCooldowns(now = Date.now(), customModels?: CustomModel[]): {
  checked: number;
  active: number;
  cleared: number;
  details: string[];
} {
  const quotas = getAllLiveAccountQuotas();
  let checked = 0;
  let cleared = 0;
  const details: string[] = [];

  for (const [key, until] of Array.from(googleAccountCooldowns.entries())) {
    checked++;
    if (until <= now) {
      googleAccountCooldowns.delete(key);
      quotaExhaustedAccountKeys.delete(key);
      accountProbationUntil.delete(key);
      cleared++;
      details.push(`${key} (expired naturally)`);
      continue;
    }

    let accKey = key;
    let family: 'gemini' | 'claude' | null = null;
    if (key.endsWith(':gemini')) {
      accKey = key.slice(0, -7);
      family = 'gemini';
    } else if (key.endsWith(':claude')) {
      accKey = key.slice(0, -7);
      family = 'claude';
    }

    const normAcc = accKey.startsWith('google:') ? accKey : `google:${accKey}`;
    const rawAcc = accKey.replace(/^google:/, '');
    let quota = quotas.get(normAcc) || quotas.get(rawAcc) || quotas.get(accKey);

    if (!quota && Array.isArray(customModels)) {
      const match = customModels.find((m) => {
        const email = (m.accountEmail || '').toLowerCase();
        return email && (normAcc.toLowerCase().includes(email) || rawAcc.toLowerCase().includes(email));
      });
      if (match?.quotas) {
        quota = match.quotas as unknown as AccountLiveQuota;
      }
    }

    const isRateLimited =
      rateLimitedCooldownKeys.has(key) ||
      rateLimitedCooldownKeys.has(accKey) ||
      rateLimitedCooldownKeys.has(normAcc) ||
      rateLimitedCooldownKeys.has(rawAcc) ||
      rateLimitedCooldownKeys.has(`${normAcc}:gemini`) ||
      rateLimitedCooldownKeys.has(`${rawAcc}:gemini`) ||
      rateLimitedCooldownKeys.has(`${normAcc}:claude`) ||
      rateLimitedCooldownKeys.has(`${rawAcc}:claude`);

    if (isRateLimited) {
      // Must not prematurely wake accounts placed in rate limit / burst cooldown
      continue;
    }

    if (quota) {
      const geminiResetStr = quota.geminiResetTime || quota.geminiFiveHourReset || (quota as any).fiveHourResetTime;
      const geminiResetPassed = geminiResetStr ? Date.parse(geminiResetStr) <= now : false;
      const claudeResetStr = quota.claudeResetTime || quota.claudeFiveHourReset || (quota as any).fiveHourResetTime;
      const claudeResetPassed = claudeResetStr ? Date.parse(claudeResetStr) <= now : false;

      let shouldWakeUp = false;
      let reason = '';

      const isQuotaExhausted =
        quotaExhaustedAccountKeys.has(key) ||
        quotaExhaustedAccountKeys.has(accKey) ||
        quotaExhaustedAccountKeys.has(normAcc);

      // If live quota was updated within 10 minutes, it is ground truth.
      // A fresh poll showing >= 5% means the account recovered — override the
      // stale quotaExhausted flag so the cooldown is lifted immediately.
      // ponytail: 10 min matches daemon quota-push cadence (60s) with headroom.
      const LIVE_QUOTA_FRESH_MS = 10 * 60_000;
      const quotaIsFresh = typeof quota.updatedAt === 'number' && (now - quota.updatedAt) <= LIVE_QUOTA_FRESH_MS;

      if (family === 'gemini') {
        const geminiWeekVal = typeof quota.geminiWeeklyPct === 'number'
          ? quota.geminiWeeklyPct
          : (typeof quota.weeklyPercentage === 'number' ? quota.weeklyPercentage : null);
        const weekStr = geminiWeekVal !== null ? `, week=${geminiWeekVal}%` : '';
        const geminiWeeklyDepleted = geminiWeekVal !== null && geminiWeekVal < 5 && !geminiResetPassed;

        const isFullyRestored = quota.geminiFiveHourPct === 100 && (geminiWeekVal === null || geminiWeekVal >= 50);
        if (geminiResetPassed && quota.geminiFiveHourPct >= 5) {
          shouldWakeUp = true;
          reason = `Gemini reset timestamp elapsed (${geminiResetStr}${weekStr})`;
        } else if (isFullyRestored) {
          shouldWakeUp = true;
          reason = `full quota restored (5h=100%${weekStr})`;
        } else if (quota.geminiFiveHourPct >= 5 && !geminiWeeklyDepleted && (quotaIsFresh || !isQuotaExhausted)) {
          shouldWakeUp = true;
          reason = `${quotaIsFresh ? 'fresh live' : 'healthy'} quota (5h=${quota.geminiFiveHourPct}%${weekStr})`;
        }
      } else if (family === 'claude') {
        const claudeWeekVal = typeof quota.claudeWeeklyPct === 'number'
          ? quota.claudeWeeklyPct
          : (typeof quota.weeklyPercentage === 'number' ? quota.weeklyPercentage : null);
        const weekStr = claudeWeekVal !== null ? `, week=${claudeWeekVal}%` : '';
        const claudeWeeklyDepleted = claudeWeekVal !== null && claudeWeekVal < 5 && !claudeResetPassed;

        const isFullyRestored = quota.claudeFiveHourPct === 100 && (claudeWeekVal === null || claudeWeekVal >= 50);
        if (claudeResetPassed && quota.claudeFiveHourPct >= 5) {
          shouldWakeUp = true;
          reason = `Claude reset timestamp elapsed (${claudeResetStr}${weekStr})`;
        } else if (isFullyRestored) {
          shouldWakeUp = true;
          reason = `full quota restored (5h=100%${weekStr})`;
        } else if (quota.claudeFiveHourPct >= 5 && !claudeWeeklyDepleted && (quotaIsFresh || !isQuotaExhausted)) {
          shouldWakeUp = true;
          reason = `${quotaIsFresh ? 'fresh live' : 'healthy'} quota (5h=${quota.claudeFiveHourPct}%${weekStr})`;
        }
      } else {
        const geminiWeekVal = typeof quota.geminiWeeklyPct === 'number'
          ? quota.geminiWeeklyPct
          : (typeof quota.weeklyPercentage === 'number' ? quota.weeklyPercentage : null);
        const geminiWeekStr = geminiWeekVal !== null ? `, week=${geminiWeekVal}%` : '';
        const geminiWeeklyDepleted = geminiWeekVal !== null && geminiWeekVal < 5 && !geminiResetPassed;

        const claudeWeekVal = typeof quota.claudeWeeklyPct === 'number'
          ? quota.claudeWeeklyPct
          : (typeof quota.weeklyPercentage === 'number' ? quota.weeklyPercentage : null);
        const claudeWeekStr = claudeWeekVal !== null ? `, week=${claudeWeekVal}%` : '';
        const claudeWeeklyDepleted = claudeWeekVal !== null && claudeWeekVal < 5 && !claudeResetPassed;

        const geminiOk = geminiResetPassed || (quota.geminiFiveHourPct >= 5 && !geminiWeeklyDepleted && (quotaIsFresh || !isQuotaExhausted));
        const claudeOk = claudeResetPassed || (quota.claudeFiveHourPct >= 5 && !claudeWeeklyDepleted && (quotaIsFresh || !isQuotaExhausted));

        if (geminiOk && claudeOk) {
          shouldWakeUp = true;
          reason = `${quotaIsFresh ? 'fresh live' : 'healthy'} multi-family quota (Gemini 5h=${quota.geminiFiveHourPct}%${geminiWeekStr}, Claude 5h=${quota.claudeFiveHourPct}%${claudeWeekStr})`;
        }
      }

      if (shouldWakeUp) {
        googleAccountCooldowns.delete(key);
        quotaExhaustedAccountKeys.delete(key);
        accountProbationUntil.delete(key);
        cleared++;
        details.push(`${key} (${reason})`);
      }
    }
  }

  // Clean orphan quotaExhaustedAccountKeys entries that have no active cooldown
  for (const k of Array.from(quotaExhaustedAccountKeys)) {
    if (!googleAccountCooldowns.has(k)) {
      quotaExhaustedAccountKeys.delete(k);
    }
  }

  const active = googleAccountCooldowns.size;
  if (cleared > 0) {
    log.info(`[Proxy] 🟢 Cooldown Verification / Wake-up: ${checked} checked, ${active} active, ${cleared} woke up: ${details.join(', ')}`);
    triggerQuotaCachePersist();
  } else {
    log.info(`[Proxy] 🟢 Cooldown Verification / Wake-up: ${checked} checked, ${active} active cooldown(s) remain.`);
  }

  return { checked, active, cleared, details };
}

/**
 * Automatically lifts cooldowns and probation when the Quota Poller detects
 * that an account's quota has replenished (e.g. after 5h or weekly bucket reset).
 */
export function autoHealAccountOnQuotaRecovery(accountKey: string, quota: AccountLiveQuota): void {
  if (!quota || !accountKey) return;

  const now = Date.now();
  const FIVE_HOURS_MS = 5 * 3600 * 1000;

  // Heal once quota recovers to ≥5% — enough to be useful. 20% was too conservative:
  // accounts at 10% were being skipped despite successfully serving requests in the log.
  // Guard: if Google returned an inference 429 exhaustion (>30m remaining), do NOT lift it
  // based only on the 5-hour rolling bucket recovering.
  const normAccountKey = accountKey.startsWith('google:') ? accountKey : `google:${accountKey}`;
  const rawAccountKey = accountKey.replace(/^google:/, '');

  if (unlicensedAccountKeys.has(normAccountKey) || unlicensedAccountKeys.has(rawAccountKey) || unlicensedAccountKeys.has(accountKey)) {
    log.debug(`[Proxy] Skipping auto-heal for unlicensed account: ${accountKey}`);
    return;
  }

  const getCooldownRemainingForFamily = (family: string): number => {
    const cd1 = googleAccountCooldowns.get(`${normAccountKey}:${family}`);
    const cd2 = googleAccountCooldowns.get(`${rawAccountKey}:${family}`);
    const cdGen1 = googleAccountCooldowns.get(normAccountKey);
    const cdGen2 = googleAccountCooldowns.get(rawAccountKey);
    const cd = Math.max(cd1 || 0, cd2 || 0, cdGen1 || 0, cdGen2 || 0);
    return cd && cd > now ? cd - now : 0;
  };

  const getGeneralCooldownRemaining = (): number => {
    const cd1 = googleAccountCooldowns.get(normAccountKey);
    const cd2 = googleAccountCooldowns.get(rawAccountKey);
    const cd = cd1 || cd2;
    return cd && cd > now ? cd - now : 0;
  };

  const geminiResetStr = quota.geminiResetTime || quota.geminiFiveHourReset || (quota as any).fiveHourResetTime;
  const geminiResetPassed = geminiResetStr ? new Date(geminiResetStr).getTime() <= now : false;
  const geminiWeeklyDepleted = (typeof quota.geminiWeeklyPct === 'number' && quota.geminiWeeklyPct < 5 && !geminiResetPassed) ||
                               (typeof quota.weeklyPercentage === 'number' && quota.weeklyPercentage < 5 && !geminiResetPassed);

  const claudeResetStr = quota.claudeResetTime || quota.claudeFiveHourReset || (quota as any).fiveHourResetTime;
  const claudeResetPassed = claudeResetStr ? new Date(claudeResetStr).getTime() <= now : false;
  const claudeWeeklyDepleted = (typeof quota.claudeWeeklyPct === 'number' && quota.claudeWeeklyPct < 5 && !claudeResetPassed) ||
                               (typeof quota.weeklyPercentage === 'number' && quota.weeklyPercentage < 5 && !claudeResetPassed);

  if (quota.geminiFiveHourPct >= 5) {
    const remaining = getCooldownRemainingForFamily('gemini');
    const isStrictCooldown = remaining > FIVE_HOURS_MS;
    const isRateLimited = (remaining > 0) && (
      rateLimitedCooldownKeys.has(`${normAccountKey}:gemini`) ||
      rateLimitedCooldownKeys.has(`${rawAccountKey}:gemini`) ||
      rateLimitedCooldownKeys.has(normAccountKey) ||
      rateLimitedCooldownKeys.has(rawAccountKey)
    );

    const hasAnyCooldown =
      googleAccountCooldowns.has(`${normAccountKey}:gemini`) ||
      googleAccountCooldowns.has(`${rawAccountKey}:gemini`) ||
      googleAccountCooldowns.has(normAccountKey) ||
      googleAccountCooldowns.has(rawAccountKey) ||
      quotaExhaustedAccountKeys.has(`${normAccountKey}:gemini`) ||
      quotaExhaustedAccountKeys.has(`${rawAccountKey}:gemini`) ||
      quotaExhaustedAccountKeys.has(normAccountKey) ||
      quotaExhaustedAccountKeys.has(rawAccountKey);

    // Allow healing if:
    // 1) Not in an active rate-limited cooldown, AND
    // 2) Cooldown is not strict (<5h), OR Google reset timestamp has elapsed
    const canHealGemini = !isRateLimited && (!isStrictCooldown || geminiResetPassed) && !geminiWeeklyDepleted && hasAnyCooldown;

    if (canHealGemini) {
      log.info(`[Proxy] Auto-healing Gemini cooldown for ${accountKey}: quota recovered to 5h=${quota.geminiFiveHourPct}%, week=${quota.geminiWeeklyPct}%${geminiResetPassed ? ' (reset timestamp passed)' : ''}`);
      googleAccountCooldowns.delete(`${normAccountKey}:gemini`);
      googleAccountCooldowns.delete(`${rawAccountKey}:gemini`);
      accountProbationUntil.delete(`${normAccountKey}:gemini`);
      accountProbationUntil.delete(`${rawAccountKey}:gemini`);
      quotaExhaustedAccountKeys.delete(`${normAccountKey}:gemini`);
      quotaExhaustedAccountKeys.delete(`${rawAccountKey}:gemini`);

      const genCd = googleAccountCooldowns.get(normAccountKey) || googleAccountCooldowns.get(rawAccountKey);
      if (genCd) {
        if (quota.claudeFiveHourPct < 5 || claudeWeeklyDepleted) {
          googleAccountCooldowns.set(`${normAccountKey}:claude`, genCd);
          googleAccountCooldowns.set(`${rawAccountKey}:claude`, genCd);
        }
        googleAccountCooldowns.delete(normAccountKey);
        googleAccountCooldowns.delete(rawAccountKey);
        accountProbationUntil.delete(normAccountKey);
        accountProbationUntil.delete(rawAccountKey);
      }
      if (quotaExhaustedAccountKeys.has(normAccountKey) || quotaExhaustedAccountKeys.has(rawAccountKey)) {
        if (quota.claudeFiveHourPct < 5 || claudeWeeklyDepleted) {
          quotaExhaustedAccountKeys.add(`${normAccountKey}:claude`);
          quotaExhaustedAccountKeys.add(`${rawAccountKey}:claude`);
        }
        quotaExhaustedAccountKeys.delete(normAccountKey);
        quotaExhaustedAccountKeys.delete(rawAccountKey);
      }
      triggerQuotaCachePersist();
    } else if (isStrictCooldown || geminiWeeklyDepleted) {
      log.debug(
        `[Proxy] Skipping Gemini auto-heal for ${accountKey}: multi-day/weekly cooldown still active (${Math.round(remaining / 3600000)}h remaining, weekly depleted=${geminiWeeklyDepleted})`,
      );
    }
  }

  if (quota.claudeFiveHourPct >= 5) {
    const remaining = getCooldownRemainingForFamily('claude');
    const isStrictCooldown = remaining > FIVE_HOURS_MS;
    const isRateLimited = (remaining > 0) && (
      rateLimitedCooldownKeys.has(`${normAccountKey}:claude`) ||
      rateLimitedCooldownKeys.has(`${rawAccountKey}:claude`) ||
      rateLimitedCooldownKeys.has(normAccountKey) ||
      rateLimitedCooldownKeys.has(rawAccountKey)
    );

    const hasAnyCooldown =
      googleAccountCooldowns.has(`${normAccountKey}:claude`) ||
      googleAccountCooldowns.has(`${rawAccountKey}:claude`) ||
      googleAccountCooldowns.has(normAccountKey) ||
      googleAccountCooldowns.has(rawAccountKey) ||
      quotaExhaustedAccountKeys.has(`${normAccountKey}:claude`) ||
      quotaExhaustedAccountKeys.has(`${rawAccountKey}:claude`) ||
      quotaExhaustedAccountKeys.has(normAccountKey) ||
      quotaExhaustedAccountKeys.has(rawAccountKey);

    const canHealClaude = !isRateLimited && (!isStrictCooldown || claudeResetPassed) && !claudeWeeklyDepleted && hasAnyCooldown;

    if (canHealClaude) {
      log.info(`[Proxy] Auto-healing Claude cooldown for ${accountKey}: quota recovered to 5h=${quota.claudeFiveHourPct}%, week=${quota.claudeWeeklyPct}%${claudeResetPassed ? ' (reset timestamp passed)' : ''}`);
      googleAccountCooldowns.delete(`${normAccountKey}:claude`);
      googleAccountCooldowns.delete(`${rawAccountKey}:claude`);
      accountProbationUntil.delete(`${normAccountKey}:claude`);
      accountProbationUntil.delete(`${rawAccountKey}:claude`);
      quotaExhaustedAccountKeys.delete(`${normAccountKey}:claude`);
      quotaExhaustedAccountKeys.delete(`${rawAccountKey}:claude`);

      const genCd = googleAccountCooldowns.get(normAccountKey) || googleAccountCooldowns.get(rawAccountKey);
      if (genCd) {
        if (quota.geminiFiveHourPct < 5 || geminiWeeklyDepleted) {
          googleAccountCooldowns.set(`${normAccountKey}:gemini`, genCd);
          googleAccountCooldowns.set(`${rawAccountKey}:gemini`, genCd);
        }
        googleAccountCooldowns.delete(normAccountKey);
        googleAccountCooldowns.delete(rawAccountKey);
        accountProbationUntil.delete(normAccountKey);
        accountProbationUntil.delete(rawAccountKey);
      }
      if (quotaExhaustedAccountKeys.has(normAccountKey) || quotaExhaustedAccountKeys.has(rawAccountKey)) {
        if (quota.geminiFiveHourPct < 5 || geminiWeeklyDepleted) {
          quotaExhaustedAccountKeys.add(`${normAccountKey}:gemini`);
          quotaExhaustedAccountKeys.add(`${rawAccountKey}:gemini`);
        }
        quotaExhaustedAccountKeys.delete(normAccountKey);
        quotaExhaustedAccountKeys.delete(rawAccountKey);
      }
      triggerQuotaCachePersist();
    } else if (isStrictCooldown || claudeWeeklyDepleted) {
      log.debug(
        `[Proxy] Skipping Claude auto-heal for ${accountKey}: multi-day/weekly cooldown still active (${Math.round(remaining / 3600000)}h remaining, weekly depleted=${claudeWeeklyDepleted})`,
      );
    }
  }

  // If either major quota recovered, heal general account cooldown
  if (quota.geminiFiveHourPct >= 5 || quota.claudeFiveHourPct >= 5) {
    const remaining = getGeneralCooldownRemaining();
    const isStrictCooldown = remaining > FIVE_HOURS_MS;

    const hasAnyCooldown =
      googleAccountCooldowns.has(normAccountKey) ||
      googleAccountCooldowns.has(rawAccountKey) ||
      quotaExhaustedAccountKeys.has(normAccountKey) ||
      quotaExhaustedAccountKeys.has(rawAccountKey);

    if (!isStrictCooldown && !geminiWeeklyDepleted && !claudeWeeklyDepleted && hasAnyCooldown) {
      log.info(`[Proxy] Auto-healing general cooldown for ${accountKey}`);
      googleAccountCooldowns.delete(normAccountKey);
      googleAccountCooldowns.delete(rawAccountKey);
      accountProbationUntil.delete(normAccountKey);
      accountProbationUntil.delete(rawAccountKey);
      quotaExhaustedAccountKeys.delete(normAccountKey);
      quotaExhaustedAccountKeys.delete(rawAccountKey);
    } else if (isStrictCooldown || (geminiWeeklyDepleted && claudeWeeklyDepleted)) {
      log.debug(
        `[Proxy] Skipping general auto-heal for ${accountKey}: multi-day/weekly cooldown still active (${Math.round(remaining / 3600000)}h remaining)`,
      );
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

// ─── Google Account RPM Governor (Sliding Window 60s) & LRU Tracker ───────────
const accountRequestTimestamps = new Map<string, number[]>();
const accountLastUsedTimestamp = new Map<string, number>();

export function recordAccountRequest(candidate: CustomModel): void {
  const key = getAccountQuotaKey(candidate);
  const now = Date.now();
  accountLastUsedTimestamp.set(key, now);
  const list = accountRequestTimestamps.get(key) || [];
  const recent = list.filter((t) => now - t < 60_000);
  recent.push(now);
  accountRequestTimestamps.set(key, recent);
}

export function getAccountLastUsed(candidate: CustomModel): number {
  const key = getAccountQuotaKey(candidate);
  return accountLastUsedTimestamp.get(key) || 0;
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
  accountLastUsedTimestamp.clear();
}

// ─── Google Account Burst Rate Limit Governor (Consecutive 429 Tracker) ────────
const accountRecentBurstCount = new Map<string, { count: number; lastAt: number }>();

export function recordAccountBurst(candidate: CustomModel): number {
  const key = getAccountQuotaKey(candidate);
  const now = Date.now();
  const prev = accountRecentBurstCount.get(key);
  const isRecent = prev && now - prev.lastAt < 120_000;
  const count = isRecent ? prev.count + 1 : 1;
  accountRecentBurstCount.set(key, { count, lastAt: now });
  return count;
}

export function getAccountBurstCount(candidate: CustomModel): number {
  const key = getAccountQuotaKey(candidate);
  const prev = accountRecentBurstCount.get(key);
  if (!prev) return 0;
  if (Date.now() - prev.lastAt > 120_000) {
    accountRecentBurstCount.delete(key);
    return 0;
  }
  return prev.count;
}

export function clearAccountBurst(candidate: CustomModel): void {
  const key = getAccountQuotaKey(candidate);
  accountRecentBurstCount.delete(key);
}

export function _resetAccountBurst(): void {
  accountRecentBurstCount.clear();
}

export function getModelQuotaScore(m: CustomModel, modelFamily?: string): number {
  if (isGoogleCloudCodeModel(m) && !m.refreshToken && (!m.apiKey || !m.apiKey.startsWith('ya29.'))) {
    return 0;
  }
  const key = getAccountQuotaKey(m);
  const live = getLiveAccountQuota(key);
  const q = (live || m.quotas) as Record<string, any> | undefined;
  if (!q) {
    // ponytail: reserve direct Google AI Studio developer keys (AIzaSy... / AQ...) as fallback by default (score 25),
    // ensuring healthy Cloud Code accounts (score 30-100) are used first to avoid burning direct API quotas.
    const isAiStudioKey = m.apiKey && (m.apiKey.startsWith('AIzaSy') || m.apiKey.startsWith('AQ.'));
    return isAiStudioKey ? 25 : 50;
  }

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

  const now = Date.now();
  const fiveHourResetStr = isClaude ? q.claudeFiveHourReset : (q.geminiFiveHourReset || q.fiveHourResetTime);
  const fiveHourResetPassed = fiveHourResetStr ? new Date(fiveHourResetStr).getTime() <= now : false;

  const weeklyResetStr = isClaude ? q.claudeWeeklyReset : (q.geminiWeeklyReset || q.weeklyResetTime);
  const weeklyResetPassed = weeklyResetStr ? new Date(weeklyResetStr).getTime() <= now : false;

  if (fiveHour === 0 && !fiveHourResetPassed) return 0;
  if (weekly === 0 && !weeklyResetPassed) return 0;

  const effFiveHour = (fiveHour === 0 && fiveHourResetPassed) ? 50 : fiveHour;
  const effWeekly = (weekly === 0 && weeklyResetPassed) ? 50 : weekly;
  return (effFiveHour * 0.7) + (effWeekly * 0.3);
}

// ─── Google Account Latency Tracker (EWMA alpha = 0.2, 10min decay) ───────────
/** After this duration without new measurements, latency score resets to 0 (neutral). */
export const EWMA_DECAY_THRESHOLD_MS = 10 * 60_000;

const accountLatencyEwma = new Map<string, { ewma: number; lastRecordedAt: number }>();

export function recordAccountLatency(candidate: CustomModel, latencyMs: number): void {
  if (typeof latencyMs !== 'number' || latencyMs <= 0 || !isFinite(latencyMs)) return;
  const key = getAccountQuotaKey(candidate);
  const prev = accountLatencyEwma.get(key);
  const ewma = prev === undefined
    ? latencyMs
    : Math.round(0.2 * latencyMs + 0.8 * prev.ewma);
  accountLatencyEwma.set(key, { ewma, lastRecordedAt: Date.now() });
}

export function getAccountAvgLatency(candidate: CustomModel): number {
  const key = getAccountQuotaKey(candidate);
  const entry = accountLatencyEwma.get(key);
  if (!entry) return 0;
  if (Date.now() - entry.lastRecordedAt > EWMA_DECAY_THRESHOLD_MS) {
    accountLatencyEwma.delete(key); // lazy eviction
    return 0;
  }
  return entry.ewma;
}

export function _resetAccountLatencies(): void {
  accountLatencyEwma.clear();
}

// ─── Quota Stress Detector & Eco-Routing (OmniRoute Parity) ───────────────────
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
  return avg < 15; // Average remaining quota below 15%
}

// ─── Multi-Project Balancing ──────────────────────────────────────────────────
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

// ─── Google Account Dynamic Health Scoring ─────────────────────────────────────
export function getAccountDynamicScore(m: CustomModel, modelFamily?: string): number {
  if (isAccountInCooldown(m, modelFamily) || getOpenBreaker(m) || isTokenRevoked(m.refreshToken)) {
    return 0;
  }
  const baseScore = getModelQuotaScore(m, modelFamily);
  if (baseScore <= 0) return 0;
  const inFlight = getAccountInFlight(m);

  // Priority/Tier bonus: High-priority, paid or Pro subscription accounts receive +15 priority score
  const priorityBonus =
    m.isPro || m.isPaid || m.tier === 'pro' || m.tier === 'paid' || (typeof m.priority === 'number' && m.priority > 0)
      ? (typeof m.priority === 'number' && m.priority > 0 ? m.priority : 15)
      : 0;

  // Latency penalty: -1 point per 100ms beyond 500ms baseline (capped at -25 points)
  const avgLatency = getAccountAvgLatency(m);
  const latencyPenalty = avgLatency > 500 ? Math.min(25, Math.floor((avgLatency - 500) / 100)) : 0;

  // During Half-Open probation: strictly max 1 probe request allowed; score capped at 60%
  if (isAccountInProbation(m, modelFamily)) {
    if (inFlight >= 1) return 0;
    const probationScore = Math.floor((baseScore + priorityBonus) * 0.6);
    return Math.max(1, probationScore - inFlight * 20 - latencyPenalty);
  }

  // Account reached max concurrent requests slot limit: mark score 0 to route to free accounts
  if (inFlight >= MAX_CONCURRENT_PER_ACCOUNT) {
    return 0;
  }

  const rpmCount = getAccountRpmCount(m);

  // Each active request penalizes dynamic score by 20 points;
  // each request served in the last 60 seconds penalizes by 2 points (RPM governor);
  // elevated EWMA latency penalizes up to 25 points;
  // accounts with weekly quota under 30% receive a penalty (up to -20 points under 15%)
  // so accounts with healthy 5h and weekly > 30% are prioritized for attempt 1.
  const isClaude = modelFamily
    ? modelFamily.toLowerCase().includes('claude')
    : (m.externalModelName || m.name || '').toLowerCase().includes('claude');
  const qKey = getAccountQuotaKey(m);
  const live = getLiveAccountQuota(qKey);
  const q = (live || m.quotas) as Record<string, any> | undefined;
  const weeklyPct = q
    ? (typeof (isClaude ? q.claudeWeeklyPct : q.geminiWeeklyPct) === 'number'
      ? (isClaude ? q.claudeWeeklyPct : q.geminiWeeklyPct)
      : typeof q.weeklyPercentage === 'number'
        ? q.weeklyPercentage
        : 100)
    : 100;
  // Progressive weekly penalty: accounts below 15% get strong penalty (up to 20 pts);
  // accounts between 15% and 30% get mild penalty (up to 7 pts) to favor accounts with > 30% weekly quota.
  let weeklyPenalty = 0;
  if (weeklyPct < 15 && weeklyPct > 0) {
    weeklyPenalty = 7 + Math.floor((15 - weeklyPct) * 1.5);
  } else if (weeklyPct < 30 && weeklyPct >= 15) {
    weeklyPenalty = Math.floor((30 - weeklyPct) * 0.5);
  }
  const burstCount = getAccountBurstCount(m);
  const burstPenalty = burstCount > 0 ? Math.min(30, burstCount * 10) : 0;

  return Math.max(1, baseScore + priorityBonus - inFlight * 20 - rpmCount * 2 - burstPenalty - latencyPenalty - weeklyPenalty);
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

  // Parse exact cooldown from Google ErrorInfo / RetryInfo JSON metadata or string regex
  if (retryAfterMs === null && errorMessage) {
    try {
      const errJson = typeof errorMessage === 'string' && errorMessage.trim().startsWith('{')
        ? JSON.parse(errorMessage)
        : null;
      const details = errJson?.error?.details;
      if (Array.isArray(details)) {
        for (const d of details) {
          const type = d?.['@type'] || '';
          if (type.includes('ErrorInfo')) {
            const meta = d?.metadata || {};
            if (meta.quotaResetTimeStamp) {
              const parsedTs = Date.parse(meta.quotaResetTimeStamp);
              if (!isNaN(parsedTs) && parsedTs > Date.now()) {
                retryAfterMs = parsedTs - Date.now();
                break;
              }
            }
            if (meta.quotaResetDelay) {
              const delayStr = String(meta.quotaResetDelay);
              const parts = Array.from(delayStr.matchAll(/(\d+(?:\.\d+)?)([smhd])/g));
              if (parts.length > 0) {
                const unitMap: Record<string, number> = { s: 1000, m: 60_000, h: 3600_000, d: 86400_000 };
                const total = parts.reduce((acc, p) => acc + parseFloat(p[1]) * (unitMap[p[2]] || 1000), 0);
                if (total > 0) {
                  retryAfterMs = Math.round(total);
                  break;
                }
              }
            }
          } else if (type.includes('RetryInfo') && d?.retryDelay) {
            const sec = parseFloat(String(d.retryDelay).replace('s', ''));
            if (!isNaN(sec) && sec > 0) {
              retryAfterMs = Math.round(sec * 1000);
              break;
            }
          }
        }
      }
    } catch {
      // Not JSON or parse failure
    }
  }

  // Parse "Resets in Xh Ym Zs" from the 429 body when no Retry-After header or JSON metadata is present.
  // Handles: "42h52m9s", "4h7m17s", "52m", "30s", etc.
  if (retryAfterMs === null) {
    const resetMatch = msg.match(/resets?\s+in\s+(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/);
    if (resetMatch && (resetMatch[1] || resetMatch[2] || resetMatch[3])) {
      const h = parseInt(resetMatch[1] || '0', 10);
      const m = parseInt(resetMatch[2] || '0', 10);
      const s = parseInt(resetMatch[3] || '0', 10);
      const parsed = (h * 3600 + m * 60 + s) * 1000;
      if (parsed > 0) retryAfterMs = parsed;
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
      // Use the parsed reset time from header or body. Floor at 5h so we never under-cool a quota account.
      const quotaCooldownMs = retryAfterMs && retryAfterMs > 0
        ? Math.max(retryAfterMs, 5 * 60 * 60 * 1000)
        : 5 * 60 * 60 * 1000;
      return {
        category: 'quota_exhausted',
        cooldownMs: quotaCooldownMs,
        reason: `Quota exhausted — ${Math.round(quotaCooldownMs / 3_600_000)}h cooldown and switch account`,
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

  const delta = typeof P2C_SCORE_DELTA === 'number' ? P2C_SCORE_DELTA : 45;
  const topTier = sorted.filter((m) => topScore - getAccountDynamicScore(m, modelFamily) <= delta);
  if (topTier.length <= 1) {
    return sorted[0];
  }

  const i = randomInt(topTier.length);
  let j = randomInt(topTier.length - 1);
  if (j >= i) j++;

  const candA = topTier[i];
  const candB = topTier[j];

  const lastA = getAccountLastUsed(candA);
  const lastB = getAccountLastUsed(candB);

  // If one candidate was used more recently, favor the fresher idle account for intelligent rotation
  if (lastA !== lastB) {
    return lastA < lastB ? candA : candB;
  }

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

  // ponytail: For Google family models, prioritize Google Cloud Code pool (free, load-balanced across 19 accounts)
  // over static developer API keys (AIzaSy... / AQ...) whenever healthy Cloud Code accounts have positive quota.
  const hasCloudCodeWithQuota = candidatePool.some(
    (m) => isGoogleCloudCodeModel(m) && Boolean(m.refreshToken) && getModelQuotaScore(m) > 0,
  );
  const filteredCandidates = hasCloudCodeWithQuota
    ? candidatePool.filter((m) => isGoogleCloudCodeModel(m) && Boolean(m.refreshToken))
    : candidatePool;

  const withQuota = filteredCandidates.filter((m) => getModelQuotaScore(m) > 0);
  const candidatesToSort = withQuota.length > 0 ? withQuota : filteredCandidates;

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
  const rawTarget = (matchedModel.externalModelName || matchedModel.name)
    .replace(/^models\//, '')
    .replace(/^google:/, '')
    .replace(/:auto-pool.*$/, '');
  const targetBase = getBaseModelId(rawTarget);
  const targetNorm = normalizeCloudCodeModelId(targetBase);

  // Pool all Google Cloud Code accounts offering this model or compatible
  const pool = allModels.filter((m) => {
    if (!isGoogleCloudCodeModel(m)) return false;
    // Virtual dropdown auto-pool placeholders must not serve as candidate accounts
    if (m.name?.includes(':auto-pool') || m.apiKey === 'auto') return false;
    // Unlicensed accounts (HTTP 403) must not be pooled
    if (isAccountUnlicensed(m)) return false;
    const mRaw = (m.externalModelName || m.name)
      .replace(/^models\//, '')
      .replace(/^google:/, '')
      .replace(/:auto-pool.*$/, '');
    const mBase = getBaseModelId(mRaw);
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
