export interface PoolRunwayResult {
  totalAvailableTokens: number;
  totalAvailableTokens5h?: number;
  totalAvailableTokensWeekly?: number;
  totalConsumedTokens5h: number;
  totalConsumedTokensWeekly: number;
  hourlyBurnRate: number;
  runwayHours: number;
  runwayMinutes: number;
  formattedRunway: string;
  burnState: 'healthy' | 'moderate' | 'critical';
}

/**
 * Real Quota & Token Constants
 * - Gemini: 5h quota (100%) = 13% weekly = 250 M tokens (250,000,000)
 * - Claude: 5h quota (100%) = 50% weekly
 */
export const GEMINI_5H_QUOTA_TOKENS = 250_000_000;
export const GEMINI_WEEKLY_RATIO = 0.13;
export const GEMINI_WEEKLY_QUOTA_TOKENS = Math.round(GEMINI_5H_QUOTA_TOKENS / GEMINI_WEEKLY_RATIO); // ~1,923,076,923 tokens
import { CLAUDE_5H_TO_WEEKLY_RATIO } from './token-tracker';
export { CLAUDE_5H_TO_WEEKLY_RATIO };

export const GEMINI_TOKENS_PER_5H_PCT = GEMINI_5H_QUOTA_TOKENS / 100; // 2,500,000 tokens per 1% 5h
export const GEMINI_TOKENS_PER_WEEKLY_PCT = GEMINI_WEEKLY_QUOTA_TOKENS / 100; // ~19,230,769 tokens per 1% weekly

export interface AccountTokenMetrics {
  availableTokens5h: number;
  consumedTokens5h: number;
  availableTokensWeekly: number;
  consumedTokensWeekly: number;
  pct5h: number;
  pctWeekly: number;
}

/**
 * Calculates consumed and available tokens for an individual account from its quotas.
 */
export function calculateAccountTokens(acc: any): AccountTokenMetrics {
  const isUnlicensed = Boolean(acc?.isUnlicensed || acc?.quotas?.isUnlicensed);
  if (isUnlicensed) {
    return {
      availableTokens5h: 0,
      consumedTokens5h: 0,
      availableTokensWeekly: 0,
      consumedTokensWeekly: 0,
      pct5h: 0,
      pctWeekly: 0,
    };
  }

  const q = acc?.quotas || {};
  let wkPct: number | undefined = q.geminiWeeklyPct ?? q.weeklyPercentage ?? q.geminiWkPct;
  let pct5h: number | undefined = q.geminiFiveHourPct ?? q.fiveHourPercentage ?? q.gemini5hPct;

  if (Array.isArray(q.groups)) {
    for (const g of q.groups) {
      const gName = (g.displayName || g.name || '').toLowerCase();
      const isClaudeGroup = gName.includes('claude') || gName.includes('3p') || gName.includes('gpt');
      const isArgonGroup = gName.includes('argon');
      if (isClaudeGroup || isArgonGroup) continue;
      for (const b of (g.buckets || [])) {
        const bId = (b.bucketId || '').toLowerCase();
        const bWin = (b.window || '').toLowerCase();
        const isDisabled = Boolean(b.disabled);
        const remFrac = isDisabled ? 0 : (typeof b.remainingFraction === 'number' ? b.remainingFraction : (typeof b.percentage === 'number' ? b.percentage / 100 : undefined));
        const pct = remFrac !== undefined ? Math.round(remFrac * 100) : undefined;
        const is5h = bId.includes('5h') || bWin.includes('5h') || bWin.includes('hour');
        const isWk = bId.includes('weekly') || bWin.includes('weekly');
        if (is5h && pct !== undefined && pct5h === undefined) pct5h = pct;
        if (isWk && pct !== undefined && wkPct === undefined) wkPct = pct;
      }
    }
  }

  const finalWkPct = wkPct ?? 100;
  const finalPct5h = finalWkPct <= 0 ? 0 : (pct5h ?? 100);
  const tier = String(acc?.tier || '').toUpperCase();
  const cap5h = tier.includes('FREE') ? Math.round(GEMINI_5H_QUOTA_TOKENS * 0.4) : (tier === 'ULTRA' ? GEMINI_5H_QUOTA_TOKENS * 2 : GEMINI_5H_QUOTA_TOKENS);
  const weeklyTotal = Math.round(cap5h / GEMINI_WEEKLY_RATIO);

  return {
    availableTokens5h: Math.round((cap5h * Math.max(0, Math.min(100, finalPct5h))) / 100),
    consumedTokens5h: Math.round((cap5h * Math.max(0, 100 - finalPct5h)) / 100),
    availableTokensWeekly: Math.round((weeklyTotal * Math.max(0, Math.min(100, finalWkPct))) / 100),
    consumedTokensWeekly: Math.round((weeklyTotal * Math.max(0, 100 - finalWkPct)) / 100),
    pct5h: finalPct5h,
    pctWeekly: finalWkPct,
  };
}

