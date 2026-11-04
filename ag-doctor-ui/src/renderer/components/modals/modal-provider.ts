import { getRendererDefaultUrl } from '../../core/routing/providers-config';
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

interface ProviderPresetDef {
  name: string;
  provider: 'openai' | 'anthropic' | 'google' | 'custom';
  apiUrl: string;
  defaultKey: string;
}

const PROVIDER_PRESETS: Record<string, ProviderPresetDef> = {
  ollama: {
    name: 'Ollama (Local)',
    provider: 'custom',
    apiUrl: 'http://localhost:11434/v1',
    defaultKey: 'ollama',
  },
  lmstudio: {
    name: 'LM Studio (Local)',
    provider: 'openai',
    apiUrl: 'http://localhost:1234/v1',
    defaultKey: 'lm-studio',
  },
  openrouter: {
    name: 'OpenRouter AI',
    provider: 'openai',
    apiUrl: 'https://openrouter.ai/api/v1',
    defaultKey: '',
  },
  deepseek: {
    name: 'DeepSeek Cloud',
    provider: 'openai',
    apiUrl: 'https://api.deepseek.com/v1',
    defaultKey: '',
  },
  google: {
    name: 'Google Gemini',
    provider: 'google',
    apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultKey: '',
  },
  localai: {
    name: 'LocalAI',
    provider: 'custom',
    apiUrl: 'http://localhost:8000/v1',
    defaultKey: '',
  },
};

function applyProviderPreset(presetKey: string): void {
  const p = PROVIDER_PRESETS[presetKey];
  if (!p) return;
  pmFormName.value = p.name;
  pmFormType.value = p.provider;
  pmFormUrl.value = p.apiUrl;
  if (p.defaultKey) {
    pmFormKey.value = p.defaultKey;
  }
  toast(`Preset applied: ${p.name}`, 'ok');
  if (!p.defaultKey && p.provider !== 'custom') {
    pmFormKey.focus();
  }
}

function updatePmModelsCounter(): void {
  if (!pmModelsCountBadge) return;
  const total = currentFetchedModels.length;
  const selected = currentFetchedModels.filter((m) => m.enabled !== false).length;
  pmModelsCountBadge.textContent = `${selected} / ${total} selected`;
  if (selected === 0) {
    pmModelsCountBadge.className = 'badge badge-warn';
  } else if (selected === total && total > 0) {
    pmModelsCountBadge.className = 'badge badge-ok';
  } else {
    pmModelsCountBadge.className = 'badge badge-primary';
  }
}

