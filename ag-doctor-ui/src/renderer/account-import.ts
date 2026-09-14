/**
 * ag-doctor UI — Account Import & Normalization Helper
 * Supports importing Google accounts exported from Antigravity Manager,
 * token rotators, or other third-party tools.
 */

export interface NormalizedImportAccount {
  id: string;
  name: string;
  email?: string;
  provider: string;
  apiUrl: string;
  apiKey: string;
  refreshToken?: string;
  picture?: string;
  quotas?: any;
  enabled: boolean;
  models: Array<{ id: string; displayName: string; enabled: boolean }>;
}

/**
 * Extracts an array of accounts from raw parsed JSON (array or wrapped in an object).
 */
export function parseAccountsJson(text: string): any[] {
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }

  if (Array.isArray(parsed)) return parsed;

  if (parsed && typeof parsed === 'object') {
    if (Array.isArray(parsed.accounts)) return parsed.accounts;
    if (Array.isArray(parsed.providers)) return parsed.providers;
    if (Array.isArray(parsed.data)) return parsed.data;
    if (Array.isArray(parsed.items)) return parsed.items;
    if (Array.isArray(parsed.models)) return parsed.models;
  }

  return [];
}

/**
 * Normalizes a single raw account object into a standard Antigravity Doctor UI account entry.
 */
export function normalizeAccountEntry(raw: any, index: number = 0): NormalizedImportAccount | null {
  if (!raw || typeof raw !== 'object') return null;

  const email = String(raw.email || raw.accountEmail || raw.mail || raw.username || '').trim();

  let refreshToken = String(raw.refresh_token || raw.refreshToken || '').trim();
  if (!refreshToken && typeof raw.token === 'string') {
    const t = raw.token.trim();
    if (t.startsWith('1//') || t.startsWith('g1//')) {
      refreshToken = t;
    }
  }

  let apiKey = String(raw.apiKey || raw.api_key || raw.accessToken || raw.access_token || raw.key || '').trim();
  if (!apiKey && typeof raw.token === 'string') {
    const t = raw.token.trim();
    if (t.startsWith('ya29.') || t.startsWith('AIzaSy')) {
      apiKey = t;
    }
  }

  // Must have at least email, refreshToken, apiKey, or name to be considered an account
  if (!email && !refreshToken && !apiKey && !raw.name && !raw.label) {
    return null;
  }

  const rawName = String(raw.name || raw.label || raw.displayName || '').trim();
  const cleanPrefix = email ? email.split('@')[0] : `Google Account ${index + 1}`;
  const name = rawName || cleanPrefix;
  const cleanLabel = name.replace(/^\[[^\]]+\]\s*/, '');

  const models = Array.isArray(raw.models) && raw.models.length > 0
    ? raw.models.map((m: any) => ({
        id: String(m.id || m.name),
        displayName: String(m.displayName || m.id || m.name),
        enabled: m.enabled !== false,
      }))
    : [
        { id: 'gemini-2.5-pro', displayName: `[${cleanLabel}] Gemini 2.5 Pro`, enabled: true },
        { id: 'gemini-2.5-flash', displayName: `[${cleanLabel}] Gemini 2.5 Flash`, enabled: true },
        { id: 'claude-3-7-sonnet', displayName: `[${cleanLabel}] Claude 3.7 Sonnet`, enabled: true },
      ];

  return {
    id: raw.id || `google-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    email: email || undefined,
    provider: String(raw.provider || 'google'),
    apiUrl: String(raw.apiUrl || 'https://generativelanguage.googleapis.com/v1beta'),
    apiKey,
    refreshToken: refreshToken || undefined,
    picture: raw.picture || undefined,
    quotas: raw.quotas || undefined,
    enabled: raw.enabled !== false,
    models,
  };
}

/**
 * Finds an existing matching account in cache by refreshToken, email, or name.
 */
export function findMatchingAccount(
  candidate: { email?: string; refreshToken?: string; name?: string },
  existingAccounts: any[]
): any | undefined {
  if (!Array.isArray(existingAccounts) || existingAccounts.length === 0) return undefined;

  return existingAccounts.find((x) => {
    if (!x) return false;
    // 1. Match on exact refreshToken
    if (candidate.refreshToken && x.refreshToken && candidate.refreshToken === x.refreshToken) {
      return true;
    }
    // 2. Match on email (case-insensitive)
    if (candidate.email && x.email && candidate.email.toLowerCase() === x.email.toLowerCase()) {
      return true;
    }
    // 3. Match on exact name or email prefix
    if (candidate.name && x.name && candidate.name.toLowerCase() === x.name.toLowerCase()) {
      return true;
    }
    return false;
  });
}

/**
 * Merges normalized account with an existing account, preserving existing IDs, models, and metadata.
 */
export function mergeAccountWithExisting(normalized: NormalizedImportAccount, existing?: any): any {
  if (!existing) {
    return { ...normalized };
  }

  return {
    ...existing,
    id: existing.id || normalized.id,
    name: existing.name || normalized.name,
    email: normalized.email || existing.email,
    provider: existing.provider || normalized.provider,
    apiUrl: existing.apiUrl || normalized.apiUrl,
    apiKey: normalized.apiKey || existing.apiKey,
    refreshToken: normalized.refreshToken || existing.refreshToken,
    picture: normalized.picture || existing.picture,
    quotas: normalized.quotas || existing.quotas,
    enabled: existing.enabled !== false,
    models: existing.models && existing.models.length > 0 ? existing.models : normalized.models,
  };
}
