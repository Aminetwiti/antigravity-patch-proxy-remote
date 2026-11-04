/**
 * ga-quota-helpers.ts — Effective quota resolution & capacity estimation for Google Accounts.
 * Extracted from view-google-accounts.ts for Single Responsibility (SRP).
 */

function isAiStudioAccount(acc: any): boolean {
  if (!acc) return false;
  if (acc.provider === 'google-gemini') return true;
  if (typeof acc.id === 'string' && acc.id.toLowerCase().includes('studio')) return true;
  if (typeof acc.name === 'string' && acc.name.toLowerCase().includes('studio')) return true;
  if (!acc.refreshToken && typeof acc.apiKey === 'string' && acc.apiKey.length > 0) return true;
  if (typeof acc.apiKey === 'string' && (acc.apiKey.startsWith('AQ.') || acc.apiKey.startsWith('AIzaSy'))) return true;
  return false;
}

function isGeminiCliAccount(acc: any): boolean {
  if (!acc) return false;
  if (acc.provider === 'google') return false;
  if (acc.provider === 'gemini-cli') return true;
  if (typeof acc.id === 'string' && acc.id.startsWith('gemini-cli')) return true;
  if (typeof acc.apiUrl === 'string' && acc.apiUrl.includes('cloudcode-pa.googleapis.com') && !acc.apiUrl.includes('daily-cloudcode')) return true;
  if (typeof acc.name === 'string' && (acc.name.toLowerCase().includes('gemini cli') || acc.name.toLowerCase().includes('(cli)'))) return true;
  return false;
}

function getAiStudioQuotaEstimate(acc: any): {
  rpdLimit: number;
  rpdUsed: number;
  rpdRemainingPct: number;
  rpdAvailableTokens: number;
  rpmLimit: number;
  rpmPct: number;
  resetCountdown: string;
} {
  const rpdLimit = 1500;
  const rpmLimit = 15;
  const totalDailyTokens = 37_500_000;
  const now = new Date();
  const startOfDayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0);

  let rpdUsed = 0;
  let tokensUsed = 0;
  const tracker = (window as any).tokenTracker;
  if (tracker) {
    try {
      const entries = tracker.getEntries();
      for (const e of entries) {
        if (e.timestamp >= startOfDayUtc) {
          const prov = (e.provider || '').toLowerCase();
          const mod = (e.model || '').toLowerCase();
          if (prov.includes('studio') || prov.includes('google') || mod.startsWith('gemini')) {
            rpdUsed++;
            tokensUsed += (e.totalTokens || 0);
          }
        }
      }
    } catch {}
  }

  const remainingReqs = Math.max(0, rpdLimit - rpdUsed);
  const rpdRemainingPct = Math.max(0, Math.min(100, Math.round((remainingReqs / rpdLimit) * 100)));
  const rpdAvailableTokens = Math.max(0, totalDailyTokens - tokensUsed);

  const nextUtcMidnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
  const diffMs = nextUtcMidnight.getTime() - now.getTime();
  const hours = Math.floor(diffMs / 3600000);
  const mins = Math.floor((diffMs % 3600000) / 60000);
  const resetCountdown = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

  return {
    rpdLimit,
    rpdUsed,
    rpdRemainingPct,
    rpdAvailableTokens,
    rpmLimit,
    rpmPct: 100,
    resetCountdown: `Reset dans ${resetCountdown}`,
  };
}

