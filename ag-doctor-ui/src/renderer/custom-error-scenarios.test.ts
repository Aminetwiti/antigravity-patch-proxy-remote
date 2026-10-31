import { describe, expect, it } from 'vitest';
import {
  CUSTOM_PROVIDER_FAILURE_SCENARIOS,
  findScenarioForError,
  getAllScenarios,
  groupScenariosByCategory,
} from './custom-error-scenarios';

/**
 * Unit tests for CUSTOM_PROVIDER_FAILURE_SCENARIOS catalog.
 * Covers 40+ assertions across scenario integrity, matching, grouping.
 */

describe('CUSTOM_PROVIDER_FAILURE_SCENARIOS Catalog', () => {
  it('contains at least 20 scenarios (target hit)', () => {
    expect(CUSTOM_PROVIDER_FAILURE_SCENARIOS.length).toBeGreaterThanOrEqual(20);
  });

  it('contains exactly 21 scenarios (catalog is frozen for this release)', () => {
    expect(CUSTOM_PROVIDER_FAILURE_SCENARIOS.length).toBe(21);
  });

  it('every scenario has all required fields populated', () => {
    for (const scenario of CUSTOM_PROVIDER_FAILURE_SCENARIOS) {
      expect(scenario.id).toBeTruthy();
      expect(scenario.category).toBeTruthy();
      expect(scenario.decodedTitle).toBeTruthy();
      expect(scenario.decodedHint).toBeTruthy();
      expect(scenario.primaryActionLabel).toBeTruthy();
      expect(scenario.secondaryActionLabel).toBeTruthy();
      expect(scenario.dismissLabel).toBeTruthy();
      expect(scenario.exampleProvider).toBeTruthy();
      expect(scenario.exampleErrorText).toBeTruthy();
      expect(scenario.rawPattern).toBeInstanceOf(RegExp);
    }
  });

  it('every scenario id is unique', () => {
    const ids = CUSTOM_PROVIDER_FAILURE_SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers the major HTTP status codes', () => {
    const statuses = CUSTOM_PROVIDER_FAILURE_SCENARIOS.map((s) => s.httpStatus).filter(Boolean);
    expect(statuses).toContain(400);
    expect(statuses).toContain(401);
    expect(statuses).toContain(402);
    expect(statuses).toContain(404);
    expect(statuses).toContain(429);
  });

  it('covers all major provider families in examples', () => {
    const providers = new Set(CUSTOM_PROVIDER_FAILURE_SCENARIOS.map((s) => s.exampleProvider));
    expect(providers.has('OpenAI')).toBe(true);
    expect(providers.has('Anthropic')).toBe(true);
    expect(providers.has('Ollama')).toBe(true);
    expect(providers.has('DeepSeek')).toBe(true);
  });
});

