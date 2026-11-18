import { describe, it } from 'vitest';
import { loadCustomModels, getCustomModelsPath } from '../proxy/models/catalog/modelLoader';
import path from 'path';
import os from 'os';

describe('Real custom models check', () => {
  it('loads real custom models', () => {
    const realPath = path.join(process.env.USERPROFILE || os.homedir(), '.gemini', 'antigravity', 'custom_models.json');
    process.env.AG_CUSTOM_MODELS_PATH = realPath;
    console.log('Path used:', getCustomModelsPath());
    const models = loadCustomModels();
    console.log('--- REAL LOADED CUSTOM MODELS COUNT:', models.length);
    for (const m of models) {
      console.log('MODEL:', {
        name: m.name,
        displayName: m.displayName,
        provider: m.provider,
        enabled: m.enabled,
        _poolOnly: m._poolOnly,
      });
    }
  });
});
