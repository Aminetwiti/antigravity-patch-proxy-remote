import { describe, it, expect } from 'vitest';
import {
  resolveProvider,
  resolveCustomModelUrl,
  resolveMaxRetries,
  resolveRequestTimeout,
  getBaseModelId,
} from '../proxy/urlBuilder';
import type { CustomModel } from '../proxy/types';


const baseModel: CustomModel = {
  name: 'gpt-4o',
  displayName: 'GPT-4o',
  provider: 'openai',
  apiKey: 'sk-test',
  apiUrl: 'https://api.openai.com/v1',
  externalModelName: 'gpt-4o',
};

describe('resolveProvider', () => {
  it('returns openai for provider=openai', () => {
    expect(resolveProvider({ ...baseModel, provider: 'openai' })).toBe('openai');
  });

  it('maps custom to openai', () => {
    expect(resolveProvider({ ...baseModel, provider: 'custom' })).toBe('openai');
  });

  it('maps openrouter to openai', () => {
    expect(resolveProvider({ ...baseModel, provider: 'openrouter' })).toBe('openai');
  });

  it('returns anthropic unchanged', () => {
    expect(resolveProvider({ ...baseModel, provider: 'anthropic' })).toBe('anthropic');
  });

  it('returns ollama unchanged', () => {
    expect(resolveProvider({ ...baseModel, provider: 'ollama' })).toBe('ollama');
  });

  it('returns google unchanged', () => {
    expect(resolveProvider({ ...baseModel, provider: 'google' })).toBe('google');
  });
});

describe('resolveCustomModelUrl', () => {
  const noopUrlBuilder = (
    apiUrl: string,
    _externalModelName: string,
    _isStream: boolean,
    _translator: unknown,
  ): string => apiUrl;

  describe('openai / custom / openrouter providers', () => {
    it('appends /chat/completions when URL ends with /v1', () => {
      const url = resolveCustomModelUrl(
        { ...baseModel, provider: 'openai', apiUrl: 'https://api.openai.com/v1' },
        false,
        noopUrlBuilder,
      );
      expect(url).toBe('https://api.openai.com/v1/chat/completions');
    });

    it('appends /chat/completions when URL ends with /v1/', () => {
      const url = resolveCustomModelUrl(
        { ...baseModel, provider: 'openai', apiUrl: 'https://api.openai.com/v1/' },
        false,
        noopUrlBuilder,
      );
      expect(url).toBe('https://api.openai.com/v1/chat/completions');
    });

    it('appends /v1/chat/completions when URL has no path', () => {
      const url = resolveCustomModelUrl(
        { ...baseModel, provider: 'openai', apiUrl: 'https://api.openai.com' },
        false,
        noopUrlBuilder,
      );
      expect(url).toBe('https://api.openai.com/v1/chat/completions');
    });

    it('appends v1/chat/completions when URL ends with /', () => {
      const url = resolveCustomModelUrl(
        { ...baseModel, provider: 'openai', apiUrl: 'https://api.openai.com/' },
        false,
        noopUrlBuilder,
      );
      expect(url).toBe('https://api.openai.com/v1/chat/completions');
    });

    it('does not modify URL when it already contains /chat/completions', () => {
      const url = resolveCustomModelUrl(
        {
          ...baseModel,
          provider: 'openai',
          apiUrl: 'https://api.openai.com/v1/chat/completions',
        },
        false,
        noopUrlBuilder,
      );
      expect(url).toBe('https://api.openai.com/v1/chat/completions');
    });

    it('does not modify URL when it already contains /completions', () => {
      const url = resolveCustomModelUrl(
        {
          ...baseModel,
          provider: 'openai',
          apiUrl: 'https://api.openai.com/v1/completions',
        },
        false,
        noopUrlBuilder,
      );
      expect(url).toBe('https://api.openai.com/v1/completions');
    });

    it('handles custom provider by mapping to openai URL rules', () => {
      const url = resolveCustomModelUrl(
        { ...baseModel, provider: 'custom', apiUrl: 'https://my-llm.example.com' },
        false,
        noopUrlBuilder,
      );
      expect(url).toBe('https://my-llm.example.com/v1/chat/completions');
    });

    it('handles openrouter provider by mapping to openai URL rules', () => {
      const url = resolveCustomModelUrl(
        { ...baseModel, provider: 'openrouter', apiUrl: 'https://openrouter.ai/api/v1' },
        false,
        noopUrlBuilder,
      );
      expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    });

    it('is case-insensitive when checking URL contents', () => {
      const url = resolveCustomModelUrl(
        { ...baseModel, provider: 'openai', apiUrl: 'https://api.openai.com/V1/CHAT/COMPLETIONS' },
        false,
        noopUrlBuilder,
      );
      expect(url).toBe('https://api.openai.com/V1/CHAT/COMPLETIONS');
    });

    it('deduplicates double /v1/v1 in custom model API URLs', () => {
      const urlWithDuplicate = resolveCustomModelUrl(
        { ...baseModel, provider: 'openai', apiUrl: 'https://api.example.com/v1/v1/chat/completions' },
        false,
        noopUrlBuilder,
      );
      expect(urlWithDuplicate).toBe('https://api.example.com/v1/chat/completions');

      const urlBaseDuplicate = resolveCustomModelUrl(
        { ...baseModel, provider: 'openai', apiUrl: 'https://api.example.com/v1/v1' },
        false,
        noopUrlBuilder,
      );
      expect(urlBaseDuplicate).toBe('https://api.example.com/v1/chat/completions');
    });
  });

  describe('google / ollama providers', () => {
    it('delegates to getProviderUrl for google', () => {
      const delegate = (
        apiUrl: string,
        externalModelName: string,
        isStream: boolean,
        _translator: unknown,
      ): string => `${apiUrl}?model=${externalModelName}&stream=${isStream}`;

      const url = resolveCustomModelUrl(
        {
          ...baseModel,
          provider: 'google',
          apiUrl: 'https://generativelanguage.googleapis.com',
          externalModelName: 'gemini-pro',
        },
        true,
        delegate,
      );
      expect(url).toBe('https://generativelanguage.googleapis.com?model=gemini-pro&stream=true');
    });

    it('delegates to getProviderUrl for ollama', () => {
      const delegate = (
        apiUrl: string,
        externalModelName: string,
        isStream: boolean,
        _translator: unknown,
      ): string => `${apiUrl}/${externalModelName}?stream=${isStream}`;

      const url = resolveCustomModelUrl(
        {
          ...baseModel,
          provider: 'ollama',
          apiUrl: 'http://localhost:11434',
          externalModelName: 'llama3',
        },
        false,
        delegate,
      );
      expect(url).toBe('http://localhost:11434/llama3?stream=false');
    });
  });

  describe('other providers', () => {
    it('returns apiUrl unchanged for anthropic', () => {
      const url = resolveCustomModelUrl(
        { ...baseModel, provider: 'anthropic', apiUrl: 'https://api.anthropic.com/v1/messages' },
        false,
        noopUrlBuilder,
      );
      expect(url).toBe('https://api.anthropic.com/v1/messages');
    });
  });
});

