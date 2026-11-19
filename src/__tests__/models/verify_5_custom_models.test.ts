import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';

// Mock electron
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'home') return '/mock/home';
      return '/mock/' + name;
    }),
  },
}));

// Mock electron-log
vi.mock('electron-log', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock cryptoStore
vi.mock('../../compat/cryptoStore', () => ({
  encryptModels: vi.fn((models: unknown[]) => models),
  decryptModels: vi.fn((models: unknown[]) => models),
  backupFile: vi.fn(),
}));

// Mock fs
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});

import { loadCustomModels, resetLastValidCustomModelsForTest } from '../../proxy/models/catalog/modelLoader';
import { injectCustomModelsIntoUserStatus } from '../../proxy/models/protobuf/protoInjector';

describe('Verify 5 Custom Models Unhidden', () => {
  it('loads 5 distinct pooled Google models and unhides them into the dropdown with purple badges', () => {
    resetLastValidCustomModelsForTest();
    const fixture = {
      providers: [
        {
          id: 'provider-google',
          name: 'Google Gemini',
          provider: 'google',
          apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
          apiKey: 'auto',
          enabled: true,
          models: [
            { id: 'gemini-4-hydrogen', displayName: 'Gemini 4 Hydrogen', enabled: true },
            { id: 'gemini-3.8-flash-tiered', displayName: 'Gemini 3.8 Flash', enabled: true },
            { id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6 (Thinking)', enabled: true },
            { id: 'gemini-4-hydrogen-sonar', displayName: 'Gemini 4 Hydrogen (Sonar)', enabled: true },
            { id: 'claude-opus-4-6-thinking', displayName: 'Claude Opus 4.6 (Thinking)', enabled: true },
          ],
          accounts: [
            {
              id: 'acc-1',
              name: 'Account 1',
              provider: 'google',
              apiUrl: 'https://daily-cloudcode-pa.googleapis.com',
              refreshToken: 'enc:sample-refresh-token',
              enabled: true,
            },
          ],
        },
      ],
    };

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(fixture));

    const models = loadCustomModels();
    const dropdownVisible = models.filter((m) => !m._poolOnly);

    expect(dropdownVisible.length).toBe(5);
    const names = dropdownVisible.map((m) => m.displayName);
    expect(names).toContain('Gemini 4 Hydrogen');
    expect(names).toContain('Gemini 3.8 Flash');
    expect(names).toContain('Claude Sonnet 4.6 (Thinking)');
    expect(names).toContain('Gemini 4 Hydrogen (Sonar)');
    expect(names).toContain('Claude Opus 4.6 (Thinking)');

    // Verify Connect-JSON injection into UserStatus
    const sampleUserStatusJson = {
      userStatus: {
        cascadeModelConfigData: {
          clientModelConfigs: [
            { label: 'Gemini 3.8 Flash', modelOrAlias: { model: 'gemini-3.8-flash-tiered' } },
            { label: 'Claude Sonnet 4.6 (Thinking)', modelOrAlias: { model: 'claude-sonnet-4-6' } },
            { label: 'Claude Opus 4.6 (Thinking)', modelOrAlias: { model: 'claude-opus-4-6-thinking' } },
            { label: 'Gemini 4 Carbon', modelOrAlias: { model: 'gemini-4-carbon' } },
            { label: 'Gemini 4 Argon', modelOrAlias: { model: 'gemini-4-argon' } },
            { label: 'Gemini 4 Hydrogen', modelOrAlias: { model: 'gemini-4-hydrogen' } },
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
    };

    const jsonStr = JSON.stringify(sampleUserStatusJson);
    const bodyBuf = Buffer.from(jsonStr, 'utf8');
    const header = Buffer.alloc(5);
    header[0] = 0;
    header.writeUInt32BE(bodyBuf.length, 1);
    const rawFrame = Buffer.concat([header, bodyBuf]);

    const result = injectCustomModelsIntoUserStatus(rawFrame, dropdownVisible);
    expect(result.modified).toBe(true);

    const injectedJsonStr = result.buffer.subarray(5).toString('utf8');
    const injectedData = JSON.parse(injectedJsonStr);
    const injectedLabels = injectedData.userStatus.cascadeModelConfigData.clientModelSorts[0].groups[0].modelLabels;

    const purpleCustom = injectedLabels.filter((l: string) => l.includes('🟣 ◆'));
    expect(purpleCustom.length).toBeGreaterThanOrEqual(5);
    expect(purpleCustom.some((l: string) => l.includes('Gemini 4 Hydrogen') && !l.includes('Sonar'))).toBe(true);
    expect(purpleCustom.some((l: string) => l.includes('Gemini 3.8 Flash'))).toBe(true);
    expect(purpleCustom.some((l: string) => l.includes('Claude Sonnet 4.6 (Thinking)'))).toBe(true);
    expect(purpleCustom.some((l: string) => l.includes('Gemini 4 Hydrogen (Sonar)'))).toBe(true);
    expect(purpleCustom.some((l: string) => l.includes('Claude Opus 4.6 (Thinking)'))).toBe(true);
  });
});
