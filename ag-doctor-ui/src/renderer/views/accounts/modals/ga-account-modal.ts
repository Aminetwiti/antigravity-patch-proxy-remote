/**
 * ga-account-modal.ts — Google Account Add & Edit Modal Controller.
 * Extracted from view-google-accounts.ts for Single Responsibility (SRP) and modularity.
 */

let lastFocusedGaElement: HTMLElement | null = null;

function getGaModalDom() {
  return {
    backdrop: document.querySelector<HTMLDivElement>('#gaModalBackdrop'),
    title: document.querySelector<HTMLElement>('#gaModalTitle'),
    formName: document.querySelector<HTMLInputElement>('#gaFormName'),
    formUrl: document.querySelector<HTMLInputElement>('#gaFormUrl'),
    formKey: document.querySelector<HTMLInputElement>('#gaFormKey'),
    formError: document.querySelector<HTMLElement>('#gaFormError'),
    accountTypeBanner: document.querySelector<HTMLElement>('#gaAccountTypeBanner'),
    keyLabel: document.querySelector<HTMLElement>('#gaFormKeyLabel'),
    keyHelper: document.querySelector<HTMLElement>('#gaFormKeyHelper'),
    modelsCountBadge: document.querySelector<HTMLElement>('#gaFormModelsCountBadge'),
    modelsList: document.querySelector<HTMLDivElement>('#gaFormModelsList'),
    modalClose: document.querySelector<HTMLButtonElement>('#gaModalClose'),
    cancelBtn: document.querySelector<HTMLButtonElement>('#gaFormCancelBtn'),
    addAccountBtn: document.querySelector<HTMLButtonElement>('#gaAddAccountBtn'),
  };
}

function updateGaModelsCounter(): void {
  const dom = getGaModalDom();
  if (!dom.modelsCountBadge) return;
  const models = (window as any).currentGaFetchedModels || [];
  const enabledCount = models.filter((m: any) => m.enabled !== false).length;
  dom.modelsCountBadge.textContent = `${enabledCount} active model${enabledCount !== 1 ? 's' : ''}`;
  if (enabledCount === 0) {
    dom.modelsCountBadge.className = 'badge badge-warn';
  } else {
    dom.modelsCountBadge.className = 'badge badge-primary';
  }
}

function renderGaFormModelsList(): void {
  const dom = getGaModalDom();
  if (!dom.modelsList) return;
  updateGaModelsCounter();
  const models = (window as any).currentGaFetchedModels || [];

  if (models.length === 0) {
    dom.modelsList.innerHTML = `
      <div class="pm-models-hint" style="font-size: 12px; color: var(--text-2); text-align: center; padding: 20px;">
        Click <strong>"Get Models from Endpoint"</strong> or choose a Preset above to add models.
      </div>
    `;
    return;
  }

  let html = `<div style="display: flex; flex-direction: column; gap: 4px;">`;
  models.forEach((m: any, idx: number) => {
    const isChecked = m.enabled !== false;
    html += `
      <label style="display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; background: rgba(255,255,255,0.03); border-radius: var(--r-sm); cursor: pointer;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <input type="checkbox" class="ga-model-cb" data-idx="${idx}" ${isChecked ? 'checked' : ''} style="width: 15px; height: 15px; cursor: pointer;" />
          <span style="font-size: 13px; font-weight: 500;">${escapeHtml(m.displayName || m.id)}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 11px; color: var(--text-2); font-family: var(--font-mono);">${escapeHtml(m.id)}</span>
          <button type="button" class="agy-icon-btn ga-remove-model-btn" data-idx="${idx}" title="Remove model" style="opacity: 0.6; padding: 2px;">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </label>
    `;
  });
  html += `</div>`;
  dom.modelsList.innerHTML = html;

  dom.modelsList.querySelectorAll<HTMLInputElement>('.ga-model-cb').forEach((cb) => {
    cb.addEventListener('change', (e) => {
      const target = e.currentTarget as HTMLInputElement;
      const idx = parseInt(target.dataset.idx || '0', 10);
      if (models[idx]) {
        models[idx].enabled = target.checked;
        updateGaModelsCounter();
      }
    });
  });

  dom.modelsList.querySelectorAll<HTMLButtonElement>('.ga-remove-model-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const idx = parseInt(btn.dataset.idx || '0', 10);
      if (models[idx]) {
        models.splice(idx, 1);
        renderGaFormModelsList();
      }
    });
  });
}

