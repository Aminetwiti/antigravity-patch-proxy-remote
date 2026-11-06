/**
 * services/google-accounts-analyzer.ts
 *
 * Moteur d'analyse pure et d'évaluation des comptes Google / Antigravity (SRP & DIP).
 * Isolé de tout DOM et de tout couplage UI pour une testabilité unitaire totale.
 */

type AccountTier = 'PRO' | 'ULTRA' | 'FREE' | 'STUDIO' | 'CLI' | 'PARTAGE';

interface EffectiveQuotas {
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
}

interface EstimatedTokens {
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
}

function isAccountValidationRequired(a: any): boolean {
  if (!a) return false;
  if (a.status === 'validation_required' || (a as any).isValidationRequired) return true;
  const err = a.errorDetails || a.quotas?.errorDetails;
  if (!err && a.lastError) {
    const le = String(a.lastError);
    if (le.includes('VALIDATION_REQUIRED') || le.includes('Verify your account') || le.includes('challenge')) {
      return true;
    }
  }
  if (!err) return false;
  return Boolean(
    err.validationUrl ||
    (a as any).isValidationRequired ||
    err.status === 'VALIDATION_REQUIRED' ||
    err.reason === 'VALIDATION_REQUIRED' ||
    (err.message && (err.message.includes('Verify your account') || err.message.includes('VALIDATION_REQUIRED') || err.message.includes('challenge')))
  );
}

function isAccountUnlicensed(a: any): boolean {
  if (!a) return false;
  return Boolean(a.isUnlicensed || a.quotas?.isUnlicensed);
}

function hasAccountErrorOrValidation(a: any): boolean {
  if (!a) return false;
  if (isAccountValidationRequired(a)) return true;
  if (a.isUnlicensed || a.quotas?.isUnlicensed) return true;
  if (a.errorDetails || a.quotas?.errorDetails) return true;
  if (a.status === 'unhealthy' || a.status === 'blocked' || a.status === 'validation_required') return true;
  if (a.lastError && (a.lastError.includes('403') || a.lastError.includes('Terms of Service') || a.lastError.includes('PERMISSION_DENIED'))) return true;
  return false;
}

function getQuotaColor(pct: number): string {
  if (pct > 50) return '#10b981'; // Emerald
  if (pct >= 20) return '#f59e0b'; // Amber
  return '#f43f5e'; // Rose
}

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

function getAccountTier(acc: any): AccountTier {
  if (isAiStudioAccount(acc)) return 'STUDIO';
  if (isGeminiCliAccount(acc)) return 'CLI';
  if (acc.isUnlicensed || acc.quotas?.isUnlicensed) return 'FREE';
  const tierSource = acc.quotas?.tier || acc.quotas?.tierId || acc.tierId || acc.tier;
  if (tierSource) {
    const t = String(tierSource).toUpperCase();
    if (t.includes('FREE')) return 'FREE';
    if (t.includes('PARTAGE') || t.includes('FAMILY') || t.includes('PARTAG')) return 'PARTAGE';
    if (t.includes('ULTRA') || t.includes('PREMIUM') || t.includes('ADVANCED') || t.includes('BUSINESS')) return 'ULTRA';
    if (t.includes('PRO') || t.includes('HELIUM')) return 'PRO';
    if (t.includes('STANDARD')) return 'FREE';
  }
  if (acc.isFamily || acc.isFamilyShared || acc.isFamilyPro || acc.hasClaude55 || acc.quotas?.hasClaude55 || acc.quotas?.isFamilyShared) {
    return 'PARTAGE';
  }
  const name = (acc.name || '').toUpperCase();
  if (name.includes('FREE')) return 'FREE';
  if (name.includes('PARTAGE') || name.includes('FAMILY')) return 'PARTAGE';
  if (name.includes('ULTRA') || name.includes('PREMIUM') || name.includes('ADVANCED')) return 'ULTRA';
  if (name.includes('PRO')) return 'PRO';
  return 'PRO';
}

function formatQuotaPercent(val: number | undefined | null): string {
  if (val === undefined || val === null || isNaN(val)) return '—';
  const rounded = Math.round(val);
  return `${Math.max(0, Math.min(100, rounded))}%`;
}