describe('resolveMaxRetries', () => {
  it('defaults to 1 when undefined (retry-storm prevention)', () => {
    expect(resolveMaxRetries(baseModel)).toBe(1);
  });

  it('uses provided value', () => {
    expect(resolveMaxRetries({ ...baseModel, maxRetries: 5 })).toBe(5);
  });

  it('clamps to 0 when negative', () => {
    expect(resolveMaxRetries({ ...baseModel, maxRetries: -1 })).toBe(0);
  });

  it('clamps to 5 when too large', () => {
    expect(resolveMaxRetries({ ...baseModel, maxRetries: 10 })).toBe(5);
  });

  it('returns 0 when explicitly set to 0', () => {
    expect(resolveMaxRetries({ ...baseModel, maxRetries: 0 })).toBe(0);
  });

  it('returns 5 when explicitly set to 5', () => {
    expect(resolveMaxRetries({ ...baseModel, maxRetries: 5 })).toBe(5);
  });
});

describe('resolveRequestTimeout', () => {
  it('defaults to 30_000 ms when undefined (proxy saturation guard)', () => {
    expect(resolveRequestTimeout(baseModel)).toBe(30_000);
  });

  it('uses provided timeout', () => {
    expect(resolveRequestTimeout({ ...baseModel, timeout: 60_000 })).toBe(60_000);
  });

  it('falls back to default when timeout is 0 (falsy)', () => {
    expect(resolveRequestTimeout({ ...baseModel, timeout: 0 })).toBe(30_000);
  });

  it('handles large timeout values', () => {
    expect(resolveRequestTimeout({ ...baseModel, timeout: 600_000 })).toBe(600_000);
  });
});

describe('getBaseModelId', () => {
  it('strips anchor variants starting with #', () => {
    expect(getBaseModelId('claude-3-5-sonnet#thinking')).toBe('claude-3-5-sonnet');
    expect(getBaseModelId('gpt-4o#flex')).toBe('gpt-4o');
    expect(getBaseModelId('gemini-2.0-flash#search')).toBe('gemini-2.0-flash');
  });

  it('returns clean model IDs unchanged', () => {
    expect(getBaseModelId('gpt-4o')).toBe('gpt-4o');
    expect(getBaseModelId('claude-3-5-sonnet-20241022')).toBe('claude-3-5-sonnet-20241022');
  });

  it('handles empty string or missing input gracefully', () => {
    expect(getBaseModelId('')).toBe('');
  });
});

describe('useRawBaseUrl option', () => {
  it('returns exact apiUrl as-is when useRawBaseUrl is true', () => {
    const noopUrlBuilder = (url: string) => url;
    const url = resolveCustomModelUrl(
      { ...baseModel, provider: 'openai', apiUrl: 'http://localhost:1234/custom/v1/chat', useRawBaseUrl: true },
      false,
      noopUrlBuilder,
    );
    expect(url).toBe('http://localhost:1234/custom/v1/chat');
  });
});

