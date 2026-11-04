/**
 * google-account-quota-renderer.ts — Quota Block & Extra Groups HTML Renderer.
 * Decoupled from view-google-accounts.ts for Single Responsibility and modularity.
 */

import {
  isAiStudioAccount,
  isGeminiCliAccount,
  getQuotaColor,
  formatQuotaPercent,
  estimateAccountTokens,
  getAccountEffectiveQuotas,
} from '../../services/accounts/google-accounts-analyzer';

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
    const lastRefresh = typeof window !== 'undefined' && typeof (window as any).gaLastQuotaRefreshTimestamp === 'number'
      ? (window as any).gaLastQuotaRefreshTimestamp
      : 0;
    const ageMin = lastRefresh > 0 ? Math.floor((Date.now() - lastRefresh) / 60_000) : null;
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

  const lastRefresh = typeof window !== 'undefined' && typeof (window as any).gaLastQuotaRefreshTimestamp === 'number'
    ? (window as any).gaLastQuotaRefreshTimestamp
    : 0;
  const quotaAgeMin = lastRefresh > 0 ? Math.floor((Date.now() - lastRefresh) / 60_000) : null;
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

if (typeof window !== 'undefined') {
  (window as any).renderAccountQuotaBlock = renderAccountQuotaBlock;
  (window as any).renderDynamicExtraQuotaGroups = renderDynamicExtraQuotaGroups;
}
