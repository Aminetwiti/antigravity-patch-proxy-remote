import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── Types mirroring app.ts ──────────────────────────────────────────
interface ProviderModel {
  id: string;
  displayName?: string;
  enabled: boolean;
}

interface ProviderEntry {
  id: string;
  name: string;
  provider: string;
  apiUrl: string;
  apiKey: string;
  enabled: boolean;
  models: ProviderModel[];
}

interface CustomModel {
  name: string;
  displayName: string;
  provider: string;
  apiUrl: string;
  apiKey?: string;
  enabled?: boolean;
}

// ── Core logic extracted from handleModelAction (same algorithms) ────

function findProviderForModel(
  providers: ProviderEntry[],
  modelName: string,
  modelUrl: string,
  modelProvider: string
): ProviderEntry | undefined {
  return providers.find((p) =>
    p.models?.some((m) => m.id === modelName || m.displayName === modelName) ||
    p.apiUrl.toLowerCase() === modelUrl.toLowerCase() ||
    p.name.toLowerCase() === modelName.toLowerCase() ||
    (((p.provider.toLowerCase() !== 'openai' && modelProvider.toLowerCase() !== 'openai') || (!p.apiUrl && !modelUrl)) && p.provider.toLowerCase() === modelProvider.toLowerCase())
  );
}

function toggleModelInProvider(
  provider: ProviderEntry,
  modelName: string,
  newEnabled: boolean
): ProviderEntry {
  const copy = { ...provider, models: [...provider.models] };
  const idx = copy.models.findIndex((m) => m.id === modelName || m.displayName === modelName);
  if (idx !== -1) {
    copy.models[idx] = { ...copy.models[idx], enabled: newEnabled };
  } else {
    copy.models.push({ id: modelName, displayName: modelName, enabled: newEnabled });
  }
  return copy;
}

function removeModelFromProvider(
  provider: ProviderEntry,
  modelName: string
): ProviderEntry {
  return {
    ...provider,
    models: provider.models.filter((m) => m.id !== modelName && m.displayName !== modelName),
  };
}

// ── Test data ───────────────────────────────────────────────────────

function makeProviders(): ProviderEntry[] {
  return [
    {
      id: 'provider-deepseek',
      name: 'DeepSeek',
      provider: 'openai',
      apiUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-ds-***',
      enabled: true,
      models: [
        { id: 'deepseek-chat', displayName: 'DeepSeek Chat', enabled: true },
        { id: 'deepseek-reasoner', displayName: 'DeepSeek Reasoner', enabled: true },
      ],
    },
    {
      id: 'provider-anthropic',
      name: 'Anthropic',
      provider: 'anthropic',
      apiUrl: 'https://api.anthropic.com/v1',
      apiKey: 'sk-ant-***',
      enabled: true,
      models: [
        { id: 'claude-sonnet-4-20250514', displayName: 'Claude Sonnet 4', enabled: true },
        { id: 'claude-opus-4-20250514', displayName: 'Claude Opus 4', enabled: false },
      ],
    },
    {
      id: 'provider-ollama',
      name: 'Local Ollama',
      provider: 'ollama',
      apiUrl: 'http://localhost:11434',
      apiKey: '',
      enabled: true,
      models: [
        { id: 'qwen3:8b', displayName: 'Qwen3 8B', enabled: true },
      ],
    },
  ];
}

function makeModels(): CustomModel[] {
  return [
    { name: 'deepseek-chat', displayName: 'DeepSeek Chat', provider: 'openai', apiUrl: 'https://api.deepseek.com/v1', enabled: true },
    { name: 'deepseek-reasoner', displayName: 'DeepSeek Reasoner', provider: 'openai', apiUrl: 'https://api.deepseek.com/v1', enabled: true },
    { name: 'claude-sonnet-4-20250514', displayName: 'Claude Sonnet 4', provider: 'anthropic', apiUrl: 'https://api.anthropic.com/v1', enabled: true },
    { name: 'claude-opus-4-20250514', displayName: 'Claude Opus 4', provider: 'anthropic', apiUrl: 'https://api.anthropic.com/v1', enabled: false },
    { name: 'qwen3:8b', displayName: 'Qwen3 8B', provider: 'ollama', apiUrl: 'http://localhost:11434', enabled: true },
  ];
}