function renderPmModelsCatalog(): void {
  if (!pmModelsList) return;
  updatePmModelsCounter();
  const q = pmModelsSearchQuery.trim().toLowerCase();
  const filtered = currentFetchedModels.filter((m) => {
    const caps = detectModelCapabilities(m.id);
    if (activeCapFilter !== 'all' && !caps.includes(activeCapFilter)) {
      return false;
    }
    if (!q) return true;
    return m.id.toLowerCase().includes(q) || (m.displayName || '').toLowerCase().includes(q);
  });

  if (currentFetchedModels.length === 0) {
    pmModelsList.innerHTML = '<div class="pm-models-hint">No models loaded. Click "Fetch models" or add custom ID below.</div>';
    return;
  }

  if (filtered.length === 0) {
    pmModelsList.innerHTML = `<div class="pm-models-hint">No models matching active filter or search query.</div>`;
    return;
  }

  let html = '<div class="agy-model-chips">';
  for (const m of filtered) {
    const checked = m.enabled !== false ? 'checked' : '';
    const selectedClass = m.enabled !== false ? ' is-selected' : '';
    const caps = detectModelCapabilities(m.id);
    const badgesHtml = caps.length > 0
      ? `<div class="pm-chip-caps">${caps.map((c: any) => `<span class="pm-cap-badge ${c}">${c}</span>`).join('')}</div>`
      : '';
    const hasDiffName = m.displayName && m.displayName !== m.id;
    const nameLabel = escapeHtml(m.displayName || m.id);
    const idLabel = hasDiffName ? `<span class="pm-chip-id">${escapeHtml(m.id)}</span>` : '';

    html += `<label class="agy-chip${selectedClass}" title="${escapeHtml(m.id)}">
      <input type="checkbox" data-model-id="${escapeHtml(m.id)}" ${checked} />
      <div class="pm-chip-info">
        <span class="pm-chip-name">${nameLabel}</span>
        ${idLabel}
      </div>
      ${badgesHtml}
    </label>`;
  }
  html += '</div>';
  pmModelsList.innerHTML = html;
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

function renderHealthStatusIndicator(p: ProviderEntry): string {
  let status = p.status || 'untested';
  if (Array.isArray((p as any).accounts) && (p as any).accounts.length > 0) {
    const accs = (p as any).accounts as any[];
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

function renderProviderStatus(p: ProviderEntry): string {
  if (!p.enabled) {
    return `<span class="agy-pill agy-pill-muted">Disabled</span>`;
  }
  let status = p.status || 'untested';
  if (Array.isArray((p as any).accounts) && (p as any).accounts.length > 0) {
    const accs = (p as any).accounts as any[];
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
      const accountsCount = Array.isArray((p as any).accounts) ? (p as any).accounts.length : 0;
      const accountsMeta = accountsCount > 0
        ? `<span class="agy-dot">·</span><span style="color:var(--text-accent, #38bdf8); font-weight:600; font-size:11px;">${accountsCount} account${accountsCount > 1 ? 's' : ''}</span>`
        : '';
      html += `
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
  if (pmCapFilters) {
    pmCapFilters.querySelectorAll('.pm-cap-filter').forEach((b) => b.classList.remove('active'));
    pmCapFilters.querySelector('[data-cap="all"]')?.classList.add('active');
  }
  pmModelsSearchQuery = '';
  if (pmModelsSearch) pmModelsSearch.value = '';
  if (pmModelsSearchClear) pmModelsSearchClear.hidden = true;
}

function openProviderForm(existingId?: string): void {
  pmModelsSearchQuery = '';
  if (pmModelsSearch) pmModelsSearch.value = '';
  resetProviderForm();
  if (existingId) {
    const p = providersCache.find((x) => x.id === existingId);
    if (p) {
      editingProviderId = p.id;
      pmFormTitle.textContent = 'Edit Provider';
      pmFormName.value = p.name;
      pmFormType.value = p.provider;
      pmFormUrl.value = p.apiUrl;
      pmFormKey.value = p.apiKey;
      pmFormInsecure.checked = p.allowUnauthorized ?? false;
      currentFetchedModels = (p.models || []).map((m: any) => ({
        id: m.id,
        displayName: m.displayName || m.id,
        enabled: m.enabled !== false,
      }));
      renderPmModelsCatalog();
    }
  } else {
    pmFormTitle.textContent = 'Add Provider';
    currentFetchedModels = [];
    renderPmModelsCatalog();
  }
  showPmView('form');
}

function openProviderManagerModal(): void {
  pmBackdrop.hidden = false;
  showPmView('list');
  void renderProviderList();
}

pmClose.addEventListener('click', () => { pmBackdrop.hidden = true; });
// Close the provider manager with Escape or a backdrop click (standard modal UX).
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !pmBackdrop.hidden) pmBackdrop.hidden = true;
});
pmBackdrop.addEventListener('click', (e) => { if (e.target === pmBackdrop) pmBackdrop.hidden = true; });
if (pmModalClose2) pmModalClose2.addEventListener('click', () => { pmBackdrop.hidden = true; });
pmAddBtn.addEventListener('click', () => openProviderForm());
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
pmFormBack.addEventListener('click', () => showPmView('list'));
if (pmFormBack2) pmFormBack2.addEventListener('click', () => showPmView('list'));

pmFormType.addEventListener('change', () => {
  const t = pmFormType.value;
  pmFormUrl.value = getRendererDefaultUrl(t);
});

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

  const selectedModels = currentFetchedModels
    .filter((m) => m.enabled !== false)
    .map((m) => ({ id: m.id, displayName: m.displayName || m.id, enabled: true }));

  if (selectedModels.length === 0 && currentFetchedModels.length > 0) {
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

// Delegated change listener for model catalog selection chips
pmModelsList?.addEventListener('change', (e) => {
  const target = e.target as HTMLInputElement;
  if (target && target.matches('input[data-model-id]')) {
    const modelId = target.dataset.modelId;
    const model = currentFetchedModels.find((m) => m.id === modelId);
    if (model) {
      model.enabled = target.checked;
      target.closest('.agy-chip')?.classList.toggle('is-selected', target.checked);
      updatePmModelsCounter();
    }
  }
});

if (pmModelsSelectAll) {
  pmModelsSelectAll.addEventListener('click', () => {
    const q = pmModelsSearchQuery.trim().toLowerCase();
    currentFetchedModels.forEach((m) => {
      const caps = detectModelCapabilities(m.id);
      if (activeCapFilter !== 'all' && !caps.includes(activeCapFilter)) return;
      if (q && !m.id.toLowerCase().includes(q) && !(m.displayName || '').toLowerCase().includes(q)) return;
      m.enabled = true;
    });
    renderPmModelsCatalog();
  });
}

if (pmModelsDeselectAll) {
  pmModelsDeselectAll.addEventListener('click', () => {
    const q = pmModelsSearchQuery.trim().toLowerCase();
    if (!q && activeCapFilter === 'all') {
      currentFetchedModels.forEach((m) => { m.enabled = false; });
    } else {
      currentFetchedModels.forEach((m) => {
        const caps = detectModelCapabilities(m.id);
        if (activeCapFilter !== 'all' && !caps.includes(activeCapFilter)) return;
        if (q && !m.id.toLowerCase().includes(q) && !(m.displayName || '').toLowerCase().includes(q)) return;
        m.enabled = false;
      });
    }
    renderPmModelsCatalog();
  });
}

function addCustomModelToCatalog(): void {
  if (!pmFormCustomModelInput) return;
  const customId = pmFormCustomModelInput.value.trim();
  if (!customId) return;
  const exists = currentFetchedModels.some((m) => m.id.toLowerCase() === customId.toLowerCase());
  if (!exists) {
    currentFetchedModels.push({ id: customId, displayName: customId, enabled: true });
    toast(`Added custom model ${customId}`, 'ok');
  }
  pmFormCustomModelInput.value = '';
  renderPmModelsCatalog();
}

if (pmFormAddCustomModelBtn) pmFormAddCustomModelBtn.addEventListener('click', addCustomModelToCatalog);
if (pmFormCustomModelInput) {
  pmFormCustomModelInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addCustomModelToCatalog();
    }
  });
}

// Quick Preset button handlers
$('#presetOllama')?.addEventListener('click', () => applyProviderPreset('ollama'));
$('#presetLMStudio')?.addEventListener('click', () => applyProviderPreset('lmstudio'));
$('#presetOpenRouter')?.addEventListener('click', () => applyProviderPreset('openrouter'));
$('#presetDeepSeek')?.addEventListener('click', () => applyProviderPreset('deepseek'));
$('#presetGoogle')?.addEventListener('click', () => applyProviderPreset('google'));
$('#presetLocalAI')?.addEventListener('click', () => applyProviderPreset('localai'));

// API Key visibility toggle
if (pmKeyToggle) {
  pmKeyToggle.addEventListener('click', () => {
    const isPassword = pmFormKey.type === 'password';
    pmFormKey.type = isPassword ? 'text' : 'password';
    pmKeyToggle.title = isPassword ? 'Hide API key' : 'Show API key';
    pmKeyToggle.setAttribute('aria-label', isPassword ? 'Hide API key' : 'Show API key');
    pmKeyToggle.innerHTML = isPassword
      ? `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`
      : `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
  });
}

// Model Catalog Search & Clear
if (pmModelsSearch) {
  pmModelsSearch.addEventListener('input', () => {
    pmModelsSearchQuery = pmModelsSearch.value;
    if (pmModelsSearchClear) {
      pmModelsSearchClear.hidden = !pmModelsSearchQuery;
    }
    renderPmModelsCatalog();
  });
  pmModelsSearch.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && pmModelsSearch.value) {
      e.stopPropagation();
      pmModelsSearch.value = '';
      pmModelsSearchQuery = '';
      if (pmModelsSearchClear) pmModelsSearchClear.hidden = true;
      renderPmModelsCatalog();
    }
  });
}

if (pmModelsSearchClear) {
  pmModelsSearchClear.addEventListener('click', () => {
    if (pmModelsSearch) {
      pmModelsSearch.value = '';
      pmModelsSearch.focus();
    }
    pmModelsSearchQuery = '';
    pmModelsSearchClear.hidden = true;
    renderPmModelsCatalog();
  });
}

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
