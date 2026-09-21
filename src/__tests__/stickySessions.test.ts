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
  getSessionModelFallback,
  setSessionModelFallback,
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
      displayName: '[Perso] Gemini 3.1 Pro High',
      provider: 'google',
      apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: 'key-account-1',
      externalModelName: 'gemini-3.1-pro-high',
      enabled: true,
    };

    const account2Model: CustomModel = {
      name: 'google-work-gemini',
      displayName: '[Work] Gemini 3.1 Pro High',
      provider: 'google',
      apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: 'key-account-2',
      externalModelName: 'gemini-3.1-pro-high',
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
  });

  describe('getAccountQuotaKey', () => {
    it('creates unique key per hostname and apiKey', () => {
      const m1: CustomModel = {
        name: 'm1',
        provider: 'google',
        apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: 'key-aaa',
        externalModelName: 'gemini-3.1-pro-high',
      };
      const m2: CustomModel = {
        name: 'm2',
        provider: 'google',
        apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: 'key-bbb',
        externalModelName: 'gemini-3.1-pro-high',
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
});

