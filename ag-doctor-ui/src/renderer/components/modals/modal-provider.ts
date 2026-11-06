import { getRendererDefaultUrl, RENDERER_PROVIDER_PRESETS } from '../../core/routing/providers-config';
// Provider Manager & Custom Models Modal
// ─────────────────────────────────────────────────────────────────────────────

// ProviderModel and ProviderEntry are declared in globals.d.ts

const pmBackdrop = $('#providerManagerModalBackdrop') as HTMLDivElement;
const pmClose = $('#providerManagerModalClose') as HTMLButtonElement;
const pmListContainer = $('#pmListContainer') as HTMLDivElement;
const pmFormContainer = $('#pmFormContainer') as HTMLDivElement;
const pmModalFooterList = $('#pmModalFooterList') as HTMLDivElement;
const pmAddBtn = $('#pmAddBtn') as HTMLButtonElement;
const pmImportLocalBtn = $('#pmImportLocalBtn') as HTMLButtonElement;
const pmFormBack = $('#pmFormBack') as HTMLButtonElement;
const pmFormBack2 = $('#pmFormBack2') as HTMLButtonElement;
const pmFormTitle = ($('#pmModalTitle') || $('#pmFormTitle')) as HTMLHeadingElement | null;
const pmFormName = $('#pmFormName') as HTMLInputElement;
const pmFormType = $('#pmFormType') as HTMLSelectElement;
const pmFormUrl = $('#pmFormUrl') as HTMLInputElement;
const pmFormKey = $('#pmFormKey') as HTMLInputElement;
const pmFormInsecure = $('#pmFormInsecure') as HTMLInputElement;
const pmFormSave = $('#pmFormSave') as HTMLButtonElement;
const pmFormError = $('#pmFormError') as HTMLDivElement;
const pmModelsList = $('#pmModelsList') as HTMLDivElement;
const pmFormFetchModelsBtn = $('#pmFormFetchModels') as HTMLButtonElement;
const pmModalClose2 = $('#pmModalClose2') as HTMLButtonElement;
const pmFormTest = $('#pmFormTest') as HTMLButtonElement;

let editingProviderId: string | null = null;
let currentFetchedModels: Array<{ id: string; displayName?: string; enabled: boolean }> = [];
let pmModelsSearchQuery = '';

const pmKeyToggle = $('#pmKeyToggle') as HTMLButtonElement | null;
const pmModelsSearch = $('#pmModelsSearch') as HTMLInputElement | null;
const pmModelsSearchClear = $('#pmModelsSearchClear') as HTMLButtonElement | null;
const pmModelsSelectAll = $('#pmModelsSelectAll') as HTMLButtonElement | null;
const pmModelsDeselectAll = $('#pmModelsDeselectAll') as HTMLButtonElement | null;
const pmFormCustomModelInput = $('#pmFormCustomModelInput') as HTMLInputElement | null;
const pmFormAddCustomModelBtn = $('#pmFormAddCustomModelBtn') as HTMLButtonElement | null;
const pmModelsCountBadge = $('#pmModelsCountBadge') as HTMLSpanElement | null;
const pmCapFilters = $('#pmCapFilters') as HTMLDivElement | null;
let activeCapFilter: 'all' | 'reasoning' | 'vision' | 'code' = 'all';

// Catalog helpers are loaded globally from pm-catalog.js

function handleProviderError(errorMsg: string, status?: number, _p?: ProviderEntry): void {
  const label = status === 401 ? 'Auth error — check API key'
    : status === 429 ? 'Rate-limited — try again later'
    : status === 402 ? 'Quota exceeded'
    : status ? `Provider error (HTTP ${status})`
    : errorMsg || 'Provider unreachable';
  toast(label, 'err', 6000);
}

function showPmView(view: 'list' | 'form'): void {
  if (view === 'list') {
    pmListContainer.hidden = false;
    pmFormContainer.hidden = true;
    if (pmModalFooterList) pmModalFooterList.hidden = false;
    if (pmFormTitle) pmFormTitle.textContent = 'Provider Manager';
  } else {
    pmListContainer.hidden = true;
    pmFormContainer.hidden = false;
    if (pmModalFooterList) pmModalFooterList.hidden = true;
  }
}

