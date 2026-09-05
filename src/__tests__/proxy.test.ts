import { describe, it, expect, vi } from 'vitest';

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

import { parseRetryAfter, matchesCustomModel } from '../proxy';
import { generateModelPlaceholderId, toSlug } from '../proxy/idGenerator';
import { expandModelsWithEffort } from '../proxy/effortExpander';
import { injectCustomSlugsIntoAgentModelSorts } from '../proxy/modelInjector';
import type { CustomModel } from '../proxy/types';

describe('generateModelPlaceholderId', () => {
  it('generates deterministic IDs for the same input', () => {
    const id1 = generateModelPlaceholderId({ name: 'gpt-4o', displayName: 'GPT-4o', apiUrl: 'https://api.openai.com/v1' });
    const id2 = generateModelPlaceholderId({ name: 'gpt-4o', displayName: 'GPT-4o', apiUrl: 'https://api.openai.com/v1' });
    expect(id1).toBe(id2);
  });

  it('produces IDs in the MODEL_PLACEHOLDER_M format', () => {
    const id = generateModelPlaceholderId({ name: 'gpt-4o', apiUrl: 'https://api.openai.com/v1' });
    expect(id).toMatch(/^MODEL_PLACEHOLDER_M\d+$/);
  });

  it('produces different IDs for different models', () => {
    const id1 = generateModelPlaceholderId({ name: 'gpt-4o', apiUrl: 'https://api.openai.com/v1' });
    const id2 = generateModelPlaceholderId({ name: 'claude-3-5-sonnet', apiUrl: 'https://api.anthropic.com/v1' });
    expect(id1).not.toBe(id2);
  });

  it('uses displayName over name', () => {
    const id1 = generateModelPlaceholderId({ name: 'models/gpt-4o', displayName: 'My GPT-4o', apiUrl: 'https://api.openai.com/v1' });
    const id2 = generateModelPlaceholderId({ name: 'models/gpt-4o', displayName: 'Different Name', apiUrl: 'https://api.openai.com/v1' });
    expect(id1).not.toBe(id2);
  });

  it('falls back to name when displayName is missing', () => {
    const id = generateModelPlaceholderId({ name: 'gpt-4o', apiUrl: 'https://api.openai.com/v1' });
    expect(id).toBeTruthy();
  });

  it('falls back to "custom-model" when both name and displayName missing', () => {
    const id = generateModelPlaceholderId({ apiUrl: 'https://api.openai.com/v1' });
    expect(id).toBeTruthy();
  });

  it('placeholder number is within range [400, 599]', () => {
    const id = generateModelPlaceholderId({ name: 'gpt-4o', apiUrl: 'https://api.openai.com/v1' });
    const num = parseInt(id.replace('MODEL_PLACEHOLDER_M', ''), 10);
    expect(num).toBeGreaterThanOrEqual(400);
    expect(num).toBeLessThanOrEqual(599);
  });

  it('lowercases the input before hashing', () => {
    const id1 = generateModelPlaceholderId({ name: 'GPT-4O', apiUrl: 'https://api.openai.com/v1' });
    const id2 = generateModelPlaceholderId({ name: 'gpt-4o', apiUrl: 'https://api.openai.com/v1' });
    expect(id1).toBe(id2);
  });

  it('produces DISTINCT ids for same name but different apiUrls (dropdown collision fix)', () => {
    const id1 = generateModelPlaceholderId({ name: 'gpt-4o', apiUrl: 'https://api.openai.com/v1' });
    const id2 = generateModelPlaceholderId({ name: 'gpt-4o', apiUrl: 'https://api.openai.com/v2' });
    expect(id1).not.toBe(id2);
  });
});

describe('toSlug', () => {
  const apiUrl = 'http://api.test';
  const provider = 'openai';

  it('prefixes with "custom-"', () => {
    const slug = toSlug({ name: 'gpt-4o', apiUrl, provider });
    expect(slug).toMatch(/^custom-/);
  });

  it('includes the sanitized apiUrl before the model name', () => {
    const slug = toSlug({ name: 'gpt-4o', apiUrl, provider });
    expect(slug).toBe('custom-openai-http-api-test-gpt-4o');
  });

  it('keeps "models/" prefix from externalModelName', () => {
    const slug = toSlug({ externalModelName: 'models/gpt-4o', apiUrl, provider });
    expect(slug).toBe('custom-openai-http-api-test-models-gpt-4o');
  });

  it('replaces non-alphanumeric chars with hyphens', () => {
    const slug = toSlug({ name: 'GPT 4o (Latest)', apiUrl, provider });
    expect(slug).toBe('custom-openai-http-api-test-gpt-4o-latest');
  });

  it('removes leading and trailing hyphens', () => {
    const slug = toSlug({ name: '--test--', apiUrl, provider });
    expect(slug).toBe('custom-openai-http-api-test-test');
  });

  it('lowercases the result', () => {
    const slug = toSlug({ name: 'GPT-4O', apiUrl, provider });
    expect(slug).toBe('custom-openai-http-api-test-gpt-4o');
  });

  it('uses externalModelName over name', () => {
    const slug = toSlug({ name: 'gpt-4o', externalModelName: 'openai/gpt-4o', apiUrl, provider });
    expect(slug).toBe('custom-openai-http-api-test-openai-gpt-4o');
  });

  it('handles OpenRouter model format (provider/model)', () => {
    const slug = toSlug({ externalModelName: 'openai/gpt-4o', apiUrl, provider });
    expect(slug).toBe('custom-openai-http-api-test-openai-gpt-4o');
  });

  it('generates distinct slugs for same name with different apiUrls', () => {
    const slug1 = toSlug({ name: 'gpt-4o', apiUrl: 'http://a.com', provider });
    const slug2 = toSlug({ name: 'gpt-4o', apiUrl: 'http://b.com', provider });
    expect(slug1).not.toBe(slug2);
  });
});

