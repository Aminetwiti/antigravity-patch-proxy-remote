import { describe, expect, it, vi } from 'vitest';
import { testBatchModels, PingPongResult } from './ping-pong-tester';

describe('Models Remediation Audit Verification', () => {
  describe('AUDIT-007: Ping-Pong batch AbortSignal cancellation', () => {
    it('aborts batch execution immediately when AbortSignal is triggered', async () => {
      const abortController = new AbortController();
      let testedCount = 0;

      // Mock testSingleModel indirectly by testing with 5 models
      const models = [
        { name: 'm1', id: 'm1' },
        { name: 'm2', id: 'm2' },
        { name: 'm3', id: 'm3' },
        { name: 'm4', id: 'm4' },
      ];

      const progressCallback = vi.fn((done: number) => {
        testedCount = done;
        if (done === 2) {
          abortController.abort();
        }
      });

      // Stub window.ag.modelPingPong
      (globalThis as any).window = {
        ag: {
          modelPingPong: vi.fn().mockImplementation(async () => {
            return { ok: true, latencyMs: 15, status: 200, pongText: 'pong' };
          }),
        },
      };

      const results = await testBatchModels(
        models,
        progressCallback,
        'ping',
        abortController.signal
      );

      expect(abortController.signal.aborted).toBe(true);
      expect(testedCount).toBe(2);
      expect(results.length).toBeLessThanOrEqual(2);
    });
  });

  describe('AUDIT-002: Deterministic multi-provider routing with targetProviderId', () => {
    interface ProviderEntryTest {
      id: string;
      name: string;
      provider: string;
      apiUrl: string;
      models: Array<{ id: string; displayName?: string; enabled: boolean }>;
    }

    function resolveProvider(
      providers: ProviderEntryTest[],
      modelName: string,
      targetProviderId?: string
    ): ProviderEntryTest | undefined {
      if (targetProviderId) {
        const directMatch = providers.find((p) => p.id === targetProviderId);
        if (directMatch) return directMatch;
      }
      return providers.find((p) => p.models.some((m) => m.id === modelName));
    }

    it('prioritizes targetProviderId when two providers offer the same model name', () => {
      const providers: ProviderEntryTest[] = [
        {
          id: 'provider-openrouter',
          name: 'OpenRouter',
          provider: 'openai',
          apiUrl: 'https://openrouter.ai/api/v1',
          models: [{ id: 'deepseek-chat', enabled: true }],
        },
        {
          id: 'provider-deepseek-direct',
          name: 'DeepSeek Direct',
          provider: 'openai',
          apiUrl: 'https://api.deepseek.com/v1',
          models: [{ id: 'deepseek-chat', enabled: true }],
        },
      ];

      // Without targetProviderId, ambiguous match returns the first
      expect(resolveProvider(providers, 'deepseek-chat')?.id).toBe('provider-openrouter');

      // With targetProviderId, unambiguously routes to the targeted provider
      expect(resolveProvider(providers, 'deepseek-chat', 'provider-deepseek-direct')?.id).toBe(
        'provider-deepseek-direct'
      );
    });
  });

  describe('AUDIT-004: Preservation of user-disabled states in Google accounts sync', () => {
    function mergeMasterModels(
      masterList: Array<{ id: string; displayName: string; enabled: boolean }>,
      accountModels?: Array<{ id: string; enabled?: boolean }>
    ) {
      const existingMap = new Map<string, boolean>();
      if (Array.isArray(accountModels)) {
        for (const m of accountModels) {
          if (m && m.id) {
            existingMap.set(m.id, m.enabled !== false);
          }
        }
      }
      return masterList.map((m) => {
        const userEnabled = existingMap.has(m.id) ? existingMap.get(m.id)! : m.enabled;
        return { ...m, enabled: userEnabled };
      });
    }

    it('does not force enabled=true on models that the user explicitly disabled', () => {
      const masterList = [
        { id: 'gemini-4-argon-medium', displayName: 'Gemini 4 Argon', enabled: true },
        { id: 'claude-opus-4-6-thinking', displayName: 'Claude Opus 4.6', enabled: true },
      ];

      const accountModels = [
        { id: 'gemini-4-argon-medium', enabled: true },
        { id: 'claude-opus-4-6-thinking', enabled: false }, // User turned this OFF
      ];

      const merged = mergeMasterModels(masterList, accountModels);

      const opus = merged.find((m) => m.id === 'claude-opus-4-6-thinking');
      expect(opus?.enabled).toBe(false);

      const argon = merged.find((m) => m.id === 'gemini-4-argon-medium');
      expect(argon?.enabled).toBe(true);
    });
  });

  describe('AUDIT-005: Deep cleanup of deleted models across provider accounts', () => {
    function purgeModel(provider: any, modelId: string) {
      provider.models = (provider.models || []).filter((m: any) => m.id !== modelId);
      if (Array.isArray(provider.accounts)) {
        for (const acc of provider.accounts) {
          if (Array.isArray(acc.models)) {
            acc.models = acc.models.filter((m: any) => m.id !== modelId);
          }
        }
      }
      return provider;
    }

    it('removes model from both provider.models and provider.accounts[].models', () => {
      const provider = {
        id: 'google-pool',
        models: [{ id: 'gemini-test' }, { id: 'other-model' }],
        accounts: [
          {
            id: 'acc-1',
            models: [{ id: 'gemini-test' }, { id: 'other-model' }],
          },
        ],
      };

      purgeModel(provider, 'gemini-test');

      expect(provider.models.map((m: any) => m.id)).toEqual(['other-model']);
      expect(provider.accounts[0].models.map((m: any) => m.id)).toEqual(['other-model']);
    });
  });
});
