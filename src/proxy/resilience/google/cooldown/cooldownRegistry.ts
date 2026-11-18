import { randomInt } from 'crypto';
import log from 'electron-log';
import type { CustomModel } from '../../../core/types';
import type { AccountLiveQuota } from '../../../../services/auth/googleAuth';
import { getOpenBreaker } from '../../circuit/circuitBreaker';
import { triggerQuotaCachePersist, registerAccountCooldownHandlers } from '../../../../services/storage/quotaCacheStore';
import { getAccountQuotaKey } from '../identity/accountKeys';
import { isAccountUnlicensed } from '../identity/licensing';
import { clearAccountQuotaExhaustedFromDisk, clearAllAccountQuotaExhaustedFromDisk } from '../identity/diskPersistence';
import {
  googleAccountCooldowns,
  accountProbationUntil,
  quotaExhaustedAccountKeys,
  rateLimitedCooldownKeys,
  fleetModelCooldowns,
} from './cooldownState';
import { getModelQuotaScore } from '../selection/scoring';
import { accountRecentBurstCount } from '../concurrency/rateLimiter';

export function isAccountInCooldown(candidate: CustomModel, modelFamily?: string): boolean {
  if (isAccountUnlicensed(candidate)) return true;
  const baseKey = getAccountQuotaKey(candidate);
  const normKey = baseKey.startsWith('google:') ? baseKey : `google:${baseKey}`;
  const rawKey = baseKey.replace(/^google:/, '');
  const key = modelFamily ? `${baseKey}:${modelFamily}` : baseKey;
  const until =
    googleAccountCooldowns.get(key) ||
    (modelFamily ? (googleAccountCooldowns.get(`${normKey}:${modelFamily}`) || googleAccountCooldowns.get(`${rawKey}:${modelFamily}`)) : undefined) ||
    googleAccountCooldowns.get(baseKey) ||
    googleAccountCooldowns.get(normKey) ||
    googleAccountCooldowns.get(rawKey);

  if (until && Date.now() >= until) {
    googleAccountCooldowns.delete(key);
    quotaExhaustedAccountKeys.delete(key);
    if (modelFamily) {
      googleAccountCooldowns.delete(`${normKey}:${modelFamily}`);
      googleAccountCooldowns.delete(`${rawKey}:${modelFamily}`);
      quotaExhaustedAccountKeys.delete(`${normKey}:${modelFamily}`);
      quotaExhaustedAccountKeys.delete(`${rawKey}:${modelFamily}`);
      googleAccountCooldowns.delete(baseKey);
      quotaExhaustedAccountKeys.delete(baseKey);
    }
    rateLimitedCooldownKeys.delete(key);
    if (modelFamily) {
      rateLimitedCooldownKeys.delete(`${normKey}:${modelFamily}`);
      rateLimitedCooldownKeys.delete(`${rawKey}:${modelFamily}`);
      rateLimitedCooldownKeys.delete(baseKey);
    }
    accountProbationUntil.set(key, Date.now() + 15_000);
    triggerQuotaCachePersist();
    return false;
  }

  const isExhausted =
    quotaExhaustedAccountKeys.has(key) ||
    quotaExhaustedAccountKeys.has(baseKey) ||
    quotaExhaustedAccountKeys.has(normKey) ||
    quotaExhaustedAccountKeys.has(rawKey) ||
    (modelFamily ? (quotaExhaustedAccountKeys.has(`${normKey}:${modelFamily}`) || quotaExhaustedAccountKeys.has(`${rawKey}:${modelFamily}`)) : false);

  if (isExhausted) return true;
  return Boolean(until);
}

export function setAccountCooldown(candidate: CustomModel, durationMs = 10 * 60_000, modelFamily?: string, isRateLimit = false): void {
  if (
    (candidate as any).isValidationRequired === true ||
    (candidate as any).status === 'validation_required' ||
    (candidate as any).errorDetails?.status === 'VALIDATION_REQUIRED'
  ) {
    return;
  }
  const baseKey = getAccountQuotaKey(candidate);
  const key = modelFamily ? `${baseKey}:${modelFamily}` : baseKey;
  accountProbationUntil.delete(key);
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
  const normKey = baseKey.startsWith('google:') ? baseKey : `google:${baseKey}`;
  const rawKey = baseKey.replace(/^google:/, '');
  const keysToClear = Array.from(new Set([baseKey, normKey, rawKey]));

  if (modelFamily) {
    for (const k of keysToClear) {
      googleAccountCooldowns.delete(`${k}:${modelFamily}`);
      accountProbationUntil.delete(`${k}:${modelFamily}`);
      quotaExhaustedAccountKeys.delete(`${k}:${modelFamily}`);
      rateLimitedCooldownKeys.delete(`${k}:${modelFamily}`);
    }
  }
  for (const k of keysToClear) {
    googleAccountCooldowns.delete(k);
    accountProbationUntil.delete(k);
    quotaExhaustedAccountKeys.delete(k);
    rateLimitedCooldownKeys.delete(k);
  }
  if (candidate.accountEmail) {
    clearAccountQuotaExhaustedFromDisk(candidate.accountEmail);
  }
  triggerQuotaCachePersist();
}

export function clearAccountCooldownByKey(keyOrEmail: string, modelFamily?: string): void {
  if (!keyOrEmail) return;
  const clean = keyOrEmail.replace(/^(google|gemini-cli):/, '').replace(/:(gemini|claude)$/, '').trim().toLowerCase();
  clearAccountCooldown({ accountEmail: clean, provider: 'google' } as CustomModel, modelFamily);
}

