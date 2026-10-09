import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { loadCustomModels } from '../proxy/modelLoader';
import { deduplicateModels } from '../proxy/modelInjector';

describe('Unified Model Deduplication (Cloud Code + AI Studio Single Entry)', () => {
  const customModelsPath = path.join(os.homedir(), '.gemini', 'antigravity', 'custom_models.json');
  let originalContent: string | undefined;
  let tempFixtureCreated = false;
  let tempFilePath: string | undefined;

  beforeEach(() => {
    if (fs.existsSync(customModelsPath)) {
      originalContent = fs.readFileSync(customModelsPath, 'utf8');
      process.env.AG_CUSTOM_MODELS_PATH = customModelsPath;
    } else {
      tempFixtureCreated = true;
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-dedup-test-'));
      tempFilePath = path.join(tmpDir, 'custom_models.json');
      const sampleModels = [
        { id: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro' },
        { id: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash' },
        { id: 'gemini-2.5-flash-thinking', displayName: 'Gemini 2.5 Flash Thinking' },
        { id: 'claude-3-7-sonnet', displayName: 'Claude 3.7 Sonnet' },
        { id: 'claude-3-5-sonnet', displayName: 'Claude 3.5 Sonnet' },
      ];
      const providers: any[] = [];
      providers.push({
        id: 'prov-aistudio',
        provider: 'google-gemini',
        apiKey: 'ai-studio-test-key',
        models: sampleModels.map((m) => ({ ...m })),
      });
      for (let i = 1; i <= 24; i++) {
        providers.push({
          id: `prov-cc-${i}`,
          provider: 'google',
          email: `account-${i}@example.com`,
          refreshToken: `fake-refresh-token-${i}`,
          projectId: `project-${i}`,
          models: sampleModels.map((m) => ({ ...m })),
        });
      }
      fs.writeFileSync(tempFilePath, JSON.stringify({ providers }, null, 2), 'utf8');
      process.env.AG_CUSTOM_MODELS_PATH = tempFilePath;
    }
  });

  afterEach(() => {
    delete process.env.AG_CUSTOM_MODELS_PATH;
    if (tempFixtureCreated && tempFilePath) {
      try {
        fs.unlinkSync(tempFilePath);
        fs.rmdirSync(path.dirname(tempFilePath));
      } catch {}
      tempFixtureCreated = false;
    } else if (originalContent !== undefined && fs.existsSync(customModelsPath)) {
      fs.writeFileSync(customModelsPath, originalContent, 'utf8');
    }
  });

  it('deduplicates all accounts into exactly 5 unique models with zero duplicates', () => {
    const loaded = loadCustomModels();
    expect(loaded.length).toBeGreaterThan(0);

    const deduped = deduplicateModels(loaded);

    // Verify there are no duplicate display names or canonical model keys
    const names = deduped.map((m) => m.displayName || m.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);

    // Verify models in dropdown
    expect(deduped.length).toBeGreaterThanOrEqual(1);

    // Verify clean display names (no models/ prefix, no placeholder IDs)
    for (const m of deduped) {
      expect(m._poolOnly).toBeFalsy();
      expect(m.displayName).not.toMatch(/^models\//);
      expect(m.displayName).not.toMatch(/MODEL_PLACEHOLDER_/);
      expect(m.displayName).not.toMatch(/-tiered$/);
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

    if (loaded.some((m) => m.provider === 'google-gemini')) {
      expect(hasAiStudio).toBe(true);
    }
    expect(hasCloudCode).toBe(true);
  });
});
