import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { CustomModel } from '../proxy/types';

// Import directly from the new module (not via proxy.ts re-exports)
import {
  getAccountQuotaKey,
  registerAccountRefreshToken,
  isAccountUnlicensed,
  markAccountUnlicensed,
  _resetUnlicensedAccounts,
  isAccountInCooldown,
  setAccountCooldown,
  getAccountCooldownRemaining,
  clearAccountCooldown,
  _resetAllAccountCooldowns,
  isAccountInProbation,
  endAccountProbation,
  _resetAccountProbation,
  getModelQuotaScore,
  getAccountDynamicScore,
  getAccountInFlight,
  incrementAccountInFlight,
  decrementAccountInFlight,
  _resetAccountInFlight,
  recordAccountRequest,
  getAccountRpmCount,
  _resetAccountRpm,
  recordAccountLatency,
  getAccountAvgLatency,
  _resetAccountLatencies,
  EWMA_DECAY_THRESHOLD_MS,
  isPoolUnderQuotaStress,
  classifyGoogleCloudCode429,
  selectCandidateP2C,
  selectBestModelByQuota,
  getGoogleAccountPool,
  MAX_CONCURRENT_PER_ACCOUNT,
  markAccountQuotaExhausted,
  recordAccountBurst,
  clearAccountBurst,
  _resetAccountBurst,
  verifyAndReconcileCooldowns,
} from '../proxy/googlePool';
import { updateLiveAccountQuota } from '../services/googleAuth';
import { GOOGLE_POOL_HEADER_TIMEOUT_MS, P2C_SCORE_DELTA } from '../constants';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeModel(overrides: Partial<CustomModel> = {}): CustomModel {
  return {
    name: 'gemini-2.5-pro',
    provider: 'google',
    apiUrl: 'https://daily-cloudcode-pa.googleapis.com',
    apiKey: 'ya29.fake',
    externalModelName: 'gemini-2.5-pro',
    accountEmail: 'test@example.com',
    refreshToken: 'refresh_abc',
    ...overrides,
  } as CustomModel;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('getAccountQuotaKey', () => {
  it('uses email prefix google: when accountEmail set', () => {
    const m = makeModel({ accountEmail: 'user@gmail.com', refreshToken: undefined });
    expect(getAccountQuotaKey(m)).toBe('google:user@gmail.com');
  });

  it('uses gemini-cli prefix for gemini-cli models', () => {
    const m = makeModel({ accountEmail: 'cli@gmail.com', apiUrl: 'https://generativelanguage.googleapis.com', name: 'gemini-cli:gemini-2.5-pro' });
    // isGeminiCliModel checks name prefix
    const key = getAccountQuotaKey(m);
    expect(key).toMatch(/gemini-cli:|google:/);
  });

  it('falls back to refreshToken tail when no email', () => {
    const m = makeModel({ accountEmail: undefined, refreshToken: '1234567890abcdefghijk' });
    const key = getAccountQuotaKey(m);
    expect(key).toContain('refresh:');
  });

  it('registerAccountRefreshToken maps token to email', () => {
    registerAccountRefreshToken('tok123', 'mapped@example.com');
    const m = makeModel({ accountEmail: undefined, refreshToken: 'tok123' });
    expect(getAccountQuotaKey(m)).toBe('google:mapped@example.com');
  });
});

describe('Unlicensed accounts', () => {
  beforeEach(() => _resetUnlicensedAccounts());

  it('is not unlicensed by default', () => {
    expect(isAccountUnlicensed(makeModel())).toBe(false);
  });

  it('marks and detects unlicensed', () => {
    const m = makeModel({ accountEmail: 'locked@example.com' });
    markAccountUnlicensed(m);
    expect(isAccountUnlicensed(m)).toBe(true);
  });

  it('isAccountInCooldown returns true for unlicensed', () => {
    const m = makeModel({ accountEmail: 'locked2@example.com' });
    markAccountUnlicensed(m);
    expect(isAccountInCooldown(m)).toBe(true);
  });
});

describe('Cooldown registry', () => {
  beforeEach(() => {
    _resetAllAccountCooldowns();
    _resetUnlicensedAccounts();
  });

  it('not in cooldown by default', () => {
    expect(isAccountInCooldown(makeModel())).toBe(false);
  });

  it('enters cooldown after setAccountCooldown', () => {
    const m = makeModel();
    setAccountCooldown(m, 60_000);
    expect(isAccountInCooldown(m)).toBe(true);
  });

  it('getAccountCooldownRemaining returns positive ms', () => {
    const m = makeModel();
    setAccountCooldown(m, 60_000);
    const rem = getAccountCooldownRemaining(m);
    expect(rem).toBeGreaterThan(55_000); // allows 5s jitter
    expect(rem).toBeLessThanOrEqual(65_000); // jitter max 5s
  });

  it('clearAccountCooldown ends cooldown', () => {
    const m = makeModel();
    setAccountCooldown(m, 60_000);
    clearAccountCooldown(m);
    expect(isAccountInCooldown(m)).toBe(false);
  });

  it('expired cooldown transitions to probation', () => {
    const m = makeModel();
    // Set cooldown in the past
    setAccountCooldown(m, -1); // expires immediately
    // isAccountInCooldown should detect expiry and set probation
    const inCooldown = isAccountInCooldown(m);
    expect(inCooldown).toBe(false);
    expect(isAccountInProbation(m)).toBe(true);
  });

  it('modelFamily-scoped cooldown', () => {
    const m = makeModel();
    setAccountCooldown(m, 60_000, 'gemini');
    expect(isAccountInCooldown(m, 'gemini')).toBe(true);
    expect(isAccountInCooldown(m, 'claude')).toBe(false);
  });

  it('markAccountQuotaExhausted makes account appear in cooldown', () => {
    const m = makeModel({ accountEmail: 'quota@example.com' });
    const key = getAccountQuotaKey(m);
    markAccountQuotaExhausted(key);
    expect(isAccountInCooldown(m)).toBe(true);
  });
});

describe('Probation', () => {
  beforeEach(() => {
    _resetAllAccountCooldowns();
    _resetAccountProbation();
  });

  it('not in probation by default', () => {
    expect(isAccountInProbation(makeModel())).toBe(false);
  });

  it('endAccountProbation clears it', () => {
    const m = makeModel();
    setAccountCooldown(m, -1); // immediately expires → sets probation
    isAccountInCooldown(m); // triggers transition
    expect(isAccountInProbation(m)).toBe(true);
    endAccountProbation(m);
    expect(isAccountInProbation(m)).toBe(false);
  });
});

describe('getModelQuotaScore', () => {
  it('returns 50 for model with no quota data', () => {
    const m = makeModel({ quotas: undefined });
    expect(getModelQuotaScore(m)).toBe(50);
  });

  it('returns 25 for AI Studio key with no quota', () => {
    const m = makeModel({ apiKey: 'AIzaSyFake', accountEmail: undefined, refreshToken: undefined, quotas: undefined });
    expect(getModelQuotaScore(m)).toBe(25);
  });

  it('returns 0 for cloud code model without refreshToken and non-ya29 key', () => {
    const m = makeModel({ refreshToken: undefined, apiKey: 'not-a-token' });
    // isGoogleCloudCodeModel checks apiUrl
    const score = getModelQuotaScore(m);
    // For cloud-code URL without valid token: should be 0
    expect(score).toBe(0);
  });

  it('computes weighted score from quota percentages', () => {
    const m = makeModel({
      quotas: { geminiFiveHourPct: 80, geminiWeeklyPct: 60 } as any,
    });
    const expected = 80 * 0.7 + 60 * 0.3;
    expect(getModelQuotaScore(m)).toBeCloseTo(expected, 1);
  });

  it('returns 0 when fiveHour is 0 and reset not passed', () => {
    const m = makeModel({
      quotas: { geminiFiveHourPct: 0, geminiWeeklyPct: 50 } as any,
    });
    expect(getModelQuotaScore(m)).toBe(0);
  });
});

describe('In-flight tracking', () => {
  beforeEach(() => _resetAccountInFlight());

  it('starts at 0', () => {
    expect(getAccountInFlight(makeModel())).toBe(0);
  });

  it('increments and decrements', () => {
    const m = makeModel();
    incrementAccountInFlight(m);
    incrementAccountInFlight(m);
    expect(getAccountInFlight(m)).toBe(2);
    decrementAccountInFlight(m);
    expect(getAccountInFlight(m)).toBe(1);
  });

  it('does not go below 0', () => {
    const m = makeModel();
    decrementAccountInFlight(m);
    expect(getAccountInFlight(m)).toBe(0);
  });
});

describe('RPM governor', () => {
  beforeEach(() => _resetAccountRpm());

  it('counts requests within window', () => {
    const m = makeModel();
    recordAccountRequest(m);
    recordAccountRequest(m);
    expect(getAccountRpmCount(m)).toBe(2);
  });

  it('starts at 0', () => {
    expect(getAccountRpmCount(makeModel())).toBe(0);
  });
});

describe('EWMA latency tracker', () => {
  beforeEach(() => _resetAccountLatencies());

  it('returns 0 for unknown account', () => {
    expect(getAccountAvgLatency(makeModel())).toBe(0);
  });

  it('first recording sets ewma to that value', () => {
    const m = makeModel();
    recordAccountLatency(m, 1000);
    expect(getAccountAvgLatency(m)).toBe(1000);
  });

  it('EWMA converges toward new values (alpha=0.2)', () => {
    const m = makeModel();
    recordAccountLatency(m, 1000);
    recordAccountLatency(m, 500);
    // ewma = round(0.2*500 + 0.8*1000) = round(100 + 800) = 900
    expect(getAccountAvgLatency(m)).toBe(900);
  });

  it('ignores non-positive or non-finite values', () => {
    const m = makeModel();
    recordAccountLatency(m, -100);
    recordAccountLatency(m, 0);
    recordAccountLatency(m, Infinity);
    expect(getAccountAvgLatency(m)).toBe(0);
  });

  it('decays to 0 after EWMA_DECAY_THRESHOLD_MS', async () => {
    vi.useFakeTimers();
    const m = makeModel();
    recordAccountLatency(m, 1000);
    expect(getAccountAvgLatency(m)).toBe(1000);
    vi.advanceTimersByTime(EWMA_DECAY_THRESHOLD_MS + 1);
    expect(getAccountAvgLatency(m)).toBe(0); // lazy eviction
    vi.useRealTimers();
  });
});

describe('isPoolUnderQuotaStress', () => {
  beforeEach(() => {
    _resetAllAccountCooldowns();
    _resetUnlicensedAccounts();
  });

  it('returns true for empty pool', () => {
    expect(isPoolUnderQuotaStress([])).toBe(true);
  });

  it('returns false when accounts have good quota', () => {
    const accounts = [
      makeModel({ accountEmail: 'a@test.com', quotas: { geminiFiveHourPct: 80, geminiWeeklyPct: 80 } as any }),
      makeModel({ accountEmail: 'b@test.com', quotas: { geminiFiveHourPct: 70, geminiWeeklyPct: 70 } as any }),
    ];
    expect(isPoolUnderQuotaStress(accounts)).toBe(false);
  });

  it('returns true when average quota below 15', () => {
    const accounts = [
      makeModel({ accountEmail: 'low@test.com', quotas: { geminiFiveHourPct: 5, geminiWeeklyPct: 5 } as any }),
    ];
    expect(isPoolUnderQuotaStress(accounts)).toBe(true);
  });
});

describe('classifyGoogleCloudCode429', () => {
  it('classifies soft rate limit on "try again"', () => {
    const r = classifyGoogleCloudCode429('please try again later');
    expect(r.category).toBe('soft_rate_limit');
    expect(r.cooldownMs).toBeGreaterThan(0);
  });

  it('classifies RPM limit on "per minute"', () => {
    const r = classifyGoogleCloudCode429('Requests per minute quota exceeded');
    expect(r.category).toBe('rate_limited');
    expect(r.cooldownMs).toBe(60_000);
  });

  it('classifies quota exhaustion', () => {
    const r = classifyGoogleCloudCode429('quota_exhausted: daily limit reached');
    expect(r.category).toBe('quota_exhausted');
    expect(r.cooldownMs).toBeGreaterThanOrEqual(5 * 3600 * 1000);
  });

  it('unknown 429 defaults to 60s', () => {
    const r = classifyGoogleCloudCode429('some unknown error');
    expect(r.category).toBe('unknown');
    expect(r.cooldownMs).toBe(60_000);
  });

  it('parses Retry-After header in seconds', () => {
    const r = classifyGoogleCloudCode429('try again', '30');
    expect(r.cooldownMs).toBe(30_000);
  });

  it('parses "resets in Xh Ym Zs" from body — value within 5h window', () => {
    const r = classifyGoogleCloudCode429('quota exceeded. resets in 2h30m0s');
    expect(r.category).toBe('quota_exhausted');
    // 2h30m = 9_000_000ms, floored to max(9_000_000, 5h=18_000_000) = 18_000_000
    expect(r.cooldownMs).toBe(Math.max(9_000_000, 5 * 3600 * 1000));
  });

  it('ignores weekly-scale "Resets in 92h 52m" in quota_exhausted body — caps at 5h default', () => {
    // Google embeds weekly reset time in quota-exhausted messages for accounts with remaining weekly quota.
    // The 5h rolling window never exceeds 5h15m, so 92h is the weekly marker — must be discarded.
    const r = classifyGoogleCloudCode429('quota_exhausted. resets in 92h52m9s');
    expect(r.category).toBe('quota_exhausted');
    expect(r.cooldownMs).toBe(5 * 3600 * 1000); // default 5h, not 92h
  });

  it('ignores weekly-scale "Resets in 93h" from Retry-After header — caps at 5h for quota_exhausted', () => {
    // retryAfterMs parsed from header = 93h; quota keyword present → must still cap at 5h15m
    const r = classifyGoogleCloudCode429('quota_exhausted: your quota was exhausted', String(93 * 3600));
    expect(r.category).toBe('quota_exhausted');
    expect(r.cooldownMs).toBe(5 * 3600 * 1000); // 93h > 5h15m → discard, use 5h default
  });

  it('parses RetryInfo JSON metadata', () => {
    const body = JSON.stringify({
      error: {
        details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '45s' }],
      },
    });
    const r = classifyGoogleCloudCode429(body);
    // 45s retry → soft_rate_limit (<=3s check fails, but it's not rpm keywords, not quota keywords → unknown with 45s)
    expect(r.cooldownMs).toBe(45_000);
  });

  it('parses ErrorInfo quotaResetDelay from JSON', () => {
    const body = JSON.stringify({
      error: {
        details: [{
          '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
          metadata: { quotaResetDelay: '1h' },
        }],
      },
    });
    const r = classifyGoogleCloudCode429(body);
    expect(r.cooldownMs).toBeGreaterThanOrEqual(3600_000);
  });
});

