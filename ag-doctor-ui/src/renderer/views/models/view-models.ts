import {
  testSingleModel,
  testBatchModels,
  renderPingBadge,
  formatApiError,
  PingPongResult,
} from '../../services/accounts/ping-pong-tester';




﻿// Models view
// ─────────────────────────────────────────────────────────────────────────────

const modelsList = $('#modelsList') as HTMLDivElement;
const modelsSearchInput = $('#modelsSearchInput') as HTMLInputElement | null;
const modelsPageSizeSelect = $('#modelsPageSizeSelect') as HTMLSelectElement | null;
const modelsPaginationInfo = $('#modelsPaginationInfo') as HTMLSpanElement | null;
const modelsPaginationNav = $('#modelsPaginationNav') as HTMLDivElement | null;
const modelsPrevPageBtn = $('#modelsPrevPageBtn') as HTMLButtonElement | null;
const modelsNextPageBtn = $('#modelsNextPageBtn') as HTMLButtonElement | null;
const modelsPageNumbers = $('#modelsPageNumbers') as HTMLDivElement | null;

// State for pagination & filtering
let allLoadedModels: CustomModel[] = [];
let modelsCurrentPage = 1;
let modelsPageSize = 10;
let modelsSearchQuery = '';
let modelsCategoryFilter: 'all' | 'active' | 'disabled' = 'all';
let modelsProviderFilter = 'all';
let modelsCapFilter: 'all' | 'reasoning' | 'vision' | 'code' = 'all';
let modelsSortOrder: 'default' | 'name-asc' | 'name-desc' | 'provider' | 'status' = 'default';
let selectedModelNames = new Set<string>();

const modelsSearchClearBtn = $('#modelsSearchClearBtn') as HTMLButtonElement | null;
const modelsProviderFilterSelect = $('#modelsProviderFilter') as HTMLSelectElement | null;
const modelsSortSelect = $('#modelsSortSelect') as HTMLSelectElement | null;
const modelsCapFilters = $('#modelsCapFilters') as HTMLDivElement | null;
const modelsSelectedBadge = $('#modelsSelectedBadge') as HTMLSpanElement | null;
const modelsSelectAllMatchesBtn = $('#modelsSelectAllMatchesBtn') as HTMLButtonElement | null;
const modelsSelectAllCount = $('#modelsSelectAllCount') as HTMLSpanElement | null;
const modelsClearSelectionBtn = $('#modelsClearSelectionBtn') as HTMLButtonElement | null;

function detectModelCapabilities(modelId: string): string[] {
  const caps: string[] = [];
  const id = modelId.toLowerCase();
  if (/r1|o1|o3|reasoner|thinking|qwq/.test(id)) caps.push('reasoning');
  if (/vision|4o|claude-3|gemini-1\.5|flash|pixtral/.test(id)) caps.push('vision');
  if (/coder|code|starcoder|qwen2\.5-coder/.test(id)) caps.push('code');
  return caps;
}

// Reusable template for models list — avoids creating a new <template> each load
const modelsTpl = document.createElement('template');
/** Shared filter: search query + category tab + provider filter + capability filter + sort order. */
function getFilteredModels(): typeof allLoadedModels {
  const query = modelsSearchQuery.trim().toLowerCase();
  let list = allLoadedModels.filter((m) => {
    // Category filter
    const isActive = m.enabled !== false;
    if (modelsCategoryFilter === 'active' && !isActive) return false;
    if (modelsCategoryFilter === 'disabled' && isActive) return false;

    // Provider / Account filter
    if (modelsProviderFilter !== 'all') {
      if (modelsProviderFilter.startsWith('account:')) {
        const targetAcc = modelsProviderFilter.slice(8).toLowerCase();
        const acc = String(m.accountName || m.accountEmail || m.providerId || '').toLowerCase();
        if (acc !== targetAcc) return false;
      } else if ((m.provider || '').toLowerCase() !== modelsProviderFilter.toLowerCase()) {
        return false;
      }
    }

    // Capability filter
    if (modelsCapFilter !== 'all') {
      const caps = detectModelCapabilities((m.name || '') + ' ' + (m.externalModelName || '') + ' ' + (m.displayName || ''));
      if (!caps.includes(modelsCapFilter)) return false;
    }

    if (!query) return true;
    const name = (m.name ?? '').toLowerCase();
    const displayName = (m.displayName ?? '').toLowerCase();
    const provider = (m.provider ?? '').toLowerCase();
    const externalName = (m.externalModelName ?? '').toLowerCase();
    const apiUrl = (m.apiUrl ?? '').toLowerCase();
    const account = `${m.accountName ?? ''} ${m.accountEmail ?? ''}`.toLowerCase();
    return (
      name.includes(query) ||
      displayName.includes(query) ||
      provider.includes(query) ||
      externalName.includes(query) ||
      apiUrl.includes(query) ||
      account.includes(query)
    );
  });

  if (modelsSortOrder === 'name-asc') {
    list = [...list].sort((a, b) => (a.displayName || a.name).localeCompare(b.displayName || b.name));
  } else if (modelsSortOrder === 'name-desc') {
    list = [...list].sort((a, b) => (b.displayName || b.name).localeCompare(a.displayName || a.name));
  } else if (modelsSortOrder === 'provider') {
    list = [...list].sort((a, b) => {
      const pCmp = (a.provider || '').localeCompare(b.provider || '');
      if (pCmp !== 0) return pCmp;
      const accA = a.accountName || a.accountEmail || '';
      const accB = b.accountName || b.accountEmail || '';
      return accA.localeCompare(accB);
    });
  } else if (modelsSortOrder === 'status') {
    list = [...list].sort((a, b) => {
      const aActive = a.enabled !== false ? 1 : 0;
      const bActive = b.enabled !== false ? 1 : 0;
      return bActive - aActive;
    });
  }

  return list;
}

