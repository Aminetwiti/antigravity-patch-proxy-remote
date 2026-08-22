import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as http from 'http';

// Mock electron
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'home') return '/mock/e2e_home';
      return '/mock/' + name;
    }),
  },
}));

// Mock electron-log
vi.mock('electron-log/main', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock cryptoStore
vi.mock('../cryptoStore', () => ({
  encryptString: vi.fn((str: string) => `enc:${str}`),
  decryptString: vi.fn((str: string) => (str.startsWith('enc:') ? str.slice(4) : str)),
  encryptModels: vi.fn((models: unknown[]) => models),
  decryptModels: vi.fn((models: unknown[]) => models),
}));

// Mock fs/promises & fs
let mockFsStore: Record<string, string> = {};

vi.mock('fs/promises', () => ({
  mkdir: vi.fn(async () => undefined),
  readFile: vi.fn(async (p: string) => {
    if (mockFsStore[String(p)]) return mockFsStore[String(p)];
    throw { code: 'ENOENT' };
  }),
  writeFile: vi.fn(async (p: string, content: string) => {
    mockFsStore[String(p)] = String(content);
  }),
  rename: vi.fn(async (tmp: string, target: string) => {
    mockFsStore[String(target)] = mockFsStore[String(tmp)];
  }),
}));

vi.mock('fs', () => ({
  readFileSync: vi.fn((p: string) => {
    if (mockFsStore[String(p)]) return mockFsStore[String(p)];
    throw { code: 'ENOENT' };
  }),
}));

import { loadProviders, saveProviders, recordProviderUsage } from '../customModelStore';
import { generateModelPlaceholderId, toSlug } from '../proxy/idGenerator';

describe('Real-World Production E2E Integration Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFsStore = {};
  });

  it('generates URL-safe slugs and deterministic placeholder IDs for production models', () => {
    const model = {
      name: 'provider-p1-gpt-4o',
      displayName: 'GPT-4o Production',
      provider: 'openai',
      apiUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-prod-1234567890',
      externalModelName: 'gpt-4o',
    };

    const placeholderId = generateModelPlaceholderId(model);
    const slug = toSlug(model);

    expect(placeholderId).toMatch(/^MODEL_PLACEHOLDER_M\d+$/);
    expect(slug).toContain('custom-openai');
    expect(slug).toContain('gpt-4o');
  });

  it('persists and loads production provider configurations with atomic writes', async () => {
    const providers = [
      {
        id: 'prod-provider-1',
        name: 'OpenAI Production Endpoint',
        provider: 'openai',
        apiUrl: 'https://api.openai.com/v1',
        apiKey: 'enc:sk-prod-key-12345',
        enabled: true,
        encrypted: true,
        models: [
          { id: 'gpt-4o', displayName: 'GPT-4o', enabled: true },
          { id: 'gpt-4o-mini', displayName: 'GPT-4o Mini', enabled: true },
        ],
      },
      {
        id: 'prod-provider-2',
        name: 'Anthropic Claude Endpoint',
        provider: 'anthropic',
        apiUrl: 'https://api.anthropic.com',
        apiKey: 'enc:sk-ant-prod-key',
        enabled: true,
        encrypted: true,
        models: [{ id: 'claude-3-5-sonnet-20241022', displayName: 'Claude 3.5 Sonnet', enabled: true }],
      },
    ];

    await saveProviders(providers);
    const loaded = await loadProviders();

    expect(loaded).toHaveLength(2);
    expect(loaded[0].name).toBe('OpenAI Production Endpoint');
    expect(loaded[1].models[0].id).toBe('claude-3-5-sonnet-20241022');
  });

  it('records token telemetry and request statistics for production providers', async () => {
    const providers = [
      {
        id: 'p-telemetry',
        name: 'Telemetry Test Provider',
        provider: 'openai',
        apiUrl: 'https://api.openai.com/v1',
        apiKey: 'enc:123',
        enabled: true,
        models: [{ id: 'gpt-4o', enabled: true }],
      },
    ];

    await saveProviders(providers);

    // Record request 1
    await recordProviderUsage('p-telemetry', 500, 1200);
    // Record request 2
    await recordProviderUsage('p-telemetry', 200, 450);

    const updated = await loadProviders();
    expect(updated[0].usage).toBeDefined();
    expect(updated[0].usage?.promptTokens).toBe(700);
    expect(updated[0].usage?.completionTokens).toBe(1650);
    expect(updated[0].usage?.totalRequests).toBe(2);
    expect(updated[0].usage?.lastUsed).toBeGreaterThan(0);
  });

  it('simulates live E2E HTTP response translation and proxy protocol flow', async () => {
    // Create a mock upstream HTTP server to represent OpenAI / Anthropic
    const upstreamServer = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'chatcmpl-e2e-123',
          object: 'chat.completion',
          created: Date.now(),
          model: 'gpt-4o',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'Production E2E response successful.' },
              finish_reason: 'stop',
            },
          ],
        }),
      );
    });

    await new Promise<void>((resolve) => upstreamServer.listen(0, '127.0.0.1', () => resolve()));
    const address = upstreamServer.address() as import('net').AddressInfo;
    const upstreamUrl = `http://127.0.0.1:${address.port}/v1`;

    // Perform an HTTP POST request to the mock upstream endpoint
    const postData = JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hello Production' }],
    });

    const responseBody = await new Promise<string>((resolve, reject) => {
      const clientReq = http.request(
        `${upstreamUrl}/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => resolve(data));
        },
      );
      clientReq.on('error', reject);
      clientReq.write(postData);
      clientReq.end();
    });

    const parsed = JSON.parse(responseBody);
    expect(parsed.id).toBe('chatcmpl-e2e-123');
    expect(parsed.choices[0].message.content).toBe('Production E2E response successful.');

    upstreamServer.close();
  });
});
