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
    it('automatically clears Gemini and Claude cooldowns when quota recovers >20%', () => {
      const acc = mockGoogleModels[1]; // user2@gmail.com
      const baseKey = 'google:user2@gmail.com';

      // Put Gemini bucket in cooldown
      setAccountCooldown(acc, 60_000, 'gemini');
      expect(isAccountInCooldown(acc, 'gemini')).toBe(true);

      // Low quota doesn't heal
      autoHealAccountOnQuotaRecovery(baseKey, {
        fiveHourPercentage: 10,
        weeklyPercentage: 10,
        geminiFiveHourPct: 10,
        geminiWeeklyPct: 10,
        claudeFiveHourPct: 5,
        claudeWeeklyPct: 5,
        updatedAt: Date.now(),
      });
      expect(isAccountInCooldown(acc, 'gemini')).toBe(true);

      // Quota recovery to 85% heals Gemini cooldown
      autoHealAccountOnQuotaRecovery(baseKey, {
        fiveHourPercentage: 85,
        weeklyPercentage: 85,
        geminiFiveHourPct: 85,
        geminiWeeklyPct: 85,
        claudeFiveHourPct: 5,
        claudeWeeklyPct: 5,
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
  });
});