function openGoogleAccountModal(existingId?: string, presetType?: 'google-gemini' | 'gemini-cli' | 'antigravity'): void {
  const dom = getGaModalDom();
  if (!dom.backdrop || !dom.formName || !dom.formUrl || !dom.formKey) return;
  lastFocusedGaElement = document.activeElement as HTMLElement | null;
  (window as any).editingGoogleAccountId = null;
  (window as any).currentGaFetchedModels = [];
  if (dom.formError) {
    dom.formError.hidden = true;
    dom.formError.textContent = '';
  }

  const cache = (window as any).googleAccountsCache || [];

  if (existingId) {
    const account = cache.find((x: any) => x.id === existingId);
    if (account) {
      (window as any).editingGoogleAccountId = account.id;
      const isIde = account.id.startsWith('google-ide-') || (account.apiKey && account.apiKey.startsWith('ya29.')) || account.source === 'antigravity-ide';
      const isGeminiCli = account.provider === 'gemini-cli' || account.id.startsWith('gemini-cli-');
      if (dom.title) dom.title.textContent = `Edit Google Account: ${account.name}`;
      dom.formName.value = account.name;
      dom.formUrl.value = account.apiUrl || (isGeminiCli ? 'https://cloudcode-pa.googleapis.com/v1internal' : 'https://generativelanguage.googleapis.com/v1beta');
      dom.formKey.value = account.apiKey || '';

      if (dom.accountTypeBanner) {
        dom.accountTypeBanner.hidden = !isIde && !isGeminiCli;
      }
      if (dom.keyLabel) {
        dom.keyLabel.textContent = (isIde || isGeminiCli) ? `${isGeminiCli ? 'Antigravity CLI' : 'Antigravity IDE'} Token / Clé API` : 'Google AI Studio API Key';
      }
      if (dom.keyHelper) {
        dom.keyHelper.innerHTML = (isIde || isGeminiCli)
          ? `Compte authentifié via session ${isGeminiCli ? 'Antigravity CLI' : 'IDE'} (OAuth ya29…). Vous pouvez conserver ce jeton ou entrer une clé <a href="https://aistudio.google.com/apikey" target="_blank" style="color: var(--accent-blue-bright); text-decoration: underline;">Google AI Studio</a> (AIzaSy…).`
          : 'Obtain a free key from <a href="https://aistudio.google.com/apikey" target="_blank" style="color: var(--accent-blue-bright); text-decoration: underline;">Google AI Studio</a>. No credit card required.';
      }
      if (dom.formKey) {
        dom.formKey.placeholder = (isIde || isGeminiCli) ? 'Géré automatiquement (OAuth ya29…) — ou entrez une clé AIzaSy…' : 'AIzaSy…';
      }

      (window as any).currentGaFetchedModels = typeof (window as any).getUnifiedGoogleModelsList === 'function'
        ? (window as any).getUnifiedGoogleModelsList()
        : [];
    }
  } else {
    const isAiStudio = presetType === 'google-gemini';
    if (dom.title) dom.title.textContent = isAiStudio ? 'Ajouter une Clé API Google AI Studio' : 'Add Google Account';
    if (dom.accountTypeBanner) dom.accountTypeBanner.hidden = true;
    if (dom.keyLabel) dom.keyLabel.textContent = 'Google AI Studio API Key';
    if (dom.keyHelper) {
      dom.keyHelper.innerHTML = 'Obtain a free key from <a href="https://aistudio.google.com/apikey" target="_blank" style="color: var(--accent-blue-bright); text-decoration: underline;">Google AI Studio</a>. No credit card required.';
    }
    if (dom.formKey) dom.formKey.placeholder = 'AIzaSy…';
    dom.formName.value = isAiStudio ? 'Google AI Studio' : '';
    dom.formUrl.value = 'https://generativelanguage.googleapis.com/v1beta';
    dom.formKey.value = '';
    (window as any).currentGaFetchedModels = typeof (window as any).getUnifiedGoogleModelsList === 'function'
      ? (window as any).getUnifiedGoogleModelsList()
      : [];
  }

  renderGaFormModelsList();
  dom.backdrop.hidden = false;
  if (presetType === 'google-gemini') {
    dom.formKey.focus();
  } else {
    dom.formName.focus();
  }
}

function closeGoogleAccountModal(): void {
  const dom = getGaModalDom();
  if (dom.backdrop) dom.backdrop.hidden = true;
  if (dom.accountTypeBanner) dom.accountTypeBanner.hidden = true;
  (window as any).editingGoogleAccountId = null;
  (window as any).currentGaFetchedModels = [];
  lastFocusedGaElement?.focus();
}

function initGoogleAccountModal(): void {
  const dom = getGaModalDom();
  if (dom.modalClose && !dom.modalClose.dataset.bound) {
    dom.modalClose.dataset.bound = '1';
    dom.modalClose.addEventListener('click', closeGoogleAccountModal);
  }
  if (dom.cancelBtn && !dom.cancelBtn.dataset.bound) {
    dom.cancelBtn.dataset.bound = '1';
    dom.cancelBtn.addEventListener('click', closeGoogleAccountModal);
  }
  if (dom.backdrop && !dom.backdrop.dataset.bound) {
    dom.backdrop.dataset.bound = '1';
    dom.backdrop.addEventListener('click', (e) => {
      if (e.target === dom.backdrop) closeGoogleAccountModal();
    });
  }
  if (dom.addAccountBtn && !dom.addAccountBtn.dataset.bound) {
    dom.addAccountBtn.dataset.bound = '1';
    dom.addAccountBtn.addEventListener('click', () => openGoogleAccountModal());
  }

  document.addEventListener('keydown', (e) => {
    if (!dom.backdrop || dom.backdrop.hidden) return;
    if (e.key === 'Escape') {
      closeGoogleAccountModal();
      return;
    }
    if (e.key === 'Tab') {
      const focusable = Array.from(
        dom.backdrop.querySelectorAll<HTMLElement>(
          'button:not([disabled]):not([hidden]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });
}

if (typeof window !== 'undefined') {
  (window as any).openGoogleAccountModal = openGoogleAccountModal;
  (window as any).closeGoogleAccountModal = closeGoogleAccountModal;
  (window as any).renderGaFormModelsList = renderGaFormModelsList;
  (window as any).updateGaModelsCounter = updateGaModelsCounter;
  (window as any).initGoogleAccountModal = initGoogleAccountModal;
}