function getGeminiCliQuotaEstimate(acc: any): {
  rpdLimit: number;
  rpdUsed: number;
  rpdRemainingPct: number;
  rpdAvailableTokens: number;
  rpmLimit: number;
  rpmPct: number;
  resetCountdown: string;
} {
  const isPro = (acc.tierId && String(acc.tierId).toUpperCase().includes('PRO')) ||
                (acc.tier && String(acc.tier).toUpperCase().includes('PRO')) ||
                (acc.name && acc.name.toLowerCase().includes('pro'));
  const rpdLimit = isPro ? 1500 : 1000;
  const rpmLimit = 60;
  const totalDailyTokens = isPro ? 45_000_000 : 30_000_000;
  const now = new Date();
  const startOfDayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0);

  let rpdUsed = 0;
  let tokensUsed = 0;
  const tracker = (window as any).tokenTracker;
  if (tracker) {
    try {
      const entries = tracker.getEntries();
      for (const e of entries) {
        if (e.timestamp >= startOfDayUtc) {
          const prov = (e.provider || '').toLowerCase();
          const endpoint = (e.endpoint || '').toLowerCase();
          if (
            prov === 'gemini-cli' ||
            prov.includes('cli') ||
            (endpoint.includes('cloudcode-pa.googleapis.com') && !endpoint.includes('daily-cloudcode'))
          ) {
            rpdUsed++;
            tokensUsed += (e.totalTokens || 0);
          }
        }
      }
    } catch {}
  }

  const remainingReqs = Math.max(0, rpdLimit - rpdUsed);
  const rpdRemainingPct = Math.max(0, Math.min(100, Math.round((remainingReqs / rpdLimit) * 100)));
  const rpdAvailableTokens = Math.max(0, totalDailyTokens - tokensUsed);

  const nextUtcMidnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
  const diffMs = nextUtcMidnight.getTime() - now.getTime();
  const hours = Math.floor(diffMs / 3600000);
  const mins = Math.floor((diffMs % 3600000) / 60000);
  const resetCountdown = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

  return {
    rpdLimit,
    rpdUsed,
    rpdRemainingPct,
    rpdAvailableTokens,
    rpmLimit,
    rpmPct: 100,
    resetCountdown: `Reset dans ${resetCountdown}`,
  };
}

