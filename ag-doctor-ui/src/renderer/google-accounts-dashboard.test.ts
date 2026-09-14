import { describe, expect, it } from 'vitest';

function getAccountTier(acc: any): 'PRO' | 'ULTRA' | 'FREE' {
  if (acc.tier) {
    const t = String(acc.tier).toUpperCase();
    if (t.includes('ULTRA')) return 'ULTRA';
    if (t.includes('PRO')) return 'PRO';
    if (t.includes('FREE')) return 'FREE';
  }
  const name = (acc.name || '').toUpperCase();
  if (name.includes('ULTRA')) return 'ULTRA';
  if (name.includes('FREE')) return 'FREE';
  return 'PRO';
}

function formatCompactCountdown(isoDateStr?: string, nowMs = Date.now()): string {
  if (!isoDateStr) return '';
  const target = new Date(isoDateStr).getTime();
  const diffMs = target - nowMs;
  if (isNaN(diffMs) || diffMs <= 0) return '0m';
  const mins = Math.floor(diffMs / 60000);
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return `${days}d ${remHours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${remMins}m`;
  }
  return `${remMins}m`;
}

function formatResetCountdown(isoDateStr?: string, nowMs = Date.now()): string {
  if (!isoDateStr) return '';
  const target = new Date(isoDateStr).getTime();
  const diffMs = target - nowMs;
  if (isNaN(diffMs) || diffMs <= 0) return 'Reset imminent';
  const mins = Math.floor(diffMs / 60000);
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `Reset dans ${days}j ${hours % 24}h`;
  }
  if (hours > 0) {
    return `Reset dans ${hours}h ${remMins}m`;
  }
  return `Reset dans ${remMins}m`;
}

function getQuotaColor(pct: number): string {
  if (pct > 50) return '#10b981'; // Emerald
  if (pct >= 20) return '#f59e0b'; // Amber
  return '#f43f5e'; // Rose
}

function calculateTierCounts(accounts: any[]) {
  let pro = 0;
  let ultra = 0;
  let free = 0;
  for (const a of accounts) {
    const tier = getAccountTier(a);
    if (tier === 'ULTRA') ultra++;
    else if (tier === 'FREE') free++;
    else pro++;
  }
  return { all: accounts.length, pro, ultra, free };
}

function filterAccounts(accounts: any[], query: string, filter: 'all' | 'pro' | 'ultra' | 'free') {
  return accounts.filter((a) => {
    const tier = getAccountTier(a).toLowerCase();
    if (filter !== 'all' && tier !== filter) return false;
    if (query) {
      const q = query.toLowerCase();
      const name = (a.name || '').toLowerCase();
      const email = (a.email || '').toLowerCase();
      const id = (a.id || '').toLowerCase();
      if (!name.includes(q) && !email.includes(q) && !id.includes(q)) {
        return false;
      }
    }
    return true;
  });
}

