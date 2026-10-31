/**
 * Unit tests for provider resolution helpers.
 * Run with: `npx vitest run src/commands/models/providers.test.ts`
 */

import { describe, expect, it } from 'vitest';
import { resolveProvider, suggestProvider } from './providers';

describe('resolveProvider', () => {
  it('resolves canonical providers', () => {
    expect(resolveProvider('openai')).toEqual({ provider: 'openai', wasAlias: false });
    expect(resolveProvider('kimchi')).toEqual({ provider: 'kimchi', wasAlias: false });
  });

  it('is case-insensitive', () => {
    expect(resolveProvider('OpenAI')).toEqual({ provider: 'openai', wasAlias: false });
    expect(resolveProvider('KIMCHI')).toEqual({ provider: 'kimchi', wasAlias: false });
  });

  it('resolves aliases', () => {
    expect(resolveProvider('moonshot')).toEqual({ provider: 'kimi', wasAlias: true });
    expect(resolveProvider('kimi-k2')).toEqual({ provider: 'kimi', wasAlias: true });
    expect(resolveProvider('llm.kimchi.dev')).toEqual({ provider: 'kimchi', wasAlias: true });
  });

  it('returns null for unknown providers', () => {
    expect(resolveProvider('foobar')).toBeNull();
    expect(resolveProvider('')).toBeNull();
  });
});

describe('suggestProvider', () => {
  it('suggests prefix matches', () => {
    expect(suggestProvider('kimi')).toBe('kimi');
    expect(suggestProvider('open')).toBe('openai');
  });

  it('suggests aliases', () => {
    expect(suggestProvider('moon')).toBe('moonshot');
  });

  it('suggests based on input prefix too', () => {
    expect(suggestProvider('kimi-k2.5')).toBe('kimi');
  });

  it('returns undefined when nothing matches', () => {
    expect(suggestProvider('xyz')).toBeUndefined();
  });
});
