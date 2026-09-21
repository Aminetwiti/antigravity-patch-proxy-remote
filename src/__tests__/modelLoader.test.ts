import { describe, it, expect, vi, beforeEach } from 'vitest';

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
vi.mock('../cryptoStore', () => ({
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
    mkdirSync: vi.fn(),
  };
});

import * as fs from 'fs';
import * as cryptoStore from '../cryptoStore';
import { validateCustomModel } from '../schemaValidator';
import { loadCustomModels, getCustomModelsPath } from '../proxy/modelLoader';

describe('getCustomModelsPath', () => {
  it('returns path under .gemini/antigravity in user home', () => {
    const path = getCustomModelsPath();
    expect(path).toContain('.gemini');
    expect(path).toContain('antigravity');
    expect(path).toContain('custom_models.json');
    // On Windows, path.join uses backslashes; on POSIX, forward slashes
    expect(path).toMatch(/mock[/\\]home/);
  });
});

describe('loadCustomModels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates default models file when none exists', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined as never);

    const models = loadCustomModels();
    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThan(0);
    expect(fs.writeFileSync).toHaveBeenCalled();
    expect(fs.mkdirSync).toHaveBeenCalled();
  });

  it('returns models from existing file', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const mockModels = [
      { name: 'gpt-4o', displayName: 'GPT-4o', provider: 'openai', apiUrl: 'https://api.openai.com/v1', apiKey: 'enc:abc', encrypted: true },
    ];
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ models: mockModels }));

    const models = loadCustomModels();
    expect(models).toHaveLength(1);
    expect(cryptoStore.decryptModels).toHaveBeenCalled();
  });

  it('strips UTF-8 BOM before parsing', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const bom = '\uFEFF';
    const mockModels = [{ name: 'gpt-4o', displayName: 'GPT-4o', provider: 'openai', apiUrl: 'https://api.openai.com/v1', apiKey: 'enc:x', encrypted: true }];
    vi.mocked(fs.readFileSync).mockReturnValue(bom + JSON.stringify({ models: mockModels }));

    const models = loadCustomModels();
    expect(models).toHaveLength(1);
  });

  it('returns empty array when JSON parsing fails', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('not valid json {');

    const models = loadCustomModels();
    expect(models).toEqual([]);
  });

  it('returns empty array when models field is missing', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ other: 'data' }));

    const models = loadCustomModels();
    expect(models).toEqual([]);
  });

  it('migrates plaintext API keys to encrypted format', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const plaintextModels = [
      { name: 'gpt-4o', displayName: 'GPT-4o', provider: 'openai', apiUrl: 'https://api.openai.com/v1', apiKey: 'sk-plaintext-key' },
    ];
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ models: plaintextModels }));
    vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
    vi.mocked(cryptoStore.backupFile).mockImplementation(() => undefined);

    loadCustomModels();
    expect(cryptoStore.backupFile).toHaveBeenCalled();
    expect(cryptoStore.encryptModels).toHaveBeenCalled();
    expect(fs.writeFileSync).toHaveBeenCalled();
  });

  it('skips invalid models and warns', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const mixedModels = [
      { name: 'valid', displayName: 'Valid', provider: 'openai', apiUrl: 'https://api.openai.com/v1', apiKey: 'enc:x', encrypted: true },
      { name: '', displayName: 'Invalid (missing name)', provider: 'openai', apiUrl: 'https://api.openai.com/v1', apiKey: 'enc:x', encrypted: true },
    ];
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ models: mixedModels }));

    const models = loadCustomModels();
    expect(models).toHaveLength(1);
    expect(models[0].name).toBe('valid');
  });

  it('does not migrate keys already prefixed with enc:', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const encryptedModels = [
      { name: 'gpt-4o', displayName: 'GPT-4o', provider: 'openai', apiUrl: 'https://api.openai.com/v1', apiKey: 'enc:abc', encrypted: true },
    ];
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ models: encryptedModels }));

    loadCustomModels();
    expect(cryptoStore.backupFile).not.toHaveBeenCalled();
  });

  it('does not migrate keys prefixed with fallback:', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const fallbackModels = [
      { name: 'gpt-4o', displayName: 'GPT-4o', provider: 'openai', apiUrl: 'https://api.openai.com/v1', apiKey: 'fallback:abc', encrypted: true },
    ];
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ models: fallbackModels }));

    loadCustomModels();
    expect(cryptoStore.backupFile).not.toHaveBeenCalled();
  });

  it('does not migrate keys with value "none"', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const noneModels = [
      { name: 'gpt-4o', displayName: 'GPT-4o', provider: 'openai', apiUrl: 'https://api.openai.com/v1', apiKey: 'none', encrypted: true },
    ];
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ models: noneModels }));

    loadCustomModels();
    expect(cryptoStore.backupFile).not.toHaveBeenCalled();
  });

  // ─── BUG-01 Regression ─────────────────────────────────────────────────────
  // Ensures that models loaded from the providers schema produce names using the
  // hash-based generateModelPlaceholderId() function (numeric suffix), NOT the
  // broken string-concatenation format that caused "unknown model key" errors.
  it('[BUG-01] providers schema: model name must use numeric hash placeholder', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const providersFile = {
      providers: [
        {
          id: 'my-openai',
          provider: 'openai',
          apiKey: 'enc:abc',
          apiUrl: 'https://api.openai.com/v1/chat/completions',
          enabled: true,
          encrypted: true,
          models: [
            { id: 'gpt-4o', displayName: 'GPT-4o', enabled: true },
          ],
        },
      ],
    };
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(providersFile));

    const models = loadCustomModels();
    expect(models.length).toBeGreaterThanOrEqual(1);

    for (const model of models) {
      // Must start with 'models/MODEL_PLACEHOLDER_M'
      expect(model.name).toMatch(/^models\/MODEL_PLACEHOLDER_M/);
      // The suffix after 'M' must be a pure number (hash-based)
      const suffix = model.name.replace('models/MODEL_PLACEHOLDER_M', '');
      expect(suffix).toMatch(/^\d+$/);
      // Must NOT contain underscores or provider names (old broken format)
      expect(model.name).not.toContain('openai_');
      expect(model.name).not.toContain('gpt-4o');
    }
  });

  it('[BUG-01] providers schema: disabled providers are skipped (=== false, not falsy)', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const providersFile = {
      providers: [
        {
          id: 'disabled-provider',
          provider: 'openai',
          apiKey: 'enc:abc',
          apiUrl: 'https://api.openai.com/v1/chat/completions',
          enabled: false,
          models: [{ id: 'gpt-4o', enabled: true }],
        },
        {
          id: 'enabled-provider',
          provider: 'anthropic',
          apiKey: 'enc:abc',
          apiUrl: 'https://api.anthropic.com/v1/messages',
          // enabled is undefined — should default to active
          models: [{ id: 'claude-3-5-sonnet-latest', enabled: true }],
        },
      ],
    };
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(providersFile));

    const models = loadCustomModels();
    // Only the enabled-provider's model should appear
    expect(models.length).toBe(1);
    expect(models[0].provider).toBe('anthropic');
  });

  it('[BUG-01] providers schema: disabled models are skipped (=== false, not falsy)', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const providersFile = {
      providers: [
        {
          id: 'my-provider',
          provider: 'openai',
          apiKey: 'enc:abc',
          apiUrl: 'https://api.openai.com/v1/chat/completions',
          enabled: true,
          models: [
            { id: 'gpt-4o', enabled: false },
            { id: 'gpt-4o-mini' },    // undefined enabled → should be active
          ],
        },
      ],
    };
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(providersFile));

    const models = loadCustomModels();
    // Only gpt-4o-mini (undefined enabled) should appear, not disabled gpt-4o
    expect(models.length).toBe(1);
    expect(models[0].externalModelName).toBe('gpt-4o-mini');
  });
});
