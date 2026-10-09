export interface PoolRunwayResult {
  totalAvailableTokens: number;
  hourlyBurnRate: number;
  runwayHours: number;
  runwayMinutes: number;
  formattedRunway: string;
  burnState: 'healthy' | 'moderate' | 'critical';
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
 * Default hourly burn rate is 120,000 tokens/hr (active AI pair programming).
 */
export function calculatePoolRunway(
  accounts: any[],
  hourlyBurnRate = 120_000
): PoolRunwayResult {
  if (!Array.isArray(accounts) || accounts.length === 0 || hourlyBurnRate <= 0) {
    return {
      totalAvailableTokens: 0,
      hourlyBurnRate,
      runwayHours: 0,
      runwayMinutes: 0,
      formattedRunway: '0h 00m',
      burnState: 'critical',
    };
  }

  let totalAvailableTokens = 0;
  for (const acc of accounts) {
    if (!acc || acc.enabled === false) continue;
    // Skip AI Studio or CLI if they don't share Antigravity pool tokens
    const isStudio = acc.provider === 'google-gemini' || (typeof acc.apiKey === 'string' && (acc.apiKey.startsWith('AQ.') || acc.apiKey.startsWith('AIzaSy')));
    const isCli = acc.provider === 'gemini-cli' || (typeof acc.id === 'string' && acc.id.startsWith('gemini-cli'));
    if (isStudio || isCli) continue;

    // Estimate based on 5h rolling capacity and percentage
    const q = acc.quotas || {};
    const pct5h = q.geminiFiveHourPct ?? q.fiveHourPercentage ?? 100;
    const tier = String(acc.tier || '').toUpperCase();
    const cap5h = tier.includes('ULTRA') ? 800_000 : (tier.includes('FREE') ? 120_000 : 350_000);
    const avail = Math.round((cap5h * Math.max(0, Math.min(100, pct5h))) / 100);
    totalAvailableTokens += avail;
  }

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
  maxItems = 4
): UpcomingResetItem[] {
  if (!Array.isArray(accounts)) return [];

  const items: UpcomingResetItem[] = [];

  for (const acc of accounts) {
    if (!acc) continue;
    const accountName = acc.name || acc.email || acc.id || 'Compte Google';
    const quotas = acc.quotas || {};

    // 5H Reset
    if (quotas.fiveHourResetTime) {
      const t = new Date(quotas.fiveHourResetTime).getTime();
      const diff = t - nowMs;
      if (!isNaN(diff) && diff > 0) {
        items.push({
          accountId: acc.id,
          accountName,
          type: '5h',
          targetTime: quotas.fiveHourResetTime,
          remainingMs: diff,
          formattedCountdown: formatCompactDuration(diff),
        });
      }
    }

    // Weekly Reset
    if (quotas.weeklyResetTime) {
      const t = new Date(quotas.weeklyResetTime).getTime();
      const diff = t - nowMs;
      if (!isNaN(diff) && diff > 0) {
        items.push({
          accountId: acc.id,
          accountName,
          type: 'weekly',
          targetTime: quotas.weeklyResetTime,
          remainingMs: diff,
          formattedCountdown: formatCompactDuration(diff),
        });
      }
    }

    // Cooldown
    const cd = acc.cooldown;
    if (cd && cd.until) {
      const t = new Date(cd.until).getTime();
      const diff = t - nowMs;
      if (!isNaN(diff) && diff > 0) {
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

  if (rpm >= 10) {
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
    const isStudio = a.provider === 'google-gemini' || (typeof a.apiKey === 'string' && (a.apiKey.startsWith('AQ.') || a.apiKey.startsWith('AIzaSy')));
    const isCli = a.provider === 'gemini-cli' || (typeof a.id === 'string' && a.id.startsWith('gemini-cli'));
    if (isStudio || isCli) return true;
    const cdKey = `google:${a.email || a.name || a.id}:gemini`;
    const cd = activeCooldowns[cdKey];
    if (cd && cd.until > nowMs) return false;
    const gPct = a.quotas?.geminiFiveHourPct ?? a.quotas?.fiveHourPercentage;
    if (typeof gPct === 'number' && gPct <= 0) return false;
    return true;
  });

  const readyClaudeAccounts = accounts.filter((a) => {
    if (!a || a.enabled === false) return false;
    const isStudio = a.provider === 'google-gemini' || (typeof a.apiKey === 'string' && (a.apiKey.startsWith('AQ.') || a.apiKey.startsWith('AIzaSy')));
    const isCli = a.provider === 'gemini-cli' || (typeof a.id === 'string' && a.id.startsWith('gemini-cli'));
    if (isStudio || isCli) return false;
    const cdKey = `google:${a.email || a.name || a.id}:claude`;
    const cd = activeCooldowns[cdKey];
    if (cd && cd.until > nowMs) return false;
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
    const isStudio = a.provider === 'google-gemini' || (typeof a.apiKey === 'string' && (a.apiKey.startsWith('AQ.') || a.apiKey.startsWith('AIzaSy')));
    const isCli = a.provider === 'gemini-cli' || (typeof a.id === 'string' && a.id.startsWith('gemini-cli'));

    if (isStudio || isCli) {
      hasStudioOrCli = true;
      continue;
    }

    const gCd = activeCooldowns[`google:${a.email || a.name || a.id}:gemini`];
    const gPct = a.quotas?.geminiFiveHourPct ?? a.quotas?.fiveHourPercentage ?? 100;
    if ((!gCd || gCd.until <= nowMs) && gPct > 0) {
      readyGemini++;
    }

    const cCd = activeCooldowns[`google:${a.email || a.name || a.id}:claude`];
    const cPct = a.quotas?.claudeFiveHourPct ?? 100;
    if ((!cCd || cCd.until <= nowMs) && cPct > 0) {
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
  status: 'ready' | 'degraded' | 'blocked';
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
    const isStudio = a.provider === 'google-gemini' || (typeof a.apiKey === 'string' && (a.apiKey.startsWith('AQ.') || a.apiKey.startsWith('AIzaSy')));
    if (isStudio) {
      hasStudio = true;
      continue;
    }
    const isCli = a.provider === 'gemini-cli' || (typeof a.id === 'string' && a.id.startsWith('gemini-cli'));
    if (isCli) continue;

    const gCd = activeCooldowns[`google:${a.email || a.name || a.id}:gemini`];
    const gPct = a.quotas?.geminiFiveHourPct ?? a.quotas?.fiveHourPercentage ?? 100;
    if ((!gCd || gCd.until <= nowMs) && gPct > 0) readyGemini++;

    const cCd = activeCooldowns[`google:${a.email || a.name || a.id}:claude`];
    const cPct = a.quotas?.claudeFiveHourPct ?? 100;
    if ((!cCd || cCd.until <= nowMs) && cPct > 0) readyClaude++;
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
      status: hasStudio ? 'ready' : 'degraded',
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
  profile: BurnProfile = 'normal'
): PoolRunwayResult {
  const rates: Record<BurnProfile, number> = {
    eco: 60_000,
    normal: 120_000,
    burst: 250_000,
  };
  return calculatePoolRunway(accounts, rates[profile] || 120_000);
}

