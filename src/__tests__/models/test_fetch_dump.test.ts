import { describe, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadCustomModels } from '../../proxy/models/catalog/modelLoader';
import { injectCustomSlugsIntoAgentModelSorts, mergeModels } from '../../proxy/models/protobuf/modelInjector';

describe('Test fetchAvailableModels dump', () => {
  it('inspects mergeModels and injectCustomSlugs on real dump', () => {
    process.env.AG_CUSTOM_MODELS_PATH = 'C:/Users/amine/.gemini/antigravity/custom_models.json';
    const dumpPath = path.join(os.tmpdir(), 'ag-fetchAvailableModels-dump.json');
    const googleJson = JSON.parse(fs.readFileSync(dumpPath, 'utf8'));
    const customModels = loadCustomModels();

    mergeModels(googleJson.models, customModels);
    injectCustomSlugsIntoAgentModelSorts(googleJson, customModels);

    const slugs = googleJson.agentModelSorts[0].groups[0].modelIds.filter((id: string) => id.startsWith('custom-'));
    for (const slug of slugs) {
      const entry = googleJson.models[slug];
      console.log('Slug entry:', slug, entry ? {
        displayName: entry.displayName,
        model: entry.model,
        disabled: entry.disabled,
        tagTitle: entry.tagTitle,
        tier: entry.tier,
        allowedTiers: entry.allowedTiers,
      } : 'MISSING FROM models!!!');
    }
  });
});
