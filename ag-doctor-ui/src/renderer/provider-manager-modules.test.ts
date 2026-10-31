import { describe, expect, it } from 'vitest';

export interface ProviderPreset {
  name: string;
  provider: 'openai' | 'anthropic' | 'google' | 'custom';
  apiUrl: string;
  defaultKey: string;
}

export const PRESETS: Record<string, ProviderPreset> = {
  ollama: {
    name: 'Ollama (Local)',
    provider: 'custom',
    apiUrl: 'http://localhost:11434/v1',
    defaultKey: 'ollama'
  },
  lmstudio: {
    name: 'LM Studio (Local)',
    provider: 'openai',
    apiUrl: 'http://localhost:1234/v1',
    defaultKey: 'lm-studio'
  },
  openrouter: {
    name: 'OpenRouter AI',
    provider: 'openai',
    apiUrl: 'https://openrouter.ai/api/v1',
    defaultKey: ''
  },
  localai: {
    name: 'LocalAI',
    provider: 'custom',
    apiUrl: 'http://localhost:8000/v1',
    defaultKey: ''
  },
  deepseek: {
    name: 'DeepSeek Cloud',
    provider: 'openai',
    apiUrl: 'https://api.deepseek.com/v1',
    defaultKey: ''
  },
  anthropic: {
    name: 'Anthropic Claude',
    provider: 'anthropic',
    apiUrl: 'https://api.anthropic.com/v1',
    defaultKey: ''
  },
  google: {
    name: 'Google Gemini',
    provider: 'google',
    apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultKey: ''
  }
};

export function detectCapabilities(modelId: string): string[] {
  const caps: string[] = [];
  const id = modelId.toLowerCase();
  if (/r1|o1|o3|reasoner|thinking|qwq/.test(id)) caps.push('reasoning');
  if (/vision|4o|claude-3|gemini-1\.5|flash|pixtral/.test(id)) caps.push('vision');
  if (/coder|code|starcoder|qwen2\.5-coder/.test(id)) caps.push('code');
  return caps;
}

export function filterCatalogModels(
  models: Array<{ id: string; displayName?: string }>,
  query: string
): Array<{ id: string; displayName?: string }> {
  const q = query.trim().toLowerCase();
  if (!q) return models;
  return models.filter((m) => {
    const idMatches = m.id.toLowerCase().includes(q);
    const nameMatches = (m.displayName ?? '').toLowerCase().includes(q);
    return idMatches || nameMatches;
  });
}

export function toggleAllModels(
  models: Array<{ id: string; enabled: boolean }>,
  selectState: boolean
): Array<{ id: string; enabled: boolean }> {
  return models.map((m) => ({ ...m, enabled: selectState }));
}

export function appendCustomModel(
  existing: Array<{ id: string; displayName?: string; enabled: boolean }>,
  customId: string
): Array<{ id: string; displayName?: string; enabled: boolean }> {
  const cleanId = customId.trim();
  if (!cleanId) return existing;
  const exists = existing.some((m) => m.id.toLowerCase() === cleanId.toLowerCase());
  if (exists) return existing;
  return [...existing, { id: cleanId, displayName: cleanId, enabled: true }];
}

export function toggleModelById(
  models: Array<{ id: string; enabled: boolean; displayName?: string }>,
  modelId: string,
  enabled: boolean
): Array<{ id: string; enabled: boolean; displayName?: string }> {
  return models.map((m) => (m.id === modelId ? { ...m, enabled } : m));
}

export function filterSelectedModelsForSave(
  models: Array<{ id: string; displayName?: string; enabled?: boolean }>
): Array<{ id: string; displayName: string; enabled: boolean }> {
  return models
    .filter((m) => m.enabled !== false)
    .map((m) => ({ id: m.id, displayName: m.displayName || m.id, enabled: true }));
}

