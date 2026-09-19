/**
 * Unit tests for `buildModelsUrl()`.
 *
 * Verifies:
 *   - chat-completions → /models
 *   - messages → /v1/models
 *   - root /v1 → /v1/models
 *   - Google generateContent → /models
 *   - trailing slashes are trimmed
 *   - QUERY STRINGS ARE STRIPPED (security: don't leak `?key=...` to /v1/models)
 */
import { describe, it, expect } from 'vitest';
import { buildModelsUrl } from './fetch';

describe('buildModelsUrl', () => {
  it('strips /chat/completions and appends /models', () => {
    expect(buildModelsUrl('https://api.openai.com/v1/chat/completions'))
      .toBe('https://api.openai.com/v1/models');
  });

  it('strips /completions suffix', () => {
    expect(buildModelsUrl('https://api.example.com/v1/completions'))
      .toBe('https://api.example.com/v1/models');
  });

  it('strips /messages for Anthropic', () => {
    expect(buildModelsUrl('https://api.anthropic.com/v1/messages'))
      .toBe('https://api.anthropic.com/v1/models');
  });

  it('appends /v1/models to a /v1 root', () => {
    expect(buildModelsUrl('https://api.openai.com/v1'))
      .toBe('https://api.openai.com/v1/models');
  });

  it('appends /v1/models to a bare host', () => {
    expect(buildModelsUrl('https://api.openai.com'))
      .toBe('https://api.openai.com/v1/models');
  });

  it('trims trailing slashes', () => {
    expect(buildModelsUrl('https://api.openai.com/v1/'))
      .toBe('https://api.openai.com/v1/models');
  });

  it('handles Ollama-style local host', () => {
    expect(buildModelsUrl('http://localhost:11434/v1/chat/completions'))
      .toBe('http://localhost:11434/v1/models');
  });

  it('handles Google generateContent paths', () => {
    expect(
      buildModelsUrl(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent',
      ),
    ).toBe('https://generativelanguage.googleapis.com/v1beta/models');
  });

  it('keeps Google-style /v1beta/models paths intact', () => {
    expect(buildModelsUrl('https://generativelanguage.googleapis.com/v1beta/models'))
      .toBe('https://generativelanguage.googleapis.com/v1beta/models');
    expect(buildModelsUrl('https://generativelanguage.googleapis.com/v1beta'))
      .toBe('https://generativelanguage.googleapis.com/v1beta/models');
  });

  it('strips query strings — security: do NOT leak API keys in the URL to /v1/models', () => {
    expect(buildModelsUrl('https://api.openai.com/v1/chat/completions?key=sk-test'))
      .toBe('https://api.openai.com/v1/models');
    expect(buildModelsUrl('https://api.openai.com/v1?token=tok_xyz'))
      .toBe('https://api.openai.com/v1/models');
  });

  it('preserves case-insensitive matching', () => {
    expect(buildModelsUrl('https://API.OpenAI.com/v1/CHAT/COMPLETIONS'))
      .toBe('https://API.OpenAI.com/v1/models');
  });
});