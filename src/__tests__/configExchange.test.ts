import { describe, it, expect } from 'vitest';
import {
  exportProvidersToBase64,
  parseProvidersFromBase64,
  mergeProviderConfigs,
} from '../services/configExchange';
import type { ProviderFileEntry } from '../customModelStore';

const mockProviders: ProviderFileEntry[] = [
  {
    id: 'prov-1',
    name: 'OpenAI Test',
    provider: 'openai',
    apiUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-test-123',
    enabled: true,
    models: [{ id: 'gpt-4o', displayName: 'GPT-4o', enabled: true }],
  },
];

describe('configExchange', () => {
  it('round-trips providers via Base64 export and parse', () => {
    const base64 = exportProvidersToBase64(mockProviders);
    expect(typeof base64).toBe('string');
    expect(base64.length).toBeGreaterThan(0);

    const parsed = parseProvidersFromBase64(base64);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe('prov-1');
    expect(parsed[0].name).toBe('OpenAI Test');
  });

  it('throws helpful error for invalid Base64 input', () => {
    expect(() => parseProvidersFromBase64('invalid-json-base64-!!!')).toThrow();
  });

  it('merges new providers with strategy "merge"', () => {
    const existing: ProviderFileEntry[] = [
      {
        id: 'prov-1',
        name: 'Existing OpenAI',
        provider: 'openai',
        apiUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-old',
        enabled: true,
        models: [{ id: 'gpt-4o', displayName: 'GPT-4o', enabled: true }],
      },
    ];

    const incoming: ProviderFileEntry[] = [
      {
        id: 'prov-1',
        name: 'Updated OpenAI',
        provider: 'openai',
        apiUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-new',
        enabled: true,
        models: [{ id: 'gpt-4o-mini', displayName: 'GPT-4o Mini', enabled: true }],
      },
      {
        id: 'prov-2',
        name: 'Anthropic',
        provider: 'anthropic',
        apiUrl: 'https://api.anthropic.com',
        apiKey: 'sk-ant',
        enabled: true,
        models: [{ id: 'claude-3-5-sonnet', displayName: 'Sonnet', enabled: true }],
      },
    ];

    const result = mergeProviderConfigs(existing, incoming, 'merge');
    expect(result.success).toBe(true);
    expect(result.importedCount).toBe(1);
    expect(result.mergedCount).toBe(1);
    expect(result.providers).toHaveLength(2);

    const mergedProv1 = result.providers.find((p) => p.id === 'prov-1')!;
    expect(mergedProv1.models).toHaveLength(2); // gpt-4o and gpt-4o-mini merged
  });

  it('overwrites existing providers with strategy "overwrite"', () => {
    const existing: ProviderFileEntry[] = [
      {
        id: 'prov-1',
        name: 'Old Name',
        provider: 'openai',
        apiUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-old',
        enabled: true,
        models: [],
      },
    ];

    const incoming: ProviderFileEntry[] = [
      {
        id: 'prov-1',
        name: 'New Name',
        provider: 'openai',
        apiUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-new',
        enabled: true,
        models: [{ id: 'gpt-4o', enabled: true }],
      },
    ];

    const result = mergeProviderConfigs(existing, incoming, 'overwrite');
    expect(result.providers[0].name).toBe('New Name');
    expect(result.providers[0].apiKey).toBe('sk-new');
  });

  it('skips existing providers with strategy "skip"', () => {
    const existing: ProviderFileEntry[] = [
      {
        id: 'prov-1',
        name: 'Existing Name',
        provider: 'openai',
        apiUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-old',
        enabled: true,
        models: [],
      },
    ];

    const incoming: ProviderFileEntry[] = [
      {
        id: 'prov-1',
        name: 'Should Be Skipped',
        provider: 'openai',
        apiUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-new',
        enabled: true,
        models: [],
      },
    ];

    const result = mergeProviderConfigs(existing, incoming, 'skip');
    expect(result.skippedCount).toBe(1);
    expect(result.providers[0].name).toBe('Existing Name');
  });
});
