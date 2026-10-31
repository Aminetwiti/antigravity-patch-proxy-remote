import { describe, expect, it } from 'vitest';

export interface ProviderEntryMock {
  id: string;
  name: string;
  provider: string;
  apiUrl: string;
  enabled: boolean;
  models?: Array<{ id: string; displayName?: string; enabled: boolean }>;
}

export function syncModelToggleToProvider(
  providers: ProviderEntryMock[],
  modelName: string,
  newEnabledState: boolean
): ProviderEntryMock[] {
  return providers.map((p) => {
    const hasModel = p.models?.some((m) => m.id === modelName || m.displayName === modelName);
    if (hasModel && p.models) {
      const updatedModels = p.models.map((m) => {
        if (m.id === modelName || m.displayName === modelName) {
          return { ...m, enabled: newEnabledState };
        }
        return m;
      });
      return { ...p, models: updatedModels };
    }
    return p;
  });
}

describe('Models Live Synchronization (Zero Restart)', () => {
  const initialProviders: ProviderEntryMock[] = [
    {
      id: 'provider-minimax',
      name: 'MiniMax AI',
      provider: 'openai',
      apiUrl: 'https://api.minimax.io/v1',
      enabled: true,
      models: [
        { id: 'MiniMax-M3', displayName: 'MiniMax-M3', enabled: true },
      ],
    },
    {
      id: 'provider-qwen',
      name: 'Qwen MaaS',
      provider: 'openai',
      apiUrl: 'https://maas.aliyun.com/v1',
      enabled: true,
      models: [
        { id: 'qwen3.8-max-preview', displayName: 'qwen3.8-max-preview', enabled: true },
      ],
    },
  ];

  it('updates target model enabled state inside matching provider entry', () => {
    const updated = syncModelToggleToProvider(initialProviders, 'MiniMax-M3', false);
    expect(updated[0].models![0].enabled).toBe(false);
    expect(updated[1].models![0].enabled).toBe(true);
  });

  it('preserves other providers when toggling a model', () => {
    const updated = syncModelToggleToProvider(initialProviders, 'qwen3.8-max-preview', false);
    expect(updated[0].models![0].enabled).toBe(true);
    expect(updated[1].models![0].enabled).toBe(false);
  });
});
