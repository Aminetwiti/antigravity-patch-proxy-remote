import { triggerQuotaCachePersist } from '../../../../services/storage/quotaCacheStore';
import {
  googleAccountCooldowns,
  accountProbationUntil,
  quotaExhaustedAccountKeys,
  rateLimitedCooldownKeys,
} from './cooldownState';
import { accountRecentBurstCount } from '../concurrency/rateLimiter';

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
    if (!googleAccountCooldowns.has(key)) {
      continue;
    }
    const remaining = until - now;
    if (remaining > 0 && remaining <= MAX_BURST_CD_MS && !quotaExhaustedAccountKeys.has(key)) {
      googleAccountCooldowns.delete(key);
      accountProbationUntil.delete(key);
      rateLimitedCooldownKeys.delete(key);
      const altKey = key.startsWith('google:') ? key.replace(/^google:/, '') : `google:${key}`;
      googleAccountCooldowns.delete(altKey);
      accountProbationUntil.delete(altKey);
      rateLimitedCooldownKeys.delete(altKey);
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
