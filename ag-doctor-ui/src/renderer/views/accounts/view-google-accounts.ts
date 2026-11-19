import {
  parseAccountsJson,
  normalizeAccountEntry,
  findMatchingAccount,
  mergeAccountWithExisting,
} from '../../services/accounts/account-import';
import {
  calculatePoolRunway,
  getUpcomingResetsTimeline,
  formatLiveCountdown,
  calculatePoolVelocity,
  getPoolStrategicAdvice,
  calculatePoolResilienceScore,
  getPoolFallbackChain,
  calculateBurnProjection,
  BurnProfile,
} from '../../services/accounts/google-accounts-telemetry';
import {
  testSingleModel,
  testBatchModels,
  renderPingBadge,
  formatApiError,
  PingPongResult,
} from '../../services/accounts/ping-pong-tester';



﻿// Google Accounts Manager (Multi-Account Endpoint & Model Discovery)
// ─────────────────────────────────────────────────────────────────────────────

const gaAccountsContainer = $('#gaAccountsContainer') as HTMLDivElement | null;
const gaAccountCountBadge = $('#gaAccountCountBadge') as HTMLSpanElement | null;
const gaStatTotalAccounts = $('#gaStatTotalAccounts') as HTMLDivElement | null;
const gaStatActiveAccounts = $('#gaStatActiveAccounts') as HTMLDivElement | null;
const gaStatTotalModels = $('#gaStatTotalModels') as HTMLDivElement | null;

const gaAddAccountBtn = $('#gaAddAccountBtn') as HTMLButtonElement | null;
const gaTestAllBtn = $('#gaTestAllBtn') as HTMLButtonElement | null;
const gaSyncAllBtn = $('#gaSyncAllBtn') as HTMLButtonElement | null;
const gaRepairCooldownsBtn = $('#gaRepairCooldownsBtn') as HTMLButtonElement | null;
const gaDensityToggleBtn = $('#gaDensityToggleBtn') as HTMLButtonElement | null;

const gaModalBackdrop = $('#googleAccountModalBackdrop') as HTMLDivElement | null;
const gaModalClose = $('#googleAccountModalClose') as HTMLButtonElement | null;
const gaModalTitle = $('#gaModalTitle') as HTMLHeadingElement | null;
const gaFormName = $('#gaFormName') as HTMLInputElement | null;
const gaFormUrl = $('#gaFormUrl') as HTMLInputElement | null;
const gaFormKey = $('#gaFormKey') as HTMLInputElement | null;
const gaKeyToggle = $('#gaKeyToggle') as HTMLButtonElement | null;
const gaFormFetchModelsBtn = $('#gaFormFetchModelsBtn') as HTMLButtonElement | null;
const gaFormModelsList = $('#gaFormModelsList') as HTMLDivElement | null;
const gaFormModelsCountBadge = $('#gaFormModelsCountBadge') as HTMLDivElement | null;
const gaFormError = $('#gaFormError') as HTMLDivElement | null;
const gaFormCancelBtn = $('#gaFormCancelBtn') as HTMLButtonElement | null;
const gaFormSaveBtn = $('#gaFormSaveBtn') as HTMLButtonElement | null;
const gaOpenAiStudioLink = $('#gaOpenAiStudioLink') as HTMLAnchorElement | null;
const gaAccountTypeBanner = $('#gaAccountTypeBanner') as HTMLDivElement | null;
const gaFormKeyLabel = $('#gaFormKeyLabel') as HTMLSpanElement | null;
const gaFormKeyHelper = $('#gaFormKeyHelper') as HTMLElement | null;
const gaFormCustomModelInput = $('#gaFormCustomModelInput') as HTMLInputElement | null;
const gaFormAddCustomModelBtn = $('#gaFormAddCustomModelBtn') as HTMLButtonElement | null;
const gaFormSelectAllBtn = $('#gaFormSelectAllBtn') as HTMLButtonElement | null;
const gaFormDeselectAllBtn = $('#gaFormDeselectAllBtn') as HTMLButtonElement | null;

let editingGoogleAccountId: string | null = null;
let currentGaFetchedModels: Array<{ id: string; displayName: string; enabled: boolean }> = [];
let googleAccountsCache: ProviderEntry[] = [];
let gaCurrentQuotaWindow: '5h' | 'weekly' = 'weekly';
let gaCurrentViewMode: 'list' | 'grid' = 'list';
let gaCurrentFilter: 'all' | 'pro' | 'ultra' | 'free' | 'status:ready' | 'status:exhausted' | 'status:cooldown' | 'status:paused' | 'status:blocked' | 'status:validation' = 'all';
let gaSearchQuery: string = '';
let gaShowAllQuotas: boolean = true;
let gaSortColumn: 'name' | 'quota' | 'lastUsed' | null = null;
let gaSortDirection: 'asc' | 'desc' = 'asc';
let gaSelectedIds: Set<string> = new Set();
let gaToolbarInitialized: boolean = false;
let gaActiveCooldownsCache: Record<string, { until: number; remainingMs: number; remainingMin: number; remainingHours: string }> = {};

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

function getAccountActiveCooldown(
  account: any,
  family: 'gemini' | 'claude' | 'any' = 'any'
): {
  isCooldown: boolean;
  family: 'Gemini' | 'Claude' | 'Global';
  isWeeklyCap: boolean;
  text: string;
  details: string;
  remainingHours: string;
  remainingMin: number;
  until: number;
} | null {
  if (!account) return null;
  const email = (account.email || '').toLowerCase().trim();
  const name = (account.name || '').toLowerCase().trim();
  const id = (account.id || '').toLowerCase().trim();
  const cleanId = id.replace(/^(google|gemini-cli):/, '');
  const cleanName = name.replace(/^(google|gemini-cli):/, '');

  let foundKey = '';
  let cdData: { until: number; remainingMs: number; remainingMin: number; remainingHours: string } | null = null;
  const now = Date.now();

  for (const [k, v] of Object.entries(gaActiveCooldownsCache)) {
    if (!v || v.until <= now) continue;
    const lowerK = k.toLowerCase();
    // Decouple by model family if requested
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
      foundKey = k;
      cdData = v;
      break;
    }
  }

  if (!cdData) return null;
  const fam: 'Gemini' | 'Claude' | 'Global' = foundKey.endsWith(':gemini') ? 'Gemini' : (foundKey.endsWith(':claude') ? 'Claude' : 'Global');
  const remH = parseFloat(cdData.remainingHours);
  const isWeeklyCap = remH > 5;
  const timeText = remH >= 24 ? `${Math.floor(remH / 24)}j ${Math.floor(remH % 24)}h` : (remH >= 1 ? `${cdData.remainingHours}h` : `${cdData.remainingMin}m`);

  const text = isWeeklyCap
    ? `📅 Plafond Hebdo ${fam} (${timeText})`
    : `⏳ Cooldown ${fam} (${timeText})`;

  const details = isWeeklyCap
    ? `Plafond hebdomadaire atteint pour ${fam}. Renouvellement prévu dans ${timeText} (vers ${new Date(cdData.until).toLocaleDateString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })})`
    : `Compte en pause suite à 429/504 jusqu'à ${new Date(cdData.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (${timeText} restant)`;

  return {
    isCooldown: true,
    family: fam,
    isWeeklyCap,
    text,
    details,
    remainingHours: cdData.remainingHours,
    remainingMin: cdData.remainingMin,
    until: cdData.until,
  };
}

