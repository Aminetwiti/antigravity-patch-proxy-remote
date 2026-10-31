import { describe, it, expect } from 'vitest';
import { WELL_KNOWN_PRESETS } from '../presets';

describe('Well-Known Presets Catalogue', () => {
  it('contains standard popular providers', () => {
    expect(WELL_KNOWN_PRESETS.length).toBeGreaterThanOrEqual(7);

    const providerIds = WELL_KNOWN_PRESETS.map((p) => p.id);
    expect(providerIds).toContain('openai-preset');
    expect(providerIds).toContain('anthropic-preset');
    expect(providerIds).toContain('openrouter-preset');
    expect(providerIds).toContain('deepseek-preset');
    expect(providerIds).toContain('groq-preset');
    expect(providerIds).toContain('google-ai-studio-preset');
    expect(providerIds).toContain('ollama-preset');
  });

  it('every preset has valid structure and models', () => {
    for (const preset of WELL_KNOWN_PRESETS) {
      expect(preset.id).toBeTruthy();
      expect(preset.name).toBeTruthy();
      expect(preset.category).toMatch(/^(General|Local|Experimental)$/);
      expect(preset.provider).toBeTruthy();
      expect(preset.apiUrl).toMatch(/^https?:\/\//);
      expect(Array.isArray(preset.models)).toBe(true);
    }
  });
});
