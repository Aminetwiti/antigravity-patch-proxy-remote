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
const pmFormTitle = $('#pmFormTitle') as HTMLHeadingElement;
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

function applyProviderPreset(presetKey: string): void {
  (window as any).applyProviderPreset?.(presetKey);
}

function updatePmModelsCounter(): void {
  (window as any).updatePmModelsCounter?.();
}

function renderPmModelsCatalog(): void {
  (window as any).renderPmModelsCatalog?.();
}

function triggerSmartFailover(failingProviderId?: string): void {
  const fallback = providersCache.find((p) => p.enabled && p.id !== failingProviderId && (p.status === 'healthy' || !p.status));
  if (fallback) {
    toast(`Switched to fallback provider ${fallback.name}`, 'ok');
  } else {
    toast(`No alternative healthy provider available`, 'warn');
  }
}

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