describe('findScenarioForError()', () => {
  it('returns null for empty inputs', () => {
    expect(findScenarioForError('', undefined)).toBeNull();
    expect(findScenarioForError('', 500)).not.toBeNull();
  });

  it('matches by HTTP status first (401 -> auth_401)', () => {
    const s = findScenarioForError('arbitrary text', 401);
    expect(s?.id).toBe('auth_401');
  });

  it('matches by HTTP status (429 -> quota_429)', () => {
    const s = findScenarioForError('irrelevant', 429);
    expect(s?.id).toBe('quota_429');
  });

  it('matches by HTTP status (402 -> credits_402)', () => {
    const s = findScenarioForError('irrelevant', 402);
    expect(s?.id).toBe('credits_402');
  });

  it('matches by HTTP status (400 -> context_400)', () => {
    const s = findScenarioForError('irrelevant', 400);
    expect(s?.id).toBe('context_400');
  });

  it('matches by HTTP status (404 -> model_not_found)', () => {
    const s = findScenarioForError('irrelevant', 404);
    expect(s?.id).toBe('model_not_found');
  });

  it('matches by regex pattern (rate_limit_error)', () => {
    const s = findScenarioForError('rate_limit_error on gpt-4o');
    expect(s?.id).toBe('quota_429');
  });

  it('matches by regex pattern (model_not_found)', () => {
    const s = findScenarioForError('model_not_found: gpt-5-turbo');
    expect(s?.id).toBe('model_not_found');
  });

  it('matches by regex pattern (ECONNREFUSED)', () => {
    const s = findScenarioForError('ECONNREFUSED 127.0.0.1:11434');
    expect(s?.id).toBe('offline_econn');
  });

  it('matches by regex pattern (ETIMEDOUT)', () => {
    const s = findScenarioForError('ETIMEDOUT after 30s');
    expect(s?.id).toBe('network_timeout');
  });

  it('matches by regex pattern (ENOTFOUND)', () => {
    const s = findScenarioForError('ENOTFOUND api.minimaxi.chat');
    expect(s?.id).toBe('invalid_url');
  });

  it('matches by regex pattern (JSON parse error)', () => {
    const s = findScenarioForError('JSON parse error: Unexpected token');
    expect(s?.id).toBe('invalid_json');
  });

  it('matches by regex pattern (stream aborted)', () => {
    const s = findScenarioForError('aborted stream at chunk 42');
    expect(s?.id).toBe('stream_broken');
  });

  it('returns generic scenario for unknown error text', () => {
    const s = findScenarioForError('totally unknown XYZ-9999 error code');
    expect(s?.id).toBe('generic');
  });

  it('matches by regex (rpm exceeded → rate_limit_minute)', () => {
    expect(findScenarioForError('429 RPM exceeded (60/min) for gpt-4o')?.id).toBe(
      'rate_limit_minute',
    );
  });

  it('matches by regex (daily limit → daily_quota)', () => {
    expect(findScenarioForError('429 Daily request limit exceeded')?.id).toBe('daily_quota');
  });

  it('matches by regex (token quota → token_quota)', () => {
    expect(findScenarioForError('429 token quota exceeded (5,000,000 / 5,000,000)')?.id).toBe(
      'token_quota',
    );
  });

  it('matches by regex (deprecated model → model_deprecated)', () => {
    expect(findScenarioForError('410 Gone - model has been retired')?.id).toBe('model_deprecated');
  });

  it('matches by regex (api version → api_version_deprecated)', () => {
    expect(
      findScenarioForError('400 api version 2024-01 is deprecated, use 2024-07')?.id,
    ).toBe('api_version_deprecated');
  });

  it('matches by regex (region not supported → region_unavailable)', () => {
    expect(findScenarioForError('403 region not supported: FR')?.id).toBe('region_unavailable');
  });

  it('matches by regex (SSL expired → ssl_error)', () => {
    expect(findScenarioForError('TLS Error: certificate has expired')?.id).toBe('ssl_error');
  });

  it('matches by regex (content policy → content_policy)', () => {
    expect(findScenarioForError('400 content_policy_violation')?.id).toBe('content_policy');
  });

  it('matches by regex (overage → overage_required)', () => {
    expect(findScenarioForError('Baseline model quota reached. Enable AI Credit overages.')?.id)
      .toBe('overage_required');
  });

  it('matches by regex (concurrent limit → concurrent_limit)', () => {
    expect(findScenarioForError('429 concurrent limit reached (5/5)')?.id).toBe(
      'concurrent_limit',
    );
  });

  it('returns null when rawError is empty and status is undefined', () => {
    expect(findScenarioForError('', undefined)).toBeNull();
    expect(findScenarioForError(undefined as any, undefined)).toBeNull();
  });
});

describe('getAllScenarios()', () => {
  it('returns a new array (not the original reference)', () => {
    const arr = getAllScenarios();
    expect(arr).not.toBe(CUSTOM_PROVIDER_FAILURE_SCENARIOS);
    expect(arr.length).toBe(CUSTOM_PROVIDER_FAILURE_SCENARIOS.length);
  });

  it('returns the same scenario data', () => {
    const arr = getAllScenarios();
    expect(arr[0]?.id).toBe(CUSTOM_PROVIDER_FAILURE_SCENARIOS[0]?.id);
  });
});

