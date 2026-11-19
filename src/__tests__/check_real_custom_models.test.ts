import { describe, it } from 'vitest';
import { loadCustomModels } from '../proxy/models/catalog/modelLoader';
import { generateModelPlaceholderId } from '../proxy/models/catalog/idGenerator';
import path from 'path';
import os from 'os';

describe('Inspect M572', () => {
  it('finds M572', () => {
    const realPath = path.join(process.env.USERPROFILE || os.homedir(), '.gemini', 'antigravity', 'custom_models.json');
    process.env.AG_CUSTOM_MODELS_PATH = realPath;
    const customModels = loadCustomModels();
    console.log('Total models:', customModels.length);
    const nonPool = customModels.filter(m => !m._poolOnly);
    console.log('Non poolOnly models:', nonPool.length);
    for (const m of nonPool) {
      console.log(`- [${m.provider}] ${m.displayName} | name: ${m.name} | ext: ${m.externalModelName} | poolOnly: ${m._poolOnly}`);
    }
  });
});
