/**
 * Provider Row Card UI Component
 */
import { storageAPI } from '../api';
import { getProviderColor, fetchModelsFromProvider, renderCustomModelsList } from '../model-fetcher';
import type { ProviderFileEntry } from '../types';
import type { ProviderModalContext } from './providerModal';

export function createProviderCard(p: ProviderFileEntry, ctx: ProviderModalContext): HTMLElement {
  const row = document.createElement('div');
  row.className = 'agy-provider-row';

  const rowHeader = document.createElement('div');
  rowHeader.className = 'agy-row-header';

  const info = document.createElement('div');
  info.className = 'agy-row-info';

  const statusDot = document.createElement('span');
  statusDot.className = 'agy-status-dot agy-status-off';
  statusDot.title = 'Health status: untested';

  const title = document.createElement('div');
  title.className = 'agy-row-name';
  title.textContent = p.name || p.provider;

  const badge = document.createElement('span');
  badge.className = 'agy-badge';
  const badgeColor = getProviderColor(p.provider);
  badge.style.backgroundColor = badgeColor + '22';
  badge.style.color = badgeColor;
  badge.textContent = p.provider;

  const enabledCount = p.models ? p.models.filter((m) => m.enabled).length : 0;
  const totalCount = p.models ? p.models.length : 0;

  const url = document.createElement('div');
  url.className = 'agy-row-sub';
  url.textContent = `${p.apiUrl} • ${enabledCount}/${totalCount} models active`;

  info.appendChild(statusDot);
  info.appendChild(title);
  info.appendChild(badge);

  // Active / Inactive Toggle Switch
  const toggleWrap = document.createElement('label');
  toggleWrap.style.display = 'inline-flex';
  toggleWrap.style.alignItems = 'center';
  toggleWrap.style.gap = '6px';
  toggleWrap.style.cursor = 'pointer';
  toggleWrap.style.fontSize = '12px';
  toggleWrap.style.color = 'var(--agy-ink-secondary)';
  toggleWrap.title = p.enabled !== false ? 'Provider Active (click to disable)' : 'Provider Inactive (click to enable)';

  const toggleChk = document.createElement('input');
  toggleChk.type = 'checkbox';
  toggleChk.className = 'agy-form-checkbox';
  toggleChk.checked = p.enabled !== false;
  toggleChk.addEventListener('change', async (e) => {
    p.enabled = (e.target as HTMLInputElement).checked;
    await storageAPI.saveProvider(p);
    await renderCustomModelsList();
    void ctx.loadProvidersList();
  });

  const toggleLbl = document.createElement('span');
  toggleLbl.textContent = p.enabled !== false ? 'Active' : 'Inactive';
  toggleWrap.appendChild(toggleChk);
  toggleWrap.appendChild(toggleLbl);

  const actions = document.createElement('div');
  actions.className = 'agy-row-actions';

  // Health test button
  const healthBtn = document.createElement('button');
  healthBtn.className = 'agy-btn-ghost';
  healthBtn.title = 'Test connection & health';
  healthBtn.setAttribute('aria-label', `Test connection for ${p.name}`);
  healthBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`;
  healthBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    healthBtn.disabled = true;
    healthBtn.style.color = '#fbbf24';
    healthBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: ag-spin 0.8s linear infinite;"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>`;
    try {
      const res = await storageAPI.testModelConnection({
        apiUrl: p.apiUrl,
        provider: p.provider,
        apiKey: p.apiKey,
        allowUnauthorized: p.allowUnauthorized,
      });
      if (res.success) {
        statusDot.className = 'agy-status-dot agy-status-on';
        statusDot.title = 'Health: Healthy ✓';
        healthBtn.style.color = 'var(--agy-success)';
        healthBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`;
      } else {
        statusDot.className = 'agy-status-dot';
        statusDot.style.backgroundColor = 'var(--agy-danger)';
        statusDot.title = 'Health error: ' + (res.error || 'Connection failed');
        healthBtn.style.color = 'var(--agy-danger)';
        healthBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
      }
    } catch {
      statusDot.className = 'agy-status-dot';
      statusDot.style.backgroundColor = 'var(--agy-danger)';
      healthBtn.style.color = 'var(--agy-danger)';
    } finally {
      setTimeout(() => {
        healthBtn.disabled = false;
        healthBtn.style.color = '';
        healthBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`;
      }, 3000);
    }
  });

  // Fetch / Sync models for this specific provider
  const fetchRowBtn = document.createElement('button');
  fetchRowBtn.className = 'agy-btn-ghost';
  fetchRowBtn.title = 'Fetch & Sync Models';
  fetchRowBtn.setAttribute('aria-label', `Fetch models for ${p.name}`);
  fetchRowBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`;
  fetchRowBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    fetchRowBtn.disabled = true;
    fetchRowBtn.style.color = '#388bfd';
    fetchRowBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: ag-spin 0.8s linear infinite;"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>`;
    try {
      const res = await fetchModelsFromProvider({
        baseUrl: p.apiUrl,
        apiUrl: p.apiUrl,
        apiKey: p.apiKey,
        provider: p.provider,
        allowUnauthorized: p.allowUnauthorized,
      });
      if (res.success && res.models) {
        const existingMap = new Map((p.models || []).map((x) => [x.id, x]));
        p.models = res.models.map((m: any) => {
          const ext = existingMap.get(m.id);
          return ext ? ext : { id: m.id, displayName: m.displayName || m.id, enabled: true };
        });
        await storageAPI.saveProvider(p);
        await renderCustomModelsList();
        fetchRowBtn.style.color = 'var(--agy-success)';
        fetchRowBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>`;
      } else {
        fetchRowBtn.style.color = 'var(--agy-danger)';
      }
    } catch {
      fetchRowBtn.style.color = 'var(--agy-danger)';
    } finally {
      setTimeout(() => {
        fetchRowBtn.disabled = false;
        fetchRowBtn.style.color = '';
        fetchRowBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`;
        void ctx.loadProvidersList();
      }, 2000);
    }
  });

  // Edit button
  const editBtn = document.createElement('button');
  editBtn.className = 'agy-btn-ghost';
  editBtn.title = 'Edit Provider';
  editBtn.setAttribute('aria-label', `Edit provider ${p.name}`);
  editBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
  editBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    ctx.showFormView(p);
  });

  // Delete button with dark inline confirm
  const delBtn = document.createElement('button');
  delBtn.className = 'agy-btn-ghost';
  delBtn.title = 'Delete Provider';
  delBtn.setAttribute('aria-label', `Delete provider ${p.name}`);
  delBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
  delBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    actions.replaceChildren();

    const confirmText = document.createElement('span');
    confirmText.className = 'agy-row-sub';
    confirmText.textContent = 'Delete?';
    confirmText.style.alignSelf = 'center';
    confirmText.style.color = 'var(--agy-danger)';
    confirmText.style.fontWeight = '500';

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'agy-btn-danger';
    confirmBtn.textContent = 'Delete';
    confirmBtn.setAttribute('aria-label', `Confirm deletion of ${p.name}`);
    confirmBtn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      confirmBtn.disabled = true;
      await storageAPI.deleteProvider(p.id);
      await renderCustomModelsList();
      void ctx.loadProvidersList();
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'agy-btn-ghost';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      actions.replaceChildren(healthBtn, fetchRowBtn, editBtn, delBtn);
    });

    actions.appendChild(confirmText);
    actions.appendChild(confirmBtn);
    actions.appendChild(cancelBtn);
  });

  actions.appendChild(healthBtn);
  actions.appendChild(fetchRowBtn);
  actions.appendChild(editBtn);
  actions.appendChild(delBtn);

  rowHeader.appendChild(info);
  rowHeader.appendChild(toggleWrap);
  rowHeader.appendChild(actions);

  row.appendChild(rowHeader);
  row.appendChild(url);
  return row;
}