async function renderProviderList(): Promise<void> {
  showSkeleton(pmListContainer, 'cards', 2);
  try {
    providersCache = (await window.ag.providers.get()) as ProviderEntry[];
    if (!providersCache || providersCache.length === 0) {
      pmListContainer.innerHTML = `
        <div class="agy-empty-state">
          <div class="agy-empty-icon">
            <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
          </div>
          <div class="agy-empty-title">No providers yet</div>
          <div class="agy-empty-text">Add a custom OpenAI-compatible provider to get started.</div>
        </div>
      `;
      return;
    }

    const displayRows = providersCache.map((p) => ({
      ...p,
      models: p.models || [],
    }));

    let html = `<div class="agy-provider-list">`;
    for (const p of displayRows) {
      html += (window as any).renderProviderRowHtml ? (window as any).renderProviderRowHtml(p) : '';
    }
    html += `</div>`;
    pmListContainer.innerHTML = html;

    pmListContainer.querySelectorAll<HTMLButtonElement>('.pm-test').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const row = (e.currentTarget as HTMLElement).closest('.agy-provider-row') as HTMLElement;
        const id = row.dataset.id!;
        const p = providersCache.find((x) => x.id === id);
        if (!p) return;
        btn.setAttribute('disabled', 'true');
        const orig = btn.innerHTML;
        btn.innerHTML = `<span class="spinner"></span>`;
        try {
          const r = (await window.ag.providers.test({ apiUrl: p.apiUrl, apiKey: p.apiKey, id: p.id })) as {
            success: boolean;
            status?: number;
            latencyMs?: number;
            healthStatus?: 'healthy' | 'degraded' | 'offline';
            error?: string;
          };
          if (r.success) {
            p.status = r.healthStatus ?? 'healthy';
            p.latencyMs = r.latencyMs;
            toast(`Healthy (${r.latencyMs ?? 0}ms)`, 'ok');
          } else {
            p.status = r.healthStatus ?? 'offline';
            p.latencyMs = r.latencyMs;
            p.lastError = r.error;
            toast(`Failed: ${r.error || r.status}`, 'err', 6000);
            handleProviderError(r.error || `HTTP ${r.status}`, r.status, p);
          }
          await renderProviderList();
        } catch (err) {
          const errorMsg = (err as Error).message;
          toast(`Test error: ${errorMsg}`, 'err');
          handleProviderError(errorMsg, undefined, p);
        } finally {
          btn.removeAttribute('disabled');
          btn.innerHTML = orig;
        }
      });
    });

    pmListContainer.querySelectorAll<HTMLButtonElement>('.pm-toggle').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const row = (e.currentTarget as HTMLElement).closest('.agy-provider-row') as HTMLElement;
        const id = row.dataset.id!;
        const p = providersCache.find((x) => x.id === id);
        if (!p) return;
        p.enabled = !p.enabled;
        const r = (await window.ag.providers.save(p)) as { success: boolean; error?: string };
        if (r.success) {
          toast(p.enabled ? 'Provider enabled' : 'Provider disabled', 'ok');
          await renderProviderList();
        } else {
          toast(`Save failed: ${r.error}`, 'err');
          p.enabled = !p.enabled;
        }
      });
    });

    pmListContainer.querySelectorAll<HTMLButtonElement>('.pm-edit').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const row = (e.currentTarget as HTMLElement).closest('.agy-provider-row') as HTMLElement;
        const id = row.dataset.id!;
        openProviderForm(id);
      });
    });

    pmListContainer.querySelectorAll<HTMLButtonElement>('.pm-delete').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const row = (e.currentTarget as HTMLElement).closest('.agy-provider-row') as HTMLElement;
        const id = row.dataset.id!;
        const p = providersCache.find((x) => x.id === id);
        if (!p) return;
        const ok = await modals.confirm(
          'Delete provider?',
          `Delete <strong>${escapeHtml(p.name)}</strong>? This cannot be undone.`,
          { danger: true, confirmLabel: 'Delete' },
        );
        if (!ok) return;
        const r = (await window.ag.providers.delete(id)) as { success: boolean; error?: string };
        if (r.success) {
          toast('Provider deleted', 'ok');
          await renderProviderList();
        } else {
          toast(`Delete failed: ${r.error}`, 'err');
        }
      });
    });
  } finally {
    hideSkeleton(pmListContainer);
  }
}