describe('selectCandidateP2C', () => {
  beforeEach(() => {
    _resetAllAccountCooldowns();
    _resetAccountInFlight();
    _resetAccountRpm();
    _resetAccountLatencies();
    _resetUnlicensedAccounts();
  });

  it('returns undefined for empty array', () => {
    expect(selectCandidateP2C([])).toBeUndefined();
  });

  it('returns the only candidate', () => {
    const m = makeModel({ accountEmail: 'solo@test.com', quotas: { geminiFiveHourPct: 80, geminiWeeklyPct: 80 } as any });
    expect(selectCandidateP2C([m])).toBe(m);
  });

  it('prefers non-cooldown candidates', () => {
    const hot = makeModel({ accountEmail: 'hot@test.com', quotas: { geminiFiveHourPct: 80, geminiWeeklyPct: 80 } as any });
    const cool = makeModel({ accountEmail: 'cool@test.com', quotas: { geminiFiveHourPct: 80, geminiWeeklyPct: 80 } as any });
    setAccountCooldown(cool, 60_000);
    const chosen = selectCandidateP2C([hot, cool], 'gemini');
    expect(chosen).toBe(hot);
  });

  it('selects from top tier when multiple healthy candidates', () => {
    const accounts = [
      makeModel({ accountEmail: 'a@test.com', quotas: { geminiFiveHourPct: 80, geminiWeeklyPct: 80 } as any }),
      makeModel({ accountEmail: 'b@test.com', quotas: { geminiFiveHourPct: 78, geminiWeeklyPct: 78 } as any }),
      makeModel({ accountEmail: 'c@test.com', quotas: { geminiFiveHourPct: 76, geminiWeeklyPct: 76 } as any }),
    ];
    const chosen = selectCandidateP2C(accounts, 'gemini');
    expect(accounts).toContain(chosen);
  });
});

