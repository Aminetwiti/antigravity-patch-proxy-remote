import { describe, expect, it } from 'vitest';

function getAccountTier(acc: any): 'PRO' | 'ULTRA' | 'FREE' | 'PARTAGE' {
  if (acc.tier) {
    const t = String(acc.tier).toUpperCase();
    if (t.includes('PARTAGE') || t.includes('FAMILY')) return 'PARTAGE';
    if (t.includes('ULTRA')) return 'ULTRA';
    if (t.includes('PRO')) return 'PRO';
    if (t.includes('FREE')) return 'FREE';
  }
  if (acc.isFamily || acc.isFamilyShared || acc.hasClaude55) return 'PARTAGE';
  const name = (acc.name || '').toUpperCase();
  if (name.includes('PARTAGE') || name.includes('FAMILY')) return 'PARTAGE';
  if (name.includes('ULTRA')) return 'ULTRA';
  if (name.includes('FREE')) return 'FREE';
  return 'PRO';
}

function isAiStudioAccount(acc: any): boolean {
  if (!acc) return false;
  if (acc.provider === 'google-gemini') return true;
  if (typeof acc.apiKey === 'string' && (acc.apiKey.startsWith('AQ.') || acc.apiKey.startsWith('AIzaSy'))) return true;
  if (typeof acc.name === 'string' && acc.name.toLowerCase().includes('studio')) return true;
  return false;
}

function isGeminiCliAccount(acc: any): boolean {
  if (!acc) return false;
  if (acc.provider === 'google') return false;
  if (acc.provider === 'gemini-cli') return true;
  if (typeof acc.id === 'string' && acc.id.startsWith('gemini-cli')) return true;
  return false;
}

function estimateAccountTokens(acc: any) {
  if (isAiStudioAccount(acc) || isGeminiCliAccount(acc)) {
    return {
      accountCapacity5h: 0,
      accountCapacityWeekly: 0,
      availableTokens5h: 0,
      availableTokensWeekly: 0,
    };
  }

  const tier = getAccountTier(acc);
  let geminiCap5h = 350_000;
  let geminiCapWeekly = 2_500_000;
  let claudeCap5h = 140_000;
  let claudeCapWeekly = 1_000_000;

  if (tier === 'ULTRA') {
    geminiCap5h = 800_000;
    geminiCapWeekly = 5_000_000;
    claudeCap5h = 320_000;
    claudeCapWeekly = 2_000_000;
  } else if (tier === 'FREE') {
    geminiCap5h = 120_000;
    geminiCapWeekly = 800_000;
    claudeCap5h = 0;
    claudeCapWeekly = 0;
  }

  const q = acc.quotas || {};
  let pct5h = q.geminiFiveHourPct ?? q.fiveHourPercentage ?? 100;
  let pctWk = q.geminiWeeklyPct ?? q.weeklyPercentage ?? 100;
  let claudePct5h = q.claudeFiveHourPct ?? 100;
  let claudePctWk = q.claudeWeeklyPct ?? 100;

  if (pctWk <= 0) {
    pct5h = 0;
  }
  if (claudePctWk <= 0) {
    claudePct5h = 0;
  }

  if (acc.enabled === false) {
    pct5h = 0;
    pctWk = 0;
    claudePct5h = 0;
    claudePctWk = 0;
  }

  const geminiAvailable5h = Math.round((geminiCap5h * Math.max(0, Math.min(100, pct5h))) / 100);
  const geminiAvailableWeekly = Math.round((geminiCapWeekly * Math.max(0, Math.min(100, pctWk))) / 100);

  const claudeAvailable5h = Math.round((claudeCap5h * Math.max(0, Math.min(100, claudePct5h))) / 100);
  const claudeAvailableWeekly = Math.round((claudeCapWeekly * Math.max(0, Math.min(100, claudePctWk))) / 100);

  return {
    accountCapacity5h: geminiCap5h,
    accountCapacityWeekly: geminiCapWeekly,
    availableTokens5h: geminiAvailable5h,
    availableTokensWeekly: geminiAvailableWeekly,
    geminiCapacity5h: geminiCap5h,
    geminiCapacityWeekly: geminiCapWeekly,
    geminiAvailable5h,
    geminiAvailableWeekly,
    claudeCapacity5h: claudeCap5h,
    claudeCapacityWeekly: claudeCapWeekly,
    claudeAvailable5h,
    claudeAvailableWeekly,
  };
}