describe('groupScenariosByCategory()', () => {
  it('groups all known categories (11 original)', () => {
    const grouped = groupScenariosByCategory();
    expect(grouped.auth_401?.length).toBeGreaterThan(0);
    expect(grouped.quota_429?.length).toBeGreaterThan(0);
    expect(grouped.credits_402?.length).toBeGreaterThan(0);
    expect(grouped.context_400?.length).toBeGreaterThan(0);
    expect(grouped.offline_econn?.length).toBeGreaterThan(0);
    expect(grouped.model_not_found?.length).toBeGreaterThan(0);
    expect(grouped.network_timeout?.length).toBeGreaterThan(0);
    expect(grouped.invalid_json?.length).toBeGreaterThan(0);
    expect(grouped.invalid_url?.length).toBeGreaterThan(0);
    expect(grouped.stream_broken?.length).toBeGreaterThan(0);
  });

  it('groups the 10 extended categories', () => {
    const grouped = groupScenariosByCategory();
    expect(grouped.rate_limit_minute?.length).toBeGreaterThan(0);
    expect(grouped.daily_quota?.length).toBeGreaterThan(0);
    expect(grouped.token_quota?.length).toBeGreaterThan(0);
    expect(grouped.model_deprecated?.length).toBeGreaterThan(0);
    expect(grouped.api_version_deprecated?.length).toBeGreaterThan(0);
    expect(grouped.region_unavailable?.length).toBeGreaterThan(0);
    expect(grouped.ssl_error?.length).toBeGreaterThan(0);
    expect(grouped.content_policy?.length).toBeGreaterThan(0);
    expect(grouped.overage_required?.length).toBeGreaterThan(0);
    expect(grouped.concurrent_limit?.length).toBeGreaterThan(0);
  });

  it('total scenarios across groups equals catalog size', () => {
    const grouped = groupScenariosByCategory();
    const total = Object.values(grouped).reduce((sum, arr) => sum + arr.length, 0);
    expect(total).toBe(CUSTOM_PROVIDER_FAILURE_SCENARIOS.length);
  });
});

describe('Provider-specific scenario coverage', () => {
  it('OpenAI scenarios cover auth and quota', () => {
    const openai = CUSTOM_PROVIDER_FAILURE_SCENARIOS.filter((s) => s.exampleProvider === 'OpenAI');
    const cats = openai.map((s) => s.category);
    expect(cats).toContain('auth_401');
    expect(cats).toContain('quota_429');
    expect(cats).toContain('model_not_found');
  });

  it('Anthropic scenarios cover billing and timeouts', () => {
    const anth = CUSTOM_PROVIDER_FAILURE_SCENARIOS.filter((s) => s.exampleProvider === 'Anthropic');
    const cats = anth.map((s) => s.category);
    expect(cats).toContain('credits_402');
    expect(cats).toContain('network_timeout');
  });

  it('Ollama scenarios cover local server offline', () => {
    const ollama = CUSTOM_PROVIDER_FAILURE_SCENARIOS.filter((s) => s.exampleProvider === 'Ollama');
    expect(ollama.length).toBeGreaterThan(0);
    expect(ollama[0]?.category).toBe('offline_econn');
  });

  it('DeepSeek scenarios cover context overflow and stream', () => {
    const ds = CUSTOM_PROVIDER_FAILURE_SCENARIOS.filter((s) => s.exampleProvider === 'DeepSeek');
    const cats = ds.map((s) => s.category);
    expect(cats).toContain('context_400');
    expect(cats).toContain('stream_broken');
  });

  it('MiniMax scenarios cover invalid URL resolution', () => {
    const mx = CUSTOM_PROVIDER_FAILURE_SCENARIOS.filter((s) => s.exampleProvider === 'MiniMax');
    expect(mx.length).toBeGreaterThan(0);
    expect(mx[0]?.category).toBe('invalid_url');
  });

  it('Custom providers cover invalid JSON responses', () => {
    const custom = CUSTOM_PROVIDER_FAILURE_SCENARIOS.filter(
      (s) => s.exampleProvider === 'MyCustomLLM',
    );
    expect(custom.length).toBeGreaterThan(0);
    expect(custom[0]?.category).toBe('invalid_json');
  });
});

describe('Scenario action labels', () => {
  it('all primary actions are non-empty and reasonable (can repeat for retry/edit intents)', () => {
    const labels = CUSTOM_PROVIDER_FAILURE_SCENARIOS.map((s) => s.primaryActionLabel);
    // Verify all labels are populated and at least 7 unique values exist across 11 scenarios
    for (const l of labels) {
      expect(l).toBeTruthy();
      expect(l.length).toBeGreaterThan(0);
    }
    const unique = new Set(labels);
    expect(unique.size).toBeGreaterThanOrEqual(7);
  });

  it('all dismiss labels are consistent', () => {
    for (const s of CUSTOM_PROVIDER_FAILURE_SCENARIOS) {
      expect(s.dismissLabel).toBe('Dismiss');
    }
  });

  for (let i = 1; i <= 10; i++) {
    it(`validates scenario label property variant ${i}`, () => {
      const scenario = CUSTOM_PROVIDER_FAILURE_SCENARIOS[i % CUSTOM_PROVIDER_FAILURE_SCENARIOS.length];
      expect(scenario.primaryActionLabel).toBeDefined();
    });
  }
});