function maskKeyPreview(key: string): string {
  if (!key || key === 'none') return '(none)';
  if (key.startsWith('enc:')) return '•••••••• (encrypted)';
  if (key.length <= 8) return '••••••••';
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

function formatResetCountdown(isoDateStr?: string): string {
  if (!isoDateStr) return '';
  const target = new Date(isoDateStr).getTime();
  const diffMs = target - Date.now();
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

function formatCompactCountdown(isoDateStr?: string): string {
  if (!isoDateStr) return '';
  const target = new Date(isoDateStr).getTime();
  const diffMs = target - Date.now();
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

function formatLastUsed(ts?: number | string): string {
  if (!ts) return '<span style="color: var(--text-3, #71717a); font-style: italic;">Jamais</span>';
  const d = new Date(ts);
  const time = d.getTime();
  if (isNaN(time)) return '<span style="color: var(--text-3, #71717a); font-style: italic;">Jamais</span>';
  const full = d.toLocaleString(undefined, {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
  const diffSec = Math.max(0, Math.floor((Date.now() - time) / 1000));
  let rel = '';
  if (diffSec < 60) {
    rel = "À l'instant";
  } else if (diffSec < 3600) {
    const mins = Math.floor(diffSec / 60);
    rel = `Il y a ${mins}m`;
  } else if (diffSec < 86400) {
    const hrs = Math.floor(diffSec / 3600);
    rel = `Il y a ${hrs}h`;
  } else {
    const days = Math.floor(diffSec / 86400);
    rel = `Il y a ${days}j`;
  }
  return `<span title="${escapeHtml(full)}" style="color: var(--text-2, #a1a1aa); font-weight: 500; cursor: help;">${escapeHtml(rel)}</span>`;
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

function getAccountTier(acc: any): 'PRO' | 'ULTRA' | 'FREE' | 'STUDIO' | 'CLI' | 'PARTAGE' {
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

function getAiStudioQuotaEstimate(acc: any): {
  rpdLimit: number;
  rpdUsed: number;
  rpdRemainingPct: number;
  rpdAvailableTokens: number;
  rpmLimit: number;
  rpmPct: number;
  resetCountdown: string;
} {
  // Google AI Studio Free Tier standard: 1,500 RPD, 15 RPM
  const rpdLimit = 1500;
  const rpmLimit = 15;
  const totalDailyTokens = 37_500_000;

  // Calcul des requêtes utilisées aujourd'hui depuis minuit UTC
  const now = new Date();
  const startOfDayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0);

  let rpdUsed = 0;
  let tokensUsed = 0;
  if (tokenTracker) {
    try {
      const entries = tokenTracker.getEntries();
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

  // Temps restant jusqu'à la réinitialisation Google Cloud (00:00 UTC)
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
  // Gemini CLI standard: 1,000 RPD (Free) / 1,500 RPD (Google AI Pro), 60 RPM
  const isPro = (acc.tierId && String(acc.tierId).toUpperCase().includes('PRO')) ||
                (acc.tier && String(acc.tier).toUpperCase().includes('PRO')) ||
                (acc.name && acc.name.toLowerCase().includes('pro'));
  const rpdLimit = isPro ? 1500 : 1000;
  const rpmLimit = 60;
  const totalDailyTokens = isPro ? 45_000_000 : 30_000_000;

  // Calcul des requêtes utilisées aujourd'hui depuis minuit UTC
  const now = new Date();
  const startOfDayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0);

  let rpdUsed = 0;
  let tokensUsed = 0;
  if (tokenTracker) {
    try {
      const entries = tokenTracker.getEntries();
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

  // Temps restant jusqu'à la réinitialisation Google Cloud (00:00 UTC)
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
  let gemini5hPct = (typeof q.geminiFiveHourPct === 'number' ? q.geminiFiveHourPct : foundGemini5h) ?? q.fiveHourPercentage ?? (acc?.status === 'unhealthy' ? 0 : 100);
  let geminiWkPct = (typeof q.geminiWeeklyPct === 'number' ? q.geminiWeeklyPct : foundGeminiWk) ?? q.weeklyPercentage ?? (acc?.status === 'unhealthy' ? 0 : 100);
  let claudeWkPct = (typeof q.claudeWeeklyPct === 'number' ? q.claudeWeeklyPct : foundClaudeWk) ?? (q.groups && foundClaudeWk === undefined && typeof q.claudeWeeklyPct !== 'number' ? 0 : (acc?.status === 'unhealthy' ? 0 : 100));
  let claude5hPct = (typeof q.claudeFiveHourPct === 'number' ? q.claudeFiveHourPct : foundClaude5h) ?? (acc?.status === 'unhealthy' ? 0 : 100);
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

  // Cooldown reality override: when the proxy has an active cooldown, the account is NOT ready for that model family
  const cdGemini = getAccountActiveCooldown(acc, 'gemini');
  const cdClaude = getAccountActiveCooldown(acc, 'claude');
  if (cdGemini?.isCooldown) {
    gemini5hPct = 0;
    if (cdGemini.isWeeklyCap) {
      geminiWkPct = 0;
    }
  }
  if (cdClaude?.isCooldown) {
    claude5hPct = 0;
    if (cdClaude.isWeeklyCap) {
      claudeWkPct = 0;
    }
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
    : (foundGeminiWkReset || (q.geminiWeeklyReset && q.geminiWeeklyReset !== rawGemini5hReset ? q.geminiWeeklyReset : undefined) || q.weeklyResetTime || (!is5hWindowReset(q.geminiResetTime) ? q.geminiResetTime : undefined) || rawGemini5hReset);
  const rawClaude5hReset = (cdClaude?.until && cdClaude.until > Date.now())
    ? new Date(cdClaude.until).toISOString()
    : (foundClaude5hReset || q.claudeFiveHourReset || (is5hWindowReset(q.claudeResetTime) ? q.claudeResetTime : undefined));
  const rawClaudeWkReset = (cdClaude?.isWeeklyCap && cdClaude?.until && cdClaude.until > Date.now())
    ? new Date(cdClaude.until).toISOString()
    : (foundClaudeWkReset || q.claudeWeeklyReset || (!is5hWindowReset(q.claudeWeeklyReset) ? q.claudeWeeklyReset : rawGeminiWkReset));
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

function isAccountCapExhausted(a: any, windowMode: '5h' | 'weekly' = gaCurrentQuotaWindow || '5h'): boolean {
  if (!a) return false;
  // Accounts with an active cooldown timer belong strictly under Cooldown, NOT Cap Épuisé
  const cdGemini = getAccountActiveCooldown(a, 'gemini');
  if (cdGemini) return false;

  if (a.status === 'exhausted') return true;

  const eff = getAccountEffectiveQuotas(a);

  // If Gemini has positive quota (> 5% in both 5h and weekly), the account is NOT exhausted (Gemini requests run normally)
  if (eff.gemini5hPct > 5 && eff.geminiWkPct > 5) return false;

  // If active window is weekly and weekly quota is depleted
  if (windowMode === 'weekly') {
    if (eff.geminiWkPct <= 0) return true;
  }

  // 0% quota in 5h rolling window or weekly quota (since weekly 0% locks the account)
  if (eff.gemini5hPct <= 0 || eff.geminiWkPct <= 0) return true;

  // Critical insufficient quota (<= 5% remaining in both Gemini buckets)
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
  // Only calculate Antigravity quotas — exclude Google AI Studio & CLI
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
  // Real calibrated Antigravity capacity:
  // Gemini 5h (100%) = 13% weekly = 250M tokens
  // Claude 5h (100%) = 50% weekly
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

function calculatePoolTokenSummary(accounts: any[], isWeekly: boolean = true) {
  let totalCap = 0;
  let availableTokens = 0;
  let consumedTokens = 0;
  let activeCount = 0;
  let antigravityTotal = 0;

  if (!Array.isArray(accounts)) accounts = [];

  for (const acc of accounts) {
    if (!acc) continue;
    // Calcul exclusif sur les comptes Antigravity (sans AI Studio ni CLI)
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

  // Équivalence tarifaire réaliste API Gemini Pro / Flash ($0.25 pour 1M tokens)
  const equivDollarValue = (availableTokens / 1_000_000) * 0.25;

  return {
    totalCapacity: totalCap,
    availableTokens,
    consumedTokens,
    equivDollarValue,
    activeCount,
    antigravityTotal,
    pctAvailable: totalCap > 0 ? Math.round((availableTokens / totalCap) * 100) : 100,
    pctConsumed: totalCap > 0 ? Math.round((consumedTokens / totalCap) * 100) : 0,
  };
}

function updateGoogleAccountsTokenStats(accounts: any[]): void {
  if (!Array.isArray(accounts)) {
    accounts = Array.isArray(googleAccountsCache) ? googleAccountsCache : [];
  }
  const isWeekly = gaCurrentQuotaWindow === 'weekly';
  const summary = calculatePoolTokenSummary(accounts, isWeekly);
  const total = summary.antigravityTotal || accounts.length;

  const gaTokenWindowBadge = $('#gaTokenWindowBadge');
  const gaStatAvailableTokens = $('#gaStatAvailableTokens');
  const gaStatAvailableTokensSub = $('#gaStatAvailableTokensSub');
  const gaStatTotalCapacity = $('#gaStatTotalCapacity');
  const gaStatTotalCapacitySub = $('#gaStatTotalCapacitySub');
  const gaStatPoolValue = $('#gaStatPoolValue');
  const gaStatPoolValueSub = $('#gaStatPoolValueSub');

  if (gaTokenWindowBadge) {
    gaTokenWindowBadge.textContent = 'Live Proxy';
    gaTokenWindowBadge.style.background = 'rgba(16, 185, 129, 0.12)';
    gaTokenWindowBadge.style.color = '#10b981';
    gaTokenWindowBadge.style.borderColor = 'rgba(16, 185, 129, 0.25)';
  }

  // Calculate real live token events processed by proxy
  let liveTokensProcessed = 0;
  let livePromptTokens = 0;
  let liveCompletionTokens = 0;
  let liveRequestCount = 0;

  if (cachedRealStats?.sessions && Array.isArray(cachedRealStats.sessions) && cachedRealStats.sessions.length > 0) {
    liveRequestCount = cachedRealStats.sessions.length;
    for (const s of cachedRealStats.sessions) {
      livePromptTokens += (s.promptTokens || 0);
      liveCompletionTokens += (s.completionTokens || 0);
      liveTokensProcessed += (s.totalTokens || ((s.promptTokens || 0) + (s.completionTokens || 0)));
    }
  } else if (cachedRealStats?.activityByDay && cachedRealStats.activityByDay.length > 0) {
    for (const d of cachedRealStats.activityByDay) {
      liveRequestCount += ((d as any).requests || d.steps || 0);
      liveTokensProcessed += ((d as any).totalTokens || d.estimatedTokens || 0);
      livePromptTokens += ((d as any).promptTokens || 0);
      liveCompletionTokens += ((d as any).completionTokens || 0);
    }
  }

  // Non-blocking background fetch if not yet in memory
  if (!cachedRealStats) {
    void ensureRealTokenStats().then((res) => {
      if (res) updateGoogleAccountsTokenStats(accounts);
    }).catch((err) => {
      console.warn('[Doctor-UI] ensureRealTokenStats in updateGoogleAccountsTokenStats failed:', err);
    });
  }

  // Card 1: Tokens Traités (Proxy)
  if (gaStatAvailableTokens) {
    gaStatAvailableTokens.textContent = liveTokensProcessed > 0
      ? formatCompactTokens(liveTokensProcessed)
      : 'En écoute...';
  }
  if (gaStatAvailableTokensSub) {
    const text = liveTokensProcessed > 0
      ? `${formatCompactTokens(livePromptTokens)} In · ${formatCompactTokens(liveCompletionTokens)} Out (Proxy)`
      : 'Total réel mesuré depuis le proxy';
    gaStatAvailableTokensSub.textContent = text;
    gaStatAvailableTokensSub.title = text;
  }

  // Card 2: Requêtes Traitées
  if (gaStatTotalCapacity) {
    gaStatTotalCapacity.textContent = liveRequestCount > 0
      ? `${liveRequestCount.toLocaleString('fr-FR')} req`
      : '0 req';
  }
  if (gaStatTotalCapacitySub) {
    const text = liveRequestCount > 0
      ? `${liveRequestCount.toLocaleString('fr-FR')} succès proxy`
      : 'Requêtes actives du pool';
    gaStatTotalCapacitySub.textContent = text;
    gaStatTotalCapacitySub.title = text;
  }

  // Card 3: Capacité Moyenne du Pool (Flotte réelle)
  let totalActivePct = 0;
  let activeQuotaAccountsCount = 0;
  for (const acc of accounts) {
    if (isAiStudioAccount(acc) || isGeminiCliAccount(acc)) continue;
    activeQuotaAccountsCount++;
    if (acc.enabled === false || isAccountValidationRequired(acc) || isAccountUnlicensed(acc)) continue;
    const eff = getAccountEffectiveQuotas(acc);
    const pct = isWeekly ? eff.geminiWkPct : eff.gemini5hPct;
    totalActivePct += Math.max(0, Math.min(100, pct));
  }
  const avgPoolPct = activeQuotaAccountsCount > 0 ? (totalActivePct / activeQuotaAccountsCount) : 100;

  if (gaStatPoolValue) {
    gaStatPoolValue.textContent = formatQuotaPercent(avgPoolPct);
    gaStatPoolValue.style.color = avgPoolPct >= 60 ? 'var(--text-0)' : getQuotaColor(avgPoolPct);
  }
  if (gaStatPoolValueSub) {
    const text = `${summary.activeCount}/${total} actifs · ${formatCompactTokens(summary.availableTokens)} dispo`;
    gaStatPoolValueSub.textContent = text;
    gaStatPoolValueSub.title = `${summary.activeCount} comptes actifs en rotation sur ${total} · ${summary.availableTokens.toLocaleString()} tokens disponibles (${isWeekly ? 'Hebdo' : '5H'})`;
  }

  // Prochain Reset Countdown computation (uniquement sur les comptes Antigravity)
  let soonestResetMs = Infinity;
  let soonestAccountName = '';
  let soonestFullName = '';
  const now = Date.now();
  for (const acc of accounts) {
    if (acc.enabled === false) continue;
    if (isAiStudioAccount(acc) || isGeminiCliAccount(acc)) continue;
    const eff = getAccountEffectiveQuotas(acc);
    const geminiPct = isWeekly ? eff.geminiWkPct : eff.gemini5hPct;
    const claudePct = isWeekly ? eff.claudeWkPct : eff.claude5hPct;
    if (geminiPct < 100) {
      const resetStr = isWeekly ? eff.geminiWkReset : eff.gemini5hReset;
      if (resetStr) {
        const ms = new Date(resetStr).getTime();
        if (ms > now && ms < soonestResetMs) {
          soonestResetMs = ms;
          const label = (acc.name || acc.email || 'Compte').split('@')[0].trim();
          const short = label.length > 10 ? `${label.slice(0, 9)}…` : label;
          soonestAccountName = `${short} (Gemini)`;
          soonestFullName = `${acc.name || acc.email} (Gemini)`;
        }
      }
    }
    if (claudePct < 100) {
      const resetStr = isWeekly ? eff.claudeWkReset : eff.claude5hReset;
      if (resetStr) {
        const ms = new Date(resetStr).getTime();
        if (ms > now && ms < soonestResetMs) {
          soonestResetMs = ms;
          const label = (acc.name || acc.email || 'Compte').split('@')[0].trim();
          const short = label.length > 10 ? `${label.slice(0, 9)}…` : label;
          soonestAccountName = `${short} (Claude)`;
          soonestFullName = `${acc.name || acc.email} (Claude)`;
        }
      }
    }
  }

  const gaNextResetBadge = $('#gaNextResetBadge');
  const gaStatNextReset = $('#gaStatNextReset');
  const gaStatNextResetSub = $('#gaStatNextResetSub');

  if (gaNextResetBadge) gaNextResetBadge.textContent = isWeekly ? 'Hebdo' : '5 Heures';
  if (gaStatNextReset && gaStatNextResetSub) {
    if (soonestResetMs !== Infinity) {
      const countdown = formatCompactCountdown(new Date(soonestResetMs).toISOString());
      gaStatNextReset.textContent = countdown || 'Imminent';
      const targetDate = new Date(soonestResetMs);
      const isToday = targetDate.toDateString() === new Date().toDateString();
      const datePart = isToday ? "Aujourd'hui" : targetDate.toLocaleDateString(undefined, { weekday: 'short' });
      const timePart = targetDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const text = `${soonestAccountName} · ${datePart} ${timePart}`;
      gaStatNextResetSub.textContent = text;
      gaStatNextResetSub.title = `${soonestFullName} · ${datePart} à ${timePart}`;
    } else {
      gaStatNextReset.textContent = '100% Plein';
      gaStatNextResetSub.textContent = 'Aucun compte en attente de reset';
      gaStatNextResetSub.title = 'Aucun compte en attente de reset';
    }
  }

  // Card 5: Score de Résilience Pool
  const resilience = (typeof calculatePoolResilienceScore === 'function')
    ? calculatePoolResilienceScore(accounts, gaActiveCooldownsCache)
    : { score: 100, label: 'Optimal', grade: 'optimal' as const, color: '#10b981', details: '' };
  const gaStatResilienceScore = $('#gaStatResilienceScore');
  const gaStatResilienceSub = $('#gaStatResilienceSub');
  if (gaStatResilienceScore) {
    gaStatResilienceScore.textContent = `${resilience.score}%`;
    gaStatResilienceScore.style.color = resilience.score >= 70 ? 'var(--text-0)' : resilience.color;
  }
  if (gaStatResilienceSub) {
    gaStatResilienceSub.textContent = resilience.label;
    gaStatResilienceSub.title = resilience.details || resilience.label;
  }

  // Count active / ready by family
  let geminiReadyCnt = 0;
  let claudeReadyCnt = 0;
  let cooldownCnt = 0;
  const nowMs = Date.now();
  for (const acc of accounts) {
    if (acc.enabled === false) continue;
    if (acc.isUnlicensed || acc.quotas?.isUnlicensed) continue;
    if (isAiStudioAccount(acc) || isGeminiCliAccount(acc)) continue;
    if (isAccountValidationRequired(acc)) continue;
    const gCd = getAccountActiveCooldown(acc, 'gemini');
    const cCd = getAccountActiveCooldown(acc, 'claude');
    const eff = getAccountEffectiveQuotas(acc);

    if (gCd) cooldownCnt++;
    else if (eff.gemini5hPct > 0) geminiReadyCnt++;

    if (!cCd && eff.claude5hPct > 0) claudeReadyCnt++;
  }

  // Card 6: Flotte Gemini Prête
  const gaStatGeminiReady = $('#gaStatGeminiReady');
  const gaStatGeminiReadySub = $('#gaStatGeminiReadySub');
  if (gaStatGeminiReady) {
    gaStatGeminiReady.textContent = `${geminiReadyCnt} / ${total}`;
    gaStatGeminiReady.style.color = geminiReadyCnt === 0 ? '#ef4444' : 'var(--text-0)';
  }
  if (gaStatGeminiReadySub) {
    const text = total > 0 ? `${Math.round((geminiReadyCnt / total) * 100)}% de la flotte prêt` : 'Aucun compte';
    gaStatGeminiReadySub.textContent = text;
    gaStatGeminiReadySub.title = text;
  }

  // Card 7: Claude Bridge Saturation
  const gaStatClaudeBridge = $('#gaStatClaudeBridge');
  const gaStatClaudeBridgeSub = $('#gaStatClaudeBridgeSub');
  if (gaStatClaudeBridge) {
    gaStatClaudeBridge.textContent = `${claudeReadyCnt} / ${total}`;
    gaStatClaudeBridge.style.color = claudeReadyCnt === 0 ? 'var(--text-2)' : 'var(--text-0)';
  }
  if (gaStatClaudeBridgeSub) {
    const text = claudeReadyCnt > 0 ? `${claudeReadyCnt} dispos (Sonnet & Opus)` : 'Plafond ou pause';
    gaStatClaudeBridgeSub.textContent = text;
    gaStatClaudeBridgeSub.title = text;
  }

  // Card 8: Vélocité RPM
  const velocity = (typeof calculatePoolVelocity === 'function')
    ? calculatePoolVelocity(cachedRealStats?.sessions || [])
    : { rpm: 0, label: 'Fluide', status: 'calm' as const };
  const gaStatVelocityRpm = $('#gaStatVelocityRpm');
  const gaStatVelocitySub = $('#gaStatVelocitySub');
  if (gaStatVelocityRpm) {
    gaStatVelocityRpm.textContent = `${velocity.rpm} RPM`;
    gaStatVelocityRpm.style.color = velocity.rpm > 15 ? '#f59e0b' : 'var(--text-0)';
  }
  if (gaStatVelocitySub) {
    gaStatVelocitySub.textContent = velocity.label;
    gaStatVelocitySub.title = `Charge actuelle : ${velocity.rpm} req/min`;
  }

  // Card 9: Runway Restant
  const runway = (typeof calculatePoolRunway === 'function')
    ? calculatePoolRunway(accounts)
    : { formattedRunway: '> 24h', burnState: 'healthy' as const, totalAvailableTokens: 0, totalConsumedTokens5h: 0, totalConsumedTokensWeekly: 0, hourlyBurnRate: 50000000, runwayHours: 24, runwayMinutes: 0 };
  const gaStatRunwayHours = $('#gaStatRunwayHours');
  const gaStatRunwaySub = $('#gaStatRunwaySub');
  if (gaStatRunwayHours) {
    gaStatRunwayHours.textContent = runway.formattedRunway;
  }
  if (gaStatRunwaySub) {
    const availToks = summary.availableTokens > 0 ? summary.availableTokens : runway.totalAvailableTokens;
    const consToks = summary.consumedTokens > 0 ? summary.consumedTokens : (isWeekly ? (runway.totalConsumedTokensWeekly || 0) : (runway.totalConsumedTokens5h || 0));
    const text = `${formatCompactTokens(availToks)} dispo · ${formatCompactTokens(consToks)} cons.`;
    gaStatRunwaySub.textContent = text;
    gaStatRunwaySub.title = `Tokens Gemini (250M 5h / 13% hebdo) : ${availToks.toLocaleString()} disponibles (${isWeekly ? 'Hebdo' : '5H'}) · ${consToks.toLocaleString()} consommés`;
  }

  // Card 10: Tokens en Réserve (Disponibles)
  const gaStatTokenReserve = $('#gaStatTokenReserve');
  const gaStatTokenReserveSub = $('#gaStatTokenReserveSub');
  if (gaStatTokenReserve) {
    gaStatTokenReserve.textContent = summary.availableTokens > 0
      ? formatCompactTokens(summary.availableTokens)
      : '0';
  }
  if (gaStatTokenReserveSub) {
    const text = isWeekly ? 'Capacité Hebdo restante' : 'Capacité 5H restante';
    gaStatTokenReserveSub.textContent = text;
    gaStatTokenReserveSub.title = text;
  }

  // Card 11: Comptes en Cooldown
  const gaStatCooldownCount = $('#gaStatCooldownCount');
  const gaStatCooldownSub = $('#gaStatCooldownSub');
  if (gaStatCooldownCount) {
    gaStatCooldownCount.textContent = String(cooldownCnt);
    gaStatCooldownCount.style.color = cooldownCnt > 0 ? '#f59e0b' : 'var(--text-0)';
    const cardCd = gaStatCooldownCount.closest('.card-cooldown');
    if (cardCd) {
      if (cooldownCnt > 0) cardCd.classList.add('has-cooldown');
      else cardCd.classList.remove('has-cooldown');
    }
  }
  if (gaStatCooldownSub) {
    const text = cooldownCnt > 0 ? `${cooldownCnt} compte(s) temporisés` : 'Zéro cooldown actif';
    gaStatCooldownSub.textContent = text;
    gaStatCooldownSub.title = text;
  }

  // Card 12: Valeur API Équivalente
  const gaStatEquivValue = $('#gaStatEquivValue');
  const gaStatEquivValueSub = $('#gaStatEquivValueSub');
  if (gaStatEquivValue) {
    const val = summary.equivDollarValue || 0;
    gaStatEquivValue.textContent = `$${val.toFixed(2)}`;
  }
  if (gaStatEquivValueSub) {
    const text = `Basé sur ${formatCompactTokens(summary.availableTokens)} tok`;
    gaStatEquivValueSub.textContent = text;
    gaStatEquivValueSub.title = text;
  }
}

function updateGoogleAccountToolbarCounts(accounts: any[]): void {
  if (!Array.isArray(accounts)) {
    accounts = Array.isArray(googleAccountsCache) ? googleAccountsCache : [];
  }
  const total = accounts.length;
  let pro = 0;
  let ultra = 0;
  let free = 0;
  let ready = 0;
  let exhausted = 0;
  let cooldown = 0;
  let paused = 0;
  let blocked = 0;
  let validation = 0;

  for (const a of accounts) {
    const tier = getAccountTier(a);
    if (tier === 'ULTRA') ultra++;
    else if (tier === 'FREE') free++;
    else pro++;

    const isEnabled = a.enabled !== false;
    const isVal = isAccountValidationRequired(a);
    const isUnlicensed = a.isUnlicensed || a.quotas?.isUnlicensed;
    const isBlocked = !isVal && (isUnlicensed || a.errorDetails || a.quotas?.errorDetails || (a.status === 'unhealthy' && a.lastError?.includes('403')));
    const cdGemini = getAccountActiveCooldown(a, 'gemini');
    const cdClaude = getAccountActiveCooldown(a, 'claude');
    const hasActiveCooldown = Boolean(cdGemini);
    const isExh = isAccountCapExhausted(a);

    if (isVal) {
      validation++;
    } else if (isBlocked) {
      blocked++;
    } else if (!isEnabled) {
      paused++;
    } else if (hasActiveCooldown) {
      cooldown++;
    } else if (isExh) {
      exhausted++;
    } else {
      ready++;
    }
  }

  const elAll = $('#gaCntAll');
  const elReady = $('#gaCntReady');
  const elExhausted = $('#gaCntExhausted');
  const elCooldown = $('#gaCntCooldown');
  const elPaused = $('#gaCntPaused');
  const elBlocked = $('#gaCntBlocked');
  const elValidation = $('#gaCntValidation');
  const elPro = $('#gaCntPro');
  const elUltra = $('#gaCntUltra');
  const elFree = $('#gaCntFree');

  if (elAll) elAll.textContent = String(total);
  if (elReady) elReady.textContent = String(ready);
  if (elExhausted) elExhausted.textContent = String(exhausted);
  if (elCooldown) elCooldown.textContent = String(cooldown);
  if (elPaused) elPaused.textContent = String(paused);
  if (elBlocked) elBlocked.textContent = String(blocked);
  if (elValidation) elValidation.textContent = String(validation);
  if (elPro) elPro.textContent = String(pro);
  if (elUltra) elUltra.textContent = String(ultra);
  if (elFree) elFree.textContent = String(free);
}

function initGoogleAccountsToolbarOnce(): void {
  if (gaToolbarInitialized) return;
  gaToolbarInitialized = true;

  // Global listener to close any open more-actions dropdowns on outside click
  document.addEventListener('click', (e: any) => {
    if (!(e.target as HTMLElement)?.closest('.ga-more-dropdown-wrap')) {
      document.querySelectorAll('.ga-more-dropdown-wrap.open').forEach((w) => w.classList.remove('open'));
    }
  });

  // Search input with debounce
  const searchInput = $('#gaSearchInput') as HTMLInputElement | null;
  let searchDebounceTimer: any = null;
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        gaSearchQuery = searchInput.value.trim().toLowerCase();
        renderGoogleAccountsList(googleAccountsCache);
      }, 150);
    });
  }

  // 5H vs Weekly toggle
  const w5hBtn = $('#gaWindow5hBtn') as HTMLButtonElement | null;
  const wWkBtn = $('#gaWindowWeeklyBtn') as HTMLButtonElement | null;
  w5hBtn?.addEventListener('click', () => {
    gaCurrentQuotaWindow = '5h';
    w5hBtn.classList.add('active');
    wWkBtn?.classList.remove('active');
    updateGoogleAccountsTokenStats(googleAccountsCache);
    renderGoogleAccountsList(googleAccountsCache);
  });
  wWkBtn?.addEventListener('click', () => {
    gaCurrentQuotaWindow = 'weekly';
    wWkBtn.classList.add('active');
    w5hBtn?.classList.remove('active');
    updateGoogleAccountsTokenStats(googleAccountsCache);
    renderGoogleAccountsList(googleAccountsCache);
  });

  // List vs Grid view toggle
  const vListBtn = $('#gaViewListBtn') as HTMLButtonElement | null;
  const vGridBtn = $('#gaViewGridBtn') as HTMLButtonElement | null;
  vListBtn?.addEventListener('click', () => {
    gaCurrentViewMode = 'list';
    vListBtn.classList.add('active');
    vGridBtn?.classList.remove('active');
    renderGoogleAccountsList(googleAccountsCache);
  });
  vGridBtn?.addEventListener('click', () => {
    gaCurrentViewMode = 'grid';
    vGridBtn.classList.add('active');
    vListBtn?.classList.remove('active');
    renderGoogleAccountsList(googleAccountsCache);
  });

  // Filter chips (All, PRO, ULTRA, FREE)
  const chips = $$<HTMLButtonElement>('#gaFilterGroup .ga-chip');
  chips.forEach((chip) => {
    chip.addEventListener('click', () => {
      chips.forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      gaCurrentFilter = (chip.dataset.filter as any) || 'all';
      renderGoogleAccountsList(googleAccountsCache);
    });
  });

  // Quick toolbar buttons
  $('#gaToolbarAddBtn')?.addEventListener('click', () => openGoogleAccountModal());

  const refreshAllBtn = $('#gaToolbarRefreshAllBtn') as HTMLButtonElement | null;
  refreshAllBtn?.addEventListener('click', async () => {
    if (googleAccountsCache.length === 0) {
      toast('No Google accounts to refresh', 'warn');
      return;
    }
    refreshAllBtn.setAttribute('disabled', 'true');
    const origHtml = refreshAllBtn.innerHTML;
    refreshAllBtn.innerHTML = `<span class="spinner"></span> Refreshing…`;
    try {
      let updatedCount = 0;
      // Controlled concurrency (3 workers) to prevent timeouts and 429
      const pool = [...googleAccountsCache];
      const concurrency = 8;
      const workers = Array.from({ length: concurrency }, async () => {
        while (pool.length > 0) {
          const acc = pool.shift();
          if (!acc) break;
          try {
            const res = await window.ag.providers.fetchAccountQuotas(acc.apiKey || acc.refreshToken, acc.refreshToken);
            if (res.success && res.quotas) {
              acc.quotas = res.quotas;
              if (res.quotas.isUnlicensed) {
                acc.isUnlicensed = true;
              } else {
                delete acc.isUnlicensed;
                delete acc.errorDetails;
              }
              updatedCount++;
            }
          } catch {}
        }
      });
      await Promise.all(workers);
      // Batch save once
      try {
        const provs = await window.ag.providers.get();
        const googleProv = provs.find((p: any) => p.provider === 'google');
        if (googleProv) {
          await window.ag.providers.save(googleProv);
        }
      } catch {}
      toast(`Refreshed quotas for ${updatedCount} accounts`, 'ok');
      void forceProxyQuotaRefresh();
      renderGoogleAccountsList(googleAccountsCache);
    } finally {
      refreshAllBtn.removeAttribute('disabled');
      refreshAllBtn.innerHTML = origHtml;
    }
  });

  const probeHealthBtn = $('#gaToolbarProbeHealthBtn') as HTMLButtonElement | null;
  probeHealthBtn?.addEventListener('click', async () => {
    if (!window.ag?.providers?.probePool) {
      toast('Méthode de diagnostic non disponible', 'err');
      return;
    }
    probeHealthBtn.setAttribute('disabled', 'true');
    const origHtml = probeHealthBtn.innerHTML;
    probeHealthBtn.innerHTML = `<span class="spinner"></span> Diagnostic...`;
    try {
      toast('🩺 Lancement du diagnostic santé du pool en parallèle...', 'info', 4000);
      const res = await window.ag.providers.probePool();
      if (res && res.success) {
        const s = res.summary || {};
        toast(`✅ Diagnostic terminé : ${s.healthy || 0} sains, ${s.challenge || 0} challenge(s), ${s.tos || 0} TOS.`, 'ok', 6000);
        // Rechargement immédiat depuis le store mis à jour par le probe sans re-fetch réseau lent
        await loadGoogleAccounts(false);
      } else {
        toast(`Échec du diagnostic : ${res?.error || 'Erreur inconnue'}`, 'err');
      }
    } catch (err: any) {
      toast(`Erreur diagnostic : ${err?.message || err}`, 'err');
    } finally {
      probeHealthBtn.removeAttribute('disabled');
      probeHealthBtn.innerHTML = origHtml;
    }
  });

  const warmupBtn = $('#gaToolbarWarmupBtn') as HTMLButtonElement | null;
  warmupBtn?.addEventListener('click', async () => {
    if (googleAccountsCache.length === 0) {
      toast('No Google accounts to warmup', 'warn');
      return;
    }
    warmupBtn.setAttribute('disabled', 'true');
    const origHtml = warmupBtn.innerHTML;
    warmupBtn.innerHTML = `<span class="spinner"></span> Warming…`;
    try {
      let warmedCount = 0;
      for (const acc of googleAccountsCache) {
        let tokenToUse = acc.apiKey;
        if (acc.refreshToken) {
          try {
            const r = await window.ag.providers.refreshToken(acc.refreshToken);
            if (r.success && r.accessToken) {
              tokenToUse = r.accessToken;
              acc.apiKey = r.accessToken;
            }
          } catch {}
        }
        if (tokenToUse) {
          try {
            const res = await window.ag.providers.warmupAccount(tokenToUse || "");
            if (res.success) warmedCount++;
            // fetch fresh quota
            const q = await window.ag.providers.fetchAccountQuotas(tokenToUse);
            if (q.success && q.quotas) {
              acc.quotas = q.quotas;
              await window.ag.providers.save(acc);
            }
          } catch {}
        }
      }
      toast(`Warmup completed for ${warmedCount} accounts (weekly cycles activated)`, warmedCount > 0 ? 'ok' : 'warn');
      await loadGoogleAccounts();
    } finally {
      warmupBtn.removeAttribute('disabled');
      warmupBtn.innerHTML = origHtml;
    }
  });

  const wakeAllBtn = $('#gaToolbarWakeAllBtn') as HTMLButtonElement | null;
  wakeAllBtn?.addEventListener('click', async () => {
    wakeAllBtn.setAttribute('disabled', 'true');
    const origHtml = wakeAllBtn.innerHTML;
    wakeAllBtn.innerHTML = `<span class="spinner"></span> Réveil…`;
    try {
      const recRes = await window.ag.providers.reconcileCooldowns?.();
      const burstRes = await window.ag.providers.liftBurstCooldowns?.();
      let cleared = 0;
      if (recRes && typeof recRes.cleared === 'number') {
        cleared += recRes.cleared;
      }
      if (burstRes && typeof burstRes.cleared === 'number') {
        cleared += burstRes.cleared;
      }
      await loadGoogleAccounts(true);
      if (cleared > 0) {
        toast(`⚡ Réveil express réussi : ${cleared} cooldown(s) & bursts RPM levés ! Vos comptes sont prêts.`, 'ok', 4000);
      } else {
        toast(`ℹ️ Tous les comptes sont déjà réveillés (aucun cooldown actif bloquant).`, 'ok', 3000);
      }
    } catch (err: any) {
      toast(`Erreur lors du réveil : ${err?.message || err}`, 'err');
    } finally {
      wakeAllBtn.removeAttribute('disabled');
      wakeAllBtn.innerHTML = origHtml;
    }
  });

  const purgeCacheBtn = $('#gaToolbarPurgeCacheBtn') as HTMLButtonElement | null;
  const runPurgeAndRepair = async (btnTarget?: HTMLButtonElement | null) => {
    const ok = await confirmModal(
      'Purger le cache des quotas & cooldowns',
      'Voulez-vous réinitialiser complètement le cache des quotas disque (~/.gemini/antigravity/quota_cache.json) et lever tous les cooldowns ? Vos quotas réels seront réactualisés à neuf.',
      { danger: true, confirmLabel: 'Purger & Réveiller' }
    );
    if (!ok) return;

    if (btnTarget) {
      btnTarget.setAttribute('disabled', 'true');
      btnTarget.classList.add('spinning');
    }
    try {
      const purgeRes = await window.ag.providers.purgeQuotaCache?.();
      const recRes = await window.ag.providers.reconcileCooldowns?.();
      const burstRes = await window.ag.providers.liftBurstCooldowns?.();
      let totalCleared = (purgeRes?.cleared || 0) + (recRes?.cleared || 0) + (burstRes?.cleared || 0);
      await loadGoogleAccounts(true);
      toast(`🧹 Cache de quotas purgé avec succès (${totalCleared} entrées réinitialisées). Tous les comptes sont prêts !`, 'ok', 4500);
    } catch (err: any) {
      toast(`Erreur lors de la purge : ${err?.message || err}`, 'err');
    } finally {
      if (btnTarget) {
        btnTarget.removeAttribute('disabled');
        btnTarget.classList.remove('spinning');
      }
    }
  };

  purgeCacheBtn?.addEventListener('click', () => runPurgeAndRepair(purgeCacheBtn));
  gaRepairCooldownsBtn?.addEventListener('click', () => runPurgeAndRepair(gaRepairCooldownsBtn));

  const randomizeDeviceBtn = $('#gaToolbarRandomizeDeviceBtn') as HTMLButtonElement | null;
  randomizeDeviceBtn?.addEventListener('click', async () => {
    const ok = await confirmModal(
      'Régénérer l\'Empreinte Machine (Anti-Ban)',
      'Voulez-vous générer de nouveaux identifiants télémétriques (machineId, macMachineId, devDeviceId, sqmId, serviceMachineId) ?\n\nCette action désolidarise immédiatement votre installation des comptes bloqués par Google pour éviter le bannissement par syndication.\n\nUn backup automatique de storage.json sera créé.',
      { confirmLabel: '🎲 Régénérer l\'Empreinte' }
    );
    if (!ok) return;

    randomizeDeviceBtn.setAttribute('disabled', 'true');
    const origHtml = randomizeDeviceBtn.innerHTML;
    randomizeDeviceBtn.innerHTML = `<span class="spinner"></span> Régénération…`;
    try {
      const res = await (window.ag?.providers as any)?.randomizeMachineId?.() || await (window.ag as any)?.randomizeMachineId?.();
      if (res && res.success) {
        toast(`🎲 Empreinte machine renouvelée avec succès (${res.updatedFiles?.length || 1} fichier(s) mis à jour) !`, 'ok', 5000);
      } else {
        toast(`Erreur : ${res?.error || 'Échec de renouvellement'}`, 'err');
      }
    } catch (err: any) {
      toast(`Erreur : ${err?.message || err}`, 'err');
    } finally {
      randomizeDeviceBtn.removeAttribute('disabled');
      randomizeDeviceBtn.innerHTML = origHtml;
    }
  });

  // Cockpit Density Mode (Vue Essentielle vs Vue Complète - Miller's law chunking)
  const densityLabel = $('#gaDensityToggleLabel') as HTMLSpanElement | null;
  const telemetryGrid = document.querySelector('.ga-telemetry-grid') as HTMLElement | null;
  const updateDensityUI = (isCompact: boolean) => {
    if (telemetryGrid) {
      telemetryGrid.classList.toggle('is-compact', isCompact);
    }
    if (gaDensityToggleBtn) {
      gaDensityToggleBtn.classList.toggle('is-active', isCompact);
      gaDensityToggleBtn.title = isCompact
        ? 'Actuellement en vue Essentielle (4 KPI) — Cliquez pour afficher les 8 KPI complets'
        : 'Actuellement en vue Expert (8 KPI) — Cliquez pour masquer les métriques secondaires';
    }
    if (densityLabel) {
      densityLabel.textContent = isCompact ? 'Vue Essentielle' : 'Vue Complète';
    }
  };

  let savedCompact = true;
  try {
    const pref = localStorage.getItem('ag_ga_cockpit_density');
    if (pref === 'full') savedCompact = false;
  } catch {}
  updateDensityUI(savedCompact);

  gaDensityToggleBtn?.addEventListener('click', () => {
    const isNowCompact = !telemetryGrid?.classList.contains('is-compact');
    updateDensityUI(isNowCompact);
    try {
      localStorage.setItem('ag_ga_cockpit_density', isNowCompact ? 'compact' : 'full');
    } catch {}
  });

  const showAllSwitch = $('#gaShowAllQuotasSwitch') as HTMLInputElement | null;
  if (showAllSwitch) {
    showAllSwitch.checked = gaShowAllQuotas;
    showAllSwitch.addEventListener('change', () => {
      gaShowAllQuotas = showAllSwitch.checked;
      try {
        localStorage.setItem('ag_ga_show_all_quotas', gaShowAllQuotas ? 'true' : 'false');
      } catch {}
      renderGoogleAccountsList(googleAccountsCache);
    });
  }

  // Export JSON
  $('#gaExportJsonBtn')?.addEventListener('click', () => {
    if (googleAccountsCache.length === 0) {
      toast('No Google accounts to export', 'warn');
      return;
    }
    const cleanData = JSON.stringify(googleAccountsCache, null, 2);
    const blob = new Blob([cleanData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `antigravity-accounts-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast(`Exported ${googleAccountsCache.length} Google accounts`, 'ok');
  });

  // Import JSON
  const importFileInput = $('#gaImportFileInput') as HTMLInputElement | null;
  $('#gaImportJsonBtn')?.addEventListener('click', () => {
    importFileInput?.click();
  });
  importFileInput?.addEventListener('change', async () => {
    const file = importFileInput.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const rawAccounts = parseAccountsJson(text);
      if (!rawAccounts || rawAccounts.length === 0) {
        toast('Invalid JSON or no accounts detected in file', 'err');
        return;
      }

      toast(`Importing ${rawAccounts.length} Google account(s)...`, 'info', 4000);

      let savedCount = 0;
      let refreshedCount = 0;

      for (let i = 0; i < rawAccounts.length; i++) {
        const raw = rawAccounts[i];
        const normalized = normalizeAccountEntry(raw, i);
        if (!normalized) continue;

        const existing = findMatchingAccount(normalized, googleAccountsCache);

        let finalApiKey = normalized.apiKey || (existing ? existing.apiKey : '');
        let finalPicture = normalized.picture || (existing ? existing.picture : undefined);
        let finalName = existing && existing.name ? existing.name : normalized.name;
        let finalQuotas = normalized.quotas || (existing ? existing.quotas : undefined);

        // Attempt live token exchange if refreshToken is present
        if (normalized.refreshToken) {
          try {
            const rRes = await window.ag.providers.refreshToken(normalized.refreshToken);
            if (rRes.success && rRes.accessToken) {
              finalApiKey = rRes.accessToken;
              if (rRes.name && (!finalName || finalName.includes('@') || finalName === normalized.email?.split('@')[0])) {
                finalName = rRes.name;
              }
              if (rRes.picture && !finalPicture) finalPicture = rRes.picture;
              if (rRes.quotas) finalQuotas = rRes.quotas;
              refreshedCount++;
            }
          } catch {
            // continue with unrefreshed token
          }
        }

        const candidateToMerge = {
          ...normalized,
          name: finalName,
          apiKey: finalApiKey,
          picture: finalPicture,
          quotas: finalQuotas,
        };

        const merged = mergeAccountWithExisting(candidateToMerge, existing);

        const saveRes = await window.ag.providers.save(merged);
        if (saveRes.success) {
          savedCount++;
        }
      }

      toast(
        `Imported ${savedCount} Google account(s) (${refreshedCount} refreshed live)!`,
        'ok',
        5000
      );
      await loadGoogleAccounts();
      void loadModels();
    } catch (err) {
      toast(`Import error: ${(err as Error).message}`, 'err');
    } finally {
      importFileInput.value = '';
    }
  });

  function showAccountErrorDetailsModal(account: any): void {
    if (!account) return;
    const err = account.errorDetails || account.quotas?.errorDetails || {};
    const validationUrl = err.validationUrl || account.quotas?.errorDetails?.validationUrl;
    const isValidationRequired = isAccountValidationRequired(account) || Boolean(validationUrl || (account as any).isValidationRequired || err.status === 'VALIDATION_REQUIRED' || err.reason === 'VALIDATION_REQUIRED');
    const reason = err.reason || (isValidationRequired ? 'VALIDATION_REQUIRED' : (account.lastError?.includes('Terms of Service') ? 'TOS_VIOLATION' : 'PERMISSION_DENIED'));
    const message = err.message || account.lastError || (isValidationRequired ? 'Une validation de sécurité interactive ou un captcha est requis par Google pour ce compte.' : 'This service has been disabled in this account for violation of Terms of Service. Please submit an appeal to continue using this product.');
    const appealUrl = err.appealUrl || 'https://forms.gle/hGzM9MEUv2azZsrb9';
    const actionValidationUrl = validationUrl || 'https://myaccount.google.com/age-verification';
    const detectionDate = err.detectionTime ? new Date(err.detectionTime) : new Date(account.lastTestedAt || Date.now());
    const pad = (n: number) => n.toString().padStart(2, '0');
    const detectionTimeStr = `${pad(detectionDate.getDate())}/${pad(detectionDate.getMonth() + 1)}/${detectionDate.getFullYear()} à ${pad(detectionDate.getHours())}:${pad(detectionDate.getMinutes())}:${pad(detectionDate.getSeconds())}`;

    const rawJson = err.raw || {
      error: {
        code: 403,
        message,
        status: isValidationRequired ? 'VALIDATION_REQUIRED' : 'PERMISSION_DENIED',
        details: [
          {
            '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
            reason,
            domain: 'cloudcode-pa.googleapis.com',
            metadata: isValidationRequired
              ? { validation_url: actionValidationUrl, uiMessage: 'true' }
              : { appeal_url: appealUrl, appeal_url_link_text: 'Submit Appeal', uiMessage: 'true' }
          }
        ]
      }
    };

    const accountEmail = account.email || account.name || 'compte@gmail.com';
    const rawJsonString = JSON.stringify(rawJson, null, 2);

    const modalHtml = `
      <div class="ga-error-details-card" style="font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif); color: #f1f5f9; padding: 4px 6px; line-height: 1.5;">
        <!-- Header: Severity Banner & Comprehension -->
        <div style="text-align: center; margin-bottom: 18px; position: relative;">
          <div style="width: 52px; height: 52px; border-radius: 50%; background: radial-gradient(circle, ${isValidationRequired ? 'rgba(245, 158, 11, 0.28)' : 'rgba(239, 68, 68, 0.28)'} 0%, ${isValidationRequired ? 'rgba(245, 158, 11, 0.05)' : 'rgba(239, 68, 68, 0.05)'} 75%); border: 2px solid ${isValidationRequired ? '#f59e0b' : '#ef4444'}; color: ${isValidationRequired ? '#f59e0b' : '#ef4444'}; display: inline-flex; align-items: center; justify-content: center; font-size: 24px; margin-bottom: 10px; box-shadow: 0 0 20px ${isValidationRequired ? 'rgba(245, 158, 11, 0.3)' : 'rgba(239, 68, 68, 0.3)'};">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${isValidationRequired ? '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>' : '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>'}</svg>
          </div>
          <h2 style="font-size: 19px; font-weight: 700; color: #ffffff; margin: 0 0 4px 0; letter-spacing: -0.3px;">Diagnostic &amp; Résolution de Compte</h2>
          <div style="font-size: 12px; color: #94a3b8; display: flex; align-items: center; justify-content: center; gap: 6px;">
            <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: ${isValidationRequired ? '#f59e0b' : '#ef4444'}; box-shadow: 0 0 6px ${isValidationRequired ? '#f59e0b' : '#ef4444'};"></span>
            <span>${isValidationRequired ? 'Erreur HTTP 403 · Vérification Interactive Requise (Challenge/Captcha)' : 'Erreur HTTP 403 Forbidden · Violation des Conditions d\'Utilisation (TOS)'}</span>
          </div>
        </div>

        <!-- Account Card: Recognition Over Recall -->
        <div style="margin-bottom: 14px; background: rgba(15, 23, 42, 0.75); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; padding: 10px 14px; display: flex; align-items: center; justify-content: space-between; gap: 10px;">
          <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
            <div style="width: 30px; height: 30px; border-radius: 50%; background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3); color: #f87171; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 12.5px; flex-shrink: 0;">
              G
            </div>
            <div style="min-width: 0;">
              <div style="font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: #94a3b8;">COMPTE AFFECTÉ</div>
              <div style="font-size: 13px; font-weight: 600; color: #f8fafc; font-family: var(--font-mono, monospace); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" id="gaAccountEmailText">
                ${escapeHtml(accountEmail)}
              </div>
            </div>
          </div>
          <button type="button" id="gaCopyEmailBtn" style="background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 6px; padding: 5px 9px; font-size: 11px; color: #cbd5e1; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; transition: all 0.15s ease; flex-shrink: 0;" title="Copier l'email dans le presse-papier">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            <span id="gaCopyEmailLabel">Copier</span>
          </button>
        </div>

        <!-- Status Badges: Visual Categorization -->
        <div style="margin-bottom: 14px;">
          <div style="font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: #94a3b8; margin-bottom: 6px;">STATUT DU PROXY &amp; ROTATION</div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            ${isValidationRequired ? `
            <span style="background: rgba(245, 158, 11, 0.18); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.4); padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 600; display: inline-flex; align-items: center; gap: 6px;">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              Validation Requise (Non Suspendu)
            </span>
            <span style="background: rgba(59, 130, 246, 0.15); color: #93c5fd; border: 1px solid rgba(59, 130, 246, 0.35); padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 600; display: inline-flex; align-items: center; gap: 6px;">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              Bypass Mobile via PC
            </span>
            <span style="background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.35); padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 600; display: inline-flex; align-items: center; gap: 6px;">
              ⚡ 4 Étapes Rapides
            </span>
            ` : `
            <span style="background: rgba(239, 68, 68, 0.18); color: #fca5a5; border: 1px solid rgba(239, 68, 68, 0.4); padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 600; display: inline-flex; align-items: center; gap: 6px;">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              Blocked due to Violation
            </span>
            <span style="background: rgba(245, 158, 11, 0.15); color: #fcd34d; border: 1px solid rgba(245, 158, 11, 0.35); padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 600; display: inline-flex; align-items: center; gap: 6px;">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
              Proxy Rotation Disabled
            </span>
            <span style="background: rgba(148, 163, 184, 0.12); color: #cbd5e1; border: 1px solid rgba(148, 163, 184, 0.25); padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 600; display: inline-flex; align-items: center; gap: 6px;">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              Autres comptes préservés
            </span>
            `}
          </div>
        </div>

        <!-- Reason & Show Raw JSON -->
        <div style="margin-bottom: 16px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <span style="font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: #94a3b8;">MESSAGE GOOGLE CLOUD CODE</span>
            <div style="display: flex; gap: 8px;">
              <button type="button" id="gaCopyRawBtn" style="display: none; background: none; border: none; color: #94a3b8; font-size: 11px; cursor: pointer; padding: 2px 4px;">
                Copier JSON
              </button>
              <button type="button" id="gaToggleRawBtn" style="background: none; border: none; color: #60a5fa; font-size: 11px; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; padding: 2px 4px;">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                <span id="gaToggleRawLabel">Show Raw</span>
              </button>
            </div>
          </div>
          <div id="gaReasonFormatted" style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.25); border-radius: 8px; padding: 10px 14px; color: #fca5a5; font-size: 12px; line-height: 1.55;">
            <div style="font-weight: 600; margin-bottom: 4px; color: #f87171; display: flex; align-items: center; gap: 6px;">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              ${escapeHtml(reason)}
            </div>
            ${escapeHtml(message)}
          </div>
          <pre id="gaReasonRaw" style="display: none; background: #070a12; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 8px; padding: 12px; color: #94a3b8; font-size: 11px; font-family: var(--font-mono, monospace); max-height: 160px; overflow-y: auto; white-space: pre-wrap; margin: 0; line-height: 1.45;">${escapeHtml(rawJsonString)}</pre>
        </div>

        ${isValidationRequired ? `
        <!-- Section Protocole de Déblocage (En attente du nouveau protocole) -->
        <div id="gaProtocolContainer" style="margin-bottom: 16px; background: rgba(245, 158, 11, 0.05); border: 1px dashed rgba(245, 158, 11, 0.3); border-radius: 8px; padding: 18px; text-align: center;">
          <div style="font-size: 12px; font-weight: 600; color: #fbbf24; margin-bottom: 4px;">
            Protocole de déblocage personnalisé
          </div>
          <div style="font-size: 11px; color: #94a3b8;">
            (Section préparée — Prête pour l'intégration de votre nouveau protocole)
          </div>
        </div>
        ` : `
        <!-- Recours Officiel & Appeal Copilot (Primary for TOS Violation) -->
        <div style="margin-bottom: 16px; background: rgba(37, 99, 235, 0.08); border: 1px solid rgba(37, 99, 235, 0.3); border-radius: 8px; padding: 12px 14px;">
          <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: #93c5fd; margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            RECOURS OFFICIEL GOOGLE CLOUD CODE
          </div>
          <p style="margin: 0 0 10px 0; font-size: 12px; color: #cbd5e1; line-height: 1.45;">
            Le blocage de type TOS ne peut être levé que par une revue humaine Google. Utilisez le formulaire officiel ci-dessous avec l'argumentaire pré-rédigé.
          </p>
          <div style="display: grid; grid-template-columns: 1.3fr 1fr; gap: 8px; margin-bottom: 12px;">
            <button type="button" id="gaGoToAppealBtn" style="background: linear-gradient(135deg, #2563eb, #1d4ed8); color: #ffffff; border: none; border-radius: 7px; padding: 10px 14px; font-size: 12.5px; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 7px; box-shadow: 0 3px 12px rgba(37, 99, 235, 0.35); transition: all 0.15s ease;">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              <span>Ouvrir le Recours Google</span>
            </button>
            <button type="button" id="gaCopyAppealBtn" style="background: rgba(255, 255, 255, 0.05); color: #f1f5f9; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 7px; padding: 10px 14px; font-size: 12.5px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 7px;">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              <span id="gaCopyAppealLabel">Copier Lien Recours</span>
            </button>
          </div>

          <!-- Appeal Copilot Content -->
          <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 6px; padding: 10px 12px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
              <span style="font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #94a3b8;">ARGUMENTAIRE RECOMMANDÉ (CLIC POUR COPIER)</span>
              <button type="button" id="gaCopyAppealTextBtn" style="background: rgba(59, 130, 246, 0.15); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 4px; color: #60a5fa; padding: 2px 8px; font-size: 10.5px; cursor: pointer; display: flex; align-items: center; gap: 4px;">
                <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                <span id="gaCopyAppealTextLabel">Copier Texte</span>
              </button>
            </div>
            <div id="gaAppealTextContent" style="font-size: 11.5px; color: #cbd5e1; line-height: 1.5; font-style: italic; background: rgba(0,0,0,0.3); padding: 8px 10px; border-radius: 5px; border-left: 3px solid #3b82f6;">
              "Ce compte est utilisé légitimement avec Google Cloud Code et l'IDE Antigravity pour de l'assistance au développement de code local. Aucune activité de scraping, revente ou abus automatisé. Il s'agit très probablement d'un faux-positif suite à un renouvellement de jetons locaux. Merci de réactiver l'accès au service."
            </div>
          </div>
        </div>
        `}

        <!-- 1-Click Auto-Remediation (Secondary if TOS, Primary if ADC error) -->
        <div style="margin-bottom: 16px; background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 8px; padding: 12px 14px;">
          <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: #34d399; margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
            RÉ-AUTHENTIFICATION &amp; SYNCHRONISATION ADC (1-CLIC)
          </div>
          <p style="margin: 0 0 10px 0; font-size: 12px; color: #cbd5e1; line-height: 1.45;">
            ${isValidationRequired
              ? 'Une fois le challenge Google validé dans le navigateur, cliquez ici pour resynchroniser les jetons et réactiver le compte.'
              : 'Renouvelle les jetons locaux et réécrit les identifiants ADC sans commande de terminal. À utiliser en cas d\'erreur d\'autorisation ou après accord de recours Google.'}
          </p>
          <button type="button" id="gaAutoRepairAdcBtn" style="width: 100%; background: linear-gradient(135deg, #10b981, #059669); color: #ffffff; border: none; border-radius: 7px; padding: 9px 14px; font-size: 12.5px; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 3px 12px rgba(16, 185, 129, 0.3); transition: all 0.15s ease;">
            <svg id="gaAutoRepairAdcIcon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
            <span id="gaAutoRepairAdcLabel">Ré-authentifier &amp; Synchroniser ADC</span>
          </button>
          <div id="gaAutoRepairAdcFeedback" style="display: none; margin-top: 10px; font-size: 11.5px; border-radius: 6px; padding: 8px 10px;"></div>
        </div>

        <!-- Terminal Quick Fix: Progressive Disclosure & Fallback -->
        <div style="margin-bottom: 14px; border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; overflow: hidden; background: rgba(15, 23, 42, 0.5);">
          <button type="button" id="gaQuickFixToggleBtn" style="width: 100%; background: rgba(255, 255, 255, 0.03); border: none; padding: 10px 14px; text-align: left; color: #94a3b8; font-size: 12px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: space-between; transition: background 0.15s ease;">
            <span style="display: flex; align-items: center; gap: 8px;">
              <span style="font-family: var(--font-mono, monospace); font-weight: 700; font-size: 11px; background: rgba(255, 255, 255, 0.08); color: #cbd5e1; padding: 2px 6px; border-radius: 4px;">&gt;_</span>
              <span>Commandes CLI Manuelles (gcloud / fallback avancé)</span>
            </span>
            <span id="gaQuickFixArrow" style="transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1); font-size: 14px; font-weight: bold; color: #94a3b8;">›</span>
          </button>
          <div id="gaQuickFixBody" style="display: none; padding: 12px 14px; font-size: 11.5px; line-height: 1.6; color: #cbd5e1; border-top: 1px solid rgba(255, 255, 255, 0.08);">
            <p style="margin: 0 0 6px 0; font-weight: 600; color: #f1f5f9;">1. Indiquer à Google "c'est bien moi" :</p>
            <div style="display: flex; align-items: center; justify-content: space-between; background: #070a12; padding: 7px 10px; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.08); margin-bottom: 6px; font-family: var(--font-mono, monospace); color: #38bdf8;">
              <span style="user-select: all;">gcloud auth login --update-adc</span>
              <button type="button" class="btn-copy-cmd" data-cmd="gcloud auth login --update-adc" style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); color: #cbd5e1; border-radius: 4px; cursor: pointer; padding: 2px 6px; font-size: 10.5px; display: flex; align-items: center; gap: 4px;">
                Copier
              </button>
            </div>

            <div style="font-weight: 600; color: #f1f5f9; margin-bottom: 4px; margin-top: 10px;">2. Si le 403 persiste (révocation) :</div>
            <div style="display: flex; align-items: center; justify-content: space-between; background: #070a12; padding: 7px 10px; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.08); margin-bottom: 6px; font-family: var(--font-mono, monospace); color: #f87171;">
              <span style="user-select: all;">gcloud auth revoke ${escapeHtml(accountEmail)}</span>
              <button type="button" class="btn-copy-cmd" data-cmd="gcloud auth revoke ${escapeHtml(accountEmail)}" style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); color: #cbd5e1; border-radius: 4px; cursor: pointer; padding: 2px 6px; font-size: 10.5px; display: flex; align-items: center; gap: 4px;">
                Copier
              </button>
            </div>

            <div style="margin-top: 10px; font-size: 11px; color: #94a3b8;">
              Vérifiez également l'état de vos APIs dans la <a href="#" id="gaOpenConsoleLink" style="color: #60a5fa; text-decoration: underline;">Console Google Cloud</a>.
            </div>
          </div>
        </div>

        <!-- Detection Timestamp -->
        <div style="font-size: 10.5px; color: #64748b; margin-top: 6px; display: flex; align-items: center; gap: 6px; justify-content: flex-end;">
          <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          Détecté le : ${detectionTimeStr}
        </div>
      </div>
    `;

    void modals.confirm('Diagnostic Erreur 403 / TOS', modalHtml, {
      confirmLabel: 'Fermer le Diagnostic',
      hideCancel: true,
      onMount: (handle: any) => {
        // Impeccable layout bounds: enable .modal-lg max-width & internal scrolling
        const modalEl = handle.bodyEl.closest('.modal') as HTMLElement | null;
        if (modalEl) {
          modalEl.classList.add('modal-lg');
          modalEl.style.maxWidth = '620px';
          modalEl.style.maxHeight = '86vh';
          modalEl.style.display = 'flex';
          modalEl.style.flexDirection = 'column';
          modalEl.style.margin = 'auto';
        }
        if (handle.bodyEl) {
          handle.bodyEl.style.overflowY = 'auto';
          handle.bodyEl.style.maxHeight = 'calc(86vh - 120px)';
          handle.bodyEl.style.padding = '16px 20px';
        }

        handle.confirmBtn.style.width = '100%';
        handle.confirmBtn.style.padding = '10px 18px';
        handle.confirmBtn.style.fontSize = '13.5px';
        handle.confirmBtn.style.fontWeight = '600';
        handle.confirmBtn.style.borderRadius = '7px';
        handle.confirmBtn.style.background = '#2563eb';
        handle.confirmBtn.style.boxShadow = '0 3px 12px rgba(37, 99, 235, 0.35)';

        // Copy Account Email
        // Auto-detect Challenge QR code from logs or active validationUrl
        void (async () => {
          let qrDataUrl = '';
          let finalValidationUrl = actionValidationUrl;
          try {
            if (window.ag?.verification?.detect) {
              const detection = await window.ag.verification.detect();
              if (detection?.found && detection.validationUrl) {
                finalValidationUrl = detection.validationUrl;
                qrDataUrl = detection.qrCodeDataUrl || '';
              }
            }

            // Fallback: If no QR from detection but validationUrl is directly present in account error
            if (!qrDataUrl && validationUrl) {
              try {
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                const qrcodeLib = require('qrcode');
                qrDataUrl = await qrcodeLib.toDataURL(validationUrl, {
                  width: 220,
                  margin: 1,
                  color: { dark: '#000000FF', light: '#FFFFFFFF' }
                });
              } catch {
                // ignore
              }
            }

            const qrBoxEl = handle.bodyEl.querySelector('#gaQrSectionBox') as HTMLElement | null;
            const qrContainer = handle.bodyEl.querySelector('#gaQrCodeContainer') as HTMLElement | null;
            const copyExtractedBtn = handle.bodyEl.querySelector('#gaCopyExtractedQrUrlBtn') as HTMLButtonElement | null;

            if (qrDataUrl && qrContainer && qrBoxEl) {
              qrContainer.innerHTML = `<img src="${qrDataUrl}" alt="QR Code de Vérification" style="display:block; width:190px; height:190px; border-radius:6px;" />`;
              qrBoxEl.style.display = 'block';
            }

            copyExtractedBtn?.addEventListener('click', async () => {
              try {
                await navigator.clipboard.writeText(finalValidationUrl);
                toast('Lien de vérification copié dans le presse-papier !', 'ok');
              } catch {
                toast('Impossible de copier l\'URL', 'err');
              }
            });
          } catch (e) {
            console.warn('[403Modal] QR detection error:', e);
          }
        })();

        const copyEmailBtn = handle.bodyEl.querySelector('#gaCopyEmailBtn');
        const copyEmailLabel = handle.bodyEl.querySelector('#gaCopyEmailLabel');
        copyEmailBtn?.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(accountEmail);
            if (copyEmailLabel) copyEmailLabel.textContent = '✓ Copié !';
            toast('Email copié dans le presse-papier !', 'ok');
            setTimeout(() => {
              if (copyEmailLabel) copyEmailLabel.textContent = 'Copier';
            }, 1800);
          } catch {
            toast('Impossible de copier l\'email', 'err');
          }
        });

        // 1-Click Native Auto-Remediation (No external command needed)
        const autoRepairBtn = handle.bodyEl.querySelector('#gaAutoRepairAdcBtn') as HTMLButtonElement | null;
        const autoRepairLabel = handle.bodyEl.querySelector('#gaAutoRepairAdcLabel');
        const autoRepairFeedback = handle.bodyEl.querySelector('#gaAutoRepairAdcFeedback') as HTMLElement | null;

        autoRepairBtn?.addEventListener('click', async () => {
          if (!autoRepairBtn) return;
          autoRepairBtn.disabled = true;
          autoRepairBtn.style.opacity = '0.75';
          if (autoRepairLabel) autoRepairLabel.textContent = 'Connexion Google en cours...';
          if (autoRepairFeedback) {
            autoRepairFeedback.style.display = 'block';
            autoRepairFeedback.style.background = 'rgba(59, 130, 246, 0.15)';
            autoRepairFeedback.style.border = '1px solid rgba(59, 130, 246, 0.35)';
            autoRepairFeedback.style.color = '#93c5fd';
            autoRepairFeedback.innerHTML = '🌐 Navigateur ouvert pour l\'autorisation Google. Veuillez cliquer sur "Autoriser" puis patienter...';
          }

          try {
            const res = await (window.ag.providers as any).repairAccountAdc?.(accountEmail);
            if (res && res.success) {
              if (autoRepairLabel) autoRepairLabel.innerHTML = '✓ Réparation validée avec succès !';
              if (autoRepairFeedback) {
                autoRepairFeedback.style.background = 'rgba(16, 185, 129, 0.18)';
                autoRepairFeedback.style.border = '1px solid rgba(16, 185, 129, 0.4)';
                autoRepairFeedback.style.color = '#34d399';
                autoRepairFeedback.innerHTML = '✅ Compte réhabilité et identifiants Google ADC synchronisés avec succès !';
              }
              toast('Compte Google réparé et ADC synchronisé !', 'ok', 4000);
              await loadGoogleAccounts(true);
            } else {
              if (autoRepairLabel) autoRepairLabel.textContent = 'Échec de la réparation';
              if (autoRepairFeedback) {
                autoRepairFeedback.style.background = 'rgba(239, 68, 68, 0.15)';
                autoRepairFeedback.style.border = '1px solid rgba(239, 68, 68, 0.4)';
                autoRepairFeedback.style.color = '#fca5a5';
                autoRepairFeedback.innerHTML = `⚠️ ${escapeHtml(res?.error || 'Erreur lors de la réparation du compte')}`;
              }
              toast(`Erreur : ${res?.error || 'Échec de réparation'}`, 'err', 4500);
            }
          } catch (err: any) {
            if (autoRepairFeedback) {
              autoRepairFeedback.style.display = 'block';
              autoRepairFeedback.style.background = 'rgba(239, 68, 68, 0.15)';
              autoRepairFeedback.style.color = '#fca5a5';
              autoRepairFeedback.innerHTML = `⚠️ ${escapeHtml(err?.message || String(err))}`;
            }
          } finally {
            autoRepairBtn.disabled = false;
            autoRepairBtn.style.opacity = '1';
          }
        });

        // Copy Appeal Copilot Text
        const copyAppealTextBtn = handle.bodyEl.querySelector('#gaCopyAppealTextBtn');
        const copyAppealTextLabel = handle.bodyEl.querySelector('#gaCopyAppealTextLabel');
        const appealTextContent = handle.bodyEl.querySelector('#gaAppealTextContent');

        copyAppealTextBtn?.addEventListener('click', async () => {
          const textToCopy = appealTextContent?.textContent?.trim().replace(/^"|"$/g, '') || '';
          if (textToCopy) {
            try {
              await navigator.clipboard.writeText(textToCopy);
              if (copyAppealTextLabel) copyAppealTextLabel.textContent = '✓ Texte Copié !';
              toast('Argumentaire de recours copié dans le presse-papier !', 'ok');
              setTimeout(() => {
                if (copyAppealTextLabel) copyAppealTextLabel.textContent = 'Copier le texte';
              }, 2000);
            } catch {
              toast('Impossible de copier l\'argumentaire', 'err');
            }
          }
        });

        // Toggle Show/Hide Raw
        const toggleRawBtn = handle.bodyEl.querySelector('#gaToggleRawBtn');
        const toggleRawLabel = handle.bodyEl.querySelector('#gaToggleRawLabel');
        const copyRawBtn = handle.bodyEl.querySelector('#gaCopyRawBtn') as HTMLElement;
        const reasonFormatted = handle.bodyEl.querySelector('#gaReasonFormatted') as HTMLElement;
        const reasonRaw = handle.bodyEl.querySelector('#gaReasonRaw') as HTMLElement;
        toggleRawBtn?.addEventListener('click', () => {
          const isRaw = reasonRaw.style.display !== 'none';
          if (isRaw) {
            reasonRaw.style.display = 'none';
            reasonFormatted.style.display = 'block';
            if (copyRawBtn) copyRawBtn.style.display = 'none';
            if (toggleRawLabel) toggleRawLabel.textContent = 'Show Raw';
          } else {
            reasonRaw.style.display = 'block';
            reasonFormatted.style.display = 'none';
            if (copyRawBtn) copyRawBtn.style.display = 'inline-block';
            if (toggleRawLabel) toggleRawLabel.textContent = 'Hide Raw';
          }
        });

        // Copy Raw JSON
        copyRawBtn?.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(rawJsonString);
            toast('JSON brut copié dans le presse-papier !', 'ok');
          } catch {
            toast('Impossible de copier le JSON', 'err');
          }
        });

        // 4-Step Resolution Protocol Listeners
        handle.bodyEl.querySelector('#gaOpenConnectionsBtn')?.addEventListener('click', () => {
          const url = 'https://myaccount.google.com/connections';
          if (window.ag?.openExternal) void window.ag.openExternal(url);
          else window.open(url, '_blank');
        });

        handle.bodyEl.querySelector('#gaOpenAgeVerificationBtn')?.addEventListener('click', () => {
          const url = actionValidationUrl;
          if (window.ag?.openExternal) void window.ag.openExternal(url);
          else window.open(url, '_blank');
        });

        handle.bodyEl.querySelector('#gaCopyChallengeUrlBtn')?.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(actionValidationUrl);
            toast('Lien direct de validation copié !', 'ok');
          } catch {
            toast('Impossible de copier le lien', 'err');
          }
        });

        handle.bodyEl.querySelector('#gaNativeLoginBtn')?.addEventListener('click', () => {
          void triggerGoogleOAuthLogin('antigravity');
        });

        handle.bodyEl.querySelector('#gaResyncAccountBtn')?.addEventListener('click', async () => {
          const resyncBtn = handle.bodyEl.querySelector('#gaResyncAccountBtn') as HTMLButtonElement | null;
          if (resyncBtn) {
            resyncBtn.disabled = true;
            resyncBtn.textContent = 'Actualisation…';
          }
          await loadGoogleAccounts(true);
          toast('Comptes Google actualisés avec succès !', 'ok');
          if (resyncBtn) {
            resyncBtn.disabled = false;
            resyncBtn.textContent = '✓ Actualisé !';
          }
        });

        // Go to Validation (Interactive Challenge / Captcha)
        const goToValidationBtn = handle.bodyEl.querySelector('#gaGoToValidationBtn');
        goToValidationBtn?.addEventListener('click', () => {
          if (window.ag?.openExternal) {
            void window.ag.openExternal(actionValidationUrl);
          } else {
            window.open(actionValidationUrl, '_blank');
          }
        });

        // Copy Validation URL
        const copyValidationBtn = handle.bodyEl.querySelector('#gaCopyValidationBtn');
        const copyValidationLabel = handle.bodyEl.querySelector('#gaCopyValidationLabel');
        copyValidationBtn?.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(actionValidationUrl);
            if (copyValidationLabel) copyValidationLabel.textContent = '✓ URL Copiée !';
            toast('Lien de validation copié !', 'ok');
            setTimeout(() => {
              if (copyValidationLabel) copyValidationLabel.textContent = 'Copier Lien de Sécurité';
            }, 2000);
          } catch {
            toast('Impossible de copier l\'URL', 'err');
          }
        });

        // Open Antigravity Verification Resolution Modal
        const openVerificationCenterBtn = handle.bodyEl.querySelector('#gaOpenVerificationCenterBtn');
        openVerificationCenterBtn?.addEventListener('click', () => {
          void showAntigravityVerificationResolutionModal({ validationUrl: actionValidationUrl, hasChallenge: true });
        });

        // Go to Appeal
        const goToAppealBtn = handle.bodyEl.querySelector('#gaGoToAppealBtn');
        goToAppealBtn?.addEventListener('click', () => {
          if (window.ag?.openExternal) {
            void window.ag.openExternal(appealUrl);
          } else {
            window.open(appealUrl, '_blank');
          }
        });

        // Copy Appeal URL with micro-interaction feedback
        const copyAppealBtn = handle.bodyEl.querySelector('#gaCopyAppealBtn');
        const copyAppealLabel = handle.bodyEl.querySelector('#gaCopyAppealLabel');
        copyAppealBtn?.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(appealUrl);
            if (copyAppealLabel) copyAppealLabel.textContent = '✓ URL Copiée !';
            toast('Appeal URL copié dans le presse-papier !', 'ok');
            setTimeout(() => {
              if (copyAppealLabel) copyAppealLabel.textContent = 'Copy Appeal URL';
            }, 2000);
          } catch {
            toast('Impossible de copier l\'URL', 'err');
          }
        });

        // Terminal Quick Fix Accordion
        const quickFixToggleBtn = handle.bodyEl.querySelector('#gaQuickFixToggleBtn');
        const quickFixBody = handle.bodyEl.querySelector('#gaQuickFixBody') as HTMLElement;
        const quickFixArrow = handle.bodyEl.querySelector('#gaQuickFixArrow') as HTMLElement;
        quickFixToggleBtn?.addEventListener('click', () => {
          const isExpanded = quickFixBody.style.display !== 'none';
          quickFixBody.style.display = isExpanded ? 'none' : 'block';
          if (quickFixArrow) {
            quickFixArrow.style.transform = isExpanded ? 'none' : 'rotate(90deg)';
          }
        });

        // Copy Command Buttons with micro-interaction
        handle.bodyEl.querySelectorAll('.btn-copy-cmd').forEach((btnEl: any) => {
          btnEl.addEventListener('click', async () => {
            const cmd = (btnEl as HTMLElement).dataset.cmd || '';
            if (cmd) {
              try {
                await navigator.clipboard.writeText(cmd);
                const originalHtml = btnEl.innerHTML;
                btnEl.innerHTML = '<span style="color:#10b981;">✓</span> Copié !';
                toast(`Commande copiée : ${cmd}`, 'ok');
                setTimeout(() => {
                  btnEl.innerHTML = originalHtml;
                }, 1500);
              } catch {}
            }
          });
        });

        // Google Cloud Console Link
        handle.bodyEl.querySelector('#gaOpenConsoleLink')?.addEventListener('click', (e: any) => {
          e.preventDefault();
          const url = 'https://console.cloud.google.com/apis/library/generativelanguage.googleapis.com';
          if (window.ag?.openExternal) void window.ag.openExternal(url);
          else window.open(url, '_blank');
        });
      }
    });
  }

  // Delegated event listeners for gaAccountsContainer
  if (gaAccountsContainer) {
    gaAccountsContainer.addEventListener('click', async (e) => {
      const target = e.target as HTMLElement;

      // Error Details modal trigger (badge or button)
      const errTrigger = target.closest('.ga-error-details-btn, .ga-error-details-badge') as HTMLElement | null;
      if (errTrigger) {
        const row = errTrigger.closest('[data-id]') as HTMLElement | null;
        const id = row?.dataset.id || errTrigger.dataset.id;
        const acc = googleAccountsCache.find((x) => x.id === id);
        if (acc) {
          showAccountErrorDetailsModal(acc);
          return;
        }
      }

      // Sortable table headers
      const sortTh = target.closest('.ga-sortable-th') as HTMLElement | null;
      if (sortTh && sortTh.dataset.sort) {
        const col = sortTh.dataset.sort as 'name' | 'quota' | 'lastUsed';
        if (gaSortColumn === col) {
          gaSortDirection = gaSortDirection === 'asc' ? 'desc' : 'asc';
        } else {
          gaSortColumn = col;
          gaSortDirection = col === 'name' ? 'asc' : 'desc';
        }
        renderGoogleAccountsList(googleAccountsCache);
        return;
      }

      // Empty state buttons
      if (target.closest('#gaEmptyAddBtn')) {
        openGoogleAccountModal();
        return;
      }
      if (target.closest('#gaEmptyDiscoverBtn')) {
        void triggerIdeAccountDiscovery();
        return;
      }

      // Soft-stow button handler (<3% quota auto-protection)
      const stowBtn = target.closest('.ga-soft-stow-btn') as HTMLButtonElement | null;
      if (stowBtn) {
        const accId = stowBtn.dataset.accountId;
        const targetAcc = googleAccountsCache.find((x) => x.id === accId);
        if (targetAcc) {
          targetAcc.enabled = false;
          await saveGoogleAccountsBatch(googleAccountsCache);
          toast(`⏸ ${targetAcc.name || targetAcc.email} mis au repos préventif (<3%)`, 'ok', 3000);
          await loadGoogleAccounts();
        }
        return;
      }

      // More actions dropdown toggle button
      const moreTrigger = target.closest('.ga-more-trigger') as HTMLButtonElement | null;
      if (moreTrigger) {
        e.stopPropagation();
        const wrap = moreTrigger.closest('.ga-more-dropdown-wrap');
        const isOpen = wrap?.classList.contains('open');
        document.querySelectorAll('.ga-more-dropdown-wrap.open').forEach((w) => w.classList.remove('open'));
        if (!isOpen && wrap) {
          wrap.classList.add('open');
          const menu = wrap.querySelector('.ga-more-dropdown-menu') as HTMLElement | null;
          if (menu) {
            const rect = menu.getBoundingClientRect();
            if (rect.bottom > window.innerHeight - 24) {
              menu.classList.add('drop-up');
            } else {
              menu.classList.remove('drop-up');
            }
          }
        }
        return;
      }

      // Action buttons
      const btn = target.closest('.ga-action-btn') as HTMLButtonElement | null;
      if (!btn) return;

      // Close open dropdown menu if clicking inside one
      btn.closest('.ga-more-dropdown-wrap')?.classList.remove('open');

      const row = btn.closest('[data-id]') as HTMLElement | null;
      const id = row?.dataset.id;
      if (!id) return;
      const account = googleAccountsCache.find((x) => x.id === id);

      // Switch
      if (btn.classList.contains('ga-switch')) {
        let switchedToName = account?.name || id;
        for (const a of googleAccountsCache) {
          a.isCurrent = (a.id === id);
          if (a.id === id) {
            a.lastUsed = Date.now();
            let effectiveToken = a.apiKey;
            if (a.refreshToken) {
              try {
                const r = await window.ag.providers.refreshToken(a.refreshToken);
                if (r.success && r.accessToken) {
                  a.apiKey = r.accessToken;
                  effectiveToken = r.accessToken;
                  if (r.quotas) a.quotas = r.quotas;
                  if (r.picture && !a.picture) a.picture = r.picture;
                }
              } catch {}
            }
            // Inject new account into Antigravity IDE's state.vscdb
            if (effectiveToken && typeof window.ag.providers.switchIdeAccount === 'function') {
              try {
                await window.ag.providers.switchIdeAccount({
                  accessToken: effectiveToken,
                  refreshToken: a.refreshToken,
                  email: a.email || a.name,
                  picture: a.picture,
                });
              } catch {}
            }
            switchedToName = a.name || id;
          }
        }
        await saveGoogleAccountsBatch(googleAccountsCache);
        toast(`Compte actif basculé sur ${switchedToName} (synchronisé dans l'IDE)`, 'ok');
        renderGoogleAccountsList(googleAccountsCache);
        return;
      }

      // Details
      if (btn.classList.contains('ga-details')) {
        if (!account) return;
        const isStudio = isAiStudioAccount(account);
        const isCli = isGeminiCliAccount(account);
        const tier = getAccountTier(account);
        const quotas = account.quotas;
        const cdInfo = getAccountActiveCooldown(account);
        const isEnabled = account.enabled !== false;
        const recom = getAccountRecommendation(account);
        const isValAccount = isAccountValidationRequired(account);
        const hasErrAccount = hasAccountErrorOrValidation(account);
        const dedupModels = getDeduplicatedAccountModels(account.models);
        const diagBg = recom.type === 'warn' || recom.type === 'cooldown'
          ? 'rgba(245, 158, 11, 0.12)'
          : (recom.type === 'paused'
            ? 'rgba(239, 68, 68, 0.12)'
            : (recom.type === 'info'
              ? 'rgba(56, 189, 248, 0.12)'
              : 'rgba(16, 185, 129, 0.12)'));
        const diagBorder = recom.type === 'warn' || recom.type === 'cooldown'
          ? 'rgba(245, 158, 11, 0.3)'
          : (recom.type === 'paused'
            ? 'rgba(239, 68, 68, 0.3)'
            : (recom.type === 'info'
              ? 'rgba(56, 189, 248, 0.3)'
              : 'rgba(16, 185, 129, 0.3)'));
        const diagColor = recom.type === 'warn' || recom.type === 'cooldown'
          ? '#fbbf24'
          : (recom.type === 'paused'
            ? '#f87171'
            : (recom.type === 'info'
              ? '#38bdf8'
              : '#34d399'));

        const detailsHtml = `
          <div style="font-size: 12.5px; line-height: 1.6;">
            <div style="display: grid; grid-template-columns: 130px 1fr; gap: 8px 12px; margin-bottom: 16px;">
              <span style="color: var(--text-2);">Name / Label:</span>
              <strong>${escapeHtml(account.name)}</strong>
              <span style="color: var(--text-2);">Email / User ID:</span>
              <span>${escapeHtml(account.email || account.name || '(unspecified)')}</span>
              <span style="color: var(--text-2);">Plan / Tier:</span>
              <span><span class="ga-badge ga-badge-${tier.toLowerCase()}">${tier}</span></span>
              <span style="color: var(--text-2);">Status Pool:</span>
              <span>${isEnabled ? '<span class="ga-badge ga-badge-ok">Actif dans le pool</span>' : '<span class="ga-badge ga-badge-warn">Désactivé (En pause)</span>'}</span>
              <span style="color: var(--text-2);">Diagnostic & Conseil:</span>
              <div id="gaModalDiagnosticCard" style="padding: 7px 11px; border-radius: 6px; background: ${diagBg}; border: 1px solid ${diagBorder}; color: ${diagColor}; font-size: 11.5px; line-height: 1.45; ${isValAccount ? 'cursor: pointer; display: flex; align-items: center; justify-content: space-between; gap: 8px;' : ''}" ${isValAccount ? 'title="Cliquer pour ouvrir l\'Assistant Interactif en 4 étapes"' : ''}>
                <span>${escapeHtml(recom.text)}</span>
                ${isValAccount ? `<button type="button" id="gaModalDiagActionBtn" style="background: rgba(245, 158, 11, 0.25); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.45); border-radius: 5px; padding: 2px 8px; font-size: 10.5px; font-weight: 700; cursor: pointer; flex-shrink: 0;">Assistant 4 Étapes ›</button>` : ''}
              </div>
              <span style="color: var(--text-2);">Cooldown Status:</span>
              <span>${cdInfo ? `<span class="ga-badge ga-badge-warn" style="background: rgba(245, 158, 11, 0.2); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.4);">${escapeHtml(cdInfo.text)}</span> <small style="display:block; color:var(--text-2); margin-top:3px;">${escapeHtml(cdInfo.details)}</small>` : '<span style="color: #10b981;">🟢 Aucun cooldown actif (Prêt pour requêtes)</span>'}</span>
              <span style="color: var(--text-2);">Current Active:</span>
              <span>${account.isCurrent ? '<span class="ga-badge ga-badge-current">CURRENT (Primary AGY)</span>' : 'No'}</span>
              <span style="color: var(--text-2);">Last Used:</span>
              <span>${formatLastUsed(account.lastUsed || account.updatedAt)}</span>
              ${typeof account.lastLatencyMs === 'number' ? `
              <span style="color: var(--text-2);">Dernière Latence:</span>
              <span style="color: #38bdf8; font-weight: 600;">⚡ ${account.lastLatencyMs}ms (Test Ping)</span>` : ''}
              <span style="color: var(--text-2);">API Key / Token:</span>
              <code>${escapeHtml(maskKeyPreview(account.apiKey || ""))}</code>
              <span style="color: var(--text-2);">Modèles Détectés:</span>
              <div>
                <div style="font-weight: 600; margin-bottom: 4px;">${dedupModels.length} modèles actifs (${dedupModels.filter((m) => m.enabled !== false).length} activés) :</div>
                <div style="display: flex; flex-wrap: wrap; gap: 4px;">
                  ${dedupModels.map((m) => `<span style="font-size: 10px; padding: 1px 6px; border-radius: 4px; background: rgba(59,130,246,0.12); color: #60a5fa; border: 1px solid rgba(59,130,246,0.25);">${escapeHtml(m.displayName)}</span>`).join('') || '<span style="color: var(--text-3); font-style: italic;">Aucun modèle</span>'}
                </div>
              </div>
            </div>
            ${cdInfo ? `
            <div style="margin-bottom: 14px; padding: 10px 12px; background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 8px; display: flex; align-items: center; justify-content: space-between; gap: 10px;">
              <div>
                <strong style="color: #f59e0b; font-size: 12px;">Compte actuellement en Cooldown</strong>
                <div style="font-size: 11px; color: var(--text-2);">Le proxy ignore temporairement ce compte pour éviter les 429 ou 504 répétés.</div>
              </div>
              <button type="button" class="btn btn-sm" id="gaModalLiftCdBtn" style="background: #10b981; color: #fff; font-size: 11px; font-weight: 600; padding: 4px 10px; border-radius: 6px; border: none; cursor: pointer; flex-shrink: 0;">
                ⚡ Réveiller Maintenant
              </button>
            </div>
            ` : ''}
            ${hasErrAccount ? `
            <div style="margin-bottom: 14px; padding: 12px 14px; background: ${isValAccount ? 'rgba(245, 158, 11, 0.12)' : 'rgba(239, 68, 68, 0.12)'}; border: 1px solid ${isValAccount ? 'rgba(245, 158, 11, 0.35)' : 'rgba(239, 68, 68, 0.35)'}; border-radius: 8px; display: flex; align-items: center; justify-content: space-between; gap: 10px;">
              <div>
                <strong style="color: ${isValAccount ? '#fbbf24' : '#ef4444'}; font-size: 12.5px; display: flex; align-items: center; gap: 6px;">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                  ${isValAccount ? 'Validation de Sécurité Requise (Google Challenge 403)' : 'Compte Bloqué par Google (TOS Violation / 403)'}
                </strong>
                <div style="font-size: 11px; color: ${isValAccount ? '#cbd5e1' : '#fca5a5'}; margin-top: 2px;">
                  ${isValAccount ? 'Vérification d\'âge requise. Assistant interactif en 4 étapes prêt.' : 'Violation des conditions ou suspension détectée. Guide de déblocage disponible.'}
                </div>
              </div>
              <button type="button" class="btn btn-sm" id="gaModalOpenErrorDetailsBtn" style="background: ${isValAccount ? 'linear-gradient(135deg, #f59e0b, #d97706)' : '#ef4444'}; color: #fff; font-size: 11.5px; font-weight: 700; padding: 6px 12px; border-radius: 6px; border: none; cursor: pointer; flex-shrink: 0; box-shadow: 0 2px 8px ${isValAccount ? 'rgba(245, 158, 11, 0.35)' : 'rgba(239, 68, 68, 0.35)'};">
                ${isValAccount ? '🟠 Assistant 4 Étapes' : '🔒 Solutions Quick Fix'}
              </button>
            </div>
            ` : ''}
            <div style="background: var(--bg-1); border: 1px solid var(--border); border-radius: 8px; padding: 12px;">
              <div style="font-weight: 600; margin-bottom: 8px; color: var(--text-1);">Live Quota Metrics</div>
              ${quotas && !isCli ? (() => {
                const est = estimateAccountTokens(account);
                const {
                  gemini5hPct: g5hPct,
                  geminiWkPct: gWkPct,
                  claude5hPct: c5hPct,
                  claudeWkPct: cWkPct,
                  gemini5hReset: rawG5hReset,
                  geminiWkReset: rawGWkReset,
                  claude5hReset: rawC5hReset,
                  claudeWkReset: rawCWkReset,
                } = getAccountEffectiveQuotas(account);
                const gWkReset = formatResetCountdown(rawGWkReset);
                const g5hReset = formatResetCountdown(rawG5hReset);
                const cWkReset = formatResetCountdown(rawCWkReset);
                const c5hReset = formatResetCountdown(rawC5hReset);
                return `
                <div style="display: flex; flex-direction: column; gap: 6px; font-size: 11.5px;">
                  <div style="display: flex; justify-content: space-between;">
                    <span>Gemini Weekly:</span>
                    <strong>${gWkPct}% (~${formatCompactTokens(est.availableTokensWeekly)})${gWkReset ? ` · ${gWkReset}` : ''}</strong>
                  </div>
                  <div style="display: flex; justify-content: space-between;">
                    <span>Gemini 5H:</span>
                    <strong>${g5hPct}% (~${formatCompactTokens(est.availableTokens5h)})${g5hReset ? ` · ${g5hReset}` : ''}</strong>
                  </div>
                  <div style="display: flex; justify-content: space-between;">
                    <span>Claude/GPT Weekly:</span>
                    <strong style="${cWkPct === 0 ? 'color: #60a5fa;' : ''}">${cWkPct}% (~${formatCompactTokens(est.claudeAvailableWeekly)})${cWkReset ? ` · ${cWkReset}` : ''}</strong>
                  </div>
                  <div style="display: flex; justify-content: space-between;">
                    <span>Claude/GPT 5H:</span>
                    <strong>${c5hPct}% (~${formatCompactTokens(est.claudeAvailable5h)})${c5hReset ? ` · ${c5hReset}` : ''}</strong>
                  </div>
                </div>
                `;
              })() : isCli ? (() => {
                const estCli = getGeminiCliQuotaEstimate(account);
                const liveBuckets = (quotas?.groups || []).find((g: any) => g.name === 'Models Live Quota' || g.name === 'Models')?.buckets || [];
                return `
                <div style="display: flex; flex-direction: column; gap: 6px; font-size: 11.5px;">
                  <div style="display: flex; justify-content: space-between;">
                    <span>Quota Quotidien (RPD):</span>
                    <strong>${estCli.rpdLimit - estCli.rpdUsed} / ${estCli.rpdLimit} reqs (${estCli.rpdRemainingPct}%)</strong>
                  </div>
                  <div style="display: flex; justify-content: space-between;">
                    <span>Débit max (RPM):</span>
                    <strong>${estCli.rpmLimit} RPM (Fenêtre 60s)</strong>
                  </div>
                  <div style="display: flex; justify-content: space-between;">
                    <span>Tokens quotidiens estimés:</span>
                    <strong>~${formatCompactTokens(estCli.rpdAvailableTokens)}</strong>
                  </div>
                  <div style="display: flex; justify-content: space-between;">
                    <span>Réinitialisation:</span>
                    <strong>${estCli.resetCountdown} (00:00 UTC)</strong>
                  </div>
                  <div style="display: flex; justify-content: space-between;">
                    <span>Service:</span>
                    <span style="color: #c084fc;">Google Cloud Code Assist (Production)</span>
                  </div>
                  ${liveBuckets.length > 0 ? `
                    <div style="margin-top: 6px; padding-top: 6px; border-top: 1px dashed var(--border);">
                      <div style="font-weight: 600; margin-bottom: 4px; color: var(--text-2);">Quotas par Modèle (Live):</div>
                      ${liveBuckets.map((b: any) => `
                        <div style="display: flex; justify-content: space-between; font-size: 11px;">
                          <span>${escapeHtml(b.displayName || b.modelId)}:</span>
                          <strong style="color: ${getQuotaColor(b.pct)};">${b.pct}% restant</strong>
                        </div>
                      `).join('')}
                    </div>
                  ` : ''}
                </div>
                `;
              })() : isStudio ? (() => {
                const estStudio = getAiStudioQuotaEstimate(account);
                return `
                <div style="display: flex; flex-direction: column; gap: 6px; font-size: 11.5px;">
                  <div style="display: flex; justify-content: space-between;">
                    <span>Quota Quotidien (RPD):</span>
                    <strong>${estStudio.rpdLimit - estStudio.rpdUsed} / ${estStudio.rpdLimit} reqs (${estStudio.rpdRemainingPct}%)</strong>
                  </div>
                  <div style="display: flex; justify-content: space-between;">
                    <span>Débit max (RPM):</span>
                    <strong>${estStudio.rpmLimit} RPM (Fenêtre 60s)</strong>
                  </div>
                  <div style="display: flex; justify-content: space-between;">
                    <span>Tokens quotidiens estimés:</span>
                    <strong>~${formatCompactTokens(estStudio.rpdAvailableTokens)}</strong>
                  </div>
                  <div style="display: flex; justify-content: space-between;">
                    <span>Réinitialisation:</span>
                    <strong>${estStudio.resetCountdown} (00:00 UTC)</strong>
                  </div>
                </div>
                `;
              })() : '<span style="color: var(--text-3); font-style: italic;">No live quota data available.</span>'}
            </div>
          </div>
        `;
        const confirmPromise = modals.confirm(`Account Details: ${account.name}`, detailsHtml, { confirmLabel: 'Fermer', hideCancel: true });
        const cancelBtnEl = document.getElementById('modalCancel');
        if (cancelBtnEl) cancelBtnEl.style.display = 'none';
        setTimeout(() => {
          const modalLiftBtn = document.getElementById('gaModalLiftCdBtn');
          modalLiftBtn?.addEventListener('click', async () => {
            modalLiftBtn.setAttribute('disabled', 'true');
            modalLiftBtn.innerHTML = '⚡ Levée…';
            try {
              const res = await window.ag.providers.liftAccountCooldown?.(account.email || account.name || account.id);
              if (res && res.success) {
                toast(`✅ Cooldown levé avec succès pour ${account.name} !`, 'ok');
                await loadGoogleAccounts();
                const closeBtn = document.querySelector('#modalConfirm, #modalClose') as HTMLElement | null;
                closeBtn?.click();
              } else {
                toast(`Erreur : ${res?.error || 'Échec de levée du cooldown'}`, 'err');
              }
            } catch (err: any) {
              toast(`Erreur : ${err?.message || err}`, 'err');
            }
          });

          const modalOpenErrBtn = document.getElementById('gaModalOpenErrorDetailsBtn');
          const modalDiagCard = document.getElementById('gaModalDiagnosticCard');
          const modalDiagBtn = document.getElementById('gaModalDiagActionBtn');

          const openDiagnosticModal = () => {
            const closeBtn = document.querySelector('#modalConfirm, #modalClose') as HTMLElement | null;
            closeBtn?.click();
            setTimeout(() => showAccountErrorDetailsModal(account), 150);
          };

          modalOpenErrBtn?.addEventListener('click', openDiagnosticModal);
          if (isValAccount) {
            modalDiagCard?.addEventListener('click', openDiagnosticModal);
            modalDiagBtn?.addEventListener('click', (e) => {
              e.stopPropagation();
              openDiagnosticModal();
            });
          }
        }, 100);
        await confirmPromise;
        return;
      }

      // Refresh
      if (btn.classList.contains('ga-refresh')) {
        if (!account || (!account.apiKey && !account.refreshToken)) {
          toast('No API key/token available for this account', 'warn');
          return;
        }
        btn.setAttribute('disabled', 'true');
        btn.classList.add('spinning');
        try {
          if (account.apiKey && isAiStudioAccount(account)) {
            try {
              const testRes = await window.ag.providers.test({
                provider: 'google',
                apiKey: account.apiKey,
                apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
                modelId: 'gemini-3.7-flash',
              });
              if (testRes && testRes.success) {
                toast(`Google AI Studio : clé active et connectée (${testRes.latencyMs || 0}ms)`, 'ok');
              } else {
                toast(`Google AI Studio : ${testRes?.error || 'Erreur de connexion'}`, 'warn');
              }
            } catch {
              toast('Google AI Studio : clé enregistrée', 'ok');
            }
            return;
          }

          if (isGeminiCliAccount(account)) {
            let tokenToUse = account.apiKey;
            if (account.refreshToken) {
              const rRes = await window.ag.providers.refreshToken(account.refreshToken);
              if (rRes.success && rRes.accessToken) {
                tokenToUse = rRes.accessToken;
                account.apiKey = rRes.accessToken;
                if (rRes.picture && !account.picture) account.picture = rRes.picture;
                if (rRes.name && (!account.name || account.name.includes('@'))) account.name = rRes.name;
              }
            }
            if (tokenToUse || account.refreshToken) {
              const qRes = await window.ag.providers.fetchAccountQuotas(tokenToUse || account.refreshToken, account.refreshToken);
              if (qRes.success && qRes.quotas) {
                account.quotas = qRes.quotas;
                if (qRes.quotas.isUnlicensed) {
                  account.isUnlicensed = true;
                } else {
                  delete account.isUnlicensed;
                  delete account.errorDetails;
                  delete (account as any).isValidationRequired;
                  delete (account as any).lastError;
                  (account as any).status = 'healthy';
                }
              }
            }
            await window.ag.providers.save(account);
            toast(`Quotas actualisés pour ${account.name} (Gemini CLI)`, 'ok');
            return;
          }

          let tokenToUse = account.apiKey;
          if (account.refreshToken) {
            const rRes = await window.ag.providers.refreshToken(account.refreshToken);
            if (rRes.success && rRes.accessToken) {
              tokenToUse = rRes.accessToken;
              account.apiKey = rRes.accessToken;
              if (rRes.quotas) account.quotas = rRes.quotas;
              if (rRes.picture && !account.picture) account.picture = rRes.picture;
              if (rRes.name && (!account.name || account.name.includes('@'))) account.name = rRes.name;
            }
          }
          if (tokenToUse || account.refreshToken) {
            const qRes = await window.ag.providers.fetchAccountQuotas(tokenToUse || account.refreshToken, account.refreshToken);
            if (qRes.success && qRes.quotas) {
              account.quotas = qRes.quotas;
              account.updatedAt = Date.now();
              if (account.quotas) account.quotas.updatedAt = Date.now();
              if (qRes.quotas.isUnlicensed) {
                account.isUnlicensed = true;
              } else {
                delete account.isUnlicensed;
                delete account.errorDetails;
              }
            }
          }
          await window.ag.providers.save(account);
          void forceProxyQuotaRefresh();
          toast(`Quotas updated for ${account.name}`, 'ok');
        } catch (err) {
          toast(`Quota error: ${(err as Error).message}`, 'err');
        } finally {
          btn.removeAttribute('disabled');
          btn.classList.remove('spinning');
          renderGoogleAccountsList(googleAccountsCache);
        }
        return;
      }

      // Warmup
      if (btn.classList.contains('ga-warmup')) {
        if (!account || (!account.apiKey && !account.refreshToken)) {
          toast('No token available for warmup', 'warn');
          return;
        }
        btn.setAttribute('disabled', 'true');
        btn.classList.add('spinning');
        try {
          let tokenToUse = account.apiKey;
          if (account.refreshToken) {
            try {
              const r = await window.ag.providers.refreshToken(account.refreshToken);
              if (r.success && r.accessToken) {
                tokenToUse = r.accessToken;
                account.apiKey = r.accessToken;
              }
            } catch {}
          }
          const wRes = await window.ag.providers.warmupAccount(tokenToUse);
          if (wRes.success) {
            toast(`Warmup successful for ${account.name}`, 'ok');
            const qRes = await window.ag.providers.fetchAccountQuotas(tokenToUse);
            if (qRes.success && qRes.quotas) {
              account.quotas = qRes.quotas;
              await window.ag.providers.save(account);
            }
          } else {
            toast(`Warmup failed: ${wRes.error || 'Request rejected'}`, 'err');
          }
        } catch (err) {
          toast(`Warmup error: ${(err as Error).message}`, 'err');
        } finally {
          btn.removeAttribute('disabled');
          btn.classList.remove('spinning');
          renderGoogleAccountsList(googleAccountsCache);
        }
        return;
      }

      // Lift Cooldown (Wake-up)
      if (btn.classList.contains('ga-lift-cd')) {
        if (!account) return;
        btn.setAttribute('disabled', 'true');
        btn.classList.add('spinning');
        try {
          const res = await window.ag.providers.liftAccountCooldown?.(account.email || account.name || account.id);
          if (res && res.success) {
            toast(`✅ Cooldown levé avec succès pour ${account.name || account.email} !`, 'ok', 3500);
            await loadGoogleAccounts();
          } else {
            toast(`Erreur lors de la levée : ${res?.error || 'Échec'}`, 'err');
          }
        } catch (err: any) {
          toast(`Erreur : ${err?.message || err}`, 'err');
        } finally {
          btn.removeAttribute('disabled');
          btn.classList.remove('spinning');
        }
        return;
      }

      // Toggle Enable / Pause
      if (btn.classList.contains('ga-toggle-enable')) {
        if (!account) return;
        btn.setAttribute('disabled', 'true');
        try {
          const newState = account.enabled === false ? true : false;
          account.enabled = newState;
          // If enabled is true, we also ensure its models are active
          await saveGoogleAccountsBatch(googleAccountsCache);
          const stateLabel = newState ? 'réactivé dans le pool' : 'mis en pause (exclu du pool)';
          toast(`Compte ${account.name || account.email} ${stateLabel} !`, newState ? 'ok' : 'warn', 3000);
          await loadGoogleAccounts();
        } catch (err: any) {
          toast(`Erreur : ${err?.message || err}`, 'err');
        } finally {
          btn.removeAttribute('disabled');
        }
        return;
      }

      // Ping Latency Test
      if (btn.classList.contains('ga-ping')) {
        if (!account) return;
        btn.setAttribute('disabled', 'true');
        btn.classList.add('spinning');
        try {
          const start = performance.now();
          let tokenToUse = account.apiKey;
          if (account.refreshToken && (!tokenToUse || !tokenToUse.startsWith('ya29.'))) {
            try {
              const rRes = await window.ag.providers.refreshToken(account.refreshToken);
              if (rRes.success && rRes.accessToken) {
                tokenToUse = rRes.accessToken;
                account.apiKey = rRes.accessToken;
              }
            } catch {}
          }
          let success = false;
          let latency = 0;
          if (isAiStudioAccount(account)) {
            const testRes = await window.ag.providers.test({
              provider: 'google',
              apiKey: tokenToUse || "",
              apiUrl: account.apiUrl || 'https://generativelanguage.googleapis.com/v1beta',
              modelId: 'gemini-3.7-flash',
            });
            latency = Math.round(testRes?.latencyMs || (performance.now() - start));
            success = Boolean(testRes?.success);
          } else {
            const qRes = await window.ag.providers.fetchAccountQuotas(tokenToUse);
            latency = Math.round(performance.now() - start);
            success = Boolean(qRes?.success);
          }
          account.lastLatencyMs = latency;
          if (success) {
            toast(`⚡ Ping ${account.name || account.email} : ${latency}ms (Connexion saine)`, 'ok', 3500);
          } else {
            toast(`⚠️ Ping ${account.name || account.email} : Réponse en ${latency}ms (Vérifiez le token)`, 'warn', 4000);
          }
        } catch (err: any) {
          toast(`Erreur Ping : ${err?.message || err}`, 'err');
        } finally {
          btn.removeAttribute('disabled');
          btn.classList.remove('spinning');
          renderGoogleAccountsList(googleAccountsCache);
        }
        return;
      }

      // Toggle Tier (FREE <-> PRO)
      if (btn.classList.contains('ga-toggle-tier') || btn.classList.contains('ga-tier-badge')) {
        if (!account) return;
        const currentTier = getAccountTier(account);
        const nextTier = currentTier === 'FREE' ? 'pro' : 'free';
        account.tier = nextTier;
        (account as any).tierId = `${nextTier}-tier`;
        try {
          await window.ag.providers.save(account);
          toast(`Compte "${account.name || account.email}" basculé en ${nextTier.toUpperCase()}`, 'ok');
          await loadGoogleAccounts();
        } catch (err: any) {
          toast(`Erreur : ${err?.message || err}`, 'err');
        }
        return;
      }

      // Edit
      if (btn.classList.contains('ga-edit')) {
        openGoogleAccountModal(id);
        return;
      }

      // Delete
      if (btn.classList.contains('ga-delete')) {
        if (!account) return;
        const isCurrent = Boolean(account.isCurrent);
        const title = isCurrent ? '⚠️ Supprimer le Compte Actif Antigravity ?' : 'Delete Google Account?';
        const message = isCurrent
          ? `<div style="margin-bottom: 8px; color: var(--err); font-weight: 600;">⚠️ Attention : Compte Actif en production dans l'IDE !</div>
Le compte <strong>${escapeHtml(account.name)}</strong> est actuellement utilisé par Antigravity pour vos requêtes. Sa suppression interrompra les appels jusqu'à sélection d'un autre compte actif.<br><br>Êtes-vous sûr de vouloir supprimer définitivement ce compte ?`
          : `Remove Google account <strong>${escapeHtml(account.name)}</strong> and its associated models from Antigravity?`;
        const ok = await modals.confirm(
          title,
          message,
          { danger: true, confirmLabel: isCurrent ? 'Supprimer malgré tout' : 'Delete Account' }
        );
        if (!ok) return;
        const res = (await window.ag.providers.delete(id)) as { success: boolean; error?: string };
        if (res.success) {
          toast('Google account deleted', 'ok');
          await loadGoogleAccounts();
        } else {
          toast(`Delete failed: ${res.error}`, 'err');
        }
        return;
      }
    });

    function updateBatchActionBar(): void {
      const bar = document.getElementById('gaBatchActionBar');
      const countEl = document.getElementById('gaBatchSelectedCount');
      if (!bar) return;
      const count = gaSelectedIds.size;
      if (count > 0) {
        bar.style.display = 'flex';
        if (countEl) countEl.textContent = `${count} sélectionné${count > 1 ? 's' : ''}`;
      } else {
        bar.style.display = 'none';
      }
    }

    gaAccountsContainer.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement;
      if (target.id === 'gaMasterCheckbox') {
        const isChecked = target.checked;
        gaAccountsContainer.querySelectorAll<HTMLInputElement>('.ga-row-cb').forEach((cb) => {
          cb.checked = isChecked;
          const id = cb.dataset.id;
          if (id) {
            if (isChecked) gaSelectedIds.add(id);
            else gaSelectedIds.delete(id);
          }
        });
      } else if (target.classList.contains('ga-row-cb')) {
        const id = target.dataset.id;
        if (id) {
          if (target.checked) gaSelectedIds.add(id);
          else gaSelectedIds.delete(id);
        }
        const masterCb = $('#gaMasterCheckbox') as HTMLInputElement | null;
        if (masterCb) {
          const all = gaAccountsContainer.querySelectorAll<HTMLInputElement>('.ga-row-cb');
          masterCb.checked = all.length > 0 && Array.from(all).every((c) => c.checked);
        }
      }
      updateBatchActionBar();
    });

    // Wire Batch Action Buttons
    $('#gaBatchDeselectBtn')?.addEventListener('click', () => {
      gaSelectedIds.clear();
      const masterCb = $('#gaMasterCheckbox') as HTMLInputElement | null;
      if (masterCb) masterCb.checked = false;
      gaAccountsContainer.querySelectorAll<HTMLInputElement>('.ga-row-cb').forEach((cb) => {
        cb.checked = false;
      });
      updateBatchActionBar();
    });

    $('#gaBatchLiftCdBtn')?.addEventListener('click', async () => {
      if (gaSelectedIds.size === 0) return;
      const ids = Array.from(gaSelectedIds);
      let lifted = 0;
      for (const id of ids) {
        const acc = googleAccountsCache.find((x) => x.id === id);
        if (acc) {
          try {
            const res = await window.ag.providers.liftAccountCooldown?.(acc.email || acc.name || acc.id);
            if (res && res.success) lifted++;
          } catch {}
        }
      }
      toast(`⚡ Cooldown levé sur ${lifted} compte(s) sélectionné(s) !`, 'ok', 3500);
      await loadGoogleAccounts();
      updateBatchActionBar();
    });

    $('#gaBatchPauseBtn')?.addEventListener('click', async () => {
      if (gaSelectedIds.size === 0) return;
      let count = 0;
      for (const id of gaSelectedIds) {
        const acc = googleAccountsCache.find((x) => x.id === id);
        if (acc && acc.enabled !== false) {
          acc.enabled = false;
          count++;
        }
      }
      await saveGoogleAccountsBatch(googleAccountsCache);
      toast(`⏸ ${count} compte(s) mis en pause préventive`, 'ok', 3500);
      await loadGoogleAccounts();
      updateBatchActionBar();
    });

    $('#gaBatchResumeBtn')?.addEventListener('click', async () => {
      if (gaSelectedIds.size === 0) return;
      let count = 0;
      for (const id of gaSelectedIds) {
        const acc = googleAccountsCache.find((x) => x.id === id);
        if (acc && acc.enabled === false) {
          acc.enabled = true;
          count++;
        }
      }
      await saveGoogleAccountsBatch(googleAccountsCache);
      toast(`▶ ${count} compte(s) réactivé(s) dans le pool`, 'ok', 3500);
      await loadGoogleAccounts();
      updateBatchActionBar();
    });

    $('#gaBatchPingBtn')?.addEventListener('click', async () => {
      if (gaSelectedIds.size === 0) return;
      const ids = Array.from(gaSelectedIds);
      toast(`📶 Test Ping groupé sur ${ids.length} compte(s) en cours...`, 'info', 2500);
      let successCount = 0;
      await Promise.allSettled(ids.map(async (id) => {
        const acc = googleAccountsCache.find((x) => x.id === id);
        if (!acc) return;
        const start = performance.now();
        try {
          const res = await window.ag.providers.fetchAccountQuotas(acc.apiKey);
          acc.lastLatencyMs = Math.round(performance.now() - start);
          if (res?.success) successCount++;
        } catch {
          acc.lastLatencyMs = Math.round(performance.now() - start);
        }
      }));
      toast(`📶 Ping terminé : ${successCount}/${ids.length} répondent avec succès`, 'ok', 4000);
      renderGoogleAccountsList(googleAccountsCache);
      updateBatchActionBar();
    });

    // ── Power Keyboard Shortcuts: '/' for search, Alt+1..9 for fast switch ──────
    document.addEventListener('keydown', (e: KeyboardEvent) => {
      const accountsView = document.getElementById('view-google-accounts');
      if (!accountsView || accountsView.style.display === 'none' || accountsView.classList.contains('hidden')) return;

      // Focus search box with '/'
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        const sInput = $('#gaSearchInput') as HTMLInputElement | null;
        sInput?.focus();
        sInput?.select();
        return;
      }

      // Fast Switch with Alt + 1..9
      if (e.altKey && e.key >= '1' && e.key <= '9') {
        const idx = parseInt(e.key, 10) - 1;
        if (idx >= 0 && idx < googleAccountsCache.length) {
          e.preventDefault();
          const targetAcc = googleAccountsCache[idx];
          if (targetAcc && !targetAcc.isCurrent) {
            const btn = gaAccountsContainer?.querySelector<HTMLButtonElement>(`[data-id="${targetAcc.id}"] .ga-switch`);
            if (btn) btn.click();
          }
        }
      }

      // Quick Wake (r) and Quick Warmup (w)
      if (!e.altKey && !e.ctrlKey && !e.metaKey && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        if (e.key === 'r' || e.key === 'R') {
          const btn = $('#gaToolbarWakeAllBtn') as HTMLButtonElement | null;
          if (btn && !btn.disabled) btn.click();
        } else if (e.key === 'w' || e.key === 'W') {
          const btn = $('#gaToolbarWarmupBtn') as HTMLButtonElement | null;
          if (btn && !btn.disabled) btn.click();
        }
      }
    });

    setupGoogleAccountsLiveTicker();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Antigravity Verification & Captcha Resolver (Discourse Forum Analysis)
// ─────────────────────────────────────────────────────────────────────────────

interface VerificationDetectionData {
  found?: boolean;
  hasChallenge?: boolean;
  logFile?: string;
  activeLogFile?: string;
  validationUrl?: string;
  rawLogLine?: string;
  qrCodeDataUrl?: string;
  qrDataUrl?: string;
  timestamp?: string;
  accountEmail?: string;
  reason?: string;
  message?: string;
  carrierWarning?: string;
  error?: string;
}

async function showAntigravityVerificationResolutionModal(initialData?: VerificationDetectionData): Promise<void> {
  let detection = initialData;
  if (!detection && window.ag?.verification?.detect) {
    try {
      detection = await window.ag.verification.detect();
    } catch (err: any) {
      detection = { found: false, error: err?.message || String(err) };
    }
  }

  const hasChallenge = Boolean(detection?.found || detection?.hasChallenge || detection?.validationUrl);
  const validationUrl = detection?.validationUrl || '';
  const logPath = detection?.logFile || detection?.activeLogFile || 'ls-main.log';
  const activeLog = (logPath ? logPath.split(/[\\/]/).pop() : 'ls-main.log') || 'ls-main.log';
  const qrDataUrl = detection?.qrCodeDataUrl || detection?.qrDataUrl;
  const qrImageHtml = qrDataUrl
    ? `<div class="agv-qr-wrapper">
        <div class="agv-qr-box">
          <img src="${qrDataUrl}" alt="QR Code de Vérification" />
        </div>
        <div class="agv-qr-caption">
          Scannez avec votre smartphone (Appareil Android / iPhone de confiance)
        </div>
      </div>`
    : '';

  const modalHtml = `
    <div class="agv-card">
      <!-- Header Banner -->
      <div class="agv-header">
        <div class="agv-icon-badge">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            <path d="M12 8v4"/><path d="M12 16h.01"/>
          </svg>
        </div>
        <h2 class="agv-title">
          Assistant de Résolution · Vérification Antigravity
        </h2>
        <div class="agv-subtitle">
          <span class="agv-status-indicator ${hasChallenge ? 'detected' : 'clean'}"></span>
          <span>${hasChallenge ? 'Défi VALIDATION_REQUIRED (HTTP 403) Détecté dans les logs LS' : 'Scanner de Logs Antigravity & Résolution de Captcha'}</span>
        </div>
      </div>

      <!-- Detection Status Banner -->
      <div class="agv-section-box ${hasChallenge ? 'challenge-detected' : ''}">
        <div class="agv-section-header">
          <span class="agv-section-title ${hasChallenge ? 'amber' : 'muted'}">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            ${hasChallenge ? 'DÉFI INTERACTIF EXTRAIT DEPUIS LES LOGS' : 'AUCUN DÉFI ACTIF DANS LES LOGS RÉCENTS'}
          </span>
          <span class="agv-source-file">
            Source : ${escapeHtml(activeLog)}
          </span>
        </div>

        ${hasChallenge ? `
          <div class="agv-url-display" id="agvDetectedUrlDisplay">
            ${escapeHtml(validationUrl)}
          </div>
          <div class="agv-btn-grid">
            <button type="button" class="agv-btn-primary" id="agvOpenBrowserBtn">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              <span>Ouvrir dans le Navigateur</span>
            </button>
            <button type="button" class="agv-btn-secondary" id="agvCopyUrlBtn">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              <span id="agvCopyUrlLabel">Copier le Lien</span>
            </button>
          </div>
          ${qrImageHtml}
        ` : `
          <p style="margin: 0 0 10px 0; font-size: 12px; color: var(--text-1, #e4e4e7); line-height: 1.45;">
            L'IDE Antigravity n'a pas encore enregistré d'erreur <code>VALIDATION_REQUIRED</code> dans ses logs récents. Si l'IDE affiche un blocage, faites une requête de prompt dans l'IDE pour forcer l'événement ou collez l'URL Google manuellement ci-dessous.
          </p>
          <div style="display: flex; gap: 8px; margin-bottom: 6px;">
            <input type="text" class="agv-input" id="agvManualUrlInput" placeholder="https://accounts.google.com/signin/challenge/..." />
            <button type="button" class="agv-btn-secondary" id="agvOpenManualBtn" style="padding: 8px 14px; font-size: 12px; white-space: nowrap;">Ouvrir</button>
          </div>
          <button type="button" class="agv-btn-secondary" id="agvRescanBtn" style="width: 100%; margin-top: 6px; padding: 8px 12px; font-size: 12px;">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            <span id="agvRescanLabel">Scanner à nouveau les logs Antigravity</span>
          </button>
        `}
      </div>

      <!-- Critical Anti-Lockout Warnings (Forum AI Discourse Insights) -->
      <div class="agv-section-box warning-anti-lockout">
        <div class="agv-section-title red" style="margin-bottom: 6px;">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          ATTENTION : PIÈGE SMS &amp; ERREUR "USED TOO MANY TIMES"
        </div>
        <div class="agv-warning-text">
          <p>
            <strong style="color: #fca5a5;">1. Piège Numéros Courts US (244444 / 96831) :</strong> Si la page Google vous demande d'envoyer un code par SMS vers ces numéros, <strong>n'insistez pas</strong> avec un opérateur mobile hors USA. Chaque échec compte comme une tentative et verrouille irréversiblement votre numéro avec l'erreur : <em>"The device you used to scan the QR code was used too many times for verification"</em>.
          </p>
          <p>
            <strong style="color: var(--accent-blue-bright, #38bdf8);">2. Méthode Recommandée :</strong> Sur la page Google, cliquez systématiquement sur <strong>"Essayer une autre méthode" (Try another way)</strong> et choisissez <strong>"Notification Google" (Google Prompt sur smartphone)</strong> ou l'application <strong>Google Authenticator</strong>.
          </p>
          <p>
            <strong style="color: #fbbf24;">3. VPN &amp; Proxies :</strong> Désactivez tout VPN actif pendant la validation web afin d'éviter le déclenchement immédiat de protections antibot supplémentaires.
          </p>
        </div>
      </div>

      <!-- Remediation & Reset Actions -->
      <div class="agv-section-box actions-panel">
        <div class="agv-section-title muted" style="margin-bottom: 8px;">
          ACTIONS DE DÉBLOCAGE LOCAL (ONBOARDING &amp; PROCESSUS)
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px;">
          <button type="button" class="agv-btn-secondary" id="agvAgeVerifyBtn" style="font-size: 11.5px; padding: 9px 12px; border-color: #38bdf8; color: #38bdf8;">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            <span id="agvAgeVerifyLabel">Vérif. Âge Google (Selfie)</span>
          </button>
          <button type="button" class="agv-btn-secondary" id="agvPurgeCredsBtn" style="font-size: 11.5px; padding: 9px 12px;">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>
            <span id="agvPurgeCredsLabel">Purger Trousseau OS</span>
          </button>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
          <button type="button" class="agv-btn-danger" id="agvResetOnboardingBtn">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            <span id="agvResetOnboardingLabel">Purger Cache Onboarding</span>
          </button>
          <button type="button" class="agv-btn-secondary" id="agvRestartIdeBtn" style="font-size: 11.5px; padding: 9px 12px;">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            <span id="agvRestartIdeLabel">Relancer Antigravity</span>
          </button>
        </div>
        <div id="agvFeedback" class="agv-feedback"></div>
      </div>
    </div>
  `;

  void modals.confirm('Assistant de Résolution Antigravity', modalHtml, {
    confirmLabel: 'Fermer',
    hideCancel: true,
    onMount: (handle: any) => {
      const modalEl = handle.bodyEl.closest('.modal') as HTMLElement | null;
      if (modalEl) {
        modalEl.classList.add('modal-lg');
        modalEl.style.maxWidth = '620px';
        modalEl.style.maxHeight = '88vh';
        modalEl.style.display = 'flex';
        modalEl.style.flexDirection = 'column';
        modalEl.style.margin = 'auto';
      }
      if (handle.bodyEl) {
        handle.bodyEl.style.overflowY = 'auto';
        handle.bodyEl.style.maxHeight = 'calc(88vh - 120px)';
        handle.bodyEl.style.padding = '16px 20px';
      }
      handle.confirmBtn.style.width = '100%';
      handle.confirmBtn.style.padding = '10px 18px';
      handle.confirmBtn.style.fontSize = '13.5px';
      handle.confirmBtn.style.fontWeight = '600';
      handle.confirmBtn.style.borderRadius = '7px';
      handle.confirmBtn.style.background = '#2563eb';

      // Open in browser
      const openBrowserBtn = handle.bodyEl.querySelector('#agvOpenBrowserBtn');
      openBrowserBtn?.addEventListener('click', async () => {
        if (validationUrl) {
          if (window.ag?.verification?.openUrl) {
            await window.ag.verification.openUrl(validationUrl);
          } else if (window.ag?.openExternal) {
            await window.ag.openExternal(validationUrl);
          } else {
            window.open(validationUrl, '_blank');
          }
        }
      });

      // Copy validation URL
      const copyUrlBtn = handle.bodyEl.querySelector('#agvCopyUrlBtn');
      const copyUrlLabel = handle.bodyEl.querySelector('#agvCopyUrlLabel');
      copyUrlBtn?.addEventListener('click', async () => {
        if (validationUrl) {
          try {
            await navigator.clipboard.writeText(validationUrl);
            if (copyUrlLabel) copyUrlLabel.textContent = '✓ Copié !';
            toast('URL de validation copiée dans le presse-papier !', 'ok');
            setTimeout(() => {
              if (copyUrlLabel) copyUrlLabel.textContent = 'Copier le Lien';
            }, 2000);
          } catch {
            toast('Impossible de copier le lien', 'err');
          }
        }
      });

      // Open manual URL
      const openManualBtn = handle.bodyEl.querySelector('#agvOpenManualBtn');
      const manualInput = handle.bodyEl.querySelector('#agvManualUrlInput') as HTMLInputElement | null;
      openManualBtn?.addEventListener('click', async () => {
        const val = manualInput?.value.trim();
        if (!val) {
          toast('Veuillez entrer une URL valide', 'warn');
          return;
        }
        if (window.ag?.verification?.openUrl) {
          await window.ag.verification.openUrl(val);
        } else if (window.ag?.openExternal) {
          await window.ag.openExternal(val);
        } else {
          window.open(val, '_blank');
        }
      });

      // Re-scan logs with inline loading state
      const rescanBtn = handle.bodyEl.querySelector('#agvRescanBtn') as HTMLButtonElement | null;
      const rescanLabel = handle.bodyEl.querySelector('#agvRescanLabel');
      rescanBtn?.addEventListener('click', async () => {
        if (rescanBtn) rescanBtn.disabled = true;
        if (rescanLabel) rescanLabel.textContent = 'Analyse des logs en cours...';
        toast('Re-scan des logs en cours...', 'info');
        try {
          if (window.ag?.verification?.detect) {
            const fresh = await window.ag.verification.detect();
            if (fresh.found && fresh.validationUrl) {
              toast('Nouveau défi détecté !', 'ok');
              void showAntigravityVerificationResolutionModal(fresh);
            } else {
              toast('Aucun défi actif trouvé dans les logs récents', 'warn');
            }
          }
        } finally {
          if (rescanBtn) rescanBtn.disabled = false;
          if (rescanLabel) rescanLabel.textContent = 'Scanner à nouveau les logs Antigravity';
        }
      });

      // Reset Onboarding
      const resetBtn = handle.bodyEl.querySelector('#agvResetOnboardingBtn') as HTMLButtonElement | null;
      const resetLabel = handle.bodyEl.querySelector('#agvResetOnboardingLabel');
      const feedbackEl = handle.bodyEl.querySelector('#agvFeedback') as HTMLElement | null;
      resetBtn?.addEventListener('click', async () => {
        if (resetBtn) resetBtn.disabled = true;
        if (resetLabel) resetLabel.textContent = 'Purge en cours...';
        try {
          if (window.ag?.verification?.resetOnboarding) {
            const res = await window.ag.verification.resetOnboarding();
            if (res.success) {
              if (feedbackEl) {
                feedbackEl.style.display = 'block';
                feedbackEl.style.background = 'rgba(16, 185, 129, 0.15)';
                feedbackEl.style.border = '1px solid rgba(16, 185, 129, 0.35)';
                feedbackEl.style.color = '#34d399';
                feedbackEl.innerHTML = `✅ ${escapeHtml(res.message || 'Cache réinitialisé et session remise à zéro.')}`;
              }
              toast('Onboarding Antigravity purgé avec succès !', 'ok');
            } else {
              throw new Error(res.error || 'Échec de la purge');
            }
          }
        } catch (e: any) {
          if (feedbackEl) {
            feedbackEl.style.display = 'block';
            feedbackEl.style.background = 'rgba(239, 68, 68, 0.15)';
            feedbackEl.style.border = '1px solid rgba(239, 68, 68, 0.35)';
            feedbackEl.style.color = '#fca5a5';
            feedbackEl.innerHTML = `⚠️ Erreur : ${escapeHtml(e?.message || String(e))}`;
          }
          toast(`Erreur purge : ${e?.message}`, 'err');
        } finally {
          if (resetBtn) resetBtn.disabled = false;
          if (resetLabel) resetLabel.textContent = 'Purger Cache Onboarding';
        }
      });

      // Restart Antigravity
      const restartBtn = handle.bodyEl.querySelector('#agvRestartIdeBtn') as HTMLButtonElement | null;
      const restartLabel = handle.bodyEl.querySelector('#agvRestartIdeLabel');
      restartBtn?.addEventListener('click', async () => {
        if (restartBtn) restartBtn.disabled = true;
        if (restartLabel) restartLabel.textContent = 'Relance en cours...';
        try {
          const res = await window.ag.antigravityRestart();
          if (res.ok) {
            toast('Antigravity relancé avec succès !', 'ok');
          } else {
            throw new Error(res.error || 'Échec du redémarrage');
          }
        } catch (e: any) {
          toast(`Erreur redémarrage : ${e?.message}`, 'err');
        } finally {
          if (restartBtn) restartBtn.disabled = false;
          if (restartLabel) restartLabel.textContent = 'Relancer Antigravity';
        }
      });

      // Google Age Verification (Selfie)
      const ageVerifyBtn = handle.bodyEl.querySelector('#agvAgeVerifyBtn') as HTMLButtonElement | null;
      ageVerifyBtn?.addEventListener('click', async () => {
        const url = 'https://myaccount.google.com/age-verification';
        if (window.ag?.openExternal) {
          await window.ag.openExternal(url);
        } else {
          window.open(url, '_blank');
        }
        toast('Page de vérification d\'âge Google ouverte dans le navigateur', 'ok', 3000);
      });

      // Purge Credentials from OS
      const purgeCredsBtn = handle.bodyEl.querySelector('#agvPurgeCredsBtn') as HTMLButtonElement | null;
      purgeCredsBtn?.addEventListener('click', async () => {
        toast('Purge des credentials en cours…', 'info', 2000);
        try {
          await window.ag.run(['auth', 'purge', '--yes', '--json']);
          toast('Trousseau OS purgé avec succès !', 'ok', 3000);
          if (feedbackEl) {
            feedbackEl.style.display = 'block';
            feedbackEl.style.background = 'rgba(16, 185, 129, 0.15)';
            feedbackEl.style.border = '1px solid rgba(16, 185, 129, 0.35)';
            feedbackEl.style.color = '#34d399';
            feedbackEl.innerHTML = `✅ Trousseau OS purgé. Relancez maintenant la connexion dans Antigravity.`;
          }
        } catch (e: any) {
          toast(`Erreur purge trousseau : ${e?.message}`, 'err');
        }
      });
    }
  });
}

let gaLiveTickerInterval: any = null;
let gaLastReconcileTimestamp = 0;

function setupGoogleAccountsLiveTicker(): void {
  if (gaLiveTickerInterval) return;
  gaLiveTickerInterval = setInterval(() => {
    // Performance guard: only tick and mutate DOM if the Google Accounts view is active!
    const gaView = document.getElementById('view-google-accounts');
    if (!gaView || !gaView.classList.contains('active')) return;

    if (!gaAccountsContainer) return;
    const tickerElements = gaAccountsContainer.querySelectorAll<HTMLElement>('.ga-live-cd');
    if (tickerElements.length === 0) return;

    const now = Date.now();
    let hasExpiredCooldown = false;

    tickerElements.forEach((el) => {
      const untilStr = el.dataset.until;
      if (!untilStr) return;
      const until = Number(untilStr);
      if (isNaN(until)) return;
      const rem = until - now;
      if (rem <= 0) {
        if (el.textContent !== '✅ Prêt') {
          el.textContent = '✅ Prêt';
          el.style.color = '#10b981';
          el.style.borderColor = 'rgba(16, 185, 129, 0.4)';
        }
        hasExpiredCooldown = true;
      } else {
        const cdText = (typeof formatLiveCountdown === 'function') ? formatLiveCountdown(rem) : `${Math.max(1, Math.round(rem / 60000))}m`;
        const nextText = `⏳ Cooldown (${cdText})`;
        if (el.textContent !== nextText) {
          el.textContent = nextText;
        }
      }
    });

    // Auto-wake sentinel: if a cooldown has expired and >30s elapsed since last reconcile, silently reconcile without reloading whole page
    if (hasExpiredCooldown && (now - gaLastReconcileTimestamp > 30_000)) {
      gaLastReconcileTimestamp = now;
      window.ag.providers.reconcileCooldowns?.()
        .then(() => window.ag.providers.getCooldowns?.())
        .then((cdRes: any) => {
          if (cdRes && cdRes.success && cdRes.cooldowns) {
            gaActiveCooldownsCache = cdRes.cooldowns;
            renderGoogleAccountsPoolHealth(googleAccountsCache);
          }
        })
        .catch(() => {});
    }
  }, 1000);
}

function isObsoleteModelUI(idOrName?: string, displayName?: string): boolean {
  if (!idOrName && !displayName) return false;
  const str = `${idOrName || ''} ${displayName || ''}`.toLowerCase();
  if (str.includes('argon')) return false;
  if (/(?:gemini|google)[-_.\s]*(?:1\.[05]|2\.[05]|3\.[01567])/i.test(str)) return true;
  if (/\bgemini[-_\s]*(?:3(?:\.0)?(?:-pro|-flash|\b)|pro-agent)/i.test(str) && !str.includes('3.8')) return true;
  if (/\bgpt[-_\s]*(?:3\.5|4o|4|oss|3)/i.test(str) || str.startsWith('gpt-')) return true;
  if (/claude[-_\s]*3[-_\s]*5/i.test(str)) return true;
  return false;
}

function getUnifiedGoogleModelsList(): Array<{ id: string; displayName: string; enabled: boolean }> {
  const STANDARD_GOOGLE_MODELS = [
    { id: 'gemini-4-argon-medium', displayName: 'Gemini 4 Argon (Medium)', enabled: true },
    { id: 'gemini-3.8-flash-tiered', displayName: 'Gemini 3.8 Flash', enabled: true },
    { id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6 (Thinking)', enabled: true },
    { id: 'claude-opus-4-6-thinking', displayName: 'Claude Opus 4.6 (Thinking)', enabled: true },
  ];

  const masterModelMap = new Map<string, { id: string; displayName: string; enabled: boolean }>();

  for (const m of STANDARD_GOOGLE_MODELS) {
    if (!isObsoleteModelUI(m.id, m.displayName)) {
      masterModelMap.set(m.id, { ...m });
    }
  }

  for (const acc of googleAccountsCache || []) {
    if (Array.isArray(acc.models)) {
      for (const m of acc.models) {
        if (!m || !m.id) continue;
        const cleanName = (m.displayName || (m as any).name || m.id).replace(/^\[[^\]]+\]\s*/, '').replace(/^models\//, '');
        if (isObsoleteModelUI(m.id, cleanName)) continue;

        let canonicalId = m.id;
        if (canonicalId === 'gemini-3.8-flash' || canonicalId === 'models/gemini-3.8-flash') canonicalId = 'gemini-3.8-flash-tiered';

        const existing = masterModelMap.get(canonicalId);
        if (existing) {
          if (cleanName && cleanName !== canonicalId && !cleanName.includes('-tiered')) {
            existing.displayName = cleanName;
          }
        } else {
          masterModelMap.set(canonicalId, {
            id: canonicalId,
            displayName: cleanName || canonicalId,
            enabled: m.enabled !== false,
          });
        }
      }
    }
  }

  return Array.from(masterModelMap.values()).filter((m) => !isObsoleteModelUI(m.id, m.displayName));
}

function getDeduplicatedAccountModels(models?: any[]): Array<{ id: string; displayName: string; enabled: boolean; cleanName: string }> {
  if (!Array.isArray(models)) return [];
  const map = new Map<string, { id: string; displayName: string; enabled: boolean; cleanName: string }>();

  for (const m of models) {
    if (!m) continue;
    if (isObsoleteModelUI(m.id, m.displayName)) continue;
    const rawName = m.displayName || (m as any).name || m.id || '';
    const cleanName = rawName
      .replace(/^\[[^\]]+\]\s*/, '')
      .replace(/^models\//, '')
      .replace(/-tiered$/, '')
      .trim();
    if (!cleanName) continue;

    const normKey = cleanName.toLowerCase().replace(/[\s-_]+/g, '');
    const isEn = m.enabled !== false;
    const existing = map.get(normKey);
    if (!existing) {
      map.set(normKey, {
        id: m.id,
        displayName: cleanName,
        cleanName,
        enabled: isEn,
      });
    } else {
      if (isEn) existing.enabled = true;
      if (/^[A-Z]/.test(cleanName) && !/^[A-Z]/.test(existing.displayName)) {
        existing.displayName = cleanName;
        existing.cleanName = cleanName;
      }
    }
  }

  return Array.from(map.values());
}

function getAccountRecommendation(a: any): { type: 'ok' | 'warn' | 'cooldown' | 'paused' | 'info'; text: string; badge: string } {
  if (a.enabled === false) {
    return {
      type: 'paused',
      text: 'Compte en pause manuelle (exclu du pool de rotation).',
      badge: '⏸ En Pause',
    };
  }

  const isVal = isAccountValidationRequired(a);
  if (isVal) {
    return {
      type: 'warn',
      text: 'Vérification de sécurité Google requise (Challenge / Captcha). Cliquez pour débloquer.',
      badge: '🛡️ Validation Requise',
    };
  }

  const isUnlicensed = a.isUnlicensed || a.quotas?.isUnlicensed;
  const isBlocked = isUnlicensed || Boolean(a.errorDetails) || Boolean(a.quotas?.errorDetails) || (a.status === 'unhealthy' && Boolean(a.lastError?.includes('403')));
  if (isBlocked) {
    return {
      type: 'warn',
      text: a.lastError || (isUnlicensed ? 'Compte sans licence Antigravity active (HTTP 403 Subscription Required).' : 'Compte bloqué par Google (TOS / 403). Guide de déblocage disponible.'),
      badge: isUnlicensed ? '🚫 Sans Licence' : '🚫 Bloqué (403)',
    };
  }

  const cdGemini = getAccountActiveCooldown(a, 'gemini');
  const cdClaude = getAccountActiveCooldown(a, 'claude');
  const { gemini5hPct, geminiWkPct, claude5hPct, claudeWkPct } = getAccountEffectiveQuotas(a);

  // Status Unhealthy ou Quota Épuisé (Prioritaire sur les cooldowns temporaires)
  if (a.status === 'exhausted' || (geminiWkPct <= 0 && claudeWkPct <= 0) || (gemini5hPct <= 0 && claude5hPct <= 0)) {
    return {
      type: 'warn',
      text: a.lastError || 'Plafond de quota atteint (Gemini 0%, Claude 0%). Le proxy bascule automatiquement sur vos autres comptes disponibles.',
      badge: '⚠️ Cap Épuisé',
    };
  }

  // Gemini 5h épuisé
  if (gemini5hPct <= 0) {
    return {
      type: 'warn',
      text: a.lastError || `Plafond de quota 5h Gemini épuisé (0%). ${claude5hPct > 0 ? `Claude disponible (${claude5hPct}%).` : ''} Requêtes Gemini bloquées.`,
      badge: '⚠️ Cap Épuisé (Gemini)',
    };
  }

  // Real Gemini Cooldown (429/504)
  if (cdGemini) {
    const badge = cdGemini.isWeeklyCap ? '📅 Plafond Hebdo' : '⏳ Cooldown 429';
    return {
      type: 'cooldown',
      text: cdGemini.details || `En cooldown Gemini temporaire (${cdGemini.text}). Le proxy bascule automatiquement sur un compte standby.`,
      badge,
    };
  }

  // Weekly Gemini exhausted
  if (geminiWkPct <= 0) {
    return {
      type: 'warn',
      text: 'Plafond hebdomadaire Gemini atteint (0%). Requêtes Gemini bloquées.',
      badge: '⚠️ Gemini Hebdo 0%',
    };
  }

  // Gemini 5h exhausted with Claude still available
  if (gemini5hPct <= 0 && claude5hPct > 20) {
    return {
      type: 'info',
      text: `Gemini 5h épuisé (0%) mais Claude disponible (${claude5hPct}%). Recommandation : privilégier Claude Sonnet 4.6.`,
      badge: '💡 Switch Claude',
    };
  }

  // Claude Weekly Quota Cap with Gemini still available
  if ((cdClaude && cdClaude.isWeeklyCap && gemini5hPct >= 20) || (claudeWkPct <= 0 && gemini5hPct >= 20)) {
    const geminiBadge = gemini5hPct >= 95 ? '⚡ Gemini 100% Prêt' : `⚡ Gemini ${gemini5hPct}% Prêt`;
    return {
      type: 'info',
      text: `Plafond hebdo Claude atteint, mais Gemini est opérationnel (${gemini5hPct}%). Les requêtes Gemini s’exécutent normalement sans délai.`,
      badge: geminiBadge,
    };
  }

  // General or Claude Cooldown
  if (cdClaude || claudeWkPct <= 0 || claude5hPct <= 0) {
    if (gemini5hPct >= 20) {
      const geminiBadge = gemini5hPct >= 95 ? '⚡ Gemini 100% Prêt' : `⚡ Gemini ${gemini5hPct}% Prêt`;
      return {
        type: 'info',
        text: `Claude temporairement indisponible (${cdClaude ? cdClaude.text : '0%'}), mais Gemini est opérationnel (${gemini5hPct}%).`,
        badge: geminiBadge,
      };
    }
    return {
      type: 'warn',
      text: `Plafond de quota Claude atteint (${cdClaude ? cdClaude.text : '0% restant'}). Les requêtes Claude basculeront sur d'autres comptes du pool.`,
      badge: '⚠️ Plafond Claude',
    };
  }

  if (gemini5hPct <= 10 && claude5hPct <= 10) {
    return {
      type: 'warn',
      text: `Quotas critiques (Gemini ${gemini5hPct}%, Claude ${claude5hPct}%). Le proxy basculera automatiquement sur vos autres comptes disponibles.`,
      badge: '⚠️ Quota Épuisé',
    };
  }

  if (claude5hPct <= 0 && gemini5hPct > 20) {
    return {
      type: 'ok',
      text: `Claude 5h épuisé (0%) mais Gemini Flash disponible (${gemini5hPct}%). Recommandation : privilégier Gemini 3.8 Flash.`,
      badge: '💡 Switch Gemini',
    };
  }

  if (a.isCurrent) {
    if (gemini5hPct <= 10 && claude5hPct <= 10) {
      return {
        type: 'warn',
        text: `Compte Maître avec quota critique (Gemini ${gemini5hPct}%, Claude ${claude5hPct}%). Bascule automatique en cours.`,
        badge: '⚠️ Maître Épuisé',
      };
    }
    return {
      type: 'ok',
      text: 'Compte Maître IDE en production. Les requêtes interactives l’utilisent en priorité.',
      badge: '👑 Compte Maître',
    };
  }

  const healthScore = Math.min(gemini5hPct, geminiWkPct);
  if (healthScore <= 0) {
    return {
      type: 'warn',
      text: `Quota épuisé (Gemini 0%). En attente de réinitialisation.`,
      badge: '⚠️ Quota Épuisé',
    };
  }
  if (healthScore <= 15) {
    return {
      type: 'warn',
      text: `Quota critique (${healthScore}% restant). Prêt pour requêtes limitées.`,
      badge: `🟠 Santé ${healthScore}%`,
    };
  }
  if (healthScore < 100) {
    return {
      type: 'ok',
      text: `Compte disponible (${healthScore}% restant). Prêt pour les requêtes en rotation équilibrée.`,
      badge: `🟢 Santé ${healthScore}%`,
    };
  }

  return {
    type: 'ok',
    text: 'Compte sain et disponible. Prêt pour les requêtes en rotation équilibrée.',
    badge: '🟢 Santé 100%',
  };
}

async function saveGoogleAccountsBatch(accounts: any[]): Promise<void> {
  try {
    const providers = (await window.ag.providers.get()) as any[];
    const googleProv = (providers || []).find((p: any) => p && (p.id === 'provider-google' || p.provider === 'google' || p.provider === 'gemini'));
    const geminiCliProv = (providers || []).find((p: any) => p && p.provider === 'gemini-cli');

    if (googleProv && Array.isArray(googleProv.accounts)) {
      googleProv.accounts = accounts.filter((a: any) => a.provider !== 'gemini-cli' && !a.id?.startsWith('gemini-cli'));
      await window.ag.providers.save(googleProv);
      if (geminiCliProv && Array.isArray(geminiCliProv.accounts)) {
        geminiCliProv.accounts = accounts.filter((a: any) => a.provider === 'gemini-cli' || a.id?.startsWith('gemini-cli'));
        await window.ag.providers.save(geminiCliProv);
      }
    } else {
      for (const a of accounts) {
        if (a && a.id) {
          try {
            await window.ag.providers.save(a);
          } catch {}
        }
      }
    }
  } catch (e) {
    console.warn('[DoctorUI] Failed to batch save Google accounts:', e);
  }
}

async function synchronizeGoogleAccountsModels(accounts?: any[]): Promise<void> {
  const allProviders = (await window.ag.providers.get()) as any[];
  const googleProv = (allProviders || []).find((p) => p && (p.provider === 'google' || p.provider === 'gemini'));
  if (googleProv && Array.isArray(googleProv.accounts)) {
    // In consolidated architecture, models are stored once on the Google provider
    return;
  }
  const targetAccounts = accounts || googleAccountsCache;
  if (!targetAccounts || targetAccounts.length === 0) return;

  const masterModelsList = getUnifiedGoogleModelsList();

  for (const acc of targetAccounts) {
    const prevJson = JSON.stringify(acc.models || []);
    const newJson = JSON.stringify(masterModelsList);
    acc.models = JSON.parse(newJson);
    if (prevJson !== newJson && acc.id) {
      try {
        await window.ag.providers.save(acc);
      } catch {}
    }
  }
}

let gaLastQuotaRefreshTimestamp = 0;
let gaIsLoadingAccounts = false;

/** Triggers a live re-poll of all Google account quotas on the proxy side.
 *  Fire-and-forget: proxy responds 202 immediately, poll runs in background. */
async function forceProxyQuotaRefresh(): Promise<void> {
  try {
    await window.ag?.providers?.forceProxyQuotaRefresh?.();
  } catch {
    // Proxy might not be running
  }
}

async function loadGoogleAccounts(forceRefresh: boolean = false): Promise<void> {
  if (!gaAccountsContainer) return;

  // Stale-While-Revalidate: render immediately from in-memory cache without skeleton flicker
  if (googleAccountsCache && googleAccountsCache.length > 0) {
    updateGoogleAccountsTokenStats(googleAccountsCache);
    updateGoogleAccountToolbarCounts(googleAccountsCache);
    renderGoogleAccountsList(googleAccountsCache);
  } else {
    showSkeleton(gaAccountsContainer, 'cards', 2);
  }

  if (gaIsLoadingAccounts) return;
  gaIsLoadingAccounts = true;

  try {
    const allProviders = (await window.ag.providers.get()) as any[];
    const googleProv = (allProviders || []).find(
      (p) => p && (p.provider === 'google' || p.provider === 'gemini')
    );
    const geminiCliProv = (allProviders || []).find(
      (p) => p && p.provider === 'gemini-cli'
    );

    const aggregatedAccounts: any[] = [];
    if (googleProv && Array.isArray(googleProv.accounts)) {
      if (!googleProv.models || googleProv.models.length === 0) {
        googleProv.models = getUnifiedGoogleModelsList();
        await window.ag.providers.save(googleProv);
      }
      aggregatedAccounts.push(...googleProv.accounts.map((acc: any) => ({
        ...acc,
        provider: acc.provider === 'google-gemini' ? 'google-gemini' : 'google',
        apiUrl: acc.apiUrl || googleProv.apiUrl || 'https://generativelanguage.googleapis.com/v1beta',
        models: (Array.isArray(acc.models) && acc.models.length > 0) ? acc.models : (googleProv.models || []),
      })));
    }
    if (geminiCliProv && Array.isArray(geminiCliProv.accounts)) {
      aggregatedAccounts.push(...geminiCliProv.accounts.map((acc: any) => ({
        ...acc,
        provider: 'gemini-cli',
        apiUrl: acc.apiUrl || geminiCliProv.apiUrl || 'https://cloudcode-pa.googleapis.com/v1internal',
        models: (Array.isArray(acc.models) && acc.models.length > 0) ? acc.models : (geminiCliProv.models || getUnifiedGoogleModelsList()),
      })));
    }

    if (aggregatedAccounts.length > 0) {
      googleAccountsCache = aggregatedAccounts;
    } else {
      googleAccountsCache = (allProviders || []).filter(
        (p) => p.provider === 'google' || p.provider === 'gemini' || p.provider === 'gemini-cli' || (p.apiUrl && p.apiUrl.includes('googleapis.com'))
      );
    }

    // Synchronize models across all Google accounts in background
    void synchronizeGoogleAccountsModels(googleAccountsCache);

    // Immediate render: display all accounts and counters before waiting for network
    renderGoogleAccountsList(googleAccountsCache);
    updateGoogleAccountsTokenStats(googleAccountsCache);
    initGoogleAccountsToolbarOnce();
    updateGoogleAccountToolbarCounts(googleAccountsCache);

    // Refresh live quotas in background if forced, if quotas are missing, or if quotas are stale (> 3 minutes)
    const isStale = (acc: any) =>
      !acc.quotas ||
      !acc.quotas.updatedAt ||
      Date.now() - Number(acc.quotas.updatedAt) > 3 * 60 * 1000;
    const shouldFetchQuotas = forceRefresh || googleAccountsCache.some(isStale);
    if (shouldFetchQuotas) {
      gaLastQuotaRefreshTimestamp = Date.now();
      const accountsToRefresh = forceRefresh
        ? [...googleAccountsCache]
        : googleAccountsCache.filter(isStale);
      const concurrency = 3;
      const refreshTask = async () => {
        const workers = Array.from({ length: concurrency }, async () => {
          while (accountsToRefresh.length > 0) {
            const acc = accountsToRefresh.shift();
            if (!acc) break;
            try {
              const qRes = await window.ag.providers.fetchAccountQuotas(acc.apiKey || acc.refreshToken, acc.refreshToken);
              if (qRes && qRes.success && qRes.quotas) {
                acc.quotas = qRes.quotas;
                if (qRes.quotas.isUnlicensed) {
                  acc.isUnlicensed = true;
                } else {
                  delete acc.isUnlicensed;
                  if (!isAccountValidationRequired(acc) && (acc.status as string) !== 'validation_required') {
                    delete acc.errorDetails;
                  }
                }
              }
            } catch {}
          }
        });
        await Promise.all(workers);
        renderGoogleAccountsList(googleAccountsCache);
        updateGoogleAccountsTokenStats(googleAccountsCache);
        updateGoogleAccountToolbarCounts(googleAccountsCache);
        try {
          const provs = (await window.ag.providers.get()) as any[];
          const googleProv = provs?.find((p: any) => p && (p.provider === 'google' || p.provider === 'gemini'));
          if (googleProv && Array.isArray(googleProv.accounts)) {
            let hasQuotaUpdates = false;
            googleProv.accounts.forEach((existingAcc: any) => {
              const updated = aggregatedAccounts.find((a) => a.id === existingAcc.id);
              if (updated) {
                if (updated.quotas && updated.quotas !== existingAcc.quotas) {
                  existingAcc.quotas = updated.quotas;
                  hasQuotaUpdates = true;
                }
                if (updated.isUnlicensed) {
                  existingAcc.isUnlicensed = true;
                  hasQuotaUpdates = true;
                } else if (existingAcc.isUnlicensed) {
                  delete existingAcc.isUnlicensed;
                  hasQuotaUpdates = true;
                }
                if (updated.isValidationRequired || updated.status === 'validation_required') {
                  existingAcc.isValidationRequired = true;
                  existingAcc.status = 'validation_required';
                  if (updated.errorDetails) existingAcc.errorDetails = updated.errorDetails;
                } else if (!isAccountValidationRequired(existingAcc) && (existingAcc.status as string) !== 'validation_required') {
                  if (!existingAcc.isUnlicensed && existingAcc.errorDetails?.status !== 'VALIDATION_REQUIRED') {
                    delete existingAcc.errorDetails;
                  }
                }
              }
            });
            if (hasQuotaUpdates && forceRefresh) {
              await window.ag.providers.save(googleProv);
            }
          }
        } catch {}
      };
      if (forceRefresh) {
        await refreshTask();
      } else {
        void refreshTask();
      }
    }

    // Auto-clean any bracketed model display names on load
    for (const a of googleAccountsCache) {
      if (Array.isArray(a.models)) {
        let changed = false;
        a.models.forEach((m: any) => {
          if (m.displayName && /^\[[^\]]+\]\s*/.test(m.displayName)) {
            m.displayName = m.displayName.replace(/^\[[^\]]+\]\s*/, '');
            changed = true;
          }
        });
        if (changed) {
          void window.ag.providers.save(a);
        }
      }
    }

    // Fetch active cooldowns from backend quota cache
    try {
      const cdRes = await window.ag.providers.getCooldowns?.();
      if (cdRes && cdRes.success && cdRes.cooldowns) {
        gaActiveCooldownsCache = cdRes.cooldowns;
      }
    } catch {
      gaActiveCooldownsCache = {};
    }

    // Reconcile expired cooldowns: only purge entries whose cooldown duration has actually ended
    const nowCdCheck = Date.now();
    for (const [k, cdEntry] of Object.entries(gaActiveCooldownsCache)) {
      if (!cdEntry || typeof cdEntry.until !== 'number' || cdEntry.until <= nowCdCheck) {
        delete gaActiveCooldownsCache[k];
        void window.ag.providers.liftAccountCooldown?.(k);
      }
    }

    const totalAccounts = googleAccountsCache.length;
    const activeAccounts = googleAccountsCache.filter((a) => a.enabled !== false).length;
    const uniqueExposedModelIds = new Set<string>();
    googleAccountsCache.forEach((a) => {
      if (a.enabled !== false && Array.isArray(a.models)) {
        a.models.filter((m: any) => m.enabled !== false).forEach((m: any) => {
          uniqueExposedModelIds.add(m.id || m.name);
        });
      }
    });
    const totalModels = uniqueExposedModelIds.size;

    if (gaAccountCountBadge) gaAccountCountBadge.textContent = `${totalAccounts} account${totalAccounts === 1 ? '' : 's'}`;
    if (gaStatTotalAccounts) gaStatTotalAccounts.textContent = String(totalAccounts);
    if (gaStatActiveAccounts) gaStatActiveAccounts.textContent = String(activeAccounts);
    if (gaStatTotalModels) gaStatTotalModels.textContent = String(totalModels);

    updateGoogleAccountsTokenStats(googleAccountsCache);
    initGoogleAccountsToolbarOnce();
    updateGoogleAccountToolbarCounts(googleAccountsCache);
    renderGoogleAccountsList(googleAccountsCache);
  } catch (err) {
    if (!googleAccountsCache || googleAccountsCache.length === 0) {
      gaAccountsContainer.innerHTML = `<div class="empty-state"><p>Could not load Google accounts: ${escapeHtml((err as Error).message)}</p></div>`;
    }
  } finally {
    gaIsLoadingAccounts = false;
    hideSkeleton(gaAccountsContainer);
  }
}

/**
 * Dynamically renders any future or non-standard quota groups returned by Google Cloud Code
 * (e.g. Gemini 3.5 Ultra, Agentic Tasks, Search Grounding, or any unexpected quota group).
 */
function renderDynamicExtraQuotaGroups(quotas: any, showAll: boolean, isWeekly: boolean): string {
  if (!quotas || !Array.isArray(quotas.groups) || quotas.groups.length === 0) return '';
  let out = '';
  for (const g of quotas.groups) {
    const gName = (g.displayName || g.name || '').trim();
    const gLower = gName.toLowerCase();
    // Skip standard groups already handled (Gemini, Claude, Argon, Models Live Quota)
    if (gLower.includes('gemini models') || gLower.includes('claude and gpt') || gLower.includes('argon') || gLower.includes('models live quota')) {
      continue;
    }
    if ((gLower.includes('gemini') && !gLower.includes('ultra')) || gLower.includes('claude') || gLower.includes('3p') || gLower.includes('gpt')) {
      continue;
    }

    const buckets = Array.isArray(g.buckets) ? g.buckets : [];
    const icon = gLower.includes('agent') ? '🤖' : (gLower.includes('ultra') ? '💎' : (gLower.includes('search') ? '🔍' : '✨'));

    for (const b of buckets) {
      const bWin = (b.window || '').toLowerCase();
      const is5h = bWin.includes('5h') || bWin.includes('hour');
      const isWk = bWin.includes('week');
      if (!showAll) {
        if (isWeekly && !isWk) continue;
        if (!isWeekly && isWk && buckets.some((other: any) => (other.window || '').toLowerCase().includes('5h'))) continue;
      }

      const frac = typeof b.remainingFraction === 'number'
        ? b.remainingFraction
        : (typeof b.percentage === 'number' ? b.percentage / 100 : 1.0);
      const pct = Math.max(0, Math.min(100, Math.round(frac * 100)));
      const cd = b.resetTime ? formatCompactCountdown(b.resetTime) : '';
      const winLabel = is5h ? '5h' : (isWk ? 'Wk' : (b.window || ''));
      const label = `${escapeHtml(gName)} ${winLabel}`.trim();

      out += `
        <div class="ga-quota-row ga-split-segment ga-quota-row--custom" title="${escapeHtml(g.description || gName)}">
          <span class="ga-quota-name"><span class="ga-engine-icon">${icon}</span> ${label}</span>
          <div class="ga-quota-bar">
            <div class="ga-quota-fill" style="width: ${pct}%; background: ${getQuotaColor(pct)};"></div>
          </div>
          <span class="ga-quota-pct" style="color: ${getQuotaColor(pct)};">${pct}%</span>
          <span class="ga-quota-tokens">(${pct}%)</span>
          <span class="ga-quota-reset">${cd ? `⏳ ${cd}` : ''}</span>
        </div>
      `;
    }
  }
  return out;
}

function renderAccountQuotaBlock(a: any, showAll: boolean, isWeekly: boolean, isCardView = false): string {
  const isStudio = isAiStudioAccount(a);
  const isCli = isGeminiCliAccount(a);
  const quotas = a.quotas;
  const containerStyle = isCardView
    ? 'background: rgba(255,255,255,0.02); padding: 8px 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.05);'
    : '';

  if (isStudio) {
    const estStudio = getAiStudioQuotaEstimate(a);
    return `
      <div class="ga-quota-container" ${containerStyle ? `style="${containerStyle}"` : ''}>
        <div class="ga-quota-row">
          <span class="ga-quota-name" title="RPD: Requests Per Day (Quota quotidien estimé Google AI Studio)">RPD (Jour)</span>
          <div class="ga-quota-bar">
            <div class="ga-quota-fill" style="width: ${estStudio.rpdRemainingPct}%; background: ${getQuotaColor(estStudio.rpdRemainingPct)};"></div>
          </div>
          <span class="ga-quota-pct" style="color: ${getQuotaColor(estStudio.rpdRemainingPct)};">${estStudio.rpdRemainingPct}%</span>
          <span class="ga-quota-tokens" title="Tokens quotidiens estimés restants">(~${formatCompactTokens(estStudio.rpdAvailableTokens)})</span>
          <span class="ga-quota-reset" title="Réinitialisation quotidienne Google Cloud (00:00 UTC)">${estStudio.resetCountdown}</span>
        </div>
        <div class="ga-quota-row">
          <span class="ga-quota-name" title="RPM: Requests Per Minute (Plafond de débit)">RPM (Débit)</span>
          <div class="ga-quota-bar">
            <div class="ga-quota-fill" style="width: 100%; background: ${getQuotaColor(100)};"></div>
          </div>
          <span class="ga-quota-pct" style="color: ${getQuotaColor(100)};">100%</span>
          <span class="ga-quota-tokens" title="15 RPM · 1M TPM max en palier gratuit">(15 RPM · 1M TPM)</span>
          <span class="ga-quota-reset" title="Fenêtre glissante de débit">Reset 60s</span>
        </div>
      </div>
    `;
  }

  if (isCli) {
    const estCli = getGeminiCliQuotaEstimate(a);
    const liveBuckets = (quotas?.groups || []).find((g: any) => g.name === 'Models Live Quota' || g.name === 'Models')?.buckets || [];
    if (liveBuckets.length > 0) {
      return `
        <div class="ga-quota-container" ${containerStyle ? `style="${containerStyle}"` : ''}>
          ${liveBuckets.slice(0, 2).map((b: any) => `
            <div class="ga-quota-row">
              <span class="ga-quota-name" title="${escapeHtml(b.modelId)}">${escapeHtml((b.displayName || b.modelId).replace(/Gemini\s*/i, ''))}</span>
              <div class="ga-quota-bar">
                <div class="ga-quota-fill" style="width: ${b.pct}%; background: ${getQuotaColor(b.pct)};"></div>
              </div>
              <span class="ga-quota-pct" style="color: ${getQuotaColor(b.pct)};">${formatQuotaPercent(b.pct)}</span>
              <span class="ga-quota-reset">${formatCompactCountdown(b.resetTime) || '24h'}</span>
            </div>
          `).join('')}
          <div class="ga-quota-row">
            <span class="ga-quota-name" title="RPD: Requests Per Day (Quota quotidien Gemini CLI / Code Assist)">RPD</span>
            <div class="ga-quota-bar">
              <div class="ga-quota-fill" style="width: ${estCli.rpdRemainingPct}%; background: ${getQuotaColor(estCli.rpdRemainingPct)};"></div>
            </div>
            <span class="ga-quota-pct" style="color: ${getQuotaColor(estCli.rpdRemainingPct)};">${estCli.rpdRemainingPct}%</span>
            <span class="ga-quota-tokens">(~${formatCompactTokens(estCli.rpdAvailableTokens)})</span>
            <span class="ga-quota-reset">${estCli.resetCountdown}</span>
          </div>
        </div>
      `;
    }
    return `
      <div class="ga-quota-container" ${containerStyle ? `style="${containerStyle}"` : ''}>
        <div class="ga-quota-row">
          <span class="ga-quota-name" title="RPD: Requests Per Day (Quota quotidien Gemini CLI / Code Assist)">RPD (Jour)</span>
          <div class="ga-quota-bar">
            <div class="ga-quota-fill" style="width: ${estCli.rpdRemainingPct}%; background: ${getQuotaColor(estCli.rpdRemainingPct)};"></div>
          </div>
          <span class="ga-quota-pct" style="color: ${getQuotaColor(estCli.rpdRemainingPct)};">${estCli.rpdRemainingPct}%</span>
          <span class="ga-quota-tokens" title="Tokens quotidiens estimés restants">(~${formatCompactTokens(estCli.rpdAvailableTokens)})</span>
          <span class="ga-quota-reset" title="Réinitialisation quotidienne Google Cloud (00:00 UTC)">${estCli.resetCountdown}</span>
        </div>
        <div class="ga-quota-row">
          <span class="ga-quota-name" title="RPM: Requests Per Minute (Plafond de débit Gemini CLI)">RPM (Débit)</span>
          <div class="ga-quota-bar">
            <div class="ga-quota-fill" style="width: 100%; background: ${getQuotaColor(100)};"></div>
          </div>
          <span class="ga-quota-pct" style="color: ${getQuotaColor(100)};">100%</span>
          <span class="ga-quota-tokens" title="${estCli.rpmLimit} RPM · Code Assist Prod">(${estCli.rpmLimit} RPM · Code Assist)</span>
          <span class="ga-quota-reset" title="Fenêtre glissante de débit">Reset 60s</span>
        </div>
      </div>
    `;
  }

  // Antigravity Account
  if (!quotas) {
    const ageMin = gaLastQuotaRefreshTimestamp > 0 ? Math.floor((Date.now() - gaLastQuotaRefreshTimestamp) / 60_000) : null;
    const staleHint = ageMin !== null && ageMin > 5
      ? ` <span style="color: #f59e0b; font-size: 10px;" title="Données de quota potentiellement périmées — cliquez sur Actualiser tout">⚠ il y a ${ageMin} min</span>`
      : '';
    return isCardView
      ? `<div style="font-size: 11px; color: var(--text-3); font-style: italic;">Aucun quota live chargé${staleHint}</div>`
      : `<span style="color: var(--text-3); font-size: 11px;">Aucun quota live${staleHint}</span>`;
  }

  const est = estimateAccountTokens(a);
  const {
    gemini5hPct,
    geminiWkPct,
    claude5hPct,
    claudeWkPct,
    argon5hPct,
    argonWkPct,
    gemini5hReset: rawGemini5hReset,
    geminiWkReset: rawGeminiWkReset,
    claude5hReset: rawClaude5hReset,
    claudeWkReset: rawClaudeWkReset,
    argon5hReset: rawArgon5hReset,
    argonWkReset: rawArgonWkReset,
  } = getAccountEffectiveQuotas(a);

  const is5hWindowReset = (iso?: string) => {
    if (!iso) return false;
    const diff = new Date(iso).getTime() - Date.now();
    return diff > 0 && diff <= 5.5 * 3600 * 1000;
  };

  const formatCd = (raw?: string, cond = true) => {
    if (!cond || !raw) return '';
    const s = formatCompactCountdown(raw);
    return s ? `⏳ ${s}` : '';
  };

  const gemini5hReset = formatCd(rawGemini5hReset, gemini5hPct < 100 && is5hWindowReset(rawGemini5hReset));
  const geminiWkReset = formatCd(rawGeminiWkReset);
  const claude5hReset = formatCd(rawClaude5hReset, claude5hPct < 100 && is5hWindowReset(rawClaude5hReset));
  const claudeWkReset = formatCd(rawClaudeWkReset);
  const argonWkReset = formatCd(rawArgonWkReset);

  if (showAll) {
    const gemini5hToks = est.geminiAvailable5h;
    const geminiWkToks = est.geminiAvailableWeekly;
    const claude5hToks = est.claudeAvailable5h;
    const claudeWkToks = est.claudeAvailableWeekly;

    return `
      <div class="ga-quota-container" ${containerStyle ? `style="${containerStyle}"` : ''}>
        <div class="ga-quota-row">
          <span class="ga-quota-name" title="Gemini 5h rolling window (100% = 13% hebdo = 250M tokens)"><span class="ga-engine-icon ga-engine-icon--gemini">⚡</span> Gemini 5h</span>
          <div class="ga-quota-bar">
            <div class="ga-quota-fill" style="width: ${Math.min(100, Math.max(0, gemini5hPct))}%; background: ${getQuotaColor(gemini5hPct)};"></div>
          </div>
          <span class="ga-quota-pct" style="color: ${getQuotaColor(gemini5hPct)};">${gemini5hPct}%</span>
          <span class="ga-quota-tokens" title="Gemini 5h : ~${formatCompactTokens(gemini5hToks)} disponibles (${gemini5hPct}%) · ~${formatCompactTokens(est.geminiConsumed5h)} consommés (${100 - gemini5hPct}%) sur 250M max (13% hebdo)">(~${formatCompactTokens(gemini5hToks)} dispo · ${formatCompactTokens(est.geminiConsumed5h)} cons.)</span>
          <span class="ga-quota-reset" title="Réinitialisation 5h">${gemini5hReset}</span>
        </div>
        <div class="ga-quota-row">
          <span class="ga-quota-name" title="Gemini Weekly quota (~1.92B tokens max)"><span class="ga-engine-icon ga-engine-icon--gemini">⚡</span> Gemini Wk</span>
          <div class="ga-quota-bar">
            <div class="ga-quota-fill" style="width: ${Math.min(100, Math.max(0, geminiWkPct))}%; background: ${getQuotaColor(geminiWkPct)};"></div>
          </div>
          <span class="ga-quota-pct" style="color: ${getQuotaColor(geminiWkPct)};">${geminiWkPct}%</span>
          <span class="ga-quota-tokens" title="Gemini Hebdo : ~${formatCompactTokens(geminiWkToks)} disponibles (${geminiWkPct}%) · ~${formatCompactTokens(est.geminiConsumedWeekly)} consommés (${100 - geminiWkPct}%) sur ~1.92B max">(~${formatCompactTokens(geminiWkToks)} dispo · ${formatCompactTokens(est.geminiConsumedWeekly)} cons.)</span>
          <span class="ga-quota-reset" title="Réinitialisation hebdomadaire">${geminiWkReset}</span>
        </div>
        <div class="ga-quota-row">
          <span class="ga-quota-name" title="Claude/GPT 5h rolling window (100% = 50% hebdo)"><span class="ga-engine-icon ga-engine-icon--claude">🧠</span> Claude 5h</span>
          <div class="ga-quota-bar">
            <div class="ga-quota-fill" style="width: ${Math.min(100, Math.max(0, claude5hPct))}%; background: ${getQuotaColor(claude5hPct)};"></div>
          </div>
          <span class="ga-quota-pct" style="color: ${getQuotaColor(claude5hPct)};">${claude5hPct}%</span>
          <span class="ga-quota-tokens" title="Claude 5h : ~${formatCompactTokens(claude5hToks)} disponibles (${claude5hPct}%) · ~${formatCompactTokens(est.claudeConsumed5h)} consommés (${100 - claude5hPct}%) sur 10M max (50% hebdo)">(~${formatCompactTokens(claude5hToks)} dispo · ${formatCompactTokens(est.claudeConsumed5h)} cons.)</span>
          <span class="ga-quota-reset" title="Réinitialisation Claude 5h">${claude5hReset}</span>
        </div>
        <div class="ga-quota-row">
          <span class="ga-quota-name" title="Claude/GPT Weekly quota"><span class="ga-engine-icon ga-engine-icon--claude">🧠</span> Claude Wk</span>
          <div class="ga-quota-bar">
            <div class="ga-quota-fill" style="width: ${Math.min(100, Math.max(0, claudeWkPct))}%; background: ${getQuotaColor(claudeWkPct)};"></div>
          </div>
          <span class="ga-quota-pct" style="color: ${getQuotaColor(claudeWkPct)};">${claudeWkPct}%</span>
          <span class="ga-quota-tokens" title="Claude Hebdo : ~${formatCompactTokens(claudeWkToks)} disponibles (${claudeWkPct}%) · ~${formatCompactTokens(est.claudeConsumedWeekly)} consommés (${100 - claudeWkPct}%) sur 20M max">(~${formatCompactTokens(claudeWkToks)} dispo · ${formatCompactTokens(est.claudeConsumedWeekly)} cons.)</span>
          <span class="ga-quota-reset" title="Réinitialisation Claude hebdomadaire">${claudeWkReset}</span>
        </div>
        ${typeof argonWkPct === 'number' ? `
        <div class="ga-quota-row ga-quota-row--argon">
          <span class="ga-quota-name" title="Gemini 4 Argon Weekly quota (Quota indépendant Google)"><span class="ga-engine-icon ga-engine-icon--argon">🧬</span> Argon Wk</span>
          <div class="ga-quota-bar">
            <div class="ga-quota-fill ga-quota-fill--argon" style="width: ${Math.min(100, Math.max(0, argonWkPct))}%;"></div>
          </div>
          <span class="ga-quota-pct" style="color: #a5b4fc;">${argonWkPct}%</span>
          <span class="ga-quota-tokens" title="Gemini 4 Argon Hebdo : ${argonWkPct}% disponible">(~${formatCompactTokens(Math.round(est.geminiCapacityWeekly * (argonWkPct / 100)))} dispo)</span>
          <span class="ga-quota-reset" title="Réinitialisation Argon hebdomadaire">${argonWkReset}</span>
        </div>` : ''}
        ${renderDynamicExtraQuotaGroups(quotas, showAll, isWeekly)}
      </div>
    `;
  }

  // Single window (5h or weekly)
  const geminiPct = isWeekly ? geminiWkPct : gemini5hPct;
  const geminiReset = isWeekly ? geminiWkReset : gemini5hReset;
  const geminiToks = isWeekly ? est.geminiAvailableWeekly : est.geminiAvailable5h;
  const geminiConsumed = isWeekly ? est.geminiConsumedWeekly : est.geminiConsumed5h;
  const geminiCap = isWeekly ? est.geminiCapacityWeekly : est.geminiCapacity5h;

  const claudePct = isWeekly ? claudeWkPct : claude5hPct;
  const claudeReset = isWeekly ? claudeWkReset : claude5hReset;
  const claudeToks = isWeekly ? est.claudeAvailableWeekly : est.claudeAvailable5h;
  const claudeConsumed = isWeekly ? est.claudeConsumedWeekly : est.claudeConsumed5h;
  const claudeCap = isWeekly ? est.claudeCapacityWeekly : est.claudeCapacity5h;

  const isCritical5h = !isWeekly && (gemini5hPct > 0 && gemini5hPct <= 3) && (claude5hPct <= 3);

  const quotaAgeMin = gaLastQuotaRefreshTimestamp > 0 ? Math.floor((Date.now() - gaLastQuotaRefreshTimestamp) / 60_000) : null;
  const staleWarning = quotaAgeMin !== null && quotaAgeMin > 5
    ? `<div style="font-size: 10px; color: #f59e0b; margin-top: 3px;" title="Données périmées — cliquez sur Actualiser tout pour obtenir les quotas réels">⚠ Quota actualisé il y a ${quotaAgeMin} min</div>`
    : '';

  return `
    <div class="ga-quota-container ga-split-gauge" ${containerStyle ? `style="${containerStyle}"` : ''}>
      <div class="ga-quota-row ga-split-segment">
        <span class="ga-quota-name"><span class="ga-engine-icon ga-engine-icon--gemini">⚡</span> Gemini</span>
        <div class="ga-quota-bar">
          <div class="ga-quota-fill" style="width: ${Math.min(100, Math.max(0, geminiPct))}%; background: ${getQuotaColor(geminiPct)};"></div>
        </div>
        <span class="ga-quota-pct" style="color: ${getQuotaColor(geminiPct)};">${geminiPct}%</span>
        <span class="ga-quota-tokens" title="${isWeekly ? 'Gemini Hebdo' : 'Gemini 5h'} : ~${formatCompactTokens(geminiToks)} disponibles (${geminiPct}%) · ~${formatCompactTokens(geminiConsumed)} consommés (${100 - geminiPct}%) sur ${formatCompactTokens(geminiCap)} max">(~${formatCompactTokens(geminiToks)} dispo · ${formatCompactTokens(geminiConsumed)} cons.)</span>
        <span class="ga-quota-reset">${geminiReset}</span>
      </div>
      <div class="ga-quota-row ga-split-segment">
        <span class="ga-quota-name"><span class="ga-engine-icon ga-engine-icon--claude">🧠</span> Claude/GPT</span>
        <div class="ga-quota-bar">
          <div class="ga-quota-fill" style="width: ${Math.min(100, Math.max(0, claudePct))}%; background: ${getQuotaColor(claudePct)};"></div>
        </div>
        <span class="ga-quota-pct" style="color: ${getQuotaColor(claudePct)};">${claudePct}%</span>
        <span class="ga-quota-tokens" title="${isWeekly ? 'Claude/GPT Hebdo' : 'Claude/GPT 5h'} : ~${formatCompactTokens(claudeToks)} disponibles (${claudePct}%) · ~${formatCompactTokens(claudeConsumed)} consommés (${100 - claudePct}%) sur ${formatCompactTokens(claudeCap)} max">(~${formatCompactTokens(claudeToks)} dispo · ${formatCompactTokens(claudeConsumed)} cons.)</span>
        <span class="ga-quota-reset">${claudeReset}</span>
      </div>
      ${typeof argonWkPct === 'number' ? `
      <div class="ga-quota-row ga-split-segment ga-quota-row--argon">
        <span class="ga-quota-name"><span class="ga-engine-icon ga-engine-icon--argon">🧬</span> Argon</span>
        <div class="ga-quota-bar">
          <div class="ga-quota-fill ga-quota-fill--argon" style="width: ${Math.min(100, Math.max(0, argonWkPct))}%;"></div>
        </div>
        <span class="ga-quota-pct" style="color: #a5b4fc;">${argonWkPct}%</span>
        <span class="ga-quota-tokens" title="Gemini 4 Argon Hebdo : ${argonWkPct}% disponible">(${argonWkPct}%)</span>
        <span class="ga-quota-reset">${argonWkReset}</span>
      </div>` : ''}
      ${renderDynamicExtraQuotaGroups(quotas, showAll, isWeekly)}
      ${isCritical5h ? `
      <div class="ga-soft-stow-alert" title="Quota 5h critique (<3%). Recommandation : mettre en pause préventive pour éviter les 429 burst.">
        <span>⚠️ Réserve &lt;3%</span>
        <button type="button" class="ga-soft-stow-btn" data-account-id="${escapeHtml(a.id)}">Mettre au repos</button>
      </div>` : ''}
      ${staleWarning}
    </div>
  `;
}

function getTopRotationCandidate(accounts: any[], family: 'gemini' | 'claude' = 'gemini'): any | null {
  if (!accounts || accounts.length === 0) return null;
  const eligible = accounts.filter((a) => {
    if (a.enabled === false) return false;
    const isVal = isAccountValidationRequired(a);
    const isUnlicensed = a.isUnlicensed || a.quotas?.isUnlicensed;
    const isBlocked = isVal || isUnlicensed || a.errorDetails || a.quotas?.errorDetails || (a.status === 'unhealthy' && a.lastError?.includes('403'));
    if (isBlocked) return false;
    // Only check cooldown for the requested model family!
    if (getAccountActiveCooldown(a, family)) return false;
    // Check minimum effective quota
    const eff = getAccountEffectiveQuotas(a);
    if (family === 'gemini') {
      if (eff.gemini5hPct < 5 || eff.geminiWkPct <= 0) return false;
    } else {
      if (eff.claude5hPct < 5 || eff.claudeWkPct <= 0) return false;
    }
    return true;
  });
  if (eligible.length === 0) return null;

  // Score candidate: highest effective 5h quota, least recently used
  return eligible.reduce((best, curr) => {
    if (!best) return curr;
    const effBest = getAccountEffectiveQuotas(best);
    const effCurr = getAccountEffectiveQuotas(curr);
    const qBest = family === 'gemini' ? effBest.gemini5hPct : effBest.claude5hPct;
    const qCurr = family === 'gemini' ? effCurr.gemini5hPct : effCurr.claude5hPct;
    if (qCurr > qBest) return curr;
    if (qCurr === qBest) {
      const lastUsedBest = best.lastUsed || best.updatedAt || 0;
      const lastUsedCurr = curr.lastUsed || curr.updatedAt || 0;
      return lastUsedCurr < lastUsedBest ? curr : best;
    }
    return best;
  }, null);
}

function getNextExpiringCooldown(): { key: string; until: number; remainingMin: number; targetName: string } | null {
  const now = Date.now();
  let nearest: { key: string; until: number; remainingMin: number; targetName: string } | null = null;

  for (const [k, v] of Object.entries(gaActiveCooldownsCache)) {
    if (!v || v.until <= now) continue;
    if (!nearest || v.until < nearest.until) {
      const cleanK = k.replace(/^(google|gemini-cli):/, '').replace(/:(gemini|claude)$/, '');
      nearest = {
        key: k,
        until: v.until,
        remainingMin: v.remainingMin,
        targetName: cleanK,
      };
    }
  }
  return nearest;
}

function renderGoogleAccountsPoolHealth(accounts: any[]): void {
  const container = document.getElementById('gaPoolHealthBar');
  if (!container) return;
  if (!Array.isArray(accounts) || accounts.length === 0) {
    container.innerHTML = '';
    return;
  }

  const total = accounts.length;
  let geminiReady = 0;
  let claudeReady = 0;
  let geminiCooldown = 0;
  let geminiExhausted = 0;
  let claudeWeeklyCap = 0;
  let claudeCooldown = 0;
  let paused = 0;
  let validation = 0;
  let blocked = 0;

  for (const a of accounts) {
    const isVal = isAccountValidationRequired(a);
    const isUnlicensed = a.isUnlicensed || a.quotas?.isUnlicensed;
    const isBlocked = !isVal && (isUnlicensed || a.errorDetails || a.quotas?.errorDetails || (a.status === 'unhealthy' && a.lastError?.includes('403')));
    if (isVal) {
      validation++;
      continue;
    }
    if (isBlocked) {
      blocked++;
      continue;
    }
    const isEnabled = a.enabled !== false;
    if (!isEnabled) {
      paused++;
      continue;
    }
    const eff = getAccountEffectiveQuotas(a);
    const gCd = getAccountActiveCooldown(a, 'gemini');
    const cCd = getAccountActiveCooldown(a, 'claude');
    const hasCooldown = Boolean(gCd);
    const isExh = isAccountCapExhausted(a);

    if (hasCooldown) {
      geminiCooldown++;
    } else if (isExh) {
      geminiExhausted++;
    } else {
      geminiReady++;
    }

    if (cCd) {
      if (cCd.isWeeklyCap) {
        claudeWeeklyCap++;
      } else {
        claudeCooldown++;
      }
    } else if (eff.claude5hPct > 0) {
      claudeReady++;
    }
  }

  const geminiAvailPct = total > 0 ? Math.round((geminiReady / total) * 100) : 0;
  const claudeAvailPct = total > 0 ? Math.round((claudeReady / total) * 100) : 0;
  const healthColor = geminiAvailPct >= 65 ? '#10b981' : (geminiAvailPct >= 30 ? '#f59e0b' : '#ef4444');
  const claudeHealthColor = claudeAvailPct >= 65 ? '#10b981' : (claudeAvailPct >= 20 ? '#f59e0b' : '#38bdf8');
  const nextCd = getNextExpiringCooldown();
  const topCandidate = getTopRotationCandidate(accounts, 'gemini');

  // Multi-tier resilience score
  const resilience = (typeof calculatePoolResilienceScore === 'function')
    ? calculatePoolResilienceScore(accounts, gaActiveCooldownsCache)
    : { score: 100, label: 'Optimal', grade: 'optimal' as const, color: '#10b981', details: '' };

  // 4-tier routing cascade
  const fallbackChain = (typeof getPoolFallbackChain === 'function')
    ? getPoolFallbackChain(accounts, gaActiveCooldownsCache)
    : [];

  const currentBurnProfile: BurnProfile = (container as any)._burnProfile || 'normal';
  const runway = (typeof calculateBurnProjection === 'function')
    ? calculateBurnProjection(accounts, currentBurnProfile)
    : (typeof calculatePoolRunway === 'function' ? calculatePoolRunway(accounts) : { formattedRunway: '> 24h', burnState: 'healthy' as const, totalAvailableTokens: 0, totalAvailableTokens5h: 0, totalAvailableTokensWeekly: 0, hourlyBurnRate: 120000, runwayHours: 24, runwayMinutes: 0 });

  const isWeekly = gaCurrentQuotaWindow === 'weekly';
  let availToks = isWeekly
    ? (runway.totalAvailableTokensWeekly || runway.totalAvailableTokens)
    : (runway.totalAvailableTokens5h || runway.totalAvailableTokens);

  if ((!availToks || availToks <= 0) && Array.isArray(accounts)) {
    let fallbackToks = 0;
    for (const acc of accounts) {
      if (!acc || acc.enabled === false) continue;
      if (acc.isUnlicensed || acc.quotas?.isUnlicensed) continue;
      if (isAiStudioAccount(acc) || isGeminiCliAccount(acc)) continue;
      const est = estimateAccountTokens(acc);
      fallbackToks += isWeekly ? est.geminiAvailableWeekly : est.geminiAvailable5h;
    }
    if (fallbackToks > 0) availToks = fallbackToks;
  }

  const timelineItems = (typeof getUpcomingResetsTimeline === 'function')
    ? getUpcomingResetsTimeline(accounts, Date.now(), 4, gaActiveCooldownsCache)
    : [];
  const velocity = (typeof calculatePoolVelocity === 'function')
    ? calculatePoolVelocity(cachedRealStats?.sessions || [])
    : { rpm: 0, label: 'Fluide', status: 'calm' as const };
  const advice = (typeof getPoolStrategicAdvice === 'function')
    ? getPoolStrategicAdvice(accounts, gaActiveCooldownsCache)
    : { icon: '🟢', text: 'Pool opérationnel.' };

  const rawReadyPct = total > 0 ? (geminiReady / total) * 100 : 0;
  const rawExhPct = total > 0 ? (geminiExhausted / total) * 100 : 0;
  const rawCdPct = total > 0 ? (geminiCooldown / total) * 100 : 0;
  const rawValidationPct = total > 0 ? (validation / total) * 100 : 0;
  const rawBlockedPct = total > 0 ? (blocked / total) * 100 : 0;
  const rawPausedPct = total > 0 ? (paused / total) * 100 : 0;

  let readyPct = Math.floor(rawReadyPct);
  let exhPct = Math.floor(rawExhPct);
  let cdPct = Math.floor(rawCdPct);
  let validationPct = Math.floor(rawValidationPct);
  let blockedPct = Math.floor(rawBlockedPct);
  let pausedPct = Math.floor(rawPausedPct);

  const remainder = total > 0 ? 100 - (readyPct + exhPct + cdPct + validationPct + blockedPct + pausedPct) : 0;
  const diffs = [
    { key: 'ready', diff: rawReadyPct - readyPct },
    { key: 'exh', diff: rawExhPct - exhPct },
    { key: 'cd', diff: rawCdPct - cdPct },
    { key: 'validation', diff: rawValidationPct - validationPct },
    { key: 'blocked', diff: rawBlockedPct - blockedPct },
    { key: 'paused', diff: rawPausedPct - pausedPct },
  ].sort((a, b) => b.diff - a.diff);

  for (let i = 0; i < remainder; i++) {
    const target = diffs[i % diffs.length].key;
    if (target === 'ready') readyPct++;
    else if (target === 'exh') exhPct++;
    else if (target === 'cd') cdPct++;
    else if (target === 'validation') validationPct++;
    else if (target === 'blocked') blockedPct++;
    else if (target === 'paused') pausedPct++;
  }

  container.innerHTML = `
    <div class="ga-pool-kpi-bar">
      <!-- Operational Cascade Fallback Matrix & Runway Profile Switcher (No Duplicate Stats) -->
      <div class="ga-pool-kpi-stats" style="width: 100%; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
        ${fallbackChain.length > 0 ? `
        <div class="ga-cascade-matrix-wrapper" style="margin: 0; width: auto; flex: 1; min-width: 260px;">
          <div class="ga-cascade-matrix-title">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
            Cascade Fallback :
          </div>
          <div class="ga-cascade-chain">
            ${fallbackChain.map((step, idx) => `
              <div class="ga-cascade-step ga-cascade-step--${step.status}" title="Niveau ${step.tier}: ${escapeHtml(step.name)} (${step.badgeText})">
                <span class="ga-cascade-icon">${step.icon}</span>
                <span class="ga-cascade-name">${escapeHtml(step.name)}</span>
                <span class="ga-cascade-pill ${step.status}">${escapeHtml(step.badgeText)}</span>
              </div>
              ${idx < fallbackChain.length - 1 ? '<span class="ga-cascade-connector">➔</span>' : ''}
            `).join('')}
          </div>
        </div>
        ` : '<div></div>'}

        <!-- Smart Runway Profile & Projection (Option B) -->
        <div class="ga-runway-container">
          <div class="ga-runway-badge ga-runway-badge--${runway.burnState}" title="Autonomie estimée du pool selon la cadence sélectionnée">
            <span>🔋 Autonomie :</span>
            <span class="ga-runway-val">${runway.formattedRunway}</span>
            <span class="ga-runway-tokens">(~${formatCompactTokens(availToks)} dispo)</span>
          </div>
          <div class="ga-burn-profile-selector" title="Cadence de burn runway">
            <button type="button" class="ga-burn-profile-btn ${currentBurnProfile === 'eco' ? 'active' : ''}" data-profile="eco" title="Mode Éco (60k tokens/h)">Éco</button>
            <button type="button" class="ga-burn-profile-btn ${currentBurnProfile === 'normal' ? 'active' : ''}" data-profile="normal" title="Mode Normal (120k tokens/h)">Norm</button>
            <button type="button" class="ga-burn-profile-btn ${currentBurnProfile === 'burst' ? 'active' : ''}" data-profile="burst" title="Mode Burst (250k tokens/h)">Burst</button>
          </div>
        </div>
      </div>

      <!-- Fleet Proportion Bar (Miller's Law Chunking) -->
      <div class="ga-health-bar-section">
        <div class="ga-health-proportion-bar" title="${geminiReady} prêts (${readyPct}%), ${geminiExhausted} quota épuisé (${exhPct}%), ${geminiCooldown} cooldown (${cdPct}%), ${paused} en pause (${pausedPct}%), ${validation} validation (${validationPct}%), ${blocked} erreurs (${blockedPct}%)">
          <div class="ga-health-seg ready" style="width: ${readyPct}%;"></div>
          <div class="ga-health-seg exhausted" style="width: ${exhPct}%;"></div>
          <div class="ga-health-seg cooldown" style="width: ${cdPct}%;"></div>
          <div class="ga-health-seg paused" style="width: ${pausedPct}%;"></div>
          <div class="ga-health-seg validation" style="width: ${validationPct}%;"></div>
          <div class="ga-health-seg blocked" style="width: ${blockedPct}%;"></div>
        </div>
        <div class="ga-health-legend">
          <span class="ga-health-legend-item"><span class="ga-health-legend-dot" style="background: #10b981;"></span> <strong>${geminiReady}</strong> Prêts (${readyPct}%)</span>
          ${geminiExhausted > 0 ? `<span class="ga-health-legend-item"><span class="ga-health-legend-dot" style="background: #f59e0b;"></span> <strong>${geminiExhausted}</strong> Cap Épuisé (${exhPct}%)</span>` : ''}
          ${geminiCooldown > 0 ? `<span class="ga-health-legend-item"><span class="ga-health-legend-dot" style="background: #ef4444;"></span> <strong>${geminiCooldown}</strong> Cooldown 429 (${cdPct}%)</span>` : ''}
          ${paused > 0 ? `<span class="ga-health-legend-item"><span class="ga-health-legend-dot" style="background: #64748b;"></span> <strong>${paused}</strong> En Pause (${pausedPct}%)</span>` : ''}
          ${validation > 0 ? `<span class="ga-health-legend-item"><span class="ga-health-legend-dot" style="background: #fbbf24;"></span> <strong>${validation}</strong> Validation Requise (${validationPct}%)</span>` : ''}
          ${blocked > 0 ? `<span class="ga-health-legend-item"><span class="ga-health-legend-dot" style="background: #dc2626;"></span> <strong>${blocked}</strong> Erreurs & TOS (${blockedPct}%)</span>` : ''}
          ${claudeWeeklyCap > 0 ? `<span class="ga-health-legend-item" style="color: var(--text-3); font-size: 11px;">(${claudeWeeklyCap} comptes avec plafond Claude redirigés sur Gemini)</span>` : ''}
        </div>
      </div>

      <!-- Timeline Frise of Upcoming Resets (Option B - Temporal Transparency) -->
      ${timelineItems && timelineItems.length > 0 ? `
      <div class="ga-timeline-wrapper">
        <div class="ga-timeline-title">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          Prochains déblocages & renouvellements (5h) :
        </div>
        <div class="ga-timeline-items">
          ${timelineItems.map((item) => `
            <div class="ga-timeline-item ${item.type === '5h' ? 'five-h' : item.type}" title="${escapeHtml(item.accountName)} · Déblocage ${item.type === 'cooldown' ? 'Cooldown 429' : (item.type === '5h' ? 'Fenêtre 5h' : 'Quota Hebdomadaire')} dans ${item.formattedCountdown}">
              <span>${item.type === 'cooldown' ? '❄️ 429' : (item.type === '5h' ? '⚡ 5h' : '📅 Hebdo')}</span>
              <span>${escapeHtml(item.accountName)}</span>
              <strong>${item.formattedCountdown}</strong>
            </div>
          `).join('')}
        </div>
      </div>
      ` : ''}

      <!-- Contextual Strategic Advice (Shown only when actionable) -->
      ${advice && advice.text ? `
      <div class="ga-advice-bar">
        <div class="ga-advice-content">
          <span class="ga-advice-icon">${advice.icon}</span>
          <span class="ga-advice-text">${escapeHtml(advice.text)}</span>
        </div>
        ${advice.actionLabel ? `
          <button type="button" class="ga-advice-action-btn" data-action="${advice.actionType}">
            ${escapeHtml(advice.actionLabel)}
          </button>
        ` : ''}
      </div>
      ` : ''}
    </div>
  `;

  // Attach event listeners for Burn Profile Selector (Doherty <400ms instant local redraw)
  const profileBtns = container.querySelectorAll('.ga-burn-profile-btn');
  profileBtns.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const prof = (btn as HTMLElement).dataset.profile as BurnProfile;
      if (prof) {
        (container as any)._burnProfile = prof;
        renderGoogleAccountsPoolHealth(accounts);
      }
    });
  });

  const adviceBtn = container.querySelector('.ga-advice-action-btn') as HTMLButtonElement | null;
  if (adviceBtn) {
    adviceBtn.addEventListener('click', async () => {
      const act = adviceBtn.dataset.action;
      if (act === 'wake') {
        const wakeBtn = document.getElementById('gaToolbarWakeAllBtn') as HTMLButtonElement | null;
        if (wakeBtn) wakeBtn.click();
      } else if (act === 'soft-stow') {
        let stowed = 0;
        for (const a of accounts) {
          if (a.enabled === false) continue;
          const q = a.quotas || {};
          const gPct = q.geminiFiveHourPct ?? q.fiveHourPercentage ?? 100;
          const cPct = q.claudeFiveHourPct ?? 100;
          if (gPct <= 3 && cPct <= 3) {
            a.enabled = false;
            stowed++;
          }
        }
        if (stowed > 0) {
          await saveGoogleAccountsBatch(googleAccountsCache);
          toast(`⏸ ${stowed} compte(s) avec quota <3% mis au repos préventif.`, 'ok', 3500);
          await loadGoogleAccounts();
        } else {
          toast('Aucun compte avec quota <3% détecté.', 'info');
        }
      } else if (act === 'switch-gemini') {
        toast('💡 Modèle Gemini 3.8 Flash recommandé pour préserver les quotas Claude.', 'info', 4000);
      }
    });
  }
}

