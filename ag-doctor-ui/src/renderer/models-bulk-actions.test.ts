import { describe, expect, it } from 'vitest';

export interface TestProviderEntry {
  id: string;
  name: string;
  provider: string;
  apiUrl: string;
  apiKey: string;
  enabled: boolean;
  models?: Array<{ id: string; displayName?: string; enabled: boolean }>;
}

export function bulkEnableModels(providers: TestProviderEntry[], selectedNames: Set<string>): TestProviderEntry[] {
  return providers.map((p) => {
    if (!p.models) return p;
    const newModels = p.models.map((m) => {
      if (selectedNames.has(m.id) || (m.displayName && selectedNames.has(m.displayName))) {
        return { ...m, enabled: true };
      }
      return m;
    });
    return { ...p, models: newModels };
  });
}

export function bulkDisableModels(providers: TestProviderEntry[], selectedNames: Set<string>): TestProviderEntry[] {
  return providers.map((p) => {
    if (!p.models) return p;
    const newModels = p.models.map((m) => {
      if (selectedNames.has(m.id) || (m.displayName && selectedNames.has(m.displayName))) {
        return { ...m, enabled: false };
      }
      return m;
    });
    return { ...p, models: newModels };
  });
}

export function bulkDeleteModels(providers: TestProviderEntry[], selectedNames: Set<string>): TestProviderEntry[] {
  return providers.map((p) => {
    if (!p.models) return p;
    const newModels = p.models.filter(
      (m) => !selectedNames.has(m.id) && !(m.displayName && selectedNames.has(m.displayName))
    );
    return { ...p, models: newModels };
  });
}

describe('Bulk Operations on Selected Models', () => {
  const sampleProviders: TestProviderEntry[] = [
    {
      id: 'provider-1',
      name: 'DeepSeek Cloud',
      provider: 'openai',
      apiUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-deepseek',
      enabled: true,
      models: [
        { id: 'deepseek-chat', displayName: 'DeepSeek V3', enabled: true },
        { id: 'deepseek-reasoner', displayName: 'DeepSeek R1', enabled: true },
      ],
    },
    {
      id: 'provider-2',
      name: 'Anthropic Official',
      provider: 'anthropic',
      apiUrl: 'https://api.anthropic.com/v1',
      apiKey: 'sk-ant',
      enabled: false,
      models: [
        { id: 'claude-3-7-sonnet', displayName: 'Claude 3.7 Sonnet', enabled: false },
        { id: 'claude-3-5-haiku', displayName: 'Claude 3.5 Haiku', enabled: false },
      ],
    },
  ];

  it('enables only selected models in bulk', () => {
    const selected = new Set(['claude-3-7-sonnet', 'deepseek-reasoner']);
    const updated = bulkEnableModels(sampleProviders, selected);
    
    expect(updated[0].models![0].enabled).toBe(true); // unaffected
    expect(updated[0].models![1].enabled).toBe(true); // enabled (already was, stays enabled)
    expect(updated[1].models![0].enabled).toBe(true); // enabled
    expect(updated[1].models![1].enabled).toBe(false); // unaffected (stays disabled)
  });

  it('disables only selected models in bulk', () => {
    const selected = new Set(['deepseek-chat', 'claude-3-7-sonnet']);
    const updated = bulkDisableModels(sampleProviders, selected);
    
    expect(updated[0].models![0].enabled).toBe(false); // disabled
    expect(updated[0].models![1].enabled).toBe(true); // unaffected (stays enabled)
    expect(updated[1].models![0].enabled).toBe(false); // disabled (already was)
    expect(updated[1].models![1].enabled).toBe(false); // unaffected (stays disabled)
  });

  it('deletes only selected models in bulk', () => {
    const selected = new Set(['deepseek-chat', 'claude-3-5-haiku']);
    const updated = bulkDeleteModels(sampleProviders, selected);
    
    expect(updated[0].models).toHaveLength(1);
    expect(updated[0].models![0].id).toBe('deepseek-reasoner');
    
    expect(updated[1].models).toHaveLength(1);
    expect(updated[1].models![0].id).toBe('claude-3-7-sonnet');
  });

  it('handles prefixed model names correctly when resolving model IDs in bulk', () => {
    const resolveModelId = (providerId: string, name: string): string => {
      const prefix = `${providerId}-`;
      if (name.startsWith(prefix)) return name.slice(prefix.length);
      return name.replace(/^models\//, '');
    };

    const selectedWithPrefixes = new Set(['models/claude-3-5-haiku', 'provider-1-deepseek-chat']);
    // Normalize selected names per provider
    const normalizedSelected = new Set(
      Array.from(selectedWithPrefixes).map((name) => {
        if (name.startsWith('provider-1-')) return resolveModelId('provider-1', name);
        if (name.startsWith('provider-2-')) return resolveModelId('provider-2', name);
        return resolveModelId('', name);
      })
    );

    const updated = bulkEnableModels(sampleProviders, normalizedSelected);
    expect(updated[0].models![0].enabled).toBe(true); // deepseek-chat enabled
    expect(updated[1].models![1].enabled).toBe(true); // claude-3-5-haiku enabled
  });
});