describe('parseRetryAfter', () => {
  it('returns 0 when no Retry-After header', () => {
    expect(parseRetryAfter({})).toBe(0);
  });

  it('parses delta-seconds format (integer)', () => {
    expect(parseRetryAfter({ 'retry-after': '120' })).toBe(120_000);
  });

  it('parses delta-seconds with whitespace', () => {
    expect(parseRetryAfter({ 'retry-after': '  60  ' })).toBe(60_000);
  });

  it('returns 0 for negative delta-seconds', () => {
    expect(parseRetryAfter({ 'retry-after': '-5' })).toBe(0);
  });

  it('parses HTTP-date format for future date', () => {
    const futureDate = new Date(Date.now() + 60_000).toUTCString();
    const result = parseRetryAfter({ 'retry-after': futureDate });
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThanOrEqual(61_000); // allow 1s tolerance
  });

  it('returns 0 for past HTTP-date', () => {
    const pastDate = new Date(Date.now() - 60_000).toUTCString();
    expect(parseRetryAfter({ 'retry-after': pastDate })).toBe(0);
  });

  it('handles array value (takes first element)', () => {
    expect(parseRetryAfter({ 'retry-after': ['30', '60'] })).toBe(30_000);
  });

  it('returns 0 for invalid string', () => {
    expect(parseRetryAfter({ 'retry-after': 'not-a-number' })).toBe(0);
  });

  it('returns 0 for empty string', () => {
    expect(parseRetryAfter({ 'retry-after': '' })).toBe(0);
  });
});

describe('agentModelSorts custom slug injection', () => {
  it('injects custom slugs after original models without repeating models', () => {
    const customModels = [
      { name: 'qwen3.8', displayName: 'Qwen 3.8 27B', apiUrl: 'https://api.example.com', provider: 'openai', externalModelName: 'qwen-3.8-27b' },
    ];

    const googleJson: Record<string, unknown> = {
      agentModelSorts: [{ displayName: 'Recommended', groups: [{ modelIds: ['gemini-2.0-flash'] }] }],
    };

    injectCustomSlugsIntoAgentModelSorts(googleJson, customModels as CustomModel[]);

    const sortGroup = (googleJson.agentModelSorts as { groups: { modelIds: string[] }[] }[])[0].groups[0].modelIds;
    // 1. Original model comes first (not displaced by unshift)
    expect(sortGroup[0]).toBe('gemini-2.0-flash');
    // 2. Custom model is appended after
    const expectedSlug = toSlug(customModels[0] as CustomModel);
    expect(sortGroup).toContain(expectedSlug);
    // 3. Exactly one entry per custom model (no duplicate from slug + externalModelName)
    expect(sortGroup.filter((id) => id === expectedSlug).length).toBe(1);
    expect(sortGroup.length).toBe(2);
  });

  it('creates default agentModelSorts structure when upstream does not provide it', () => {
    const customModels = [
      { name: 'gpt-4o', displayName: 'GPT-4o', apiUrl: 'https://api.openai.com/v1', provider: 'openai' },
    ];

    const googleJson: Record<string, unknown> = {};

    injectCustomSlugsIntoAgentModelSorts(googleJson, customModels as CustomModel[]);

    expect(googleJson.agentModelSorts).toBeDefined();
    const sortGroup = (googleJson.agentModelSorts as { groups: { modelIds: string[] }[] }[])[0].groups[0].modelIds;
    expect(sortGroup.length).toBe(1);
    expect(sortGroup[0]).toMatch(/^custom-openai-/);
  });
});

describe('matchesCustomModel', () => {
  const model = {
    name: 'models/MODEL_PLACEHOLDER_M542',
    displayName: 'GPT-5.6 Luna',
    externalModelName: 'gpt-5.6-luna',
    apiUrl: 'https://api.experientiallabs.ai/v1/',
    provider: 'openai' as const,
  };

  it('matches externalModelName (e.g. gpt-5.6-luna)', () => {
    expect(matchesCustomModel(model, 'gpt-5.6-luna')).toBe(true);
    expect(matchesCustomModel(model, 'models/gpt-5.6-luna')).toBe(true);
  });

  it('matches externalModelName case-insensitively', () => {
    expect(matchesCustomModel(model, 'GPT-5.6-Luna')).toBe(true);
  });

  it('matches displayName', () => {
    expect(matchesCustomModel(model, 'GPT-5.6 Luna')).toBe(true);
    expect(matchesCustomModel(model, 'gpt-5.6 luna')).toBe(true);
  });

  it('matches placeholder ID and models/ placeholder ID', () => {
    const pid = generateModelPlaceholderId(model);
    expect(matchesCustomModel(model, pid)).toBe(true);
    expect(matchesCustomModel(model, `models/${pid}`)).toBe(true);
  });

  it('matches generated slug', () => {
    const slug = toSlug(model);
    expect(matchesCustomModel(model, slug)).toBe(true);
  });

  it('does not match unrelated model names', () => {
    expect(matchesCustomModel(model, 'claude-3-5-sonnet')).toBe(false);
    expect(matchesCustomModel(model, 'gemini-2.0-flash')).toBe(false);
  });
});


