import { describe, it } from 'vitest';
import { loadCustomModels, getCustomModelsPath } from '../proxy/models/catalog/modelLoader';
import path from 'path';
import os from 'os';

describe('Real custom models inspection', () => {
  it('inspects auto-pool models', () => {
    const realPath = path.join(process.env.USERPROFILE || os.homedir(), '.gemini', 'antigravity', 'custom_models.json');
    process.env.AG_CUSTOM_MODELS_PATH = realPath;
    const customModels = loadCustomModels();
    const autoPool = customModels.filter(m => m.name.includes(':auto-pool'));
    console.log('Auto pool models:');
    for (const m of autoPool) {
      console.log(m.name, {
        displayName: m.displayName,
        enabled: m.enabled,
        _poolOnly: m._poolOnly,
      });
    }
  });
});
