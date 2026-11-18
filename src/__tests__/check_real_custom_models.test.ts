import { describe, it } from 'vitest';
import { loadCustomModels, getCustomModelsPath } from '../proxy/models/catalog/modelLoader';
import { injectCustomModelsIntoUserStatus, buildGrpcWebFrame } from '../proxy/models/protobuf/protoInjector';
import path from 'path';
import os from 'os';

describe('Real custom models injection check', () => {
  it('tests what gets injected into userStatus', () => {
    const realPath = path.join(process.env.USERPROFILE || os.homedir(), '.gemini', 'antigravity', 'custom_models.json');
    process.env.AG_CUSTOM_MODELS_PATH = realPath;
    const customModels = loadCustomModels();

    const sampleUserStatusJson = JSON.stringify({
      userStatus: {
        cascadeModelConfigData: {
          clientModelConfigs: [
            { label: 'Gemini 3.8 Flash', modelId: 'gemini-3.8-flash-tiered' },
            { label: 'Claude Sonnet 4.6 (Thinking)', modelId: 'claude-sonnet-4-6', tagTitle: 'Notice' },
            { label: 'Claude Opus 4.6 (Thinking)', modelId: 'claude-opus-4-6-thinking', tagTitle: 'Notice' },
            { label: 'GPT-OSS 120B (Medium)', modelId: 'gpt-oss-120b', tagTitle: 'Notice' },
            { label: 'Gemini 4 Carbon', modelId: 'gemini-4-carbon', tagTitle: 'Unavailable', disabled: true },
            { label: 'Gemini 4 Argon', modelId: 'gemini-4-argon', tagTitle: 'Unavailable', disabled: true },
            { label: 'Gemini 4 Hydrogen', modelId: 'gemini-4-hydrogen', tagTitle: 'Unavailable', disabled: true },
          ],
          clientModelSorts: [
            {
              name: 'Recommended',
              groups: [
                {
                  modelLabels: [
                    'Gemini 3.8 Flash',
                    'Claude Sonnet 4.6 (Thinking)',
                    'Claude Opus 4.6 (Thinking)',
                    'GPT-OSS 120B (Medium)',
                    'Gemini 4 Carbon',
                    'Gemini 4 Argon',
                    'Gemini 4 Hydrogen',
                  ],
                },
              ],
            },
          ],
        },
      },
    });

    const frame = buildGrpcWebFrame(0, Buffer.from(sampleUserStatusJson, 'utf8'));
    const result = injectCustomModelsIntoUserStatus(frame, customModels);
    console.log('Result modified:', result.modified, 'injectedCount:', result.injectedCount);

    const bodyLen = result.buffer.readUInt32BE(1);
    const parsed = JSON.parse(result.buffer.subarray(5, 5 + bodyLen).toString('utf8'));
    const configs = parsed.userStatus.cascadeModelConfigData.clientModelConfigs;
    console.log('Resulting configs:');
    for (const c of configs) {
      console.log(' -', c.label, '| modelId:', c.modelId, '| disabled:', c.disabled, '| tagTitle:', c.tagTitle);
    }
  });
});
