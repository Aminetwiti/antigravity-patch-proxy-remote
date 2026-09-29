import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { loadCustomModels } from '../proxy/modelLoader';
import { deduplicateModels } from '../proxy/modelInjector';

describe('Unified Model Deduplication (Cloud Code + AI Studio Single Entry)', () => {
  const customModelsPath = path.join(os.homedir(), '.gemini', 'antigravity', 'custom_models.json');
  let originalContent: string;

  beforeEach(() => {
    originalContent = fs.readFileSync(customModelsPath, 'utf8');
    process.env.AG_CUSTOM_MODELS_PATH = customModelsPath;
  });

  afterEach(() => {
    delete process.env.AG_CUSTOM_MODELS_PATH;
    fs.writeFileSync(customModelsPath, originalContent, 'utf8');
  });

  it('deduplicates all accounts into exactly 5 unique models with zero duplicates', () => {
    const loaded = loadCustomModels();
    expect(loaded.length).toBeGreaterThan(0);

    const deduped = deduplicateModels(loaded);

    // Verify there are no duplicate display names or canonical model keys
    const names = deduped.map((m) => m.displayName || m.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);

    // Verify exactly 5 models in dropdown
    expect(deduped.length).toBe(5);

    // Verify clean display names (no models/ prefix, no placeholder IDs)
    for (const m of deduped) {
      expect(m._poolOnly).toBeFalsy();
      expect(m.displayName).not.toMatch(/^models\//);
      expect(m.displayName).not.toMatch(/MODEL_PLACEHOLDER_/);
      expect(m.displayName).not.toMatch(/-tiered$/);
    }

    const expectedDisplayNames = [
      'Gemini 3.8 Flash',
      'Gemini 3.7 Flash',
      'Gemini 3.6 Flash',
      'Claude Sonnet 4.6 (Thinking)',
      'Claude Opus 4.6 (Thinking)',
    ];

    for (const expected of expectedDisplayNames) {
      expect(names).toContain(expected);
    }
  });

  it('keeps real per-account entries marked _poolOnly for background routing', () => {
    const loaded = loadCustomModels();
    const poolOnlyEntries = loaded.filter((m) => m._poolOnly === true);

    // 25 accounts * 5 models = 125 pool entries
    expect(poolOnlyEntries.length).toBeGreaterThanOrEqual(25);

    // All real accounts must have their apiKey or refreshToken intact for routing
    const hasAiStudio = poolOnlyEntries.some((m) => m.provider === 'google-gemini' && m.apiKey && m.apiKey !== 'auto');
    const hasCloudCode = poolOnlyEntries.some((m) => m.provider === 'google' && Boolean(m.refreshToken));

    expect(hasAiStudio).toBe(true);
    expect(hasCloudCode).toBe(true);
  });
});
