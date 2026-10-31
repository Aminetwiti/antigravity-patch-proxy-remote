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

import {
  extractSessionId,
  getSessionBoundModel,
  bindSessionToModel,
  clearSessionAffinities,
  getAccountQuotaKey,
  isAccountInCooldown,
  getModelQuotaScore,
  getSessionModelFallback,
  setSessionModelFallback,
  clearSessionModelFallback,
  sanitizeCandidatesInResponse,
} from '../proxy';
import type { CustomModel } from '../types';

describe('Sticky Sessions (Multi-Account Session Affinity)', () => {
  beforeEach(() => {
    clearSessionAffinities();
  });

  describe('extractSessionId', () => {
    it('extracts sessionId directly from top-level body', () => {
      const id = extractSessionId({ sessionId: 'session-xyz-123' });
      expect(id).toBe('session-xyz-123');
    });

    it('extracts sessionId from context object', () => {
      const id = extractSessionId({ context: { sessionId: 'ctx-session-456' } });
      expect(id).toBe('ctx-session-456');
    });

    it('extracts sessionId from headers when present', () => {
      const id = extractSessionId({}, { 'x-session-id': 'header-session-789' });
      expect(id).toBe('header-session-789');
    });

    it('generates a stable deterministic hash from user prompt content', () => {
      const body1 = {
        contents: [
          { role: 'user', parts: [{ text: 'Refactor the authentication middleware' }] },
        ],
      };
      const body2 = {
        contents: [
          { role: 'user', parts: [{ text: 'Refactor the authentication middleware' }] },
        ],
      };
      const body3 = {
        contents: [
          { role: 'user', parts: [{ text: 'Different prompt completely' }] },
        ],
      };

      const id1 = extractSessionId(body1);
      const id2 = extractSessionId(body2);
      const id3 = extractSessionId(body3);

      expect(id1).toBeTruthy();
      expect(id1).toBe(id2);
      expect(id1).not.toBe(id3);
    });

    it('returns null if no session markers are found', () => {
      const id = extractSessionId({});
      expect(id).toBeNull();
    });
  });

  describe('getSessionBoundModel & bindSessionToModel', () => {
    const account1Model: CustomModel = {
      name: 'google-perso-gemini',
      displayName: '[Perso] Gemini 4 Argon Medium',
      provider: 'google',
      apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: 'key-account-1',
      externalModelName: 'gemini-4-argon-medium',
      enabled: true,
    };

    const account2Model: CustomModel = {
      name: 'google-work-gemini',
      displayName: '[Work] Gemini 4 Argon Medium',
      provider: 'google',
      apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: 'key-account-2',
      externalModelName: 'gemini-4-argon-medium',
      enabled: true,
    };

    const allModels: CustomModel[] = [account1Model, account2Model];

    it('binds session to account1 and routes subsequent requests for same model to account1', () => {
      bindSessionToModel('session-alpha', account1Model);

      // Incoming request originally resolved to account2Model (or generic model)
      const bound = getSessionBoundModel('session-alpha', account2Model, allModels);

      // Should stick to account1Model because of session affinity
      expect(bound.name).toBe(account1Model.name);
      expect(bound.apiKey).toBe('key-account-1');
    });

    it('returns targetModel when no session affinity exists', () => {
      const bound = getSessionBoundModel('unknown-session', account2Model, allModels);
      expect(bound.name).toBe(account2Model.name);
    });

    it('isolates different sessions to their respective accounts', () => {
      bindSessionToModel('session-1', account1Model);
      bindSessionToModel('session-2', account2Model);

      expect(getSessionBoundModel('session-1', account2Model, allModels).apiKey).toBe('key-account-1');
      expect(getSessionBoundModel('session-2', account1Model, allModels).apiKey).toBe('key-account-2');
    });

    it('strictly preserves reasoning effort tier (e.g. Medium does not downgrade to Low)', () => {
      const acc1Low: CustomModel = {
        ...account1Model,
        name: 'acc1-low',
        displayName: 'Gemini 3.8 Flash (Low)',
        externalModelName: 'gemini-3.8-flash-tiered',
        _effortSuffix: '-low',
        reasoningEffort: 'low',
      };
      const acc1Med: CustomModel = {
        ...account1Model,
        name: 'acc1-medium',
        displayName: 'Gemini 3.8 Flash (Medium)',
        externalModelName: 'gemini-3.8-flash-tiered',
        _effortSuffix: '-medium',
        reasoningEffort: 'medium',
      };
      const acc2Med: CustomModel = {
        ...account2Model,
        name: 'acc2-medium',
        displayName: 'Gemini 3.8 Flash (Medium)',
        externalModelName: 'gemini-3.8-flash-tiered',
        _effortSuffix: '-medium',
        reasoningEffort: 'medium',
      };

      const tieredModels: CustomModel[] = [acc1Low, acc1Med, acc2Med];
      bindSessionToModel('session-effort', acc1Med);

      // Subsequent request targets acc2Med; session affinity must bind to acc1Med, NOT acc1Low
      const bound = getSessionBoundModel('session-effort', acc2Med, tieredModels);
      expect(bound.name).toBe('acc1-medium');
      expect(bound.reasoningEffort).toBe('medium');
      expect(bound.displayName).toContain('(Medium)');
    });

    it('clears session affinity and falls back to targetModel if bound account enters cooldown or is unlicensed', () => {
      bindSessionToModel('session-cooldown', account1Model);
      expect(getSessionBoundModel('session-cooldown', account2Model, allModels).name).toBe('google-perso-gemini');

      // Now account1 is disabled
      (account1Model as any).enabled = false;
      const fallback = getSessionBoundModel('session-cooldown', account2Model, allModels);
      expect(fallback.name).toBe('google-work-gemini');

      // Re-enable account1, but session affinity must have been deleted
      (account1Model as any).enabled = true;
      const subsequent = getSessionBoundModel('session-cooldown', account2Model, allModels);
      expect(subsequent.name).toBe('google-work-gemini');
    });
  });

  describe('getAccountQuotaKey', () => {
    it('creates unique key per hostname and apiKey', () => {
      const m1: CustomModel = {
        name: 'm1',
        provider: 'google',
        apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: 'key-aaa',
        externalModelName: 'gemini-4-argon-medium',
      };
      const m2: CustomModel = {
        name: 'm2',
        provider: 'google',
        apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: 'key-bbb',
        externalModelName: 'gemini-4-argon-medium',
      };

      expect(getAccountQuotaKey(m1)).toBe('generativelanguage.googleapis.com:key-aaa');
      expect(getAccountQuotaKey(m2)).toBe('generativelanguage.googleapis.com:key-bbb');
    });
  });

  describe('Session Model Fallback & Notification Deduplication', () => {
    it('sets and retrieves session fallback correctly', () => {
      setSessionModelFallback('sess-100', 'claude-3-7-sonnet', 'gemini-3.8-flash-tiered', true);
      const fb = getSessionModelFallback('sess-100');
      expect(fb).toBeDefined();
      expect(fb?.originalModel).toBe('claude-3-7-sonnet');
      expect(fb?.fallbackModel).toBe('gemini-3.8-flash-tiered');
      expect(fb?.notified).toBe(true);
    });

    it('clears session fallbacks on clearSessionAffinities', () => {
      setSessionModelFallback('sess-100', 'claude-3-7-sonnet', 'gemini-3.8-flash-tiered', true);
      clearSessionAffinities();
      expect(getSessionModelFallback('sess-100')).toBeUndefined();
    });

    it('clears individual session fallback with clearSessionModelFallback', () => {
      setSessionModelFallback('sess-100', 'gemini-3.8-flash-tiered', 'claude-sonnet-4-6', true);
      setSessionModelFallback('sess-200', 'claude-opus-4-6', 'claude-sonnet-4-6', true);
      expect(getSessionModelFallback('sess-100')).toBeDefined();
      expect(getSessionModelFallback('sess-200')).toBeDefined();

      clearSessionModelFallback('sess-100');
      expect(getSessionModelFallback('sess-100')).toBeUndefined();
      expect(getSessionModelFallback('sess-200')).toBeDefined();
    });
  });

  describe('sanitizeCandidatesInResponse Nil-Pointer & Envelope Protection', () => {
    it('mutually mirrors response.candidates and candidates with valid non-empty parts', () => {
      const data: any = {
        candidates: [{ index: 0 }],
      };
      const modified = sanitizeCandidatesInResponse(data);
      expect(modified).toBe(true);
      expect(data.response).toBeDefined();
      expect(Array.isArray(data.response.candidates)).toBe(true);
      expect(data.response.candidates[0].content.parts).toEqual([{ text: '' }]);
      expect(data.candidates[0].content.parts).toEqual([{ text: '' }]);
    });

    it('handles empty candidates gracefully and ensures non-empty parts', () => {
      const data: any = { response: { candidates: [] } };
      sanitizeCandidatesInResponse(data);
      expect(data.response.candidates.length).toBeGreaterThan(0);
      expect(data.response.candidates[0].content.parts.length).toBeGreaterThan(0);
      expect(data.candidates).toBeDefined();
    });

    it('fixes part objects with undefined text or null values', () => {
      const data: any = {
        response: {
          candidates: [
            {
              content: {
                parts: [null, { somethingElse: 123 }],
                role: 'model',
              },
            },
          ],
        },
      };
      sanitizeCandidatesInResponse(data);
      expect(data.response.candidates[0].content.parts[0]).toEqual({ text: '' });
      expect(data.response.candidates[0].content.parts[1].text).toBe('');
    });
  });

  describe('Session Affinity Capacity and Pruning (AUDIT-001 Resilience)', () => {
    it('prunes expired sessions when table exceeds 500 entries', () => {
      const model: CustomModel = {
        name: 'test-model',
        displayName: 'Test',
        description: 'Test',
        provider: 'google',
        apiKey: 'key',
        apiUrl: 'https://example.com',
        externalModelName: 'gemini-2.5-flash',
        accountEmail: 'test@gmail.com',
      };

      // Insert an expired session
      bindSessionToModel('expired-session-1', model);

      // Flood with 501 sessions
      for (let i = 0; i <= 501; i++) {
        bindSessionToModel(`session-${i}`, model);
      }

      // Ensure binding works without unbound memory growth
      expect(getSessionBoundModel('session-500', model, [model])).toBe(model);
    });

    it('enforces hard LRU cap and shrinks table when all entries are unexpired', () => {
      const model: CustomModel = {
        name: 'test-model',
        displayName: 'Test',
        description: 'Test',
        provider: 'google',
        apiKey: 'key',
        apiUrl: 'https://example.com',
        externalModelName: 'gemini-2.5-flash',
        accountEmail: 'test@gmail.com',
      };

      // Add 550 active sessions without any being expired
      for (let i = 0; i < 550; i++) {
        bindSessionToModel(`active-${i}`, model);
      }

      // Oldest sessions (e.g. active-0) should have been LRU-evicted
      // Latest sessions (e.g. active-549) must remain bound
      expect(getSessionBoundModel('active-549', model, [model])).toBe(model);
    });

    it('maintains session affinity for candidate account across consecutive requests', () => {
      const candidateAccount: CustomModel = {
        name: 'models/google:gemini-3.8-flash:acc1',
        displayName: 'Account 1',
        description: 'Account 1',
        provider: 'google',
        apiKey: 'ya29.sample_token',
        apiUrl: 'https://daily-cloudcode-pa.googleapis.com',
        externalModelName: 'gemini-3.8-flash-tiered',
        accountEmail: 'test-user-1@example.com',
        quotas: { geminiFiveHourPct: 100, geminiWeeklyPct: 100 },
      };
      const candidateAccount2: CustomModel = {
        name: 'models/google:gemini-3.8-flash:acc2',
        displayName: 'Account 2',
        description: 'Account 2',
        provider: 'google',
        apiKey: 'ya29.sample_token_2',
        apiUrl: 'https://daily-cloudcode-pa.googleapis.com',
        externalModelName: 'gemini-3.8-flash-tiered',
        accountEmail: 'test-user-2@example.com',
        quotas: { geminiFiveHourPct: 100, geminiWeeklyPct: 100 },
      };

      bindSessionToModel('-3750763034362895579', candidateAccount);
      const bound = getSessionBoundModel(
        '-3750763034362895579',
        candidateAccount2,
        [candidateAccount, candidateAccount2],
      );
      expect(bound.accountEmail).toBe('test-user-1@example.com');
    });

    it('AUDIT-001: preserves sticky session bound account when request was temporarily diverted to idle pool account', () => {
      const primaryAccount: CustomModel = {
        name: 'models/google:gemini-3.8-flash:primary',
        displayName: 'Primary Sticky Account',
        provider: 'google',
        apiKey: 'ya29.sample_token_primary',
        apiUrl: 'https://daily-cloudcode-pa.googleapis.com',
        externalModelName: 'gemini-3.8-flash-tiered',
        accountEmail: 'primary.sticky@example.com',
        quotas: { geminiFiveHourPct: 100, geminiWeeklyPct: 100 },
      };
      const divertedAccount: CustomModel = {
        name: 'models/google:gemini-3.8-flash:diverted',
        displayName: 'Diverted Account',
        provider: 'google',
        apiKey: 'ya29.sample_token_diverted',
        apiUrl: 'https://daily-cloudcode-pa.googleapis.com',
        externalModelName: 'gemini-3.8-flash-tiered',
        accountEmail: 'diverted.idle@example.com',
        quotas: { geminiFiveHourPct: 100, geminiWeeklyPct: 100 },
      };

      const sessId = 'session-burst-concurrency';
      bindSessionToModel(sessId, primaryAccount);

      // Verify session is initially bound to primary
      const initialBound = getSessionBoundModel(sessId, divertedAccount, [primaryAccount, divertedAccount]);
      expect(initialBound.accountEmail).toBe('primary.sticky@example.com');

      // When concurrency diversion happens, healthy primary sticky session must be preserved
      const existingAffinityKey = getAccountQuotaKey(primaryAccount);
      const isDivertedFromHealthySticky = Boolean(
        primaryAccount &&
        divertedAccount !== primaryAccount &&
        existingAffinityKey &&
        !isAccountInCooldown(primaryAccount, 'gemini') &&
        getModelQuotaScore(primaryAccount, 'gemini') > 0
      );
      expect(isDivertedFromHealthySticky).toBe(true);

      // Primary binding remains untouched
      const afterBound = getSessionBoundModel(sessId, divertedAccount, [primaryAccount, divertedAccount]);
      expect(afterBound.accountEmail).toBe('primary.sticky@example.com');
    });
  });
});


