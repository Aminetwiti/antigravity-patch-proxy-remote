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

    it('rejects and purges obsolete models (gemini-3.7, gemini-2.x, gpt)', () => {
      setSessionModelFallback('sess-legacy', 'gemini-3.8-flash-tiered', 'gemini-3.7-flash-tiered', true);
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
        externalModelName: 'gemini-3.7-flash-tiered',
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
        { model: 'gemini-3.7-flash-tiered', request: { contents: [{ parts: [{ text: 'hi' }] }] } },
        [acc1],
        false,
        'test-conv',
        'test-sess',
        attempted,
      );

      // Should terminate cleanly and record attempted models without ping-ponging
      expect(attempted.has('gemini-3.7-flash-tiered')).toBe(true);
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
  });
});