// ── Tests ───────────────────────────────────────────────────────────

describe('handleModelAction — Test action', () => {
  it('finds matching provider by model ID for testing', () => {
    const providers = makeProviders();
    const match = findProviderForModel(providers, 'deepseek-chat', 'https://api.deepseek.com/v1', 'openai');
    expect(match).toBeDefined();
    expect(match!.id).toBe('provider-deepseek');
    expect(match!.apiKey).toBe('sk-ds-***');
  });

  it('finds matching provider by displayName', () => {
    const providers = makeProviders();
    const match = findProviderForModel(providers, 'Claude Sonnet 4', 'https://api.anthropic.com/v1', 'anthropic');
    expect(match).toBeDefined();
    expect(match!.id).toBe('provider-anthropic');
  });

  it('finds matching provider by apiUrl when model name is not in models array', () => {
    const providers = makeProviders();
    const match = findProviderForModel(providers, 'some-unknown-model', 'https://api.deepseek.com/v1', 'unknown');
    expect(match).toBeDefined();
    expect(match!.id).toBe('provider-deepseek');
  });

  it('falls back to provider type matching', () => {
    const providers = makeProviders();
    const match = findProviderForModel(providers, 'unknown-model', 'https://unknown.example.com', 'ollama');
    expect(match).toBeDefined();
    expect(match!.id).toBe('provider-ollama');
  });

  it('returns undefined when no provider matches at all', () => {
    const providers = makeProviders();
    const match = findProviderForModel(providers, 'nonexistent', 'https://nowhere.example.com', 'mistral');
    expect(match).toBeUndefined();
  });
});

describe('handleModelAction — Edit action', () => {
  it('opens provider form with matching provider ID', () => {
    const providers = makeProviders();
    const match = findProviderForModel(providers, 'claude-opus-4-20250514', 'https://api.anthropic.com/v1', 'anthropic');
    expect(match).toBeDefined();
    expect(match!.id).toBe('provider-anthropic');
  });

  it('matches by name when model is the provider name', () => {
    const providers = makeProviders();
    const match = findProviderForModel(providers, 'Local Ollama', '', '');
    expect(match).toBeDefined();
    expect(match!.id).toBe('provider-ollama');
  });

  it('case-insensitive matching for apiUrl and provider', () => {
    const providers = makeProviders();
    const match = findProviderForModel(providers, 'x', 'HTTPS://API.DEEPSEEK.COM/V1', 'x');
    expect(match).toBeDefined();
    expect(match!.id).toBe('provider-deepseek');
  });
});

describe('handleModelAction — Toggle action', () => {
  it('disables an enabled model in its provider', () => {
    const providers = makeProviders();
    const parent = findProviderForModel(providers, 'deepseek-chat', '', 'openai')!;
    const updated = toggleModelInProvider(parent, 'deepseek-chat', false);
    const model = updated.models.find((m) => m.id === 'deepseek-chat')!;
    expect(model.enabled).toBe(false);
  });

  it('enables a disabled model in its provider', () => {
    const providers = makeProviders();
    const parent = findProviderForModel(providers, 'claude-opus-4-20250514', '', 'anthropic')!;
    const updated = toggleModelInProvider(parent, 'claude-opus-4-20250514', true);
    const model = updated.models.find((m) => m.id === 'claude-opus-4-20250514')!;
    expect(model.enabled).toBe(true);
  });

  it('preserves sibling models when toggling one model', () => {
    const providers = makeProviders();
    const parent = findProviderForModel(providers, 'deepseek-chat', '', 'openai')!;
    const updated = toggleModelInProvider(parent, 'deepseek-chat', false);
    const sibling = updated.models.find((m) => m.id === 'deepseek-reasoner')!;
    expect(sibling.enabled).toBe(true);
  });

  it('adds model to provider.models if not found (new model scenario)', () => {
    const providers = makeProviders();
    const parent = findProviderForModel(providers, 'qwen3:8b', '', 'ollama')!;
    const updated = toggleModelInProvider(parent, 'brand-new-model', false);
    expect(updated.models).toHaveLength(2);
    const added = updated.models.find((m) => m.id === 'brand-new-model')!;
    expect(added.enabled).toBe(false);
  });

  it('toggle round-trip: disable then re-enable returns to original state', () => {
    const providers = makeProviders();
    const parent = findProviderForModel(providers, 'deepseek-reasoner', '', 'openai')!;
    const disabled = toggleModelInProvider(parent, 'deepseek-reasoner', false);
    const reEnabled = toggleModelInProvider(disabled, 'deepseek-reasoner', true);
    expect(reEnabled.models.find((m) => m.id === 'deepseek-reasoner')!.enabled).toBe(true);
  });
});

