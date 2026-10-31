import { describe, it, expect } from 'vitest';
import { PROVIDER_PRESETS, getProviderDefaultUrl } from './providers';

describe('ag-doctor-ui Provider Presets Registry', () => {
  it('contains essential LLM providers', () => {
    expect(PROVIDER_PRESETS.openai).toBeDefined();
    expect(PROVIDER_PRESETS.anthropic).toBeDefined();
    expect(PROVIDER_PRESETS.ollama).toBeDefined();
    expect(PROVIDER_PRESETS.groq).toBeDefined();
    expect(PROVIDER_PRESETS.deepseek).toBeDefined();
  });

  it('resolves default URLs accurately', () => {
    expect(getProviderDefaultUrl('openai')).toBe('https://api.openai.com/v1');
    expect(getProviderDefaultUrl('anthropic')).toBe('https://api.anthropic.com/v1');
    expect(getProviderDefaultUrl('ollama')).toBe('http://localhost:11434');
    expect(getProviderDefaultUrl('unknown_provider')).toBe('https://api.openai.com/v1');
  });
});
