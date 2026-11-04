/**
 * ga-status-helpers.ts — Status, Tier, and Cooldown evaluation helpers for Google Accounts.
 * Extracted from view-google-accounts.ts for Single Responsibility (SRP).
 */

export function isAccountValidationRequired(a: any): boolean {
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

export function isAccountUnlicensed(a: any): boolean {
  if (!a) return false;
  return Boolean(a.isUnlicensed || a.quotas?.isUnlicensed);
}

export function hasAccountErrorOrValidation(a: any): boolean {
  if (!a) return false;
  if (isAccountValidationRequired(a)) return true;
  if (a.isUnlicensed || a.quotas?.isUnlicensed) return true;
  if (a.errorDetails || a.quotas?.errorDetails) return true;
  if (a.status === 'unhealthy' || a.status === 'blocked' || a.status === 'validation_required') return true;
  if (a.lastError && (a.lastError.includes('403') || a.lastError.includes('Terms of Service') || a.lastError.includes('PERMISSION_DENIED'))) return true;
  return false;
}

export function getAccountActiveCooldown(
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
  const cache = (window as any).gaActiveCooldownsCache || {};

  for (const [k, v] of Object.entries(cache) as [string, any][]) {
    if (!v || v.until <= now) continue;
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

export function maskKeyPreview(key: string): string {
  if (!key || key === 'none') return '(none)';
  if (key.startsWith('enc:')) return '•••••••• (encrypted)';
  if (key.length <= 8) return '••••••••';
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

export function formatResetCountdown(isoDateStr?: string): string {
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

export function formatCompactCountdown(isoDateStr?: string): string {
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

export function formatLastUsed(ts?: number | string): string {
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
  const esc = (window as any).escapeHtml || ((s: string) => s);
  return `<span title="${esc(full)}" style="color: var(--text-2, #a1a1aa); font-weight: 500; cursor: help;">${esc(rel)}</span>`;
}

export function getQuotaColor(pct: number): string {
  if (pct > 50) return '#10b981';
  if (pct >= 20) return '#f59e0b';
  return '#f43f5e';
}

export function getAccountTier(acc: any): 'PRO' | 'ULTRA' | 'FREE' | 'STUDIO' | 'CLI' | 'PARTAGE' {
  const isStudio = (window as any).isAiStudioAccount;
  const isCli = (window as any).isGeminiCliAccount;
  if (typeof isStudio === 'function' && isStudio(acc)) return 'STUDIO';
  if (typeof isCli === 'function' && isCli(acc)) return 'CLI';
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

if (typeof window !== 'undefined') {
  (window as any).isAccountValidationRequired = isAccountValidationRequired;
  (window as any).isAccountUnlicensed = isAccountUnlicensed;
  (window as any).hasAccountErrorOrValidation = hasAccountErrorOrValidation;
  (window as any).getAccountActiveCooldown = getAccountActiveCooldown;
  (window as any).maskKeyPreview = maskKeyPreview;
  (window as any).formatResetCountdown = formatResetCountdown;
  (window as any).formatCompactCountdown = formatCompactCountdown;
  (window as any).formatLastUsed = formatLastUsed;
  (window as any).getQuotaColor = getQuotaColor;
  (window as any).getAccountTier = getAccountTier;
}
