import { describe, it, expect } from 'vitest';
import {
  validateCustomModel,
  validateCustomModels,
  validateGenerateContentResponse,
  validateCloudCodeEnvelope,
  validateGenerateContentRequest,
  validateOpenAiChunk,
  validateAnthropicEvent,
  validateCandidate,
  normalizeModelName,
} from '../schemaValidator';

describe('normalizeModelName', () => {
  it('re-exports modelIdUtils.normalizeModelId', () => {
    expect(normalizeModelName('GPT-4o')).toBe('gpt-4o');
    expect(normalizeModelName('claude 3.5 sonnet')).toBe('claude-3-5-sonnet');
    expect(normalizeModelName('models/gpt-4o')).toBe('gpt-4o');
  });

  it('returns empty string on empty input', () => {
    expect(normalizeModelName('')).toBe('');
  });
});

describe('validateCandidate', () => {
  it('accepts a valid candidate', () => {
    expect(
      validateCandidate({
        content: {
          parts: [{ text: 'hello' }],
          role: 'model',
        },
        finishReason: 'STOP',
      }).valid,
    ).toBe(true);
  });

  it('rejects null', () => {
    expect(validateCandidate(null).valid).toBe(false);
  });

  it('rejects non-object', () => {
    expect(validateCandidate('hello').valid).toBe(false);
  });

  it('rejects missing content', () => {
    expect(validateCandidate({}).valid).toBe(false);
  });

  it('rejects missing parts array', () => {
    expect(
      validateCandidate({
        content: { role: 'model' },
      }).valid,
    ).toBe(false);
  });

  it('rejects unknown role', () => {
    expect(
      validateCandidate({
        content: { role: 'user', parts: [] },
      }).valid,
    ).toBe(false);
  });

  it('rejects non-string finishReason', () => {
    expect(
      validateCandidate({
        content: { parts: [] },
        finishReason: 42,
      }).valid,
    ).toBe(false);
  });
});

describe('validateGenerateContentResponse', () => {
  it('accepts a valid response', () => {
    expect(
      validateGenerateContentResponse({
        candidates: [{ content: { parts: [] } }],
      }).valid,
    ).toBe(true);
  });

  it('rejects empty candidates', () => {
    expect(validateGenerateContentResponse({ candidates: [] }).valid).toBe(false);
  });

  it('rejects missing candidates', () => {
    expect(validateGenerateContentResponse({}).valid).toBe(false);
  });

  it('propagates candidate error with index', () => {
    const result = validateGenerateContentResponse({
      candidates: [{ content: { parts: [] } }, { content: { parts: 'oops' } }],
    });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Candidate\[1\]/);
  });
});

describe('validateCloudCodeEnvelope', () => {
  it('accepts a valid envelope', () => {
    expect(
      validateCloudCodeEnvelope({
        response: { candidates: [{ content: { parts: [] } }] },
        traceId: 'abc',
      }).valid,
    ).toBe(true);
  });

  it('rejects missing response', () => {
    expect(validateCloudCodeEnvelope({}).valid).toBe(false);
  });

  it('rejects malformed response', () => {
    expect(validateCloudCodeEnvelope({ response: {} }).valid).toBe(false);
  });
});