function getAccountEffectiveQuotas(acc: any): EffectiveQuotas {
  if (!acc) {
    return { gemini5hPct: 0, geminiWkPct: 0, claude5hPct: 0, claudeWkPct: 0 };
  }

  const q = acc.quotas || {};

  if (acc.isUnlicensed || q.isUnlicensed) {
    const hasArgon = Boolean(
      q.argonWeeklyPct !== undefined ||
      q.argonFiveHourPct !== undefined ||
      (Array.isArray(q.groups) && q.groups.some((g: any) => (g.displayName || g.name || '').toLowerCase().includes('argon')))
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

  // Inspect groups / buckets if present (Google Cloud Code Live Quota Summary)
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

  // Explicit direct fields take priority over legacy group bucket parsing if defined
  let geminiWkPct = (typeof q.geminiWeeklyPct === 'number' ? q.geminiWeeklyPct : foundGeminiWk) ?? q.weeklyPercentage ?? (acc.status === 'unhealthy' ? 0 : 100);
  let gemini5hPct = (typeof q.geminiFiveHourPct === 'number' ? q.geminiFiveHourPct : foundGemini5h) ?? q.fiveHourPercentage ?? (acc.status === 'unhealthy' ? 0 : 100);
  let claudeWkPct = (typeof q.claudeWeeklyPct === 'number' ? q.claudeWeeklyPct : foundClaudeWk) ?? (q.groups && foundClaudeWk === undefined && typeof q.claudeWeeklyPct !== 'number' ? 0 : (acc.status === 'unhealthy' ? 0 : 100));
  let claude5hPct = (typeof q.claudeFiveHourPct === 'number' ? q.claudeFiveHourPct : foundClaude5h) ?? (acc.status === 'unhealthy' ? 0 : 100);
  let argonWkPct = (typeof q.argonWeeklyPct === 'number' ? q.argonWeeklyPct : foundArgonWk);
  let argon5hPct = (typeof q.argonFiveHourPct === 'number' ? q.argonFiveHourPct : foundArgon5h);

  // Reality rule: If weekly quota is 0, Google locks the 5h window completely
  if (geminiWkPct <= 0) {
    gemini5hPct = 0;
  }
  if (claudeWkPct <= 0) {
    claude5hPct = 0;
  }
  if (typeof argonWkPct === 'number' && argonWkPct <= 0) {
    argon5hPct = 0;
  }

  // Free, Studio, and CLI accounts do not have access to Claude/GPT models in Antigravity
  const tier = getAccountTier(acc);
  if (tier === 'FREE' || tier === 'STUDIO' || tier === 'CLI') {
    claudeWkPct = 0;
    claude5hPct = 0;
  }

  const rawGemini5hReset = foundGemini5hReset || q.geminiFiveHourReset || q.fiveHourResetTime || q.geminiResetTime;
  const rawGeminiWkReset = foundGeminiWkReset || q.geminiWeeklyReset || q.weeklyResetTime;
  const rawClaude5hReset = foundClaude5hReset || q.claudeFiveHourReset || rawGemini5hReset;
  const rawClaudeWkReset = foundClaudeWkReset || q.claudeWeeklyReset || rawGeminiWkReset;
  const rawArgon5hReset = foundArgon5hReset || q.argonFiveHourReset;
  const rawArgonWkReset = foundArgonWkReset || q.argonWeeklyReset;

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
    argon5hReset: rawArgon5hReset,
    argonWkReset: rawArgonWkReset,
  };
}

function estimateAccountTokens(acc: any): EstimatedTokens {
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

  const tier = getAccountTier(acc);
  let geminiCap5h = 250_000_000;
  let geminiCapWeekly = Math.round(geminiCap5h / 0.13); // ~1_923_076_923 tokens
  let claudeCap5h = 10_000_000;
  let claudeCapWeekly = Math.round(claudeCap5h / 0.50); // 20_000_000 tokens

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

  const geminiAvailable5h = Math.round((geminiCap5h * gemini5hPct) / 100);
  const geminiConsumed5h = Math.round((geminiCap5h * (100 - gemini5hPct)) / 100);
  const geminiAvailableWeekly = Math.round((geminiCapWeekly * geminiWkPct) / 100);
  const geminiConsumedWeekly = Math.round((geminiCapWeekly * (100 - geminiWkPct)) / 100);

  const claudeAvailable5h = Math.round((claudeCap5h * claude5hPct) / 100);
  const claudeConsumed5h = Math.round((claudeCap5h * (100 - claude5hPct)) / 100);
  const claudeAvailableWeekly = Math.round((claudeCapWeekly * claudeWkPct) / 100);
  const claudeConsumedWeekly = Math.round((claudeCapWeekly * (100 - claudeWkPct)) / 100);

  return {
    accountCapacity5h: geminiCap5h,
    accountCapacityWeekly: geminiCapWeekly,
    availableTokens5h: geminiAvailable5h,
    availableTokensWeekly: geminiAvailableWeekly,
    geminiCapacity5h: geminiCap5h,
    geminiCapacityWeekly: geminiCapWeekly,
    geminiAvailable5h,
    geminiConsumed5h,
    geminiAvailableWeekly,
    geminiConsumedWeekly,
    claudeCapacity5h: claudeCap5h,
    claudeCapacityWeekly: claudeCapWeekly,
    claudeAvailable5h,
    claudeConsumed5h,
    claudeAvailableWeekly,
    claudeConsumedWeekly,
  };
}

function calculatePoolTokenSummary(accounts: any[], isWeekly: boolean = true): {
  totalCap: number;
  availableTokens: number;
  consumedTokens: number;
  activeCount: number;
  antigravityTotal: number;
  pct: number;
} {
  let totalCap = 0;
  let availableTokens = 0;
  let consumedTokens = 0;
  let activeCount = 0;
  let antigravityTotal = 0;

  if (!Array.isArray(accounts)) accounts = [];

  for (const acc of accounts) {
    if (!acc) continue;
    if (isAiStudioAccount(acc) || isGeminiCliAccount(acc)) continue;
    antigravityTotal++;
    if (acc.enabled === false) continue;
    activeCount++;
    const est = estimateAccountTokens(acc);
    if (isWeekly) {
      totalCap += est.geminiCapacityWeekly;
      availableTokens += est.geminiAvailableWeekly;
      consumedTokens += est.geminiConsumedWeekly;
    } else {
      totalCap += est.geminiCapacity5h;
      availableTokens += est.geminiAvailable5h;
      consumedTokens += est.geminiConsumed5h;
    }
  }

  const pct = totalCap > 0 ? Math.round((availableTokens / totalCap) * 100) : 0;
  return {
    totalCap,
    availableTokens,
    consumedTokens,
    activeCount,
    antigravityTotal,
    pct,
  };
}

if (typeof exports !== 'undefined') {
  Object.assign(exports, {
    isAccountValidationRequired,
    isAccountUnlicensed,
    hasAccountErrorOrValidation,
    getQuotaColor,
    isAiStudioAccount,
    isGeminiCliAccount,
    getAccountTier,
    formatQuotaPercent,
    getAccountEffectiveQuotas,
    estimateAccountTokens,
    calculatePoolTokenSummary,
  });
}

if (typeof window !== 'undefined') {
  Object.assign(window, {
    isAccountValidationRequired,
    isAccountUnlicensed,
    hasAccountErrorOrValidation,
    getQuotaColor,
    isAiStudioAccount,
    isGeminiCliAccount,
    getAccountTier,
    formatQuotaPercent,
    getAccountEffectiveQuotas,
    estimateAccountTokens,
    calculatePoolTokenSummary,
  });
}

export {
  isAccountValidationRequired,
  isAccountUnlicensed,
  hasAccountErrorOrValidation,
  getQuotaColor,
  isAiStudioAccount,
  isGeminiCliAccount,
  getAccountTier,
  formatQuotaPercent,
  getAccountEffectiveQuotas,
  estimateAccountTokens,
  calculatePoolTokenSummary,
};