function updateBulkActionButtonsState(): void {
  const btnTest = document.getElementById('modelsBulkTestBtn') as HTMLButtonElement;
  const btnEnable = document.getElementById('modelsBulkEnableBtn') as HTMLButtonElement;
  const btnDisable = document.getElementById('modelsBulkDisableBtn') as HTMLButtonElement;
  const btnDelete = document.getElementById('modelsBulkDeleteBtn') as HTMLButtonElement;
  const cbSelectAll = document.getElementById('modelsSelectAllCb') as HTMLInputElement;
  const filtered = getFilteredModels();
  // Dynamic Category Tab Badges (BUG-2.1 fix)
  const allCount = allLoadedModels.length;
  const activeCount = allLoadedModels.filter(m => m.enabled !== false).length;
  const disabledCount = allLoadedModels.filter(m => m.enabled === false).length;
  const tabAll = document.querySelector('.models-cat-tab[data-cat="all"]');
  const tabActive = document.querySelector('.models-cat-tab[data-cat="active"]');
  const tabDisabled = document.querySelector('.models-cat-tab[data-cat="disabled"]');
  if (tabAll) tabAll.textContent = `All (${allCount})`;
  if (tabActive) tabActive.textContent = `Active (${activeCount})`;
  if (tabDisabled) tabDisabled.textContent = `Disabled (${disabledCount})`;

  const totalItems = filtered.length;
  let page = modelsCurrentPage;
  const totalPages = Math.max(1, Math.ceil(totalItems / modelsPageSize));
  if (page > totalPages) page = totalPages;
  if (page < 1) page = 1;
  const startIdx = (page - 1) * modelsPageSize;
  const endIdx = Math.min(startIdx + modelsPageSize, totalItems);
  const pageItems = filtered.slice(startIdx, endIdx);

  const hasSelection = selectedModelNames.size > 0;
  if (btnTest) btnTest.disabled = !hasSelection;
  if (btnEnable) btnEnable.disabled = !hasSelection;
  if (btnDisable) btnDisable.disabled = !hasSelection;
  if (btnDelete) btnDelete.disabled = !hasSelection;

  if (modelsSelectedBadge) {
    if (hasSelection) {
      modelsSelectedBadge.textContent = `${selectedModelNames.size} selected`;
      modelsSelectedBadge.style.display = 'inline-block';
    } else {
      modelsSelectedBadge.style.display = 'none';
    }
  }

  if (modelsSelectAllMatchesBtn && modelsSelectAllCount) {
    modelsSelectAllCount.textContent = String(totalItems);
    modelsSelectAllMatchesBtn.style.display = totalItems > pageItems.length ? 'inline-block' : 'none';
  }

  if (modelsClearSelectionBtn) {
    modelsClearSelectionBtn.style.display = hasSelection ? 'inline-block' : 'none';
  }

  if (cbSelectAll && pageItems) {
    if (pageItems.length === 0) {
      cbSelectAll.checked = false;
      cbSelectAll.indeterminate = false;
    } else {
      const selectedOnPage = pageItems.filter(m => selectedModelNames.has(m.name)).length;
      if (selectedOnPage === pageItems.length) {
        cbSelectAll.checked = true;
        cbSelectAll.indeterminate = false;
      } else if (selectedOnPage > 0) {
        cbSelectAll.checked = false;
        cbSelectAll.indeterminate = true;
      } else {
        cbSelectAll.checked = false;
        cbSelectAll.indeterminate = false;
      }
    }
  }
}

