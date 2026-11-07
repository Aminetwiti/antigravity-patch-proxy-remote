/**
 * Provider Manager Form View Component
 */
import { storageAPI } from '../api';
import { fetchModelsFromProvider, renderFetchedModelsList, renderCustomModelsList } from '../model-fetcher';
import type { ProviderFileEntry, ProviderModelEntry } from '../types';
import { PROVIDER_PRESETS } from '../types';
import type { ProviderModalContext } from './providerModal';

export function renderProviderFormView(ctx: ProviderModalContext, existingP?: ProviderFileEntry): void {
  ctx.listContainer.style.display = 'none';
  ctx.formContainer.style.display = 'flex';
  ctx.titleIcon.textContent = existingP ? '✎' : '+';
  ctx.titleText.textContent = existingP ? 'Edit Provider' : 'Add Custom Provider';

  ctx.headerActions.replaceChildren();
  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'agy-btn-ghost';
  backBtn.innerHTML = `← Back to Providers`;
  backBtn.addEventListener('click', () => ctx.showListView());
  ctx.headerActions.appendChild(backBtn);

  ctx.formContainer.replaceChildren();

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

  ctx.formContainer.appendChild(providerWrap);
  ctx.formContainer.appendChild(nameInp.wrapper);
  ctx.formContainer.appendChild(urlInp.wrapper);
  ctx.formContainer.appendChild(keyWrap);
  ctx.formContainer.appendChild(tlsWrap);

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
  ctx.formContainer.appendChild(formStatus);

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
  ctx.formContainer.appendChild(step2);

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

  ctx.footer.replaceChildren();

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'agy-btn-ghost';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => ctx.showListView());

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
        ctx.showListView();
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

  ctx.footer.appendChild(cancelBtn);
  ctx.footer.appendChild(saveBtn);

  requestAnimationFrame(() => {
    nameInp.input.focus();
    if (existingP) nameInp.input.select();
  });
}
