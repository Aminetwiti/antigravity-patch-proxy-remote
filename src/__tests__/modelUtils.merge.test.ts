import { describe, it, expect } from 'vitest';
import {
  mergeModelCapabilities,
  resolveDefaultMode,
  modelHasReasoningCapability,
  type ModelModeConfig,
} from '../proxy/modelUtils';

function baseModel(overrides: Partial<ModelModeConfig> = {}): ModelModeConfig {
  return {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    supportsReasoning: false,
    supportsImages: true,
    maxOutputTokens: 16_384,
    maxTokens: 1_048_576,
    supportedReasoningEfforts: undefined,
    supportedThinkingBudgets: undefined,
    defaultMode: undefined,
    ...overrides,
  };
}

describe('mergeModelCapabilities', () => {
  it('OR-combines reasoning and AND-combines image support', () => {
    const merged = mergeModelCapabilities(
      baseModel({ supportsReasoning: false, supportsImages: true }),
      baseModel({ supportsReasoning: true, supportsImages: false }),
    );
    expect(merged.supportsReasoning).toBe(true);
    expect(merged.supportsImages).toBe(false);
  });

  it('takes the larger of maxTokens/maxOutputTokens', () => {
    const merged = mergeModelCapabilities(
      baseModel({ maxTokens: 64_000, maxOutputTokens: 8_000 }),
      baseModel({ maxTokens: 200_000, maxOutputTokens: 16_000 }),
    );
    expect(merged.maxTokens).toBe(200_000);
    expect(merged.maxOutputTokens).toBe(16_000);
  });

  it('unions supportedReasoningEfforts preserving order', () => {
    const merged = mergeModelCapabilities(
      baseModel({ supportedReasoningEfforts: ['low', 'medium'] }),
      baseModel({ supportedReasoningEfforts: ['medium', 'high'] }),
    );
    expect(merged.supportedReasoningEfforts).toEqual(['low', 'medium', 'high']);
  });

  it('unions supportedThinkingBudgets preserving order', () => {
    const merged = mergeModelCapabilities(
      baseModel({ supportedThinkingBudgets: ['auto'] }),
      baseModel({ supportedThinkingBudgets: ['enabled', 'disabled'] }),
    );
    expect(merged.supportedThinkingBudgets).toEqual(['auto', 'enabled', 'disabled']);
  });

  it('keeps base.id/name/provider', () => {
    const merged = mergeModelCapabilities(
      baseModel({ id: 'a', name: 'A', provider: 'p1' }),
      baseModel({ id: 'b', name: 'B', provider: 'p2' }),
    );
    expect(merged).toMatchObject({ id: 'a', name: 'A', provider: 'p1' });
  });

  it('prefers base.defaultMode, fallback to override', () => {
    const a = mergeModelCapabilities(
      baseModel({ defaultMode: 'thinking' }),
      baseModel({ defaultMode: 'reasoning' }),
    );
    expect(a.defaultMode).toBe('thinking');

    const b = mergeModelCapabilities(
      baseModel({ defaultMode: undefined }),
      baseModel({ defaultMode: 'reasoning' }),
    );
    expect(b.defaultMode).toBe('reasoning');
  });

  it('returns undefined for empty unions', () => {
    const merged = mergeModelCapabilities(
      baseModel({ supportedReasoningEfforts: undefined }),
      baseModel({ supportedReasoningEfforts: undefined }),
    );
    expect(merged.supportedReasoningEfforts).toBeUndefined();
    expect(merged.supportedThinkingBudgets).toBeUndefined();
  });
});

describe('resolveDefaultMode', () => {
  it('returns defaultMode when set', () => {
    expect(resolveDefaultMode(baseModel({ defaultMode: 'thinking' }))).toBe('thinking');
  });

  it('returns "auto" when reasoning is supported and no default', () => {
    expect(resolveDefaultMode(baseModel({ supportsReasoning: true }))).toBe('auto');
  });

  it('returns "non-thinking" otherwise', () => {
    expect(resolveDefaultMode(baseModel({ supportsReasoning: false }))).toBe('non-thinking');
  });
});

describe('modelHasReasoningCapability', () => {
  it('detects reasoning-like names', () => {
    expect(modelHasReasoningCapability('o1-mini')).toBe(true);
    expect(modelHasReasoningCapability('claude-sonnet-4-6')).toBe(true);
  });

  it('returns false for plain chat models', () => {
    expect(modelHasReasoningCapability('gpt-4o')).toBe(false);
  });
});
