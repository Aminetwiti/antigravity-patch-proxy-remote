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

import { parseRetryAfter, matchesCustomModel, sanitizeCandidatesInResponse, transformGoogleStreamForRemote } from '../proxy';
import * as zlib from 'zlib';
import { EventEmitter } from 'events';
import { DEFAULT_MAX_BODY_SIZE } from '../constants';
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
      agentModelSorts: [{ displayName: 'Recommended', groups: [{ modelIds: ['gemini-3.8-flash-tiered'] }] }],
    };

    injectCustomSlugsIntoAgentModelSorts(googleJson, customModels as CustomModel[]);

    const sortGroup = (googleJson.agentModelSorts as { groups: { modelIds: string[] }[] }[])[0].groups[0].modelIds;
    // 1. Original model comes first (not displaced by unshift)
    expect(sortGroup[0]).toBe('gemini-3.8-flash-tiered');
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
    // Canonical stock models (7) are seeded first, custom slug appended after
    expect(sortGroup.length).toBeGreaterThan(1);
    expect(sortGroup[sortGroup.length - 1]).toMatch(/^custom-openai-/);
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
    expect(matchesCustomModel(model, 'gemini-3.8-flash-tiered')).toBe(false);
  });
});

describe('DEFAULT_MAX_BODY_SIZE', () => {
  it('defaults to at least 100MB to allow large agent trajectories', () => {
    expect(DEFAULT_MAX_BODY_SIZE).toBeGreaterThanOrEqual(100 * 1024 * 1024);
  });
});

describe('sanitizeCandidatesInResponse', () => {
  it('supplies default content and role when candidate.content is missing to avoid Go LS nil pointer dereference', () => {
    const chunk = {
      candidates: [
        { finishReason: 'STOP', index: 0 },
      ],
    };
    const modified = sanitizeCandidatesInResponse(chunk);
    expect(modified).toBe(true);
    expect((chunk.candidates[0] as any).content).toBeDefined();
    expect((chunk.candidates[0] as any).content.role).toBe('model');
    expect((chunk.candidates[0] as any).content.parts).toEqual([{ text: '' }]);
  });

  it('supplies default parts array when content.parts is missing or not an array', () => {
    const chunk = {
      candidates: [
        { content: { role: 'model' }, finishReason: 'STOP' },
      ],
    };
    const modified = sanitizeCandidatesInResponse(chunk);
    expect(modified).toBe(true);
    expect((chunk.candidates[0] as any).content.parts).toEqual([{ text: '' }]);
  });

  it('handles nested response.candidates envelope', () => {
    const chunk = {
      response: {
        candidates: [
          { finishReason: 'SAFETY' },
        ],
      },
    };
    const modified = sanitizeCandidatesInResponse(chunk);
    expect(modified).toBe(true);
    expect((chunk.response.candidates[0] as any).content).toBeDefined();
    expect((chunk.response.candidates[0] as any).content.role).toBe('model');
  });

  it('does not modify already valid candidates with response envelope', () => {
    const chunk = {
      response: {
        candidates: [
          {
            content: { parts: [{ text: 'Hello' }], role: 'model' },
            finishReason: 'STOP',
            index: 0,
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
        },
      },
      candidates: [
        {
          content: { parts: [{ text: 'Hello' }], role: 'model' },
          finishReason: 'STOP',
          index: 0,
        },
      ],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 5,
        totalTokenCount: 15,
      },
    };
    const modified = sanitizeCandidatesInResponse(chunk);
    expect(modified).toBe(false);
  });

  it('guarantees response envelope for usageMetadata-only chunk to prevent Go LS nil pointer panic at generation.go:673 (offset 0x50)', () => {
    const chunk: any = {
      usageMetadata: {
        promptTokenCount: 120,
        candidatesTokenCount: 45,
        totalTokenCount: 165,
      },
    };
    const modified = sanitizeCandidatesInResponse(chunk);
    expect(modified).toBe(true);
    expect(chunk.response).toBeDefined();
    expect(chunk.response.usageMetadata).toEqual(chunk.usageMetadata);
    expect(Array.isArray(chunk.response.candidates)).toBe(true);
  });

  it('filters null candidate elements — root cause of Go nil-pointer crash at generation.go:673', () => {
    const chunk: any = {
      candidates: [null, { finishReason: 'STOP', index: 0 }],
    };
    const modified = sanitizeCandidatesInResponse(chunk);
    expect(modified).toBe(true);
    expect(chunk.candidates).toHaveLength(1);
    expect(chunk.candidates[0]).not.toBeNull();
    expect(chunk.candidates[0].content.role).toBe('model');
  });

  it('filters null entries from nested response.candidates', () => {
    const chunk: any = { response: { candidates: [null] } };
    const modified = sanitizeCandidatesInResponse(chunk);
    expect(chunk.response.candidates).toHaveLength(0);
  });

  it('preserves executableCode and codeExecutionResult parts without injecting empty text', () => {
    const chunk: any = {
      candidates: [
        {
          content: {
            parts: [{ executableCode: { language: 'PYTHON', code: 'print("hello")' } }],
            role: 'model',
          },
        },
      ],
    };
    const modified = sanitizeCandidatesInResponse(chunk);
    expect(modified).toBe(true);
    expect(chunk.candidates[0].content.parts[0].text).toBeUndefined();
    expect(chunk.candidates[0].content.parts[0].executableCode).toBeDefined();
  });
});

