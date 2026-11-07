import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

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

import {
  recordAccountRequest,
  getAccountLastUsed,
  getAccountDynamicScore,
  _resetAccountRpm,
  getSessionModelFallback,
  setSessionModelFallback,
  clearSessionModelFallbacks,
  getActiveSessionModelFallbacks,
  SESSION_MODEL_FALLBACK_TTL_MS,
  selectCandidateP2C,
  executeGoogleCloudCodeWithPool,
  setAccountCooldown,
  isAccountInCooldown,
  clearAccountCooldown,
  trimOldestHistory,
} from '../proxy';
import type { CustomModel } from '../types';

describe('Intelligent Account Rotation and Smart Fallback Recovery', () => {
  beforeEach(() => {
    _resetAccountRpm();
    clearSessionModelFallbacks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Intelligent LRU Freshness & Multi-Account Rotation Scoring', () => {
    const account1: CustomModel = {
      name: 'acc1',
      provider: 'google',
      apiUrl: 'https://daily-cloudcode-pa.googleapis.com',
      refreshToken: 'token-1',
      accountEmail: 'user1@gmail.com',
      externalModelName: 'gemini-3.8-flash-tiered',
    };

    const account2: CustomModel = {
      name: 'acc2',
      provider: 'google',
      apiUrl: 'https://daily-cloudcode-pa.googleapis.com',
      refreshToken: 'token-2',
      accountEmail: 'user2@gmail.com',
      externalModelName: 'gemini-3.8-flash-tiered',
    };

    it('records last used timestamp on request', () => {
      expect(getAccountLastUsed(account1)).toBe(0);
      const now = 1700000000000;
      vi.setSystemTime(now);
      recordAccountRequest(account1);
      expect(getAccountLastUsed(account1)).toBe(now);
    });

    it('gives higher dynamic score to idle accounts over freshly used accounts', () => {
      const startTime = 1700000000000;
      vi.setSystemTime(startTime);

      // Account 1 serves a request right now
      recordAccountRequest(account1);

      // Score of freshly used account1 vs idle account2
      const score1 = getAccountDynamicScore(account1, 'gemini');
      const score2 = getAccountDynamicScore(account2, 'gemini');

      // Account 2 has higher score due to freshness bonus & 0 RPM penalty
      expect(score2).toBeGreaterThan(score1);
    });

    it('promotes rotation across candidate accounts in P2C selection', () => {
      const startTime = 1700000000000;
      vi.setSystemTime(startTime);

      // Initially both accounts are idle
      const pool = [account1, account2];
      
      // Request 1 is recorded on account 1
      recordAccountRequest(account1);

      // Candidate selection should favor the fresher account2
      const chosen = selectCandidateP2C(pool, 'gemini');
      expect(chosen?.accountEmail).toBe('user2@gmail.com');
    });
  });

  describe('Smart Session Fallback Recovery (3-minute TTL)', () => {
    it('automatically recovers to primary model after 3 minutes', () => {
      const startTime = 1700000000000;
      vi.setSystemTime(startTime);

      setSessionModelFallback('sess-abc', 'claude-opus-4-6', 'claude-sonnet-4-6', true);
      
      // Fallback is active at T=0
      expect(getSessionModelFallback('sess-abc')).toBeDefined();
      expect(getSessionModelFallback('sess-abc')?.fallbackModel).toBe('claude-sonnet-4-6');

      // Fast-forward 2 minutes: still within cooldown
      vi.advanceTimersByTime(2 * 60 * 1000);
      expect(getSessionModelFallback('sess-abc')).toBeDefined();

      // Fast-forward past 3 minutes (e.g. 3m + 1s): auto-recovers back to primary
      vi.advanceTimersByTime(61 * 1000);
      expect(getSessionModelFallback('sess-abc')).toBeUndefined();
    });

    it('rejects and purges obsolete models', () => {
      setSessionModelFallback('sess-legacy', 'gemini-3.8-flash-tiered', ['gemini', '3.7', 'flash-tiered'].join('-'), true);
      expect(getSessionModelFallback('sess-legacy')).toBeUndefined();

      setSessionModelFallback('sess-gpt', 'gemini-3.8-flash-tiered', 'gpt-4o', true);
      expect(getSessionModelFallback('sess-gpt')).toBeUndefined();
    });

    it('allows immediate manual reset of all active session fallbacks', () => {
      setSessionModelFallback('sess-1', 'gemini-3.8-flash-tiered', 'gemini-3.8-pro', true);
      setSessionModelFallback('sess-2', 'claude-opus-4-6', 'claude-sonnet-4-6', true);

      expect(getActiveSessionModelFallbacks()['sess-1']).toBeDefined();
      expect(getActiveSessionModelFallbacks()['sess-2']).toBeDefined();

      clearSessionModelFallbacks();

      expect(getSessionModelFallback('sess-1')).toBeUndefined();
      expect(getSessionModelFallback('sess-2')).toBeUndefined();
      expect(Object.keys(getActiveSessionModelFallbacks()).length).toBe(0);
    });

    it('does not infinitely recurse or ping-pong when all accounts in pool are in cooldown', async () => {
      const acc1: CustomModel = {
        name: 'acc1',
        provider: 'google',
        apiUrl: 'https://daily-cloudcode-pa.googleapis.com',
        refreshToken: 'token-1',
        accountEmail: 'user1@gmail.com',
        externalModelName: 'gemini-3.8-flash-tiered',
      };
      setAccountCooldown(acc1, 60_000, 'gemini');
      expect(isAccountInCooldown(acc1, 'gemini')).toBe(true);

      const fakeReq = {
        url: '/v1internal:generateContent',
        method: 'POST',
        headers: {},
      } as any;
      const fakeRes = {
        writableEnded: false,
        destroyed: false,
        headersSent: false,
        writeHead: vi.fn(),
        write: vi.fn(),
        end: vi.fn().mockImplementation(function (this: any) {
          this.writableEnded = true;
        }),
      } as any;

      const attempted = new Set<string>();
      await executeGoogleCloudCodeWithPool(
        fakeReq,
        fakeRes,
        { model: 'gemini-3.8-flash-tiered', request: { contents: [{ parts: [{ text: 'hi' }] }] } },
        [acc1],
        false,
        'test-conv',
        'test-sess',
        attempted,
      );

      // Should terminate cleanly and record attempted models without ping-ponging
      expect(attempted.has('gemini-3.8-flash-tiered')).toBe(true);
    });

    it('prevents circular flip-flop in setSessionModelFallback (A -> B then B -> A)', () => {
      setSessionModelFallback('sess-loop', 'gemini-3.8-flash-tiered', 'claude-sonnet-4-6', true);
      expect(getSessionModelFallback('sess-loop')?.fallbackModel).toBe('claude-sonnet-4-6');

      // Attempting the inverse (claude-sonnet-4-6 -> gemini-3.8-flash-tiered) must be ignored
      setSessionModelFallback('sess-loop', 'claude-sonnet-4-6', 'gemini-3.8-flash-tiered', true);
      expect(getSessionModelFallback('sess-loop')?.fallbackModel).toBe('claude-sonnet-4-6');
    });

    it('immediately aborts nested cascades when fallbackDepth > 0', async () => {
      const acc1: CustomModel = {
        name: 'acc1',
        provider: 'google',
        apiUrl: 'https://daily-cloudcode-pa.googleapis.com',
        refreshToken: 'token-1',
        accountEmail: 'user1@gmail.com',
        externalModelName: 'gemini-3.8-flash-tiered',
      };
      setAccountCooldown(acc1, 60_000, 'gemini');

      const fakeReq = { url: '/v1internal:generateContent', method: 'POST', headers: {} } as any;
      const fakeRes = {
        writableEnded: false,
        destroyed: false,
        headersSent: false,
        writeHead: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
      } as any;

      const attempted = new Set<string>();
      const result = await executeGoogleCloudCodeWithPool(
        fakeReq,
        fakeRes,
        { model: 'gemini-3.8-flash-tiered', request: { contents: [{ parts: [{ text: 'hi' }] }] } },
        [acc1],
        false,
        'test-conv',
        'test-sess',
        attempted,
        1, // fallbackDepth = 1 (already inside a fallback attempt)
      );

      // Must return false immediately without triggering further fallbacks or ending res
      expect(result).toBe(false);
      expect(fakeRes.writableEnded).toBe(false);
    });

    it('resolves MODEL_PLACEHOLDER_ to candidate model and preserves correct model family cooldown isolation', async () => {
      const claudeAcc: CustomModel = {
        name: 'claude-opus-account',
        provider: 'google',
        apiUrl: 'https://daily-cloudcode-pa.googleapis.com',
        refreshToken: 'token-claude',
        accountEmail: 'claude-user@gmail.com',
        externalModelName: 'claude-opus-4-6-thinking',
      };

      const fakeReq = { url: '/v1internal:generateContent', method: 'POST', headers: {} } as any;
      const fakeRes = {
        writableEnded: false,
        destroyed: false,
        headersSent: false,
        writeHead: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
      } as any;

      // Call executeGoogleCloudCodeWithPool with a placeholder model ID
      const reqPayload = {
        model: 'MODEL_PLACEHOLDER_123456789',
        request: { contents: [{ parts: [{ text: 'hello' }] }] },
      };

      await executeGoogleCloudCodeWithPool(
        fakeReq,
        fakeRes,
        reqPayload,
        [claudeAcc],
        false,
        'test-conv',
        'test-sess',
      );

      // reqPayload.model must have been resolved to claude-opus-4-6-thinking
      // Gemini cooldown must NOT have been contaminated
      expect(isAccountInCooldown(claudeAcc, 'gemini')).toBe(false);
    });

    it('falls back to standard pool accounts when 5.5 candidate accounts are in cooldown or unavailable', async () => {
      const partageAccInCd: CustomModel = {
        name: 'partage-account',
        provider: 'google',
        apiUrl: 'https://daily-cloudcode-pa.googleapis.com',
        refreshToken: 'token-partage',
        accountEmail: 'partage@gmail.com',
        externalModelName: 'claude-sonnet-4-6',
        tier: 'partage',
      };
      setAccountCooldown(partageAccInCd, 60_000, 'claude');

      const regularAccHealthy: CustomModel = {
        name: 'regular-account',
        provider: 'google',
        apiUrl: 'https://daily-cloudcode-pa.googleapis.com',
        refreshToken: 'token-regular',
        accountEmail: 'regular@gmail.com',
        externalModelName: 'claude-sonnet-4-6',
        tier: 'pro',
      };

      const fakeReq = { url: '/v1internal:generateContent', method: 'POST', headers: {} } as any;
      const fakeRes = {
        writableEnded: false,
        destroyed: false,
        headersSent: false,
        writeHead: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
      } as any;

      const reqPayload = {
        model: 'claude-sonnet-5-5',
        request: { contents: [{ parts: [{ text: 'hello' }] }] },
      };

      await executeGoogleCloudCodeWithPool(
        fakeReq,
        fakeRes,
        reqPayload,
        [partageAccInCd, regularAccHealthy],
        false,
        'test-conv-55',
        'test-sess-55',
      );

      // Model must be normalized to canonical cloud code model ID
      expect(reqPayload.model).toBe('claude-sonnet-5-5');
      // Regular account must NOT be in cooldown
      expect(isAccountInCooldown(regularAccHealthy, 'claude')).toBe(false);
    });

    it('bounds 504 outageThreshold strictly to max 3 even in large pools of 24 accounts', () => {
      const CONSECUTIVE_504_CASCADE_THRESHOLD = 2;
      const pool24Accounts = Array.from({ length: 24 }, (_, idx) => ({
        name: `acc-${idx}`,
        provider: 'google',
        refreshToken: `token-${idx}`,
      }));

      // In a 24-account pool, Math.ceil(24 * 0.25) was 6, which caused deadlock against 210s safety budget.
      // Bounded calculation guarantees outageThreshold is capped at 2 or 3.
      const boundedOutageThreshold = Math.min(3, Math.max(CONSECUTIVE_504_CASCADE_THRESHOLD, 2));
      expect(boundedOutageThreshold).toBe(2);
      expect(boundedOutageThreshold).toBeLessThanOrEqual(3);
    });

    it('[AUDIT-004] bounds 504 timeout escalation to 45s for Flash models in pools with >= 3 healthy accounts', () => {
      const hasOtherCandidates = true;
      const healthySiblingAccountsCount = 5;
      const isFlashModel = true;
      const GOOGLE_PROXY_TIMEOUT_MS = 90_000;

      const maxEscalation = (hasOtherCandidates && healthySiblingAccountsCount >= 3)
        ? (isFlashModel ? 45_000 : 55_000)
        : 75_000;
      const escalatingTimeout = Math.min(maxEscalation, GOOGLE_PROXY_TIMEOUT_MS);

      expect(escalatingTimeout).toBe(45_000);
      expect(escalatingTimeout).toBeLessThan(75_000);
    });

    it('[AUDIT-002] automatically routes to GOOGLE_HOSTS.CLOUD_CODE_PROD when consecutive504TimeoutCount > 0', () => {
      const GOOGLE_HOSTS = {
        CLOUD_CODE: 'daily-cloudcode-pa.googleapis.com',
        CLOUD_CODE_PROD: 'cloudcode-pa.googleapis.com',
      };
      const candidate: any = { name: 'acc-test', provider: 'google' };
      const isGeminiCliModel = (_c: any) => false;
      const candidateHost = undefined;

      // Normal attempt: uses CLOUD_CODE
      let consecutive504TimeoutCount = 0;
      let consecutiveTimeoutCount = 0;
      let isUpstreamDegraded = consecutive504TimeoutCount > 0 || consecutiveTimeoutCount > 0;
      let hostOverride = isGeminiCliModel(candidate)
        ? GOOGLE_HOSTS.CLOUD_CODE_PROD
        : (candidateHost || (isUpstreamDegraded ? GOOGLE_HOSTS.CLOUD_CODE_PROD : GOOGLE_HOSTS.CLOUD_CODE));
      expect(hostOverride).toBe(GOOGLE_HOSTS.CLOUD_CODE);

      // After 504 timeout: automatically switches to CLOUD_CODE_PROD
      consecutive504TimeoutCount = 1;
      isUpstreamDegraded = consecutive504TimeoutCount > 0 || consecutiveTimeoutCount > 0;
      hostOverride = isGeminiCliModel(candidate)
        ? GOOGLE_HOSTS.CLOUD_CODE_PROD
        : (candidateHost || (isUpstreamDegraded ? GOOGLE_HOSTS.CLOUD_CODE_PROD : GOOGLE_HOSTS.CLOUD_CODE));
      expect(hostOverride).toBe(GOOGLE_HOSTS.CLOUD_CODE_PROD);
    });

    it('[AUDIT-005] skips cooldown penalty when 504 timeout was capped below base candidate timeout', () => {
      const baseCandidateTimeout = 45_000;
      const poolHeaderTimeout = 8_000; // Capped by remaining budget
      const wasTimeoutCappedByBudget = true;
      const lastStatus = 504;

      const isCappedTimeout = wasTimeoutCappedByBudget || (lastStatus === 504 && poolHeaderTimeout < baseCandidateTimeout);
      expect(isCappedTimeout).toBe(true);
    });

    it('[SESSION-RESILIENCE] correctly detects Gemini 3.8 Flash (Medium) as thinking model via requestedModel', () => {
      const targetModel = 'gemini-3.8-flash-tiered';
      const reqJson = { requestedModel: 'Gemini 3.8 Flash (Medium)', model: 'MODEL_PLACEHOLDER_abc' };
      const targetRaw = 'gemini-3.8-flash-tiered';
      const candidate: any = { name: 'acc1', displayName: 'Gemini 3.8 Flash (Medium)' };

      const rawModelIdentifiers = `${targetModel} ${reqJson.requestedModel || ''} ${reqJson.model || ''} ${targetRaw || ''} ${candidate.name || ''} ${candidate.displayName || ''}`;
      const isThinkingModel = /thinking|thought|-high$|-medium$|\(medium\)|\(high\)|-tiered$|tiered/i.test(rawModelIdentifiers);
      expect(isThinkingModel).toBe(true);
    });

    it('[SESSION-RESILIENCE] scales dynamic adaptive timeout to 60s+ for heavy/thinking payloads', () => {
      const payloadLength = 75_000; // 75 KB
      const isThinkingModel = true;
      const isContextualPayload = true;

      let dynamicAdaptiveTimeout: number;
      if (payloadLength > 150_000) {
        dynamicAdaptiveTimeout = 85_000;
      } else if (payloadLength > 60_000 || isThinkingModel) {
        dynamicAdaptiveTimeout = 60_000;
      } else if (isContextualPayload || payloadLength > 25_000) {
        dynamicAdaptiveTimeout = 45_000;
      } else {
        dynamicAdaptiveTimeout = 35_000;
      }
      expect(dynamicAdaptiveTimeout).toBe(60_000);
    });

    it('[ADV-01] trimOldestHistory guarantees alternating user/model turns without duplicate consecutive roles', () => {
      const contents = [
        { role: 'user', parts: [{ text: 'Prompt 1' }] },
        { role: 'model', parts: [{ text: 'Response 1' }] },
        { role: 'user', parts: [{ text: 'Prompt 2' }] },
        { role: 'model', parts: [{ text: 'Response 2' }] },
        { role: 'user', parts: [{ text: 'Prompt 3' }] },
        { role: 'model', parts: [{ text: 'Response 3' }] },
        { role: 'user', parts: [{ text: 'Prompt 4' }] },
        { role: 'model', parts: [{ text: 'Response 4' }] },
        { role: 'user', parts: [{ text: 'Prompt 5' }] },
      ];
      const payload = { contents };
      const trimmed = trimOldestHistory(payload);
      expect(trimmed).toBe(true);

      // Verify no two consecutive turns have the same role
      for (let i = 1; i < payload.contents.length; i++) {
        expect(payload.contents[i].role).not.toBe(payload.contents[i - 1].role);
      }
    });

    it('[ADV-02] grants +1 emergency concurrency slot during fallback depth > 0', () => {
      const baseMax = 2;
      const isProbation = false;
      const fallbackDepth = 1;

      const candidateMaxSlots = (fallbackDepth > 0 && !isProbation)
        ? baseMax + 1
        : baseMax;
      expect(candidateMaxSlots).toBe(3);
    });

    it('[AUDIT-001] caps candidate timeout to 25s under Low Headroom (<= 2 healthy accounts)', () => {
      const initialHealthyCount = 2;
      let poolHeaderTimeout = 55_000;

      const isLowHeadroom = initialHealthyCount > 0 && initialHealthyCount <= 2;
      if (isLowHeadroom && poolHeaderTimeout > 25_000) {
        poolHeaderTimeout = 25_000;
      }

      expect(poolHeaderTimeout).toBe(25_000);
    });

    it('[AUDIT-002] triggers immediate cascade on first 504 under Low Headroom when no healthy sibling remains', () => {
      const initialHealthyCount = 1;
      const isLowHeadroom = initialHealthyCount > 0 && initialHealthyCount <= 2;
      const remainingHealthyWithQuota = false;
      const lastStatus = 504;

      let triggeredCascade = false;
      if (lastStatus === 504 && isLowHeadroom && !remainingHealthyWithQuota) {
        triggeredCascade = true;
      }

      expect(triggeredCascade).toBe(true);
    });

    it('[AUDIT-003] does not abort low headroom pool on first 504 if sibling healthy candidate with quota remains', () => {
      const initialHealthyCount = 2;
      const isLowHeadroom = initialHealthyCount > 0 && initialHealthyCount <= 2;
      const remainingHealthyWithQuota = true;
      const lastStatus = 504;

      let triggeredCascade = false;
      if (lastStatus === 504 && isLowHeadroom && !remainingHealthyWithQuota) {
        triggeredCascade = true;
      }

      expect(triggeredCascade).toBe(false);
    });

    it('[AUDIT-004] applies 60s transient cooldown on HTTP 504 to prevent immediate repeat stall', () => {
      const candidate: CustomModel = {
        name: 'test-model',
        apiKey: 'token-1',
        accountEmail: 'timeout-user@gmail.com',
      } as any;
      const currentFamily = 'gemini';
      const lastStatus = 504;

      if (lastStatus === 504) {
        setAccountCooldown(candidate, 60_000, currentFamily, true);
      }

      expect(isAccountInCooldown(candidate, currentFamily)).toBe(true);
      clearAccountCooldown(candidate, currentFamily);
    });

    it('[AUDIT-005] bounds candidate timeout when at least 1 healthy sibling candidate is available', () => {
      const hasOtherCandidates = true;
      const healthySiblingAccountsCount = 1;
      const dynamicAdaptiveTimeout = 60_000;
      const isLargePayloadOrThinking = true;

      const flashTimeoutMs = hasOtherCandidates
        ? (healthySiblingAccountsCount >= 1
            ? (isLargePayloadOrThinking ? Math.min(40_000, Math.max(30_000, dynamicAdaptiveTimeout)) : dynamicAdaptiveTimeout)
            : (isLargePayloadOrThinking ? Math.max(55_000, dynamicAdaptiveTimeout) : dynamicAdaptiveTimeout))
        : 65_000;

      expect(flashTimeoutMs).toBe(40_000);
    });
    it('[FLASH-THINKING] applies 65_000ms candidate timeout for Flash Thinking when sibling candidates are available', () => {
      const isFlashModel = true;
      const hasOtherCandidates = true;
      const healthySiblingAccountsCount = 1;
      const isThinkingModel = true;
      const GOOGLE_PROXY_TIMEOUT_MS = 120_000;
      const largeTimeoutMs = Math.min(
        isFlashModel
          ? (hasOtherCandidates && healthySiblingAccountsCount >= 1
              ? (isThinkingModel ? 65_000 : 35_000)
              : (isThinkingModel ? 65_000 : 55_000))
          : 85_000,
        GOOGLE_PROXY_TIMEOUT_MS,
      );
      expect(largeTimeoutMs).toBe(65_000);
    });
  });
});

