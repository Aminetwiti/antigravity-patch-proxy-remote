export type Google429Category = 'soft_rate_limit' | 'rate_limited' | 'quota_exhausted' | 'unknown';

export interface Google429Decision {
  category: Google429Category;
  cooldownMs: number;
  reason: string;
  isExplicitReset?: boolean;
  rawRetryAfterMs?: number | null;
  weeklyResetMs?: number | null;
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
  const FIVE_H_15_MS = 5 * 3600_000 + 15 * 60_000; // 5h 15min ceiling
  let weeklyResetMs: number | null = null;
  if (retryAfterMs === null) {
    const resetMatch = msg.match(/resets?\s+in\s+(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/);
    if (resetMatch && (resetMatch[1] || resetMatch[2] || resetMatch[3])) {
      const h = parseInt(resetMatch[1] || '0', 10);
      const m = parseInt(resetMatch[2] || '0', 10);
      const s = parseInt(resetMatch[3] || '0', 10);
      const parsed = (h * 3600 + m * 60 + s) * 1000;
      if (parsed > 0) {
        if (parsed <= FIVE_H_15_MS) {
          retryAfterMs = parsed;
        } else {
          weeklyResetMs = parsed;
        }
      } else {
        retryAfterMs = 0;
      }
    }
  } else if (retryAfterMs > FIVE_H_15_MS) {
    weeklyResetMs = retryAfterMs;
    retryAfterMs = null;
  }

  // 1. Specific RPM / per-minute limit indicators
  const isRpmLimit = msg.includes('per minute') || msg.includes('per_minute') || msg.includes('rpm');
  if (isRpmLimit) {
    return {
      category: 'rate_limited',
      cooldownMs: retryAfterMs && retryAfterMs > 0 ? retryAfterMs : 60_000,
      reason: 'RPM limit — 60s cooldown',
      isExplicitReset: retryAfterMs !== null,
      rawRetryAfterMs: retryAfterMs,
    };
  }

  // 2. Explicit zero-second reset or micro-burst throttle
  const isZeroSecondReset =
    /\breset\s+(?:after|in)\s+0s\b/i.test(msg) ||
    /\bresets?\s+in\s+0s\b/i.test(msg) ||
    /\bresets?\s+in\s+0\s*seconds?\b/i.test(msg) ||
    retryAfterMs === 0;

  if (
    isZeroSecondReset ||
    (retryAfterMs !== null && retryAfterMs <= 3000)
  ) {
    return {
      category: 'soft_rate_limit',
      cooldownMs: retryAfterMs && retryAfterMs > 0 ? retryAfterMs : 3000,
      reason: isZeroSecondReset
        ? 'Soft burst throttle — momentary capacity pause (resets in 0s)'
        : 'Soft burst throttle — momentary pause',
      isExplicitReset: true,
      rawRetryAfterMs: retryAfterMs ?? 0,
    };
  }

  // 3. Daily, 5-hour, or credit quota exhaustion
  const QUOTA_EXHAUSTED_KEYWORDS = [
    'quota_exhausted',
    'quota exhausted',
    'quota reached',
    'enable overages',
    'individual quota',
    'upgrade your subscription',
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
    'daily limit',
    'free tier',
  ];

  const hasExplicitMultiHourReset =
    weeklyResetMs !== null ||
    (retryAfterMs !== null && retryAfterMs >= 15 * 60_000);

  const hasQuotaExhaustedKeyword = QUOTA_EXHAUSTED_KEYWORDS.some((kw) => msg.includes(kw));

  if (hasQuotaExhaustedKeyword || hasExplicitMultiHourReset) {
    const quotaCooldownMs = retryAfterMs && retryAfterMs > 0 && retryAfterMs <= FIVE_H_15_MS
      ? Math.max(retryAfterMs, 5 * 60 * 60 * 1000)
      : 5 * 60 * 60 * 1000;
    return {
      category: 'quota_exhausted',
      cooldownMs: quotaCooldownMs,
      reason: weeklyResetMs !== null
        ? `Quota exhausted (weekly reset in ${Math.round(weeklyResetMs / 3_600_000)}h) — 5h cooldown and switch account`
        : `Quota exhausted — ${Math.round(quotaCooldownMs / 3_600_000)}h cooldown and switch account`,
      isExplicitReset: retryAfterMs !== null,
      rawRetryAfterMs: retryAfterMs,
      weeklyResetMs,
    };
  }

  // 4. Soft / burst rate limit
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
      isExplicitReset: retryAfterMs !== null,
      rawRetryAfterMs: retryAfterMs,
    };
  }

  // 5. Generic Rate limit indicators
  if (
    msg.includes('rate limit') ||
    msg.includes('rate_limit') ||
    msg.includes('too many requests') ||
    msg.includes('resource_exhausted') ||
    msg.includes('resource has been exhausted') ||
    msg.includes('quota exceeded') ||
    msg.includes('exhausted your capacity')
  ) {
    return {
      category: 'rate_limited',
      cooldownMs: retryAfterMs && retryAfterMs > 0 ? retryAfterMs : 30_000,
      reason: 'Rate limit — 30s cooldown',
      isExplicitReset: retryAfterMs !== null,
      rawRetryAfterMs: retryAfterMs,
    };
  }

  // 6. Default / Unknown 429
  return {
    category: 'unknown',
    cooldownMs: retryAfterMs && retryAfterMs > 0 ? retryAfterMs : 60_000,
    reason: 'Generic 429 rate limit',
    isExplicitReset: retryAfterMs !== null,
    rawRetryAfterMs: retryAfterMs,
  };
}