/**
 * Aggregates consumed and remaining tokens across all active pooled accounts.
 */
export function calculatePoolConsumedTokens(accounts: any[]): {
  totalConsumed5h: number;
  totalConsumedWeekly: number;
  totalAvailable5h: number;
  totalAvailableWeekly: number;
} {
  let totalConsumed5h = 0;
  let totalConsumedWeekly = 0;
  let totalAvailable5h = 0;
  let totalAvailableWeekly = 0;

  if (!Array.isArray(accounts)) {
    return { totalConsumed5h: 0, totalConsumedWeekly: 0, totalAvailable5h: 0, totalAvailableWeekly: 0 };
  }

  for (const acc of accounts) {
    if (!acc || acc.enabled === false) continue;
    const isStudio = acc.provider === 'google-gemini' || (typeof acc.apiKey === 'string' && (acc.apiKey.startsWith('AQ.') || acc.apiKey.startsWith('AIzaSy')));
    const isCli = acc.provider === 'gemini-cli' || (typeof acc.id === 'string' && acc.id.startsWith('gemini-cli'));
    if (isStudio || isCli) continue;
    if (acc.isUnlicensed || acc.quotas?.isUnlicensed) continue;

    const m = calculateAccountTokens(acc);
    totalConsumed5h += m.consumedTokens5h;
    totalConsumedWeekly += m.consumedTokensWeekly;
    totalAvailable5h += m.availableTokens5h;
    totalAvailableWeekly += m.availableTokensWeekly;
  }

  return { totalConsumed5h, totalConsumedWeekly, totalAvailable5h, totalAvailableWeekly };
}

export interface UpcomingResetItem {
  accountId: string;
  accountName: string;
  type: '5h' | 'weekly' | 'cooldown';
  targetTime: string;
  remainingMs: number;
  formattedCountdown: string;
}

/**
 * Calculates estimated flight runway (hours/minutes of coding) based on remaining pool tokens.
 * Default hourly burn rate is 50,000,000 tokens/hr (active AI pair programming against 250M 5h window).
 */
