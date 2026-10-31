/**
 * Module 1: Custom Provider Manager
 *
 * Responsibilities:
 * - Provider CRUD (Create, Read/List, Update, Delete)
 * - Provider active/inactive toggles & health status testing
 * - Import & Export of provider configuration strings
 * - Provider Manager Modal UI shell and navigation (List View & Form View)
 */

import { storageAPI } from './api';
import { preloadLog } from './logger';
import type { ProviderFileEntry, ProviderModelEntry } from './types';
import { PROVIDER_PRESETS } from './types';
import {
  getProviderColor,
  prefersReducedMotion,
  fetchModelsFromProvider,
  renderFetchedModelsList,
  renderCustomModelsList,
} from './model-fetcher';

export function getFocusableElements(root: HTMLElement): HTMLElement[] {
  const selector = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');
  return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(
    (el) => !el.hasAttribute('inert') && el.offsetParent !== null,
  );
}

/**
 * Open the Provider Manager Modal.
 */
export function openProviderManagerModal(existingProvider?: ProviderFileEntry): void {
  const existing = document.getElementById('agy-modal-overlay');
  if (existing) existing.remove();

  const triggerElement = document.activeElement as HTMLElement | null;

  const overlay = document.createElement('div');
  overlay.id = 'agy-modal-overlay';
  overlay.className = 'agy-overlay';

  const modal = document.createElement('div');
  modal.className = 'agy-modal agy-modal-lg';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'agy-modal-title');

  // ─── Modal Header ──────────────────────────────────────────────────
  const header = document.createElement('div');
  header.className = 'agy-modal-header';

  const titleWrap = document.createElement('div');
  titleWrap.className = 'agy-modal-header-title-wrap';
  const titleIcon = document.createElement('div');
  titleIcon.className = 'agy-modal-header-icon';
  titleIcon.textContent = '☁️';
  const titleText = document.createElement('h2');
  titleText.id = 'agy-modal-title';
  titleText.textContent = 'Provider Manager';
  titleWrap.appendChild(titleIcon);
  titleWrap.appendChild(titleText);

  const headerActions = document.createElement('div');
  headerActions.style.display = 'flex';
  headerActions.style.alignItems = 'center';
  headerActions.style.gap = '8px';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'agy-icon-btn modal-close';
  closeBtn.setAttribute('aria-label', 'Close Provider Manager');
  closeBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

  header.appendChild(titleWrap);
  header.appendChild(headerActions);
  header.appendChild(closeBtn);
  modal.appendChild(header);

  // ─── Modal Body ────────────────────────────────────────────────────
  const body = document.createElement('div');
  body.className = 'agy-modal-body';

  const listContainer = document.createElement('div');
  listContainer.className = 'agy-modal-list';
  listContainer.style.display = 'flex';

  const formContainer = document.createElement('form');
  formContainer.id = 'agy-addModelForm';
  formContainer.className = 'agy-modal-form';
  formContainer.style.display = 'none';

  body.appendChild(listContainer);
  body.appendChild(formContainer);

  // ─── Modal Footer ──────────────────────────────────────────────────
  const footer = document.createElement('div');
  footer.className = 'agy-modal-footer';

  modal.appendChild(body);
  modal.appendChild(footer);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const closeModal = (): void => {
    overlay.remove();
    document.removeEventListener('keydown', keyHandler);
    void renderCustomModelsList();
    if (triggerElement && typeof triggerElement.focus === 'function') {
      try { triggerElement.focus(); } catch { /* no-op */ }
    }
  };

  closeBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay) closeModal();
  });

  const keyHandler = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      closeModal();
      return;
    }
    if (ev.key === 'Tab') {
      const focusable = getFocusableElements(modal);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (ev.shiftKey && document.activeElement === first) {
        ev.preventDefault();
        last.focus();
      } else if (!ev.shiftKey && document.activeElement === last) {
        ev.preventDefault();
        first.focus();
      }
    }
  };
  document.addEventListener('keydown', keyHandler);

  if (prefersReducedMotion()) {
    overlay.classList.add('agy-no-motion');
  } else {
    overlay.classList.add('agy-anim-in');
  }

  // ─── View Switchers ────────────────────────────────────────────────
  function showListView(): void {
    listContainer.style.display = 'flex';
    formContainer.style.display = 'none';
    titleIcon.textContent = '☁️';
    titleText.textContent = 'Provider Manager';

    headerActions.replaceChildren();

    const addProvBtn = document.createElement('button');
    addProvBtn.type = 'button';
    addProvBtn.className = 'agy-btn-primary';
    addProvBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add Provider`;
    addProvBtn.addEventListener('click', () => showFormView());

    const syncAllBtn = document.createElement('button');
    syncAllBtn.type = 'button';
    syncAllBtn.className = 'agy-btn-ghost';
    syncAllBtn.title = 'Fetch & Sync Models for All Providers';
    syncAllBtn.setAttribute('aria-label', 'Sync All Providers Models');
    syncAllBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`;
    syncAllBtn.addEventListener('click', async () => {
      syncAllBtn.disabled = true;
      const originalHtml = syncAllBtn.innerHTML;
      syncAllBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: ag-spin 0.8s linear infinite;"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>`;
      try {
        const providers = await storageAPI.getProviders();
        for (const p of providers) {
          if (p.enabled !== false) {
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
            }
          }
        }
        await renderCustomModelsList();
        void loadProvidersList();
      } catch (err) {
        preloadLog.error('Failed to sync all providers:', err);
      } finally {
        syncAllBtn.disabled = false;
        syncAllBtn.innerHTML = originalHtml;
      }
    });

    const expBtn = document.createElement('button');
    expBtn.type = 'button';
    expBtn.className = 'agy-btn-ghost';
    expBtn.title = 'Export Providers Configuration';
    expBtn.setAttribute('aria-label', 'Export Providers');
    expBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`;
    expBtn.addEventListener('click', async () => {
      try {
        const res = await storageAPI.exportProviders();
        if (res && res.success && res.base64) {
          await navigator.clipboard.writeText(res.base64);
          alert(`Providers exported to clipboard (${res.count || 0} providers).`);
        }
      } catch (err) {
        alert('Export failed: ' + (err as Error).message);
      }
    });

    const impBtn = document.createElement('button');
    impBtn.type = 'button';
    impBtn.className = 'agy-btn-ghost';
    impBtn.title = 'Import Providers Configuration';
    impBtn.setAttribute('aria-label', 'Import Providers');
    impBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
    impBtn.addEventListener('click', async () => {
      const code = prompt('Paste exported Providers config string:');
      if (code && code.trim()) {
        try {
          const res = await storageAPI.importProviders(code.trim());
          if (res && res.success) {
            void loadProvidersList();
          } else {
            alert('Import failed: ' + (res?.error || 'Invalid configuration code'));
          }
        } catch (err) {
          alert('Import failed: ' + (err as Error).message);
        }
      }
    });

    headerActions.appendChild(addProvBtn);
    headerActions.appendChild(syncAllBtn);
    headerActions.appendChild(expBtn);
    headerActions.appendChild(impBtn);

    footer.replaceChildren();
    const doneBtn = document.createElement('button');
    doneBtn.type = 'button';
    doneBtn.className = 'agy-btn-secondary';
    doneBtn.textContent = 'Close';
    doneBtn.addEventListener('click', closeModal);
    footer.appendChild(doneBtn);

    void loadProvidersList();
  }

  async function loadProvidersList(): Promise<void> {
    listContainer.replaceChildren();
    const loading = document.createElement('div');
    loading.className = 'agy-fetched-models-empty';
    loading.textContent = 'Loading providers...';
    listContainer.appendChild(loading);

    try {
      const providers = await storageAPI.getProviders();
      listContainer.replaceChildren();

      if (!providers || providers.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'agy-empty-state';
        empty.style.padding = '40px 20px';
        empty.innerHTML = `
          <div style="margin-bottom: 12px; color: var(--agy-ink-secondary);">
            <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          </div>
          <div style="font-size: 14px; font-weight: 500; color: var(--agy-ink-primary);">No providers configured</div>
          <div style="font-size: 12px; color: var(--agy-ink-secondary); margin-top: 4px;">Add a custom AI provider to enable external models.</div>
        `;
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'agy-btn-primary';
        addBtn.style.marginTop = '16px';
        addBtn.innerHTML = `+ Add Provider`;
        addBtn.addEventListener('click', () => showFormView());
        empty.appendChild(addBtn);
        listContainer.appendChild(empty);
        return;
      }

      providers.forEach((p: ProviderFileEntry) => {
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
          void loadProvidersList();
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
          } catch (err) {
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
          } catch (err) {
            fetchRowBtn.style.color = 'var(--agy-danger)';
          } finally {
            setTimeout(() => {
              fetchRowBtn.disabled = false;
              fetchRowBtn.style.color = '';
              fetchRowBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`;
              void loadProvidersList();
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
          showFormView(p);
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
            void loadProvidersList();
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
        listContainer.appendChild(row);
      });
    } catch (err) {
      listContainer.replaceChildren();
      const errBanner = document.createElement('div');
      errBanner.className = 'agy-form-error-banner agy-form-error-visible';
      errBanner.textContent = 'Failed to load providers: ' + (err as Error).message;
      listContainer.appendChild(errBanner);
    }
  }

  // ─── Form View Implementation ──────────────────────────────────────
  function showFormView(existingP?: ProviderFileEntry): void {
    listContainer.style.display = 'none';
    formContainer.style.display = 'flex';
    titleIcon.textContent = existingP ? '✎' : '+';
    titleText.textContent = existingP ? 'Edit Provider' : 'Add Custom Provider';

    headerActions.replaceChildren();
    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'agy-btn-ghost';
    backBtn.innerHTML = `← Back to Providers`;
    backBtn.addEventListener('click', () => showListView());
    headerActions.appendChild(backBtn);

    formContainer.replaceChildren();

    const state: ProviderFileEntry = existingP
      ? JSON.parse(JSON.stringify(existingP))
      : {
          id: 'provider-' + Date.now(),
          name: '',
          provider: 'openai',
          apiUrl: 'https://api.openai.com/v1',
          apiKey: '',
          allowUnauthorized: false,
          enabled: true,
          models: [] as ProviderModelEntry[],
        };

    const createInput = (
      labelStr: string,
      key: keyof ProviderFileEntry,
      type: string = 'text',
      helpText?: string,
      required: boolean = false,
    ): { wrapper: HTMLElement; input: HTMLInputElement; errorEl: HTMLElement } => {
      const w = document.createElement('div');
      w.className = 'agy-form-group';
      const l = document.createElement('label');
      l.innerHTML = labelStr + (required ? '' : ' <span class="agy-form-hint">(optional)</span>');
      l.htmlFor = 'agy-input-' + String(key);
      const i = document.createElement('input');
      i.type = type;
      i.id = 'agy-input-' + String(key);
      i.value = (state[key] as string) || '';
      i.className = 'agy-input';
      if (required) i.setAttribute('required', 'true');
      const errorEl = document.createElement('div');
      errorEl.className = 'agy-form-error-banner';
      errorEl.id = 'agy-error-' + String(key);

      if (existingP && key === 'apiKey') {
        i.placeholder = '•••••••• (leave empty to keep)';
      } else if (key === 'apiKey') {
        i.placeholder = 'sk-...';
      } else if (key === 'apiUrl') {
        i.placeholder = 'https://api.example.com/v1';
      } else if (key === 'name') {
        i.placeholder = 'e.g. My Provider';
      }

      w.appendChild(l);
      w.appendChild(i);
      if (helpText) {
        const help = document.createElement('div');
        help.className = 'agy-form-hint';
        help.textContent = helpText;
        w.appendChild(help);
      }
      w.appendChild(errorEl);
      return { wrapper: w, input: i, errorEl };
    };

    const providerWrap = document.createElement('div');
    providerWrap.className = 'agy-form-group';
    const providerLabel = document.createElement('label');
    providerLabel.textContent = 'Provider Type';
    const providerSelect = document.createElement('select');
    providerSelect.className = 'agy-input';
    for (const preset of PROVIDER_PRESETS) {
      const opt = document.createElement('option');
      opt.value = preset.id;
      opt.textContent = preset.label;
      if (state.provider === preset.id) opt.selected = true;
      providerSelect.appendChild(opt);
    }
    if (!PROVIDER_PRESETS.some((pp) => pp.id === state.provider)) {
      const opt = document.createElement('option');
      opt.value = state.provider;
      opt.textContent = state.provider + ' (saved)';
      opt.selected = true;
      providerSelect.appendChild(opt);
    }

    providerSelect.addEventListener('change', (e) => {
      state.provider = (e.target as HTMLSelectElement).value;
    });

    const providerHint = document.createElement('div');
    providerHint.className = 'agy-form-hint';
    providerHint.textContent = 'Select the API format your provider uses.';

    providerWrap.appendChild(providerLabel);
    providerWrap.appendChild(providerSelect);
    providerWrap.appendChild(providerHint);

    const nameInp = createInput('Provider Name', 'name', 'text', '', true);
    const urlInp = createInput('API URL', 'apiUrl', 'url', 'The chat/completions or messages endpoint.', true);

    const keyWrap = document.createElement('div');
    keyWrap.className = 'agy-form-group';
    const keyLabel = document.createElement('label');
    keyLabel.innerHTML = 'API Key <span class="agy-form-hint">(optional)</span>';
    const keyInp = document.createElement('input');
    keyInp.type = 'password';
    keyInp.className = 'agy-input';
    keyInp.autocomplete = 'off';
    keyInp.spellcheck = false;
    keyInp.placeholder = existingP ? '••••••••' : 'sk-...';

    let keyDirty = false;
    keyInp.addEventListener('input', () => { keyDirty = true; });
    keyWrap.appendChild(keyLabel);
    keyWrap.appendChild(keyInp);

    const tlsWrap = document.createElement('div');
    tlsWrap.className = 'agy-form-group agy-form-group-checkbox';
    const tlsChk = document.createElement('input');
    tlsChk.type = 'checkbox';
    tlsChk.className = 'agy-form-checkbox';
    tlsChk.checked = !!state.allowUnauthorized;
    tlsChk.addEventListener('change', (e) => {
      state.allowUnauthorized = (e.target as HTMLInputElement).checked;
    });
    const tlsLbl = document.createElement('label');
    tlsLbl.className = 'agy-form-label-inline';
    tlsLbl.textContent = 'Allow self-signed / unauthorized certificates';
    tlsWrap.appendChild(tlsChk);
    tlsWrap.appendChild(tlsLbl);

    formContainer.appendChild(providerWrap);
    formContainer.appendChild(nameInp.wrapper);
    formContainer.appendChild(urlInp.wrapper);
    formContainer.appendChild(keyWrap);
    formContainer.appendChild(tlsWrap);

    const showError = (el: HTMLElement, msg: string): void => {
      el.textContent = msg;
      el.style.display = 'block';
    };
    const clearError = (el: HTMLElement): void => {
      el.textContent = '';
      el.style.display = 'none';
    };
    const validateUrl = (url: string): boolean => {
      try { const u = new URL(url); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; }
    };

    const formStatus = document.createElement('div');
    formStatus.className = 'agy-form-error-banner';
    formContainer.appendChild(formStatus);

    const step2 = document.createElement('div');
    step2.style.marginTop = '20px';
    step2.style.paddingTop = '16px';
    step2.style.borderTop = '1px solid var(--agy-border)';

    const modelsSection = document.createElement('div');
    modelsSection.className = 'agy-form-group';

    const modelsHeader = document.createElement('div');
    modelsHeader.className = 'agy-form-header-row';
    const modelsLabel = document.createElement('label');
    modelsLabel.textContent = 'Available Models';
    const fetchBtn = document.createElement('button');
    fetchBtn.type = 'button';
    fetchBtn.className = 'agy-btn-ghost';
    fetchBtn.textContent = 'Refetch';

    modelsHeader.appendChild(modelsLabel);
    modelsHeader.appendChild(fetchBtn);
    modelsSection.appendChild(modelsHeader);

    const listWrapper = document.createElement('div');
    listWrapper.className = 'agy-fetched-models-container';

    const modelsList = document.createElement('div');
    modelsList.className = 'agy-fetched-models-list';
    listWrapper.appendChild(modelsList);
    modelsSection.appendChild(listWrapper);

    step2.appendChild(modelsSection);
    formContainer.appendChild(step2);

    function updateModelsList(): void {
      renderFetchedModelsList(modelsList, state.models, (modelId, enabled) => {
        const idx = state.models.findIndex((x) => x.id === modelId);
        if (idx !== -1) {
          state.models[idx].enabled = enabled;
        }
      });
    }

    updateModelsList();

    fetchBtn.addEventListener('click', async () => {
      if (fetchBtn.disabled) return;
      clearError(formStatus);
      const url = urlInp.input.value.trim();
      if (!validateUrl(url)) {
        showError(urlInp.errorEl, 'Enter a valid http(s) URL');
        urlInp.input.focus();
        return;
      }
      clearError(urlInp.errorEl);
      state.apiUrl = url;
      if (keyDirty) state.apiKey = keyInp.value;

      fetchBtn.disabled = true;
      fetchBtn.textContent = 'Fetching...';

      modelsList.replaceChildren();
      const empty = document.createElement('div');
      empty.className = 'agy-fetched-models-empty';
      empty.textContent = 'Loading models...';
      modelsList.appendChild(empty);

      try {
        const res = await fetchModelsFromProvider({
          baseUrl: state.apiUrl,
          apiUrl: state.apiUrl,
          apiKey: state.apiKey,
          provider: state.provider,
          allowUnauthorized: state.allowUnauthorized,
        });
        if (res.success && res.models) {
          const existingMap = new Map((state.models || []).map((x: ProviderModelEntry) => [x.id, x]));
          state.models = res.models.map((m: any) => {
            const ext = existingMap.get(m.id);
            return ext ? ext : { id: m.id, displayName: m.displayName || m.id, enabled: true };
          });
          updateModelsList();
        } else {
          showError(formStatus, 'Error: ' + (res.error || 'Unknown error'));
          updateModelsList();
        }
      } catch (err) {
        showError(formStatus, 'Error: ' + (err as Error).message);
        updateModelsList();
      } finally {
        fetchBtn.textContent = 'Refetch';
        fetchBtn.disabled = false;
      }
    });

    footer.replaceChildren();

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'agy-btn-ghost';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => showListView());

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'agy-btn-primary';
    saveBtn.textContent = existingP ? 'Save Changes' : 'Save Provider';

    saveBtn.addEventListener('click', async () => {
      if (saveBtn.disabled) return;
      let valid = true;
      const name = nameInp.input.value.trim();
      const url = urlInp.input.value.trim();
      if (!name) {
        showError(nameInp.errorEl, 'Provider name is required');
        valid = false;
      } else {
        clearError(nameInp.errorEl);
      }
      if (!validateUrl(url)) {
        showError(urlInp.errorEl, 'Enter a valid http(s) URL');
        valid = false;
      } else {
        clearError(urlInp.errorEl);
      }
      if (!valid) return;

      state.name = name;
      state.apiUrl = url;
      if (keyDirty) state.apiKey = keyInp.value;

      saveBtn.disabled = true;
      const originalText = saveBtn.textContent;
      saveBtn.textContent = 'Saving...';
      try {
        const res = await storageAPI.saveProvider(state);
        if (res.success) {
          await renderCustomModelsList();
          showListView();
        } else {
          showError(formStatus, 'Error: ' + (res.error || 'Unknown error'));
          saveBtn.textContent = originalText;
          saveBtn.disabled = false;
        }
      } catch (err) {
        showError(formStatus, 'Error: ' + (err as Error).message);
        saveBtn.textContent = originalText;
        saveBtn.disabled = false;
      }
    });

    footer.appendChild(cancelBtn);
    footer.appendChild(saveBtn);

    requestAnimationFrame(() => {
      nameInp.input.focus();
      if (existingP) nameInp.input.select();
    });
  }

  // Initial View Determination
  if (existingProvider) {
    showFormView(existingProvider);
  } else {
    showListView();
  }
}