function resetProviderForm(): void {
  pmFormName.value = '';
  pmFormType.value = 'openai';
  pmFormUrl.value = '';
  pmFormKey.value = '';
  pmFormKey.type = 'password';
  if (pmKeyToggle) {
    pmKeyToggle.title = 'Show API key';
    pmKeyToggle.setAttribute('aria-label', 'Show API key');
    pmKeyToggle.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
  }
  pmFormInsecure.checked = false;
  pmModelsList.innerHTML = '';
  pmFormError.hidden = true;
  pmFormError.textContent = '';
  editingProviderId = null;
  activeCapFilter = 'all';
}
function openProviderForm(existingId?: string): void {
  pmModelsSearchQuery = '';
  if (pmModelsSearch) pmModelsSearch.value = '';
  resetProviderForm();
  if (existingId) {
    const p = providersCache.find((x) => x.id === existingId);
    if (p) {
      editingProviderId = p.id;
      if (pmFormTitle) pmFormTitle.textContent = 'Edit Provider';
      pmFormName.value = p.name;
      pmFormType.value = p.provider;
      pmFormUrl.value = p.apiUrl;
      pmFormKey.value = p.apiKey;
      pmFormInsecure.checked = p.allowUnauthorized ?? false;
      let pModels = p.models;
      if ((!pModels || pModels.length === 0) && (p.provider === 'google' || p.id === 'provider-google')) {
        const accWithModels = Array.isArray(p.accounts) ? p.accounts.find((a: any) => Array.isArray(a.models) && a.models.length > 0) : null;
        pModels = accWithModels ? accWithModels.models : [
          { id: 'gemini-3.8-flash-tiered', displayName: 'Gemini 3.8 Flash', enabled: true },
          { id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6 (Thinking)', enabled: false },
          { id: 'claude-opus-4-6-thinking', displayName: 'Claude Opus 4.6 (Thinking)', enabled: false },
          { id: 'gemini-3.8-flash', displayName: 'Gemini 3.8 Flash', enabled: true },
        ];
      }
      currentFetchedModels = (pModels || []).map((m: any) => ({
        id: m.id,
        displayName: m.displayName || m.id,
        enabled: m.enabled !== false,
      }));
      (window as any).currentFetchedModels = currentFetchedModels;
      renderPmModelsCatalog();
    }
  } else {
    if (pmFormTitle) pmFormTitle.textContent = 'Add Provider';
    currentFetchedModels = [];
    (window as any).currentFetchedModels = currentFetchedModels;
    renderPmModelsCatalog();
  }
  showPmView('form');
}

function openProviderManagerModal(): void {
  pmBackdrop.hidden = false;
  showPmView('list');
  void renderProviderList();
}

if (pmClose) pmClose.addEventListener('click', () => { pmBackdrop.hidden = true; });
// Close the provider manager with Escape or a backdrop click (standard modal UX).
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && pmBackdrop && !pmBackdrop.hidden) pmBackdrop.hidden = true;
});
if (pmBackdrop) {
  pmBackdrop.addEventListener('click', (e) => { if (e.target === pmBackdrop) pmBackdrop.hidden = true; });
}
if (pmModalClose2) pmModalClose2.addEventListener('click', () => { pmBackdrop.hidden = true; });
if (pmAddBtn) pmAddBtn.addEventListener('click', () => openProviderForm());
if (pmImportLocalBtn) {
  pmImportLocalBtn.addEventListener('click', async () => {
    const orig = pmImportLocalBtn.innerHTML;
    pmImportLocalBtn.disabled = true;
    pmImportLocalBtn.textContent = 'Detecting account...';
    try {
      const res = await window.ag.providers.discoverIdeAccount();
      if (!res || !res.success || !res.account) {
        toast(res?.error || 'No Antigravity account found in system keyring.', 'warn', 5000);
        return;
      }

      const acc = res.account;
      const email = acc.email || 'antigravity-user@google.com';
      const refreshToken = acc.refreshToken || acc.accessToken;
      if (!refreshToken) {
        toast('Discovered account has no valid credentials.', 'err');
        return;
      }

      // Check if already in providers
      const existing = providersCache.find(
        (x) => x.provider === 'google' && (x.apiKey === refreshToken || x.name.includes(email)),
      );

      const entry: ProviderEntry = {
        id: existing?.id || `provider-google-local-${Date.now()}`,
        name: existing?.name || `Google (${email})`,
        provider: 'google',
        apiUrl: 'https://daily-cloudcode-pa.googleapis.com',
        apiKey: refreshToken,
        enabled: true,
        allowUnauthorized: false,
        models: [
          { id: 'gemini-4-argon-medium', displayName: 'Gemini 4 Argon (Medium)', enabled: true },
          { id: 'gemini-3.8-flash-tiered', displayName: 'Gemini 3.8 Flash Tiered', enabled: true },
          { id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6', enabled: true },
          { id: 'claude-opus-4-6-thinking', displayName: 'Claude Opus 4.6 (Thinking)', enabled: true },
        ],
      };

      const saveRes = (await window.ag.providers.save(entry)) as { success: boolean; error?: string };
      if (saveRes.success) {
        toast(`Imported Google account (${email}) from IDE!`, 'ok');
        await renderProviderList();
        await loadModels();
      } else {
        toast(`Import failed: ${saveRes.error}`, 'err');
      }
    } catch (err) {
      toast(`Import error: ${(err as Error).message}`, 'err');
    } finally {
      pmImportLocalBtn.disabled = false;
      pmImportLocalBtn.innerHTML = orig;
    }
  });
}
if (pmFormBack) pmFormBack.addEventListener('click', () => showPmView('list'));
if (pmFormBack2) pmFormBack2.addEventListener('click', () => showPmView('list'));

if (pmFormType) {
  pmFormType.addEventListener('change', () => {
    const t = pmFormType.value;
    pmFormUrl.value = getRendererDefaultUrl(t);
  });
}

if (pmFormSave) {
  pmFormSave.addEventListener('click', async () => {
    const name = pmFormName.value.trim();
    const provider = pmFormType.value;
    const apiUrl = pmFormUrl.value.trim();
    const apiKey = pmFormKey.value.trim();
    const allowUnauthorized = pmFormInsecure.checked;

    if (!name) {
      pmFormError.textContent = 'Provider name is required.';
      pmFormError.hidden = false;
      return;
    }
    if (!apiUrl) {
      pmFormError.textContent = 'API URL is required.';
      pmFormError.hidden = false;
      return;
    }

    const modelsPool: Array<{ id: string; displayName?: string; enabled: boolean }> =
      (window as any).currentFetchedModels || currentFetchedModels;
    const selectedModels = modelsPool
      .filter((m) => m.enabled !== false)
      .map((m) => ({ id: m.id, displayName: m.displayName || m.id, enabled: true }));

    if (selectedModels.length === 0 && modelsPool.length > 0) {
      pmFormError.textContent = 'Please select at least one model to save.';
      pmFormError.hidden = false;
      return;
    }

    const entry: ProviderEntry = {
      id: editingProviderId || `provider-${Date.now()}`,
      name,
      provider,
      apiUrl,
      apiKey: apiKey || 'none',
      allowUnauthorized,
      enabled: true,
      models: selectedModels,
    };

    pmFormSave.disabled = true;
    pmFormSave.textContent = 'Saving…';
    try {
      const r = (await window.ag.providers.save(entry)) as { success: boolean; error?: string };
      if (r.success) {
        toast('Provider saved', 'ok');
        showPmView('list');
        await renderProviderList();
        await loadModels();
      } else {
        pmFormError.textContent = r.error || 'Failed to save provider.';
        pmFormError.hidden = false;
      }
    } catch (err) {
      pmFormError.textContent = (err as Error).message;
      pmFormError.hidden = false;
    } finally {
      pmFormSave.disabled = false;
      pmFormSave.textContent = 'Save provider';
    }
  });
}

if (pmFormTest) {
  pmFormTest.addEventListener('click', async () => {
    const apiUrl = pmFormUrl.value.trim();
    const apiKey = pmFormKey.value.trim();
    const allowUnauthorized = pmFormInsecure.checked;
    if (!apiUrl) {
      toast('Enter an API URL first', 'warn');
      return;
    }
    pmFormTest.disabled = true;
    pmFormTest.textContent = 'Testing…';
    try {
      const r = (await window.ag.providers.test({ apiUrl, apiKey: apiKey || 'none', allowUnauthorized } as any)) as {
        success: boolean;
        latencyMs?: number;
        error?: string;
      };
      if (r.success) {
        toast(`Connection successful (${r.latencyMs ?? 0}ms)`, 'ok');
      } else {
        toast(`Test failed: ${r.error}`, 'err', 5000);
      }
    } catch (err) {
      toast(`Test failed: ${(err as Error).message}`, 'err');
    } finally {
      pmFormTest.disabled = false;
      pmFormTest.textContent = 'Test connection';
    }
  });
}

if (pmFormFetchModelsBtn) {
  pmFormFetchModelsBtn.addEventListener('click', async () => {
    const provider = pmFormType.value;
    const apiUrl = pmFormUrl.value.trim();
    const apiKey = pmFormKey.value.trim();
    if (!apiUrl) {
      toast('Enter API URL first', 'warn');
      return;
    }
    pmFormFetchModelsBtn.disabled = true;
    pmFormFetchModelsBtn.textContent = 'Fetching…';
    try {
      const r = (await window.ag.providers.fetchModels({ provider, apiUrl, apiKey: apiKey || 'none' } as any)) as {
        success: boolean;
        models?: Array<{ id: string; displayName?: string }>;
        error?: string;
      };
      if (r.success && r.models) {
        currentFetchedModels = r.models.map((m) => ({
          id: m.id,
          displayName: m.displayName || m.id,
          enabled: true,
        }));
        (window as any).currentFetchedModels = currentFetchedModels;
        renderPmModelsCatalog();
        toast(`Fetched ${r.models.length} models`, 'ok');
      } else {
        toast(`Fetch models failed: ${r.error}`, 'err');
      }
    } catch (err) {
      toast(`Fetch failed: ${(err as Error).message}`, 'err');
    } finally {
      pmFormFetchModelsBtn.disabled = false;
      pmFormFetchModelsBtn.textContent = 'Fetch models';
    }
  });
}

if (pmCapFilters) {
  pmCapFilters.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('.pm-cap-filter');
    if (!btn || !btn.dataset.cap) return;
    activeCapFilter = btn.dataset.cap as 'all' | 'reasoning' | 'vision' | 'code';
    pmCapFilters.querySelectorAll('.pm-cap-filter').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    renderPmModelsCatalog();
  });
}

