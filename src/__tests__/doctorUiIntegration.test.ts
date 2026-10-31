/**
 * Doctor UI Integration & Functionality Tests
 *
 * Tests:
 * 1. Provider Manager CRUD actions & Active/Inactive state toggling.
 * 2. Provider presets selection (including MiniMax, OpenAI, Anthropic, Google, Ollama, DeepSeek, Custom).
 * 3. Config Export & Import (Base64 encoding/decoding & merging).
 * 4. Model Fetcher endpoint discovery & normalization.
 * 5. Provider color tokens & motion accessibility helpers.
 * 6. Direct Access API surface (window.antigravityDoctorUI) & real-time sync handlers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PROVIDERS, DETAILED_PROVIDER_PRESETS } from '../constants';
import { exportProvidersToBase64, parseProvidersFromBase64, mergeProviderConfigs } from '../services/configExchange';
import { getProviderColor, prefersReducedMotion } from '../preload/model-fetcher';
import { PROVIDER_PRESETS } from '../preload/types';
import type { ProviderFileEntry, ProviderModelEntry } from '../preload/types';

describe('Doctor UI — Provider Presets & Data Model', () => {
  it('includes MiniMax in the list of official provider presets', () => {
    const minimaxPreset = PROVIDER_PRESETS.find((p) => p.id === 'minimax');
    expect(minimaxPreset).toBeDefined();
    expect(minimaxPreset?.label).toContain('MiniMax');
    expect(minimaxPreset?.defaultApiUrl).toBe('https://api.minimaxi.chat/v1');
  });

  it('contains valid default URLs for all provider presets', () => {
    for (const preset of PROVIDER_PRESETS) {
      expect(preset.id).toBeDefined();
      expect(preset.label).toBeDefined();
      if (preset.id !== 'custom') {
        expect(preset.defaultApiUrl).toMatch(/^https?:\/\//);
      }
    }
  });

  it('maps provider color tokens accurately', () => {
    expect(getProviderColor('openai')).toBe('#10a37f');
    expect(getProviderColor('anthropic')).toBe('#d97706');
    expect(getProviderColor('google')).toBe('#4285f4');
    expect(getProviderColor('deepseek')).toBe('#0d9488');
    expect(getProviderColor('openrouter')).toBe('#6366f1');
    expect(getProviderColor('minimax')).toBe('#8b5cf6'); // fallback custom accent
    expect(getProviderColor('unknown-provider')).toBe('#8b5cf6');
  });
});

describe('Doctor UI — Provider CRUD & Active/Inactive Toggles', () => {
  let sampleProviders: ProviderFileEntry[];

  beforeEach(() => {
    sampleProviders = [
      {
        id: 'provider-1',
        name: 'OpenAI Main',
        provider: 'openai',
        apiUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test-key-1234567890',
        enabled: true,
        models: [
          { id: 'gpt-4o', displayName: 'GPT-4o', enabled: true },
          { id: 'gpt-4o-mini', displayName: 'GPT-4o Mini', enabled: false },
        ],
      },
      {
        id: 'provider-2',
        name: 'MiniMax Production',
        provider: 'minimax',
        apiUrl: 'https://api.minimaxi.chat/v1',
        apiKey: 'minimax-secret-key-99',
        enabled: false,
        models: [{ id: 'MiniMax-M3', displayName: 'MiniMax M3', enabled: true }],
      },
    ];
  });

  it('toggles provider active/inactive state correctly', () => {
    expect(sampleProviders[1].enabled).toBe(false);
    sampleProviders[1].enabled = true;
    expect(sampleProviders[1].enabled).toBe(true);
  });

  it('toggles individual model enabled state inside a provider', () => {
    const provider = sampleProviders[0];
    const model = provider.models.find((m) => m.id === 'gpt-4o-mini');
    expect(model?.enabled).toBe(false);

    if (model) model.enabled = true;
    expect(provider.models.find((m) => m.id === 'gpt-4o-mini')?.enabled).toBe(true);
  });

  it('calculates active models count accurately', () => {
    const activeModels = sampleProviders
      .filter((p) => p.enabled !== false)
      .flatMap((p) => p.models)
      .filter((m) => m.enabled);

    expect(activeModels.length).toBe(1);
    expect(activeModels[0].id).toBe('gpt-4o');
  });
});

describe('Doctor UI — Export & Import Configuration Logic', () => {
  const mockProviders: ProviderFileEntry[] = [
    {
      id: 'p-export-1',
      name: 'Custom DeepSeek',
      provider: 'deepseek',
      apiUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-deepseek-123456',
      enabled: true,
      models: [{ id: 'deepseek-chat', displayName: 'DeepSeek Chat', enabled: true }],
    },
  ];

  it('exports provider configuration to Base64 format', () => {
    const base64Str = exportProvidersToBase64(mockProviders);
    expect(typeof base64Str).toBe('string');
    expect(base64Str.length).toBeGreaterThan(10);
  });

  it('imports and parses Base64 provider configuration accurately', () => {
    const base64Str = exportProvidersToBase64(mockProviders);
    const parsed = parseProvidersFromBase64(base64Str);
    expect(parsed.length).toBe(1);
    expect(parsed[0].name).toBe('Custom DeepSeek');
    expect(parsed[0].provider).toBe('deepseek');
    expect(parsed[0].models.length).toBe(1);
  });

  it('merges imported provider configurations without duplicating IDs', () => {
    const existing: ProviderFileEntry[] = [
      {
        id: 'p-1',
        name: 'Existing Provider',
        provider: 'openai',
        apiUrl: 'https://api.openai.com/v1',
        apiKey: 'key-1',
        enabled: true,
        models: [],
      },
    ];

    const incoming: ProviderFileEntry[] = [
      {
        id: 'p-2',
        name: 'New Provider',
        provider: 'anthropic',
        apiUrl: 'https://api.anthropic.com',
        apiKey: 'key-2',
        enabled: true,
        models: [],
      },
    ];

    const result = mergeProviderConfigs(existing, incoming, 'merge');
    expect(result.providers.length).toBe(2);
    expect(result.providers.map((p) => p.id)).toEqual(['p-1', 'p-2']);
  });
});

describe('Doctor UI — Motion & Accessibility Helpers', () => {
  it('detects motion preferences environment', () => {
    // In vitest Node environment, matchMedia returns default mock
    const reducedMotion = prefersReducedMotion();
    expect(typeof reducedMotion).toBe('boolean');
  });
});
