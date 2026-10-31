import { describe, expect, it } from 'vitest';
import {
  parseAccountsJson,
  normalizeAccountEntry,
  findMatchingAccount,
  mergeAccountWithExisting,
} from './account-import';

describe('Account Import & Normalization', () => {
  it('parses raw array format (antigravity_accounts_2026-09-11.json)', () => {
    const rawJson = `[
      {
        "email": "user1@example.com",
        "refresh_token": "1//mock-refresh-token-vector-01"
      },
      {
        "email": "user2@example.com",
        "refresh_token": "1//mock-refresh-token-vector-02"
      }
    ]`;

    const list = parseAccountsJson(rawJson);
    expect(list).toHaveLength(2);
    expect(list[0].email).toBe('user1@example.com');
  });

  it('parses wrapped object formats ({ accounts: [...] }, { providers: [...] })', () => {
    const wrappedAccounts = JSON.stringify({
      accounts: [{ email: 'test@example.com', refresh_token: '1//test' }],
    });
    expect(parseAccountsJson(wrappedAccounts)).toHaveLength(1);

    const wrappedProviders = JSON.stringify({
      providers: [{ name: 'Prov', apiKey: 'ya29.test' }],
    });
    expect(parseAccountsJson(wrappedProviders)).toHaveLength(1);

    expect(parseAccountsJson('invalid json {')).toHaveLength(0);
  });

  it('normalizes account with email and refresh_token and generates default models', () => {
    const raw = {
      email: 'user1@example.com',
      refresh_token: '1//mock-refresh-token-vector-01',
    };

    const normalized = normalizeAccountEntry(raw, 0);
    expect(normalized).not.toBeNull();
    expect(normalized?.email).toBe('user1@example.com');
    expect(normalized?.name).toBe('user1');
    expect(normalized?.refreshToken).toBe('1//mock-refresh-token-vector-01');
    expect(normalized?.provider).toBe('google');
    expect(normalized?.apiUrl).toBe('https://generativelanguage.googleapis.com/v1beta');
    expect(normalized?.models).toHaveLength(4);
    expect(normalized?.models[0].id).toBe('gemini-3.8-flash-tiered');
    expect(normalized?.models[0].displayName).toBe('Gemini 3.8 Flash');
  });

  it('detects token aliases (raw.token starting with 1// vs ya29.)', () => {
    const refreshRaw = { email: 'user1@gmail.com', token: '1//refresh123' };
    const norm1 = normalizeAccountEntry(refreshRaw);
    expect(norm1?.refreshToken).toBe('1//refresh123');
    expect(norm1?.apiKey).toBe('');

    const accessRaw = { email: 'user2@gmail.com', token: 'ya29.access123' };
    const norm2 = normalizeAccountEntry(accessRaw);
    expect(norm2?.apiKey).toBe('ya29.access123');
  });

  it('correctly matches and merges with existing accounts cache', () => {
    const existingCache = [
      {
        id: 'google-existing-1',
        name: 'sneakers (IDE)',
        email: 'tester@example.com',
        apiKey: 'ya29.oldAccess',
        refreshToken: '1//oldRefresh',
        models: [{ id: 'gemini-3.8-flash-tiered', displayName: 'Gemini 3.8 Flash', enabled: true }],
      },
    ];

    const candidate = normalizeAccountEntry({
      email: 'tester@example.com',
      refresh_token: '1//newRefresh',
    });
    expect(candidate).not.toBeNull();

    const matched = findMatchingAccount(candidate!, existingCache);
    expect(matched).toBeDefined();
    expect(matched?.id).toBe('google-existing-1');

    const merged = mergeAccountWithExisting(candidate!, matched);
    expect(merged.id).toBe('google-existing-1');
    expect(merged.name).toBe('sneakers (IDE)');
    expect(merged.refreshToken).toBe('1//newRefresh');
    expect(merged.models).toHaveLength(1); // keeps existing configured models
  });
});
