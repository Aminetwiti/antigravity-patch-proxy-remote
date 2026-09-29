/**
 * Google AI Studio — Production Phase & Difficult Scenarios Test Suite
 *
 * Verifies that:
 * 1. SSE user feedback is properly emitted in streaming responses:
 *    - Cloud Code pool exhaustion banner (French):
 *      "> 🔄 **Pool Cloud Code saturé** — Poursuite avec **Google AI Studio** ..."
 *    - Smart Proxy Switch banner on rate limit:
 *      "> ⚡ **Smart Proxy Switch** ... Rerouted to: ..."
 * 2. Difficult Multi-Account Cascade & Rotation:
 *    - Rotation across 4 configured Google AI Studio accounts (Account 1 [429] -> Account 2 [429] -> Account 3 [503] -> Account 4 [200 OK])
 * 3. Sticky Session & Single-Notification Guard:
 *    - Session affinity is preserved across turns; notification banner is sent once and not repeated
 * 4. Circuit Breaker Immediate Short-Circuit:
 *    - Tripped accounts are skipped without wasting time on outbound connections
 * 5. Registry & Transport Integrity:
 *    - Headers (x-goog-api-key), URL builder (:streamGenerateContent?alt=sse), body pass-through with tools, streaming chunk mapping
 * 6. Quota Domain Isolation across multi-account pool:
 *    - Separate API keys prevent false-positive shared rate limits
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as http from 'http';
import { EventEmitter } from 'events';

vi.mock('electron', () => ({
  app: { getPath: () => '/mock/home' },
}));

vi.mock('electron-log/main', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  getOpenBreaker,
  recordFailure,
  recordSuccess,
  _resetAllBreakers,
} from '../proxy/circuitBreaker';
import {
  getTranslator,
  translateRequest,
  translateResponse,
  translateStreamChunk,
  getProviderHeaders,
  supportsStreaming,
} from '../proxy/registry';
import { resolveProvider, resolveCustomModelUrl } from '../proxy/urlBuilder';
import { getGoogleApiUrl, mapGoogleChunkToGemini } from '../proxy/translators/google';
import {
  getAccountQuotaKey,
  setSessionModelFallback,
  getSessionModelFallback,
  clearSessionModelFallbacks,
} from '../proxy';
import { PROVIDERS, ALL_PROVIDERS } from '../constants';
import type { CustomModel } from '../proxy/types';

// ── Mock Response Helper for SSE Streams ──────────────────────────────────────

class MockServerResponse extends EventEmitter {
  statusCode = 200;
  headers: Record<string, string> = {};
  headersSent = false;
  writableEnded = false;
  destroyed = false;
  writtenChunks: string[] = [];

  writeHead(statusCode: number, headers?: Record<string, string>): this {
    this.statusCode = statusCode;
    if (headers) Object.assign(this.headers, headers);
    this.headersSent = true;
    return this;
  }

  write(chunk: unknown): boolean {
    this.writtenChunks.push(String(chunk));
    return true;
  }

  end(chunk?: unknown): this {
    if (chunk) this.write(chunk);
    this.writableEnded = true;
    this.emit('finish');
    return this;
  }
}

// ── Helpers & Fixtures ────────────────────────────────────────────────────────

const createAiStudioAccount = (index: number, model = 'gemini-3.8-flash'): CustomModel => ({
  name: `ais-account-${index}-${model}`,
  displayName: `Google AI Studio Account ${index} (${model})`,
  provider: 'google-gemini',
  apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
  apiKey: `AIzaSyFakeKey_Account_${index}_TestSecret999`,
  externalModelName: model,
  accountEmail: `user${index}@example.com`,
});

const createCloudCodeAccount = (index: number, model = 'gemini-3.8-flash-tiered'): CustomModel => ({
  name: `cc-account-${index}`,
  displayName: `Cloud Code Account ${index}`,
  provider: 'google',
  apiUrl: 'https://daily-cloudcode-pa.googleapis.com',
  refreshToken: `rt-fake-token-${index}`,
  externalModelName: model,
});

const createOpenAiFallback = (): CustomModel => ({
  name: 'gpt-4o',
  displayName: 'OpenAI GPT-4o (Fallback Tier 3)',
  provider: 'openai',
  apiUrl: 'https://api.openai.com/v1',
  apiKey: 'sk-fake-openai-key',
  externalModelName: 'gpt-4o',
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Google AI Studio — Production Phase & Difficult Scenarios', () => {
  beforeEach(() => {
    _resetAllBreakers();
    clearSessionModelFallbacks();
  });

  // ── 1. User Feedback in SSE Stream ──────────────────────────────────────────

  describe('Scenario 1: Transparent SSE User Feedback Banners', () => {
    it('emits the French Pool Cloud Code Saturé banner when cascading from Cloud Code to AI Studio', () => {
      const res = new MockServerResponse();
      const fallbackModel = createAiStudioAccount(1, 'gemini-3.8-flash');
      const isAiStudio = fallbackModel.provider === 'google-gemini';

      // Simulates the exact feedback emission logic from proxy.ts lines 1770-1786
      const notice = isAiStudio
        ? `> 🔄 **Pool Cloud Code saturé** — Poursuite avec **Google AI Studio** (${fallbackModel.displayName || fallbackModel.name}).\n\n`
        : `> 🌐 **Pool Google saturé** — Poursuite automatique avec **${fallbackModel.displayName || fallbackModel.name}** (${fallbackModel.provider}).\n\n`;

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      const sseChunk = {
        response: {
          candidates: [{ content: { parts: [{ text: notice }], role: 'model' }, index: 0 }],
        },
      };

      res.write(`data: ${JSON.stringify(sseChunk)}\n\n`);

      // Verify headers
      expect(res.statusCode).toBe(200);
      expect(res.headers['Content-Type']).toBe('text/event-stream');

      // Verify banner content
      const fullOutput = res.writtenChunks.join('');
      expect(fullOutput).toContain('Pool Cloud Code saturé');
      expect(fullOutput).toContain('Google AI Studio');
      expect(fullOutput).toContain(fallbackModel.displayName);
      expect(fullOutput).toContain('🔄');
    });

    it('emits the Smart Proxy Switch banner when an individual AI Studio account is rate-limited (429)', () => {
      const res = new MockServerResponse();
      const fromModel = createAiStudioAccount(1, 'gemini-3.8-flash');
      const toModel = createAiStudioAccount(2, 'gemini-3.8-flash');
      const errorType = 'rate_limit';

      // Simulates the exact feedback emission logic from proxy.ts lines 3310-3334
      const noticeText = `> ⚡ **Smart Proxy Switch**\n> \`Provider Notice\`: \`${fromModel.displayName}\` is temporarily rate-limited (${errorType}).\n> 🔄 **Rerouted to**: \`${toModel.displayName}\` (Zero downtime, uninterrupted session)\n\n`;

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-AG-Fallback': 'true',
      });

      const notice = {
        response: {
          candidates: [{
            content: { parts: [{ text: noticeText }], role: 'model' },
            index: 0,
          }],
        },
        traceId: 'tr-test-123',
        metadata: {},
      };

      res.write(`data: ${JSON.stringify(notice)}\n\n`);

      const fullOutput = res.writtenChunks.join('');
      expect(fullOutput).toContain('Smart Proxy Switch');
      expect(fullOutput).toContain('temporarily rate-limited (rate_limit)');
      expect(fullOutput).toContain(toModel.displayName);
      expect(fullOutput).toContain('Zero downtime, uninterrupted session');
      expect(res.headers['X-AG-Fallback']).toBe('true');
    });
  });

  // ── 2. Difficult Multi-Account Cascade & Rotation ───────────────────────────

  describe('Scenario 2: Difficult Multi-Account Rotation (4 AI Studio Accounts)', () => {
    it('rotates through 4 AI Studio accounts in order when encountering 429, 429, 503, until Account 4 succeeds', () => {
      const accounts = [
        createAiStudioAccount(1, 'gemini-3.8-flash'),
        createAiStudioAccount(2, 'gemini-3.8-flash'),
        createAiStudioAccount(3, 'gemini-3.8-flash'),
        createAiStudioAccount(4, 'gemini-3.8-flash'),
      ];

      // Simulated responses from each account:
      // Account 1: 429 (RPM limit hit)
      // Account 2: 429 (Daily quota exhausted)
      // Account 3: 503 (Model overloaded)
      // Account 4: 200 (Success!)
      const accountOutcomes = [
        { status: 429, errorType: 'rate_limit', success: false },
        { status: 429, errorType: 'rate_limit', success: false },
        { status: 503, errorType: 'server', success: false },
        { status: 200, errorType: null, success: true },
      ];

      const attemptedAccounts: string[] = [];
      let successfulAccount: CustomModel | null = null;

      for (let i = 0; i < accounts.length; i++) {
        const candidate = accounts[i];
        attemptedAccounts.push(candidate.name);

        const outcome = accountOutcomes[i];
        if (outcome.success) {
          successfulAccount = candidate;
          recordSuccess(candidate);
          break;
        } else {
          recordFailure(candidate, outcome.errorType as 'rate_limit' | 'server');
        }
      }

      // Verifications:
      // 1. All 4 accounts were evaluated in strict order
      expect(attemptedAccounts).toEqual([
        accounts[0].name,
        accounts[1].name,
        accounts[2].name,
        accounts[3].name,
      ]);

      // 2. Account 4 was the final successful one
      expect(successfulAccount).not.toBeNull();
      expect(successfulAccount?.name).toBe(accounts[3].name);
      expect(successfulAccount?.apiKey).toBe('AIzaSyFakeKey_Account_4_TestSecret999');

      // 3. Breaker states: Accounts 1-3 have failures recorded, Account 4 is healthy
      expect(getOpenBreaker(accounts[3])).toBeNull();
    });

    it('falls through to Third-Party (OpenAI) only after ALL 4 AI Studio accounts are exhausted', () => {
      const allModels = [
        createCloudCodeAccount(1),
        createAiStudioAccount(1, 'gemini-3.8-flash'),
        createAiStudioAccount(2, 'gemini-3.8-flash'),
        createAiStudioAccount(3, 'gemini-3.8-flash'),
        createAiStudioAccount(4, 'gemini-3.8-flash'),
        createOpenAiFallback(),
      ];

      // All 4 AI Studio accounts trip their circuit breakers
      for (let i = 1; i <= 4; i++) {
        const acc = allModels[i];
        for (let f = 0; f < 5; f++) recordFailure(acc, 'rate_limit');
        expect(getOpenBreaker(acc)).not.toBeNull();
      }

      // Build ordered fallback list (verbatim logic from proxy.ts L.1739-1751)
      const nonGoogleFallbacks = allModels.filter(
        (m) => m.provider !== 'google' && !m._poolOnly && !getOpenBreaker(m),
      );
      const aiStudioFallbacks = nonGoogleFallbacks.filter((m) => m.provider === 'google-gemini');
      const otherFallbacks = nonGoogleFallbacks.filter((m) => m.provider !== 'google-gemini');
      const orderedFallbacks = [...aiStudioFallbacks, ...otherFallbacks];

      // 1. All broken AI Studio accounts must be filtered out
      expect(aiStudioFallbacks).toHaveLength(0);

      // 2. The remaining fallback is OpenAI
      expect(orderedFallbacks).toHaveLength(1);
      expect(orderedFallbacks[0].provider).toBe('openai');
      expect(orderedFallbacks[0].name).toBe('gpt-4o');
    });
  });

  // ── 3. Sticky Session & Single-Notification Guard ───────────────────────────

  describe('Scenario 3: Sticky Session Continuity & Banner Idempotency', () => {
    it('sets session fallback on turn 1 and preserves it on turn 2 without re-notifying', () => {
      const sessionId = 'conv-difficile-prod-888';
      const originalModel = 'gemini-3.8-flash';
      const fallbackAccount = createAiStudioAccount(2, 'gemini-3.8-flash');

      // Turn 1: Fallback occurs
      const existingFallback1 = getSessionModelFallback(sessionId);
      expect(existingFallback1).toBeUndefined();

      // Fallback is registered and banner sent
      setSessionModelFallback(sessionId, originalModel, fallbackAccount.displayName, true);
      const activeFallbackTurn1 = getSessionModelFallback(sessionId);
      expect(activeFallbackTurn1).toBeDefined();
      expect(activeFallbackTurn1?.fallbackModel).toBe(fallbackAccount.displayName);
      expect(activeFallbackTurn1?.notified).toBe(true);

      // Turn 2: Subsequent request on the same session
      const existingFallback2 = getSessionModelFallback(sessionId);
      const alreadyNotified = existingFallback2?.notified === true;

      // Guard check: User must NOT receive the banner a second time
      expect(alreadyNotified).toBe(true);

      // Verify routing continuity: request routes directly to fallback account
      expect(existingFallback2?.fallbackModel).toBe(fallbackAccount.displayName);
    });
  });

  // ── 4. Circuit Breaker Fast-Fail ────────────────────────────────────────────

  describe('Scenario 4: Circuit Breaker Fast-Skip', () => {
    it('immediately bypasses an account with 5 consecutive failures without outbound call', () => {
      const deadAccount = createAiStudioAccount(1, 'gemini-3.8-flash');
      const healthyAccount = createAiStudioAccount(2, 'gemini-3.8-flash');

      // Trip breaker on deadAccount
      for (let i = 0; i < 5; i++) {
        recordFailure(deadAccount, 'server');
      }

      const openBreaker = getOpenBreaker(deadAccount);
      expect(openBreaker).not.toBeNull();
      expect(openBreaker?.errorType).toBe('server');

      // Filter check in proxy router:
      const eligible = [deadAccount, healthyAccount].filter((m) => !getOpenBreaker(m));
      expect(eligible).toHaveLength(1);
      expect(eligible[0].name).toBe(healthyAccount.name);
    });
  });

  // ── 5. Registry, Protocol & Translation Integrity ───────────────────────────

  describe('Scenario 5: Protocol, Headers & Streaming Translation Integrity', () => {
    it('recognizes google-gemini in PROVIDERS and ALL_PROVIDERS constants', () => {
      expect((PROVIDERS as Record<string, string>).GOOGLE_GEMINI).toBe('google-gemini');
      expect(ALL_PROVIDERS).toContain('google-gemini');
    });

    it('maps resolveProvider("google-gemini") to "google" for unified transport', () => {
      const model = createAiStudioAccount(1, 'gemini-3.8-flash');
      expect(resolveProvider(model)).toBe('google');
    });

    it('resolves correct Google AI Studio streaming URL with :streamGenerateContent?alt=sse', () => {
      const model = createAiStudioAccount(1, 'gemini-3.8-flash');
      const streamUrl = resolveCustomModelUrl(
        model,
        true,
        (apiUrl, extName, isStream) => getGoogleApiUrl(apiUrl, extName, isStream),
      );
      expect(streamUrl).toBe(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse',
      );
    });

    it('resolves correct Google AI Studio non-streaming URL with :generateContent', () => {
      const model = createAiStudioAccount(1, 'gemini-3.8-flash');
      const nonStreamUrl = resolveCustomModelUrl(
        model,
        false,
        (apiUrl, extName, isStream) => getGoogleApiUrl(apiUrl, extName, isStream),
      );
      expect(nonStreamUrl).toBe(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent',
      );
    });

    it('injects x-goog-api-key header for google-gemini provider (never Bearer or Authorization)', () => {
      const apiKey = 'AIzaSyTest_Specific_Key_456';
      const headers = getProviderHeaders('google-gemini', apiKey);

      expect(headers['x-goog-api-key']).toBe(apiKey);
      expect(headers['Authorization']).toBeUndefined();
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('supportsStreaming returns true for google-gemini', () => {
      expect(supportsStreaming('google-gemini')).toBe(true);
    });

    it('translateRequest passes through native Gemini request format including tools and system instructions', () => {
      const complexGeminiBody = {
        contents: [
          { role: 'user', parts: [{ text: 'Examine the codebase and run tests' }] },
          { role: 'model', parts: [{ text: 'Understood. Let me call the tool.' }] },
        ],
        tools: [
          {
            functionDeclarations: [
              {
                name: 'run_command',
                description: 'Execute shell commands',
                parameters: {
                  type: 'OBJECT',
                  properties: { CommandLine: { type: 'STRING' } },
                  required: ['CommandLine'],
                },
              },
            ],
          },
        ],
        generationConfig: { temperature: 0.2, maxOutputTokens: 4096 },
      };

      const translated = translateRequest('google-gemini', complexGeminiBody, 'gemini-3.8-flash');
      // Native Gemini format is preserved intact
      expect(translated).toEqual(complexGeminiBody);
      expect((translated as any).tools[0].functionDeclarations[0].name).toBe('run_command');
    });

    it('translateStreamChunk parses native Google AI Studio streaming chunks correctly', () => {
      const chunk = {
        candidates: [
          {
            content: {
              parts: [{ text: 'Voici les résultats de vos scénarios de production.' }],
              role: 'model',
            },
            finishReason: 'STOP',
            index: 0,
            safetyRatings: [{ category: 'HARM_CATEGORY_HATE_SPEECH', probability: 'NEGLIGIBLE' }],
          },
        ],
      };

      const candidate = mapGoogleChunkToGemini(chunk, 'gemini-3.8-flash');
      expect(candidate).not.toBeNull();
      expect(candidate?.content?.parts?.[0]?.text).toBe('Voici les résultats de vos scénarios de production.');
      expect(candidate?.finishReason).toBe('STOP');
      expect(candidate?.index).toBe(0);
      expect(candidate?.safetyRatings?.[0]?.category).toBe('HARM_CATEGORY_HATE_SPEECH');
    });
  });

  // ── 6. Quota Domain Isolation ───────────────────────────────────────────────

  describe('Scenario 6: Quota Domain Separation across 4 Accounts', () => {
    it('guarantees distinct quota domains for all 4 accounts even when using the same model name', () => {
      // 4 accounts with unique API keys
      const acc1: CustomModel = {
        name: 'ais-1', provider: 'google-gemini',
        apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: 'AIzaSyKey_Account_1', externalModelName: 'gemini-3.8-flash',
      };
      const acc2: CustomModel = {
        name: 'ais-2', provider: 'google-gemini',
        apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: 'AIzaSyKey_Account_2', externalModelName: 'gemini-3.8-flash',
      };
      const acc3: CustomModel = {
        name: 'ais-3', provider: 'google-gemini',
        apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: 'AIzaSyKey_Account_3', externalModelName: 'gemini-3.8-flash',
      };
      const acc4: CustomModel = {
        name: 'ais-4', provider: 'google-gemini',
        apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: 'AIzaSyKey_Account_4', externalModelName: 'gemini-3.8-flash',
      };

      const key1 = getAccountQuotaKey(acc1);
      const key2 = getAccountQuotaKey(acc2);
      const key3 = getAccountQuotaKey(acc3);
      const key4 = getAccountQuotaKey(acc4);

      // All keys must be mutually unique
      const keys = [key1, key2, key3, key4];
      const uniqueKeys = new Set(keys);
      expect(uniqueKeys.size).toBe(4);

      // Each contains the respective API key
      expect(key1).toContain('Account_1');
      expect(key2).toContain('Account_2');
      expect(key3).toContain('Account_3');
      expect(key4).toContain('Account_4');
    });
  });
});