function formatQuotaPercent(val: number | undefined | null): string {
  if (typeof val !== 'number' || isNaN(val)) return '100%';
  const clamped = Math.max(0, Math.min(100, val));
  const rounded = Math.round(clamped * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
}

function getAccountEffectiveQuotas(acc: any): {
  gemini5hPct: number;
  geminiWkPct: number;
  claude5hPct: number;
  claudeWkPct: number;
  argon5hPct?: number;
  argonWkPct?: number;
  gemini5hReset?: string;
  geminiWkReset?: string;
  claude5hReset?: string;
  claudeWkReset?: string;
  argon5hReset?: string;
  argonWkReset?: string;
} {
  const q = acc?.quotas || {};

  if (acc?.isUnlicensed || q?.isUnlicensed) {
    const hasArgon = Boolean(
      q?.argonWeeklyPct !== undefined ||
      q?.argonFiveHourPct !== undefined ||
      (Array.isArray(q?.groups) && q.groups.some((g: any) => (g.displayName || g.name || '').toLowerCase().includes('argon')))
    );
    return {
      gemini5hPct: 0,
      geminiWkPct: 0,
      claude5hPct: 0,
      claudeWkPct: 0,
      argon5hPct: hasArgon ? 0 : undefined,
      argonWkPct: hasArgon ? 0 : undefined,
    };
  }

  let foundGemini5h: number | undefined;
  let foundGeminiWk: number | undefined;
  let foundClaude5h: number | undefined;
  let foundClaudeWk: number | undefined;
  let foundArgon5h: number | undefined;
  let foundArgonWk: number | undefined;
  let foundGemini5hReset: string | undefined;
  let foundGeminiWkReset: string | undefined;
  let foundClaude5hReset: string | undefined;
  let foundClaudeWkReset: string | undefined;
  let foundArgon5hReset: string | undefined;
  let foundArgonWkReset: string | undefined;

  if (Array.isArray(q.groups)) {
    for (const g of q.groups) {
      const gName = (g.displayName || g.name || '').toLowerCase();
      const isArgonGroup = gName.includes('argon');
      const isClaudeGroup = gName.includes('claude') || gName.includes('3p') || gName.includes('gpt');
      for (const b of (g.buckets || [])) {
        const bId = (b.bucketId || '').toLowerCase();
        const bWin = (b.window || '').toLowerCase();
        const isDisabled = Boolean(b.disabled);
        const remFrac = isDisabled ? 0 : (typeof b.remainingFraction === 'number' ? b.remainingFraction : (typeof b.percentage === 'number' ? b.percentage / 100 : undefined));
        const pct = remFrac !== undefined ? Math.round(remFrac * 100) : undefined;
        const is5h = bId.includes('5h') || bWin.includes('5h') || bWin.includes('hour');
        const isWk = bId.includes('weekly') || bWin.includes('weekly');

        if (isArgonGroup || bId.includes('argon')) {
          if (is5h && pct !== undefined && foundArgon5h === undefined) {
            foundArgon5h = pct;
            foundArgon5hReset = b.resetTime;
          }
          if (isWk && pct !== undefined && foundArgonWk === undefined) {
            foundArgonWk = pct;
            foundArgonWkReset = b.resetTime;
          }
        } else if (isClaudeGroup || bId.includes('claude') || bId.includes('3p')) {
          if (is5h && pct !== undefined && foundClaude5h === undefined) {
            foundClaude5h = pct;
            foundClaude5hReset = b.resetTime;
          }
          if (isWk && pct !== undefined && foundClaudeWk === undefined) {
            foundClaudeWk = pct;
            foundClaudeWkReset = b.resetTime;
          }
        } else {
          if (is5h && pct !== undefined && foundGemini5h === undefined) {
            foundGemini5h = pct;
            foundGemini5hReset = b.resetTime;
          }
          if (isWk && pct !== undefined && foundGeminiWk === undefined) {
            foundGeminiWk = pct;
            foundGeminiWkReset = b.resetTime;
          }
        }
      }
    }
  }

  let geminiWkPct = (typeof q.geminiWeeklyPct === 'number' ? q.geminiWeeklyPct : foundGeminiWk) ?? q.weeklyPercentage ?? (acc?.status === 'unhealthy' ? 0 : 100);
  let gemini5hPct = (typeof q.geminiFiveHourPct === 'number' ? q.geminiFiveHourPct : foundGemini5h) ?? q.fiveHourPercentage ?? (acc?.status === 'unhealthy' ? 0 : 100);
  let claudeWkPct = (typeof q.claudeWeeklyPct === 'number' ? q.claudeWeeklyPct : foundClaudeWk) ?? (q.groups && foundClaudeWk === undefined && typeof q.claudeWeeklyPct !== 'number' ? 0 : (acc?.status === 'unhealthy' ? 0 : 100));
  let claude5hPct = (typeof q.claudeFiveHourPct === 'number' ? q.claudeFiveHourPct : foundClaude5h) ?? (acc?.status === 'unhealthy' ? 0 : 100);
  let argonWkPct = (typeof q.argonWeeklyPct === 'number' ? q.argonWeeklyPct : foundArgonWk);
  let argon5hPct = (typeof q.argonFiveHourPct === 'number' ? q.argonFiveHourPct : foundArgon5h);

  if (geminiWkPct <= 0) gemini5hPct = 0;
  if (claudeWkPct <= 0) claude5hPct = 0;
  if (typeof argonWkPct === 'number' && argonWkPct <= 0) argon5hPct = 0;

  const tier = (window as any).getAccountTier?.(acc) || 'PRO';
  if (tier === 'FREE' || tier === 'STUDIO' || tier === 'CLI') {
    claudeWkPct = 0;
    claude5hPct = 0;
  }

  const cdGemini = (window as any).getAccountActiveCooldown?.(acc, 'gemini');
  const cdClaude = (window as any).getAccountActiveCooldown?.(acc, 'claude');
  if (cdGemini?.isCooldown) {
    gemini5hPct = 0;
    if (cdGemini.isWeeklyCap) geminiWkPct = 0;
  }
  if (cdClaude?.isCooldown) {
    claude5hPct = 0;
    if (cdClaude.isWeeklyCap) claudeWkPct = 0;
  }

  const is5hWindowReset = (iso?: string) => {
    if (!iso) return false;
    const diff = new Date(iso).getTime() - Date.now();
    return diff > 0 && diff <= 5.5 * 3600 * 1000;
  };

  const rawGemini5hReset = (cdGemini?.until && cdGemini.until > Date.now())
    ? new Date(cdGemini.until).toISOString()
    : (foundGemini5hReset || q.geminiFiveHourReset || (is5hWindowReset(q.geminiResetTime) ? q.geminiResetTime : (is5hWindowReset(q.fiveHourResetTime) ? q.fiveHourResetTime : undefined)));
  const rawGeminiWkReset = (cdGemini?.isWeeklyCap && cdGemini?.until && cdGemini.until > Date.now())
    ? new Date(cdGemini.until).toISOString()
    : (foundGeminiWkReset || q.geminiWeeklyReset || q.weeklyResetTime || (!is5hWindowReset(q.geminiResetTime) ? q.geminiResetTime : undefined));
  const rawClaude5hReset = (cdClaude?.until && cdClaude.until > Date.now())
    ? new Date(cdClaude.until).toISOString()
    : (foundClaude5hReset || q.claudeFiveHourReset || (is5hWindowReset(q.claudeResetTime) ? q.claudeResetTime : undefined));
  const rawClaudeWkReset = (cdClaude?.isWeeklyCap && cdClaude?.until && cdClaude.until > Date.now())
    ? new Date(cdClaude.until).toISOString()
    : (foundClaudeWkReset || q.claudeWeeklyReset || (!is5hWindowReset(q.claudeWeeklyReset) ? q.claudeWeeklyReset : rawGeminiWkReset));

  return {
    gemini5hPct: Math.max(0, Math.min(100, gemini5hPct)),
    geminiWkPct: Math.max(0, Math.min(100, geminiWkPct)),
    claude5hPct: Math.max(0, Math.min(100, claude5hPct)),
    claudeWkPct: Math.max(0, Math.min(100, claudeWkPct)),
    argon5hPct: typeof argon5hPct === 'number' ? Math.max(0, Math.min(100, argon5hPct)) : undefined,
    argonWkPct: typeof argonWkPct === 'number' ? Math.max(0, Math.min(100, argonWkPct)) : undefined,
    gemini5hReset: rawGemini5hReset,
    geminiWkReset: rawGeminiWkReset,
    claude5hReset: rawClaude5hReset,
    claudeWkReset: rawClaudeWkReset,
    argon5hReset: foundArgon5hReset || q.argonFiveHourReset,
    argonWkReset: foundArgonWkReset || q.argonWeeklyReset,
  };
}

function isAccountCapExhausted(a: any, windowMode: '5h' | 'weekly' = '5h'): boolean {
  if (!a) return false;
  const cdGemini = (window as any).getAccountActiveCooldown?.(a, 'gemini');
  if (cdGemini) return false;
  if (a.status === 'exhausted') return true;

  const eff = getAccountEffectiveQuotas(a);
  if (eff.gemini5hPct > 5 && eff.geminiWkPct > 5) return false;
  if (windowMode === 'weekly' && eff.geminiWkPct <= 0) return true;
  if (eff.gemini5hPct <= 0 || eff.geminiWkPct <= 0) return true;
  if (eff.gemini5hPct <= 5 && eff.geminiWkPct <= 5) return true;
  return false;
}

function estimateAccountTokens(acc: any): {
  accountCapacity5h: number;
  accountCapacityWeekly: number;
  availableTokens5h: number;
  availableTokensWeekly: number;
  geminiCapacity5h: number;
  geminiCapacityWeekly: number;
  geminiAvailable5h: number;
  geminiConsumed5h: number;
  geminiAvailableWeekly: number;
  geminiConsumedWeekly: number;
  claudeCapacity5h: number;
  claudeCapacityWeekly: number;
  claudeAvailable5h: number;
  claudeConsumed5h: number;
  claudeAvailableWeekly: number;
  claudeConsumedWeekly: number;
} {
  if (isAiStudioAccount(acc) || isGeminiCliAccount(acc) || acc.isUnlicensed || acc.quotas?.isUnlicensed) {
    return {
      accountCapacity5h: 0,
      accountCapacityWeekly: 0,
      availableTokens5h: 0,
      availableTokensWeekly: 0,
      geminiCapacity5h: 0,
      geminiCapacityWeekly: 0,
      geminiAvailable5h: 0,
      geminiConsumed5h: 0,
      geminiAvailableWeekly: 0,
      geminiConsumedWeekly: 0,
      claudeCapacity5h: 0,
      claudeCapacityWeekly: 0,
      claudeAvailable5h: 0,
      claudeConsumed5h: 0,
      claudeAvailableWeekly: 0,
      claudeConsumedWeekly: 0,
    };
  }

  const tier = (window as any).getAccountTier?.(acc) || 'PRO';
  let geminiCap5h = 250_000_000;
  let geminiCapWeekly = Math.round(geminiCap5h / 0.13);
  let claudeCap5h = 10_000_000;
  let claudeCapWeekly = Math.round(claudeCap5h / 0.50);

  if (tier === 'ULTRA') {
    geminiCap5h = 500_000_000;
    geminiCapWeekly = Math.round(geminiCap5h / 0.13);
    claudeCap5h = 25_000_000;
    claudeCapWeekly = 50_000_000;
  } else if (tier === 'FREE') {
    geminiCap5h = 50_000_000;
    geminiCapWeekly = Math.round(geminiCap5h / 0.13);
    claudeCap5h = 0;
    claudeCapWeekly = 0;
  }

  const { gemini5hPct, geminiWkPct, claude5hPct, claudeWkPct } = getAccountEffectiveQuotas(acc);

  return {
    accountCapacity5h: geminiCap5h,
    accountCapacityWeekly: geminiCapWeekly,
    availableTokens5h: Math.round((geminiCap5h * gemini5hPct) / 100),
    availableTokensWeekly: Math.round((geminiCapWeekly * geminiWkPct) / 100),
    geminiCapacity5h: geminiCap5h,
    geminiCapacityWeekly: geminiCapWeekly,
    geminiAvailable5h: Math.round((geminiCap5h * gemini5hPct) / 100),
    geminiConsumed5h: Math.round((geminiCap5h * (100 - gemini5hPct)) / 100),
    geminiAvailableWeekly: Math.round((geminiCapWeekly * geminiWkPct) / 100),
    geminiConsumedWeekly: Math.round((geminiCapWeekly * (100 - geminiWkPct)) / 100),
    claudeCapacity5h: claudeCap5h,
    claudeCapacityWeekly: claudeCapWeekly,
    claudeAvailable5h: Math.round((claudeCap5h * claude5hPct) / 100),
    claudeConsumed5h: Math.round((claudeCap5h * (100 - claude5hPct)) / 100),
    claudeAvailableWeekly: Math.round((claudeCapWeekly * claudeWkPct) / 100),
    claudeConsumedWeekly: Math.round((claudeCapWeekly * (100 - claudeWkPct)) / 100),
  };
}

if (typeof window !== 'undefined') {
  (window as any).isAiStudioAccount = isAiStudioAccount;
  (window as any).isGeminiCliAccount = isGeminiCliAccount;
  (window as any).getAiStudioQuotaEstimate = getAiStudioQuotaEstimate;
  (window as any).getGeminiCliQuotaEstimate = getGeminiCliQuotaEstimate;
  (window as any).formatQuotaPercent = formatQuotaPercent;
  (window as any).getAccountEffectiveQuotas = getAccountEffectiveQuotas;
  (window as any).isAccountCapExhausted = isAccountCapExhausted;
  (window as any).estimateAccountTokens = estimateAccountTokens;
}