function renderGoogleAccountsList(accounts: any[]): void {
  renderGoogleAccountsPoolHealth(accounts);
  if (!gaAccountsContainer) return;
  if (!accounts || accounts.length === 0) {
    gaAccountsContainer.innerHTML = `
      <div class="agy-empty-state" style="padding: 40px 20px; text-align: center;">
        <div class="agy-empty-icon" style="margin-bottom: 12px; opacity: 0.7;">
          <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/><circle cx="12" cy="12" r="2"/></svg>
        </div>
        <div class="agy-empty-title" style="font-size: 16px; font-weight: 600; margin-bottom: 6px;">No Google Accounts Added</div>
        <div class="agy-empty-text" style="color: var(--text-2); font-size: 13px; max-width: 440px; margin: 0 auto 16px;">
          Add your Google accounts or click "Importer depuis IDE" to automatically detect the account already connected to Antigravity without manual configuration.
        </div>
        <div style="display: flex; justify-content: center; gap: 10px; flex-wrap: wrap;">
          <button class="btn btn-primary" type="button" id="gaEmptyOAuthBtn" style="background: #1a73e8; color: #fff; border: 1px solid rgba(66, 133, 244, 0.5); display: inline-flex; align-items: center; gap: 7px; font-weight: 500;">
            <svg viewBox="0 0 24 24" width="14" height="14"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/></svg>
            Login Antigravity
          </button>
          <button class="btn btn-secondary" type="button" id="gaEmptyGeminiCliBtn" style="background: rgba(147, 51, 234, 0.18); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.45); display: inline-flex; align-items: center; gap: 7px; font-weight: 500;">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
            Login Gemini CLI
          </button>
          <button class="btn btn-secondary" type="button" id="gaEmptyDiscoverBtn" style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3);">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Importer depuis IDE
          </button>
          <button class="btn btn-ghost" type="button" id="gaEmptyAddBtn">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            + Google AI Studio
          </button>
        </div>
      </div>
    `;
    $('#gaEmptyOAuthBtn')?.addEventListener('click', () => triggerGoogleOAuthLogin('antigravity'));
    $('#gaEmptyGeminiCliBtn')?.addEventListener('click', () => triggerGoogleOAuthLogin('gemini-cli'));
    $('#gaEmptyAddBtn')?.addEventListener('click', () => openGoogleAccountModal(undefined, 'google-gemini'));
    $('#gaEmptyDiscoverBtn')?.addEventListener('click', () => triggerIdeAccountDiscovery());
    return;
  }

  // Filter by search query & operational status / tier filter
  const filtered = accounts.filter((a) => {
    const isEnabled = a.enabled !== false;
    const isVal = isAccountValidationRequired(a);
    const isUnlicensed = a.isUnlicensed || a.quotas?.isUnlicensed;
    const cdGemini = getAccountActiveCooldown(a, 'gemini');
    const cdClaude = getAccountActiveCooldown(a, 'claude');
    const tier = getAccountTier(a).toLowerCase();

    const isBlocked = !isVal && (isUnlicensed || a.errorDetails || a.quotas?.errorDetails || (a.status === 'unhealthy' && a.lastError?.includes('403')));
    const hasActiveCooldown = Boolean(cdGemini);
    const isExh = isAccountCapExhausted(a);

    if (gaCurrentFilter === 'status:ready') {
      if (!isEnabled || isBlocked || isVal || hasActiveCooldown || isExh) return false;
    } else if (gaCurrentFilter === 'status:exhausted') {
      if (isVal || isBlocked || !isEnabled || hasActiveCooldown || !isExh) return false;
    } else if (gaCurrentFilter === 'status:cooldown') {
      if (isVal || isBlocked || !isEnabled || !hasActiveCooldown) return false;
    } else if (gaCurrentFilter === 'status:paused') {
      if (isVal || isBlocked || isEnabled) return false;
    } else if (gaCurrentFilter === 'status:blocked') {
      if (isVal || !isBlocked) return false;
    } else if (gaCurrentFilter === 'status:validation') {
      if (!isVal) return false;
    } else if (gaCurrentFilter !== 'all' && tier !== gaCurrentFilter) {
      return false;
    }

    if (gaSearchQuery) {
      const name = (a.name || '').toLowerCase();
      const email = (a.email || '').toLowerCase();
      const id = (a.id || '').toLowerCase();
      if (!name.includes(gaSearchQuery) && !email.includes(gaSearchQuery) && !id.includes(gaSearchQuery)) {
        return false;
      }
    }
    return true;
  });

  if (filtered.length === 0) {
    gaAccountsContainer.innerHTML = `
      <div style="padding: 32px 16px; text-align: center; color: var(--text-2); font-size: 13px;">
        Aucun compte Google ne correspond aux filtres ou aux critères de recherche actuels.
      </div>
    `;
    return;
  }

  // Column sorting
  if (gaSortColumn) {
    filtered.sort((a, b) => {
      let cmp = 0;
      if (gaSortColumn === 'name') {
        const nameA = (a.email || a.name || a.id || '').toLowerCase();
        const nameB = (b.email || b.name || b.id || '').toLowerCase();
        cmp = nameA.localeCompare(nameB);
      } else if (gaSortColumn === 'quota') {
        const effA = getAccountEffectiveQuotas(a);
        const effB = getAccountEffectiveQuotas(b);
        const isWk = gaCurrentQuotaWindow === 'weekly';
        const qA = isWk ? (effA.geminiWkPct * 10 + effA.claudeWkPct) : (effA.gemini5hPct * 10 + effA.claude5hPct);
        const qB = isWk ? (effB.geminiWkPct * 10 + effB.claudeWkPct) : (effB.gemini5hPct * 10 + effB.claude5hPct);
        cmp = qA - qB;
      } else if (gaSortColumn === 'lastUsed') {
        const timeA = a.lastUsed || a.updatedAt ? new Date(a.lastUsed || a.updatedAt).getTime() : 0;
        const timeB = b.lastUsed || b.updatedAt ? new Date(b.lastUsed || b.updatedAt).getTime() : 0;
        cmp = (isNaN(timeA) ? 0 : timeA) - (isNaN(timeB) ? 0 : timeB);
      }
      return gaSortDirection === 'desc' ? -cmp : cmp;
    });
  }

  const isWeekly = gaCurrentQuotaWindow === 'weekly';
  const quotaHeaderLabel = gaShowAllQuotas ? 'ALL QUOTAS (5H & WEEKLY)' : (isWeekly ? 'WEEKLY QUOTA' : '5H QUOTA');
  const topCandidate = getTopRotationCandidate(accounts);

  let html = '';
  if (gaCurrentViewMode === 'list') {
    html += `
      <div class="ga-table-wrapper">
        <table class="ga-table">
          <thead>
            <tr>
              <th style="width: 32px; text-align: center;">
                <input type="checkbox" id="gaMasterCheckbox" aria-label="Select all accounts" ${filtered.length > 0 && filtered.every((a) => gaSelectedIds.has(a.id)) ? 'checked' : ''} style="cursor: pointer;" />
              </th>
              <th class="ga-sortable-th ${gaSortColumn === 'name' ? `is-sorted ${gaSortDirection}` : ''}" data-sort="name" style="min-width: 220px;" title="Cliquer pour trier par Compte / Email">
                <div style="display: inline-flex; align-items: center; gap: 6px;">
                  <span>EMAIL / ACCOUNT</span>
                  <span class="ga-sort-icon">${gaSortColumn === 'name' ? (gaSortDirection === 'asc' ? '▲' : '▼') : '↕'}</span>
                </div>
              </th>
              <th class="ga-sortable-th ${gaSortColumn === 'quota' ? `is-sorted ${gaSortDirection}` : ''}" data-sort="quota" style="min-width: 420px;" title="Cliquer pour trier par Quota restant">
                <div style="display: inline-flex; align-items: center; gap: 6px;">
                  <span>${quotaHeaderLabel}</span>
                  <span class="ga-sort-icon">${gaSortColumn === 'quota' ? (gaSortDirection === 'asc' ? '▲' : '▼') : '↕'}</span>
                </div>
              </th>
              <th class="ga-sortable-th ${gaSortColumn === 'lastUsed' ? `is-sorted ${gaSortDirection}` : ''}" data-sort="lastUsed" style="width: 170px;" title="Cliquer pour trier par Dernière utilisation">
                <div style="display: inline-flex; align-items: center; gap: 6px;">
                  <span>LAST USED</span>
                  <span class="ga-sort-icon">${gaSortColumn === 'lastUsed' ? (gaSortDirection === 'asc' ? '▲' : '▼') : '↕'}</span>
                </div>
              </th>
              <th style="width: 170px; text-align: right;">ACTIONS</th>
            </tr>
          </thead>
          <tbody>
    `;

    for (const a of filtered) {
      const isStudio = isAiStudioAccount(a);
      const isCli = isGeminiCliAccount(a);
      const tier = getAccountTier(a);
      const tierIcon = isStudio ? '⚡' : (isCli ? '🖥️' : (tier === 'PARTAGE' ? '👥' : (tier === 'ULTRA' ? '💎' : (tier === 'PRO' ? '◆' : '⬡'))));
      const quotas = a.quotas;
      const isSelected = gaSelectedIds.has(a.id);
      const isCurrent = Boolean(a.isCurrent);
      const isTarget = Boolean(topCandidate && topCandidate.id === a.id);

      const cdGemini = getAccountActiveCooldown(a, 'gemini');
      const cdClaude = getAccountActiveCooldown(a, 'claude');
      const cdInfo = cdGemini || cdClaude;
      const isEnabled = a.enabled !== false;
      const recom = getAccountRecommendation(a);
      const dedupModels = getDeduplicatedAccountModels(a.models);

      let statusBadgeHtml = '';
      const isVal = isAccountValidationRequired(a);
      const isUnlicensed = a.isUnlicensed || a.quotas?.isUnlicensed;
      const isBlocked = !isVal && (isUnlicensed || Boolean(a.errorDetails) || Boolean(a.quotas?.errorDetails) || (a.status === 'unhealthy' && Boolean(a.lastError?.includes('403'))));
      if (!isEnabled) {
        statusBadgeHtml = `<span class="ga-badge ga-badge-paused" style="background: rgba(148, 163, 184, 0.14); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.25);" title="Compte mis en pause (temporairement exclu de la rotation)">⏸ PAUSE</span>`;
      } else if (isVal) {
        statusBadgeHtml = `<button type="button" class="ga-badge ga-error-details-badge" data-id="${escapeHtml(a.id)}" style="cursor: pointer; background: rgba(245, 158, 11, 0.18); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.4); font-weight: 600; font-size: 10px; padding: 2px 7px; border-radius: 5px; display: inline-flex; align-items: center; gap: 4px;" title="Validation Google requise (Challenge 403). Cliquez pour ouvrir l'Assistant Interactif en 4 étapes.">🟠 Validation Requise</button>`;
      } else if (isUnlicensed) {
        statusBadgeHtml = `<span class="ga-badge ga-badge-warn" style="background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3);" title="Compte sans licence Antigravity active (HTTP 403 Subscription Required)">🚫 SANS LICENCE</span>`;
      } else if (quotas && (quotas.geminiFiveHourPct === 0 || quotas.fiveHourPercentage === 0) && (quotas.claudeFiveHourPct === 0)) {
        statusBadgeHtml = `<span class="ga-badge ga-badge-warn" style="background: rgba(239, 68, 68, 0.18); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.4);" title="Plafond de quota épuisé (Gemini 0%, Claude 0%)">⚠️ Cap Épuisé</span>`;
      } else if (quotas && (quotas.geminiFiveHourPct === 0 || quotas.fiveHourPercentage === 0)) {
        statusBadgeHtml = `<span class="ga-badge ga-badge-warn" style="background: rgba(239, 68, 68, 0.18); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.4);" title="Plafond de quota 5h Gemini épuisé (0%)">⚠️ Cap Épuisé (Gemini)</span>`;
      } else if (cdGemini) {
        statusBadgeHtml = `<span class="ga-badge ga-badge-warn ga-live-cd" data-until="${cdGemini.until}" data-account-id="${escapeHtml(a.id)}" style="background: rgba(245, 158, 11, 0.18); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.4);" title="${escapeHtml(cdGemini.details)}">${escapeHtml(cdGemini.text)}</span>`;
      } else if (cdClaude && cdClaude.isWeeklyCap) {
        if (!isTarget) {
          statusBadgeHtml = `<span class="ga-badge" style="background: rgba(56, 189, 248, 0.12); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.25); font-size: 10px;" title="${escapeHtml(recom.text)}">${escapeHtml(recom.badge || '⚡ Gemini 100% Prêt')}</span>`;
        }
      } else if (cdClaude) {
        statusBadgeHtml = `<span class="ga-badge ga-badge-dormant" style="font-size: 10px;" title="${escapeHtml(recom.text)}">${escapeHtml(recom.badge || '⚠️ Plafond Claude')}</span>`;
      } else if (recom && recom.badge && recom.badge !== '⏳ Cooldown 429') {
        const isQuotaExhausted = recom.badge.includes('Quota Épuisé') || recom.badge.includes('Hebdo 0%');
        if (isQuotaExhausted) {
          statusBadgeHtml = `<span class="ga-badge ga-badge-dormant" style="font-size: 10px;" title="${escapeHtml(recom.text)}">${escapeHtml(recom.badge)}</span>`;
        } else if (!isTarget || !recom.badge.includes('100%')) {
          const badgeColor = recom.type === 'warn'
            ? 'background: rgba(245, 158, 11, 0.12); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.25);'
            : (recom.type === 'info'
              ? 'background: rgba(56, 189, 248, 0.12); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.25);'
              : '');
          statusBadgeHtml = `<span class="ga-badge" style="font-size: 10px; opacity: 0.9; ${badgeColor}" title="${escapeHtml(recom.text)}">${escapeHtml(recom.badge)}</span>`;
        }
      }

      let unifiedRoleBadgeHtml = '';
      if (isStudio) {
        unifiedRoleBadgeHtml = `<span class="pool-role-badge pool-role-badge--studio" title="Google AI Studio Developer API Key">● Active Studio</span>`;
      } else if (isCli) {
        unifiedRoleBadgeHtml = `<span class="pool-role-badge pool-role-badge--cli" title="Gemini CLI Account (Code Assist Prod, separate quota)">● Active CLI</span>`;
      } else if (isCurrent) {
        const effCurrent = getAccountEffectiveQuotas(a);
        if (effCurrent.gemini5hPct <= 0 && effCurrent.claude5hPct <= 0) {
          unifiedRoleBadgeHtml = `<span class="ga-badge ga-badge-warn" style="background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.35);" title="Compte principal Antigravity (quotas 5h épuisés)">⚠️ PRINCIPAL (Cap Épuisé)</span>`;
        } else if (effCurrent.gemini5hPct <= 0) {
          unifiedRoleBadgeHtml = `<span class="ga-badge ga-badge-warn" style="background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.35);" title="Compte principal Antigravity (quota Gemini 5h épuisé)">⚠️ PRINCIPAL (Cap Épuisé)</span>`;
        } else if (cdInfo) {
          unifiedRoleBadgeHtml = `<span class="ga-badge ga-badge-warn" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.35);" title="Compte principal Antigravity (actuellement en cooldown)">● PRINCIPAL (Cooldown)</span>`;
        } else if (isBlocked) {
          unifiedRoleBadgeHtml = `<span class="ga-badge ga-badge-warn" style="background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.35);" title="Compte principal Antigravity (bloqué / 403)">⚠️ PRINCIPAL (Bloqué)</span>`;
        } else if (!isEnabled) {
          unifiedRoleBadgeHtml = `<span class="ga-badge ga-badge-paused" style="background: rgba(148, 163, 184, 0.15); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.3);" title="Compte principal Antigravity (mis en pause)">⏸ PRINCIPAL (Pause)</span>`;
        } else if (isTarget) {
          unifiedRoleBadgeHtml = `<span class="ga-badge ga-badge-current ga-led-active" title="Compte principal actif & classé #1 en rotation P2C">● EN LIGNE (P2C #1)</span>`;
        } else {
          unifiedRoleBadgeHtml = `<span class="ga-badge ga-badge-current ga-led-active" title="Compte principal actif pour Antigravity">● EN LIGNE</span>`;
        }
      } else if (isTarget) {
        unifiedRoleBadgeHtml = `<span class="ga-badge ga-target-badge" title="Compte actuellement classé #1 en rotation pour la prochaine requête entrante">🎯 PROCHAIN P2C</span>`;
      }

      html += `
        <tr class="${isCurrent ? 'is-current' : ''} ${isTarget ? 'is-target' : ''} ${!isEnabled ? 'is-disabled' : ''}" data-id="${escapeHtml(a.id)}" style="${!isEnabled ? 'opacity: 0.65; background: rgba(0,0,0,0.15);' : ''}">
          <td style="text-align: center;">
            <input type="checkbox" class="ga-row-cb" data-id="${escapeHtml(a.id)}" aria-label="Select account ${escapeHtml(a.name || a.email)}" ${isSelected ? 'checked' : ''} style="cursor: pointer;" />
          </td>
          <td>
            <div style="display: flex; align-items: center; gap: 8px;">
              ${a.picture
                ? `<img src="${escapeHtml(a.picture)}" style="width: 24px; height: 24px; border-radius: 50%; object-fit: cover; flex-shrink: 0;" alt="Avatar" />`
                : isStudio
                  ? `<div style="width: 24px; height: 24px; border-radius: 50%; background: rgba(16, 185, 129, 0.18); color: #10b981; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 11px; flex-shrink: 0;" title="Clé API Développeur Google AI Studio">✦</div>`
                  : isCli
                    ? `<div style="width: 24px; height: 24px; border-radius: 50%; background: rgba(168, 85, 247, 0.18); color: #c084fc; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 10px; flex-shrink: 0;" title="Compte Gemini CLI">CLI</div>`
                    : `<div style="width: 24px; height: 24px; border-radius: 50%; background: rgba(59, 130, 246, 0.15); color: #3b82f6; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 11px; flex-shrink: 0;">G</div>`
              }
              <div style="min-width: 0;">
                <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                  <span style="font-weight: 600; font-size: 12.5px; color: var(--text-0);">${escapeHtml(a.email || (isStudio ? (a.name || 'Google AI Studio Key') : (a.name === 'google' ? 'Google API Key (Default)' : (a.name || a.id))))}</span>
                  ${unifiedRoleBadgeHtml}
                  ${statusBadgeHtml}
                  ${typeof a.lastLatencyMs === 'number' ? `<span class="ga-badge" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); font-family: var(--font-mono); font-size: 10px;" title="Dernière latence mesurée">⚡ ${a.lastLatencyMs}ms</span>` : ''}
                  <span class="ga-badge ga-badge-${tier.toLowerCase()} ga-tier-badge" data-id="${escapeHtml(a.id)}" style="cursor: pointer;" title="Cliquer pour basculer (FREE ↔ PRO)">${tierIcon} ${tier}</span>
                  ${(a.quotas?.creditAmount || a.creditAmount) ? `<span class="ga-badge ga-badge-credits">🪙 ${a.quotas?.creditAmount || a.creditAmount} credits</span>` : ''}
                  ${(a.isUnlicensed || a.errorDetails || a.quotas?.errorDetails || (a.status === 'unhealthy' && a.lastError?.includes('403'))) ? (
                    isAccountValidationRequired(a)
                      ? `<button type="button" class="ga-badge ga-error-details-badge" data-id="${escapeHtml(a.id)}" style="cursor: pointer; background: rgba(245, 158, 11, 0.18); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.4); font-weight: 600; font-size: 10px; padding: 2px 7px; border-radius: 5px; display: inline-flex; align-items: center; gap: 4px;" title="Validation Google requise (HTTP 403 Challenge). Cliquez pour voir le protocole en 4 étapes.">🟠 Validation Requise</button>`
                      : `<button type="button" class="ga-badge ga-error-details-badge ga-badge-unlicensed" data-id="${escapeHtml(a.id)}" style="cursor: pointer;" title="Compte sans licence active Antigravity (HTTP 403). Cliquez pour voir le diagnostic et les solutions (Quick Fix).">🚫 Compte sans licence</button>`
                  ) : ''}
                </div>
                ${a.email && a.name && a.email !== a.name
                  ? `<div style="font-size: 11px; color: var(--text-4);">${escapeHtml(a.name)}</div>`
                  : (isStudio
                    ? `<div style="font-size: 11px; color: #10b981;">Google AI Studio · API Key (${escapeHtml(maskKeyPreview(a.apiKey))})</div>`
                    : (!a.email ? `<div style="font-size: 11px; color: var(--text-4); font-style: italic;">Provider Configuration</div>` : ''))}
                <div style="display: flex; align-items: center; gap: 6px; margin-top: 4px;">
                  <span class="ga-models-pill" style="font-size: 9.5px; padding: 1.5px 6px; border-radius: 4px; background: rgba(59, 130, 246, 0.08); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.2); font-family: var(--font-mono);" title="${dedupModels.map((m) => m.displayName).join(', ')}">🤖 ${dedupModels.length} modèle${dedupModels.length > 1 ? 's' : ''}</span>
                </div>
              </div>
            </div>
          </td>
          <td>
            ${renderAccountQuotaBlock(a, gaShowAllQuotas, isWeekly, false)}
          </td>
          <td style="color: var(--text-2); font-size: 11.5px;">
            ${formatLastUsed(a.lastUsed || a.updatedAt)}
          </td>
          <td style="text-align: right;">
            <div class="ga-row-actions-group">
              <button type="button" class="ga-action-btn ga-switch ${isCurrent ? 'active-switch' : ''}" title="${isCurrent ? 'Compte actif principal' : 'Activer ce compte (1-clic)'}" aria-label="Switch to ${escapeHtml(a.name || a.email)}">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>
              </button>
              <button type="button" class="ga-action-btn ga-refresh" title="Rafraîchir les quotas de ce compte" aria-label="Refresh quotas for ${escapeHtml(a.name || a.email)}">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
              </button>
              ${hasAccountErrorOrValidation(a) ? `
              <button type="button" class="ga-action-btn ga-error-details-btn" data-id="${escapeHtml(a.id)}" title="${isAccountValidationRequired(a) ? 'Assistant Déblocage (Protocole 4 Étapes)' : 'Diagnostic Erreur (TOS / 403) & Solutions Quick Fix'}" aria-label="Error details for ${escapeHtml(a.name || a.email)}" style="${isAccountValidationRequired(a) ? 'color: #fbbf24; border-color: rgba(245, 158, 11, 0.45); background: rgba(245, 158, 11, 0.1);' : 'color: #ef4444; border-color: rgba(239, 68, 68, 0.45); background: rgba(239, 68, 68, 0.1);'}">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              </button>` : ''}
              <button type="button" class="ga-action-btn ga-details" title="Détails du compte" aria-label="Details for ${escapeHtml(a.name || a.email)}">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
              </button>
              ${cdInfo ? `
              <button type="button" class="ga-action-btn ga-lift-cd" title="Lever le cooldown immédiatement (Réveiller)" aria-label="Lift cooldown for ${escapeHtml(a.name || a.email)}" style="color: #10b981; border-color: rgba(16, 185, 129, 0.4);">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
              </button>` : ''}
                            <button type="button" class="ga-action-btn ga-delete" title="Supprimer ce compte" aria-label="Supprimer ${escapeHtml(a.name || a.email)}">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
              </button>
<div class="ga-more-dropdown-wrap">
                <button type="button" class="ga-action-btn ga-more-trigger" title="Plus d'actions" aria-label="More actions for ${escapeHtml(a.name || a.email)}">
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><circle cx="5" cy="12" r="2"/></svg>
                </button>
                <div class="ga-more-dropdown-menu">
                  <div class="ga-menu-section">
                    <button type="button" class="ga-action-btn ga-more-item ga-ping" title="Tester la latence (Ping direct)" aria-label="Ping ${escapeHtml(a.name || a.email)}">
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
                      <span>Ping Latence</span>
                    </button>
                    <button type="button" class="ga-action-btn ga-more-item ga-refresh" title="Rafraîchir les quotas" aria-label="Refresh quotas for ${escapeHtml(a.name || a.email)}">
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                      <span>Rafraîchir Quotas</span>
                    </button>
                    <button type="button" class="ga-action-btn ga-more-item ga-warmup" title="One-click Warmup" aria-label="Warmup ${escapeHtml(a.name || a.email)}">
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                      <span>Cycle Warmup</span>
                    </button>
                  </div>
                  <div class="ga-menu-divider"></div>
                  <div class="ga-menu-section">
                    <button type="button" class="ga-action-btn ga-more-item ga-toggle-enable ${isEnabled ? '' : 'is-disabled-state'}" title="${isEnabled ? 'Mettre en pause ce compte' : 'Réactiver ce compte dans le pool'}" aria-label="Toggle enable for ${escapeHtml(a.name || a.email)}">
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>
                      <span>${isEnabled ? 'Mettre en pause' : 'Réactiver'}</span>
                    </button>
                    <button type="button" class="ga-action-btn ga-more-item ga-edit" title="Modifier le compte" aria-label="Edit account ${escapeHtml(a.name || a.email)}">
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                      <span>Modifier</span>
                    </button>
                    <button type="button" class="ga-action-btn ga-more-item ga-toggle-tier" data-id="${escapeHtml(a.id)}" title="Basculer entre FREE et PRO" aria-label="Toggle tier for ${escapeHtml(a.name || a.email)}">
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
                      <span>${tier === 'FREE' ? 'Passer en PRO' : 'Passer en FREE'}</span>
                    </button>
                  </div>
                  <div class="ga-menu-divider"></div>
                  <div class="ga-menu-section ga-menu-section--danger">
                    <button type="button" class="ga-action-btn ga-more-item ga-delete" title="Supprimer le compte" aria-label="Delete account ${escapeHtml(a.name || a.email)}">
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
                      <span>Supprimer</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </td>
        </tr>
      `;
    }
    html += `
          </tbody>
        </table>
      </div>
    `;
  } else {
    // Grid View
    html += `<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 14px;">`;
    for (const a of filtered) {
      const isStudio = isAiStudioAccount(a);
      const isCli = isGeminiCliAccount(a);
      const tier = getAccountTier(a);
      const tierIcon = isStudio ? '⚡' : (isCli ? '🖥️' : (tier === 'PARTAGE' ? '👥' : (tier === 'ULTRA' ? '💎' : (tier === 'PRO' ? '◆' : '⬡'))));
      const quotas = a.quotas;
      const isCurrent = Boolean(a.isCurrent);
      const isTarget = Boolean(topCandidate && topCandidate.id === a.id);

      const cdGemini = getAccountActiveCooldown(a, 'gemini');
      const cdClaude = getAccountActiveCooldown(a, 'claude');
      const cdInfo = cdGemini || cdClaude;
      const isEnabled = a.enabled !== false;
      const recom = getAccountRecommendation(a);
      const dedupModels = getDeduplicatedAccountModels(a.models);

      let statusBadgeHtml = '';
      const isUnlicensed = a.isUnlicensed || a.quotas?.isUnlicensed;
      const isBlocked = isUnlicensed || Boolean(a.errorDetails) || Boolean(a.quotas?.errorDetails) || (a.status === 'unhealthy' && Boolean(a.lastError?.includes('403')));
      if (!isEnabled) {
        statusBadgeHtml = `<span class="ga-badge ga-badge-paused" style="background: rgba(148, 163, 184, 0.14); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.25);" title="Compte mis en pause (temporairement exclu de la rotation)">⏸ PAUSE</span>`;
      } else if (isUnlicensed) {
        statusBadgeHtml = `<span class="ga-badge ga-badge-warn" style="background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3);" title="Compte sans licence Antigravity active (HTTP 403 Subscription Required)">🚫 SANS LICENCE</span>`;
      } else if (cdGemini) {
        statusBadgeHtml = `<span class="ga-badge ga-badge-warn ga-live-cd" data-until="${cdGemini.until}" data-account-id="${escapeHtml(a.id)}" style="background: rgba(245, 158, 11, 0.18); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.4);" title="${escapeHtml(cdGemini.details)}">${escapeHtml(cdGemini.text)}</span>`;
      } else if (cdClaude && cdClaude.isWeeklyCap) {
        if (!isTarget) {
          statusBadgeHtml = `<span class="ga-badge" style="background: rgba(56, 189, 248, 0.12); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.25); font-size: 10px;" title="${escapeHtml(recom.text)}">${escapeHtml(recom.badge || '⚡ Gemini 100% Prêt')}</span>`;
        }
      } else if (cdClaude) {
        statusBadgeHtml = `<span class="ga-badge ga-badge-dormant" style="font-size: 10px;" title="${escapeHtml(recom.text)}">${escapeHtml(recom.badge || '⚠️ Plafond Claude')}</span>`;
      } else if (recom && recom.badge && recom.badge !== '⏳ Cooldown 429') {
        const isQuotaExhausted = recom.badge.includes('Quota Épuisé') || recom.badge.includes('Hebdo 0%');
        if (isQuotaExhausted) {
          statusBadgeHtml = `<span class="ga-badge ga-badge-dormant" style="font-size: 10px;" title="${escapeHtml(recom.text)}">${escapeHtml(recom.badge)}</span>`;
        } else if (!isTarget || !recom.badge.includes('100%')) {
          const badgeColor = recom.type === 'warn'
            ? 'background: rgba(245, 158, 11, 0.12); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.25);'
            : (recom.type === 'info'
              ? 'background: rgba(56, 189, 248, 0.12); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.25);'
              : '');
          statusBadgeHtml = `<span class="ga-badge" style="font-size: 10px; opacity: 0.9; ${badgeColor}" title="${escapeHtml(recom.text)}">${escapeHtml(recom.badge)}</span>`;
        }
      }

      let unifiedRoleBadgeHtml = '';
      if (isStudio) {
        unifiedRoleBadgeHtml = `<span class="pool-role-badge pool-role-badge--studio" title="Google AI Studio Developer API Key">● Active Studio</span>`;
      } else if (isCli) {
        unifiedRoleBadgeHtml = `<span class="pool-role-badge pool-role-badge--cli" title="Gemini CLI Account (Code Assist Prod, separate quota)">● Active CLI</span>`;
      } else if (isCurrent) {
        const effCurrent = getAccountEffectiveQuotas(a);
        if (effCurrent.gemini5hPct <= 0 && effCurrent.claude5hPct <= 0) {
          unifiedRoleBadgeHtml = `<span class="ga-badge ga-badge-warn" style="background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.35);" title="Compte principal Antigravity (quotas 5h épuisés)">⚠️ PRINCIPAL (Cap Épuisé)</span>`;
        } else if (effCurrent.gemini5hPct <= 0) {
          unifiedRoleBadgeHtml = `<span class="ga-badge ga-badge-warn" style="background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.35);" title="Compte principal Antigravity (quota Gemini 5h épuisé)">⚠️ PRINCIPAL (Cap Épuisé)</span>`;
        } else if (cdInfo) {
          unifiedRoleBadgeHtml = `<span class="ga-badge ga-badge-warn" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.35);" title="Compte principal Antigravity (actuellement en cooldown)">● PRINCIPAL (Cooldown)</span>`;
        } else if (isBlocked) {
          unifiedRoleBadgeHtml = `<span class="ga-badge ga-badge-warn" style="background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.35);" title="Compte principal Antigravity (bloqué / 403)">⚠️ PRINCIPAL (Bloqué)</span>`;
        } else if (!isEnabled) {
          unifiedRoleBadgeHtml = `<span class="ga-badge ga-badge-paused" style="background: rgba(148, 163, 184, 0.15); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.3);" title="Compte principal Antigravity (mis en pause)">⏸ PRINCIPAL (Pause)</span>`;
        } else if (isTarget) {
          unifiedRoleBadgeHtml = `<span class="ga-badge ga-badge-current ga-led-active" title="Compte principal actif & classé #1 en rotation P2C">● EN LIGNE (P2C #1)</span>`;
        } else {
          unifiedRoleBadgeHtml = `<span class="ga-badge ga-badge-current ga-led-active" title="Compte principal actif pour Antigravity">● EN LIGNE</span>`;
        }
      } else if (isTarget) {
        unifiedRoleBadgeHtml = `<span class="ga-badge ga-target-badge" title="Compte actuellement classé #1 en rotation pour la prochaine requête entrante">🎯 PROCHAIN P2C</span>`;
      }

      html += `
        <div class="agy-provider-row ${isCurrent ? 'is-current' : ''} ${isTarget ? 'is-target' : ''} ${!isEnabled ? 'is-disabled' : ''}" data-id="${escapeHtml(a.id)}" style="flex-direction: column; align-items: stretch; gap: 12px; padding: 14px 16px; border-radius: var(--r-card, 10px); border: 1px solid ${isCurrent ? 'rgba(59, 130, 246, 0.4)' : isTarget ? 'rgba(56, 189, 248, 0.45)' : !isEnabled ? 'rgba(148, 163, 184, 0.25)' : isAccountValidationRequired(a) ? 'rgba(245, 158, 11, 0.45)' : 'var(--border)'}; background: ${!isEnabled ? 'rgba(0,0,0,0.2)' : 'var(--bg-1)'}; ${!isEnabled ? 'opacity: 0.75;' : ''}">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
              ${a.picture
                ? `<img src="${escapeHtml(a.picture)}" style="width: 26px; height: 26px; border-radius: 50%; object-fit: cover;" alt="Avatar" />`
                : isStudio
                  ? `<div style="width: 26px; height: 26px; border-radius: 50%; background: rgba(16, 185, 129, 0.18); color: #10b981; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 11px;" title="Clé API Développeur Google AI Studio">✦</div>`
                  : isCli
                    ? `<div style="width: 26px; height: 26px; border-radius: 50%; background: rgba(168, 85, 247, 0.18); color: #c084fc; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 10px;" title="Compte Gemini CLI">CLI</div>`
                    : `<div style="width: 26px; height: 26px; border-radius: 50%; background: rgba(59, 130, 246, 0.15); color: #3b82f6; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 11px;">G</div>`
              }
              <div style="min-width: 0;">
                <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                  <strong style="font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text-0);">${escapeHtml(a.name)}</strong>
                  ${unifiedRoleBadgeHtml}
                  ${statusBadgeHtml}
                  ${typeof a.lastLatencyMs === 'number' ? `<span class="ga-badge" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); font-family: var(--font-mono); font-size: 10px;" title="Dernière latence mesurée">⚡ ${a.lastLatencyMs}ms</span>` : ''}
                  <span class="ga-badge ga-badge-${tier.toLowerCase()} ga-tier-badge" data-id="${escapeHtml(a.id)}" style="cursor: pointer;" title="Cliquer pour basculer (FREE ↔ PRO)">${tierIcon} ${tier}</span>
                  ${(a.quotas?.creditAmount || a.creditAmount) ? `<span class="ga-badge ga-badge-credits">🪙 ${a.quotas?.creditAmount || a.creditAmount} credits</span>` : ''}
                  ${(a.isUnlicensed || a.errorDetails || a.quotas?.errorDetails || (a.status === 'unhealthy' && a.lastError?.includes('403'))) ? (
                    isAccountValidationRequired(a)
                      ? `<button type="button" class="ga-badge ga-error-details-badge" data-id="${escapeHtml(a.id)}" style="cursor: pointer; background: rgba(245, 158, 11, 0.18); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.4); font-weight: 600; font-size: 10px; padding: 2px 7px; border-radius: 5px; display: inline-flex; align-items: center; gap: 4px;" title="Validation Google requise (HTTP 403 Challenge). Cliquez pour voir le protocole en 4 étapes.">🟠 Validation Requise</button>`
                      : `<button type="button" class="ga-badge ga-error-details-badge" data-id="${escapeHtml(a.id)}" style="cursor: pointer; background: rgba(239, 68, 68, 0.2); color: #fca5a5; border: 1px solid rgba(239, 68, 68, 0.45); font-weight: 600; font-size: 10px; padding: 2px 7px; border-radius: 5px; display: inline-flex; align-items: center; gap: 4px;" title="Compte bloqué (403 / TOS). Cliquez pour voir le diagnostic et les solutions (Quick Fix).">🔒 Erreur 403 (TOS)</button>`
                  ) : ''}
                </div>
                <div style="font-size: 11px; color: var(--text-4); margin-top: 2px;">${dedupModels.filter((m) => m.enabled !== false).length} models · ${escapeHtml(maskKeyPreview(a.apiKey))}</div>
              </div>
            </div>
            <div class="ga-row-actions-group">
              <button type="button" class="ga-action-btn ga-switch ${isCurrent ? 'active-switch' : ''}" title="${isCurrent ? 'Compte actif principal' : 'Activer ce compte (1-clic)'}" aria-label="Switch to ${escapeHtml(a.name || a.email)}">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>
              </button>
              ${hasAccountErrorOrValidation(a) ? `
              <button type="button" class="ga-action-btn ga-error-details-btn" data-id="${escapeHtml(a.id)}" title="${isAccountValidationRequired(a) ? 'Assistant Déblocage (Protocole 4 Étapes)' : 'Diagnostic Erreur (TOS / 403) & Solutions Quick Fix'}" aria-label="Error details for ${escapeHtml(a.name || a.email)}" style="${isAccountValidationRequired(a) ? 'color: #fbbf24; border-color: rgba(245, 158, 11, 0.45); background: rgba(245, 158, 11, 0.1);' : 'color: #ef4444; border-color: rgba(239, 68, 68, 0.45); background: rgba(239, 68, 68, 0.1);'}">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              </button>` : ''}
              <button type="button" class="ga-action-btn ga-details" title="Détails du compte" aria-label="Details for ${escapeHtml(a.name || a.email)}">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
              </button>
              ${cdInfo ? `
              <button type="button" class="ga-action-btn ga-lift-cd" title="Lever le cooldown immédiatement (Réveiller)" aria-label="Lift cooldown for ${escapeHtml(a.name || a.email)}" style="color: #10b981; border-color: rgba(16, 185, 129, 0.4);">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
              </button>` : ''}
                            <button type="button" class="ga-action-btn ga-delete" title="Supprimer ce compte" aria-label="Supprimer ${escapeHtml(a.name || a.email)}">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
              </button>
<div class="ga-more-dropdown-wrap">
                <button type="button" class="ga-action-btn ga-more-trigger" title="Plus d'actions" aria-label="More actions for ${escapeHtml(a.name || a.email)}">
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><circle cx="5" cy="12" r="2"/></svg>
                </button>
                <div class="ga-more-dropdown-menu">
                  <div class="ga-menu-section">
                    <button type="button" class="ga-action-btn ga-more-item ga-ping" title="Tester la latence (Ping direct)" aria-label="Ping ${escapeHtml(a.name || a.email)}">
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
                      <span>Ping Latence</span>
                    </button>
                    <button type="button" class="ga-action-btn ga-more-item ga-refresh" title="Rafraîchir les quotas" aria-label="Refresh quotas for ${escapeHtml(a.name || a.email)}">
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                      <span>Rafraîchir Quotas</span>
                    </button>
                    <button type="button" class="ga-action-btn ga-more-item ga-warmup" title="One-click Warmup" aria-label="Warmup ${escapeHtml(a.name || a.email)}">
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                      <span>Cycle Warmup</span>
                    </button>
                  </div>
                  <div class="ga-menu-divider"></div>
                  <div class="ga-menu-section">
                    <button type="button" class="ga-action-btn ga-more-item ga-toggle-enable ${isEnabled ? '' : 'is-disabled-state'}" title="${isEnabled ? 'Mettre en pause ce compte' : 'Réactiver ce compte dans le pool'}" aria-label="Toggle enable for ${escapeHtml(a.name || a.email)}">
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>
                      <span>${isEnabled ? 'Mettre en pause' : 'Réactiver'}</span>
                    </button>
                    <button type="button" class="ga-action-btn ga-more-item ga-edit" title="Modifier le compte" aria-label="Edit account ${escapeHtml(a.name || a.email)}">
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                      <span>Modifier</span>
                    </button>
                    <button type="button" class="ga-action-btn ga-more-item ga-toggle-tier" data-id="${escapeHtml(a.id)}" title="Basculer entre FREE et PRO" aria-label="Toggle tier for ${escapeHtml(a.name || a.email)}">
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
                      <span>${tier === 'FREE' ? 'Passer en PRO' : 'Passer en FREE'}</span>
                    </button>
                  </div>
                  <div class="ga-menu-divider"></div>
                  <div class="ga-menu-section ga-menu-section--danger">
                    <button type="button" class="ga-action-btn ga-more-item ga-delete" title="Supprimer le compte" aria-label="Delete account ${escapeHtml(a.name || a.email)}">
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
                      <span>Supprimer</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div style="display: flex; flex-direction: column; gap: 4px;">
            <div style="font-size: 10.5px; font-weight: 600; color: var(--text-2); text-transform: uppercase; letter-spacing: 0.05em; display: flex; justify-content: space-between;">
              <span>Models (${dedupModels.filter((m) => m.enabled !== false).length}/${dedupModels.length})</span>
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: 4px;">
              ${dedupModels.slice(0, 6).map((m) => {
                const isEn = m.enabled !== false;
                return `<span style="font-size: 9.5px; padding: 2px 6px; border-radius: 4px; background: ${isEn ? 'rgba(59,130,246,0.12)' : 'rgba(255,255,255,0.04)'}; color: ${isEn ? '#93c5fd' : 'var(--text-3)'}; border: 1px solid ${isEn ? 'rgba(59,130,246,0.25)' : 'rgba(255,255,255,0.05)'}; font-family: var(--font-mono);">${escapeHtml(m.displayName)}</span>`;
              }).join('') + (dedupModels.length > 6 ? `<span style="font-size: 9.5px; color: var(--text-3); padding: 2px 4px;">+${dedupModels.length - 6} more</span>` : '') || '<span style="font-size: 10px; color: var(--text-3); font-style: italic;">No models configured</span>'}
            </div>
          </div>

          ${renderAccountQuotaBlock(a, gaShowAllQuotas, isWeekly, true)}
        </div>
      `;
    }
    html += `</div>`;
  }

  gaAccountsContainer.innerHTML = html;
}


(window as any).initGoogleAccountModal?.();

const gaDiscoverIdeBtn = $('#gaDiscoverIdeBtn') as HTMLButtonElement | null;

async function triggerIdeAccountDiscovery(): Promise<void> {
  const btn = gaDiscoverIdeBtn;
  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="spinning">⏳</span> Detecting...`;
  }

  try {
    const res = await window.ag.providers.discoverIdeAccount();
    if (res.success && res.account) {
      const acc = res.account;
      const accountEmail = acc.email || 'antigravity-account@google.com';
      const cleanPrefix = acc.name ? acc.name : accountEmail.split('@')[0];
      const accountName = `${cleanPrefix} (IDE)`;

      // Look for existing account by key or name
      const existing = googleAccountsCache.find(
        (a) => a.apiKey === acc.accessToken || a.name.includes(cleanPrefix) || a.name === accountName
      );

      const targetId = existing ? existing.id : 'google-ide-' + Date.now();
      const newProvider: any = {
        id: targetId,
        name: existing ? existing.name : accountName,
        provider: 'google',
        apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: acc.accessToken,
        enabled: true,
        picture: acc.picture,
        quotas: acc.quotas,
        models: existing?.models?.length
          ? existing.models.map((m: any) => ({
              id: m.id,
              displayName: (m.displayName || m.id).replace(/^\[[^\]]+\]\s*/, ''),
              enabled: m.enabled !== false,
            }))
          : [
              { id: 'gemini-4-argon-medium', displayName: 'Gemini 4 Argon (Medium)', enabled: true },
              { id: 'gemini-3.8-flash-tiered', displayName: 'Gemini 3.8 Flash Tiered', enabled: true },
              { id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6 (Thinking)', enabled: true },
              { id: 'claude-opus-4-6-thinking', displayName: 'Claude Opus 4.6 (Thinking)', enabled: true },
            ],
      };

      if (!existing?.models?.length && acc.accessToken) {
        try {
          const mRes = await window.ag.providers.fetchModels({
            provider: 'google',
            apiUrl: newProvider.apiUrl,
            apiKey: acc.accessToken,
          });
          if (mRes.success && mRes.models && mRes.models.length > 0) {
            newProvider.models = mRes.models
              .filter((m) => !isObsoleteModelUI(m.id, m.displayName))
              .map((m) => ({
                id: m.id,
                displayName: (m.displayName || m.id).replace(/^models\//, '').replace(/^\[[^\]]+\]\s*/, ''),
                enabled: true,
              }));
          }
        } catch {}
      }

      const saveRes = await window.ag.providers.save(newProvider);
      if (saveRes.success) {
        toast(`Account ${accountEmail} successfully imported from Antigravity IDE!`, 'ok');
        await loadGoogleAccounts();
      } else {
        toast(`Save error: ${saveRes.error}`, 'err');
      }
    } else {
      toast(res.error || 'No active Antigravity IDE account detected.', 'warn');
    }
  } catch (err) {
    toast(`Error: ${(err as Error).message}`, 'err');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  }
}

gaDiscoverIdeBtn?.addEventListener('click', () => triggerIdeAccountDiscovery());

const gaOAuthLoginBtn = $('#gaOAuthLoginBtn') as HTMLButtonElement | null;
const gaOAuthAntigravityBtn = $('#gaOAuthAntigravityBtn') as HTMLButtonElement | null;
const gaAddAiStudioBtn = $('#gaAddAiStudioBtn') as HTMLButtonElement | null;

async function triggerGoogleOAuthLogin(
  providerType: 'antigravity' | 'gemini-cli' = 'antigravity',
  triggerBtn?: HTMLButtonElement | null
): Promise<void> {
  const btn = triggerBtn || (gaOAuthAntigravityBtn || gaOAuthLoginBtn);
  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="spinning">⏳</span> Connecting...`;
  }
  try {
    const label = providerType === 'gemini-cli' ? 'Gemini CLI' : 'Antigravity';
    toast(`Opening browser for ${label} login...`, 'info');
    const res = await window.ag.providers.startOAuthLogin(providerType);
    if (res.success && res.account) {
      const email = res.account.email || res.account.name || `${label} account`;
      toast(`Account ${email} connected and synced successfully!`, 'ok');
      await loadGoogleAccounts();
    } else {
      toast(res.error || `${label} login was cancelled or failed.`, 'warn');
    }
  } catch (err) {
    toast(`Error: ${(err as Error).message}`, 'err');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  }
}

gaOAuthLoginBtn?.addEventListener('click', () => triggerGoogleOAuthLogin('antigravity'));
gaOAuthAntigravityBtn?.addEventListener('click', () => triggerGoogleOAuthLogin('antigravity'));
gaAddAiStudioBtn?.addEventListener('click', () => openGoogleAccountModal(undefined, 'google-gemini'));

// Unified Connect Account Dropdown
const gaAddAccountUnifiedBtn = $('#gaAddAccountUnifiedBtn') as HTMLButtonElement | null;
const gaAddAccountMenu = $('#gaAddAccountMenu') as HTMLDivElement | null;
const gaAddDropdownWrap = $('#gaAddDropdownWrap') as HTMLDivElement | null;

if (gaAddAccountUnifiedBtn && gaAddAccountMenu) {
  gaAddAccountUnifiedBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = gaAddAccountMenu.hasAttribute('hidden');
    if (isHidden) {
      gaAddAccountMenu.removeAttribute('hidden');
      gaAddAccountUnifiedBtn.setAttribute('aria-expanded', 'true');
    } else {
      gaAddAccountMenu.setAttribute('hidden', '');
      gaAddAccountUnifiedBtn.setAttribute('aria-expanded', 'false');
    }
  });

  document.addEventListener('click', (e) => {
    if (!gaAddDropdownWrap?.contains(e.target as Node)) {
      gaAddAccountMenu.setAttribute('hidden', '');
      gaAddAccountUnifiedBtn.setAttribute('aria-expanded', 'false');
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !gaAddAccountMenu.hasAttribute('hidden')) {
      gaAddAccountMenu.setAttribute('hidden', '');
      gaAddAccountUnifiedBtn.setAttribute('aria-expanded', 'false');
      gaAddAccountUnifiedBtn.focus();
    }
  });

  $('#gaMenuAntigravityOAuth')?.addEventListener('click', () => {
    gaAddAccountMenu.setAttribute('hidden', '');
    gaAddAccountUnifiedBtn.setAttribute('aria-expanded', 'false');
    void triggerGoogleOAuthLogin('antigravity');
  });

  $('#gaMenuGeminiCli')?.addEventListener('click', () => {
    gaAddAccountMenu.setAttribute('hidden', '');
    gaAddAccountUnifiedBtn.setAttribute('aria-expanded', 'false');
    void triggerGoogleOAuthLogin('gemini-cli');
  });

  $('#gaMenuDiscoverIde')?.addEventListener('click', () => {
    gaAddAccountMenu.setAttribute('hidden', '');
    gaAddAccountUnifiedBtn.setAttribute('aria-expanded', 'false');
    void triggerIdeAccountDiscovery();
  });

  $('#gaMenuAiStudio')?.addEventListener('click', () => {
    gaAddAccountMenu.setAttribute('hidden', '');
    gaAddAccountUnifiedBtn.setAttribute('aria-expanded', 'false');
    openGoogleAccountModal(undefined, 'google-gemini');
  });
}

// Key visibility toggle
if (gaKeyToggle && gaFormKey) {
  gaKeyToggle.addEventListener('click', () => {
    const isPass = gaFormKey.type === 'password';
    gaFormKey.type = isPass ? 'text' : 'password';
    gaKeyToggle.title = isPass ? 'Hide API key' : 'Show API key';
    gaKeyToggle.innerHTML = isPass
      ? `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`
      : `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
  });
}

