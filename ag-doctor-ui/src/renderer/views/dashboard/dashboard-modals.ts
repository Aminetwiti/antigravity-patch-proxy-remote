/**
 * dashboard-modals.ts — Token Detail Modal & Antigravity Token Wrapped Modal.
 * Extracted from view-dashboard.ts for Single Responsibility (SRP) and modularity.
 */

let currentSelectedModalTokenEntry: any = null;

function openTokenDetailModal(entry: any): void {
  const tokenDetailBackdrop = document.getElementById('tokenDetailBackdrop') as HTMLDivElement | null;
  const tokenDetailTitle = document.getElementById('tokenDetailTitle');
  const tokenDetailMeta = document.getElementById('tokenDetailMeta');
  const tokenDetailPrompt = document.getElementById('tokenDetailPrompt');
  const tokenDetailCompletion = document.getElementById('tokenDetailCompletion');
  const tokenDetailTotal = document.getElementById('tokenDetailTotal');
  const tokenDetailCost = document.getElementById('tokenDetailCost');
  const tokenDetailRaw = document.getElementById('tokenDetailRaw');

  if (!tokenDetailBackdrop) return;
  currentSelectedModalTokenEntry = entry;
  if (tokenDetailTitle) tokenDetailTitle.textContent = `${entry.model} (${entry.provider})`;
  if (tokenDetailMeta) {
    const dt = new Date(entry.timestamp).toLocaleString();
    tokenDetailMeta.textContent = `ID: ${entry.id} | Statut: ${entry.status} | Latence: ${entry.latencyMs}ms | Débit: ${entry.tokensPerSec} tok/s | Date: ${dt}`;
  }
  if (tokenDetailPrompt) tokenDetailPrompt.textContent = entry.promptTokens.toLocaleString();
  if (tokenDetailCompletion) tokenDetailCompletion.textContent = entry.completionTokens.toLocaleString();
  if (tokenDetailTotal) tokenDetailTotal.textContent = entry.totalTokens.toLocaleString();
  if (tokenDetailCost) tokenDetailCost.textContent = `$${entry.estimatedCost.toFixed(4)}`;
  if (tokenDetailRaw) tokenDetailRaw.textContent = JSON.stringify(entry, null, 2);

  tokenDetailBackdrop.hidden = false;
  tokenDetailBackdrop.classList.add('open');
}

function closeTokenDetailModal(): void {
  const tokenDetailBackdrop = document.getElementById('tokenDetailBackdrop') as HTMLDivElement | null;
  if (!tokenDetailBackdrop) return;
  currentSelectedModalTokenEntry = null;
  tokenDetailBackdrop.hidden = true;
  tokenDetailBackdrop.classList.remove('open');
}

function openTokenWrappedModal(): void {
  const backdrop = document.getElementById('tokenWrappedBackdrop') as HTMLDivElement | null;
  if (!backdrop) return;

  const lifetimeEl = document.getElementById('wrappedLifetimeTokens');
  const tasksCountEl = document.getElementById('wrappedTasksCount');
  const peakDayEl = document.getElementById('wrappedPeakDay');
  const maxStreakEl = document.getElementById('wrappedMaxStreak');
  const topModelEl = document.getElementById('wrappedTopModel');
  const savingsEl = document.getElementById('wrappedSavings');
  const tierBadgeEl = document.getElementById('wrappedTierBadge');
  const feedbackEl = document.getElementById('wrappedCopyFeedback');
  if (feedbackEl) feedbackEl.style.opacity = '0';

  const realStats = (window as any).cachedRealStats;
  const lifetime = realStats?.estimatedLifetimeTokens || 123_700_000;
  const peak = realStats?.peakTokensDay?.tokens || 4_200_000;
  const maxStreak = realStats?.longestStreakDays || 18;
  const topModel = realStats?.modelsDistribution?.[0]?.model || 'Gemini 3.8 Flash';
  const totalConvs = realStats?.totalConversations || 171;
  const totalSteps = realStats?.totalSteps || 66848;
  const savings = (lifetime / 1_000_000) * 0.35;

  const fmtTokens = typeof formatCompactTokens === 'function' ? formatCompactTokens : (window as any).formatCompactTokens;

  if (lifetimeEl) lifetimeEl.textContent = fmtTokens(lifetime);
  if (tasksCountEl) tasksCountEl.textContent = `${totalSteps.toLocaleString('fr-FR')} étapes across ${totalConvs.toLocaleString('fr-FR')} sessions`;
  if (peakDayEl) peakDayEl.textContent = `${fmtTokens(peak)} tok`;
  if (maxStreakEl) maxStreakEl.textContent = `${maxStreak} jours`;
  if (topModelEl) topModelEl.textContent = topModel.replace(/^models\//, '');
  if (savingsEl) savingsEl.textContent = `$${savings.toFixed(2)}`;
  if (tierBadgeEl) {
    tierBadgeEl.textContent = lifetime >= 100_000_000 ? 'Titan (100M+)' : lifetime >= 10_000_000 ? 'Power User' : 'Explorer';
  }

  backdrop.hidden = false;
  backdrop.classList.add('open');
}

function closeTokenWrappedModal(): void {
  const backdrop = document.getElementById('tokenWrappedBackdrop') as HTMLDivElement | null;
  if (!backdrop) return;
  backdrop.hidden = true;
  backdrop.classList.remove('open');
}

function copyTokenWrappedSummary(): void {
  const realStats = (window as any).cachedRealStats;
  const lifetime = realStats?.estimatedLifetimeTokens || 123_700_000;
  const peak = realStats?.peakTokensDay?.tokens || 4_200_000;
  const maxStreak = realStats?.longestStreakDays || 18;
  const topModel = (realStats?.modelsDistribution?.[0]?.model || 'Gemini 3.8 Flash').replace(/^models\//, '');
  const totalConvs = realStats?.totalConversations || 171;
  const totalSteps = realStats?.totalSteps || 66848;

  const fmtTokens = typeof formatCompactTokens === 'function' ? formatCompactTokens : (window as any).formatCompactTokens;

  const text = `✨ Mon Antigravity Token Wrapped :
🔥 Lifetime Tokens: ${fmtTokens(lifetime)}
⚡ Record Quotidien: ${fmtTokens(peak)} tokens
🏆 Record Série: ${maxStreak} jours consécutifs
🤖 Modèle de prédilection: ${topModel}
📊 ${totalSteps.toLocaleString('fr-FR')} étapes dans ${totalConvs} sessions

Propulsé par Google Antigravity IDE 🚀 #AntigravityAI #GoogleAntigravity`;

  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => {
      const feedbackEl = document.getElementById('wrappedCopyFeedback');
      if (feedbackEl) {
        feedbackEl.style.opacity = '1';
        setTimeout(() => { if (feedbackEl) feedbackEl.style.opacity = '0'; }, 2500);
      }
      toast('Stats copiées dans le presse-papiers !', 'ok', 1800);
    }).catch(() => {
      toast('Erreur lors de la copie', 'err', 1500);
    });
  }
}