describe('Google Accounts High-Density Dashboard Logic', () => {
  describe('getAccountTier', () => {
    it('detects ULTRA tier from explicit tier attribute', () => {
      expect(getAccountTier({ tier: 'ultra' })).toBe('ULTRA');
      expect(getAccountTier({ tier: 'Google One Ultra' })).toBe('ULTRA');
    });

    it('detects PRO tier from explicit tier attribute', () => {
      expect(getAccountTier({ tier: 'pro' })).toBe('PRO');
      expect(getAccountTier({ tier: 'PRO_TIER' })).toBe('PRO');
    });

    it('detects FREE tier from explicit tier attribute or name', () => {
      expect(getAccountTier({ tier: 'free' })).toBe('FREE');
      expect(getAccountTier({ name: 'Free Account (No Sub)' })).toBe('FREE');
    });

    it('detects ULTRA tier from account name when tier not provided', () => {
      expect(getAccountTier({ name: 'Work Gemini Ultra' })).toBe('ULTRA');
    });

    it('defaults to PRO for standard Antigravity accounts', () => {
      expect(getAccountTier({ name: 'my-personal-account@gmail.com' })).toBe('PRO');
    });
  });

  describe('formatCompactCountdown', () => {
    const fixedNow = new Date('2026-09-14T12:00:00Z').getTime();

    it('formats days and remaining hours', () => {
      const target = new Date('2026-09-21T11:00:00Z').toISOString();
      expect(formatCompactCountdown(target, fixedNow)).toBe('6d 23h');
    });

    it('formats hours and minutes', () => {
      const target = new Date('2026-09-15T10:32:00Z').toISOString();
      expect(formatCompactCountdown(target, fixedNow)).toBe('22h 32m');
    });

    it('formats minutes only for sub-hour resets', () => {
      const target = new Date('2026-09-14T12:45:00Z').toISOString();
      expect(formatCompactCountdown(target, fixedNow)).toBe('45m');
    });

    it('returns 0m when reset time has elapsed', () => {
      const past = new Date('2026-09-14T11:59:00Z').toISOString();
      expect(formatCompactCountdown(past, fixedNow)).toBe('0m');
    });

    it('returns empty string when no date is supplied', () => {
      expect(formatCompactCountdown(undefined)).toBe('');
    });
  });

  describe('formatResetCountdown', () => {
    const fixedNow = new Date('2026-09-14T12:00:00Z').getTime();

    it('formats full French countdown string for days', () => {
      const target = new Date('2026-09-18T16:00:00Z').toISOString();
      expect(formatResetCountdown(target, fixedNow)).toBe('Reset dans 4j 4h');
    });

    it('formats full French countdown string for hours', () => {
      const target = new Date('2026-09-14T15:30:00Z').toISOString();
      expect(formatResetCountdown(target, fixedNow)).toBe('Reset dans 3h 30m');
    });

    it('returns Reset imminent when expired', () => {
      const past = new Date('2026-09-14T11:00:00Z').toISOString();
      expect(formatResetCountdown(past, fixedNow)).toBe('Reset imminent');
    });
  });

  describe('getQuotaColor', () => {
    it('returns emerald (#10b981) for quota above 50%', () => {
      expect(getQuotaColor(100)).toBe('#10b981');
      expect(getQuotaColor(51)).toBe('#10b981');
    });

    it('returns amber (#f59e0b) for quota between 20% and 50%', () => {
      expect(getQuotaColor(50)).toBe('#f59e0b');
      expect(getQuotaColor(20)).toBe('#f59e0b');
    });

    it('returns rose (#f43f5e) for quota below 20%', () => {
      expect(getQuotaColor(19)).toBe('#f43f5e');
      expect(getQuotaColor(0)).toBe('#f43f5e');
    });
  });

  describe('Filter & Search Logic', () => {
    const sampleAccounts = [
      { id: 'acc-1', name: 'Alex Pro', email: 'alex@company.com', tier: 'PRO' },
      { id: 'acc-2', name: 'Work Ultra', email: 'team@ultra.ai', tier: 'ULTRA' },
      { id: 'acc-3', name: 'Free Account', email: 'guest@gmail.com', tier: 'FREE' },
      { id: 'acc-4', name: 'Claude Special', email: 'specialist@claude.net', tier: 'PRO' },
    ];

    it('counts accounts per tier correctly', () => {
      const counts = calculateTierCounts(sampleAccounts);
      expect(counts.all).toBe(4);
      expect(counts.pro).toBe(2);
      expect(counts.ultra).toBe(1);
      expect(counts.free).toBe(1);
    });

    it('filters by search query across name and email', () => {
      const byEmail = filterAccounts(sampleAccounts, 'company.com', 'all');
      expect(byEmail).toHaveLength(1);
      expect(byEmail[0].id).toBe('acc-1');

      const byName = filterAccounts(sampleAccounts, 'Ultra', 'all');
      expect(byName).toHaveLength(1);
      expect(byName[0].id).toBe('acc-2');
    });

    it('filters by tier chip (ULTRA, FREE, PRO)', () => {
      const ultraOnly = filterAccounts(sampleAccounts, '', 'ultra');
      expect(ultraOnly).toHaveLength(1);
      expect(ultraOnly[0].tier).toBe('ULTRA');

      const freeOnly = filterAccounts(sampleAccounts, '', 'free');
      expect(freeOnly).toHaveLength(1);
      expect(freeOnly[0].tier).toBe('FREE');

      const proOnly = filterAccounts(sampleAccounts, '', 'pro');
      expect(proOnly).toHaveLength(2);
    });

    it('combines search query and tier filter simultaneously', () => {
      const filtered = filterAccounts(sampleAccounts, 'alex', 'pro');
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('acc-1');

      const noMatch = filterAccounts(sampleAccounts, 'alex', 'ultra');
      expect(noMatch).toHaveLength(0);
    });
  });

  describe('Quick Switch (Account Activation)', () => {
    it('sets target account as isCurrent and clears others', () => {
      const accounts = [
        { id: 'acc-1', name: 'Account 1', isCurrent: true, lastUsed: 1000 },
        { id: 'acc-2', name: 'Account 2', isCurrent: false, lastUsed: 500 },
      ];

      const targetId = 'acc-2';
      const now = Date.now();
      for (const a of accounts) {
        a.isCurrent = a.id === targetId;
        if (a.id === targetId) {
          a.lastUsed = now;
        }
      }

      expect(accounts[0].isCurrent).toBe(false);
      expect(accounts[1].isCurrent).toBe(true);
      expect(accounts[1].lastUsed).toBe(now);
    });
  });

  describe('JSON Export & Import', () => {
    it('serializes accounts into valid parseable JSON', () => {
      const accounts = [
        { id: 'google-1', name: 'Perso', provider: 'google', enabled: true },
      ];
      const jsonStr = JSON.stringify(accounts, null, 2);
      const parsed = JSON.parse(jsonStr);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0].name).toBe('Perso');
    });

    it('handles imported accounts and adds default id and provider', () => {
      const rawImport = [
        { name: 'Imported Acc', apiKey: 'ya29.test1234' },
      ];

      const processed = rawImport.map((a, idx) => ({
        ...a,
        id: a.id || `google-imported-${idx}`,
        provider: a.provider || 'google',
        enabled: a.enabled ?? true,
      }));

      expect(processed[0].id).toBe('google-imported-0');
      expect(processed[0].provider).toBe('google');
      expect(processed[0].enabled).toBe(true);
    });
  });
});
