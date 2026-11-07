/**
 * Provider Manager List View Component
 */
import { storageAPI } from '../api';
import { preloadLog } from '../logger';
import { fetchModelsFromProvider, renderCustomModelsList } from '../model-fetcher';
import type { ProviderFileEntry } from '../types';
import type { ProviderModalContext } from './providerModal';
import { createProviderCard } from './providerCard';

export function renderProviderListView(ctx: ProviderModalContext): void {
  ctx.listContainer.style.display = 'flex';
  ctx.formContainer.style.display = 'none';
  ctx.titleIcon.textContent = '☁️';
  ctx.titleText.textContent = 'Provider Manager';

  ctx.headerActions.replaceChildren();

  const addProvBtn = document.createElement('button');
  addProvBtn.type = 'button';
  addProvBtn.className = 'agy-btn-primary';
  addProvBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add Provider`;
  addProvBtn.addEventListener('click', () => ctx.showFormView());

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
      void ctx.loadProvidersList();
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
          void ctx.loadProvidersList();
        } else {
          alert('Import failed: ' + (res?.error || 'Invalid configuration code'));
        }
      } catch (err) {
        alert('Import failed: ' + (err as Error).message);
      }
    }
  });

  ctx.headerActions.appendChild(addProvBtn);
  ctx.headerActions.appendChild(syncAllBtn);
  ctx.headerActions.appendChild(expBtn);
  ctx.headerActions.appendChild(impBtn);

  ctx.footer.replaceChildren();
  const doneBtn = document.createElement('button');
  doneBtn.type = 'button';
  doneBtn.className = 'agy-btn-secondary';
  doneBtn.textContent = 'Close';
  doneBtn.addEventListener('click', ctx.closeModal);
  ctx.footer.appendChild(doneBtn);

  void ctx.loadProvidersList();
}

export async function loadProvidersList(ctx: ProviderModalContext): Promise<void> {
  ctx.listContainer.replaceChildren();
  const loading = document.createElement('div');
  loading.className = 'agy-fetched-models-empty';
  loading.textContent = 'Loading providers...';
  ctx.listContainer.appendChild(loading);

  try {
    const providers = await storageAPI.getProviders();
    ctx.listContainer.replaceChildren();

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
      addBtn.addEventListener('click', () => ctx.showFormView());
      empty.appendChild(addBtn);
      ctx.listContainer.appendChild(empty);
      return;
    }

    providers.forEach((p: ProviderFileEntry) => {
      const row = createProviderCard(p, ctx);
      ctx.listContainer.appendChild(row);
    });
  } catch (err) {
    ctx.listContainer.replaceChildren();
    const errBanner = document.createElement('div');
    errBanner.className = 'agy-form-error-banner agy-form-error-visible';
    errBanner.textContent = 'Failed to load providers: ' + (err as Error).message;
    ctx.listContainer.appendChild(errBanner);
  }
}
