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
  });
});