function initDashboardModals(): void {
  const tokenDetailCloseBtn = document.getElementById('tokenDetailCloseBtn');
  const tokenDetailFooterCloseBtn = document.getElementById('tokenDetailFooterCloseBtn');
  const tokenDetailBackdrop = document.getElementById('tokenDetailBackdrop');
  const tokenCopyJsonBtn = document.getElementById('tokenCopyJsonBtn');

  if (tokenDetailCloseBtn && !tokenDetailCloseBtn.dataset.bound) {
    tokenDetailCloseBtn.dataset.bound = '1';
    tokenDetailCloseBtn.addEventListener('click', closeTokenDetailModal);
  }
  if (tokenDetailFooterCloseBtn && !tokenDetailFooterCloseBtn.dataset.bound) {
    tokenDetailFooterCloseBtn.dataset.bound = '1';
    tokenDetailFooterCloseBtn.addEventListener('click', closeTokenDetailModal);
  }
  if (tokenDetailBackdrop && !tokenDetailBackdrop.dataset.bound) {
    tokenDetailBackdrop.dataset.bound = '1';
    tokenDetailBackdrop.addEventListener('click', (ev) => {
      if (ev.target === tokenDetailBackdrop) closeTokenDetailModal();
    });
  }
  if (tokenCopyJsonBtn && !tokenCopyJsonBtn.dataset.bound) {
    tokenCopyJsonBtn.dataset.bound = '1';
    tokenCopyJsonBtn.addEventListener('click', () => {
      if (currentSelectedModalTokenEntry && navigator.clipboard) {
        navigator.clipboard.writeText(JSON.stringify(currentSelectedModalTokenEntry, null, 2)).then(() => {
          toast('JSON copié dans le presse-papiers !', 'ok', 1600);
        }).catch(() => {});
      }
    });
  }

  // Token Wrapped Modal bindings
  const tokenShareWrappedBtn = document.getElementById('tokenShareWrappedBtn');
  const tokenWrappedCloseBtn = document.getElementById('tokenWrappedCloseBtn');
  const tokenWrappedFooterCloseBtn = document.getElementById('tokenWrappedFooterCloseBtn');
  const tokenWrappedBackdrop = document.getElementById('tokenWrappedBackdrop');
  const tokenWrappedCopyBtn = document.getElementById('tokenWrappedCopyBtn');

  if (tokenShareWrappedBtn && !tokenShareWrappedBtn.dataset.bound) {
    tokenShareWrappedBtn.dataset.bound = '1';
    tokenShareWrappedBtn.addEventListener('click', openTokenWrappedModal);
  }
  if (tokenWrappedCloseBtn && !tokenWrappedCloseBtn.dataset.bound) {
    tokenWrappedCloseBtn.dataset.bound = '1';
    tokenWrappedCloseBtn.addEventListener('click', closeTokenWrappedModal);
  }
  if (tokenWrappedFooterCloseBtn && !tokenWrappedFooterCloseBtn.dataset.bound) {
    tokenWrappedFooterCloseBtn.dataset.bound = '1';
    tokenWrappedFooterCloseBtn.addEventListener('click', closeTokenWrappedModal);
  }
  if (tokenWrappedBackdrop && !tokenWrappedBackdrop.dataset.bound) {
    tokenWrappedBackdrop.dataset.bound = '1';
    tokenWrappedBackdrop.addEventListener('click', (ev) => {
      if (ev.target === tokenWrappedBackdrop) closeTokenWrappedModal();
    });
  }
  if (tokenWrappedCopyBtn && !tokenWrappedCopyBtn.dataset.bound) {
    tokenWrappedCopyBtn.dataset.bound = '1';
    tokenWrappedCopyBtn.addEventListener('click', copyTokenWrappedSummary);
  }
}

if (typeof window !== 'undefined') {
  (window as any).openTokenDetailModal = openTokenDetailModal;
  (window as any).closeTokenDetailModal = closeTokenDetailModal;
  (window as any).openTokenWrappedModal = openTokenWrappedModal;
  (window as any).closeTokenWrappedModal = closeTokenWrappedModal;
  (window as any).copyTokenWrappedSummary = copyTokenWrappedSummary;
  (window as any).initDashboardModals = initDashboardModals;
}