export function calculatePoolRunway(
  accounts: any[],
  hourlyBurnRate = 50_000_000,
  activeCooldowns: Record<string, { until: number }> = {},
  nowMs: number = Date.now()
): PoolRunwayResult {
  if (!Array.isArray(accounts) || accounts.length === 0 || hourlyBurnRate <= 0) {
    return {
      totalAvailableTokens: 0,
      totalAvailableTokens5h: 0,
      totalAvailableTokensWeekly: 0,
      totalConsumedTokens5h: 0,
      totalConsumedTokensWeekly: 0,
      hourlyBurnRate,
      runwayHours: 0,
      runwayMinutes: 0,
      formattedRunway: '0h 00m',
      burnState: 'critical',
    };
  }

  let totalAvailable5h = 0;
  let totalAvailableWeekly = 0;
  let totalConsumedTokens5h = 0;
  let totalConsumedTokensWeekly = 0;

  for (const acc of accounts) {
    if (!acc || acc.enabled === false) continue;
    // Skip AI Studio or CLI if they don't share Antigravity pool tokens
    const isStudio = acc.provider === 'google-gemini' || (typeof acc.apiKey === 'string' && (acc.apiKey.startsWith('AQ.') || acc.apiKey.startsWith('AIzaSy')));
    const isCli = acc.provider === 'gemini-cli' || (typeof acc.id === 'string' && acc.id.startsWith('gemini-cli'));
    if (isStudio || isCli) continue;

    if (acc.isUnlicensed || acc.quotas?.isUnlicensed) continue;

    const inCd = isAccountInCooldownTelemetry(acc, 'gemini', activeCooldowns, nowMs);
    const metrics = calculateAccountTokens(acc);
    if (!inCd) {
      totalAvailable5h += metrics.availableTokens5h;
      totalAvailableWeekly += metrics.availableTokensWeekly;
    }
    totalConsumedTokens5h += metrics.consumedTokens5h;
    totalConsumedTokensWeekly += metrics.consumedTokensWeekly;
  }

  const totalAvailableTokens = totalAvailable5h;
  const totalMinutes = Math.floor((totalAvailableTokens / hourlyBurnRate) * 60);
  const runwayHours = Math.floor(totalMinutes / 60);
  const runwayMinutes = totalMinutes % 60;

  let burnState: 'healthy' | 'moderate' | 'critical' = 'critical';
  if (runwayHours >= 3) {
    burnState = 'healthy';
  } else if (runwayHours >= 1 || runwayMinutes >= 30) {
    burnState = 'moderate';
  }

  const formattedRunway = runwayHours > 24
    ? `> 24h`
    : `${runwayHours}h ${String(runwayMinutes).padStart(2, '0')}m`;

  return {
    totalAvailableTokens,
    totalAvailableTokens5h: totalAvailable5h,
    totalAvailableTokensWeekly: totalAvailableWeekly,
    totalConsumedTokens5h,
    totalConsumedTokensWeekly,
    hourlyBurnRate,
    runwayHours,
    runwayMinutes,
    formattedRunway,
    burnState,
  };
}

/**
 * Returns an chronologically ordered timeline of the earliest resets (5h, weekly, cooldown).
 */
export function getUpcomingResetsTimeline(
  accounts: any[],
  nowMs: number = Date.now(),
  maxItems = 4,
  activeCooldowns: Record<string, any> = {}
): UpcomingResetItem[] {
  if (!Array.isArray(accounts)) return [];

  const items: UpcomingResetItem[] = [];

  for (const acc of accounts) {
    if (!acc) continue;
    const accountName = (acc.name || acc.email || acc.id || 'Compte Google').split('@')[0].trim();
    const quotas = acc.quotas || {};

    // 5H Reset
    const fiveHourReset = quotas.fiveHourResetTime || quotas.gemini5hReset || quotas.geminiFiveHourResetTime;
    if (fiveHourReset) {
      const t = new Date(fiveHourReset).getTime();
      const diff = t - nowMs;
      if (!isNaN(diff) && diff > 0) {
        items.push({
          accountId: acc.id,
          accountName,
          type: '5h',
          targetTime: fiveHourReset,
          remainingMs: diff,
          formattedCountdown: formatCompactDuration(diff),
        });
      }
    }

    // Weekly Reset
    const weeklyReset = quotas.weeklyResetTime || quotas.geminiWkReset || quotas.geminiWeeklyResetTime;
    if (weeklyReset) {
      const t = new Date(weeklyReset).getTime();
      const diff = t - nowMs;
      if (!isNaN(diff) && diff > 0) {
        items.push({
          accountId: acc.id,
          accountName,
          type: 'weekly',
          targetTime: weeklyReset,
          remainingMs: diff,
          formattedCountdown: formatCompactDuration(diff),
        });
      }
    }

    // Inspect groups buckets if present
    if (Array.isArray(quotas.groups)) {
      for (const g of quotas.groups) {
        for (const b of (g.buckets || [])) {
          if (b.resetTime) {
            const t = new Date(b.resetTime).getTime();
            const diff = t - nowMs;
            const bId = (b.bucketId || '').toLowerCase();
            const is5h = bId.includes('5h') || (b.window || '').toLowerCase().includes('5h');
            if (!isNaN(diff) && diff > 0 && !items.some(i => i.accountId === acc.id && Math.abs(i.remainingMs - diff) < 60000)) {
              items.push({
                accountId: acc.id,
                accountName,
                type: is5h ? '5h' : 'weekly',
                targetTime: b.resetTime,
                remainingMs: diff,
                formattedCountdown: formatCompactDuration(diff),
              });
            }
          }
        }
      }
    }

    // Cooldown from acc.cooldown
    const cd = acc.cooldown;
    if (cd && cd.until) {
      const t = new Date(cd.until).getTime();
      const diff = t - nowMs;
      if (!isNaN(diff) && diff > 0 && !items.some(i => i.accountId === acc.id && Math.abs(i.remainingMs - diff) < 60000)) {
        items.push({
          accountId: acc.id,
          accountName,
          type: 'cooldown',
          targetTime: cd.until,
          remainingMs: diff,
          formattedCountdown: formatCompactDuration(diff),
        });
      }
    }

    // Cooldown from activeCooldowns
    const gCd = activeCooldowns[`google:${acc.email || acc.name || acc.id}:gemini`];
    if (gCd && gCd.until) {
      const diff = gCd.until - nowMs;
      if (!isNaN(diff) && diff > 0 && !items.some(i => i.accountId === acc.id && (i.type === 'cooldown' || Math.abs(i.remainingMs - diff) < 60000))) {
        items.push({
          accountId: acc.id,
          accountName,
          type: 'cooldown',
          targetTime: new Date(gCd.until).toISOString(),
          remainingMs: diff,
          formattedCountdown: formatCompactDuration(diff),
        });
      }
    }
  }

  items.sort((a, b) => a.remainingMs - b.remainingMs);
  return items.slice(0, maxItems);
}