describe('selectBestModelByQuota', () => {
  beforeEach(() => {
    _resetAllAccountCooldowns();
    _resetAccountInFlight();
  });

  it('returns undefined for empty array', () => {
    expect(selectBestModelByQuota([])).toBeUndefined();
  });

  it('returns the only candidate', () => {
    const m = makeModel();
    expect(selectBestModelByQuota([m])).toBe(m);
  });

  it('prefers higher-quota candidate', () => {
    const low  = makeModel({ accountEmail: 'low@test.com',  quotas: { geminiFiveHourPct: 10, geminiWeeklyPct: 10 } as any });
    const high = makeModel({ accountEmail: 'high@test.com', quotas: { geminiFiveHourPct: 90, geminiWeeklyPct: 90 } as any });
    expect(selectBestModelByQuota([low, high])).toBe(high);
  });
});

describe('getGoogleAccountPool', () => {
  it('returns matchedModel if allModels empty', () => {
    const m = makeModel();
    expect(getGoogleAccountPool(m, [])).toEqual([m]);
  });

  it('deduplicates by account key', () => {
    const base = makeModel({ accountEmail: 'dup@test.com', externalModelName: 'gemini-2.5-pro' });
    const dup  = makeModel({ accountEmail: 'dup@test.com', externalModelName: 'gemini-2.5-pro' });
    const pool = getGoogleAccountPool(base, [base, dup]);
    expect(pool.length).toBe(1);
  });

  it('excludes unlicensed accounts', () => {
    beforeEach(() => _resetUnlicensedAccounts());
    const matched = makeModel({ accountEmail: 'ok@test.com',     externalModelName: 'gemini-2.5-pro' });
    const bad     = makeModel({ accountEmail: 'locked@test.com', externalModelName: 'gemini-2.5-pro' });
    markAccountUnlicensed(bad);
    const pool = getGoogleAccountPool(matched, [matched, bad]);
    expect(pool).not.toContain(bad);
  });
});

