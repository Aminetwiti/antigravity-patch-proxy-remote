import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getSpeedTier,
  renderPingBadge,
  extractPongResponse,
  formatApiError,
  testSingleModel,
  testBatchModels,
} from './ping-pong-tester';

describe('ping-pong-tester module', () => {
  describe('getSpeedTier', () => {
    it('returns error when ok is false', () => {
      expect(getSpeedTier(150, false)).toBe('error');
      expect(getSpeedTier(3000, false)).toBe('error');
    });

    it('classifies latency correctly when ok is true', () => {
      expect(getSpeedTier(120, true)).toBe('fast');
      expect(getSpeedTier(399, true)).toBe('fast');
      expect(getSpeedTier(400, true)).toBe('normal');
      expect(getSpeedTier(1200, true)).toBe('normal');
      expect(getSpeedTier(1201, true)).toBe('slow');
      expect(getSpeedTier(3500, true)).toBe('slow');
    });
  });

  describe('renderPingBadge', () => {
    it('renders error badge when failed', () => {
      const html = renderPingBadge({ ok: false, status: 500, latencyMs: 250, speedTier: 'error' });
      expect(html).toContain('ping-badge-error');
      expect(html).toContain('FAIL (500)');
    });

    it('renders fast badge with ⚡ icon', () => {
      const html = renderPingBadge({ ok: true, status: 200, latencyMs: 180, speedTier: 'fast' });
      expect(html).toContain('ping-badge-fast');
      expect(html).toContain('⚡');
      expect(html).toContain('180ms');
    });

    it('renders normal badge with ⏱️ icon', () => {
      const html = renderPingBadge({ ok: true, status: 200, latencyMs: 850, speedTier: 'normal' });
      expect(html).toContain('ping-badge-normal');
      expect(html).toContain('⏱️');
      expect(html).toContain('850ms');
    });

    it('renders slow badge with 🐢 icon', () => {
      const html = renderPingBadge({ ok: true, status: 200, latencyMs: 2400, speedTier: 'slow' });
      expect(html).toContain('ping-badge-slow');
      expect(html).toContain('🐢');
      expect(html).toContain('2400ms');
    });
  });

  describe('extractPongResponse', () => {
    it('returns empty string on empty input', () => {
      expect(extractPongResponse(null)).toBe('');
      expect(extractPongResponse(undefined)).toBe('');
    });

    it('extracts text from Google Gemini format', () => {
      const payload = {
        candidates: [
          {
            content: {
              parts: [{ text: 'pong!' }],
            },
          },
        ],
      };
      expect(extractPongResponse(payload)).toBe('pong!');
    });

    it('extracts text from OpenAI chat completions format', () => {
      const payload = {
        choices: [
          {
            message: {
              content: 'pong',
            },
          },
        ],
      };
      expect(extractPongResponse(payload)).toBe('pong');
    });

    it('extracts text from legacy completions format', () => {
      const payload = {
        choices: [
          {
            text: 'pong response',
          },
        ],
      };
      expect(extractPongResponse(payload)).toBe('pong response');
    });

    it('extracts text from Google Cloud Code response envelope', () => {
      const payload = {
        response: {
          candidates: [
            {
              content: {
                parts: [{ text: 'pong from cloud code' }],
                role: 'model',
              },
              finishReason: 'STOP',
            },
          ],
        },
      };
      expect(extractPongResponse(payload)).toBe('pong from cloud code');
    });

    it('extracts text when part 0 has thoughtSignature or non-text part', () => {
      const payload = {
        response: {
          candidates: [
            {
              content: {
                parts: [
                  { thoughtSignature: 'abc123xyz' },
                  { text: 'pong thinking resolved' }
                ],
                role: 'model',
              },
            },
          ],
        },
      };
      expect(extractPongResponse(payload)).toBe('pong thinking resolved');
    });

    it('handles raw JSON string input', () => {
      const str = JSON.stringify({ choices: [{ message: { content: 'pong' } }] });
      expect(extractPongResponse(str)).toBe('pong');
    });

    it('handles plain text fallback', () => {
      expect(extractPongResponse('pong')).toBe('pong');
    });
  });

  describe('formatApiError', () => {
    it('formats billing errors nicely', () => {
      const err = JSON.stringify({
        error: {
          message: 'Insufficient balance. This request requires up to 8,917 tokens reserved.',
          type: 'billing_error',
        },
      });
      const formatted = formatApiError(err);
      expect(formatted).toContain('Solde épuisé');
      expect(formatted).toContain('Insufficient balance');
    });

    it('formats Google quota exhaustion errors nicely', () => {
      const err = JSON.stringify({
        error: {
          code: 429,
          message: 'Resource has been exhausted (e.g. check quota).',
          status: 'RESOURCE_EXHAUSTED',
        },
      });
      const formatted = formatApiError(err);
      expect(formatted).toContain('Quota épuisé');
    });

    it('formats Google invalid API key errors nicely', () => {
      const err = JSON.stringify({
        error: {
          code: 400,
          message: 'API key not valid. Please pass a valid API key.',
          status: 'INVALID_ARGUMENT',
          details: [{ reason: 'API_KEY_INVALID' }],
        },
      });
      const formatted = formatApiError(err);
      expect(formatted).toBe('Clé API invalide ou expirée');
    });

    it('falls back gracefully on non-json error', () => {
      expect(formatApiError('Network timeout', 504)).toBe('Network timeout');
      expect(formatApiError('', 502)).toBe('HTTP 502');
    });
  });

  describe('testSingleModel and testBatchModels', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
      (globalThis as any).window = globalThis;
    });

    it('runs single model test via window.ag.modelPingPong', async () => {
      const mockPingPong = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        latencyMs: 145,
        pongText: 'pong',
      });
      (globalThis as any).ag = { modelPingPong: mockPingPong };

      const res = await testSingleModel({ name: 'gemini-2.5-flash', id: 'gemini-2.5-flash', provider: 'google' });
      expect(res.ok).toBe(true);
      expect(res.latencyMs).toBe(145);
      expect(res.speedTier).toBe('fast');
      expect(res.pongText).toBe('pong');
      expect(mockPingPong).toHaveBeenCalledWith({
        modelId: 'gemini-2.5-flash',
        providerId: undefined,
        prompt: 'ping',
      });
    });

    it('handles model failure gracefully', async () => {
      const mockPingPong = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        latencyMs: 90,
        pongText: '',
        error: 'Rate limit exceeded',
      });
      (globalThis as any).ag = { modelPingPong: mockPingPong };

      const res = await testSingleModel({ name: 'claude-3-opus', id: 'claude-3-opus' });
      expect(res.ok).toBe(false);
      expect(res.speedTier).toBe('error');
      expect(res.error).toBe('Rate limit exceeded');
    });

    it('runs batch model testing with progress callback', async () => {
      const mockPingPong = vi.fn().mockImplementation(async ({ modelId }) => {
        return {
          ok: true,
          status: 200,
          latencyMs: modelId === 'm1' ? 100 : 500,
          pongText: 'pong',
        };
      });
      (globalThis as any).ag = { modelPingPong: mockPingPong };

      const models = [{ name: 'm1', id: 'm1' }, { name: 'm2', id: 'm2' }];
      const progressCalls: any[] = [];

      const results = await testBatchModels(models, (done, total, r) => {
        progressCalls.push({ done, total, modelName: r.modelName });
      });

      expect(results.length).toBe(2);
      expect(results[0].speedTier).toBe('fast');
      expect(results[1].speedTier).toBe('normal');
      expect(progressCalls).toEqual([
        { done: 1, total: 2, modelName: 'm1' },
        { done: 2, total: 2, modelName: 'm2' },
      ]);
    });
  });
});
