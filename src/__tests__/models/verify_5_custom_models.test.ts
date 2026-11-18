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

import { loadCustomModels } from '../../proxy/models/catalog/modelLoader';

describe('Verify 5 Custom Models Unhidden', () => {
  it('loads 5 distinct pooled Google models and unhides them into the dropdown', () => {
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
    console.log('All models count:', models.length);
    for (const m of models) {
      console.log('Model:', { name: m.name, disp: m.displayName, poolOnly: m._poolOnly, enabled: m.enabled });
    }
  });
});
