import { it, expect } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import { loadCustomModels } from '../proxy/modelLoader';
import { expandModelsWithEffort } from '../proxy/effortExpander';
import { getGoogleAccountPool, getModelQuotaScore, isAccountInCooldown } from '../proxy/googlePool';

it('inspects accountPool when matchedCustomModel is bound to twiti.amine17', () => {
  process.env.AG_CUSTOM_MODELS_PATH = path.join(os.homedir(), '.gemini', 'antigravity', 'custom_models.json');
  const rawModels = loadCustomModels();
  const customModels = expandModelsWithEffort(rawModels);

  const matched = customModels.find(m => (m.accountEmail || '').includes('twiti.amine17') && (m.displayName || '').includes('Flash (Low)'));
  expect(matched).toBeDefined();

  const accountPool = getGoogleAccountPool(matched!, customModels);
  console.log('accountPool length:', accountPool.length);

  for (const acc of accountPool) {
    const cd = isAccountInCooldown(acc, 'gemini');
    const qs = getModelQuotaScore(acc, 'gemini');
    console.log(`acc: ${acc.accountEmail}, enabled: ${(acc as any).enabled}, cooldown: ${cd}, quotaScore: ${qs}`);
  }
});