// Initialize PM Catalog handlers
(window as any).initPmCatalogHandlers?.();

// Bind all Add Model buttons across views
$('#dashboardAddModelBtn')?.addEventListener('click', openProviderManagerModal);
$('#dashboardResolveVerificationBtn')?.addEventListener('click', () => {
  void showAntigravityVerificationResolutionModal();
});
$('#modelsAddBtn')?.addEventListener('click', openProviderManagerModal);
$('#providerManagerBtn')?.addEventListener('click', openProviderManagerModal);
$('#emptyAddModelBtn')?.addEventListener('click', openProviderManagerModal);

// ─────────────────────────────────────────────────────────────────────────────

function openProviderModal(provider?: any): void {
  if (provider) {
    openProviderForm(typeof provider === 'string' ? provider : provider?.id);
  } else {
    openProviderManagerModal();
  }
}

function closeProviderModal(): void {
  if (typeof pmBackdrop !== 'undefined' && pmBackdrop) {
    pmBackdrop.hidden = true;
  }
}

if (typeof window !== 'undefined') {
  (window as any).openProviderManagerModal = openProviderManagerModal;
  (window as any).openProviderForm = openProviderForm;
  (window as any).openProviderModal = openProviderModal;
  (window as any).closeProviderModal = closeProviderModal;
}
