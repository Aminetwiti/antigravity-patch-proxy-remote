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
vi.mock('electron-log/main', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock cryptoStore
vi.mock('../cryptoStore', () => ({
  encryptString: vi.fn((str: string) => `enc:${str}`),
  decryptString: vi.fn((str: string) => (str.startsWith('enc:') ? str.slice(4) : str)),
}));

// Mock fs/promises and fs
vi.mock('fs/promises', () => ({
  mkdir: vi.fn(async () => undefined),
  readFile: vi.fn(async () => { throw { code: 'ENOENT' }; }),
  writeFile: vi.fn(async () => undefined),
  rename: vi.fn(async () => undefined),
}));

vi.mock('fs', () => ({
  readFileSync: vi.fn(() => { throw { code: 'ENOENT' }; }),
}));

import * as fsPromises from 'fs/promises';
import * as fsSync from 'fs';
import {
  getCustomModelsPath,
  loadCustomModels,
  loadProviders,
  saveProviders,
  saveCustomModels,
  deleteCustomModel,
  maskApiKey,
  encryptApiKeyIfNeeded,
  isMaskedApiKey,
  buildFallbackModelEntry,
  testProviderHealth,
} from '../customModelStore';


describe('customModelStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getCustomModelsPath', () => {
    it('returns custom_models.json path under home directory', () => {
      const p = getCustomModelsPath();
      expect(p).toContain('.gemini');
      expect(p).toContain('antigravity');
      expect(p).toContain('custom_models.json');
    });
  });

  describe('loadProviders', () => {
    it('returns empty array when file does not exist', async () => {
      vi.mocked(fsPromises.readFile).mockRejectedValueOnce({ code: 'ENOENT' });
      const providers = await loadProviders();
      expect(providers).toEqual([]);
    });

    it('returns providers from existing json', async () => {
      const mockData = {
        providers: [
          {
            id: 'p1',
            name: 'OpenAI Test',
            provider: 'openai',
            apiUrl: 'https://api.openai.com/v1',
            apiKey: 'enc:sk-test',
            encrypted: true,
            enabled: true,
            models: [{ id: 'gpt-4o', displayName: 'GPT-4o', enabled: true }],
          },
        ],
      };
      vi.mocked(fsPromises.readFile).mockResolvedValueOnce(JSON.stringify(mockData));

      const providers = await loadProviders();
      expect(providers).toHaveLength(1);
      expect(providers[0].id).toBe('p1');
    });

    it('migrates legacy models to providers when providers array is missing', async () => {
      const mockLegacy = {
        models: [
          {
            name: 'legacy-model-1',
            displayName: 'Legacy 1',
            provider: 'openai',
            apiUrl: 'https://api.openai.com/v1',
            apiKey: 'sk-legacy',
            externalModelName: 'gpt-4',
            encrypted: false,
          },
        ],
      };
      vi.mocked(fsPromises.readFile).mockResolvedValueOnce(JSON.stringify(mockLegacy));
      vi.mocked(fsSync.readFileSync).mockReturnValueOnce(JSON.stringify(mockLegacy));

      const providers = await loadProviders();
      expect(providers).toHaveLength(1);
      expect(providers[0].provider).toBe('openai');
      expect(providers[0].models[0].id).toBe('gpt-4');
    });
  });

  describe('loadCustomModels', () => {
    it('flattens enabled provider models into CustomModelFileEntry objects', async () => {
      const mockData = {
        providers: [
          {
            id: 'p1',
            name: 'OpenAI',
            provider: 'openai',
            apiUrl: 'https://api.openai.com/v1',
            apiKey: 'enc:sk-key',
            enabled: true,
            models: [
              { id: 'deepseek-chat', displayName: 'DeepSeek-V3', enabled: true },
              { id: 'deepseek-reasoner', displayName: 'DeepSeek-R1', enabled: false },
            ],
          },
        ],
      };
      vi.mocked(fsPromises.readFile).mockResolvedValueOnce(JSON.stringify(mockData));

      const models = await loadCustomModels();
      expect(models).toHaveLength(1);
      expect(models[0].name).toBe('p1-deepseek-chat');
      expect(models[0].externalModelName).toBe('deepseek-chat');
    });
  });

  describe('saveProviders & atomicWriteJson', () => {
    it('atomicWriteJson uses tmp file then renames to preserve target file', async () => {
      const providers = [
        {
          id: 'p1',
          name: 'Test Provider',
          provider: 'openai',
          apiUrl: 'https://api.openai.com/v1',
          apiKey: 'enc:123',
          enabled: true,
          models: [],
        },
      ];
      vi.mocked(fsSync.readFileSync).mockReturnValueOnce(JSON.stringify({ models: [] }));

      await saveProviders(providers);

      expect(fsPromises.writeFile).toHaveBeenCalled();
      expect(fsPromises.rename).toHaveBeenCalled();
    });
  });

  describe('deleteCustomModel', () => {
    it('deletes model from corresponding provider without clobbering top-level providers', async () => {
      const mockData = {
        providers: [
          {
            id: 'p1',
            name: 'OpenAI',
            provider: 'openai',
            apiUrl: 'https://api.openai.com/v1',
            apiKey: 'enc:sk-key',
            enabled: true,
            models: [
              { id: 'gpt-4o', displayName: 'GPT-4o', enabled: true },
              { id: 'gpt-3.5', displayName: 'GPT-3.5', enabled: true },
            ],
          },
        ],
      };
      vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify(mockData));
      vi.mocked(fsSync.readFileSync).mockReturnValue(JSON.stringify(mockData));

      await deleteCustomModel('p1-gpt-4o');

      expect(fsPromises.writeFile).toHaveBeenCalled();
      const writtenContent = JSON.parse(vi.mocked(fsPromises.writeFile).mock.calls[0][1] as string);
      expect(writtenContent.providers[0].models).toHaveLength(1);
      expect(writtenContent.providers[0].models[0].id).toBe('gpt-3.5');
    });
  });

  describe('maskApiKey & encryptApiKeyIfNeeded', () => {
    it('maskApiKey hides middle characters for long keys and returns ******** for short ones', () => {
      expect(maskApiKey('none')).toBe('none');
      expect(maskApiKey('enc:sk-1234567890abcdef')).toBe('sk-1...cdef');
    });

    it('encryptApiKeyIfNeeded encrypts unmasked plaintext keys', () => {
      const result = encryptApiKeyIfNeeded('sk-my-real-secret-key');
      expect(result.encrypted).toBe(true);
      expect(result.apiKey).toBe('enc:sk-my-real-secret-key');
    });

    it('encryptApiKeyIfNeeded leaves masked keys as unencrypted pass-throughs', () => {
      const result = encryptApiKeyIfNeeded('sk-1...cdef');
      expect(result.encrypted).toBe(false);
      expect(result.apiKey).toBe('sk-1...cdef');
    });
  });

  describe('buildFallbackModelEntry', () => {
    it('builds valid fallback entry with max tokens set', () => {
      const fallback = buildFallbackModelEntry({
        name: 'test-model',
        provider: 'openai',
        apiKey: 'none',
        apiUrl: 'https://api.openai.com/v1',
        externalModelName: 'test-model',
      });
      expect(fallback.name).toBe('test-model');
      expect(fallback.inputTokenLimit).toBeGreaterThan(0);
      expect(fallback.supportedGenerationMethods).toContain('generateContent');
    });
  });

  // ─── TS-3: isMaskedApiKey ────────────────────────────────────────────────────
  describe('isMaskedApiKey', () => {
    it('matches the ★★★★★★★★ placeholder', () => {
      expect(isMaskedApiKey('********')).toBe(true);
    });

    it('matches the exact 4+...+4 format produced by maskApiKey()', () => {
      // Simulate output of maskApiKey('sk-proj-ABCDEF1234567890')
      expect(isMaskedApiKey('sk-p...7890')).toBe(true);
      expect(isMaskedApiKey('abcd...wxyz')).toBe(true);
    });

    it('does NOT match legitimate keys that contain ... in the middle', () => {
      // A JWT or key with ...  in the middle should not be treated as masked
      expect(isMaskedApiKey('Bearer token...extra.data')).toBe(false);
      expect(isMaskedApiKey('prefix...suffix.extra')).toBe(false);
    });

    it('does NOT match keys with fewer or more than 4 chars around ...', () => {
      expect(isMaskedApiKey('abc...xyz')).toBe(false);   // 3 chars
      expect(isMaskedApiKey('abcde...wxyz')).toBe(false); // 5 chars prefix
      expect(isMaskedApiKey('abcd...wxyz5')).toBe(false); // 5 chars suffix
    });

    it('does NOT match empty string', () => {
      expect(isMaskedApiKey('')).toBe(false);
    });

    it('does NOT match "none"', () => {
      expect(isMaskedApiKey('none')).toBe(false);
    });

    it('does NOT match short keys that would be fully masked', () => {
      // Short keys are masked as '********', not 4+...+4
      expect(isMaskedApiKey('short')).toBe(false);
    });

    it('integrates with encryptApiKeyIfNeeded: masked keys are not re-encrypted', () => {
      // A masked key should be returned as-is with encrypted:false
      const result = encryptApiKeyIfNeeded('abcd...wxyz');
      expect(result.apiKey).toBe('abcd...wxyz');
      expect(result.encrypted).toBe(false);
    });

    it('integrates with encryptApiKeyIfNeeded: plaintext keys ARE encrypted', () => {
      const result = encryptApiKeyIfNeeded('sk-real-api-key-1234567890');
      // The mock encryptString returns 'enc:' + input
      expect(result.apiKey).toMatch(/^enc:/);
      expect(result.encrypted).toBe(true);
    });
  });

  describe('testProviderHealth', () => {
    it('returns error when apiUrl is missing', async () => {
      const res = await testProviderHealth({ apiUrl: '', provider: 'openai' });
      expect(res.success).toBe(false);
      expect(res.error).toContain('API URL is required');
    });

    it('returns error when apiUrl is invalid', async () => {
      const res = await testProviderHealth({ apiUrl: 'not-a-url', provider: 'openai' });
      expect(res.success).toBe(false);
      expect(res.error).toContain('Invalid API URL');
    });
  });
});


