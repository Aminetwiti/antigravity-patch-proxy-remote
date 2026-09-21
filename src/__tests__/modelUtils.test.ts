import { describe, it, expect } from 'vitest';
import { detectModelCapabilities, detectModelCapabilitiesByName, detectModelUXBadges } from '../proxy/modelUtils';


describe('detectModelCapabilities', () => {
  it.each([
    [
      { name: 'claude-3-5-sonnet', provider: 'anthropic' },
      { isThinking: true, isClaude: true, maxTokens: 200_000, maxOutputTokens: 32_768 },
    ],
    [
      { name: 'gpt-4o', provider: 'openai' },
      { isThinking: true, isClaude: false },
    ],
    [
      { name: 'openai/gpt-4o', provider: 'openrouter' },
      { isThinking: true, isClaude: false, maxTokens: 1_048_576 },
    ],
    [
      { name: 'deepseek-r1', provider: 'ollama', externalModelName: 'deepseek-r1' },
      { isThinking: true, isDeepSeek: true, maxOutputTokens: 32_768 },
    ],
    [
      { name: 'o1-preview', provider: 'openai' },
      { isThinking: true },
    ],
    [
      { name: 'claude-sonnet-4', provider: 'anthropic' },
      { isThinking: true },
    ],
    [
      { name: 'llama3', provider: 'ollama' },
      { isThinking: false, isDeepSeek: false, isClaude: false, maxTokens: 1_048_576, maxOutputTokens: 16_384 },
    ],
    [
      { name: 'some-unknown-model', provider: 'anthropic' },
      { isClaude: true },
    ],
    [
      { name: 'claude-haiku', provider: 'custom' },
      { isClaude: true },
    ],
  ])('detects capabilities for %j', (input, expected) => {
    const result = detectModelCapabilities(input as any);
    for (const [key, val] of Object.entries(expected)) {
      expect((result as any)[key]).toBe(val);
    }
  });

  it('detects deepseek by name', () => {
    const result = detectModelCapabilities({ name: 'deepseek-v3', provider: 'custom' });
    expect(result.isDeepSeek).toBe(true);
    expect(result.maxOutputTokens).toBe(32_768);
  });

  it('uses displayName for detection when includeDisplayName=true', () => {
    const result = detectModelCapabilities(
      { name: 'models/my-model', provider: 'ollama', displayName: 'DeepSeek R1 - Reasoning' },
      true,
    );
    expect(result.isDeepSeek).toBe(true);
    expect(result.isThinking).toBe(true);
  });

  it('skips displayName when includeDisplayName=false', () => {
    const result = detectModelCapabilities(
      { name: 'models/my-model', provider: 'ollama', displayName: 'DeepSeek R1 - Reasoning' },
      false,
    );
    expect(result.isDeepSeek).toBe(false);
  });

  it('detects by externalModelName', () => {
    const result = detectModelCapabilities({
      name: 'custom-model',
      provider: 'openrouter',
      externalModelName: 'anthropic/claude-3.5-sonnet',
    });
    expect(result.isClaude).toBe(true);
  });

  it('detects image support for GLM models like glm-5.3', () => {
    const result = detectModelCapabilities({
      name: 'glm-5.3',
      provider: 'openai',
    });
    expect(result.supportsImages).toBe(true);
  });

  it('honors explicit supportsImages or supportsVision override', () => {
    const forcedYes = detectModelCapabilities({
      name: 'custom-text-model',
      provider: 'ollama',
      supportsImages: true,
    });
    expect(forcedYes.supportsImages).toBe(true);

    const forcedNo = detectModelCapabilities({
      name: 'gpt-4o',
      provider: 'openai',
      supportsImages: false,
    });
    expect(forcedNo.supportsImages).toBe(false);
  });
});

describe('detectModelCapabilitiesByName', () => {
  it('detects claude thinking models', () => {
    const result = detectModelCapabilitiesByName('claude-3-5-sonnet');
    expect(result.isClaudeThinkingModel).toBe(true);
    expect(result.isThinkingModel).toBe(false);
  });

  it('detects claude 4 models as thinking', () => {
    const result = detectModelCapabilitiesByName('claude-sonnet-4-20250514');
    expect(result.isClaudeThinkingModel).toBe(true);
    expect(result.isThinkingModel).toBe(true);
  });

  it('detects opus-4 as thinking', () => {
    const result = detectModelCapabilitiesByName('claude-opus-4');
    expect(result.isClaudeThinkingModel).toBe(true);
    expect(result.isThinkingModel).toBe(true);
  });

  it('returns false for non-claude models', () => {
    const result = detectModelCapabilitiesByName('gpt-4o');
    expect(result.isClaudeThinkingModel).toBe(false);
    expect(result.isThinkingModel).toBe(false);
  });

  it('handles claude-sonnet-4-6 models', () => {
    const result = detectModelCapabilitiesByName('claude-sonnet-4-6');
    expect(result.isClaudeThinkingModel).toBe(true);
    expect(result.isThinkingModel).toBe(true);
  });

  it('handles empty/null input gracefully', () => {
    const result = detectModelCapabilitiesByName('');
    expect(result.isClaudeThinkingModel).toBe(false);
    expect(result.isThinkingModel).toBe(false);
  });
});

describe('detectModelUXBadges', () => {
  it('computes UX badges for cloud models', () => {
    const badges = detectModelUXBadges({ name: 'gpt-4o', provider: 'openai' });
    expect(badges.supportsVision).toBe(true);
    expect(badges.supportsTools).toBe(true);
    expect(badges.supportsThinking).toBe(true);
    expect(badges.isLocal).toBe(false);
    expect(badges.contextWindowLabel).toBe('1M');
  });

  it('computes UX badges for local ollama models', () => {
    const badges = detectModelUXBadges({ name: 'llama3', provider: 'ollama' });
    expect(badges.supportsVision).toBe(false);
    expect(badges.supportsTools).toBe(true);
    expect(badges.isLocal).toBe(true);
    expect(badges.contextWindowLabel).toBe('1M');
  });
});