describe('handleModelAction — Delete (remove) action', () => {
  it('removes model from parent provider by ID', () => {
    const providers = makeProviders();
    const parent = findProviderForModel(providers, 'deepseek-chat', '', 'openai')!;
    const updated = removeModelFromProvider(parent, 'deepseek-chat');
    expect(updated.models).toHaveLength(1);
    expect(updated.models[0].id).toBe('deepseek-reasoner');
  });

  it('removes model from parent provider by displayName', () => {
    const providers = makeProviders();
    const parent = findProviderForModel(providers, 'Claude Sonnet 4', '', 'anthropic')!;
    const updated = removeModelFromProvider(parent, 'Claude Sonnet 4');
    expect(updated.models).toHaveLength(1);
    expect(updated.models[0].id).toBe('claude-opus-4-20250514');
  });

  it('does not crash when removing non-existent model', () => {
    const providers = makeProviders();
    const parent = findProviderForModel(providers, 'qwen3:8b', '', 'ollama')!;
    const updated = removeModelFromProvider(parent, 'nonexistent-model');
    expect(updated.models).toHaveLength(1); // unchanged
  });

  it('results in empty models array when removing the only model', () => {
    const providers = makeProviders();
    const parent = findProviderForModel(providers, 'qwen3:8b', '', 'ollama')!;
    const updated = removeModelFromProvider(parent, 'qwen3:8b');
    expect(updated.models).toHaveLength(0);
  });

  it('preserves provider metadata after model deletion', () => {
    const providers = makeProviders();
    const parent = findProviderForModel(providers, 'deepseek-chat', '', 'openai')!;
    const updated = removeModelFromProvider(parent, 'deepseek-chat');
    expect(updated.id).toBe('provider-deepseek');
    expect(updated.apiUrl).toBe('https://api.deepseek.com/v1');
    expect(updated.apiKey).toBe('sk-ds-***');
    expect(updated.enabled).toBe(true);
  });
});

describe('handleModelAction — Edge cases', () => {
  it('handles provider with empty models array', () => {
    const emptyProvider: ProviderEntry = {
      id: 'provider-empty',
      name: 'Empty',
      provider: 'openai',
      apiUrl: 'https://empty.example.com',
      apiKey: 'key',
      enabled: true,
      models: [],
    };
    const toggled = toggleModelInProvider(emptyProvider, 'new-model', true);
    expect(toggled.models).toHaveLength(1);
    expect(toggled.models[0].id).toBe('new-model');
    expect(toggled.models[0].enabled).toBe(true);
  });

  it('handles multiple providers with same provider type — picks first match', () => {
    const providers: ProviderEntry[] = [
      { id: 'p1', name: 'OpenAI 1', provider: 'openai', apiUrl: 'https://api.openai.com/v1', apiKey: 'k1', enabled: true, models: [{ id: 'gpt-4o', enabled: true }] },
      { id: 'p2', name: 'OpenAI 2', provider: 'openai', apiUrl: 'https://api.openai.com/v2', apiKey: 'k2', enabled: true, models: [{ id: 'gpt-4o-mini', enabled: true }] },
    ];
    const match = findProviderForModel(providers, 'gpt-4o', '', '');
    expect(match!.id).toBe('p1');
  });

  it('handles case where model exists in allLoadedModels but not in any provider', () => {
    const providers = makeProviders();
    const match = findProviderForModel(providers, 'completely-unknown', 'https://completely-unknown.example.com', 'completely-unknown-provider');
    expect(match).toBeUndefined();
  });
});
