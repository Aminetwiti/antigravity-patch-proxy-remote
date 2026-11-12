import log from 'electron-log';
import type { CustomModel } from '../../../core/types';
import { getAllLiveAccountQuotas, type AccountLiveQuota } from '../../../../services/auth/googleAuth';
import { triggerQuotaCachePersist } from '../../../../services/storage/quotaCacheStore';
import {
  googleAccountCooldowns,
  accountProbationUntil,
  quotaExhaustedAccountKeys,
  rateLimitedCooldownKeys,
} from './cooldownState';

/**
 * Evaluates whether a single model family (gemini or claude) has recovered its quota.
 */
function evaluateFamilyRecovery(
  family: 'gemini' | 'claude',
  quota: AccountLiveQuota,
  now: number,
  isStrictCooldown: boolean,
  isQuotaExhausted: boolean,
  quotaIsFresh: boolean,
): { shouldWakeUp: boolean; reason: string } {
  const isGemini = family === 'gemini';
  const fiveHourPct = isGemini ? quota.geminiFiveHourPct : quota.claudeFiveHourPct;
  const weekVal = typeof (isGemini ? quota.geminiWeeklyPct : quota.claudeWeeklyPct) === 'number'
    ? (isGemini ? quota.geminiWeeklyPct : quota.claudeWeeklyPct)
    : (typeof quota.weeklyPercentage === 'number' ? quota.weeklyPercentage : null);
  const weekStr = weekVal !== null ? `, week=${weekVal}%` : '';

  const resetStr = isGemini
    ? (quota.geminiResetTime || quota.geminiFiveHourReset || (quota as any).fiveHourResetTime)
    : (quota.claudeResetTime || quota.claudeFiveHourReset || (quota as any).fiveHourResetTime);
  const resetTs = resetStr ? Date.parse(resetStr) : 0;
  const resetPassed = Boolean(resetStr && resetTs > 0 && resetTs <= now);

  const weeklyResetStr = isGemini
    ? (quota.geminiWeeklyReset || (quota as any).weeklyResetTime)
    : (quota.claudeWeeklyReset || (quota as any).weeklyResetTime);
  const weeklyResetTs = weeklyResetStr ? Date.parse(weeklyResetStr) : 0;
  const weeklyResetPassed = Boolean((weeklyResetTs > 0 && weeklyResetTs <= now) || (!weeklyResetStr && quotaIsFresh && (weekVal === null || weekVal >= 20) && fiveHourPct >= 20));
  const weeklyDepleted = weekVal !== null && weekVal < 5 && !weeklyResetPassed;

  const label = isGemini ? 'Gemini' : 'Claude';

  if (isQuotaExhausted) {
    if (isStrictCooldown) {
      if (weeklyResetPassed && fiveHourPct >= 5 && (weekVal === null || weekVal >= 5)) {
        return { shouldWakeUp: true, reason: `${label} weekly reset timestamp elapsed in reality (${weeklyResetStr}${weekStr})` };
      }
    } else {
      if (resetPassed && fiveHourPct >= 5 && !weeklyDepleted) {
        return { shouldWakeUp: true, reason: `${label} 5h reset timestamp elapsed (${resetStr}${weekStr})` };
      }
    }
  } else {
    const isFullyRestored = fiveHourPct === 100 && (weekVal === null || weekVal >= 50);
    if (resetPassed && fiveHourPct >= 5) {
      return { shouldWakeUp: true, reason: `${label} reset timestamp elapsed (${resetStr}${weekStr})` };
    } else if (isFullyRestored) {
      return { shouldWakeUp: true, reason: `full quota restored (5h=100%${weekStr})` };
    } else if (fiveHourPct >= 5 && !weeklyDepleted) {
      return { shouldWakeUp: true, reason: `${quotaIsFresh ? 'fresh live' : 'healthy'} quota (5h=${fiveHourPct}%${weekStr})` };
    }
  }
  return { shouldWakeUp: false, reason: '' };
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
    if (!googleAccountCooldowns.has(key)) continue;
    checked++;

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
    const altKey = family
      ? (key.startsWith('google:') ? `${rawAcc}:${family}` : `${normAcc}:${family}`)
      : (key.startsWith('google:') ? rawAcc : normAcc);

    if (until <= now) {
      googleAccountCooldowns.delete(key);
      googleAccountCooldowns.delete(altKey);
      quotaExhaustedAccountKeys.delete(key);
      quotaExhaustedAccountKeys.delete(altKey);
      accountProbationUntil.delete(key);
      accountProbationUntil.delete(altKey);
      rateLimitedCooldownKeys.delete(key);
      rateLimitedCooldownKeys.delete(altKey);
      cleared++;
      details.push(`${key} (expired naturally)`);
      continue;
    }

    let quota = quotas.get(normAcc) || quotas.get(rawAcc) || quotas.get(accKey);
    if (!quota && Array.isArray(customModels)) {
      const match = customModels.find((m) => {
        const email = (m.accountEmail || '').toLowerCase();
        return email && (normAcc.toLowerCase().includes(email) || rawAcc.toLowerCase().includes(email));
      });
      if (match?.quotas) quota = match.quotas as unknown as AccountLiveQuota;
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

    if (isRateLimited) continue;

    if (quota) {
      const remaining = until - now;
      const isStrictCooldown = remaining > 5.5 * 3600_000;
      const isQuotaExhausted =
        quotaExhaustedAccountKeys.has(key) ||
        quotaExhaustedAccountKeys.has(accKey) ||
        quotaExhaustedAccountKeys.has(normAcc) ||
        quotaExhaustedAccountKeys.has(rawAcc) ||
        (family ? (quotaExhaustedAccountKeys.has(`${normAcc}:${family}`) || quotaExhaustedAccountKeys.has(`${rawAcc}:${family}`)) : false);

      const LIVE_QUOTA_FRESH_MS = 10 * 60_000;
      const quotaIsFresh = typeof quota.updatedAt === 'number' && (now - quota.updatedAt) <= LIVE_QUOTA_FRESH_MS;

      let shouldWakeUp = false;
      let reason = '';

      if (family === 'gemini' || family === 'claude') {
        const res = evaluateFamilyRecovery(family, quota, now, isStrictCooldown, isQuotaExhausted, quotaIsFresh);
        shouldWakeUp = res.shouldWakeUp;
        reason = res.reason;
      } else {
        const gRes = evaluateFamilyRecovery('gemini', quota, now, isStrictCooldown, isQuotaExhausted, quotaIsFresh);
        const cRes = evaluateFamilyRecovery('claude', quota, now, isStrictCooldown, isQuotaExhausted, quotaIsFresh);

        if (gRes.shouldWakeUp && cRes.shouldWakeUp) {
          shouldWakeUp = true;
          reason = `Multi-family recovered (${gRes.reason}; ${cRes.reason})`;
        } else if (!gRes.shouldWakeUp && cRes.shouldWakeUp) {
          const cdUntil = googleAccountCooldowns.get(key);
          if (cdUntil && cdUntil > now) {
            googleAccountCooldowns.set(`${key}:gemini`, cdUntil);
            if (isQuotaExhausted) quotaExhaustedAccountKeys.add(`${key}:gemini`);
          }
          shouldWakeUp = true;
          reason = `Decoupled root cooldown: freed Claude, partitioned Gemini to ${key}:gemini`;
        } else if (gRes.shouldWakeUp && !cRes.shouldWakeUp) {
          const cdUntil = googleAccountCooldowns.get(key);
          if (cdUntil && cdUntil > now) {
            googleAccountCooldowns.set(`${key}:claude`, cdUntil);
            if (isQuotaExhausted) quotaExhaustedAccountKeys.add(`${key}:claude`);
          }
          shouldWakeUp = true;
          reason = `Decoupled root cooldown: freed Gemini, partitioned Claude to ${key}:claude`;
        }
      }

      if (shouldWakeUp) {
        googleAccountCooldowns.delete(key);
        googleAccountCooldowns.delete(altKey);
        quotaExhaustedAccountKeys.delete(key);
        quotaExhaustedAccountKeys.delete(altKey);
        accountProbationUntil.delete(key);
        accountProbationUntil.delete(altKey);
        rateLimitedCooldownKeys.delete(key);
        rateLimitedCooldownKeys.delete(altKey);
        cleared++;
        details.push(`${key} (${reason})`);
      }
    }
  }

  for (const k of Array.from(quotaExhaustedAccountKeys)) {
    if (!googleAccountCooldowns.has(k)) quotaExhaustedAccountKeys.delete(k);
  }
  for (const k of Array.from(rateLimitedCooldownKeys)) {
    if (!googleAccountCooldowns.has(k)) rateLimitedCooldownKeys.delete(k);
  }

  const active = new Set(Array.from(googleAccountCooldowns.keys()).map((k) => k.replace(/^google:/, ''))).size;
  if (cleared > 0) {
    log.info(`[Proxy] 🟢 Cooldown Verification / Wake-up: ${checked} checked, ${active} active, ${cleared} woke up: ${details.join(', ')}`);
    triggerQuotaCachePersist();
  } else {
    log.info(`[Proxy] 🟢 Cooldown Verification / Wake-up: ${checked} checked, ${active} active cooldown(s) remain.`);
  }

  return { checked, active, cleared, details };
}