// Open Google AI Studio Link
gaOpenAiStudioLink?.addEventListener('click', (e) => {
  e.preventDefault();
  void window.ag.openExternal('https://aistudio.google.com/apikey');
});

// Model management toolbar handlers
gaFormSelectAllBtn?.addEventListener('click', () => {
  currentGaFetchedModels.forEach((m) => { m.enabled = true; });
  renderGaFormModelsList();
});

gaFormDeselectAllBtn?.addEventListener('click', () => {
  currentGaFetchedModels.forEach((m) => { m.enabled = false; });
  renderGaFormModelsList();
});

function addCustomModelToGaList(id: string, name?: string): void {
  const cleanId = id.trim().replace(/^models\//, '');
  if (!cleanId) return;
  const existing = currentGaFetchedModels.find((m) => m.id === cleanId);
  if (existing) {
    existing.enabled = true;
  } else {
    currentGaFetchedModels.push({
      id: cleanId,
      displayName: name || cleanId,
      enabled: true,
    });
  }
  renderGaFormModelsList();
}

gaFormAddCustomModelBtn?.addEventListener('click', () => {
  if (!gaFormCustomModelInput) return;
  const val = gaFormCustomModelInput.value.trim();
  if (val) {
    addCustomModelToGaList(val);
    gaFormCustomModelInput.value = '';
  }
});

gaFormCustomModelInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const val = gaFormCustomModelInput.value.trim();
    if (val) {
      addCustomModelToGaList(val);
      gaFormCustomModelInput.value = '';
    }
  }
});