describe('validateCustomModel', () => {
  const baseModel = {
    name: 'models/gpt-4o',
    provider: 'openai',
    apiUrl: 'https://api.openai.com/v1',
  };

  it('accepts a valid model', () => {
    const result = validateCustomModel({ ...baseModel });
    expect(result.valid).toBe(true);
    expect((baseModel as Record<string, unknown>).normalizedName).toBeUndefined();
  });

  it('attaches normalizedName on success', () => {
    const m = { ...baseModel } as Record<string, unknown>;
    validateCustomModel(m);
    expect(m.normalizedName).toBe('gpt-4o');
  });

  it('normalizes free-form names', () => {
    const m = {
      name: 'GPT-4o',
      provider: 'openai',
      apiUrl: 'https://api.openai.com/v1',
    } as Record<string, unknown>;
    expect(validateCustomModel(m).valid).toBe(true);
    expect(m.normalizedName).toBe('gpt-4o');
  });

  it('normalizes names with spaces', () => {
    const m = {
      name: 'claude 3.5 sonnet',
      provider: 'anthropic',
      apiUrl: 'https://api.anthropic.com/v1',
    } as Record<string, unknown>;
    expect(validateCustomModel(m).valid).toBe(true);
    expect(m.normalizedName).toBe('claude-3-5-sonnet');
  });

  it('strips "models/" prefix when normalizing', () => {
    const m = {
      name: 'models/gpt-4o',
      provider: 'openai',
      apiUrl: 'https://api.openai.com/v1',
    } as Record<string, unknown>;
    expect(validateCustomModel(m).valid).toBe(true);
    expect(m.normalizedName).toBe('gpt-4o');
  });

  it('rejects invalid provider', () => {
    const result = validateCustomModel({
      name: 'models/gpt-4o',
      provider: 'not-a-provider',
      apiUrl: 'https://api.openai.com/v1',
    });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Unsupported provider/);
  });

  it('rejects invalid API URL', () => {
    const result = validateCustomModel({
      name: 'models/gpt-4o',
      provider: 'openai',
      apiUrl: 'not a url',
    });
    expect(result.valid).toBe(false);
  });

  it('rejects non-https URL', () => {
    const result = validateCustomModel({
      name: 'models/gpt-4o',
      provider: 'openai',
      apiUrl: 'ftp://example.com',
    });
    expect(result.valid).toBe(false);
  });

  it('rejects missing required fields', () => {
    expect(validateCustomModel({ name: 'models/gpt-4o', provider: 'openai' }).valid).toBe(false);
    expect(validateCustomModel({ name: 'models/gpt-4o', apiUrl: 'https://x' }).valid).toBe(false);
    expect(validateCustomModel({ provider: 'openai', apiUrl: 'https://x' }).valid).toBe(false);
  });

  it('rejects empty optional fields of wrong type', () => {
    expect(
      validateCustomModel({
        name: 'models/gpt-4o',
        provider: 'openai',
        apiUrl: 'https://api.openai.com/v1',
        externalModelName: 42,
      }).valid,
    ).toBe(false);
  });

  it('rejects name that normalizes to empty', () => {
    expect(
      validateCustomModel({
        name: '   ',
        provider: 'openai',
        apiUrl: 'https://api.openai.com/v1',
      }).valid,
    ).toBe(false);
  });

  it('rejects tiny non-path names', () => {
    expect(
      validateCustomModel({
        name: 'a',
        provider: 'openai',
        apiUrl: 'https://api.openai.com/v1',
      }).valid,
    ).toBe(false);
  });

  it('accepts allowUnauthorized boolean', () => {
    expect(
      validateCustomModel({
        name: 'models/gpt-4o',
        provider: 'openai',
        apiUrl: 'https://api.openai.com/v1',
        allowUnauthorized: true,
      }).valid,
    ).toBe(true);
  });

  it('rejects allowUnauthorized of wrong type', () => {
    expect(
      validateCustomModel({
        name: 'models/gpt-4o',
        provider: 'openai',
        apiUrl: 'https://api.openai.com/v1',
        allowUnauthorized: 'yes',
      }).valid,
    ).toBe(false);
  });
});

describe('validateCustomModels', () => {
  it('accepts an array of valid models', () => {
    expect(
      validateCustomModels([
        {
          name: 'models/gpt-4o',
          provider: 'openai',
          apiUrl: 'https://api.openai.com/v1',
        },
        {
          name: 'models/claude-3-5-sonnet',
          provider: 'anthropic',
          apiUrl: 'https://api.anthropic.com/v1',
        },
      ]).valid,
    ).toBe(true);
  });

  it('rejects non-array', () => {
    expect(validateCustomModels('hello').valid).toBe(false);
  });

  it('rejects when any model is invalid (with index)', () => {
    const result = validateCustomModels([
      {
        name: 'models/gpt-4o',
        provider: 'openai',
        apiUrl: 'https://api.openai.com/v1',
      },
      {
        name: 'models/gpt-4o',
        provider: 'not-a-provider',
        apiUrl: 'https://api.openai.com/v1',
      },
    ]);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Model\[1\]/);
  });
});

describe('validateGenerateContentRequest', () => {
  it('accepts a valid request', () => {
    expect(
      validateGenerateContentRequest({
        contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
      }).valid,
    ).toBe(true);
  });

  it('rejects empty contents', () => {
    expect(validateGenerateContentRequest({ contents: [] }).valid).toBe(false);
  });

  it('rejects non-array contents', () => {
    expect(validateGenerateContentRequest({ contents: 'hi' }).valid).toBe(false);
  });

  it('rejects non-object generationConfig', () => {
    expect(
      validateGenerateContentRequest({
        contents: [{ role: 'user', parts: [] }],
        generationConfig: 'fast',
      }).valid,
    ).toBe(false);
  });

  it('rejects non-array tools', () => {
    expect(
      validateGenerateContentRequest({
        contents: [{ role: 'user', parts: [] }],
        tools: 'not-array',
      }).valid,
    ).toBe(false);
  });
});

describe('validateOpenAiChunk', () => {
  it('accepts a valid chunk', () => {
    expect(
      validateOpenAiChunk({
        choices: [{ delta: { content: 'hi' } }],
      }).valid,
    ).toBe(true);
  });

  it('rejects missing choices', () => {
    expect(validateOpenAiChunk({}).valid).toBe(false);
  });

  it('rejects non-array choices', () => {
    expect(validateOpenAiChunk({ choices: 'oops' }).valid).toBe(false);
  });
});

describe('validateAnthropicEvent', () => {
  it('accepts known event types', () => {
    for (const type of [
      'message_start',
      'content_block_start',
      'content_block_delta',
      'content_block_stop',
      'message_delta',
      'message_stop',
      'ping',
      'error',
    ]) {
      expect(validateAnthropicEvent({ type }).valid).toBe(true);
    }
  });

  it('rejects missing type', () => {
    expect(validateAnthropicEvent({}).valid).toBe(false);
  });

  it('rejects unknown event type', () => {
    expect(validateAnthropicEvent({ type: 'message_bogus' }).valid).toBe(false);
  });
});