describe('Burst Rate Limit Governor & Constants', () => {
  beforeEach(() => {
    _resetAccountBurst();
    _resetAllAccountCooldowns();
  });

  it('verifies GOOGLE_POOL_HEADER_TIMEOUT_MS defaults to 35s', () => {
    expect(GOOGLE_POOL_HEADER_TIMEOUT_MS).toBe(35_000);
  });

  it('verifies P2C_SCORE_DELTA defaults to 45 points', () => {
    expect(P2C_SCORE_DELTA).toBe(45);
  });

  it('tracks burst occurrences and resets on success', () => {
    const acc = makeModel({ accountEmail: 'burst@test.com' });
    expect(recordAccountBurst(acc)).toBe(1);
    expect(recordAccountBurst(acc)).toBe(2);
    expect(recordAccountBurst(acc)).toBe(3);

    clearAccountBurst(acc);
    expect(recordAccountBurst(acc)).toBe(1);
  });

  it('includes accounts within P2C_SCORE_DELTA in topTier and picks the fresher idle account', () => {
    const accHigh = makeModel({
      accountEmail: 'high@test.com',
      quotas: { geminiFiveHourPct: 95, geminiWeeklyPct: 95 } as any,
    });
    const accMed = makeModel({
      accountEmail: 'med@test.com',
      quotas: { geminiFiveHourPct: 55, geminiWeeklyPct: 55 } as any,
    });

    // Score gap is 95 - 55 = 40 (<= P2C_SCORE_DELTA 45)
    // Mark accHigh as recently used
    recordAccountRequest(accHigh);

    const chosen = selectCandidateP2C([accHigh, accMed], 'gemini');
    // Because accMed was used less recently (idle), P2C chooses accMed to balance load!
    expect(chosen).toBe(accMed);
  });

  it('guarantees strict isolation: 429 on one account never puts other accounts in cooldown', () => {
    const accA = makeModel({ accountEmail: 'account-a@test.com' });
    const accB = makeModel({ accountEmail: 'account-b@test.com' });

    expect(isAccountInCooldown(accA, 'gemini')).toBe(false);
    expect(isAccountInCooldown(accB, 'gemini')).toBe(false);

    // Account A experiences a 429 and enters cooldown
    setAccountCooldown(accA, 10_000, 'gemini');

    // Account A must be in cooldown, but Account B must remain completely unaffected
    expect(isAccountInCooldown(accA, 'gemini')).toBe(true);
    expect(isAccountInCooldown(accB, 'gemini')).toBe(false);
    expect(getAccountCooldownRemaining(accB, 'gemini')).toBe(0);
  });

  it('applies clean micro-pause of 5s on single account rate limit without jitter and without impacting peer accounts', () => {
    const accA = makeModel({ accountEmail: 'isolated-a@test.com' });
    const accB = makeModel({ accountEmail: 'isolated-b@test.com' });

    setAccountCooldown(accA, 5_000, 'gemini');

    const remainingA = getAccountCooldownRemaining(accA, 'gemini');
    const remainingB = getAccountCooldownRemaining(accB, 'gemini');

    // Account A receives exact 5s cooldown (no jitter added because <= 15s)
    expect(remainingA).toBeGreaterThan(0);
    expect(remainingA).toBeLessThanOrEqual(5_000);
    expect(isAccountInCooldown(accA, 'gemini')).toBe(true);

    // Account B remains completely untouched
    expect(remainingB).toBe(0);
    expect(isAccountInCooldown(accB, 'gemini')).toBe(false);
  });

  it('penalizes a fresh 100% quota account used seconds ago to rotate to an idle 75% account', () => {
    const fresh100 = makeModel({
      accountEmail: 'fresh100@test.com',
      quotas: { geminiFiveHourPct: 100, geminiWeeklyPct: 100 } as any,
    });
    const idle75 = makeModel({
      accountEmail: 'idle75@test.com',
      quotas: { geminiFiveHourPct: 75, geminiWeeklyPct: 75 } as any,
    });

    // Before any requests: fresh100 has score 100, idle75 has score 75
    expect(getAccountDynamicScore(fresh100, 'gemini')).toBe(100);
    expect(getAccountDynamicScore(idle75, 'gemini')).toBe(75);

    // Record request on fresh100 (simulating it served a prompt right now)
    recordAccountRequest(fresh100);

    // Dynamic score of fresh100 drops due to recent burst penalty (-20) and RPM count (-4): 100 - 24 = 76
    // Both are within P2C_SCORE_DELTA, and idle75 is idle while fresh100 was just used:
    const chosen = selectCandidateP2C([fresh100, idle75], 'gemini');
    expect(chosen).toBe(idle75);
  });

  it('penalizes accounts with low weekly quota (< 15%) to prioritize accounts with weekly > 30%', () => {
    const balancedAcc = makeModel({
      accountEmail: 'balanced@test.com',
      quotas: { geminiFiveHourPct: 60, geminiWeeklyPct: 40 } as any,
    });
    const lowWeeklyAcc = makeModel({
      accountEmail: 'lowweekly@test.com',
      quotas: { geminiFiveHourPct: 60, geminiWeeklyPct: 12 } as any,
    });

    // base score: (60 * 0.7) + (40 * 0.3) = 42 + 12 = 54
    expect(getModelQuotaScore(balancedAcc, 'gemini')).toBe(54);
    expect(getAccountDynamicScore(balancedAcc, 'gemini')).toBe(54);

    // base score: (60 * 0.7) + (12 * 0.3) = 42 + 3.6 = 45.6
    expect(getModelQuotaScore(lowWeeklyAcc, 'gemini')).toBe(45.6);
    // dynamic score gets weekly penalty: 7 + floor((15 - 12) * 1.5) = 7 + 4 = 11 pts penalty
    // 45.6 - 11 = 34.6
    expect(getAccountDynamicScore(lowWeeklyAcc, 'gemini')).toBeLessThan(36);
    expect(getAccountDynamicScore(balancedAcc, 'gemini')).toBeGreaterThan(getAccountDynamicScore(lowWeeklyAcc, 'gemini') + 15);
  });

  it('never includes 0-score accounts in P2C topTier when positive score accounts exist', () => {
    const accPositive = makeModel({
      accountEmail: 'positive@test.com',
      quotas: { geminiFiveHourPct: 40, geminiWeeklyPct: 40 } as any,
    });
    const accZero = makeModel({
      accountEmail: 'zero@test.com',
      quotas: { geminiFiveHourPct: 0, geminiWeeklyPct: 0 } as any,
    });

    // Positive account has score 40 (<= P2C_SCORE_DELTA 45)
    // Zero account has score 0. Even though 40 - 0 <= 45, zero account MUST NOT be chosen!
    expect(getAccountDynamicScore(accPositive, 'gemini')).toBe(40);
    expect(getAccountDynamicScore(accZero, 'gemini')).toBe(0);

    const chosen = selectCandidateP2C([accPositive, accZero], 'gemini');
    expect(chosen).toBe(accPositive);
  });

  it('penalizes very slow accounts (> 7.5s) up to 70 points instead of capping at 25', () => {
    const slowAcc = makeModel({
      accountEmail: 'slow@test.com',
      quotas: { geminiFiveHourPct: 100, geminiWeeklyPct: 100 } as any,
    });
    // Base score is 100. Record 8500ms latency.
    recordAccountLatency(slowAcc, 8500);
    // (8500 - 500) / 100 = 80 points penalty, capped at 70 points!
    // Dynamic score: 100 - 70 = 30 points
    expect(getAccountDynamicScore(slowAcc, 'gemini')).toBe(30);
  });

  it('does not wake up an exhausted account if quota data is stale', () => {
    const exhaustedAcc = makeModel({
      accountEmail: 'exhausted@test.com',
    });
    const key = getAccountQuotaKey(exhaustedAcc);
    setAccountCooldown(exhaustedAcc, 18000_000, 'gemini');
    markAccountQuotaExhausted(key, 'gemini');

    // Simulate stale quota from yesterday (updatedAt = 24 hours ago, with static 100% quota)
    updateLiveAccountQuota(key, {
      geminiFiveHourPct: 100,
      geminiWeeklyPct: 100,
      updatedAt: Date.now() - 24 * 3600 * 1000,
    } as any);

    const result = verifyAndReconcileCooldowns(Date.now(), [exhaustedAcc]);
    // The account MUST NOT wake up based on stale 100% data!
    expect(isAccountInCooldown(exhaustedAcc, 'gemini')).toBe(true);
    expect(result.cleared).toBe(0);
  });
});