describe('transformGoogleStreamForRemote', () => {
  it('correctly decodes and transforms uncompressed SSE streams', async () => {
    const mockProxyRes: any = new EventEmitter();
    mockProxyRes.headers = { 'content-type': 'text/event-stream' };
    mockProxyRes.statusCode = 200;

    let output = '';
    const mockClientRes: any = {
      headersSent: false,
      writableEnded: false,
      writeHead: vi.fn(),
      write: vi.fn((data: string) => {
        output += data;
        return true;
      }),
      end: vi.fn(),
    };

    transformGoogleStreamForRemote(mockProxyRes, mockClientRes, 'test-conv');

    const sseData = 'data: {"response":{"candidates":[{"content":{"parts":[{"text":"Hello from Gemini"}]}}]}}\n\n';
    mockProxyRes.emit('data', Buffer.from(sseData, 'utf-8'));
    mockProxyRes.emit('end');

    expect(output).toContain('Hello from Gemini');
    expect(mockClientRes.end).toHaveBeenCalled();
  });

  it('handles stream ending on a data line without trailing newlines cleanly', async () => {
    const mockProxyRes: any = new EventEmitter();
    mockProxyRes.headers = { 'content-type': 'text/event-stream' };
    mockProxyRes.statusCode = 200;

    let output = '';
    const mockClientRes: any = {
      headersSent: false,
      writableEnded: false,
      writeHead: vi.fn(),
      write: vi.fn((data: string) => {
        output += data;
        return true;
      }),
      end: vi.fn(),
    };

    transformGoogleStreamForRemote(mockProxyRes, mockClientRes, 'test-conv');

    const sseData = 'data: {"candidates":[{"content":{"parts":[{"text":"Final chunk without trailing newline"}]}}]}';
    mockProxyRes.emit('data', Buffer.from(sseData, 'utf-8'));
    mockProxyRes.emit('end');

    expect(output).toContain('Final chunk without trailing newline');
    expect(output).toContain('\n\n');
    expect(mockClientRes.end).toHaveBeenCalled();
  });

  it('correctly decompresses gzip-encoded SSE streams from Google Cloud Code', async () => {
    const mockProxyRes: any = new EventEmitter();
    mockProxyRes.headers = {
      'content-type': 'text/event-stream',
      'content-encoding': 'gzip',
    };
    mockProxyRes.statusCode = 200;
    mockProxyRes.pipe = (dest: any) => {
      mockProxyRes.on('data', (c: Buffer) => dest.write(c));
      mockProxyRes.on('end', () => dest.end());
      return dest;
    };

    let output = '';
    const mockClientRes: any = {
      headersSent: false,
      writableEnded: false,
      writeHead: vi.fn(),
      write: vi.fn((data: string) => {
        output += data;
        return true;
      }),
      end: vi.fn(),
    };

    transformGoogleStreamForRemote(mockProxyRes, mockClientRes, 'test-conv');

    const rawSse = 'data: {"response":{"candidates":[{"content":{"parts":[{"text":"Gzip decoded text"}]}}]}}\n\n';
    const compressed = zlib.gzipSync(Buffer.from(rawSse, 'utf-8'));

    mockProxyRes.emit('data', compressed);
    mockProxyRes.emit('end');

    // Allow gunzip async stream ticks to process
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(output).toContain('Gzip decoded text');
    expect(mockClientRes.end).toHaveBeenCalled();
  });
});