export function clearAllAccountCooldowns(): number {
  const totalCleared = googleAccountCooldowns.size;
  googleAccountCooldowns.clear();
  accountProbationUntil.clear();
  quotaExhaustedAccountKeys.clear();
  rateLimitedCooldownKeys.clear();
  clearAllAccountQuotaExhaustedFromDisk();
  triggerQuotaCachePersist();
  return totalCleared;
}

export function getActiveAccountCooldowns(): Record<string, number> {
  const now = Date.now();
  const res: Record<string, number> = {};
  for (const [k, until] of googleAccountCooldowns.entries()) {
    if (until > now) {
      const remainingMs = until - now;
      if (remainingMs >= 60_000 || quotaExhaustedAccountKeys.has(k)) {
        res[k] = until;
      }
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
      if (durationMs < 60_000 && !quotaExhaustedAccountKeys.has(k)) {
        continue;
      }
      if (durationMs >= 60_000 && persistedQuotas) {
        const accKey = k.endsWith(':gemini') ? k.slice(0, -7) : k.endsWith(':claude') ? k.slice(0, -7) : k;
        const normKey = accKey.startsWith('google:') ? accKey : `google:${accKey}`;
        const rawKey = accKey.replace(/^google:/, '');
        const q = persistedQuotas.get(normKey) || persistedQuotas.get(rawKey) || persistedQuotas.get(accKey);
        if (q && typeof q.updatedAt === 'number') {
          const age = now - q.updatedAt;
          const family = k.endsWith(':gemini') ? 'gemini' : k.endsWith(':claude') ? 'claude' : null;
          const fiveHourPct = family === 'claude' ? q.claudeFiveHourPct : q.geminiFiveHourPct;
          const weeklyPct = family === 'claude' ? q.claudeWeeklyPct : q.geminiWeeklyPct;
          const isRealQuotaCooldown = durationMs >= 5 * 3600 * 1000;
          const weeklyOk = typeof weeklyPct !== 'number' || weeklyPct >= 5;
          if (!isRealQuotaCooldown && age < 6 * 3600_000 && typeof fiveHourPct === 'number' && fiveHourPct >= 5 && weeklyOk) {
            log.info(`[GooglePool] Skipping stale rate-limited cooldown restore for ${k} (live quota: 5h=${fiveHourPct}%, wk=${weeklyPct ?? '?'}%, age=${Math.round(age / 60_000)}min)`);
            continue;
          }
        }
      }
      const MAX_WEEKLY_MS = 7 * 24 * 3600_000 + 3600_000;
      const clampedUntil = durationMs > MAX_WEEKLY_MS ? now + 7 * 24 * 3600_000 : until;
      if (clampedUntil !== until) {
        log.info(`[GooglePool] Clamped over-long cooldown for ${k}: ${Math.round(durationMs / 3600_000)}h ? 168h (7-day max)`);
      }
      googleAccountCooldowns.set(k, clampedUntil);
      if (durationMs >= 5 * 3600 * 1000) {
        quotaExhaustedAccountKeys.add(k);
        const hasFamily = k.endsWith(':gemini') || k.endsWith(':claude');
        if (!hasFamily) {
          const accKey = k;
          quotaExhaustedAccountKeys.add(accKey);
          quotaExhaustedAccountKeys.add(accKey.startsWith('google:') ? accKey : `google:${accKey}`);
          quotaExhaustedAccountKeys.add(accKey.replace(/^google:/, ''));
        } else {
          quotaExhaustedAccountKeys.add(k.startsWith('google:') ? k : `google:${k}`);
          quotaExhaustedAccountKeys.add(k.replace(/^google:/, ''));
        }
      }
    }
  }
}

// Wire persistence handlers for cooldowns into quotaCacheStore
registerAccountCooldownHandlers(getActiveAccountCooldowns, restoreActiveAccountCooldowns);

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

export function setFleetModelCooldown(
  modelOrFamily: string,
  durationMs = 30_000,
  reason = 'Fleet 429 saturation',
): void {
  if (!modelOrFamily) return;
  const key = modelOrFamily.trim().toLowerCase();
  const until = Date.now() + Math.max(5000, durationMs);
  fleetModelCooldowns.set(key, { until, reason });
  log.warn(`[Proxy] 🛑 [Fleet Cooldown] Enforcing ${Math.round(durationMs / 1000)}s cooldown for fleet model/family "${key}" (${reason}).`);
}

export function getFleetModelCooldown(
  modelOrFamily: string,
): { active: boolean; remainingMs: number; reason: string } {
  if (!modelOrFamily) return { active: false, remainingMs: 0, reason: '' };
  const key = modelOrFamily.trim().toLowerCase();
  const entry = fleetModelCooldowns.get(key);
  if (!entry) return { active: false, remainingMs: 0, reason: '' };

  const remaining = entry.until - Date.now();
  if (remaining <= 0) {
    fleetModelCooldowns.delete(key);
    return { active: false, remainingMs: 0, reason: '' };
  }

  return { active: true, remainingMs: remaining, reason: entry.reason };
}

export function clearFleetModelCooldown(modelOrFamily?: string): void {
  if (modelOrFamily) {
    fleetModelCooldowns.delete(modelOrFamily.trim().toLowerCase());
  } else {
    fleetModelCooldowns.clear();
  }
}

export function _resetAllAccountCooldowns(): void {
  googleAccountCooldowns.clear();
  accountProbationUntil.clear();
  quotaExhaustedAccountKeys.clear();
  rateLimitedCooldownKeys.clear();
  accountRecentBurstCount.clear();
  fleetModelCooldowns.clear();
}
