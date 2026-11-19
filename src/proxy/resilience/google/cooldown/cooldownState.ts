// ─── Google Account 429 Cooldown & Probation Registry State ─────────────────────────

export const googleAccountCooldowns = new Map<string, number>();
export const accountProbationUntil = new Map<string, number>();

// Tracks accounts that just received a quota_exhausted 429 so concurrent requests
// already past the cooldown snapshot can fast-skip them without an extra network round-trip.
// ponytail: global Set, cleared when setAccountCooldown is called — O(1) lookup, zero overhead.
export const quotaExhaustedAccountKeys = new Set<string>();

// Tracks accounts placed in short rate-limit/burst cooldowns so quota poller doesn't prematurely wake them
export const rateLimitedCooldownKeys = new Set<string>();

// Tracks whole-fleet model cooldowns when a 429 Fleet Circuit Breaker trips across multiple accounts
export const fleetModelCooldowns = new Map<string, { until: number; reason: string }>();

// Tracks accounts/families placed in administrative or 403 quarantine so quota pollers never wake them prematurely
export const quarantinedAccountKeys = new Set<string>();

export function markAccountQuarantined(key: string, modelFamily?: string): void {
  if (!key) return;
  const normKey = key.startsWith('google:') ? key : `google:${key}`;
  const rawKey = key.replace(/^google:/, '');
  if (modelFamily) {
    quarantinedAccountKeys.add(`${normKey}:${modelFamily}`);
    quarantinedAccountKeys.add(`${rawKey}:${modelFamily}`);
    quarantinedAccountKeys.add(`${key}:${modelFamily}`);
  } else {
    quarantinedAccountKeys.add(normKey);
    quarantinedAccountKeys.add(rawKey);
    quarantinedAccountKeys.add(key);
  }
}

export function isAccountQuarantined(key: string, modelFamily?: string): boolean {
  if (!key) return false;
  const normKey = key.startsWith('google:') ? key : `google:${key}`;
  const rawKey = key.replace(/^google:/, '');
  if (quarantinedAccountKeys.has(key) || quarantinedAccountKeys.has(normKey) || quarantinedAccountKeys.has(rawKey)) {
    return true;
  }
  if (modelFamily) {
    return (
      quarantinedAccountKeys.has(`${normKey}:${modelFamily}`) ||
      quarantinedAccountKeys.has(`${rawKey}:${modelFamily}`) ||
      quarantinedAccountKeys.has(`${key}:${modelFamily}`)
    );
  }
  return false;
}

export function markAccountQuotaExhausted(key: string, modelFamily?: string): void {
  const normKey = key.startsWith('google:') ? key : `google:${key}`;
  const rawKey = key.replace(/^google:/, '');
  if (modelFamily) {
    quotaExhaustedAccountKeys.add(`${normKey}:${modelFamily}`);
    quotaExhaustedAccountKeys.add(`${rawKey}:${modelFamily}`);
    quotaExhaustedAccountKeys.add(`${key}:${modelFamily}`);
  } else {
    quotaExhaustedAccountKeys.add(normKey);
    quotaExhaustedAccountKeys.add(rawKey);
    quotaExhaustedAccountKeys.add(key);
  }
}