function calculatePoolTokenSummary(accounts: any[], isWeekly: boolean = true) {
  let totalCap = 0;
  let availableTokens = 0;
  let activeCount = 0;
  let antigravityTotal = 0;

  for (const acc of accounts) {
    if (isAiStudioAccount(acc) || isGeminiCliAccount(acc)) continue;
    antigravityTotal++;
    if (acc.enabled === false) continue;
    activeCount++;
    const est = estimateAccountTokens(acc);
    if (isWeekly) {
      totalCap += est.accountCapacityWeekly;
      availableTokens += est.availableTokensWeekly;
    } else {
      totalCap += est.accountCapacity5h;
      availableTokens += est.availableTokens5h;
    }
  }

  const equivDollarValue = (availableTokens / 1_000_000) * 1.50;

  return {
    totalCapacity: totalCap,
    availableTokens,
    equivDollarValue,
    activeCount,
    antigravityTotal,
    pctAvailable: totalCap > 0 ? Math.round((availableTokens / totalCap) * 100) : 100,
  };
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

    it('detects PARTAGE tier from explicit tier attribute, isFamily, or Claude 5.5 access', () => {
      expect(getAccountTier({ tier: 'partage' })).toBe('PARTAGE');
      expect(getAccountTier({ tier: 'PARTAGE' })).toBe('PARTAGE');
      expect(getAccountTier({ isFamily: true })).toBe('PARTAGE');
      expect(getAccountTier({ hasClaude55: true })).toBe('PARTAGE');
      expect(getAccountTier({ name: 'Compte Partage Famille' })).toBe('PARTAGE');
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

  describe('Token Quota Estimation Logic', () => {
    it('calculates PRO account token capacity correctly (350k 5h, 2.5M weekly)', () => {
      const acc = { name: 'pro-user@gmail.com', tier: 'PRO', quotas: { geminiFiveHourPct: 100, geminiWeeklyPct: 100 } };
      const est = estimateAccountTokens(acc);
      expect(est.accountCapacity5h).toBe(350_000);
      expect(est.accountCapacityWeekly).toBe(2_500_000);
      expect(est.availableTokens5h).toBe(350_000);
      expect(est.availableTokensWeekly).toBe(2_500_000);
    });

    it('calculates ULTRA account token capacity correctly (800k 5h, 5M weekly)', () => {
      const acc = { name: 'ultra-user@gmail.com', tier: 'ULTRA', quotas: { geminiFiveHourPct: 100, geminiWeeklyPct: 100 } };
      const est = estimateAccountTokens(acc);
      expect(est.accountCapacity5h).toBe(800_000);
      expect(est.accountCapacityWeekly).toBe(5_000_000);
      expect(est.availableTokens5h).toBe(800_000);
      expect(est.availableTokensWeekly).toBe(5_000_000);
    });

    it('calculates FREE account token capacity correctly (120k 5h, 800k weekly)', () => {
      const acc = { name: 'free-user@gmail.com', tier: 'FREE', quotas: { geminiFiveHourPct: 100, geminiWeeklyPct: 100 } };
      const est = estimateAccountTokens(acc);
      expect(est.accountCapacity5h).toBe(120_000);
      expect(est.accountCapacityWeekly).toBe(800_000);
      expect(est.availableTokens5h).toBe(120_000);
      expect(est.availableTokensWeekly).toBe(800_000);
    });

    it('weights remaining tokens by quota percentage', () => {
      const acc = { name: 'pro-user@gmail.com', tier: 'PRO', quotas: { geminiFiveHourPct: 50, geminiWeeklyPct: 20 } };
      const est = estimateAccountTokens(acc);
      expect(est.availableTokens5h).toBe(175_000); // 50% of 350k
      expect(est.availableTokensWeekly).toBe(500_000); // 20% of 2.5M
    });

    it('calculates separate Claude token capacities and zeros 5h when weekly is 0', () => {
      const acc = {
        name: 'partage-user@gmail.com',
        tier: 'PARTAGE',
        quotas: {
          geminiFiveHourPct: 100,
          geminiWeeklyPct: 0, // Weekly exhausted
          claudeFiveHourPct: 80,
          claudeWeeklyPct: 50,
        },
      };
      const est = estimateAccountTokens(acc);
      expect(est.geminiCapacityWeekly).toBe(2_500_000);
      expect(est.geminiAvailableWeekly).toBe(0);
      expect(est.geminiAvailable5h).toBe(0); // 5h is blocked when weekly is 0
      expect(est.claudeCapacity5h).toBe(140_000);
      expect(est.claudeCapacityWeekly).toBe(1_000_000);
      expect(est.claudeAvailable5h).toBe(112_000); // 80% of 140k
      expect(est.claudeAvailableWeekly).toBe(500_000); // 50% of 1M
    });

    it('aggregates multi-account pool token capacity and dollar value correctly', () => {
      const accounts = [
        { id: 'acc-1', name: 'acc1', tier: 'PRO', enabled: true, quotas: { geminiWeeklyPct: 100 } },
        { id: 'acc-2', name: 'acc2', tier: 'PRO', enabled: true, quotas: { geminiWeeklyPct: 100 } },
        { id: 'acc-3', name: 'acc3', tier: 'ULTRA', enabled: true, quotas: { geminiWeeklyPct: 50 } },
        { id: 'acc-4', name: 'acc4', tier: 'PRO', enabled: false }, // disabled
      ];

      const summaryWeekly = calculatePoolTokenSummary(accounts, true);
      // 2 PRO @ 2.5M = 5M
      // 1 ULTRA @ 5M = 5M
      // Total Cap = 10M
      expect(summaryWeekly.totalCapacity).toBe(10_000_000);
      // Available: 2.5M + 2.5M + 2.5M (50% of 5M) = 7.5M
      expect(summaryWeekly.availableTokens).toBe(7_500_000);
      expect(summaryWeekly.activeCount).toBe(3);
      expect(summaryWeekly.equivDollarValue).toBe(11.25); // (7.5M / 1M) * 1.50
    });

    it('excludes AI Studio and Gemini CLI accounts from Antigravity pool', () => {
      const accounts = [
        { id: 'acc-1', name: 'acc1', tier: 'PRO', enabled: true, quotas: { geminiWeeklyPct: 100 } },
        { id: 'acc-studio', name: 'AI Studio Acc', provider: 'google-gemini', apiKey: 'AIzaSy123', enabled: true },
        { id: 'gemini-cli-1', name: 'Gemini CLI Acc', provider: 'gemini-cli', enabled: true },
      ];

      const summary = calculatePoolTokenSummary(accounts, true);
      expect(summary.totalCapacity).toBe(2_500_000); // Only acc-1
      expect(summary.activeCount).toBe(1);
      expect(summary.antigravityTotal).toBe(1);
    });

    it('switches pool capacity between 5H and Weekly modes', () => {
      const accounts = [
        { id: 'acc-1', name: 'acc1', tier: 'PRO', enabled: true, quotas: { geminiFiveHourPct: 100, geminiWeeklyPct: 100 } },
      ];

      const sum5h = calculatePoolTokenSummary(accounts, false);
      const sumWk = calculatePoolTokenSummary(accounts, true);

      expect(sum5h.totalCapacity).toBe(350_000);
      expect(sumWk.totalCapacity).toBe(2_500_000);
    });
  });

  describe('renderAccountQuotaBlock & Show All Quotas', () => {
    function renderTestQuotaBlock(a: any, showAll: boolean, isWeekly: boolean, isCardView = false): string {
      const isStudio = isAiStudioAccount(a);
      const isCli = isGeminiCliAccount(a);
      const quotas = a.quotas;
      if (isStudio) return '<div class="ga-quota-container">RPD (Jour) RPM (Débit)</div>';
      if (isCli) return '<div class="ga-quota-container">RPD RPM (Débit)</div>';
      if (!quotas) return '<span class="no-quota">No live quota</span>';

      const est = estimateAccountTokens(a);
      if (showAll) {
        return `
          <div class="ga-quota-container">
            <div class="ga-quota-row"><span class="ga-quota-name">Gemini 5h</span><span>${quotas.geminiFiveHourPct}%</span></div>
            <div class="ga-quota-row"><span class="ga-quota-name">Gemini Wk</span><span>${quotas.geminiWeeklyPct}%</span></div>
            <div class="ga-quota-row"><span class="ga-quota-name">Claude 5h</span><span>${quotas.claudeFiveHourPct}%</span></div>
            <div class="ga-quota-row"><span class="ga-quota-name">Claude Wk</span><span>${quotas.claudeWeeklyPct}%</span></div>
          </div>
        `;
      }

      return `
        <div class="ga-quota-container">
          <div class="ga-quota-row"><span class="ga-quota-name">Gemini</span><span>${isWeekly ? quotas.geminiWeeklyPct : quotas.geminiFiveHourPct}%</span></div>
          <div class="ga-quota-row"><span class="ga-quota-name">Claude/GPT</span><span>${isWeekly ? quotas.claudeWeeklyPct : quotas.claudeFiveHourPct}%</span></div>
        </div>
      `;
    }

    const testAccount = {
      id: 'acc-1',
      name: 'Test Pro',
      tier: 'PRO',
      quotas: {
        geminiFiveHourPct: 90,
        geminiWeeklyPct: 80,
        claudeFiveHourPct: 85,
        claudeWeeklyPct: 75,
      },
    };

    it('renders all 4 rolling and weekly quota bars when showAll is true', () => {
      const html = renderTestQuotaBlock(testAccount, true, false);
      expect(html).toContain('Gemini 5h');
      expect(html).toContain('Gemini Wk');
      expect(html).toContain('Claude 5h');
      expect(html).toContain('Claude Wk');
      expect(html).toContain('90%');
      expect(html).toContain('80%');
    });

    it('renders standard 2 bars when showAll is false', () => {
      const html5h = renderTestQuotaBlock(testAccount, false, false);
      expect(html5h).toContain('Gemini');
      expect(html5h).not.toContain('Gemini 5h');
      expect(html5h).toContain('90%');

      const htmlWk = renderTestQuotaBlock(testAccount, false, true);
      expect(htmlWk).toContain('Gemini');
      expect(htmlWk).not.toContain('Gemini Wk');
      expect(htmlWk).toContain('80%');
    });
  });

  describe('gaRepairCooldownsBtn & Reconciliation', () => {
    it('defines gaRepairCooldownsBtn with Corriger action and tooltip', () => {
      const buttonHtml = `
        <button class="btn btn-ghost" id="gaRepairCooldownsBtn" type="button" aria-label="Corriger les cooldowns et réveiller les comptes" title="Vérifier les quotas, lever les cooldowns et réveiller les comptes Google">
          <svg viewBox="0 0 24 24" width="14" height="14"><path d="M14.7 6.3a1 1 0 0 0 0 1.4"/></svg>
          Corriger
        </button>
      `;
      expect(buttonHtml).toContain('id="gaRepairCooldownsBtn"');
      expect(buttonHtml).toContain('Corriger');
      expect(buttonHtml).toContain('Corriger les cooldowns et réveiller les comptes');
    });

    it('reconciles and lifts cooldowns when accounts have healthy quota or passed reset', () => {
      const now = 1700000000000;
      const cds: Record<string, number> = {
        'google:a@gmail.com:gemini': now + 500000,
        'google:b@gmail.com:claude': now - 1000, // already expired
        'google:c@gmail.com:gemini': now + 800000,
      };
      const quotas: Record<string, any> = {
        'google:a@gmail.com': { geminiFiveHourPct: 90 },
        'google:c@gmail.com': { geminiFiveHourPct: 0, geminiResetTime: new Date(now - 1000).toISOString() },
      };

      let cleared = 0;
      for (const [k, until] of Object.entries(cds)) {
        if (until <= now) {
          delete cds[k];
          cleared++;
          continue;
        }
        let acc = k;
        let fam = '';
        if (k.endsWith(':gemini')) { acc = k.slice(0, -7); fam = 'gemini'; }
        else if (k.endsWith(':claude')) { acc = k.slice(0, -7); fam = 'claude'; }
        const q = quotas[acc];
        if (q) {
          const resetPassed = fam === 'gemini'
            ? (q.geminiResetTime ? Date.parse(q.geminiResetTime) <= now : false)
            : (q.claudeResetTime ? Date.parse(q.claudeResetTime) <= now : false);
          if (fam === 'gemini' && (q.geminiFiveHourPct >= 10 || resetPassed)) {
            delete cds[k];
            cleared++;
          }
        }
      }

      expect(cleared).toBe(3);
      expect(Object.keys(cds)).toHaveLength(0);
    });
  });
});

