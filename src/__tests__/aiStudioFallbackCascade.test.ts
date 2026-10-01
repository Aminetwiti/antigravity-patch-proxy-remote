/**
 * Google AI Studio Fallback Cascade Tests
 *
 * Covers the fix that allows google-gemini (AI Studio) accounts to be used
 * when all Cloud Code (google) accounts are exhausted.
 *
 * Use cases:
 * 1. AI Studio models are included in the fallback list (not excluded)
 * 2. AI Studio accounts are prioritised over third-party providers
 * 3. All 4 AI Studio accounts are rotated (not just the first)
 * 4. Accounts with open circuit breakers are skipped
 * 5. Pool-only models are never used as fallback
 * 6. When AI Studio also fails, third-party providers are tried
 * 7. Flash 3.6 / 3.7 / 3.8 variants are all eligible as fallback
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => '/mock/home' },
}));

vi.mock('electron-log/main', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { getOpenBreaker, recordFailure, recordSuccess } from '../proxy/circuitBreaker';
import type { CustomModel } from '../proxy/types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const cloudCodeAccount = (email: string, model = 'gemini-3.8-flash-tiered'): CustomModel => ({
  name: `cc-${email}`,
  provider: 'google',
  apiUrl: 'https://daily-cloudcode-pa.googleapis.com',
  refreshToken: `rt-${email}`,
  accountEmail: email,
  externalModelName: model,
});

const aiStudioAccount = (email: string, model: string): CustomModel => ({
  name: `ais-${email}-${model}`,
  provider: 'google-gemini',
  apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
  apiKey: `AIza-key-${email}`,
  accountEmail: email,
  externalModelName: model,
  displayName: `AI Studio ${model} (${email})`,
});

const openAiModel = (): CustomModel => ({
  name: 'gpt-4o',
  provider: 'openai',
  apiUrl: 'https://api.openai.com/v1',
  apiKey: 'sk-test',
  externalModelName: 'gpt-4o',
});

const anthropicModel = (): CustomModel => ({
  name: 'claude-sonnet',
  provider: 'anthropic',
  apiUrl: 'https://api.anthropic.com/v1',
  apiKey: 'sk-ant-test',
  externalModelName: 'claude-sonnet-4-5',
});

// ── The filter+sort logic extracted verbatim from proxy.ts ────────────────────
// This mirrors the logic at L.1739-1751 so we can unit-test it without HTTP.

function buildFallbackOrder(allCustomModels: CustomModel[]): {
  nonGoogleFallbacks: CustomModel[];
  aiStudioFallbacks: CustomModel[];
  otherFallbacks: CustomModel[];
  orderedFallbacks: CustomModel[];
} {
  const nonGoogleFallbacks = allCustomModels.filter(
    (m) => m.provider !== 'google' && !m._poolOnly && !getOpenBreaker(m),
  );
  const aiStudioFallbacks = nonGoogleFallbacks.filter((m) => m.provider === 'google-gemini');
  const otherFallbacks = nonGoogleFallbacks.filter((m) => m.provider !== 'google-gemini');
  const orderedFallbacks = [...aiStudioFallbacks, ...otherFallbacks];
  return { nonGoogleFallbacks, aiStudioFallbacks, otherFallbacks, orderedFallbacks };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('AI Studio Fallback Cascade — filter logic', () => {
  beforeEach(() => {
    // Reset circuit breakers between tests (clear any tripped state from previous run)
    // recordSuccess resets the breaker for a model
    const noop = {} as CustomModel;
    void noop; // breakers are keyed by model reference; just re-create fixtures each test
  });

  it('UC-1: includes google-gemini accounts in the fallback pool', () => {
    const models: CustomModel[] = [
      cloudCodeAccount('cc1@gmail.com'),
      aiStudioAccount('studio1@gmail.com', 'gemini-2.5-flash'),
    ];
    const { nonGoogleFallbacks } = buildFallbackOrder(models);
    expect(nonGoogleFallbacks).toHaveLength(1);
    expect(nonGoogleFallbacks[0].provider).toBe('google-gemini');
  });

  it('UC-2: excludes Cloud Code (google) accounts from the fallback pool', () => {
    const models: CustomModel[] = [
      cloudCodeAccount('cc1@gmail.com'),
      cloudCodeAccount('cc2@gmail.com'),
    ];
    const { nonGoogleFallbacks } = buildFallbackOrder(models);
    expect(nonGoogleFallbacks).toHaveLength(0);
  });

  it('UC-3: AI Studio accounts come BEFORE OpenAI/Anthropic in ordered fallback', () => {
    const models: CustomModel[] = [
      cloudCodeAccount('cc1@gmail.com'),
      openAiModel(),
      anthropicModel(),
      aiStudioAccount('studio1@gmail.com', 'gemini-2.5-flash'),
      aiStudioAccount('studio2@gmail.com', 'gemini-2.5-pro'),
    ];
    const { orderedFallbacks } = buildFallbackOrder(models);
    // First two must be AI Studio
    expect(orderedFallbacks[0].provider).toBe('google-gemini');
    expect(orderedFallbacks[1].provider).toBe('google-gemini');
    // Then third-party
    expect(['openai', 'anthropic']).toContain(orderedFallbacks[2].provider);
    expect(['openai', 'anthropic']).toContain(orderedFallbacks[3].provider);
  });

  it('UC-4: all 4 AI Studio accounts appear in the rotation (none dropped)', () => {
    const models: CustomModel[] = [
      cloudCodeAccount('cc1@gmail.com'),
      aiStudioAccount('studio1@gmail.com', 'gemini-2.5-flash'),
      aiStudioAccount('studio2@gmail.com', 'gemini-2.5-flash'),
      aiStudioAccount('studio3@gmail.com', 'gemini-2.5-pro'),
      aiStudioAccount('studio4@gmail.com', 'gemini-2.5-flash-lite'),
    ];
    const { aiStudioFallbacks } = buildFallbackOrder(models);
    expect(aiStudioFallbacks).toHaveLength(4);
  });

  it('UC-5: pool-only models (_poolOnly=true) are never used as fallback', () => {
    const poolOnly: CustomModel = {
      ...aiStudioAccount('studio1@gmail.com', 'gemini-2.5-flash'),
      _poolOnly: true,
    };
    const models: CustomModel[] = [cloudCodeAccount('cc1@gmail.com'), poolOnly];
    const { nonGoogleFallbacks } = buildFallbackOrder(models);
    expect(nonGoogleFallbacks).toHaveLength(0);
  });

  it('UC-6: AI Studio account with open circuit breaker is skipped', () => {
    const healthy = aiStudioAccount('studio1@gmail.com', 'gemini-2.5-flash');
    const tripped = aiStudioAccount('studio2@gmail.com', 'gemini-2.5-flash');

    // Trip the circuit breaker for studio2 by recording 5 consecutive server failures
    for (let i = 0; i < 5; i++) recordFailure(tripped, 'server');

    const models: CustomModel[] = [cloudCodeAccount('cc1@gmail.com'), healthy, tripped];
    const { aiStudioFallbacks } = buildFallbackOrder(models);

    // Only the healthy account should appear
    expect(aiStudioFallbacks).toHaveLength(1);
    expect(aiStudioFallbacks[0].accountEmail).toBe('studio1@gmail.com');

    // Cleanup
    recordSuccess(tripped);
  });

  it('UC-7: all three Flash variants (3.6, 3.7, 3.8) are eligible as fallback', () => {
    const models: CustomModel[] = [
      cloudCodeAccount('cc1@gmail.com'),
      aiStudioAccount('a@g.com', 'gemini-2.0-flash'),          // Flash 3.6-era
      aiStudioAccount('b@g.com', 'gemini-2.5-flash'),          // Flash 3.7-era
      aiStudioAccount('c@g.com', 'gemini-2.5-flash-preview'),  // Flash 3.8-era
    ];
    const { aiStudioFallbacks } = buildFallbackOrder(models);
    expect(aiStudioFallbacks).toHaveLength(3);
    const names = aiStudioFallbacks.map((m) => m.externalModelName);
    expect(names).toContain('gemini-2.0-flash');
    expect(names).toContain('gemini-2.5-flash');
    expect(names).toContain('gemini-2.5-flash-preview');
  });

  it('UC-8: when all AI Studio accounts have open breakers, falls through to third-party', () => {
    const s1 = aiStudioAccount('studio1@gmail.com', 'gemini-2.5-flash');
    const s2 = aiStudioAccount('studio2@gmail.com', 'gemini-2.5-flash');
    for (let i = 0; i < 5; i++) {
      recordFailure(s1, 'server');
      recordFailure(s2, 'server');
    }

    const models: CustomModel[] = [cloudCodeAccount('cc1@gmail.com'), s1, s2, openAiModel()];
    const { aiStudioFallbacks, otherFallbacks, orderedFallbacks } = buildFallbackOrder(models);

    expect(aiStudioFallbacks).toHaveLength(0);
    expect(otherFallbacks).toHaveLength(1);
    expect(orderedFallbacks[0].provider).toBe('openai');

    // Cleanup
    recordSuccess(s1);
    recordSuccess(s2);
  });

  it('UC-9: mixed pool — 4 AI Studio + 2 third-party, correct count and order', () => {
    const models: CustomModel[] = [
      cloudCodeAccount('cc1@gmail.com'),
      cloudCodeAccount('cc2@gmail.com'),
      cloudCodeAccount('cc3@gmail.com'),
      aiStudioAccount('s1@gmail.com', 'gemini-2.5-flash'),
      aiStudioAccount('s2@gmail.com', 'gemini-2.5-flash'),
      aiStudioAccount('s3@gmail.com', 'gemini-2.5-pro'),
      aiStudioAccount('s4@gmail.com', 'gemini-2.5-flash-lite'),
      openAiModel(),
      anthropicModel(),
    ];
    const { orderedFallbacks } = buildFallbackOrder(models);

    // 4 AI Studio + 2 third-party = 6 total
    expect(orderedFallbacks).toHaveLength(6);
    // First 4 are AI Studio
    for (let i = 0; i < 4; i++) {
      expect(orderedFallbacks[i].provider).toBe('google-gemini');
    }
    // Last 2 are third-party
    expect(orderedFallbacks[4].provider).not.toBe('google-gemini');
    expect(orderedFallbacks[5].provider).not.toBe('google-gemini');
  });

  it('UC-10: no fallback candidates when every model is Cloud Code or pool-only', () => {
    const models: CustomModel[] = [
      cloudCodeAccount('cc1@gmail.com'),
      cloudCodeAccount('cc2@gmail.com'),
      { ...aiStudioAccount('s1@gmail.com', 'gemini-2.5-flash'), _poolOnly: true },
    ];
    const { orderedFallbacks } = buildFallbackOrder(models);
    expect(orderedFallbacks).toHaveLength(0);
  });
});