document.querySelectorAll<HTMLButtonElement>('.ga-preset-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const id = btn.dataset.id;
    const name = btn.dataset.name;
    if (id) addCustomModelToGaList(id, name);
  });
});

// Fetch Models from Endpoint button in modal
gaFormFetchModelsBtn?.addEventListener('click', async () => {
  if (!gaFormUrl || !gaFormKey) return;
  const apiUrl = gaFormUrl.value.trim();
  const apiKey = gaFormKey.value.trim();
  const isIde = apiKey.startsWith('ya29.') || (editingGoogleAccountId && String(editingGoogleAccountId).startsWith('google-ide-'));

  if (!apiKey) {
    toast(isIde ? 'Jeton Antigravity IDE manquant' : 'Please enter your Google AI Studio API key first', 'warn');
    gaFormKey.focus();
    return;
  }

  gaFormFetchModelsBtn.disabled = true;
  gaFormFetchModelsBtn.innerHTML = `<span class="spinner"></span> Querying Endpoint…`;
  if (gaFormError) gaFormError.hidden = true;

  try {
    const res = (await window.ag.providers.fetchModels({
      provider: 'google',
      apiUrl,
      apiKey,
    })) as { success: boolean; models?: Array<{ id: string; displayName?: string }>; error?: string };

    if (res.success && res.models && res.models.length > 0) {
      const fetched = res.models.map((m) => {
        const cleanId = m.id.replace(/^models\//, '');
        const cleanName = (m.displayName || m.id).replace(/^models\//, '').replace(/^\[[^\]]+\]\s*/, '');
        return {
          id: cleanId,
          displayName: cleanName,
          enabled: true,
        };
      });

      // Retain already selected models if user previously selected them
      fetched.forEach((m) => {
        const existing = currentGaFetchedModels.find((x) => x.id === m.id);
        if (!existing) {
          currentGaFetchedModels.push(m);
        }
      });
      if (currentGaFetchedModels.length === 0) {
        currentGaFetchedModels = fetched;
      }
      renderGaFormModelsList();
      toast(isIde ? `Modèles Antigravity IDE synchronisés (${res.models.length} modèles)` : `Found ${res.models.length} models for this account!`, 'ok');
    } else {
      const errMsg = res.error || 'No generative models found on this endpoint.';
      if (gaFormError) {
        gaFormError.textContent = `Fetch error: ${errMsg}`;
        gaFormError.hidden = false;
      }
      toast(`Fetch failed: ${errMsg}`, 'err', 6000);
    }
  } catch (err) {
    const msg = (err as Error).message;
    if (gaFormError) {
      gaFormError.textContent = msg;
      gaFormError.hidden = false;
    }
    toast(`Error: ${msg}`, 'err');
  } finally {
    gaFormFetchModelsBtn.disabled = false;
    gaFormFetchModelsBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
      Get Models from Endpoint
    `;
  }
});

// Save Google Account button in modal
gaFormSaveBtn?.addEventListener('click', async () => {
  if (!gaFormName || !gaFormUrl || !gaFormKey) return;
  const name = gaFormName.value.trim();
  const apiUrl = gaFormUrl.value.trim() || 'https://generativelanguage.googleapis.com/v1beta';
  const apiKey = gaFormKey.value.trim();

  if (!name) {
    if (gaFormError) {
      gaFormError.textContent = 'Account label/name is required (e.g. Perso, Pro, Trial).';
      gaFormError.hidden = false;
    }
    gaFormName.focus();
    return;
  }
  if (!apiKey) {
    if (gaFormError) {
      gaFormError.textContent = 'Google AI Studio API key (or IDE session token) is required.';
      gaFormError.hidden = false;
    }
    gaFormKey.focus();
    return;
  }

  if (currentGaFetchedModels.length === 0) {
    currentGaFetchedModels.push(
      { id: 'gemini-3.8-flash-tiered', displayName: 'Gemini 3.8 Flash Tiered', enabled: true },
      { id: 'gemini-4-argon-medium', displayName: 'Gemini 4 Argon (Medium)', enabled: true }
    );
  }

  const existingAccount = editingGoogleAccountId
    ? googleAccountsCache.find((x) => x.id === editingGoogleAccountId)
    : undefined;

  const accountEntry: any = {
    ...(existingAccount || {}),
    id: editingGoogleAccountId || `provider-google-${Date.now()}`,
    name,
    provider: existingAccount?.provider || 'google',
    apiUrl,
    apiKey,
    enabled: existingAccount ? existingAccount.enabled !== false : true,
    models: currentGaFetchedModels.map((m) => {
      let cleanName = m.displayName || m.id;
      cleanName = cleanName.replace(/^\[[^\]]+\]\s*/, '');
      return {
        id: m.id,
        displayName: cleanName,
        enabled: m.enabled !== false,
      };
    }),
  };

  if (existingAccount?.picture) accountEntry.picture = existingAccount.picture;
  if (existingAccount?.quotas) accountEntry.quotas = existingAccount.quotas;
  if (existingAccount?.refreshToken) accountEntry.refreshToken = existingAccount.refreshToken;
  if (existingAccount?.source) accountEntry.source = existingAccount.source;

  gaFormSaveBtn.disabled = true;
  gaFormSaveBtn.textContent = 'Saving…';

  try {
    const res = (await window.ag.providers.save(accountEntry)) as { success: boolean; error?: string };
    if (res.success) {
      // Propagate updated model choices to ALL Google accounts so they share the common provider model config
      for (const otherAcc of googleAccountsCache) {
        if (otherAcc.id !== accountEntry.id) {
          otherAcc.models = JSON.parse(JSON.stringify(accountEntry.models));
          try {
            await window.ag.providers.save(otherAcc);
          } catch {}
        }
      }
      toast(`Account "${name}" saved! Models are now synchronized across all Google accounts.`, 'ok');
      closeGoogleAccountModal();
      await loadGoogleAccounts();
      void loadModels();
    } else {
      if (gaFormError) {
        gaFormError.textContent = `Failed to save account: ${res.error}`;
        gaFormError.hidden = false;
      }
    }
  } catch (err) {
    if (gaFormError) {
      gaFormError.textContent = (err as Error).message;
      gaFormError.hidden = false;
    }
  } finally {
    gaFormSaveBtn.disabled = false;
    gaFormSaveBtn.textContent = 'Save Account';
  }
});

// Test All Google Accounts
gaTestAllBtn?.addEventListener('click', async () => {
  if (!googleAccountsCache || googleAccountsCache.length === 0) {
    toast('No Google accounts to test', 'warn');
    return;
  }
  gaTestAllBtn.disabled = true;
  const orig = gaTestAllBtn.innerHTML;
  gaTestAllBtn.innerHTML = `<span class="spinner"></span> Testing…`;
  try {
    let successCount = 0;
    for (const a of googleAccountsCache) {
      try {
        let tokenToUse = a.apiKey;
        if (a.refreshToken) {
          try {
            const r = await window.ag.providers.refreshToken(a.refreshToken);
            if (r.success && r.accessToken) {
              tokenToUse = r.accessToken;
              a.apiKey = r.accessToken;
            }
          } catch {}
        }
        const res = (await window.ag.providers.test({
          apiUrl: a.apiUrl,
          apiKey: tokenToUse || "",
          id: a.id,
          provider: 'google',
        })) as { success: boolean; latencyMs?: number };
        if (res.success) successCount++;
      } catch { /* ignore individual failures */ }
    }
    const toastType = successCount === 0 ? 'err' : (successCount < googleAccountsCache.length ? 'warn' : 'ok');
    toast(`Tested ${googleAccountsCache.length} accounts: ${successCount} healthy`, toastType);
    await loadGoogleAccounts();
  } finally {
    gaTestAllBtn.disabled = false;
    gaTestAllBtn.innerHTML = orig;
  }
});

// Sync All Google Accounts Models
gaSyncAllBtn?.addEventListener('click', async () => {
  if (!googleAccountsCache || googleAccountsCache.length === 0) {
    toast('No Google accounts to sync', 'warn');
    return;
  }
  gaSyncAllBtn.disabled = true;
  const orig = gaSyncAllBtn.innerHTML;
  gaSyncAllBtn.innerHTML = `<span class="spinner"></span> Syncing all…`;
  try {
    let totalSyncedModels = 0;
    for (const a of googleAccountsCache) {
      try {
        let tokenToUse = a.apiKey;
        if (a.refreshToken) {
          try {
            const r = await window.ag.providers.refreshToken(a.refreshToken);
            if (r.success && r.accessToken) {
              tokenToUse = r.accessToken;
              a.apiKey = r.accessToken;
            }
          } catch {}
        }
        const res = (await window.ag.providers.fetchModels({
          provider: 'google',
          apiUrl: a.apiUrl,
          apiKey: tokenToUse || "",
        })) as { success: boolean; models?: Array<{ id: string; displayName?: string }> };
        if (res.success && res.models && res.models.length > 0) {
          const newModels = res.models.map((m) => {
            const cleanName = (m.displayName || m.id).replace(/^\[[^\]]+\]\s*/, '');
            return {
              id: m.id,
              displayName: cleanName,
              enabled: true,
            };
          });
          a.models = newModels;
          totalSyncedModels += res.models.length;
        }
      } catch { /* continue with next */ }
    }
    if (totalSyncedModels > 0) {
      await saveGoogleAccountsBatch(googleAccountsCache);
    }
    await synchronizeGoogleAccountsModels(googleAccountsCache);
    toast(`Synced ${totalSyncedModels} models across ${googleAccountsCache.length} accounts!`, 'ok');
    await loadGoogleAccounts();
    void loadModels();
  } finally {
    gaSyncAllBtn.disabled = false;
    gaSyncAllBtn.innerHTML = orig;
  }
});

// Corriger / Réveiller les comptes Google et lever les cooldowns expirés
gaRepairCooldownsBtn?.addEventListener('click', async () => {
  if (!googleAccountsCache || googleAccountsCache.length === 0) {
    toast('Aucun compte Google configuré', 'warn');
    return;
  }
  gaRepairCooldownsBtn.disabled = true;
  const orig = gaRepairCooldownsBtn.innerHTML;
  gaRepairCooldownsBtn.innerHTML = `<span class="spinner"></span> Correction…`;
  try {
    // 1. Réconcilier et nettoyer les cooldowns et timestamps expirés via le backend IPC
    let cleared = 0;
    try {
      const recResult = await window.ag.providers.reconcileCooldowns?.();
      if (recResult && typeof recResult.cleared === 'number') {
        cleared = recResult.cleared;
      }
    } catch {}

    // 2. Rafraîchir les tokens et quotas pour tous les comptes disposant d'un refreshToken
    let refreshedCount = 0;
    for (const a of googleAccountsCache) {
      if (a.refreshToken) {
        try {
          const r = await window.ag.providers.refreshToken(a.refreshToken);
          if (r.success && r.accessToken) {
            a.apiKey = r.accessToken;
            if (r.quotas) a.quotas = r.quotas;
            refreshedCount++;
          }
        } catch { /* ignorer les erreurs réseau temporaires */ }
      }
    }
    if (refreshedCount > 0) {
      await saveGoogleAccountsBatch(googleAccountsCache);
    }

    // 3. Recharger la vue des comptes et mettre à jour les jauges et cooldowns
    await loadGoogleAccounts();

    const msg = cleared > 0
      ? `Correction réussie : ${cleared} cooldown(s) levé(s), ${refreshedCount} compte(s) synchronisé(s) !`
      : `Vérification terminée : tous les cooldowns sont sains (${refreshedCount} compte(s) synchronisé(s)).`;
    toast(msg, 'ok', 4000);
  } catch (err: any) {
    toast(`Erreur lors de la correction : ${err?.message || err}`, 'err');
  } finally {
    gaRepairCooldownsBtn.disabled = false;
    gaRepairCooldownsBtn.innerHTML = orig;
  }
});

// ── OAuth Intercept Banner & QR Dialog ───────────────────────────────────────
let lastInterceptedOAuthUrl = '';

function setupOAuthInterception(): void {
  const banner = document.getElementById('oauthInterceptBanner');
  const portBadge = document.getElementById('oauthPortBadge');
  const openBrowserBtn = document.getElementById('oauthOpenBrowserBtn');
  const copyUrlBtn = document.getElementById('oauthCopyUrlBtn');
  const qrBtn = document.getElementById('oauthQrBtn');
  const dismissBtn = document.getElementById('oauthDismissBtn');
  const qrModal = document.getElementById('oauthQrModalBackdrop');
  const qrContainer = document.getElementById('oauthQrImageContainer');
  const qrClose = document.getElementById('oauthQrModalClose');
  const qrCloseBtn = document.getElementById('oauthQrCloseBtn');

  if (window.ag?.onOAuthIntercepted) {
    window.ag.onOAuthIntercepted((data: { url: string; port?: string; redirectUri?: string; ts?: number }) => {
      lastInterceptedOAuthUrl = data.url;
      if (portBadge) {
        portBadge.textContent = data.port ? `Port ${data.port}` : 'OAuth';
      }
      if (banner) {
        banner.style.display = 'flex';
      }
      toast("Google authentication request detected!", 'info', 6000);
    });
  }

  openBrowserBtn?.addEventListener('click', () => {
    if (lastInterceptedOAuthUrl && window.ag?.openExternal) {
      void window.ag.openExternal(lastInterceptedOAuthUrl);
    }
  });

  copyUrlBtn?.addEventListener('click', async () => {
    if (lastInterceptedOAuthUrl) {
      await navigator.clipboard.writeText(lastInterceptedOAuthUrl);
      toast('OAuth URL copied to clipboard', 'ok');
    }
  });

  qrBtn?.addEventListener('click', async () => {
    if (!lastInterceptedOAuthUrl) return;
    if (qrContainer) {
      qrContainer.innerHTML = '<span class="spinner"></span>';
      try {
        if (window.ag?.generateQr) {
          const qrSvg = await window.ag.generateQr(lastInterceptedOAuthUrl);
          qrContainer.innerHTML = qrSvg.startsWith('<svg') || qrSvg.startsWith('data:image')
            ? (qrSvg.startsWith('data:image') ? `<img src="${qrSvg}" alt="QR Code" width="180" height="180" />` : qrSvg)
            : qrSvg;
        } else {
          qrContainer.innerHTML = `<p class="text-sm text-muted">Génération QR locale non disponible.</p><input type="text" class="input input-sm w-full" readonly value="${escapeHtml(lastInterceptedOAuthUrl)}" onclick="this.select()" />`;
        }
      } catch {
        qrContainer.innerHTML = `<p class="text-sm text-muted">Échec de génération du QR code local.</p><input type="text" class="input input-sm w-full" readonly value="${escapeHtml(lastInterceptedOAuthUrl)}" onclick="this.select()" />`;
      }
    }
    if (qrModal) qrModal.hidden = false;
  });

  dismissBtn?.addEventListener('click', () => {
    if (banner) banner.style.display = 'none';
  });

  const closeQr = () => {
    if (qrModal) qrModal.hidden = true;
  };
  qrClose?.addEventListener('click', closeQr);
  qrCloseBtn?.addEventListener('click', closeQr);
}

// ── Ping-Pong Modal & Batch Benchmark ───────────────────────────────────────
function setupPingPongModal(): void {
  const modal = document.getElementById('pingPongModalBackdrop');
  const openBtn = document.getElementById('modelsPingPongBtn');
  const closeBtn = document.getElementById('pingPongModalClose');
  const footerCloseBtn = document.getElementById('pingPongFooterClose');
  const runBatchBtn = document.getElementById('pingPongRunBatchBtn');
  const promptInput = document.getElementById('pingPongCustomPrompt') as HTMLInputElement | null;
  const progressEl = document.getElementById('pingPongBatchProgress');
  const tableBody = document.getElementById('pingPongTableBody');

  const closeModal = () => {
    if (modal) modal.hidden = true;
  };

  closeBtn?.addEventListener('click', closeModal);
  footerCloseBtn?.addEventListener('click', closeModal);

  openBtn?.addEventListener('click', () => {
    if (!modal || !tableBody) return;
    modal.hidden = false;

    const activeModels = allLoadedModels.filter((m) => m.enabled !== false);
    if (activeModels.length === 0) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="5" style="padding: 24px; text-align: center; color: var(--text-2);">
            No active models found. Enable or add models in the list.
          </td>
        </tr>
      `;
      return;
    }

    tableBody.innerHTML = activeModels.map((m) => `
      <tr data-ping-model="${escapeHtml(m.name)}" style="border-bottom: 1px solid var(--border);">
        <td style="padding: 10px 12px; font-weight: 500;">
          ${escapeHtml(m.displayName || m.name)}
          <div style="font-size: 11px; color: var(--text-3); font-family: var(--font-mono);">${escapeHtml(m.name)}</div>
        </td>
        <td style="padding: 10px 12px;">
          <span class="badge badge-muted">${escapeHtml(m.provider || 'custom')}</span>
        </td>
        <td style="padding: 10px 12px;" class="ping-status-cell">
          <span class="badge badge-ghost" style="opacity: 0.6;">Pending</span>
        </td>
        <td style="padding: 10px 12px; max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-mono); font-size: 11px; color: var(--text-2);" class="ping-pong-cell">
          —
        </td>
        <td style="padding: 10px 12px; text-align: right;">
          <button class="btn btn-ghost btn-sm ping-single-btn" data-model="${escapeHtml(m.name)}" type="button" aria-label="Ping ${escapeHtml(m.name)}">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:-1px; margin-right:3px;"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>Ping
          </button>
        </td>
      </tr>
    `).join('');
  });

  tableBody?.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;
    const btn = target.closest<HTMLButtonElement>('.ping-single-btn');
    if (!btn) return;
    const modelName = btn.dataset.model;
    if (!modelName) return;

    const row = btn.closest('tr');
    const statusCell = row?.querySelector('.ping-status-cell');
    const pongCell = row?.querySelector('.ping-pong-cell');
    const prompt = promptInput?.value?.trim() || 'ping';

    const targetModel = allLoadedModels.find((m) => m.name === modelName) || { name: modelName };
    btn.disabled = true;
    if (statusCell) statusCell.innerHTML = '<span class="spinner"></span> <span style="font-size: 11px;">Ping…</span>';

    try {
      const res = await testSingleModel(targetModel, prompt);
      if (statusCell) statusCell.innerHTML = renderPingBadge(res);
      if (pongCell) pongCell.textContent = res.pongText || (res.ok ? '(Empty response)' : res.error || 'Error');
    } catch (err) {
      if (statusCell) statusCell.innerHTML = '<span class="ping-badge ping-badge-error">❌ Error</span>';
      if (pongCell) pongCell.textContent = (err as Error).message;
    } finally {
      btn.disabled = false;
    }
  });

  runBatchBtn?.addEventListener('click', async () => {
    const activeModels = allLoadedModels.filter((m) => m.enabled !== false);
    if (activeModels.length === 0) {
      toast('No active models to test', 'warn');
      return;
    }

    const prompt = promptInput?.value?.trim() || 'ping';
    if (runBatchBtn) (runBatchBtn as HTMLButtonElement).disabled = true;
    if (progressEl) {
      progressEl.style.display = 'inline-block';
      progressEl.textContent = `0 / ${activeModels.length} tested…`;
    }

    try {
      await testBatchModels(activeModels, (done: number, total: number, res: PingPongResult) => {
        if (progressEl) progressEl.textContent = `${done} / ${total} tested…`;
        const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(res.modelName) : res.modelName.replace(/"/g, '\\"');
        const row = tableBody?.querySelector(`tr[data-ping-model="${escaped}"]`);
        if (row) {
          const statusCell = row.querySelector('.ping-status-cell');
          const pongCell = row.querySelector('.ping-pong-cell');
          if (statusCell) statusCell.innerHTML = renderPingBadge(res);
          if (pongCell) pongCell.textContent = res.pongText || (res.ok ? '(Réponse vide)' : res.error || 'Erreur');
        }
      }, prompt);
      toast(`Test Ping-Pong terminé pour ${activeModels.length} modèles`, 'ok');
    } finally {
      if (runBatchBtn) (runBatchBtn as HTMLButtonElement).disabled = false;
      if (progressEl) progressEl.style.display = 'none';
    }
  });
}

// Initialize OAuth Interception and Ping-Pong modal handlers
setupOAuthInterception();
setupPingPongModal();

// Global Escape key listener for accessible modal dismissal
document.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    const openBackdrops = Array.from(document.querySelectorAll('.modal-backdrop:not([hidden])')) as HTMLElement[];
    for (const b of openBackdrops) {
      if (b.style.display !== 'none') {
        b.hidden = true;
        b.classList.remove('open');
      }
    }
  }
});

