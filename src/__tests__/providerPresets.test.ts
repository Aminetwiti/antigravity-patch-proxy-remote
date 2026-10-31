import { describe, it, expect } from 'vitest';
import { DETAILED_PROVIDER_PRESETS, PROVIDERS } from '../constants';

describe('DETAILED_PROVIDER_PRESETS', () => {
  it('contains expected core providers', () => {
    const providerIds = DETAILED_PROVIDER_PRESETS.map((p) => p.id);
    expect(providerIds).toContain(PROVIDERS.OPENAI);
    expect(providerIds).toContain(PROVIDERS.DEEPSEEK);
    expect(providerIds).toContain(PROVIDERS.OPENROUTER);
    expect(providerIds).toContain(PROVIDERS.OLLAMA);
    expect(providerIds).toContain(PROVIDERS.GROQ);
    expect(providerIds).toContain(PROVIDERS.ANTHROPIC);
  });

  it('has valid default URLs and non-empty suggested models', () => {
    for (const preset of DETAILED_PROVIDER_PRESETS) {
      expect(preset.id).toBeTruthy();
      expect(preset.label).toBeTruthy();
      expect(preset.defaultApiUrl.startsWith('http')).toBe(true);
      expect(preset.suggestedModels.length).toBeGreaterThan(0);
      for (const m of preset.suggestedModels) {
        expect(m.id).toBeTruthy();
        expect(m.displayName).toBeTruthy();
      }
    }
  });
});
