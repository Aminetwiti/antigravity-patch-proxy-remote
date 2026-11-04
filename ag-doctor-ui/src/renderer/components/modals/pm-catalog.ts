/**
 * pm-catalog.ts — Provider Manager Model Catalog, Capabilities, and Presets.
 * Extracted from modal-provider.ts for Single Responsibility (SRP).
 */

function getPmCatalogDom() {
  return {
    modelsList: document.querySelector<HTMLDivElement>('#pmModelsList'),
    modelsCountBadge: document.querySelector<HTMLSpanElement>('#pmModelsCountBadge'),
    modelsSearch: document.querySelector<HTMLInputElement>('#pmModelsSearch'),
    modelsSearchClear: document.querySelector<HTMLButtonElement>('#pmModelsSearchClear'),
    modelsSelectAll: document.querySelector<HTMLButtonElement>('#pmModelsSelectAll'),
    modelsDeselectAll: document.querySelector<HTMLButtonElement>('#pmModelsDeselectAll'),
    formCustomModelInput: document.querySelector<HTMLInputElement>('#pmFormCustomModelInput'),
    formAddCustomModelBtn: document.querySelector<HTMLButtonElement>('#pmFormAddCustomModelBtn'),
    capFilters: document.querySelector<HTMLDivElement>('#pmCapFilters'),
    formName: document.querySelector<HTMLInputElement>('#pmFormName'),
    formType: document.querySelector<HTMLSelectElement>('#pmFormType'),
    formUrl: document.querySelector<HTMLInputElement>('#pmFormUrl'),
    formKey: document.querySelector<HTMLInputElement>('#pmFormKey'),
  };
}

let pmActiveCapFilter: 'all' | 'reasoning' | 'vision' | 'code' = 'all';
let pmModelsSearchQueryStr = '';

function applyProviderPreset(presetKey: string): void {
  const dom = getPmCatalogDom();
  const presets = (window as any).RENDERER_PROVIDER_PRESETS || {};
  const p = presets[presetKey];
  if (!p || !dom.formName || !dom.formType || !dom.formUrl || !dom.formKey) return;
  dom.formName.value = p.name;
  dom.formType.value = p.providerType || 'openai';
  dom.formUrl.value = p.defaultApiUrl;
  if (p.defaultKey) {
    dom.formKey.value = p.defaultKey;
  }
  (window as any).toast?.(`Preset applied: ${p.name}`, 'ok');
  if (!p.defaultKey && p.providerType !== 'custom') {
    dom.formKey.focus();
  }
}

function updatePmModelsCounter(): void {
  const dom = getPmCatalogDom();
  if (!dom.modelsCountBadge) return;
  const models: any[] = (window as any).currentFetchedModels || [];
  const total = models.length;
  const selected = models.filter((m) => m.enabled !== false).length;
  dom.modelsCountBadge.textContent = `${selected} / ${total} selected`;
  if (selected === 0) {
    dom.modelsCountBadge.className = 'badge badge-warn';
  } else if (selected === total && total > 0) {
    dom.modelsCountBadge.className = 'badge badge-ok';
  } else {
    dom.modelsCountBadge.className = 'badge badge-primary';
  }
}