/**
 * Formats a duration in milliseconds into a compact human string (e.g., "12m", "1h 30m", "2d 4h").
 */
export function formatCompactDuration(diffMs: number): string {
  if (isNaN(diffMs) || diffMs <= 0) return '0m';
  const mins = Math.floor(diffMs / 60000);
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return `${days}j ${remHours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${remMins}m`;
  }
  return `${Math.max(1, mins)}m`;
}

/**
 * Formats live ticking countdown for active DOM elements down to the second.
 */
export function formatLiveCountdown(remainingMs: number): string {
  if (isNaN(remainingMs) || remainingMs <= 0) {
    return 'Prêt';
  }
  const secs = Math.floor(remainingMs / 1000);
  if (secs < 60) {
    return `${secs}s`;
  }
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  if (mins < 60) {
    return `${mins}m ${String(remSecs).padStart(2, '0')}s`;
  }
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours}h ${remMins}m`;
}

export interface PoolVelocityResult {
  rpm: number;
  label: string;
  status: 'calm' | 'active' | 'warning';
}

/**
 * Calculates current prompt request throughput (RPM) and anti-burst safety state.
 */
export function calculatePoolVelocity(
  recentSessions: any[] = [],
  nowMs: number = Date.now(),
  windowMs: number = 5 * 60 * 1000
): PoolVelocityResult {
  if (!Array.isArray(recentSessions) || recentSessions.length === 0) {
    return { rpm: 0, label: 'Fluide / Repos', status: 'calm' };
  }

  let recentCount = 0;
  for (const s of recentSessions) {
    if (!s) continue;
    const ts = s.timestamp || s.createdAt || (typeof s.id === 'number' ? s.id : (typeof s.id === 'string' && !isNaN(Number(s.id)) ? Number(s.id) : 0));
    if (ts && (nowMs - ts) <= windowMs && (nowMs - ts) >= 0) {
      recentCount++;
    }
  }

  const windowMinutes = Math.max(1, windowMs / 60000);
  let rpm = recentCount > 0 ? Number((recentCount / windowMinutes).toFixed(1)) : 0;
  if (rpm === 0 && recentSessions.length > 0) {
    rpm = Math.min(3.5, Number((recentSessions.length / 30).toFixed(1)));
  }

  if (rpm >= 45) {
    return { rpm, label: `Surchauffe Critique (${rpm} RPM - Risque 429)`, status: 'warning' };
  } else if (rpm >= 20) {
    return { rpm, label: `Charge Sévère (${rpm} RPM)`, status: 'warning' };
  } else if (rpm >= 10) {
    return { rpm, label: 'Charge Élevée (Proche 15 RPM)', status: 'warning' };
  } else if (rpm >= 2) {
    return { rpm, label: 'Actif (Marge Saine)', status: 'active' };
  } else {
    return { rpm, label: 'Fluide / Éco', status: 'calm' };
  }
}

export interface StrategicAdviceResult {
  icon: string;
  text: string;
  actionType?: 'wake' | 'soft-stow' | 'switch-gemini';
  actionLabel?: string;
}

/**
 * Robust cooldown check for telemetry and strategy calculations across Google/CLI accounts.
 */
export function isAccountInCooldownTelemetry(
  a: any,
  family: 'gemini' | 'claude' = 'gemini',
  activeCooldowns: Record<string, { until: number }> = {},
  nowMs: number = Date.now()
): boolean {
  if (!a || !activeCooldowns || typeof activeCooldowns !== 'object') return false;
  const email = (a.email || '').toLowerCase().trim();
  const name = (a.name || '').toLowerCase().trim();
  const id = (a.id || '').toLowerCase().trim();
  const cleanId = id.replace(/^(google|gemini-cli):/, '');
  const cleanName = name.replace(/^(google|gemini-cli):/, '');

  for (const [k, v] of Object.entries(activeCooldowns)) {
    if (!v || typeof v.until !== 'number' || v.until <= nowMs) continue;
    const lowerK = k.toLowerCase();
    if (family === 'gemini' && lowerK.endsWith(':claude')) continue;
    if (family === 'claude' && lowerK.endsWith(':gemini')) continue;

    const cleanK = lowerK.replace(/^(google|gemini-cli):/, '').replace(/:(gemini|claude)$/, '');
    if (
      (email && cleanK === email) ||
      (cleanId && cleanK === cleanId) ||
      (cleanName && cleanK === cleanName) ||
      (email && lowerK.includes(email)) ||
      (cleanId && lowerK.includes(cleanId))
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Checks if an account requires verification / challenge (Google 403 challenge).
 */
export function isAccountValidationRequiredTelemetry(a: any): boolean {
  if (!a) return false;
  if (a.status === 'validation_required' || a.isValidationRequired || a.validationRequired || a.quotas?.validationRequired) return true;
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

/**
 * Checks if an account is blocked by fatal errors or TOS (excluding validation required).
 */
export function isAccountBlockedTelemetry(a: any): boolean {
  if (!a) return false;
  if (isAccountValidationRequiredTelemetry(a)) return false;
  return Boolean(
    a.isUnlicensed ||
    a.quotas?.isUnlicensed ||
    a.errorDetails ||
    a.quotas?.errorDetails ||
    (a.status === 'unhealthy' && a.lastError?.includes('403'))
  );
}

/**
 * Derives a single actionable situation advice for the Google pool based on live health.
 */
export function getPoolStrategicAdvice(
  accounts: any[] = [],
  activeCooldowns: Record<string, { until: number }> = {},
  nowMs: number = Date.now()
): StrategicAdviceResult {
  if (!Array.isArray(accounts) || accounts.length === 0) {
    return { icon: 'ℹ️', text: 'Aucun compte Google configuré dans le pool.' };
  }

  const readyGeminiAccounts = accounts.filter((a) => {
    if (!a || a.enabled === false) return false;
    if (isAccountValidationRequiredTelemetry(a) || isAccountBlockedTelemetry(a)) return false;
    const isStudio = a.provider === 'google-gemini' || (typeof a.apiKey === 'string' && (a.apiKey.startsWith('AQ.') || a.apiKey.startsWith('AIzaSy')));
    const isCli = a.provider === 'gemini-cli' || (typeof a.id === 'string' && a.id.startsWith('gemini-cli'));
    if (isStudio || isCli) return true;
    if (isAccountInCooldownTelemetry(a, 'gemini', activeCooldowns, nowMs)) return false;
    const gWk = a.quotas?.geminiWeeklyPct ?? a.quotas?.weeklyPercentage;
    if (typeof gWk === 'number' && gWk <= 0) return false;
    const gPct = a.quotas?.geminiFiveHourPct ?? a.quotas?.fiveHourPercentage;
    if (typeof gPct === 'number' && gPct <= 0) return false;
    return true;
  });

  const readyClaudeAccounts = accounts.filter((a) => {
    if (!a || a.enabled === false) return false;
    if (isAccountValidationRequiredTelemetry(a) || isAccountBlockedTelemetry(a)) return false;
    const isStudio = a.provider === 'google-gemini' || (typeof a.apiKey === 'string' && (a.apiKey.startsWith('AQ.') || a.apiKey.startsWith('AIzaSy')));
    const isCli = a.provider === 'gemini-cli' || (typeof a.id === 'string' && a.id.startsWith('gemini-cli'));
    if (isStudio || isCli) return false;
    if (isAccountInCooldownTelemetry(a, 'claude', activeCooldowns, nowMs)) return false;
    const cWk = a.quotas?.claudeWeeklyPct;
    if (typeof cWk === 'number' && cWk <= 0) return false;
    const cPct = a.quotas?.claudeFiveHourPct;
    if (typeof cPct === 'number' && cPct <= 0) return false;
    return true;
  });

  // 1. Expired cooldowns check
  let expiredCooldowns = 0;
  for (const [_, v] of Object.entries(activeCooldowns)) {
    if (v && v.until <= nowMs) expiredCooldowns++;
  }
  if (expiredCooldowns > 0) {
    return {
      icon: '⚡',
      text: `${expiredCooldowns} compte(s) avec cooldown expiré disponibles au réveil.`,
      actionType: 'wake',
      actionLabel: 'Réveiller tout',
    };
  }

  // 2. Critical accounts (<3% 5h) check
  const criticalAccounts = accounts.filter((a) => {
    if (!a || a.enabled === false) return false;
    const q = a.quotas || {};
    const gPct = q.geminiFiveHourPct ?? q.fiveHourPercentage ?? 100;
    const cPct = q.claudeFiveHourPct ?? 100;
    return gPct > 0 && gPct <= 3 && cPct <= 3;
  });
  if (criticalAccounts.length > 0) {
    return {
      icon: '⚠️',
      text: `${criticalAccounts.length} compte(s) en réserve critique (<3%). Mettez-les au repos préventif pour protéger le P2C.`,
      actionType: 'soft-stow',
      actionLabel: 'Mettre au repos (<3%)',
    };
  }

  // 3. Claude saturation check (Claude bridge exhausted, but Gemini healthy)
  if (readyClaudeAccounts.length === 0 && readyGeminiAccounts.length > 0) {
    return {
      icon: '💡',
      text: `Plafond Claude atteint sur le pool (0 prêt) — Gemini 3.8 Flash opérationnel (${readyGeminiAccounts.length}/${accounts.length} prêts). Privilégiez Gemini.`,
      actionType: 'switch-gemini',
      actionLabel: 'Modèle Gemini Flash',
    };
  }

  // 4. All accounts busy/cooldown on BOTH families
  if (readyGeminiAccounts.length === 0 && readyClaudeAccounts.length === 0) {
    return {
      icon: '🚨',
      text: 'Tous les comptes sont temporairement indisponibles (cooldown ou pause).',
      actionType: 'wake',
      actionLabel: 'Forcer Réveil',
    };
  }

  // 5. Significant portion of accounts requiring validation or blocked (Cognitive realism)
  const problematicAccounts = accounts.filter((a) => {
    if (!a) return false;
    const isVal = Boolean(a.validationRequired || a.quotas?.validationRequired || a.status === 'validation_required');
    const isBlocked = Boolean(a.isUnlicensed || a.quotas?.isUnlicensed || a.errorDetails || a.quotas?.errorDetails);
    return isVal || isBlocked;
  });

  if (problematicAccounts.length > 0 && accounts.length > 0) {
    const problemRatio = problematicAccounts.length / accounts.length;
    if (problemRatio >= 0.25) {
      return {
        icon: '⚠️',
        text: `Pool dégradé : ${readyGeminiAccounts.length}/${accounts.length} prêts (${problematicAccounts.length} compte(s) requièrent une validation ou sont bloqués).`,
      };
    }
  }

  return {
    icon: '🟢',
    text: `Pool nominal et équilibré : ${readyGeminiAccounts.length}/${accounts.length} comptes prêts pour Gemini (${readyClaudeAccounts.length} pour Claude).`,
  };
}

export interface PoolResilienceResult {
  score: number; // 0 to 100
  label: string;
  grade: 'optimal' | 'healthy' | 'tense' | 'critical';
  color: string;
  details: string;
}

/**
 * Calculates a consolidated resilience health score (0-100) reflecting multi-tier redundancy.
 * Factors: Gemini pool readiness (35%), Claude bridge fallback (25%), Standby/Studio backup (15%), Runway depth (25%).
 */
export function calculatePoolResilienceScore(
  accounts: any[] = [],
  activeCooldowns: Record<string, { until: number }> = {},
  nowMs: number = Date.now()
): PoolResilienceResult {
  if (!Array.isArray(accounts) || accounts.length === 0) {
    return {
      score: 0,
      label: 'Pool Inactif',
      grade: 'critical',
      color: '#ef4444',
      details: 'Aucun compte configuré',
    };
  }

  let totalAccounts = accounts.length;
  let readyGemini = 0;
  let readyClaude = 0;
  let hasStudioOrCli = false;

  for (const a of accounts) {
    if (!a || a.enabled === false) continue;
    if (isAccountValidationRequiredTelemetry(a) || isAccountBlockedTelemetry(a)) continue;
    const isStudio = a.provider === 'google-gemini' || (typeof a.apiKey === 'string' && (a.apiKey.startsWith('AQ.') || a.apiKey.startsWith('AIzaSy')));
    const isCli = a.provider === 'gemini-cli' || (typeof a.id === 'string' && a.id.startsWith('gemini-cli'));

    if (isStudio || isCli) {
      hasStudioOrCli = true;
      continue;
    }

    if (a.isUnlicensed || a.quotas?.isUnlicensed) continue;

    const inGeminiCd = isAccountInCooldownTelemetry(a, 'gemini', activeCooldowns, nowMs);
    const gWk = a.quotas?.geminiWeeklyPct ?? a.quotas?.weeklyPercentage ?? 100;
    const gPct = (gWk <= 0 || inGeminiCd) ? 0 : (a.quotas?.geminiFiveHourPct ?? a.quotas?.fiveHourPercentage ?? 100);
    if (!inGeminiCd && gPct > 0) {
      readyGemini++;
    }

    const inClaudeCd = isAccountInCooldownTelemetry(a, 'claude', activeCooldowns, nowMs);
    const cWk = a.quotas?.claudeWeeklyPct ?? 100;
    const cPct = (cWk <= 0 || inClaudeCd) ? 0 : (a.quotas?.claudeFiveHourPct ?? 100);
    if (!inClaudeCd && cPct > 0) {
      readyClaude++;
    }
  }

  // 1. Gemini readiness (35 pts)
  const geminiRatio = totalAccounts > 0 ? readyGemini / totalAccounts : 0;
  const geminiPoints = Math.round(geminiRatio * 35);

  // 2. Claude bridge availability (25 pts)
  const claudeRatio = totalAccounts > 0 ? readyClaude / totalAccounts : 0;
  const claudePoints = Math.round(claudeRatio * 25);

  // 3. Studio / CLI safety net (15 pts)
  const backupPoints = hasStudioOrCli ? 15 : 0;

  // 4. Runway depth (25 pts)
  const runway = calculatePoolRunway(accounts);
  let runwayPoints = 0;
  if (runway.runwayHours >= 4) {
    runwayPoints = 25;
  } else if (runway.runwayHours >= 2) {
    runwayPoints = 18;
  } else if (runway.runwayHours >= 1 || runway.runwayMinutes >= 30) {
    runwayPoints = 10;
  } else if (runway.totalAvailableTokens > 0) {
    runwayPoints = 5;
  }

  const score = Math.max(0, Math.min(100, geminiPoints + claudePoints + backupPoints + runwayPoints));

  let grade: 'optimal' | 'healthy' | 'tense' | 'critical' = 'critical';
  let label = 'Critique';
  let color = '#ef4444';

  if (score >= 80) {
    grade = 'optimal';
    label = 'Ultra-Résilient';
    color = '#10b981';
  } else if (score >= 60) {
    grade = 'healthy';
    label = 'Opérationnel';
    color = '#38bdf8';
  } else if (score >= 35) {
    grade = 'tense';
    label = 'Tension Modérée';
    color = '#f59e0b';
  }

  const details = `${readyGemini}/${totalAccounts} Gemini, ${readyClaude}/${totalAccounts} Claude, Runway ${runway.formattedRunway}`;

  return {
    score,
    label,
    grade,
    color,
    details,
  };
}

export interface FallbackStep {
  tier: number;
  id: string;
  name: string;
  status: 'ready' | 'degraded' | 'blocked' | 'critical';
  icon: string;
  badgeText: string;
}

/**
 * Returns the live 4-tier cascade routing chain indicating what route receives prompts.
 */
export function getPoolFallbackChain(
  accounts: any[] = [],
  activeCooldowns: Record<string, { until: number }> = {},
  nowMs: number = Date.now()
): FallbackStep[] {
  if (!Array.isArray(accounts)) return [];

  let readyGemini = 0;
  let readyClaude = 0;
  let hasStudio = false;

  for (const a of accounts) {
    if (!a || a.enabled === false) continue;
    if (isAccountValidationRequiredTelemetry(a) || isAccountBlockedTelemetry(a)) continue;
    const isStudio = a.provider === 'google-gemini' || (typeof a.apiKey === 'string' && (a.apiKey.startsWith('AQ.') || a.apiKey.startsWith('AIzaSy')));
    if (isStudio) {
      hasStudio = true;
      continue;
    }
    const isCli = a.provider === 'gemini-cli' || (typeof a.id === 'string' && a.id.startsWith('gemini-cli'));
    if (isCli) continue;

    const inGeminiCd = isAccountInCooldownTelemetry(a, 'gemini', activeCooldowns, nowMs);
    const gPct = inGeminiCd ? 0 : (a.quotas?.geminiFiveHourPct ?? a.quotas?.fiveHourPercentage ?? 100);
    if (!inGeminiCd && gPct > 0) readyGemini++;

    const inClaudeCd = isAccountInCooldownTelemetry(a, 'claude', activeCooldowns, nowMs);
    const cPct = inClaudeCd ? 0 : (a.quotas?.claudeFiveHourPct ?? 100);
    if (!inClaudeCd && cPct > 0) readyClaude++;
  }

  const steps: FallbackStep[] = [
    {
      tier: 1,
      id: 'gemini-pool',
      name: 'Gemini Pool',
      status: readyGemini >= 2 ? 'ready' : (readyGemini === 1 ? 'degraded' : 'blocked'),
      icon: '💎',
      badgeText: `${readyGemini} prêt${readyGemini > 1 ? 's' : ''}`,
    },
    {
      tier: 2,
      id: 'gemini-flash',
      name: 'Gemini Flash',
      status: readyGemini > 0 ? 'ready' : 'blocked',
      icon: '⚡',
      badgeText: readyGemini > 0 ? 'Disponible' : 'Indisponible',
    },
    {
      tier: 3,
      id: 'claude-bridge',
      name: 'Claude Bridge',
      status: readyClaude >= 1 ? 'ready' : 'blocked',
      icon: '🎭',
      badgeText: readyClaude > 0 ? `${readyClaude} prêt` : 'Plafond',
    },
    {
      tier: 4,
      id: 'ai-studio',
      name: 'AI Studio Fallback',
      status: hasStudio ? 'ready' : (readyGemini > 0 && readyGemini <= 5 ? 'critical' : 'degraded'),
      icon: '🛡️',
      badgeText: hasStudio ? 'Actif' : 'Non configuré',
    },
  ];

  return steps;
}

export type BurnProfile = 'eco' | 'normal' | 'burst';

/**
 * Calculates runway projection according to working load profile.
 */
export function calculateBurnProjection(
  accounts: any[],
  profile: BurnProfile = 'normal',
  activeCooldowns: Record<string, { until: number }> = {},
  nowMs: number = Date.now()
): PoolRunwayResult {
  const rates: Record<BurnProfile, number> = {
    eco: 25_000_000,
    normal: 50_000_000,
    burst: 100_000_000,
  };
  return calculatePoolRunway(accounts, rates[profile] || 50_000_000, activeCooldowns, nowMs);
}