function renderModelsView(): void {
  const query = modelsSearchQuery.trim().toLowerCase();
  const filtered = getFilteredModels();

  const totalItems = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / modelsPageSize));

  if (modelsCurrentPage > totalPages) modelsCurrentPage = totalPages;
  if (modelsCurrentPage < 1) modelsCurrentPage = 1;

  const startIdx = (modelsCurrentPage - 1) * modelsPageSize;
  const endIdx = Math.min(startIdx + modelsPageSize, totalItems);
  const pageItems = filtered.slice(startIdx, endIdx);

  // Update Category Tab Count Badges
  const allCount = allLoadedModels.length;
  const activeCount = allLoadedModels.filter((m) => m.enabled !== false).length;
  const disabledCount = allLoadedModels.filter((m) => m.enabled === false).length;

  document.querySelectorAll('.models-cat-tab').forEach((btn) => {
    const el = btn as HTMLButtonElement;
    const cat = el.dataset.cat;
    if (cat === 'all') el.textContent = `All (${allCount})`;
    else if (cat === 'active') el.textContent = `Active (${activeCount})`;
    else if (cat === 'disabled') el.textContent = `Disabled (${disabledCount})`;
  });

  // Dynamically populate Provider & Account Filter select options
  if (modelsProviderFilterSelect) {
    const currentVal = modelsProviderFilter;
    const providersMap = new Map<string, number>();
    const accountsMap = new Map<string, { label: string; count: number; filterKey: string }>();
    for (const m of allLoadedModels) {
      const p = m.provider || 'custom';
      providersMap.set(p, (providersMap.get(p) || 0) + 1);
      const acc = m.accountName || m.accountEmail || m.providerId;
      if (acc) {
        const key = String(acc).toLowerCase();
        const existing = accountsMap.get(key);
        if (existing) {
          existing.count++;
        } else {
          accountsMap.set(key, { label: `${p} · ${acc}`, count: 1, filterKey: `account:${key}` });
        }
      }
    }
    let opts = `<option value="all">All providers & accounts (${allLoadedModels.length})</option>`;
    if (accountsMap.size > 1) {
      opts += `<optgroup label="Filter by Account">`;
      for (const item of accountsMap.values()) {
        opts += `<option value="${escapeHtml(item.filterKey)}">${escapeHtml(item.label)} (${item.count})</option>`;
      }
      opts += `</optgroup>`;
    }
    opts += `<optgroup label="Filter by Provider Type">`;
    for (const [p, count] of providersMap.entries()) {
      opts += `<option value="${escapeHtml(p)}">${escapeHtml(p)} (${count})</option>`;
    }
    opts += `</optgroup>`;
    modelsProviderFilterSelect.innerHTML = opts;
    if (providersMap.has(currentVal) || currentVal.startsWith('account:') || currentVal === 'all') {
      modelsProviderFilterSelect.value = currentVal;
    } else {
      modelsProviderFilter = 'all';
      modelsProviderFilterSelect.value = 'all';
    }
  }

  // Update pagination info text
  if (modelsPaginationInfo) {
    if (allLoadedModels.length === 0) {
      modelsPaginationInfo.textContent = 'Showing 0 models';
    } else if (totalItems === 0) {
      modelsPaginationInfo.textContent = `0 models found (filtered from ${allLoadedModels.length})`;
    } else {
      const filterSuffix = query || modelsProviderFilter !== 'all' || modelsCapFilter !== 'all' ? ` (filtered from ${allLoadedModels.length})` : '';
      modelsPaginationInfo.textContent = `Showing ${startIdx + 1}–${endIdx} of ${totalItems} models${filterSuffix}`;
    }
  }

  // Render list items or empty state
  if (allLoadedModels.length === 0) {
    modelsList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">
          <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="9"/></svg>
        </div>
        <p style="margin-bottom: 12px;">No models configured yet. <strong>Add model</strong> to connect a custom OpenAI- or Anthropic-compatible provider.</p>
        <button class="btn btn-primary btn-sm" id="emptyAddModelBtn" type="button">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add model
        </button>
      </div>`;
  } else if (totalItems === 0) {
    modelsList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">
          <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        </div>
        <p style="margin-bottom: 8px;">No models matching current filters or search query.</p>
        <button class="btn btn-ghost btn-sm" id="clearModelsSearchBtn" type="button">Reset filters</button>
      </div>`;
  } else {
    const html = pageItems
      .map((m) => {
        const initials = (m.displayName ?? m.name).slice(0, 2).toUpperCase();
        const isEnabled = m.enabled !== false;
        const statusDotClass = isEnabled ? 'ok' : 'off';
        const isSelected = selectedModelNames.has(m.name);
        const providerLower = (m.provider || '').toLowerCase();
        const nameLower = (m.name || '').toLowerCase();
        let avatarBg = 'linear-gradient(135deg, #3b82f6, #1d4ed8)';
        if (providerLower.includes('openai') || nameLower.includes('gpt')) {
          avatarBg = 'linear-gradient(135deg, #10a37f, #059669)';
        } else if (providerLower.includes('anthropic') || nameLower.includes('claude')) {
          avatarBg = 'linear-gradient(135deg, #d97706, #b45309)';
        } else if (providerLower.includes('google') || nameLower.includes('gemini')) {
          avatarBg = 'linear-gradient(135deg, #8b5cf6, #6366f1)';
        } else if (nameLower.includes('deepseek')) {
          avatarBg = 'linear-gradient(135deg, #0284c7, #1d4ed8)';
        } else if (nameLower.includes('qwen') || providerLower.includes('aliyun') || providerLower.includes('dashscope')) {
          avatarBg = 'linear-gradient(135deg, #6366f1, #4f46e5)';
        } else if (providerLower.includes('ollama')) {
          avatarBg = 'linear-gradient(135deg, #64748b, #334155)';
        }

        const caps = detectModelCapabilities((m.name || '') + ' ' + (m.externalModelName || '') + ' ' + (m.displayName || ''));
        const capsHtml = caps.length > 0
          ? `<span class="model-caps">${caps.map((c) => `<span class="pm-cap-badge ${c}">${c}</span>`).join('')}</span>`
          : '';

        let providerBadgeClass = 'custom';
        if (providerLower.includes('openai')) providerBadgeClass = 'openai';
        else if (providerLower.includes('anthropic')) providerBadgeClass = 'anthropic';
        else if (providerLower.includes('google')) providerBadgeClass = 'google';
        else if (providerLower.includes('openrouter')) providerBadgeClass = 'openrouter';
        else if (providerLower.includes('ollama')) providerBadgeClass = 'ollama';

        return `
          <div class="model-card ${isEnabled ? '' : 'model-disabled'}${isSelected ? ' is-selected' : ''}" style="padding-left: 0;">
            <div style="padding: 0 12px; display: flex; align-items: center;">
              <input type="checkbox" class="model-select-cb" data-name="${escapeHtml(m.name)}" ${isSelected ? 'checked' : ''} style="cursor: pointer; width: 14px; height: 14px; margin: 0;">
            </div>
            <div class="model-avatar" style="margin-left: 0; background: ${avatarBg};">${escapeHtml(initials)}</div>
            <div class="model-body">
              <div class="model-name">
                <span class="status-dot ${statusDotClass}" id="status-dot-${escapeHtml(m.name)}" title="${isEnabled ? 'Active' : 'Disabled'}"></span>
                <span>${escapeHtml(m.displayName ?? m.name)}</span>
                ${capsHtml}
              </div>
              <div class="model-meta">
                <code>${escapeHtml(m.name)}</code> · <span class="agy-provider-badge ${providerBadgeClass}">${escapeHtml(m.provider)}</span>
                ${m.provider === 'google' ? ` · <span class="ga-badge ga-badge-account" style="background: rgba(59, 130, 246, 0.12); color: #3b82f6; font-size: 11px; padding: 2px 7px; border-radius: 4px; font-weight: 500; display: inline-flex; align-items: center; gap: 3px;">👥 Dynamic Account Pool</span>` : (m.accountName || m.accountEmail ? ` · <span class="ga-badge ga-badge-account" style="background: rgba(59, 130, 246, 0.12); color: #3b82f6; font-size: 11px; padding: 2px 7px; border-radius: 4px; font-weight: 500; display: inline-flex; align-items: center; gap: 3px;">👤 ${escapeHtml(m.accountName || m.accountEmail || "")}</span>` : "")}
                · ${escapeHtml(m.externalModelName)}
              </div>
              <div class="model-meta" style="margin-top:4px">
                <code style="font-size:10px">${escapeHtml(m.apiUrl)}</code> · key: ${escapeHtml(maskKey(m.apiKey))}${m.encrypted ? ' · <span style="color:var(--ok)">encrypted</span>' : ''}
              </div>
            </div>
            <div class="model-actions">
              <button class="btn btn-ghost btn-sm model-action-ping" data-action="ping" data-name="${escapeHtml(m.name)}" data-provider="${escapeHtml(m.provider)}" data-url="${escapeHtml(m.apiUrl)}" data-account="${escapeHtml(m.accountName || m.accountEmail || '')}" data-provider-id="${escapeHtml(m.providerId || '')}" title="Ping latency & connectivity test">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>
                Ping
              </button>
              <button class="btn btn-ghost btn-sm model-action-test" data-action="test" data-name="${escapeHtml(m.name)}" data-account="${escapeHtml(m.accountName || m.accountEmail || '')}" data-provider-id="${escapeHtml(m.providerId || '')}" title="Test connection to ${escapeHtml(m.name)}">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
                Test
              </button>
              <button class="btn btn-ghost btn-sm model-action-edit" data-action="edit" data-name="${escapeHtml(m.name)}" data-provider="${escapeHtml(m.provider)}" data-url="${escapeHtml(m.apiUrl)}" data-account="${escapeHtml(m.accountName || m.accountEmail || '')}" data-provider-id="${escapeHtml(m.providerId || '')}" title="Edit provider for ${escapeHtml(m.name)}">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                Edit
              </button>
              <button class="btn btn-ghost btn-sm model-action-toggle ${isEnabled ? 'is-active' : 'is-disabled'}" data-action="toggle" data-name="${escapeHtml(m.name)}" data-account="${escapeHtml(m.accountName || m.accountEmail || '')}" data-provider-id="${escapeHtml(m.providerId || '')}" title="${isEnabled ? 'Disable model' : 'Enable model'}">
                <span class="status-dot-sm ${isEnabled ? 'ok' : 'off'}"></span>
                ${isEnabled ? 'Active' : 'Disabled'}
              </button>
              <button class="btn btn-danger btn-sm model-action-delete" data-action="remove" data-name="${escapeHtml(m.name)}" data-url="${escapeHtml(m.apiUrl)}" data-account="${escapeHtml(m.accountName || m.accountEmail || '')}" data-provider-id="${escapeHtml(m.providerId || '')}" title="Delete model ${escapeHtml(m.name)}">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
                Delete
              </button>
            </div>
          </div>`;
      })
      .join('');
    modelsTpl.innerHTML = html;
    modelsList.replaceChildren(modelsTpl.content);
  }

  // Update Bulk Actions UI state
  updateBulkActionButtonsState();

  // Update Pagination Controls
  if (modelsPaginationNav) {
    if (totalPages <= 1) {
      modelsPaginationNav.style.display = 'none';
    } else {
      modelsPaginationNav.style.display = 'flex';

      if (modelsPrevPageBtn) modelsPrevPageBtn.disabled = modelsCurrentPage <= 1;
      if (modelsNextPageBtn) modelsNextPageBtn.disabled = modelsCurrentPage >= totalPages;

      if (modelsPageNumbers) {
        let pagesHtml = '';
        const delta = 1;
        const range: number[] = [];
        const rangeWithDots: (number | string)[] = [];

        for (let i = 1; i <= totalPages; i++) {
          if (i === 1 || i === totalPages || (i >= modelsCurrentPage - delta && i <= modelsCurrentPage + delta)) {
            range.push(i);
          }
        }

        let l: number | undefined;
        for (const i of range) {
          if (l !== undefined) {
            if (i - l === 2) {
              rangeWithDots.push(l + 1);
            } else if (i - l !== 1) {
              rangeWithDots.push('…');
            }
          }
          rangeWithDots.push(i);
          l = i;
        }

        for (const pageItem of rangeWithDots) {
          if (typeof pageItem === 'number') {
            const isActive = pageItem === modelsCurrentPage ? 'active' : '';
            pagesHtml += `<button class="models-page-btn ${isActive}" data-page="${pageItem}" type="button">${pageItem}</button>`;
          } else {
            pagesHtml += `<span class="models-page-ellipsis" style="padding: 0 4px; color: var(--text-2); font-size: 12px; display: inline-flex; align-items: center;">…</span>`;
          }
        }
        modelsPageNumbers.innerHTML = pagesHtml;
      }
    }
  }
}

