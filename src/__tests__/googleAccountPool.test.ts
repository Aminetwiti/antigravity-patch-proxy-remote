import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => '/mock/home' },
}));

vi.mock('electron-log/main', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('electron-log', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  getGoogleAccountPool,
  getAccountQuotaKey,
  getModelQuotaScore,
  selectBestModelByQuota,
  bindSessionToModel,
  extractSessionId,
  clearSessionAffinities,
  isAccountInCooldown,
  setAccountCooldown,
  clearAccountCooldown,
  getAccountCooldownRemaining,
  getSoonestAccountCooldownRemaining,
  isAccountInProbation,
  endAccountProbation,
  _resetAccountProbation,
  getAccountInFlight,
  incrementAccountInFlight,
  decrementAccountInFlight,
  _resetAccountInFlight,
  recordAccountRequest,
  getAccountRpmCount,
  _resetAccountRpm,
  getAccountDynamicScore,
  classifyGoogleCloudCode429,
  selectCandidateP2C,
  MAX_CONCURRENT_PER_ACCOUNT,
  waitForAccountSlot,
  notifySlotAvailable,
  _clearSlotWaitersForTests,
  autoHealAccountOnQuotaRecovery,
  recordAccountLatency,
  getAccountAvgLatency,
  _resetAccountLatencies,
  isPoolUnderQuotaStress,
  resolveGoogleProjectId,
  markAccountUnlicensed,
  isAccountUnlicensed,
  _resetUnlicensedAccounts,
  getActiveAccountCooldowns,
  restoreActiveAccountCooldowns,
  verifyAndReconcileCooldowns,
  _resetAllAccountCooldowns,
} from '../proxy';
import { recordFailure, recordSuccess, getOpenBreaker } from '../proxy/circuitBreaker';
import {
  isTokenCached,
  prewarmGoogleAccounts,
  _clearTokenCacheForTests,
  updateLiveAccountQuota,
  _clearLiveQuotasForTests,
  markTokenRevoked,
  clearRevokedTokens,
  isTokenRevoked,
} from '../services/googleAuth';
import type { CustomModel } from '../proxy/types';

describe('Google Multi-Account Pool & Failover', () => {
  beforeEach(() => {
    clearSessionAffinities();
    _resetAccountInFlight();
    _resetAccountRpm();
    _clearTokenCacheForTests();
    _resetAccountProbation();
    _clearLiveQuotasForTests();
    _clearSlotWaitersForTests();
    clearRevokedTokens();
  });

  const mockGoogleModels: CustomModel[] = [
    {
      name: 'models/google-acc1-gemini-3-1-pro',
      displayName: 'Gemini 3.1 Pro (Account 1)',
      provider: 'google',
      apiKey: 'ya29.acc1_token',
      apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
      externalModelName: 'gemini-3.1-pro-high',
      accountEmail: 'user1@gmail.com',
      refreshToken: '1//refresh1',
      projectId: 'project-1',
      quotas: { fiveHourPercentage: 30, weeklyPercentage: 80 },
    },
    {
      name: 'models/google-acc2-gemini-3-1-pro',
      displayName: 'Gemini 3.1 Pro (Account 2)',
      provider: 'google',
      apiKey: 'ya29.acc2_token',
      apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
      externalModelName: 'gemini-3.1-pro-high',
      accountEmail: 'user2@gmail.com',
      refreshToken: '1//refresh2',
      projectId: 'project-2',
      quotas: { fiveHourPercentage: 95, weeklyPercentage: 99 },
    },
    {
      name: 'models/google-acc3-gemini-3-1-pro',
      displayName: 'Gemini 3.1 Pro (Account 3)',
      provider: 'google',
      apiKey: 'ya29.acc3_token',
      apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
      externalModelName: 'gemini-3.1-pro-high',
      accountEmail: 'user3@gmail.com',
      refreshToken: '1//refresh3',
      projectId: 'project-3',
      quotas: { fiveHourPercentage: 100, weeklyPercentage: 100 },
    },
    {
      name: 'models/google-acc1-claude-sonnet',
      displayName: 'Claude Sonnet 4.6 (Account 1)',
      provider: 'google',
      apiKey: 'ya29.acc1_token',
      apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
      externalModelName: 'claude-sonnet-4-6',
      accountEmail: 'user1@gmail.com',
      refreshToken: '1//refresh1',
      projectId: 'project-1',
      quotas: { claudeFiveHourPct: 40, claudeWeeklyPct: 90 },
    },
    {
      name: 'models/openai-gpt4o',
      displayName: 'GPT-4o',
      provider: 'openai',
      apiKey: 'sk-proj-test',
      apiUrl: 'https://api.openai.com/v1',
      externalModelName: 'gpt-4o',
    },
  ];

  it('generates distinct quota keys for each Google account', () => {
    const key1 = getAccountQuotaKey(mockGoogleModels[0]);
    const key2 = getAccountQuotaKey(mockGoogleModels[1]);
    const key3 = getAccountQuotaKey(mockGoogleModels[2]);

    expect(key1).toBe('google:user1@gmail.com');
    expect(key2).toBe('google:user2@gmail.com');
    expect(key3).toBe('google:user3@gmail.com');
    expect(key1).not.toBe(key2);
  });

  it('pools all distinct Google accounts offering the target model', () => {
    const targetModel = mockGoogleModels[0]; // user1's gemini-3.1-pro-high
    const pool = getGoogleAccountPool(targetModel, mockGoogleModels);

    expect(pool.length).toBe(3);
    const emails = pool.map((m) => m.accountEmail);
    expect(emails).toContain('user1@gmail.com');
    expect(emails).toContain('user2@gmail.com');
    expect(emails).toContain('user3@gmail.com');
  });

  it('deduplicates accounts if an account has multiple model aliases in allModels', () => {
    const duplicateList = [
      mockGoogleModels[0], // user1
      mockGoogleModels[0], // user1 duplicate
      mockGoogleModels[1], // user2
    ];
    const pool = getGoogleAccountPool(mockGoogleModels[0], duplicateList);
    expect(pool.length).toBe(2);
  });

  it('excludes virtual auto-pool placeholders from candidate pool', () => {
    const listWithVirtual: CustomModel[] = [
      mockGoogleModels[0], // user1
      mockGoogleModels[1], // user2
      {
        name: 'models/google:gemini-3.1-pro-high:auto-pool',
        displayName: 'Gemini 3.1 Pro (High)',
        provider: 'google',
        apiKey: 'auto',
        externalModelName: 'gemini-3.1-pro-high',
        apiUrl: 'https://daily-cloudcode-pa.googleapis.com',
      },
    ];
    const pool = getGoogleAccountPool(listWithVirtual[2], listWithVirtual);
    expect(pool.length).toBe(2);
    expect(pool.map((m) => m.accountEmail)).toEqual(['user1@gmail.com', 'user2@gmail.com']);
  });

  it('coalesces missing accountEmail to known email via refreshToken in getAccountQuotaKey', () => {
    const modelWithEmail: CustomModel = {
      name: 'models/model-1',
      displayName: 'Model 1',
      provider: 'google',
      accountEmail: 'test-user-a@example.com',
      refreshToken: 'token_wSqMnk',
    };
    const modelWithoutEmail: CustomModel = {
      name: 'models/model-2',
      displayName: 'Model 2',
      provider: 'google',
      refreshToken: 'token_wSqMnk',
    };

    expect(getAccountQuotaKey(modelWithEmail)).toBe('google:test-user-a@example.com');
    expect(getAccountQuotaKey(modelWithoutEmail)).toBe('google:test-user-a@example.com');
  });

  it('prioritizes accounts with highest remaining quota', () => {
    const pool = getGoogleAccountPool(mockGoogleModels[0], mockGoogleModels);
    const sorted = [...pool].sort((a, b) => getModelQuotaScore(b) - getModelQuotaScore(a));

    // Account 3 has 100%, Account 2 has 95%, Account 1 has 30%
    expect(sorted[0].accountEmail).toBe('user3@gmail.com');
    expect(sorted[1].accountEmail).toBe('user2@gmail.com');
    expect(sorted[2].accountEmail).toBe('user1@gmail.com');
  });

  it('deprioritizes accounts with open circuit breaker upon failure', () => {
    const pool = getGoogleAccountPool(mockGoogleModels[0], mockGoogleModels);

    // Simulate Account 3 failing with 429 quota exhaustion
    recordFailure(pool.find((m) => m.accountEmail === 'user3@gmail.com')!, 'rate_limit');

    const sorted = [...pool].sort((a, b) => {
      const breakerA = getOpenBreaker(a) ? 1 : 0;
      const breakerB = getOpenBreaker(b) ? 1 : 0;
      if (breakerA !== breakerB) return breakerA - breakerB;
      return getModelQuotaScore(b) - getModelQuotaScore(a);
    });

    // Healthy Account 2 should now be picked first instead of broken Account 3
    expect(sorted[0].accountEmail).toBe('user2@gmail.com');
    // Broken Account 3 should be moved to the end
    expect(sorted[sorted.length - 1].accountEmail).toBe('user3@gmail.com');

    // Clean up
    recordSuccess(pool.find((m) => m.accountEmail === 'user3@gmail.com')!);
  });

  it('preserves sticky session affinity when bound account is healthy', () => {
    const sessionId = 'test-conv-session-1';
    const acc2 = mockGoogleModels[1]; // user2

    bindSessionToModel(sessionId, acc2);

    const pool = getGoogleAccountPool(mockGoogleModels[0], mockGoogleModels);
    const sorted = [...pool].sort((a, b) => getModelQuotaScore(b) - getModelQuotaScore(a));

    // Initially without session, acc3 is first (100% vs 95%)
    expect(sorted[0].accountEmail).toBe('user3@gmail.com');

    // With session bound to acc2, acc2 should be promoted to front
    const bound = sorted.find((m) => getAccountQuotaKey(m) === getAccountQuotaKey(acc2));
    if (bound) {
      const idx = sorted.indexOf(bound);
      if (idx > 0) {
        sorted.splice(idx, 1);
        sorted.unshift(bound);
      }
    }

    expect(sorted[0].accountEmail).toBe('user2@gmail.com');
  });

  it('manages 429 cooldowns and deprioritizes accounts in cooldown', () => {
    const acc1 = mockGoogleModels[0]; // user1
    const acc2 = mockGoogleModels[1]; // user2

    expect(isAccountInCooldown(acc1)).toBe(false);
    setAccountCooldown(acc1, 10 * 60_000);
    expect(isAccountInCooldown(acc1)).toBe(true);
    expect(isAccountInCooldown(acc2)).toBe(false);

    clearAccountCooldown(acc1);
    expect(isAccountInCooldown(acc1)).toBe(false);
  });

  it('isolates 429 cooldowns per model family', () => {
    const acc1 = mockGoogleModels[0];

    expect(isAccountInCooldown(acc1, 'claude')).toBe(false);
    expect(isAccountInCooldown(acc1, 'gemini')).toBe(false);

    setAccountCooldown(acc1, 10 * 60_000, 'claude');
    expect(isAccountInCooldown(acc1, 'claude')).toBe(true);
    expect(isAccountInCooldown(acc1, 'gemini')).toBe(false);

    clearAccountCooldown(acc1, 'claude');
    expect(isAccountInCooldown(acc1, 'claude')).toBe(false);
  });

  describe('Intelligent 429 Classification (OmniRoute Parity)', () => {
    it('classifies soft micro-bursts and applies short backoff', () => {
      const d1 = classifyGoogleCloudCode429('Quota reset in 0s');
      expect(d1.category).toBe('soft_rate_limit');
      expect(d1.cooldownMs).toBe(3000);

      const d2 = classifyGoogleCloudCode429('Server busy, please try again', '2');
      expect(d2.category).toBe('soft_rate_limit');
      expect(d2.cooldownMs).toBe(2000);
    });

    it('classifies RPM rate limits and applies 60s cooldown', () => {
      const d = classifyGoogleCloudCode429('Requests per minute quota exceeded');
      expect(d.category).toBe('rate_limited');
      expect(d.cooldownMs).toBe(60_000);
    });

    it('classifies quota exhaustion and applies 5h cooldown', () => {
      const d1 = classifyGoogleCloudCode429('RESOURCE_EXHAUSTED: Individual quota reached');
      expect(d1.category).toBe('quota_exhausted');
      expect(d1.cooldownMs).toBe(5 * 60 * 60 * 1000);

      const d2 = classifyGoogleCloudCode429('User has insufficient credits balance for google_one_ai');
      expect(d2.category).toBe('quota_exhausted');
      expect(d2.cooldownMs).toBe(5 * 60 * 60 * 1000);
    });

    it('parses "Resets in Xh Ym Zs" from 429 body and uses the exact reset duration (floor 5h)', () => {
      // Production: "Individual quota reached. Resets in 42h52m9s" → 42h52m9s = 154329s
      const d42h = classifyGoogleCloudCode429(
        'Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 42h52m9s',
      );
      expect(d42h.category).toBe('quota_exhausted');
      const expected42h = (42 * 3600 + 52 * 60 + 9) * 1000;
      expect(d42h.cooldownMs).toBe(expected42h); // ~154.3M ms, well above 5h floor

      // Production: "Individual quota reached. Resets in 4h7m17s" → 4h7m17s = 14837s → floor to 5h
      const d4h = classifyGoogleCloudCode429(
        'Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 4h7m17s',
      );
      expect(d4h.category).toBe('quota_exhausted');
      expect(d4h.cooldownMs).toBe(5 * 60 * 60 * 1000); // floor: 4h7m < 5h → uses 5h

      // Short form: "Resets in 52m" → floor to 5h
      const d52m = classifyGoogleCloudCode429('quota reached Resets in 52m');
      expect(d52m.category).toBe('quota_exhausted');
      expect(d52m.cooldownMs).toBe(5 * 60 * 60 * 1000);
    });

    it('respects Retry-After header duration when larger', () => {
      const d = classifyGoogleCloudCode429('Rate limit exceeded', '45');
      expect(d.category).toBe('rate_limited');
      expect(d.cooldownMs).toBe(45000);
    });
  });

  describe('In-Flight Concurrency & Dynamic Scoring', () => {
    it('tracks active requests and decrements correctly', () => {
      const acc = mockGoogleModels[0];
      expect(getAccountInFlight(acc)).toBe(0);

      incrementAccountInFlight(acc);
      expect(getAccountInFlight(acc)).toBe(1);

      incrementAccountInFlight(acc);
      expect(getAccountInFlight(acc)).toBe(2);

      decrementAccountInFlight(acc);
      expect(getAccountInFlight(acc)).toBe(1);

      decrementAccountInFlight(acc);
      expect(getAccountInFlight(acc)).toBe(0);
    });

    it('penalizes dynamic score under concurrent load', () => {
      const acc2 = mockGoogleModels[1]; // user2: 95% 5h, 99% weekly -> score ~96.2
      const baseScore = getAccountDynamicScore(acc2);
      expect(baseScore).toBeGreaterThan(90);

      incrementAccountInFlight(acc2);
      const busyScore = getAccountDynamicScore(acc2);
      expect(busyScore).toBe(baseScore - 20);

      // Saturated account at max concurrent requests (>= MAX_CONCURRENT_PER_ACCOUNT, default 2)
      incrementAccountInFlight(acc2);
      expect(getAccountInFlight(acc2)).toBe(MAX_CONCURRENT_PER_ACCOUNT);
      expect(getAccountDynamicScore(acc2)).toBe(0);

      decrementAccountInFlight(acc2);
      expect(getAccountDynamicScore(acc2)).toBe(busyScore);

      decrementAccountInFlight(acc2);
      expect(getAccountDynamicScore(acc2)).toBe(baseScore);
    });

    it('returns score 0 when in cooldown or circuit breaker open', () => {
      const acc = mockGoogleModels[0];
      expect(getAccountDynamicScore(acc)).toBeGreaterThan(0);

      setAccountCooldown(acc, 60_000);
      expect(getAccountDynamicScore(acc)).toBe(0);
      clearAccountCooldown(acc);

      recordFailure(acc, 'rate_limit');
      expect(getAccountDynamicScore(acc)).toBe(0);
      recordSuccess(acc);
      expect(getAccountDynamicScore(acc)).toBeGreaterThan(0);
    });
  });

  describe('Concurrency Slots & Micro-Queue Buffer', () => {
    it('returns true immediately when at least one account has an open slot', async () => {
      const accounts = [mockGoogleModels[0], mockGoogleModels[1]];
      const hasSlot = await waitForAccountSlot(accounts, 'gemini', 500);
      expect(hasSlot).toBe(true);
    });

    it('waits and resolves to true when a slot is released via decrementAccountInFlight', async () => {
      const acc = mockGoogleModels[2];
      // Saturate account
      incrementAccountInFlight(acc);
      incrementAccountInFlight(acc);
      expect(getAccountInFlight(acc)).toBe(2);

      let resolved = false;
      const waitPromise = waitForAccountSlot([acc], 'gemini', 1000).then((res) => {
        resolved = res;
      });

      expect(resolved).toBe(false);

      // Releasing one in-flight request should unblock the waiter
      decrementAccountInFlight(acc);
      await waitPromise;
      expect(resolved).toBe(true);
      expect(getAccountInFlight(acc)).toBe(1);

      decrementAccountInFlight(acc);
    });

    it('times out and resolves to false if all accounts remain saturated', async () => {
      const acc = mockGoogleModels[0];
      incrementAccountInFlight(acc);
      incrementAccountInFlight(acc);

      const hasSlot = await waitForAccountSlot([acc], 'gemini', 50);
      expect(hasSlot).toBe(false);

      decrementAccountInFlight(acc);
      decrementAccountInFlight(acc);
    });
  });

  describe('Power of Two Choices (P2C) Candidate Selection', () => {
    it('selects between top candidates, avoiding saturated accounts', () => {
      const acc2 = mockGoogleModels[1]; // ~96.2 score
      const acc3 = mockGoogleModels[2]; // 100 score

      // When neither is busy, P2C picks either acc2 or acc3 (both in top tier)
      const selected = selectCandidateP2C([acc2, acc3]);
      expect([acc2.accountEmail, acc3.accountEmail]).toContain(selected?.accountEmail);

      // When acc3 has 2 in-flight requests, score drops from 100 to 60
      incrementAccountInFlight(acc3);
      incrementAccountInFlight(acc3);

      // Now acc2 (score ~96) is strictly superior and topTier contains only acc2
      const best = selectCandidateP2C([acc2, acc3]);
      expect(best?.accountEmail).toBe('user2@gmail.com');

      decrementAccountInFlight(acc3);
      decrementAccountInFlight(acc3);
    });

    it('skips accounts in cooldown', () => {
      const acc2 = mockGoogleModels[1];
      const acc3 = mockGoogleModels[2];

      setAccountCooldown(acc3, 60_000, 'gemini');
      const selected = selectCandidateP2C([acc2, acc3], 'gemini');
      expect(selected?.accountEmail).toBe('user2@gmail.com');
      clearAccountCooldown(acc3, 'gemini');
    });
  });

  describe('Client-Side RPM Governor', () => {
    it('records requests and tracks 60-second sliding window count', () => {
      const acc = mockGoogleModels[0];
      expect(getAccountRpmCount(acc)).toBe(0);

      recordAccountRequest(acc);
      recordAccountRequest(acc);
      recordAccountRequest(acc);
      expect(getAccountRpmCount(acc)).toBe(3);

      _resetAccountRpm();
      expect(getAccountRpmCount(acc)).toBe(0);
    });

    it('penalizes dynamic score based on recent RPM', () => {
      const acc = mockGoogleModels[2]; // base score: 100
      const initialScore = getAccountDynamicScore(acc);
      expect(initialScore).toBe(100);

      // 5 requests in last 60s => 5 * 2 = 10 points penalty
      for (let i = 0; i < 5; i++) {
        recordAccountRequest(acc);
      }
      expect(getAccountRpmCount(acc)).toBe(5);
      expect(getAccountDynamicScore(acc)).toBe(90);

      // In-flight (20 pts) + RPM (10 pts) = 30 pts total penalty
      incrementAccountInFlight(acc);
      expect(getAccountDynamicScore(acc)).toBe(70);
      decrementAccountInFlight(acc);
    });

    it('P2C routes requests away from account under high RPM pressure', () => {
      const acc2 = mockGoogleModels[1]; // base score: 96.2
      const acc3 = mockGoogleModels[2]; // base score: 100

      // Put acc3 under high RPM (e.g. 15 requests in rapid succession => 30 pts penalty => score 70)
      for (let i = 0; i < 15; i++) {
        recordAccountRequest(acc3);
      }
      expect(getAccountDynamicScore(acc3)).toBe(70);
      expect(getAccountDynamicScore(acc2)).toBeCloseTo(96.2, 1);

      // P2C topTier will only contain acc2 (gap > 15)
      const selected = selectCandidateP2C([acc2, acc3]);
      expect(selected?.accountEmail).toBe('user2@gmail.com');
    });
  });

  describe('Account Cooldown Inspection', () => {
    it('returns positive remaining ms when active (including jitter), 0 when none', () => {
      const acc = mockGoogleModels[0];
      expect(getAccountCooldownRemaining(acc)).toBe(0);

      setAccountCooldown(acc, 30_000);
      const remaining = getAccountCooldownRemaining(acc);
      expect(remaining).toBeGreaterThan(25_000);
      // With 1-5s anti-stampede jitter, max remaining is ~35s
      expect(remaining).toBeLessThanOrEqual(36_000);

      clearAccountCooldown(acc);
      expect(getAccountCooldownRemaining(acc)).toBe(0);
    });
  });

  describe('Model Family Quota Isolation', () => {
    it('isolates Claude 0% quota from Gemini requests and vice-versa', () => {
      const dualModel: CustomModel = {
        name: 'dual-model',
        provider: 'google',
        refreshToken: 'mock_token',
        accountEmail: 'dual@gmail.com',
        quotas: {
          claudeFiveHourPct: 0,
          claudeWeeklyPct: 10,
          geminiFiveHourPct: 90,
          geminiWeeklyPct: 80,
        },
      };

      // For claude requests: 5h is 0 => score 0
      expect(getModelQuotaScore(dualModel, 'claude')).toBe(0);
      expect(getAccountDynamicScore(dualModel, 'claude')).toBe(0);

      // For gemini requests: 5h is 90%, weekly is 80% => score 87
      const geminiScore = getModelQuotaScore(dualModel, 'gemini');
      expect(geminiScore).toBe(90 * 0.7 + 80 * 0.3); // 87
      expect(getAccountDynamicScore(dualModel, 'gemini')).toBe(87);

      // Inverted scenario: Gemini exhausted, Claude healthy
      const dualModel2: CustomModel = {
        name: 'dual-model-2',
        provider: 'google',
        refreshToken: 'mock_token_2',
        accountEmail: 'dual2@gmail.com',
        quotas: {
          claudeFiveHourPct: 75,
          claudeWeeklyPct: 90,
          geminiFiveHourPct: 0,
          geminiWeeklyPct: 20,
        },
      };
      expect(getModelQuotaScore(dualModel2, 'gemini')).toBe(0);
      expect(getModelQuotaScore(dualModel2, 'claude')).toBe(75 * 0.7 + 90 * 0.3);
    });

    it('returns 0 when weekly quota is 0% and reset time is in the future', () => {
      const futureReset = new Date(Date.now() + 3600_000).toISOString();
      const exhaustedWeekly: CustomModel = {
        name: 'exhausted-weekly',
        provider: 'google',
        refreshToken: 'mock_token',
        accountEmail: 'weekly0@gmail.com',
        quotas: {
          geminiFiveHourPct: 100,
          geminiWeeklyPct: 0,
          geminiWeeklyReset: futureReset,
        },
      };
      expect(getModelQuotaScore(exhaustedWeekly, 'gemini')).toBe(0);
      expect(getAccountDynamicScore(exhaustedWeekly, 'gemini')).toBe(0);
    });

    it('recovers score when 0% quota reset timestamp has passed', () => {
      const pastReset = new Date(Date.now() - 3600_000).toISOString();
      const recoveredWeekly: CustomModel = {
        name: 'recovered-weekly',
        provider: 'google',
        refreshToken: 'mock_token',
        accountEmail: 'recovered@gmail.com',
        quotas: {
          geminiFiveHourPct: 100,
          geminiWeeklyPct: 0,
          geminiWeeklyReset: pastReset,
        },
      };
      expect(getModelQuotaScore(recoveredWeekly, 'gemini')).toBeGreaterThan(0);
    });

    it('returns 0 score when weekly quota is 0% (including for Flash models) to prevent doomed 429 errors', () => {
      const futureReset = new Date(Date.now() + 86400_000).toISOString();
      const flashModel: CustomModel = {
        name: 'flash-candidate',
        provider: 'google',
        externalModelName: 'gemini-3.7-flash-tiered',
        refreshToken: 'mock_token',
        accountEmail: 'flash@gmail.com',
        quotas: {
          geminiFiveHourPct: 98,
          geminiWeeklyPct: 0,
          geminiWeeklyReset: futureReset,
        },
      };
      // Once weekly quota is 0, Google blocks all requests (including Flash) with 429
      expect(getModelQuotaScore(flashModel, 'gemini')).toBe(0);
      expect(getAccountDynamicScore(flashModel, 'gemini')).toBe(0);
    });
  });

  describe('Live Quota Cache Overriding', () => {
    it('prioritizes live quota poller cache over static custom_models.json quotas', () => {
      const model: CustomModel = {
        name: 'gemini-live-test',
        provider: 'google',
        refreshToken: 'mock_live_token',
        accountEmail: 'livetest@gmail.com',
        quotas: {
          geminiFiveHourPct: 100,
          geminiWeeklyPct: 100,
        },
      };

      // Static score: 100
      expect(getModelQuotaScore(model, 'gemini')).toBe(100);

      // Live poller reports 20% remaining
      const key = getAccountQuotaKey(model);
      updateLiveAccountQuota(key, {
        fiveHourPercentage: 20,
        weeklyPercentage: 50,
        geminiFiveHourPct: 20,
        geminiWeeklyPct: 50,
        claudeFiveHourPct: 80,
        claudeWeeklyPct: 80,
        updatedAt: Date.now(),
      });

      // getModelQuotaScore should now immediately reflect live quota: 20*0.7 + 50*0.3 = 29
      expect(getModelQuotaScore(model, 'gemini')).toBe(29);
      // Claude family should reflect live claude quota: 80*0.7 + 80*0.3 = 80
      expect(getModelQuotaScore(model, 'claude')).toBe(80);
    });
  });

  describe('Anti-Stampede Half-Open Probation', () => {
    it('transitions to probation upon cooldown expiry and limits probe concurrency', () => {
      const acc = mockGoogleModels[2]; // user3@gmail.com, 100 base score
      setAccountCooldown(acc, -100); // instantly expired cooldown

      // Checking cooldown should transition to probation
      expect(isAccountInCooldown(acc)).toBe(false);
      expect(isAccountInProbation(acc)).toBe(true);

      // In probation: score is scaled to 60% of base (100 * 0.6 = 60)
      expect(getAccountDynamicScore(acc)).toBe(60);

      // If 1 request is already in-flight, score drops to 0 (no more requests permitted)
      incrementAccountInFlight(acc);
      expect(getAccountDynamicScore(acc)).toBe(0);
      decrementAccountInFlight(acc);

      // Ending probation (e.g. after successful probe request) restores full 100% capacity
      endAccountProbation(acc);
      expect(isAccountInProbation(acc)).toBe(false);
      expect(getAccountDynamicScore(acc)).toBe(100);
    });
  });

  describe('Token Cache & Boot Pre-warming', () => {
    it('correctly reports isTokenCached state', () => {
      expect(isTokenCached(undefined)).toBe(false);
      expect(isTokenCached('')).toBe(false);
      expect(isTokenCached('mock_refresh_token')).toBe(false);
    });

    it('prewarmGoogleAccounts safely handles empty or duplicate accounts', () => {
      expect(() => prewarmGoogleAccounts([])).not.toThrow();
      expect(() =>
        prewarmGoogleAccounts([
          { refreshToken: '', accountEmail: 'test@example.com' },
          { refreshToken: 'token_1', accountEmail: 'user1@example.com' },
          { refreshToken: 'token_1', accountEmail: 'user1_dup@example.com' },
        ])
      ).not.toThrow();
    });
  });

  describe('Quarantined Revoked Tokens in Pool Scoring', () => {
    it('sets dynamic score to 0 when account refresh token is marked revoked', () => {
      const acc = mockGoogleModels[0]; // user1@gmail.com
      expect(getAccountDynamicScore(acc)).toBeGreaterThan(0);

      markTokenRevoked(acc.refreshToken);
      expect(getAccountDynamicScore(acc)).toBe(0);

      clearRevokedTokens();
      expect(getAccountDynamicScore(acc)).toBeGreaterThan(0);
    });
  });

  describe('Auto-Heal on Quota Recovery', () => {
    it('automatically clears Gemini and Claude cooldowns when quota recovers >=5%', () => {
      const acc = mockGoogleModels[1]; // user2@gmail.com
      const baseKey = 'google:user2@gmail.com';

      // Put Gemini bucket in cooldown
      setAccountCooldown(acc, 60_000, 'gemini');
      expect(isAccountInCooldown(acc, 'gemini')).toBe(true);

      // Truly exhausted (0%) doesn't heal
      autoHealAccountOnQuotaRecovery(baseKey, {
        fiveHourPercentage: 0,
        weeklyPercentage: 0,
        geminiFiveHourPct: 0,
        geminiWeeklyPct: 0,
        claudeFiveHourPct: 0,
        claudeWeeklyPct: 0,
        updatedAt: Date.now(),
      });
      expect(isAccountInCooldown(acc, 'gemini')).toBe(true);

      // Partial quota (10%) heals — enough to be useful
      autoHealAccountOnQuotaRecovery(baseKey, {
        fiveHourPercentage: 10,
        weeklyPercentage: 10,
        geminiFiveHourPct: 10,
        geminiWeeklyPct: 10,
        claudeFiveHourPct: 0,
        claudeWeeklyPct: 0,
        updatedAt: Date.now(),
      });
      expect(isAccountInCooldown(acc, 'gemini')).toBe(false);

      // Put Claude bucket in cooldown
      setAccountCooldown(acc, 60_000, 'claude');
      expect(isAccountInCooldown(acc, 'claude')).toBe(true);

      // Claude quota recovery to 90% heals Claude cooldown
      autoHealAccountOnQuotaRecovery(baseKey, {
        fiveHourPercentage: 85,
        weeklyPercentage: 85,
        geminiFiveHourPct: 85,
        geminiWeeklyPct: 85,
        claudeFiveHourPct: 90,
        claudeWeeklyPct: 90,
        updatedAt: Date.now(),
      });
      expect(isAccountInCooldown(acc, 'claude')).toBe(false);
    });


    it('awards priority bonus to isPro, isPaid, and custom priority accounts in dynamic score', () => {
      const freeAccount: CustomModel = {
        name: 'free-acc',
        displayName: 'Free Acc',
        description: 'Free account',
        provider: 'google',
        apiKey: 'key1',
        apiUrl: 'https://cloudcode.googleapis.com',
        externalModelName: 'gemini-2.5-pro',
        accountEmail: 'free@gmail.com',
        refreshToken: 'refresh-token-free',
        quotas: { geminiFiveHourPct: 60, geminiWeeklyPct: 60 },
      };

      const proAccount: CustomModel = {
        name: 'pro-acc',
        displayName: 'Pro Acc',
        description: 'Pro account',
        provider: 'google',
        apiKey: 'key2',
        apiUrl: 'https://cloudcode.googleapis.com',
        externalModelName: 'gemini-2.5-pro',
        accountEmail: 'pro@gmail.com',
        refreshToken: 'refresh-token-pro',
        isPro: true,
        quotas: { geminiFiveHourPct: 60, geminiWeeklyPct: 60 },
      };

      const customPriorityAccount: CustomModel = {
        name: 'vip-acc',
        displayName: 'VIP Acc',
        description: 'VIP account',
        provider: 'google',
        apiKey: 'key3',
        apiUrl: 'https://cloudcode.googleapis.com',
        externalModelName: 'gemini-2.5-pro',
        accountEmail: 'vip@gmail.com',
        refreshToken: 'refresh-token-vip',
        priority: 25,
        quotas: { geminiFiveHourPct: 60, geminiWeeklyPct: 60 },
      };

      const freeScore = getAccountDynamicScore(freeAccount, 'gemini');
      const proScore = getAccountDynamicScore(proAccount, 'gemini');
      const vipScore = getAccountDynamicScore(customPriorityAccount, 'gemini');

      expect(freeScore).toBe(60);
      expect(proScore).toBe(75); // 60 + 15 (Pro bonus)
      expect(vipScore).toBe(85); // 60 + 25 (Custom priority)
    });

    it('tracks EWMA latency and applies latency penalty when latency exceeds 500ms', () => {
      _resetAccountLatencies();
      const testAcc: CustomModel = {
        name: 'acc-latency',
        provider: 'google',
        externalModelName: 'gemini-2.5-pro',
        accountEmail: 'latency@gmail.com',
        refreshToken: 'refresh-token-latency',
        quotas: { geminiFiveHourPct: 80, geminiWeeklyPct: 80 },
      };

      expect(getAccountAvgLatency(testAcc)).toBe(0);

      // Record first latency sample: 1000ms
      recordAccountLatency(testAcc, 1000);
      expect(getAccountAvgLatency(testAcc)).toBe(1000);

      // Score with 1000ms latency: baseline 80 - penalty ((1000 - 500) / 100 = 5) = 75
      const penalizedScore = getAccountDynamicScore(testAcc, 'gemini');
      expect(penalizedScore).toBe(75);

      // Record second latency sample: 500ms -> EWMA = 0.2*500 + 0.8*1000 = 900ms
      recordAccountLatency(testAcc, 500);
      expect(getAccountAvgLatency(testAcc)).toBe(900);
    });

    it('detects pool quota stress correctly (<15% average)', () => {
      const stressPool: CustomModel[] = [
        {
          name: 'low-1',
          provider: 'google',
          externalModelName: 'gemini-2.5-pro',
          accountEmail: 'low1@gmail.com',
          refreshToken: 'tok1',
          quotas: { geminiFiveHourPct: 10, geminiWeeklyPct: 10 },
        },
        {
          name: 'low-2',
          provider: 'google',
          externalModelName: 'gemini-2.5-pro',
          accountEmail: 'low2@gmail.com',
          refreshToken: 'tok2',
          quotas: { geminiFiveHourPct: 12, geminiWeeklyPct: 12 },
        },
      ];
      expect(isPoolUnderQuotaStress(stressPool, 'gemini')).toBe(true);

      const healthyPool: CustomModel[] = [
        {
          name: 'healthy-1',
          provider: 'google',
          externalModelName: 'gemini-2.5-pro',
          accountEmail: 'h1@gmail.com',
          refreshToken: 'tok1',
          quotas: { geminiFiveHourPct: 70, geminiWeeklyPct: 70 },
        },
      ];
      expect(isPoolUnderQuotaStress(healthyPool, 'gemini')).toBe(false);
    });

    it('resolves and balances across multi-project IDs', () => {
      const multiProjAcc: CustomModel = {
        name: 'multi-proj',
        provider: 'google',
        externalModelName: 'gemini-2.5-pro',
        projectIds: ['proj-alpha', 'proj-beta', 'proj-gamma'],
      };

      const p1 = resolveGoogleProjectId(multiProjAcc);
      const p2 = resolveGoogleProjectId(multiProjAcc);
      const p3 = resolveGoogleProjectId(multiProjAcc);
      const p4 = resolveGoogleProjectId(multiProjAcc);

      expect(p1).toBe('proj-alpha');
      expect(p2).toBe('proj-beta');
      expect(p3).toBe('proj-gamma');
      expect(p4).toBe('proj-alpha'); // Round-robin wraps around
    });

    it('autoHealAccountOnQuotaRecovery lifts cooldown and clears quota exhaustion lock', () => {
      const acc: CustomModel = {
        name: 'test-heal',
        provider: 'google',
        accountEmail: 'heal-me@example.com',
        refreshToken: 'heal_token',
      };
      const key = getAccountQuotaKey(acc);
      setAccountCooldown(acc, 3600_000, 'gemini');
      expect(isAccountInCooldown(acc, 'gemini')).toBe(true);
      expect(isAccountInCooldown(acc, 'claude')).toBe(false);

      // Auto-heal when Gemini quota recovers to 50%
      autoHealAccountOnQuotaRecovery(key, {
        geminiFiveHourPct: 50,
        geminiWeeklyPct: 50,
        claudeFiveHourPct: 0,
        claudeWeeklyPct: 0,
        fiveHourPercentage: 50,
        weeklyPercentage: 50,
        updatedAt: Date.now(),
      });

      expect(isAccountInCooldown(acc, 'gemini')).toBe(false);
    });

    it('autoHealAccountOnQuotaRecovery does NOT lift multi-day cooldown (>5h remaining)', () => {
      const acc: CustomModel = {
        name: 'test-multiday-heal',
        provider: 'google',
        accountEmail: 'multiday@example.com',
        refreshToken: 'multiday_token',
      };
      const key = getAccountQuotaKey(acc);
      // Set a 48h cooldown from Google Cloud Code 429 quota exhaustion
      setAccountCooldown(acc, 48 * 3600_000, 'gemini');
      expect(isAccountInCooldown(acc, 'gemini')).toBe(true);

      // Auto-heal triggered by 5-hour rolling bucket recovering to 100%
      autoHealAccountOnQuotaRecovery(key, {
        geminiFiveHourPct: 100,
        geminiWeeklyPct: 100,
        claudeFiveHourPct: 100,
        claudeWeeklyPct: 100,
        fiveHourPercentage: 100,
        weeklyPercentage: 100,
        updatedAt: Date.now(),
      });

      // Must remain in cooldown because multi-day tier block is still active
      expect(isAccountInCooldown(acc, 'gemini')).toBe(true);
    });

    it('autoHealAccountOnQuotaRecovery preserves multi-day cooldown when weekly quota is depleted', () => {
      const acc: CustomModel = {
        name: 'Gemini 3.8 Flash (Low)',
        externalModelName: 'gemini-3.8-flash-tiered',
        provider: 'google',
        accountEmail: 'flash-depleted@example.com',
        refreshToken: 'flash_token',
      };
      const key = getAccountQuotaKey(acc);
      // 68h cooldown from Google Cloud Code 429 quota exhaustion
      setAccountCooldown(acc, 68 * 3600_000, 'gemini');
      expect(isAccountInCooldown(acc, 'gemini')).toBe(true);

      // Quota poll shows 5h=100% but weekly=0%
      autoHealAccountOnQuotaRecovery(key, {
        geminiFiveHourPct: 100,
        geminiWeeklyPct: 0,
        claudeFiveHourPct: 100,
        claudeWeeklyPct: 0,
        fiveHourPercentage: 100,
        weeklyPercentage: 0,
        updatedAt: Date.now(),
      });

      // Must remain in cooldown to stop zombie loop
      expect(isAccountInCooldown(acc, 'gemini')).toBe(true);
      expect(getAccountDynamicScore(acc, 'gemini')).toBe(0);
    });

    it('autoHealAccountOnQuotaRecovery lifts multi-day cooldown once Google reset timestamp has elapsed', () => {
      const acc: CustomModel = {
        name: 'Gemini 3.8 Flash (Low)',
        externalModelName: 'gemini-3.8-flash-tiered',
        provider: 'google',
        accountEmail: 'reset-passed@example.com',
        refreshToken: 'reset_passed_token',
      };
      const key = getAccountQuotaKey(acc);
      // 48h cooldown
      setAccountCooldown(acc, 48 * 3600_000, 'gemini');
      expect(isAccountInCooldown(acc, 'gemini')).toBe(true);

      // Reset timestamp is in the past, quota is recovered
      autoHealAccountOnQuotaRecovery(key, {
        geminiFiveHourPct: 100,
        geminiWeeklyPct: 100,
        claudeFiveHourPct: 100,
        claudeWeeklyPct: 100,
        fiveHourPercentage: 100,
        weeklyPercentage: 100,
        geminiResetTime: new Date(Date.now() - 5000).toISOString(),
        updatedAt: Date.now(),
      });

      // Account must be woken up because Google reset timestamp has passed
      expect(isAccountInCooldown(acc, 'gemini')).toBe(false);
    });

    it('verifyAndReconcileCooldowns cleans expired cooldowns and wakes up healthy accounts', () => {
      _resetAllAccountCooldowns();
      const accHealthy: CustomModel = {
        name: 'models/google:gemini-3.8-flash:healthy',
        provider: 'google',
        accountEmail: 'wake-healthy@example.com',
        refreshToken: 'healthy_token',
      };
      const accExpired: CustomModel = {
        name: 'models/google:gemini-3.8-flash:expired',
        provider: 'google',
        accountEmail: 'wake-expired@example.com',
        refreshToken: 'expired_token',
      };

      // Set cooldowns
      setAccountCooldown(accHealthy, 10 * 3600_000, 'gemini');
      setAccountCooldown(accExpired, -1000, 'gemini'); // Already expired in past

      // Provide live quota showing accHealthy has 100% quota
      updateLiveAccountQuota('google:wake-healthy@example.com', {
        geminiFiveHourPct: 100,
        geminiWeeklyPct: 100,
        claudeFiveHourPct: 100,
        claudeWeeklyPct: 100,
        fiveHourPercentage: 100,
        weeklyPercentage: 100,
        updatedAt: Date.now(),
      });

      const report = verifyAndReconcileCooldowns();
      expect(report.checked).toBe(2);
      expect(report.cleared).toBe(2);
      expect(report.active).toBe(0);
      expect(isAccountInCooldown(accHealthy, 'gemini')).toBe(false);
      expect(isAccountInCooldown(accExpired, 'gemini')).toBe(false);

      _resetAllAccountCooldowns();
      _clearLiveQuotasForTests();
    });

    it('verifyAndReconcileCooldowns wakes up accounts via customModels fallback and handles geminiFiveHourReset', () => {
      _resetAllAccountCooldowns();
      _clearLiveQuotasForTests();

      const acc: CustomModel = {
        name: 'models/google:gemini-3.8-flash:fallback-test',
        provider: 'google',
        accountEmail: 'fallback-wake@example.com',
        refreshToken: 'fallback_token',
        quotas: {
          geminiFiveHourPct: 100,
          geminiWeeklyPct: 100,
          geminiFiveHourReset: new Date(Date.now() + 7 * 86400_000).toISOString(),
          weeklyPercentage: 100,
          fiveHourPercentage: 100,
        },
      };

      // Set multi-day cooldown
      setAccountCooldown(acc, 7 * 24 * 3600_000, 'gemini');
      expect(isAccountInCooldown(acc, 'gemini')).toBe(true);

      // Call verifyAndReconcileCooldowns passing customModels array without live quotas registered
      const report = verifyAndReconcileCooldowns(Date.now(), [acc]);
      expect(report.cleared).toBe(1);
      expect(isAccountInCooldown(acc, 'gemini')).toBe(false);

      _resetAllAccountCooldowns();
      _clearLiveQuotasForTests();
    });

    it('cooldown expires properly after cooldown duration passes', () => {
      const acc: CustomModel = {
        name: 'test-expire',
        provider: 'google',
        accountEmail: 'expire-me@example.com',
        refreshToken: 'expire_token',
      };
      // Set short cooldown of 10ms
      setAccountCooldown(acc, 10, 'gemini');
      expect(isAccountInCooldown(acc, 'gemini')).toBe(true);

      const realNow = Date.now;
      try {
        Date.now = () => realNow() + 1000;
        expect(isAccountInCooldown(acc, 'gemini')).toBe(false);
      } finally {
        Date.now = realNow;
      }
    });

    it('selectBestModelByQuota prioritizes Google Cloud Code accounts over static AI Studio developer keys when quota is available', () => {
      const ccAcc: CustomModel = {
        name: 'models/google:gemini-3.8-flash-tiered:acc1',
        provider: 'google',
        externalModelName: 'gemini-3.8-flash-tiered',
        accountEmail: 'cc-user@example.com',
        refreshToken: 'refresh_tok_123',
        quotas: { geminiFiveHourPct: 80, geminiWeeklyPct: 80 },
      };

      const aiStudioAcc: CustomModel = {
        name: 'models/google:gemini-3.8-flash:aistudio',
        provider: 'google-gemini',
        externalModelName: 'gemini-3.8-flash',
        apiKey: 'AIzaSyA_sample_key_12345',
      };

      // When both are healthy, Cloud Code must be selected over static AI Studio key
      const selected = selectBestModelByQuota([aiStudioAcc, ccAcc]);
      expect(selected?.accountEmail).toBe('cc-user@example.com');
      expect(selected?.refreshToken).toBe('refresh_tok_123');
    });

    it('selectBestModelByQuota falls back to static AI Studio developer key when Cloud Code accounts are exhausted', () => {
      const ccAccExhausted: CustomModel = {
        name: 'models/google:gemini-3.8-flash-tiered:acc-exhausted',
        provider: 'google',
        externalModelName: 'gemini-3.8-flash-tiered',
        accountEmail: 'exhausted@example.com',
        refreshToken: 'refresh_tok_exhausted',
        quotas: { geminiFiveHourPct: 0, geminiWeeklyPct: 0 },
      };

      const aiStudioAcc: CustomModel = {
        name: 'models/google:gemini-3.8-flash:aistudio',
        provider: 'google-gemini',
        externalModelName: 'gemini-3.8-flash',
        apiKey: 'AIzaSyA_sample_key_12345',
      };

      // Cloud Code has 0 quota -> fallback to static AI Studio key (which has fallback score 25)
      const selected = selectBestModelByQuota([ccAccExhausted, aiStudioAcc]);
      expect(selected?.apiKey).toBe('AIzaSyA_sample_key_12345');
    });

    it('getModelQuotaScore returns 25 for AI Studio keys without quota and 50 for generic models', () => {
      const aiStudioAcc: CustomModel = {
        name: 'ai-studio',
        provider: 'google-gemini',
        apiKey: 'AIzaSyA_test_key',
      };
      const genericAcc: CustomModel = {
        name: 'generic-openai',
        provider: 'openai',
        apiKey: 'sk-test-key',
      };
      expect(getModelQuotaScore(aiStudioAcc)).toBe(25);
      expect(getModelQuotaScore(genericAcc)).toBe(50);
    });

    it('unlicensed accounts (HTTP 403) are quarantined and excluded from pool and auto-heal', () => {
      const unlicensedModel: CustomModel = {
        name: 'models/google:gemini-3.8-flash:unlicensed',
        displayName: 'Gemini 3.8 Flash',
        provider: 'google',
        accountEmail: 'unlicensed@example.com',
        refreshToken: 'refresh_unlicensed',
        externalModelName: 'gemini-3.8-flash-tiered',
        apiUrl: 'https://daily-cloudcode-pa.googleapis.com',
      };
      const healthyModel: CustomModel = {
        name: 'models/google:gemini-3.8-flash:healthy',
        displayName: 'Gemini 3.8 Flash',
        provider: 'google',
        accountEmail: 'healthy@gmail.com',
        refreshToken: 'refresh_healthy',
        externalModelName: 'gemini-3.8-flash-tiered',
        apiUrl: 'https://daily-cloudcode-pa.googleapis.com',
      };

      expect(isAccountUnlicensed(unlicensedModel)).toBe(false);
      markAccountUnlicensed(unlicensedModel);
      expect(isAccountUnlicensed(unlicensedModel)).toBe(true);
      expect(isAccountInCooldown(unlicensedModel)).toBe(true);

      // Excluded from pool
      const pool = getGoogleAccountPool(healthyModel, [unlicensedModel, healthyModel]);
      expect(pool.map((m) => m.accountEmail)).toEqual(['healthy@gmail.com']);

      // Auto-heal must NEVER un-cool an unlicensed account
      const key = getAccountQuotaKey(unlicensedModel);
      autoHealAccountOnQuotaRecovery(key, {
        geminiFiveHourPct: 100,
        geminiWeeklyPct: 100,
        claudeFiveHourPct: 100,
        claudeWeeklyPct: 100,
        fiveHourPercentage: 100,
        weeklyPercentage: 100,
        updatedAt: Date.now(),
      });

      expect(isAccountInCooldown(unlicensedModel)).toBe(true);
      _resetUnlicensedAccounts();
    });

    it('resolveGoogleProjectId resolves gemini-cli-users for Gemini CLI models and strips aicode-consumers', () => {
      const cliWithAicodeConsumers: CustomModel = {
        name: 'models/gemini-cli:gemini-3.8-flash',
        provider: 'gemini-cli',
        projectId: 'aicode-consumers',
      };
      const cliWithCustomProj: CustomModel = {
        name: 'models/gemini-cli:gemini-3.8-flash:custom',
        provider: 'gemini-cli',
        projectId: 'my-personal-gcp-project',
      };
      const standardGoogleModel: CustomModel = {
        name: 'models/google:gemini-3.8-flash',
        provider: 'google',
        projectId: 'aicode-consumers',
      };

      expect(resolveGoogleProjectId(cliWithAicodeConsumers)).toBe('gemini-cli-users');
      expect(resolveGoogleProjectId(cliWithCustomProj)).toBe('my-personal-gcp-project');
      expect(resolveGoogleProjectId(standardGoogleModel)).toBe('aicode-consumers');
    });

    it('isAccountUnlicensed matches accounts across email and different provider prefixes', () => {
      const cliModel: CustomModel = {
        name: 'models/gemini-cli:gemini-3.8-flash',
        provider: 'gemini-cli',
        accountEmail: 'test-cross-prefix@example.com',
      };
      const googleModel: CustomModel = {
        name: 'models/google:gemini-3.8-flash',
        provider: 'google',
        accountEmail: 'test-cross-prefix@example.com',
      };

      expect(isAccountUnlicensed(cliModel)).toBe(false);
      expect(isAccountUnlicensed(googleModel)).toBe(false);

      markAccountUnlicensed(cliModel);

      // Both must be recognized as unlicensed
      expect(isAccountUnlicensed(cliModel)).toBe(true);
      expect(isAccountUnlicensed(googleModel)).toBe(true);

      _resetUnlicensedAccounts();
    });

    it('exports active account cooldowns and restores them across app restarts', () => {
      _resetAllAccountCooldowns();
      const testModel: CustomModel = {
        name: 'models/google:gemini-3.8-flash',
        provider: 'google',
        accountEmail: 'test-cooldown-persist@example.com',
      };

      expect(isAccountInCooldown(testModel, 'gemini')).toBe(false);

      // Set cooldown for 2 hours
      setAccountCooldown(testModel, 2 * 3600 * 1000, 'gemini');
      expect(isAccountInCooldown(testModel, 'gemini')).toBe(true);

      // Export active cooldowns
      const activeCooldowns = getActiveAccountCooldowns();
      const accKey = getAccountQuotaKey(testModel);
      expect(activeCooldowns[`${accKey}:gemini`]).toBeGreaterThan(Date.now());

      // Reset in-memory cooldowns (simulating restart)
      _resetAllAccountCooldowns();
      expect(isAccountInCooldown(testModel, 'gemini')).toBe(false);

      // Restore active cooldowns
      restoreActiveAccountCooldowns(activeCooldowns);
      expect(isAccountInCooldown(testModel, 'gemini')).toBe(true);

      _resetAllAccountCooldowns();
    });

    it('wakes up accounts with stored healthy quotas after reconciliation', () => {
      _resetAllAccountCooldowns();
      _clearLiveQuotasForTests();

      const accStuck: CustomModel = {
        name: 'models/google:gemini-3.8-flash',
        provider: 'google',
        accountEmail: 'stuck-account@example.com',
        quotas: {
          geminiFiveHourPct: 100,
          geminiWeeklyPct: 100,
          claudeFiveHourPct: 100,
          claudeWeeklyPct: 100,
          fiveHourPercentage: 100,
          weeklyPercentage: 100,
        },
      };

      // Set multi-day cooldown
      setAccountCooldown(accStuck, 7 * 24 * 3600_000, 'gemini');
      expect(isAccountInCooldown(accStuck, 'gemini')).toBe(true);

      // Seed quota from model
      const key = getAccountQuotaKey(accStuck);
      updateLiveAccountQuota(key, accStuck.quotas as any);

      // Reconcile
      const report = verifyAndReconcileCooldowns();
      expect(report.cleared).toBeGreaterThanOrEqual(1);
      expect(isAccountInCooldown(accStuck, 'gemini')).toBe(false);

      _resetAllAccountCooldowns();
      _clearLiveQuotasForTests();
    });

    it('verifyAndReconcileCooldowns checks both 5h and weekly quota and formats wake-up reason with both', () => {
      _resetAllAccountCooldowns();
      _clearLiveQuotasForTests();

      const acc: CustomModel = {
        name: 'models/google:gemini-3.8-flash',
        provider: 'google',
        accountEmail: 'both-quotas@example.com',
        quotas: {
          geminiFiveHourPct: 85,
          geminiWeeklyPct: 92,
          claudeFiveHourPct: 80,
          claudeWeeklyPct: 88,
          fiveHourPercentage: 85,
          weeklyPercentage: 92,
        },
      };

      setAccountCooldown(acc, 7 * 24 * 3600_000, 'gemini');
      expect(isAccountInCooldown(acc, 'gemini')).toBe(true);

      const report = verifyAndReconcileCooldowns(Date.now(), [acc]);
      expect(report.cleared).toBe(1);
      expect(report.details[0]).toContain('5h=85%');
      expect(report.details[0]).toContain('week=92%');
      expect(isAccountInCooldown(acc, 'gemini')).toBe(false);

      _resetAllAccountCooldowns();
      _clearLiveQuotasForTests();
    });

    it('getSoonestAccountCooldownRemaining identifies earliest cooldown among rate-limited accounts', () => {
      _resetAllAccountCooldowns();
      _clearLiveQuotasForTests();

      const acc1: CustomModel = {
        name: 'models/google:gemini-3.8-flash:1',
        provider: 'google',
        accountEmail: 'cd1@example.com',
        quotas: { geminiFiveHourPct: 80, geminiWeeklyPct: 80 },
      };
      const acc2: CustomModel = {
        name: 'models/google:gemini-3.8-flash:2',
        provider: 'google',
        accountEmail: 'cd2@example.com',
        quotas: { geminiFiveHourPct: 80, geminiWeeklyPct: 80 },
      };
      const acc3: CustomModel = {
        name: 'models/google:gemini-3.8-flash:3',
        provider: 'google',
        accountEmail: 'cd3@example.com',
        quotas: { geminiFiveHourPct: 80, geminiWeeklyPct: 80 },
      };

      setAccountCooldown(acc1, 50_000, 'gemini');
      setAccountCooldown(acc2, 15_000, 'gemini');
      setAccountCooldown(acc3, 40_000, 'gemini');

      const soonest = getSoonestAccountCooldownRemaining([acc1, acc2, acc3], 'gemini', 65_000);
      expect(soonest).not.toBeNull();
      expect(soonest?.candidate.accountEmail).toBe('cd2@example.com');
      expect(soonest?.remainingMs).toBeGreaterThan(0);
      expect(soonest?.remainingMs).toBeLessThanOrEqual(20_000);

      _resetAllAccountCooldowns();
    });

    it('getSoonestAccountCooldownRemaining returns remainingMs: 0 immediately if an eligible account is not in cooldown', () => {
      _resetAllAccountCooldowns();

      const accInCd: CustomModel = {
        name: 'models/google:gemini-3.8-flash:cd',
        provider: 'google',
        accountEmail: 'in-cd@example.com',
        quotas: { geminiFiveHourPct: 80 },
      };
      const accFree: CustomModel = {
        name: 'models/google:gemini-3.8-flash:free',
        provider: 'google',
        accountEmail: 'free@example.com',
        quotas: { geminiFiveHourPct: 80 },
      };

      setAccountCooldown(accInCd, 30_000, 'gemini');

      const soonest = getSoonestAccountCooldownRemaining([accInCd, accFree], 'gemini', 65_000);
      expect(soonest).not.toBeNull();
      expect(soonest?.candidate.accountEmail).toBe('free@example.com');
      expect(soonest?.remainingMs).toBe(0);

      _resetAllAccountCooldowns();
    });

    it('getSoonestAccountCooldownRemaining returns null if all cooldowns exceed maxWaitMs (e.g. daily quota exhausted)', () => {
      _resetAllAccountCooldowns();

      const accLongCd: CustomModel = {
        name: 'models/google:gemini-3.8-flash:long',
        provider: 'google',
        accountEmail: 'long-cd@example.com',
        quotas: { geminiFiveHourPct: 80 },
      };

      // 5 hours cooldown (daily exhaustion)
      setAccountCooldown(accLongCd, 5 * 3600_000, 'gemini');

      const soonest = getSoonestAccountCooldownRemaining([accLongCd], 'gemini', 65_000);
      expect(soonest).toBeNull();

      _resetAllAccountCooldowns();
    });

    it('getSoonestAccountCooldownRemaining ignores accounts with 0% daily quota', () => {
      _resetAllAccountCooldowns();

      const accZeroQuota: CustomModel = {
        name: 'models/google:gemini-3.8-flash:zero',
        provider: 'google',
        accountEmail: 'zero-quota@example.com',
        quotas: { geminiFiveHourPct: 0, geminiWeeklyPct: 0 },
      };

      setAccountCooldown(accZeroQuota, 10_000, 'gemini');

      const soonest = getSoonestAccountCooldownRemaining([accZeroQuota], 'gemini', 65_000);
      expect(soonest).toBeNull();

      _resetAllAccountCooldowns();
    });
  });
});