function renderPmModelsCatalog(): void {
  const dom = getPmCatalogDom();
  if (!dom.modelsList) return;
  updatePmModelsCounter();
  const models: any[] = (window as any).currentFetchedModels || [];
  const q = pmModelsSearchQueryStr.trim().toLowerCase();
  const detectCaps = typeof (window as any).detectModelCapabilities === 'function'
    ? (window as any).detectModelCapabilities
    : () => [];

  const filtered = models.filter((m) => {
    const caps = detectCaps(m.id);
    if (pmActiveCapFilter !== 'all' && !caps.includes(pmActiveCapFilter)) {
      return false;
    }
    if (!q) return true;
    return m.id.toLowerCase().includes(q) || (m.displayName || '').toLowerCase().includes(q);
  });

  if (models.length === 0) {
    dom.modelsList.innerHTML = '<div class="pm-models-hint">No models loaded. Click "Fetch models" or add custom ID below.</div>';
    return;
  }

  if (filtered.length === 0) {
    dom.modelsList.innerHTML = `<div class="pm-models-hint">No models matching active filter or search query.</div>`;
    return;
  }

  let html = '<div class="agy-model-chips">';
  for (const m of filtered) {
    const checked = m.enabled !== false ? 'checked' : '';
    const selectedClass = m.enabled !== false ? ' is-selected' : '';
    const caps = detectCaps(m.id);
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
  dom.modelsList.innerHTML = html;
}

function addCustomModelToCatalog(): void {
  const dom = getPmCatalogDom();
  if (!dom.formCustomModelInput) return;
  const customId = dom.formCustomModelInput.value.trim();
  if (!customId) return;
  const models: any[] = (window as any).currentFetchedModels || [];
  const exists = models.some((m) => m.id.toLowerCase() === customId.toLowerCase());
  if (!exists) {
    models.push({ id: customId, displayName: customId, enabled: true });
    (window as any).toast?.(`Added custom model ${customId}`, 'ok');
  }
  dom.formCustomModelInput.value = '';
  renderPmModelsCatalog();
}

function initPmCatalogHandlers(): void {
  const dom = getPmCatalogDom();

  dom.capFilters?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('.pm-cap-filter');
    if (!btn || !btn.dataset.cap) return;
    pmActiveCapFilter = btn.dataset.cap as any;
    dom.capFilters?.querySelectorAll('.pm-cap-filter').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    renderPmModelsCatalog();
  });

  dom.modelsList?.addEventListener('change', (e) => {
    const target = e.target as HTMLInputElement;
    if (target && target.matches('input[data-model-id]')) {
      const modelId = target.dataset.modelId;
      const models: any[] = (window as any).currentFetchedModels || [];
      const model = models.find((m) => m.id === modelId);
      if (model) {
        model.enabled = target.checked;
        target.closest('.agy-chip')?.classList.toggle('is-selected', target.checked);
        updatePmModelsCounter();
      }
    }
  });

  dom.modelsSelectAll?.addEventListener('click', () => {
    const models: any[] = (window as any).currentFetchedModels || [];
    const q = pmModelsSearchQueryStr.trim().toLowerCase();
    const detectCaps = typeof (window as any).detectModelCapabilities === 'function' ? (window as any).detectModelCapabilities : () => [];
    models.forEach((m) => {
      const caps = detectCaps(m.id);
      if (pmActiveCapFilter !== 'all' && !caps.includes(pmActiveCapFilter)) return;
      if (q && !m.id.toLowerCase().includes(q) && !(m.displayName || '').toLowerCase().includes(q)) return;
      m.enabled = true;
    });
    renderPmModelsCatalog();
  });

  dom.modelsDeselectAll?.addEventListener('click', () => {
    const models: any[] = (window as any).currentFetchedModels || [];
    const q = pmModelsSearchQueryStr.trim().toLowerCase();
    const detectCaps = typeof (window as any).detectModelCapabilities === 'function' ? (window as any).detectModelCapabilities : () => [];
    if (!q && pmActiveCapFilter === 'all') {
      models.forEach((m) => { m.enabled = false; });
    } else {
      models.forEach((m) => {
        const caps = detectCaps(m.id);
        if (pmActiveCapFilter !== 'all' && !caps.includes(pmActiveCapFilter)) return;
        if (q && !m.id.toLowerCase().includes(q) && !(m.displayName || '').toLowerCase().includes(q)) return;
        m.enabled = false;
      });
    }
    renderPmModelsCatalog();
  });

  if (dom.formAddCustomModelBtn) dom.formAddCustomModelBtn.addEventListener('click', addCustomModelToCatalog);
  if (dom.formCustomModelInput) {
    dom.formCustomModelInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addCustomModelToCatalog();
      }
    });
  }

  if (dom.modelsSearch) {
    dom.modelsSearch.addEventListener('input', () => {
      pmModelsSearchQueryStr = dom.modelsSearch?.value || '';
      if (dom.modelsSearchClear) {
        dom.modelsSearchClear.hidden = !pmModelsSearchQueryStr;
      }
      renderPmModelsCatalog();
    });
    dom.modelsSearch.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && dom.modelsSearch?.value) {
        e.stopPropagation();
        dom.modelsSearch.value = '';
        pmModelsSearchQueryStr = '';
        if (dom.modelsSearchClear) if (dom.modelsSearchClear) dom.modelsSearchClear.hidden = true;
        renderPmModelsCatalog();
      }
    });
  }

  const searchClearEl = dom.modelsSearchClear;
  if (searchClearEl) {
    searchClearEl.addEventListener('click', () => {
      if (dom.modelsSearch) {
        dom.modelsSearch.value = '';
        dom.modelsSearch.focus();
      }
      pmModelsSearchQueryStr = '';
      searchClearEl.hidden = true;
      renderPmModelsCatalog();
    });
  }

  document.querySelector('#presetOllama')?.addEventListener('click', () => applyProviderPreset('ollama'));
  document.querySelector('#presetLMStudio')?.addEventListener('click', () => applyProviderPreset('lmstudio'));
  document.querySelector('#presetOpenRouter')?.addEventListener('click', () => applyProviderPreset('openrouter'));
  document.querySelector('#presetDeepSeek')?.addEventListener('click', () => applyProviderPreset('deepseek'));
  document.querySelector('#presetGoogle')?.addEventListener('click', () => applyProviderPreset('google'));
  document.querySelector('#presetLocalAI')?.addEventListener('click', () => applyProviderPreset('localai'));
}

if (typeof window !== 'undefined') {
  (window as any).applyProviderPreset = applyProviderPreset;
  (window as any).updatePmModelsCounter = updatePmModelsCounter;
  (window as any).renderPmModelsCatalog = renderPmModelsCatalog;
  (window as any).initPmCatalogHandlers = initPmCatalogHandlers;
}