// Search & Pagination controls listeners
modelsSearchInput?.addEventListener('input', () => {
  modelsSearchQuery = modelsSearchInput.value;
  modelsCurrentPage = 1;
  if (modelsSearchClearBtn) modelsSearchClearBtn.hidden = !modelsSearchQuery;
  renderModelsView();
});

modelsSearchClearBtn?.addEventListener('click', () => {
  if (modelsSearchInput) modelsSearchInput.value = '';
  modelsSearchQuery = '';
  if (modelsSearchClearBtn) modelsSearchClearBtn.hidden = true;
  modelsCurrentPage = 1;
  renderModelsView();
  modelsSearchInput?.focus();
});

modelsSearchInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    modelsSearchInput.value = '';
    modelsSearchQuery = '';
    if (modelsSearchClearBtn) modelsSearchClearBtn.hidden = true;
    modelsCurrentPage = 1;
    renderModelsView();
  }
});

modelsProviderFilterSelect?.addEventListener('change', () => {
  modelsProviderFilter = modelsProviderFilterSelect.value;
  modelsCurrentPage = 1;
  renderModelsView();
});

modelsSortSelect?.addEventListener('change', () => {
  modelsSortOrder = (modelsSortSelect.value || 'default') as 'default' | 'name-asc' | 'name-desc' | 'provider' | 'status';
  modelsCurrentPage = 1;
  renderModelsView();
});

document.querySelectorAll('.models-cap-filter').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    const target = e.currentTarget as HTMLButtonElement;
    const cap = target.dataset.cap as 'all' | 'reasoning' | 'vision' | 'code';
    if (!cap) return;
    document.querySelectorAll('.models-cap-filter').forEach((b) => b.classList.remove('active'));
    target.classList.add('active');
    modelsCapFilter = cap;
    modelsCurrentPage = 1;
    renderModelsView();
  });
});

modelsPageSizeSelect?.addEventListener('change', () => {
  modelsPageSize = parseInt(modelsPageSizeSelect.value, 10) || 10;
  modelsCurrentPage = 1;
  renderModelsView();
});

modelsPrevPageBtn?.addEventListener('click', () => {
  if (modelsCurrentPage > 1) {
    modelsCurrentPage--;
    renderModelsView();
  }
});

modelsNextPageBtn?.addEventListener('click', () => {
  modelsCurrentPage++;
  renderModelsView();
});

modelsPageNumbers?.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('.models-page-btn');
  if (btn && btn.dataset.page) {
    modelsCurrentPage = parseInt(btn.dataset.page, 10) || 1;
    renderModelsView();
  }
});

async function loadModels(): Promise<void> {
  setStatus('Loading models…', 'busy');
  showSkeleton(modelsList, 'cards', 3);
  try {
    const result = await window.ag.run(['models', 'list', '--json']);
    const data = JSON.parse(result.stdout) as ModelsFile;
    allLoadedModels = data.models || [];
    // Keep the dashboard models stat in sync with the live list (it is a
    // doctor-run snapshot otherwise and goes stale when models change).
    statModels.textContent = String(allLoadedModels.length);
    renderModelsView();
    setStatus(`${allLoadedModels.length} model(s) loaded`);
  } catch (e) {
    modelsList.innerHTML = `<div class="empty-state"><p>Could not load models: ${escapeHtml((e as Error).message)}</p></div>`;
    setStatus('Error', 'err');
  } finally {
    hideSkeleton(modelsList);
  }
}

// Category Tabs listeners
document.querySelectorAll('.models-cat-tab').forEach(btn => {
  btn.addEventListener('click', (e) => {
    const target = e.currentTarget as HTMLButtonElement;
    const cat = target.dataset.cat as 'all' | 'active' | 'disabled';
    if (!cat) return;

    document.querySelectorAll('.models-cat-tab').forEach(b => b.classList.remove('active'));
    target.classList.add('active');

    modelsCategoryFilter = cat;
    modelsCurrentPage = 1;
    renderModelsView();
  });
});

