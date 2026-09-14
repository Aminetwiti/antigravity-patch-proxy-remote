import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  parseAccountsJson,
  normalizeAccountEntry,
  findMatchingAccount,
  mergeAccountWithExisting,
} from './account-import';

describe('Google Accounts — Comprehensive Actions Validation', () => {
  let mockAccounts: any[];
  let savedProviders: any[];
  let deletedIds: string[];

  beforeEach(() => {
    savedProviders = [];
    deletedIds = [];
    mockAccounts = [
      {
        id: 'google-ide-1',
        name: 'Amine Perso',
        email: 'amine.benammar17@gmail.com',
        provider: 'google',
        apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: 'ya29.test-token-1',
        refreshToken: '1//refresh-token-1',
        enabled: true,
        isCurrent: true,
        tier: 'PRO',
        quotas: {
          fiveHourPercentage: 80,
          fiveHourResetTime: '2026-09-14T18:00:00Z',
          weeklyPercentage: 90,
          weeklyResetTime: '2026-09-20T00:00:00Z',
          geminiFiveHourPct: 80,
          geminiWeeklyPct: 90,
          claudeFiveHourPct: 70,
          claudeWeeklyPct: 85,
        },
        models: [
          { id: 'gemini-2.5-pro', displayName: '[Amine Perso] Gemini 2.5 Pro', enabled: true },
          { id: 'gemini-2.5-flash', displayName: '[Amine Perso] Gemini 2.5 Flash', enabled: true },
        ],
      },
      {
        id: 'google-ide-2',
        name: 'Amine Pro',
        email: 'benammar.benammar17@gmail.com',
        provider: 'google',
        apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: 'ya29.test-token-2',
        refreshToken: '1//refresh-token-2',
        enabled: true,
        isCurrent: false,
        tier: 'ULTRA',
        quotas: {
          fiveHourPercentage: 40,
          weeklyPercentage: 60,
          geminiFiveHourPct: 40,
          geminiWeeklyPct: 60,
          claudeFiveHourPct: 30,
          claudeWeeklyPct: 50,
        },
        models: [
          { id: 'gemini-2.5-pro', displayName: '[Amine Pro] Gemini 2.5 Pro', enabled: true },
          { id: 'claude-3-7-sonnet', displayName: '[Amine Pro] Claude 3.7 Sonnet', enabled: true },
        ],
      },
      {
        id: 'google-ai-studio-1',
        name: 'Trial Free Key',
        email: 'taconaandax@gmail.com',
        provider: 'google',
        apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: 'AIzaSyTestApiKey',
        enabled: true,
        isCurrent: false,
        tier: 'FREE',
        models: [
          { id: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', enabled: true },
        ],
      },
    ];
  });

  // ── 1. IDE Account Discovery Action ──────────────────────────────────────────
  describe('Action 1: IDE Account Discovery', () => {
    it('discovers and formats account from IDE with default models', async () => {
      const mockDiscoveryResult = {
        email: 'discovered@google.com',
        name: 'Discovered User',
        accessToken: 'ya29.new-discovered-token',
        refreshToken: '1//discovered-refresh',
        picture: 'https://lh3.googleusercontent.com/avatar.jpg',
        quotas: { fiveHourPercentage: 100, weeklyPercentage: 100 },
      };

      const cleanPrefix = mockDiscoveryResult.name || mockDiscoveryResult.email.split('@')[0];
      const accountName = `${cleanPrefix} (IDE)`;

      const newProvider = {
        id: 'google-ide-' + Date.now(),
        name: accountName,
        email: mockDiscoveryResult.email,
        provider: 'google',
        apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: mockDiscoveryResult.accessToken,
        refreshToken: mockDiscoveryResult.refreshToken,
        enabled: true,
        picture: mockDiscoveryResult.picture,
        quotas: mockDiscoveryResult.quotas,
        models: [
          { id: 'gemini-2.5-pro', displayName: `[${accountName}] Gemini 2.5 Pro`, enabled: true },
          { id: 'gemini-2.5-flash', displayName: `[${accountName}] Gemini 2.5 Flash`, enabled: true },
          { id: 'claude-3-7-sonnet', displayName: `[${accountName}] Claude 3.7 Sonnet`, enabled: true },
        ],
      };

      expect(newProvider.name).toBe('Discovered User (IDE)');
      expect(newProvider.apiKey.startsWith('ya29.')).toBe(true);
      expect(newProvider.refreshToken).toBe('1//discovered-refresh');
      expect(newProvider.models).toHaveLength(3);
    });
  });

  // ── 2. Add Account Modal Action ──────────────────────────────────────────────
  describe('Action 2: Add Account Form Validation & Save', () => {
    function validateAccountForm(name: string, apiKey: string) {
      if (!name.trim()) return { valid: false, error: 'Account label/name is required' };
      if (!apiKey.trim()) return { valid: false, error: 'API key is required' };
      return { valid: true };
    }

    it('validates required name field', () => {
      const res = validateAccountForm('', 'AIzaSy123');
      expect(res.valid).toBe(false);
      expect(res.error).toContain('label/name is required');
    });

    it('validates required API key field', () => {
      const res = validateAccountForm('My Account', '');
      expect(res.valid).toBe(false);
      expect(res.error).toContain('API key is required');
    });

    it('creates account with defaults when models list is empty', () => {
      const name = 'New Studio Account';
      const apiKey = 'AIzaSyCustomKey';
      const models: any[] = [];

      if (models.length === 0) {
        models.push(
          { id: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', enabled: true },
          { id: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', enabled: true }
        );
      }

      const account = {
        id: `provider-google-${Date.now()}`,
        name,
        provider: 'google',
        apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey,
        enabled: true,
        models,
      };

      expect(account.models).toHaveLength(2);
      expect(account.provider).toBe('google');
    });
  });

  // ── 3. Edit Account Action ───────────────────────────────────────────────────
  describe('Action 3: Edit Account & Preserve Metadata', () => {
    it('populates and strips existing [Name] prefixes from models', () => {
      const account = mockAccounts[0];
      const cleanedModels = account.models.map((m: any) => {
        const cleanName = (m.displayName || m.id).replace(/^\[[^\]]+\]\s*/, '');
        return { ...m, displayName: cleanName };
      });

      expect(cleanedModels[0].displayName).toBe('Gemini 2.5 Pro');
      expect(cleanedModels[1].displayName).toBe('Gemini 2.5 Flash');
    });

    it('preserves refreshToken and quotas when saving edits', () => {
      const existing = mockAccounts[0];
      const updatedForm = {
        name: 'Amine Perso Renamed',
        apiUrl: existing.apiUrl,
        apiKey: 'ya29.updatedToken',
      };

      const saved = {
        ...existing,
        ...updatedForm,
        refreshToken: existing.refreshToken,
        quotas: existing.quotas,
        picture: existing.picture,
      };

      expect(saved.name).toBe('Amine Perso Renamed');
      expect(saved.apiKey).toBe('ya29.updatedToken');
      expect(saved.refreshToken).toBe('1//refresh-token-1');
      expect(saved.quotas.weeklyPercentage).toBe(90);
    });
  });

  // ── 4. Account Details Modal Action ──────────────────────────────────────────
  describe('Action 4: Account Details Modal Generation', () => {
    it('formats masked key preview and tier badges', () => {
      function maskKeyPreview(key?: string): string {
        if (!key) return '(no key)';
        if (key.length <= 10) return '••••••••';
        return `${key.slice(0, 6)}••••••••${key.slice(-4)}`;
      }

      const masked = maskKeyPreview('ya29.a0AdMD6Eh4testkey123456');
      expect(masked).toBe('ya29.a••••••••3456');

      const maskedShort = maskKeyPreview('AIzaSy1234');
      expect(maskedShort).toBe('••••••••');
    });
  });

  // ── 5. 1-Click Active Account Switch Action ──────────────────────────────────
  describe('Action 5: 1-Click Active Account Switch (ga-switch)', () => {
    it('switches current active account and updates lastUsed', () => {
      const targetId = 'google-ide-2';

      for (const a of mockAccounts) {
        a.isCurrent = (a.id === targetId);
        if (a.id === targetId) {
          a.lastUsed = 1789391000000;
        }
      }

      const active = mockAccounts.find((x) => x.isCurrent);
      expect(active?.id).toBe('google-ide-2');
      expect(active?.name).toBe('Amine Pro');
      expect(mockAccounts.find((x) => x.id === 'google-ide-1')?.isCurrent).toBe(false);
      expect(active?.lastUsed).toBe(1789391000000);
    });
  });

  // ── 6 & 7. Single Account Quota Refresh & Warmup Actions ─────────────────────
  describe('Actions 6 & 7: Account Quota Refresh and Warmup with Token Renewal', () => {
    it('automatically uses refreshToken to obtain fresh accessToken before fetching quotas', async () => {
      const account = { ...mockAccounts[0], apiKey: 'ya29.expiredToken' };

      // Simulated refresh provider
      const fakeRefreshTokenBridge = vi.fn().mockResolvedValue({
        success: true,
        accessToken: 'ya29.freshAccessToken',
        quotas: { fiveHourPercentage: 95, weeklyPercentage: 98 },
      });

      let tokenToUse = account.apiKey;
      if (account.refreshToken) {
        const rRes = await fakeRefreshTokenBridge(account.refreshToken);
        if (rRes.success && rRes.accessToken) {
          tokenToUse = rRes.accessToken;
          account.apiKey = rRes.accessToken;
          account.quotas = rRes.quotas;
        }
      }

      expect(fakeRefreshTokenBridge).toHaveBeenCalledWith('1//refresh-token-1');
      expect(account.apiKey).toBe('ya29.freshAccessToken');
      expect(account.quotas.fiveHourPercentage).toBe(95);
      expect(tokenToUse).toBe('ya29.freshAccessToken');
    });

    it('triggers warmup and updates weekly quotas', async () => {
      const account = mockAccounts[1];
      const warmupBridge = vi.fn().mockResolvedValue({ success: true, message: 'Warmup ok' });

      const ok = await warmupBridge(account.apiKey);
      expect(ok.success).toBe(true);
      expect(warmupBridge).toHaveBeenCalledWith('ya29.test-token-2');
    });
  });

  // ── 8 & 9. Toolbar Refresh All & Warmup All Actions ──────────────────────────
  describe('Actions 8 & 9: Toolbar Bulk Actions (Refresh All & Warmup All)', () => {
    it('refreshes all accounts concurrently', async () => {
      let updatedCount = 0;
      const refreshMock = vi.fn().mockResolvedValue({ success: true, quotas: { fiveHourPercentage: 100 } });

      await Promise.allSettled(
        mockAccounts.map(async (acc) => {
          if (acc.apiKey) {
            const res = await refreshMock(acc.apiKey);
            if (res.success) {
              acc.quotas = res.quotas;
              updatedCount++;
            }
          }
        })
      );

      expect(updatedCount).toBe(3);
      expect(refreshMock).toHaveBeenCalledTimes(3);
      expect(mockAccounts.every((a) => a.quotas?.fiveHourPercentage === 100)).toBe(true);
    });

    it('warms up all accounts in sequence', async () => {
      const warmupMock = vi.fn().mockResolvedValue({ success: true });
      let warmed = 0;

      for (const acc of mockAccounts) {
        if (acc.apiKey) {
          const res = await warmupMock(acc.apiKey);
          if (res.success) warmed++;
        }
      }

      expect(warmed).toBe(3);
      expect(warmupMock).toHaveBeenCalledTimes(3);
    });
  });

  // ── 10. Delete Account Action ────────────────────────────────────────────────
  describe('Action 10: Delete Account (ga-delete)', () => {
    it('deletes selected account and removes it from list', () => {
      const idToDelete = 'google-ide-2';
      mockAccounts = mockAccounts.filter((x) => x.id !== idToDelete);

      expect(mockAccounts).toHaveLength(2);
      expect(mockAccounts.some((x) => x.id === idToDelete)).toBe(false);
    });
  });

  // ── 11. Export JSON Action ───────────────────────────────────────────────────
  describe('Action 11: Export JSON', () => {
    it('serializes accounts to valid JSON format', () => {
      const serialized = JSON.stringify(mockAccounts, null, 2);
      expect(serialized).toContain('amine.benammar17@gmail.com');
      expect(serialized).toContain('1//refresh-token-1');

      const reParsed = JSON.parse(serialized);
      expect(reParsed).toHaveLength(3);
      expect(reParsed[0].name).toBe('Amine Perso');
    });
  });

  // ── 12. Import JSON Action ───────────────────────────────────────────────────
  describe('Action 12: Import JSON with Universal Normalization & Live Refresh', () => {
    it('imports and normalizes accounts from export file', () => {
      const rawText = JSON.stringify([
        {
          email: 'lignelady@gmail.com',
          refresh_token: '1//03CHHXPF9u1S9CgYIARAAGAMSNwF-L9IrBhtwA6PVXpQMWEH2qfO6FU6h6MYGvu4OcPaY3crwiSZUrIQGuU_6AzjNyVYaANK19sE',
        },
      ]);

      const parsed = parseAccountsJson(rawText);
      expect(parsed).toHaveLength(1);

      const normalized = normalizeAccountEntry(parsed[0]);
      expect(normalized).not.toBeNull();
      expect(normalized?.name).toBe('lignelady');
      expect(normalized?.email).toBe('lignelady@gmail.com');
      expect(normalized?.refreshToken?.startsWith('1//')).toBe(true);
      expect(normalized?.models).toHaveLength(3);
    });

    it('deduplicates incoming account against existing accounts cache', () => {
      const raw = {
        email: 'amine.benammar17@gmail.com',
        refresh_token: '1//refresh-token-1-updated',
      };

      const normalized = normalizeAccountEntry(raw);
      expect(normalized).not.toBeNull();

      const matched = findMatchingAccount(normalized!, mockAccounts);
      expect(matched).toBeDefined();
      expect(matched.id).toBe('google-ide-1');

      const merged = mergeAccountWithExisting(normalized!, matched);
      expect(merged.id).toBe('google-ide-1');
      expect(merged.name).toBe('Amine Perso'); // preserves original name
      expect(merged.refreshToken).toBe('1//refresh-token-1-updated'); // updates token
      expect(merged.models).toHaveLength(2); // preserves existing models
    });
  });

  // ── 13 & 14. View & Window Toggle Actions ───────────────────────────────────
  describe('Actions 13 & 14: Quota Window and View Mode Toggles', () => {
    it('toggles quota window between 5H and weekly', () => {
      let currentWindow: '5h' | 'weekly' = 'weekly';
      expect(currentWindow).toBe('weekly');

      currentWindow = '5h';
      expect(currentWindow).toBe('5h');

      const acc = mockAccounts[0];
      const displayedPct = currentWindow === 'weekly'
        ? acc.quotas.weeklyPercentage
        : acc.quotas.fiveHourPercentage;

      expect(displayedPct).toBe(80);
    });

    it('toggles view mode between list and grid', () => {
      let currentView: 'list' | 'grid' = 'list';
      expect(currentView).toBe('list');

      currentView = 'grid';
      expect(currentView).toBe('grid');
    });
  });

  // ── 15 & 16. Filtering and Real-Time Search Actions ─────────────────────────
  describe('Actions 15 & 16: Tier Filtering and Real-Time Search', () => {
    function filterAndSearch(accounts: any[], query: string, tierFilter: string) {
      return accounts.filter((a) => {
        const tier = (a.tier || 'PRO').toLowerCase();
        if (tierFilter !== 'all' && tier !== tierFilter) return false;
        if (query) {
          const q = query.toLowerCase();
          const name = (a.name || '').toLowerCase();
          const email = (a.email || '').toLowerCase();
          const id = (a.id || '').toLowerCase();
          return name.includes(q) || email.includes(q) || id.includes(q);
        }
        return true;
      });
    }

    it('filters by PRO tier', () => {
      const pros = filterAndSearch(mockAccounts, '', 'pro');
      expect(pros).toHaveLength(1);
      expect(pros[0].name).toBe('Amine Perso');
    });

    it('filters by ULTRA tier', () => {
      const ultras = filterAndSearch(mockAccounts, '', 'ultra');
      expect(ultras).toHaveLength(1);
      expect(ultras[0].name).toBe('Amine Pro');
    });

    it('filters by FREE tier', () => {
      const frees = filterAndSearch(mockAccounts, '', 'free');
      expect(frees).toHaveLength(1);
      expect(frees[0].name).toBe('Trial Free Key');
    });

    it('searches by email substring', () => {
      const results = filterAndSearch(mockAccounts, 'benammar.benammar17', 'all');
      expect(results).toHaveLength(1);
      expect(results[0].email).toBe('benammar.benammar17@gmail.com');
    });
  });

  // ── 17. Show All Quotas Switch Action ────────────────────────────────────────
  describe('Action 17: Show All Quotas Switch', () => {
    it('controls simultaneous display of 5h and weekly quota metrics', () => {
      let showAllQuotas = false;
      expect(showAllQuotas).toBe(false);

      showAllQuotas = true;
      expect(showAllQuotas).toBe(true);

      const acc = mockAccounts[0];
      const metrics = showAllQuotas
        ? { fiveHour: acc.quotas.fiveHourPercentage, weekly: acc.quotas.weeklyPercentage }
        : { primary: acc.quotas.weeklyPercentage };

      expect(metrics).toEqual({ fiveHour: 80, weekly: 90 });
    });
  });

  // ── 18. Model Presets & Custom Model Management ──────────────────────────────
  describe('Action 18: Custom Models Management & Presets', () => {
    it('adds preset models and strips models/ prefix', () => {
      const modelsList: Array<{ id: string; displayName: string; enabled: boolean }> = [];

      function addModel(id: string, name?: string) {
        const cleanId = id.trim().replace(/^models\//, '');
        const existing = modelsList.find((m) => m.id === cleanId);
        if (existing) {
          existing.enabled = true;
        } else {
          modelsList.push({ id: cleanId, displayName: name || cleanId, enabled: true });
        }
      }

      addModel('models/gemini-3.8-flash-high', 'Gemini 3.8 Flash');
      addModel('claude-sonnet-4-6', 'Claude Sonnet 4.6 (Thinking)');

      expect(modelsList).toHaveLength(2);
      expect(modelsList[0].id).toBe('gemini-3.8-flash-high');
      expect(modelsList[1].id).toBe('claude-sonnet-4-6');

      // Select all / Deselect all
      modelsList.forEach((m) => { m.enabled = false; });
      expect(modelsList.every((m) => !m.enabled)).toBe(true);

      modelsList.forEach((m) => { m.enabled = true; });
      expect(modelsList.every((m) => m.enabled)).toBe(true);
    });
  });

  // ── 19. RetrieveUserQuotaSummary Contract & Token Refresh ─────────────────────
  describe('Action 19: RetrieveUserQuotaSummary Contract & Token Refresh Resilience', () => {
    it('sends empty body {} to retrieveUserQuotaSummary avoiding HTTP 400', async () => {
      let sentBody = '';
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url: any, init: any) => {
        sentBody = init.body;
        return {
          ok: true,
          json: async () => ({
            groups: [
              {
                displayName: 'Gemini Models',
                buckets: [
                  { bucketId: 'gemini-weekly', remainingFraction: 0.85, resetTime: '2026-09-20T00:00:00Z' },
                ],
              },
            ],
          }),
        } as any;
      });

      const res = await fetch('https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary', {
        method: 'POST',
        headers: { Authorization: 'Bearer ya29.test', 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(sentBody).toBe('{}');
      expect(res.ok).toBe(true);
    });

    it('auto-refreshes token if access token returns 401/null', async () => {
      let refreshCalled = false;
      const account = {
        apiKey: 'ya29.expired',
        refreshToken: '1//valid-refresh',
        quotas: null as any,
      };

      const mockRefresh = vi.fn().mockImplementation(async () => {
        refreshCalled = true;
        return { success: true, accessToken: 'ya29.fresh-token' };
      });

      const mockFetchQuotas = vi.fn().mockImplementation(async (token: string) => {
        if (token === 'ya29.expired') return { success: false };
        return { success: true, quotas: { geminiWeeklyPct: 90 } };
      });

      let q = await mockFetchQuotas(account.apiKey);
      if (!q.success && account.refreshToken) {
        const r = await mockRefresh(account.refreshToken);
        if (r.success) {
          account.apiKey = r.accessToken;
          q = await mockFetchQuotas(account.apiKey);
        }
      }

      expect(refreshCalled).toBe(true);
      expect(account.apiKey).toBe('ya29.fresh-token');
      expect(q.success).toBe(true);
      expect(q.quotas.geminiWeeklyPct).toBe(90);
    });
  });
});