describe('Provider Manager Module 1: Presets & Credentials', () => {
  it('correctly maps quick presets to default endpoints and provider types', () => {
    expect(PRESETS.ollama.apiUrl).toBe('http://localhost:11434/v1');
    expect(PRESETS.ollama.provider).toBe('custom');
    expect(PRESETS.lmstudio.apiUrl).toBe('http://localhost:1234/v1');
    expect(PRESETS.openrouter.apiUrl).toBe('https://openrouter.ai/api/v1');
    expect(PRESETS.deepseek.apiUrl).toBe('https://api.deepseek.com/v1');
  });
});

describe('Provider Manager Module 2: Model Fetcher & Catalog', () => {
  it('detects reasoning, vision, and code capabilities from model IDs', () => {
    expect(detectCapabilities('deepseek-r1')).toContain('reasoning');
    expect(detectCapabilities('gpt-4o')).toContain('vision');
    expect(detectCapabilities('qwen2.5-coder-32b')).toContain('code');
    expect(detectCapabilities('claude-3-5-sonnet')).toContain('vision');
    expect(detectCapabilities('o3-mini')).toContain('reasoning');
  });

  it('filters catalog models by search query', () => {
    const catalog = [
      { id: 'gpt-4o', displayName: 'GPT-4 Omni' },
      { id: 'claude-3-5-sonnet', displayName: 'Claude 3.5 Sonnet' },
      { id: 'deepseek-r1', displayName: 'DeepSeek R1 Reasoning' }
    ];

    expect(filterCatalogModels(catalog, 'gpt')).toHaveLength(1);
    expect(filterCatalogModels(catalog, 'deepseek')).toHaveLength(1);
    expect(filterCatalogModels(catalog, 'sonnet')).toHaveLength(1);
    expect(filterCatalogModels(catalog, '')).toHaveLength(3);
  });

  it('bulk selects and deselects catalog models', () => {
    const catalog = [
      { id: 'gpt-4o', enabled: true },
      { id: 'claude-3-5-sonnet', enabled: false }
    ];

    const allSelected = toggleAllModels(catalog, true);
    expect(allSelected.every((m) => m.enabled)).toBe(true);

    const allDeselected = toggleAllModels(catalog, false);
    expect(allDeselected.every((m) => !m.enabled)).toBe(true);
  });

  it('appends custom model ID to catalog with auto-enable', () => {
    const catalog = [{ id: 'gpt-4o', enabled: true }];
    const updated = appendCustomModel(catalog, 'deepseek-reasoner');

    expect(updated).toHaveLength(2);
    expect(updated[1].id).toBe('deepseek-reasoner');
    expect(updated[1].enabled).toBe(true);
  });

  it('prevents duplicate custom model addition', () => {
    const catalog = [{ id: 'gpt-4o', enabled: true }];
    const updated = appendCustomModel(catalog, 'GPT-4O');

    expect(updated).toHaveLength(1);
  });

  it('toggles individual model by ID without affecting others', () => {
    const catalog = [
      { id: 'gpt-4o', enabled: true },
      { id: 'claude-3-5-sonnet', enabled: true },
      { id: 'deepseek-r1', enabled: true },
    ];

    // User unchecks claude-3-5-sonnet
    const updated1 = toggleModelById(catalog, 'claude-3-5-sonnet', false);
    expect(updated1[0].enabled).toBe(true);
    expect(updated1[1].enabled).toBe(false);
    expect(updated1[2].enabled).toBe(true);

    // User checks it back
    const updated2 = toggleModelById(updated1, 'claude-3-5-sonnet', true);
    expect(updated2[1].enabled).toBe(true);
  });

  it('filters only preferred models for save and ignores unselected', () => {
    const catalog = [
      { id: 'model-1', displayName: 'Model 1', enabled: false },
      { id: 'model-2', displayName: 'Model 2', enabled: true },
      { id: 'model-3', displayName: 'Model 3', enabled: false },
      { id: 'model-4', displayName: 'Model 4', enabled: true },
    ];

    const saved = filterSelectedModelsForSave(catalog);
    expect(saved).toHaveLength(2);
    expect(saved.map((m) => m.id)).toEqual(['model-2', 'model-4']);
    expect(saved.every((m) => m.enabled)).toBe(true);
  });
});