// Event delegation for model-card actions (one listener, not N)
modelsList.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (target.closest('#emptyAddModelBtn')) {
    openProviderManagerModal();
    return;
  }
  if (target.closest('#clearModelsSearchBtn')) {
    if (modelsSearchInput) modelsSearchInput.value = '';
    modelsSearchQuery = '';
    modelsCurrentPage = 1;
    renderModelsView();
    return;
  }
  const btn = target.closest<HTMLElement>('[data-action]');
  if (!btn) return;
  void handleModelAction(btn);
});

async function handleModelAction(btn: HTMLElement): Promise<void> {
  const action = btn.dataset.action;
  const name = btn.dataset.name ?? '';
  const url = btn.dataset.url ?? '';
  const provider = btn.dataset.provider ?? '';

  // Always ensure providersCache is populated from disk
  if (!providersCache || providersCache.length === 0) {
    try {
      providersCache = (await window.ag.providers.get()) as ProviderEntry[];
    } catch {
      providersCache = [];
    }
  }

  if (action === 'test') {
    setStatus(`Testing ${name}…`, 'busy');
    const dot = document.getElementById(`status-dot-${name}`);
    btn.setAttribute('disabled', 'true');
    const origHtml = btn.innerHTML;
    btn.innerHTML = `<span class="spinner"></span> Testing…`;

    try {
      const match = await getProviderForModelBulk(name);
      let success = false;
      let msg = '';
      if (match) {
        const cleanName = name.replace(/^models\//, '');
        const res = (await window.ag.providers.test({ apiUrl: match.apiUrl, apiKey: match.apiKey || "", id: match.id, modelId: cleanName })) as { success: boolean; latencyMs?: number; error?: string };
        success = res.success;
        msg = success ? `✓ ${name} reachable (${res.latencyMs ?? 0}ms)` : `${name} failed: ${formatApiError(res.error || 'Unreachable')}`;
      } else {
        const r = await window.ag.run(['models', 'test', name]);
        success = r.stdout.includes('✓') || r.code === 0;
        msg = success ? `✓ ${name} reachable` : `${name} failed`;
      }
      if (!success) throw new Error(msg);
      toast(msg, 'ok');
      if (dot) dot.className = 'status-dot ok';
    } catch (e) {
      toast(`Tested ${name}: Failed - ${formatApiError((e as Error).message)}`, 'err');
      if (dot) dot.className = 'status-dot off';
    } finally {
      btn.removeAttribute('disabled');
      btn.innerHTML = origHtml;
      setStatus('Ready');
    }
  } else if (action === 'ping') {
    setStatus(`Ping ${name}…`, 'busy');
    btn.setAttribute('disabled', 'true');
    const origHtml = btn.innerHTML;
    btn.innerHTML = `<span class="spinner"></span> Ping…`;
    try {
      const res = await testSingleModel({ name, provider, apiUrl: url, providerId: btn.dataset.providerId }, 'ping');
      const badgeHtml = renderPingBadge(res);
      const card = btn.closest('.model-card');
      const nameEl = card?.querySelector('.model-name');
      const existingBadge = card?.querySelector('.ping-badge');
      if (existingBadge) existingBadge.remove();
      if (nameEl) {
        nameEl.insertAdjacentHTML('beforeend', ' ' + badgeHtml);
      }
      if (res.ok) {
        toast(`Pong reçu de ${name} (${res.latencyMs}ms)${res.pongText ? ' : "' + res.pongText.slice(0, 40) + '…"' : ''}`, 'ok', 4000);
      } else {
        toast(`Ping échoué pour ${name} : ${formatApiError(res.error || 'Timeout')}`, 'err', 5000);
      }
      setStatus('Ready');
    } catch (e) {
      toast(`Erreur Ping : ${formatApiError((e as Error).message)}`, 'err');
      setStatus('Error', 'err');
    } finally {
      btn.removeAttribute('disabled');
      btn.innerHTML = origHtml;
    }
  } else if (action === 'toggle') {
    const isCurrentlyEnabled = !btn.classList.contains('is-disabled');
    const newEnabled = !isCurrentlyEnabled;

    // Toggle active UI state immediately for responsiveness
    btn.classList.toggle('is-disabled', !newEnabled);
    btn.classList.toggle('is-active', newEnabled);
    btn.title = newEnabled ? 'Disable model' : 'Enable model';
    btn.innerHTML = `
      <span class="status-dot-sm ${newEnabled ? 'ok' : 'off'}"></span>
      ${newEnabled ? 'Active' : 'Disabled'}
    `;
    btn.closest('.model-card')?.classList.toggle('model-disabled', !newEnabled);

    // Always find parent provider and save state
    const parentProvider = await getProviderForModelBulk(name);

    if (parentProvider) {
      const targetId = resolveModelId(parentProvider, name);
      if (!parentProvider.models) parentProvider.models = [];
      const pModel = parentProvider.models.find(m => m.id === targetId || m.displayName === targetId || m.id === name || m.displayName === name);
      if (pModel) {
        pModel.enabled = newEnabled;
      } else {
        parentProvider.models.push({ id: targetId, displayName: targetId, enabled: newEnabled });
      }
      if (Array.isArray(parentProvider.accounts)) {
        for (const acc of parentProvider.accounts) {
          if (Array.isArray(acc.models)) {
            const accM = acc.models.find((m: any) => m.id === targetId || m.displayName === targetId || m.id === name || m.displayName === name);
            if (accM) accM.enabled = newEnabled;
          }
        }
      }
      await window.ag.providers.save(parentProvider);
    } else {
      toast('Built-in models cannot be manually disabled yet.', 'warn');
      btn.classList.toggle('is-disabled', isCurrentlyEnabled);
      btn.classList.toggle('is-active', !isCurrentlyEnabled);
      btn.title = isCurrentlyEnabled ? 'Disable model' : 'Enable model';
      btn.innerHTML = `
        <span class="status-dot-sm ${isCurrentlyEnabled ? 'ok' : 'off'}"></span>
        ${isCurrentlyEnabled ? 'Active' : 'Disabled'}
      `;
      btn.closest('.model-card')?.classList.toggle('model-disabled', !isCurrentlyEnabled);
      return;
    }

    const dot = document.getElementById(`status-dot-${name}`);
    if (dot) {
      dot.className = `status-dot ${newEnabled ? 'ok' : 'off'}`;
    }

    toast(newEnabled ? `Enabled ${name}` : `Disabled ${name}`, 'ok');
    void loadModels();
    void renderProviderList();
  } else if (action === 'edit') {
    const parentProvider = await getProviderForModelBulk(name);
    if (parentProvider) {
      openProviderManagerModal();
      openProviderForm(parentProvider.id);
    } else {
      toast(`No editable provider found for ${name}`, 'warn');
    }
  } else if (action === 'remove') {
    const ok = await confirmModal(
      'Delete this model?',
      `Delete <strong>${escapeHtml(name)}</strong> from this device? This only removes the saved provider — models on your remote account are unaffected.`,
      { confirmLabel: 'Delete model', danger: true },
    );
    if (!ok) return;
    setStatus('Removing model…', 'busy');

    // Remove model entry from parent provider if present
    const parentProvider = await getProviderForModelBulk(name);

    if (parentProvider && parentProvider.models) {
      const targetId = resolveModelId(parentProvider, name);
      parentProvider.models = parentProvider.models.filter((m) => m.id !== targetId && m.displayName !== targetId && m.id !== name && m.displayName !== name);
      await window.ag.providers.save(parentProvider);
    }

    const r = await window.ag.run(['models', 'remove', name, '--yes']);
    if (r.code === 0 || parentProvider) {
      toast(`Removed ${name}`, 'ok');
      await loadModels();
      await renderProviderList();
    } else {
      toast(`Delete failed: ${r.stderr || r.stdout}. Check the Logs tab for details.`, 'err');
    }
    setStatus('Ready');
  }
}

$('#modelsTestBtn')?.addEventListener('click', async () => {
  setStatus('Testing all models…', 'busy');
  try {
    const r = await window.ag.run(['models', 'test']);
    if (r.code === 0) {
      toast('All models reachable', 'ok', 5000);
    } else {
      toast('Some models failed. Open the Models view for details.', 'warn', 5000);
    }
    setStatus('Ready');
  } catch (e) {
    toast(`Test failed: ${(e as Error).message}`, 'err');
    setStatus('Error', 'err');
  }
});

// ── Test & Auto-Disable ──────────────────────────────────────────────────────
async function testAndAutoDisable(silent = false): Promise<void> {
  // Lazy-load providers from disk if cache is empty
  if (providersCache.length === 0) {
    try { providersCache = (await window.ag.providers.get()) as ProviderEntry[]; } catch { providersCache = []; }
  }
  if (providersCache.length === 0) {
    if (!silent) toast('No custom providers configured', 'warn');
    return;
  }

  if (!silent) setStatus('Testing models & auto-disabling failures…', 'busy');
  let okModelCount = 0;
  let disabledModelCount = 0;

  for (const p of providersCache) {
    if (!p.enabled) continue;

    // First test base provider endpoint connectivity
    let baseRes = { success: false };
    try {
      baseRes = await window.ag.providers.test({ apiUrl: p.apiUrl, apiKey: p.apiKey || "", id: p.id });
    } catch {
      baseRes = { success: false };
    }

    if (!baseRes.success) {
      // Entire provider is down — disable provider and all its models
      p.enabled = false;
      if (p.models) {
        disabledModelCount += p.models.filter((m) => m.enabled !== false).length;
        p.models.forEach((m) => (m.enabled = false));
      }
      await window.ag.providers.save(p);
      continue;
    }

    // Provider is reachable! Test active models under this provider
    if (p.models && p.models.length > 0) {
      let providerSaveNeeded = false;
      for (const m of p.models) {
        if (m.enabled === false) continue;

        try {
          const mRes = await window.ag.providers.test({
            apiUrl: p.apiUrl,
            apiKey: p.apiKey || "",
            id: p.id,
            modelId: m.id,
          });

          if (mRes.success) {
            okModelCount++;
          } else {
            disabledModelCount++;
            m.enabled = false;
            providerSaveNeeded = true;
          }
        } catch {
          disabledModelCount++;
          m.enabled = false;
          providerSaveNeeded = true;
        }
      }

      if (providerSaveNeeded) {
        // If all models under provider were disabled, disable provider as well
        if (p.models.every((m) => m.enabled === false)) {
          p.enabled = false;
        }
        await window.ag.providers.save(p);
      }
    } else {
      okModelCount++;
    }
  }

  await loadModels();
  await renderProviderList();

  if (disabledModelCount === 0) {
    toast(`All ${okModelCount} active model(s) healthy`, 'ok', 5000);
  } else {
    toast(`${okModelCount} model(s) OK, ${disabledModelCount} failing → auto-disabled`, 'warn', 7000);
  }
  if (!silent) setStatus('Ready');
}

$('#modelsTestHideBtn')?.addEventListener('click', () => void testAndAutoDisable(false));

// ── Auto-Sentinel Toggle ─────────────────────────────────────────────────────
const SENTINEL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
let sentinelTimerId: ReturnType<typeof setInterval> | null = null;
const autoSentinelToggle = $('#autoSentinelToggle') as HTMLInputElement | null;
const autoSentinelLabel = $('#autoSentinelLabel') as HTMLSpanElement | null;

autoSentinelToggle?.addEventListener('change', () => {
  if (autoSentinelToggle.checked) {
    // Run immediately on activation, then repeat
    void testAndAutoDisable(true);
    sentinelTimerId = setInterval(() => void testAndAutoDisable(true), SENTINEL_INTERVAL_MS);
    if (autoSentinelLabel) autoSentinelLabel.textContent = 'Sentinel ON';
    toast('Auto-Sentinel enabled — checks every 5 min', 'ok');
  } else {
    if (sentinelTimerId !== null) {
      clearInterval(sentinelTimerId);
      sentinelTimerId = null;
    }
    if (autoSentinelLabel) autoSentinelLabel.textContent = 'Auto-Sentinel';
    toast('Auto-Sentinel disabled', 'ok');
  }
});

// Bulk Actions on Models Page

// Handle individual checkbox clicks
$('#modelsList')?.addEventListener('change', (e) => {
  const target = e.target as HTMLInputElement;
  if (target.classList.contains('model-select-cb')) {
    const name = target.dataset.name;
    if (name) {
      if (target.checked) selectedModelNames.add(name);
      else selectedModelNames.delete(name);
      target.closest('.model-card')?.classList.toggle('is-selected', target.checked);
      updateBulkActionButtonsState();
    }
  }
});

// Handle Select All click
// Select All — uses shared getFilteredModels() so category filter is respected (BUG-2 fix)
$('#modelsSelectAllCb')?.addEventListener('change', (e) => {
  const checked = (e.target as HTMLInputElement).checked;
  const filtered = getFilteredModels();
  const totalItems = filtered.length;
  let page = modelsCurrentPage;
  const totalPages = Math.max(1, Math.ceil(totalItems / modelsPageSize));
  if (page > totalPages) page = totalPages;
  if (page < 1) page = 1;
  const startIdx = (page - 1) * modelsPageSize;
  const endIdx = Math.min(startIdx + modelsPageSize, totalItems);
  const pageItems = filtered.slice(startIdx, endIdx);

  pageItems.forEach(m => {
    if (checked) selectedModelNames.add(m.name);
    else selectedModelNames.delete(m.name);
  });
  renderModelsView();
});

modelsSelectAllMatchesBtn?.addEventListener('click', () => {
  const filtered = getFilteredModels();
  filtered.forEach(m => selectedModelNames.add(m.name));
  renderModelsView();
  toast(`Selected all ${filtered.length} matching models`, 'ok');
});

modelsClearSelectionBtn?.addEventListener('click', () => {
  selectedModelNames.clear();
  renderModelsView();
});

let providersCache: ProviderEntry[] = [];

if (typeof window !== 'undefined' && (window as any).ag?.providers?.onChanged) {
  (window as any).ag.providers.onChanged(() => {
  providersCache = [];
  const modelsViewActive = Boolean(document.getElementById('view-models')?.classList.contains('active'));
  if (modelsViewActive) void loadModels();
  const pmModal = document.getElementById('providerManagerModalBackdrop');
  const isPmModalOpen = Boolean(pmModal && !pmModal.hidden && pmModal.style.display !== 'none');
  if (isPmModalOpen) void renderProviderList();
  // Synchronisation temps réel automatique du dashboard Google Accounts sans re-fetch réseau bloquant
  const gaViewActive = Boolean(document.getElementById('view-google-accounts')?.classList.contains('active'));
  if (gaViewActive || document.getElementById('gaAccountsContainer')) {
    const isModalOpen = Boolean(document.querySelector('.modal-backdrop:not([hidden])'));
    const isDropdownOpen = Boolean(document.querySelector('.ga-more-dropdown-wrap.open'));
    if (!isModalOpen && !isDropdownOpen) {
      void loadGoogleAccounts(false);
    }
  }
  });
}

// Helper for finding provider

function resolveModelId(provider: ProviderEntry, modelName: string): string {
  const prefix = `${provider.id}-`;
  if (modelName.startsWith(prefix)) return modelName.slice(prefix.length);
  return modelName.replace(/^models\//, '');
}

async function getProviderForModelBulk(modelName: string) {
  if (!providersCache || providersCache.length === 0) {
    try {
      providersCache = (await window.ag.providers.get()) as ProviderEntry[];
    } catch {
      providersCache = [];
    }
  }
  const cleanModelName = modelName.replace(/^models\//, '');
  const targetModel = allLoadedModels.find(m => m.name === modelName);
  return providersCache.find((p) => {
    if (p.provider && p.provider.toLowerCase() === 'openai' && targetModel && targetModel.apiUrl && p.apiUrl && p.apiUrl.toLowerCase() !== targetModel.apiUrl.toLowerCase()) {
      return false;
    }
    if (p.models?.some((m) => m.id === cleanModelName || m.displayName === cleanModelName || m.id === modelName || m.displayName === modelName)) return true;
    if (targetModel) {
      if (p.apiUrl && targetModel.apiUrl && p.apiUrl.toLowerCase() === targetModel.apiUrl.toLowerCase()) return true;
      if (p.provider && targetModel.provider && p.provider.toLowerCase() !== 'openai' && targetModel.provider.toLowerCase() !== 'openai' && p.provider.toLowerCase() === targetModel.provider.toLowerCase()) return true;
      if (!p.apiUrl && !targetModel.apiUrl && p.provider && targetModel.provider && p.provider.toLowerCase() === targetModel.provider.toLowerCase()) return true;
    }
    if ((p.provider === 'google' || p.provider === 'gemini') && (cleanModelName.startsWith('gemini-') || cleanModelName.startsWith('claude-'))) {
      return true;
    }
    return p.name.toLowerCase() === modelName.toLowerCase();
  });
}

$('#modelsBulkTestBtn')?.addEventListener('click', async () => {
  if (selectedModelNames.size === 0) return;
  setStatus(`Testing ${selectedModelNames.size} selected models…`, 'busy');
  let successCount = 0;
  let failCount = 0;

  for (const name of Array.from(selectedModelNames)) {
    const dot = document.getElementById(`status-dot-${name}`);
    if (dot) dot.className = 'status-dot'; // reset
    try {
      let success = false;
      const match = await getProviderForModelBulk(name);
      if (match) {
        const res = (await window.ag.providers.test({ apiUrl: match.apiUrl, apiKey: match.apiKey || "", id: match.id })) as { success: boolean; };
        success = res.success;
      } else {
        const r = await window.ag.run(['models', 'test', name]);
        success = r.stdout.includes('✓') || r.code === 0;
      }

      if (success) successCount++;
      else failCount++;

      if (dot) dot.className = `status-dot ${success ? 'ok' : 'err'}`;
    } catch (e) {
      failCount++;
      if (dot) dot.className = 'status-dot err';
    }
  }

  if (failCount === 0) {
    toast(`✓ Successfully tested ${successCount} models`, 'ok');
  } else {
    toast(`Tested ${successCount + failCount} models: ${successCount} succeeded, ${failCount} failed`, 'warn');
  }
  setStatus('Ready');
});

$('#modelsBulkEnableBtn')?.addEventListener('click', async () => {
  if (selectedModelNames.size === 0) return;
  setStatus(`Enabling ${selectedModelNames.size} selected models…`, 'busy');
  try {
    const providers = (await window.ag.providers.get()) as ProviderEntry[];
    providersCache = providers;
    const modifiedProviders = new Map<string, ProviderEntry>();
    let enabledCount = 0;

    for (const name of Array.from(selectedModelNames)) {
      const match = await getProviderForModelBulk(name);
      if (match) {
        const targetId = resolveModelId(match, name);
        const cleanName = name.replace(/^models\//, '');
        if (!match.models) match.models = [];
        const pModel = match.models.find((m) => m.id === targetId || m.displayName === targetId || m.id === name || m.displayName === name || m.id === cleanName);
        if (pModel) {
          pModel.enabled = true;
        } else {
          match.models.push({ id: targetId, displayName: targetId, enabled: true });
        }
        if (Array.isArray(match.accounts)) {
          for (const acc of match.accounts) {
            if (Array.isArray(acc.models)) {
              const accM = acc.models.find((m: any) => m.id === targetId || m.displayName === targetId || m.id === name || m.displayName === name || m.id === cleanName);
              if (accM) accM.enabled = true;
            }
          }
        }
        modifiedProviders.set(match.id, match);
        enabledCount++;
      }
    }

    for (const provider of modifiedProviders.values()) {
      await window.ag.providers.save(provider);
    }

    selectedModelNames.clear();
    toast(`Enabled ${enabledCount} models`, 'ok');
    void loadModels();
    void renderProviderList();
  } catch (err) {
    toast(`Bulk enable error: ${(err as Error).message}`, 'err');
  } finally {
    setStatus('Ready');
  }
});

$('#modelsBulkDisableBtn')?.addEventListener('click', async () => {
  if (selectedModelNames.size === 0) return;
  setStatus(`Disabling ${selectedModelNames.size} selected models…`, 'busy');
  try {
    const providers = (await window.ag.providers.get()) as ProviderEntry[];
    providersCache = providers;
    const modifiedProviders = new Map<string, ProviderEntry>();
    let disabledCount = 0;

    for (const name of Array.from(selectedModelNames)) {
      const match = await getProviderForModelBulk(name);
      if (match) {
        const targetId = resolveModelId(match, name);
        const cleanName = name.replace(/^models\//, '');
        if (!match.models) match.models = [];
        const pModel = match.models.find((m) => m.id === targetId || m.displayName === targetId || m.id === name || m.displayName === name || m.id === cleanName);
        if (pModel) {
          pModel.enabled = false;
        } else {
          match.models.push({ id: targetId, displayName: targetId, enabled: false });
        }
        if (Array.isArray(match.accounts)) {
          for (const acc of match.accounts) {
            if (Array.isArray(acc.models)) {
              const accM = acc.models.find((m: any) => m.id === targetId || m.displayName === targetId || m.id === name || m.displayName === name || m.id === cleanName);
              if (accM) accM.enabled = false;
            }
          }
        }
        modifiedProviders.set(match.id, match);
        disabledCount++;
      }
    }

    for (const provider of modifiedProviders.values()) {
      await window.ag.providers.save(provider);
    }

    selectedModelNames.clear();
    toast(`Disabled ${disabledCount} models`, 'ok');
    void loadModels();
    void renderProviderList();
  } catch (err) {
    toast(`Bulk disable error: ${(err as Error).message}`, 'err');
  } finally {
    setStatus('Ready');
  }
});

$('#modelsBulkDeleteBtn')?.addEventListener('click', async () => {
  if (selectedModelNames.size === 0) return;
  const count = selectedModelNames.size;
  const ok = await confirmModal(
    `Delete ${count} selected models?`,
    `Are you sure you want to delete <strong>${count} selected model(s)</strong>? This action cannot be undone.`,
    { confirmLabel: 'Delete selected', danger: true }
  );
  if (!ok) return;

  setStatus(`Deleting ${count} selected models…`, 'busy');
  try {
    const providers = (await window.ag.providers.get()) as ProviderEntry[];
    providersCache = providers;
    const modifiedProviders = new Map<string, ProviderEntry>();

    for (const name of Array.from(selectedModelNames)) {
      const match = await getProviderForModelBulk(name);
      if (match && match.models) {
        const targetId = resolveModelId(match, name);
        match.models = match.models.filter((m) => m.id !== targetId && m.displayName !== targetId && m.id !== name && m.displayName !== name);
        modifiedProviders.set(match.id, match);
      }
      await window.ag.run(['models', 'remove', name, '--yes']);
    }

    for (const provider of modifiedProviders.values()) {
      await window.ag.providers.save(provider);
    }

    selectedModelNames.clear();
    toast(`Deleted ${count} models`, 'ok');
    void loadModels();
    void renderProviderList();
  } catch (err) {
    toast(`Bulk delete error: ${(err as Error).message}`, 'err');
  } finally {
    setStatus('Ready');
  }
});

$('#exportProvidersBtn')?.addEventListener('click', async () => {
  try {
    const rawProviders = await window.ag.providers.get();
    const sanitized = Array.isArray(rawProviders) ? rawProviders.map((p: any) => {
      const copy = { ...p };
      if (Array.isArray(copy.accounts)) {
        copy.accounts = copy.accounts.map((acc: any) => {
          const { refreshToken, accessToken, idToken, ...safeAcc } = acc;
          return safeAcc;
        });
      }
      return copy;
    }) : [];
    const bundle = {
      version: '3.8.2',
      exportedAt: new Date().toISOString(),
      providers: sanitized,
    };
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(bundle, null, 2));
    const dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute('href', dataStr);
    dlAnchorElem.setAttribute('download', `antigravity_providers_export_${new Date().toISOString().slice(0, 10)}.json`);
    dlAnchorElem.click();
    toast('Providers exported (credentials secured)', 'ok');
  } catch (err) {
    toast(`Export failed: ${(err as Error).message}`, 'err');
  }
});

$('#importProvidersBtn')?.addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const providers = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.providers) ? parsed.providers : null);
      if (!providers) throw new Error('Invalid JSON format: expected an array or BackupBundle with "providers"');

      setStatus('Importing providers...', 'busy');
      for (const p of providers) {
        const res = await window.ag.providers.save(p);
        if (!res.success) throw new Error(`Failed to save provider: ${res.error}`);
      }
      toast(`Successfully imported ${providers.length} providers`, 'ok');
      void loadModels();
      void renderProviderList();
    } catch (err) {
      toast(`Import failed: ${(err as Error).message}`, 'err');
    } finally {
      setStatus('Ready');
    }
  };
  input.click();
});

$('#restoreBackupBtn')?.addEventListener('click', async () => {
  const ok = await confirmModal(
    'Restore Backup',
    'Are you sure you want to restore custom_models.json from the latest .bak file? This will overwrite your current configuration.',
    { confirmLabel: 'Restore', danger: true }
  );
  if (!ok) return;

  setStatus('Restoring backup...', 'busy');
  try {
    const res = await window.ag.restoreBackup();
    if (!res.success) throw new Error(res.error || 'Restore failed');
    toast('Backup restored successfully', 'ok');
    void loadModels();
    void renderProviderList();
  } catch (err) {
    toast(`Restore failed: ${(err as Error).message}`, 'err');
  } finally {
    setStatus('Ready');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
