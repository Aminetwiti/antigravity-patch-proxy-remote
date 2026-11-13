import { describe, it, expect } from 'vitest';
import {
  exportProvidersToBase64,
  parseProvidersFromBase64,
  mergeProviderConfigs,
  exportEncryptedConfig,
  importEncryptedConfig,
} from '../../../services/security/configExchange';
import type { ProviderFileEntry } from '../../../compat/customModelStore';

const mockProviders: ProviderFileEntry[] = [
  {
    id: 'prov-1',
    name: 'OpenAI Test',
    provider: 'openai',
    apiUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-test-123',
    enabled: true,
    models: [{ id: 'gpt-4o', displayName: 'GPT-4o', enabled: true }],
  },
];

describe('configExchange', () => {
  it('round-trips providers via Base64 export and parse', () => {
    const base64 = exportProvidersToBase64(mockProviders);
    expect(typeof base64).toBe('string');
    expect(base64.length).toBeGreaterThan(0);

    const parsed = parseProvidersFromBase64(base64);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe('prov-1');
    expect(parsed[0].name).toBe('OpenAI Test');
  });

  it('throws helpful error for invalid Base64 input', () => {
    expect(() => parseProvidersFromBase64('invalid-json-base64-!!!')).toThrow();
  });

  it('merges new providers with strategy "merge"', () => {
    const existing: ProviderFileEntry[] = [
      {
        id: 'prov-1',
        name: 'Existing OpenAI',
        provider: 'openai',
        apiUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-old',
        enabled: true,
        models: [{ id: 'gpt-4o', displayName: 'GPT-4o', enabled: true }],
      },
    ];

    const incoming: ProviderFileEntry[] = [
      {
        id: 'prov-1',
        name: 'Updated OpenAI',
        provider: 'openai',
        apiUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-new',
        enabled: true,
        models: [{ id: 'gpt-4o-mini', displayName: 'GPT-4o Mini', enabled: true }],
      },
      {
        id: 'prov-2',
        name: 'Anthropic',
        provider: 'anthropic',
        apiUrl: 'https://api.anthropic.com',
        apiKey: 'sk-ant',
        enabled: true,
        models: [{ id: 'claude-3-5-sonnet', displayName: 'Sonnet', enabled: true }],
      },
    ];

    const result = mergeProviderConfigs(existing, incoming, 'merge');
    expect(result.success).toBe(true);
    expect(result.importedCount).toBe(1);
    expect(result.mergedCount).toBe(1);
    expect(result.providers).toHaveLength(2);

    const mergedProv1 = result.providers.find((p) => p.id === 'prov-1')!;
    expect(mergedProv1.models).toHaveLength(2); // gpt-4o and gpt-4o-mini merged
  });

  it('overwrites existing providers with strategy "overwrite"', () => {
    const existing: ProviderFileEntry[] = [
      {
        id: 'prov-1',
        name: 'Old Name',
        provider: 'openai',
        apiUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-old',
        enabled: true,
        models: [],
      },
    ];

    const incoming: ProviderFileEntry[] = [
      {
        id: 'prov-1',
        name: 'New Name',
        provider: 'openai',
        apiUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-new',
        enabled: true,
        models: [{ id: 'gpt-4o', enabled: true }],
      },
    ];

    const result = mergeProviderConfigs(existing, incoming, 'overwrite');
    expect(result.providers[0].name).toBe('New Name');
    expect(result.providers[0].apiKey).toBe('sk-new');
  });

  it('skips existing providers with strategy "skip"', () => {
    const existing: ProviderFileEntry[] = [
      {
        id: 'prov-1',
        name: 'Existing Name',
        provider: 'openai',
        apiUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-old',
        enabled: true,
        models: [],
      },
    ];

    const incoming: ProviderFileEntry[] = [
      {
        id: 'prov-1',
        name: 'Should Be Skipped',
        provider: 'openai',
        apiUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-new',
        enabled: true,
        models: [],
      },
    ];

    const result = mergeProviderConfigs(existing, incoming, 'skip');
    expect(result.skippedCount).toBe(1);
    expect(result.providers[0].name).toBe('Existing Name');
  });

  it('merges solo Google account into existing Google pool instead of creating orphan provider', () => {
    const existing: ProviderFileEntry[] = [
      {
        id: 'provider-google',
        name: 'Google Gemini',
        provider: 'google',
        apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: 'auto',
        enabled: true,
        models: [{ id: 'gemini-3.8-flash', displayName: 'Gemini 3.8 Flash', enabled: true }],
        accounts: [
          { id: 'google-acc1', email: 'acc1@gmail.com', apiKey: 'ya29.abc', refreshToken: '1//rt1', enabled: true },
        ],
      } as any,
    ];

    const incoming: ProviderFileEntry[] = [
      {
        id: 'google-acc2-gmail-com',
        name: 'Account Two',
        provider: 'google',
        apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: 'ya29.def',
        email: 'acc2@gmail.com',
        refreshToken: '1//rt2',
        enabled: true,
        models: [{ id: 'gemini-3.8-flash', displayName: 'Gemini 3.8 Flash', enabled: true }],
      } as any,
    ];

    const result = mergeProviderConfigs(existing, incoming, 'merge');
    // Should NOT create a second provider
    expect(result.providers).toHaveLength(1);
    expect(result.providers[0].id).toBe('provider-google');
    // Account should be merged into the pool
    const accounts = (result.providers[0] as any).accounts;
    expect(accounts).toHaveLength(2);
    expect(accounts[1].email).toBe('acc2@gmail.com');
    expect(result.mergedCount).toBe(1);
    expect(result.importedCount).toBe(0);
  });

  it('skips duplicate Google solo account already in pool when strategy is skip', () => {
    const existing: ProviderFileEntry[] = [
      {
        id: 'provider-google',
        name: 'Google Gemini',
        provider: 'google',
        apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: 'auto',
        enabled: true,
        models: [{ id: 'gemini-3.8-flash', enabled: true }],
        accounts: [
          { id: 'google-acc1', email: 'acc1@gmail.com', apiKey: 'ya29.abc', enabled: true },
        ],
      } as any,
    ];

    const incoming: ProviderFileEntry[] = [
      {
        id: 'google-acc1-new-id',
        name: 'Same Account',
        provider: 'google',
        apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: 'ya29.xyz',
        email: 'acc1@gmail.com',
        enabled: true,
        models: [],
      } as any,
    ];

    const result = mergeProviderConfigs(existing, incoming, 'skip');
    expect(result.providers).toHaveLength(1);
    expect((result.providers[0] as any).accounts).toHaveLength(1);
    expect(result.skippedCount).toBe(1);
  });

  it('preserves all metadata fields (picture, lastTestedAt, isFamily) during solo merge (AUDIT-002)', () => {
    const existing: ProviderFileEntry[] = [
      {
        id: 'provider-google',
        name: 'Google Gemini',
        provider: 'google',
        apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: 'auto',
        enabled: true,
        models: [{ id: 'gemini-3.8-flash', enabled: true }],
        accounts: [],
      } as any,
    ];

    const incoming: ProviderFileEntry[] = [
      {
        id: 'google-acc-full',
        name: 'Full Account',
        provider: 'google',
        apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: 'ya29.full',
        email: 'full@gmail.com',
        refreshToken: '1//full',
        projectId: 'custom-project',
        tier: 'pro',
        enabled: true,
        picture: 'https://avatar.url/pic.jpg',
        lastTestedAt: 1794500000000,
        createdAt: 1794400000000,
        isFamily: true,
        hasClaude55: true,
        models: [{ id: 'gemini-3.8-flash', enabled: true }],
      } as any,
    ];

    const result = mergeProviderConfigs(existing, incoming, 'merge');
    expect(result.providers).toHaveLength(1);
    const acc = (result.providers[0] as any).accounts[0];
    expect(acc.picture).toBe('https://avatar.url/pic.jpg');
    expect(acc.isFamily).toBe(true);
    expect(acc.hasClaude55).toBe(true);
    expect(acc.lastTestedAt).toBe(1794500000000);
    expect(acc.models).toBeDefined();
    expect(acc.provider).toBeUndefined(); // top-level provider field stripped
  });

  it('prefers canonical provider-google pool over ad-hoc pools (AUDIT-003)', () => {
    const existing: ProviderFileEntry[] = [
      {
        id: 'adhoc-google-pool',
        name: 'Other Google',
        provider: 'google',
        apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: 'auto',
        enabled: true,
        models: [],
        accounts: [{ id: 'adhoc-1', email: 'adhoc@gmail.com' }],
      } as any,
      {
        id: 'provider-google',
        name: 'Google Gemini',
        provider: 'google',
        apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: 'auto',
        enabled: true,
        models: [],
        accounts: [{ id: 'main-1', email: 'main@gmail.com' }],
      } as any,
    ];

    const incoming: ProviderFileEntry[] = [
      {
        id: 'solo-incoming',
        name: 'Solo In',
        provider: 'google',
        email: 'solo@gmail.com',
        apiKey: 'ya29.solo',
      } as any,
    ];

    const result = mergeProviderConfigs(existing, incoming, 'merge');
    const canonicalPool = result.providers.find((p) => p.id === 'provider-google');
    const adhocPool = result.providers.find((p) => p.id === 'adhoc-google-pool');

    expect((canonicalPool as any).accounts).toHaveLength(2);
    expect((adhocPool as any).accounts).toHaveLength(1);
  });

  describe('encrypted config exchange & security bounds', () => {
    it('round-trips encrypted config with valid password', () => {
      const encrypted = exportEncryptedConfig(mockProviders, 'SuperSecretPass123!');
      const decrypted = importEncryptedConfig(encrypted, 'SuperSecretPass123!');
      expect(decrypted).toHaveLength(1);
      expect(decrypted[0].id).toBe('prov-1');
      expect(decrypted[0].apiKey).toBe('sk-test-123');
    });

    it('fails decryption with wrong password', () => {
      const encrypted = exportEncryptedConfig(mockProviders, 'SuperSecretPass123!');
      expect(() => importEncryptedConfig(encrypted, 'WrongPassword')).toThrow();
    });

    it('rejects payload with excessive PBKDF2 iterations (iteration bomb DoS protection)', () => {
      const payload = {
        encrypted: true,
        iterations: 10_000_000,
        salt: '0123456789abcdef0123456789abcdef',
        iv: '0123456789abcdef01234567',
        tag: '0123456789abcdef0123456789abcdef',
        data: Buffer.from('test').toString('base64'),
      };
      const rawBase64 = Buffer.from(JSON.stringify(payload)).toString('base64');
      expect(() => importEncryptedConfig(rawBase64, 'password')).toThrow(/Invalid PBKDF2 iterations/);
    });

    it('rejects payload with dangerously low PBKDF2 iterations', () => {
      const payload = {
        encrypted: true,
        iterations: 50,
        salt: '0123456789abcdef0123456789abcdef',
        iv: '0123456789abcdef01234567',
        tag: '0123456789abcdef0123456789abcdef',
        data: Buffer.from('test').toString('base64'),
      };
      const rawBase64 = Buffer.from(JSON.stringify(payload)).toString('base64');
      expect(() => importEncryptedConfig(rawBase64, 'password')).toThrow(/Invalid PBKDF2 iterations/);
    });
  });
});

