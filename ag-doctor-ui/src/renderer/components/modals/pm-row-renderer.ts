/**
 * pm-row-renderer.ts — HTML renderer for Provider Manager list rows and status indicators.
 * Extracted from modal-provider.ts for Single Responsibility (SRP).
 */

function renderHealthStatusIndicator(p: any): string {
  let status = p.status || 'untested';
  if (Array.isArray(p.accounts) && p.accounts.length > 0) {
    const accs = p.accounts as any[];
    if (accs.some((a) => a.status === 'healthy')) status = 'healthy';
    else if (accs.some((a) => a.status === 'degraded')) status = 'degraded';
    else if (accs.every((a) => a.status === 'offline')) status = 'offline';
  }
  const titleText = status === 'healthy'
    ? `Healthy · ${p.latencyMs ?? 0}ms response time`
    : status === 'degraded'
    ? `Degraded · ${p.latencyMs ?? 0}ms response time (Slow)`
    : status === 'offline'
    ? `Offline · ${escapeHtml(p.lastError || 'Unreachable')}`
    : 'Untested connection';

  let html = `<span class="agy-status-dot ${status}" title="${escapeHtml(titleText)}"></span>`;
  if (typeof p.latencyMs === 'number' && status !== 'untested') {
    html += `<span class="agy-latency-badge ${status}" title="${escapeHtml(titleText)}">${p.latencyMs} ms</span>`;
  }
  return html;
}

function renderProviderStatus(p: any): string {
  if (!p.enabled) {
    return `<span class="agy-pill agy-pill-muted">Disabled</span>`;
  }
  let status = p.status || 'untested';
  if (Array.isArray(p.accounts) && p.accounts.length > 0) {
    const accs = p.accounts as any[];
    if (accs.some((a) => a.status === 'healthy')) status = 'healthy';
    else if (accs.some((a) => a.status === 'degraded')) status = 'degraded';
    else if (accs.every((a) => a.status === 'offline')) status = 'offline';
  }
  if (status === 'offline') {
    return `<span class="agy-pill agy-pill-offline">Offline</span>`;
  }
  if (status === 'degraded') {
    return `<span class="agy-pill agy-pill-degraded">Degraded</span>`;
  }
  if (status === 'healthy') {
    return `<span class="agy-pill agy-pill-ok">Healthy</span>`;
  }
  return `<span class="agy-pill agy-pill-muted">Untested</span>`;
}

function renderProviderRowHtml(p: any): string {
  const accountsCount = Array.isArray(p.accounts) ? p.accounts.length : 0;
  const accountsMeta = accountsCount > 0
    ? `<span class="agy-dot">·</span><span style="color:var(--text-accent, #38bdf8); font-weight:600; font-size:11px;">${accountsCount} account${accountsCount > 1 ? 's' : ''}</span>`
    : '';

  return `
    <div class="agy-provider-row" data-id="${escapeHtml(p.id)}">
      <div class="agy-provider-row-main">
        <div class="agy-provider-row-name" style="display:flex; align-items:center;">
          ${renderHealthStatusIndicator(p)}
          <span>${escapeHtml(p.name)}</span>
        </div>
        <div class="agy-provider-row-meta">
          <span class="agy-provider-badge ${escapeHtml(p.provider)}">${escapeHtml(p.provider)}</span>
          <span class="agy-dot">·</span>
          <span>${escapeHtml((p.apiUrl || '').replace(/^https?:\/\//, '').replace(/\/$/, ''))}</span>
          <span class="agy-dot">·</span>
          <span>${(p.models || []).length} models</span>
          ${accountsMeta}
        </div>
        <div style="display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px;">
          ${(p.models || []).slice(0, 6).map((m: any) => {
            const isEn = m.enabled !== false;
            const cleanName = (m.displayName || m.name || m.id || '').replace(/^\[[^\]]+\]\s*/, '').replace(/^models\//, '');
            return `<span style="font-size: 10px; padding: 1px 6px; border-radius: 4px; background: ${isEn ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)'}; color: ${isEn ? 'var(--text-1)' : 'var(--text-3)'}; border: 1px solid rgba(255,255,255,0.08); font-family: var(--font-mono);">${escapeHtml(cleanName)}</span>`;
          }).join('')}
          ${(p.models || []).length > 6 ? `<span style="font-size: 10px; color: var(--text-3); align-self: center;">+${p.models.length - 6} more</span>` : ''}
        </div>
      </div>
      <div class="agy-provider-row-status">${renderProviderStatus(p)}</div>
      <div class="agy-provider-row-actions">
        <button class="agy-icon-btn pm-test" title="Test connection" aria-label="Test connection for ${escapeHtml(p.name)}">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
        </button>
        <button class="agy-icon-btn pm-toggle" title="${p.enabled ? 'Disable' : 'Enable'} provider" aria-label="${p.enabled ? 'Disable' : 'Enable'} provider ${escapeHtml(p.name)}">
          ${p.enabled
            ? `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>`
            : `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.64 18.36a9 9 0 1 0 12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/><polyline points="16 8 12 12 8 8"/></svg>`
          }
        </button>
        <button class="agy-icon-btn pm-edit" title="Edit provider" aria-label="Edit provider ${escapeHtml(p.name)}">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="agy-icon-btn pm-delete" title="Delete provider" aria-label="Delete provider ${escapeHtml(p.name)}">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
        </button>
      </div>
    </div>
  `;
}

if (typeof window !== 'undefined') {
  (window as any).renderHealthStatusIndicator = renderHealthStatusIndicator;
  (window as any).renderProviderStatus = renderProviderStatus;
  (window as any).renderProviderRowHtml = renderProviderRowHtml;
}
