import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => '/mock/home' },
}));

vi.mock('electron-log', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  mergeModels,
  buildSyntheticModelsResponse,
  DEFAULT_CANONICAL_GOOGLE_MODELS,
} from '../proxy/modelInjector';
import { generateModelPlaceholderId } from '../proxy/idGenerator';
import type { CustomModel } from '../proxy/types';

describe('mergeModels', () => {
  const sampleCustomModel: CustomModel = {
    name: 'models/custom-claude',
    displayName: 'Claude 3.5 Sonnet',
    provider: 'anthropic',
    apiUrl: 'https://api.anthropic.com/v1',
    apiKey: 'sk-ant-test',
    externalModelName: 'claude-3-5-sonnet',
  };

  const poolOnlyModel: CustomModel = {
    name: 'models/google:gemini-3.8-flash-tiered:twi-ti',
    displayName: 'Gemini 3.8 Flash',
    provider: 'google',
    apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKey: 'ya29.twiti',
    externalModelName: 'gemini-3.8-flash-tiered',
    accountName: 'Twi Ti',
    accountEmail: 'dev.user@example.com',
    _poolOnly: true,
  };

  it('merges custom models into an existing models object dictionary', () => {
    const base = { ...DEFAULT_CANONICAL_GOOGLE_MODELS };
    const merged = mergeModels(base, [sampleCustomModel]) as Record<string, any>;

    const pid = generateModelPlaceholderId(sampleCustomModel);
    expect(merged[pid]).toBeDefined();
    expect(merged[`models/${pid}`]).toBeDefined();
    expect(merged[pid].model).toBe(pid);
  });

  it('registers pool-only accounts so their placeholder IDs are resolvable (e.g. M581)', () => {
    const base = { ...DEFAULT_CANONICAL_GOOGLE_MODELS };
    const twiTiPid = generateModelPlaceholderId(poolOnlyModel);
    expect(twiTiPid).toBe('MODEL_PLACEHOLDER_M581');

    const merged = mergeModels(base, [poolOnlyModel]) as Record<string, any>;
    expect(merged['MODEL_PLACEHOLDER_M581']).toBeDefined();
    expect(merged['models/MODEL_PLACEHOLDER_M581']).toBeDefined();
  });

  it('provides fallback entries for all MODEL_PLACEHOLDER_M0 through MODEL_PLACEHOLDER_M600', () => {
    const base = { ...DEFAULT_CANONICAL_GOOGLE_MODELS };
    const merged = mergeModels(base, [sampleCustomModel]) as Record<string, any>;

    // Historical placeholder from past conversations must resolve
    expect(merged['MODEL_PLACEHOLDER_M577']).toBeDefined();
    expect(merged['MODEL_PLACEHOLDER_M50']).toBeDefined();
    expect(merged['MODEL_PLACEHOLDER_M50'].model).toBe('MODEL_PLACEHOLDER_M50');
    expect(merged['models/MODEL_PLACEHOLDER_M50']).toBeDefined();
    expect(merged['MODEL_PLACEHOLDER_M35']).toBeDefined();
    expect(merged['MODEL_PLACEHOLDER_M71']).toBeDefined();
    expect(merged['MODEL_PLACEHOLDER_M0']).toBeDefined();
    expect(merged['MODEL_PLACEHOLDER_M600']).toBeDefined();
  });

  it('aliases upstream models whose inner model field differs from map key (e.g. M50)', () => {
    const upstream = {
      'gemini-3.8-flash-low': {
        displayName: 'Gemini 3.8 Flash Low',
        model: 'MODEL_PLACEHOLDER_M50',
      },
    };
    const merged = mergeModels(upstream, []) as Record<string, any>;
    expect(merged['MODEL_PLACEHOLDER_M50']).toBeDefined();
    expect(merged['MODEL_PLACEHOLDER_M50'].displayName).toBe('Gemini 3.8 Flash Low');
    expect(merged['models/MODEL_PLACEHOLDER_M50']).toBeDefined();
  });

  it('buildSyntheticModelsResponse includes custom models and historical placeholders', () => {
    const response = buildSyntheticModelsResponse([poolOnlyModel]);
    const models = response.models as Record<string, any>;

    expect(models['MODEL_PLACEHOLDER_M577']).toBeDefined();
    expect(models['gemini-3.8-flash']).toBeDefined();
    expect(models['gemini-4-argon-medium']).toBeDefined();
    expect(response.agentModelSorts).toBeDefined();
  });

  it('unlocks Gemini 4 Argon when upstream returns it disabled with Unavailable tag', () => {
    const upstream = {
      'gemini-4-argon-medium': {
        displayName: 'Gemini 4 Argon (Medium)',
        disabled: true,
        tagTitle: 'Unavailable',
        tagDescription: 'Gemini 4 Argon is currently available to Ultra plan subscribers.',
        model: 'MODEL_PLACEHOLDER_M418',
      },
    };
    const merged = mergeModels(upstream, []) as Record<string, any>;
    const argon = merged['gemini-4-argon-medium'];
    expect(argon).toBeDefined();
    expect(argon.disabled).toBeUndefined();
    expect(argon.tagTitle).toBeUndefined();
    expect(argon.tagDescription).toBeUndefined();
    expect(argon.quotaInfo).toBeDefined();
    expect(argon.quotaInfo.remainingFraction).toBe(1);
  });
});
