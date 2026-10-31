/**
 * Module 2: Custom Model Fetcher
 *
 * Responsibilities:
 * - Fetching & discovery of models from custom provider endpoints (`/v1/models`).
 * - Normalization & selection of models per provider.
 * - Rendering active custom models list in settings surface.
 * - Testing connection & latency for individual models.
 */

import { storageAPI } from './api';
import { preloadLog } from './logger';
import type { ProviderFileEntry, ProviderModelEntry, FetchModelsParams, FetchModelsResult, ConnectionTestResult } from './types';

export function getProviderColor(provider: string): string {
  const colors: Record<string, string> = {
    openai: '#10a37f',
    anthropic: '#d97706',
    google: '#4285f4',
    ollama: '#000000',
    deepseek: '#0d9488',
    openrouter: '#6366f1',
    custom: '#8b5cf6',
  };
  return colors[provider.toLowerCase()] || '#8b5cf6';
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Fetch available models from a provider's API endpoint.
 */
export async function fetchModelsFromProvider(params: FetchModelsParams): Promise<FetchModelsResult> {
  preloadLog.debug(`Fetching models for provider ${params.provider} from ${params.apiUrl}`);
  return await storageAPI.fetchModels(params);
}

/**
 * Test connection & latency for a single custom model.
 */
export async function testModelHealth(model: {
  apiUrl: string;
  provider: string;
  apiKey: string;
  allowUnauthorized?: boolean;
}): Promise<ConnectionTestResult> {
  return await storageAPI.testModelConnection(model);
}

/**
 * Renders the fetched models checkboxes inside the provider configuration form.
 */
export function renderFetchedModelsList(
  container: HTMLElement,
  models: ProviderModelEntry[],
  onToggle: (modelId: string, enabled: boolean) => void,
): void {
  container.replaceChildren();

  if (!models || models.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'agy-fetched-models-empty';
    empty.textContent = 'Fetch models to see available options.';
    container.appendChild(empty);
    return;
  }

  models.forEach((m: ProviderModelEntry) => {
    const row = document.createElement('label');
    row.className = 'agy-fetched-model-row';

    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.className = 'agy-form-checkbox';
    chk.checked = m.enabled !== false;
    chk.addEventListener('change', (e) => {
      onToggle(m.id, (e.target as HTMLInputElement).checked);
    });

    const lbl = document.createElement('span');
    lbl.textContent = m.displayName || m.id;
    row.appendChild(chk);
    row.appendChild(lbl);
    container.appendChild(row);
  });
}

/**
 * Renders the active Custom Models list in the main Settings → Customizations panel.
 */
export async function renderCustomModelsList(): Promise<void> {
  const contentArea = document.getElementById('agy-custom-models-content');
  if (!contentArea) return;

  try {
    const models = await storageAPI.getCustomModels();
    contentArea.replaceChildren();

    if (models.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'agy-empty-state';

      const icon = document.createElement('div');
      icon.innerHTML = `<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`;
      icon.style.marginBottom = '12px';
      icon.style.color = 'var(--agy-ink-secondary)';

      const title = document.createElement('div');
      title.textContent = 'No custom models active';
      title.style.fontSize = '14px';
      title.style.fontWeight = '500';
      title.style.color = 'var(--agy-ink-primary)';

      const sub = document.createElement('div');
      sub.textContent = 'Use Provider Manager to configure an AI provider and select models.';
      sub.style.fontSize = '12px';
      sub.style.color = 'var(--agy-ink-secondary)';
      sub.style.marginTop = '4px';

      empty.appendChild(icon);
      empty.appendChild(title);
      empty.appendChild(sub);
      contentArea.appendChild(empty);
    } else {
      const listContainer = document.createElement('div');
      listContainer.style.display = 'flex';
      listContainer.style.flexDirection = 'column';
      listContainer.style.gap = '8px';

      models.forEach((model) => {
        const item = document.createElement('div');
        item.className = 'agy-provider-row';

        const header = document.createElement('div');
        header.className = 'agy-row-header';

        const info = document.createElement('div');
        info.className = 'agy-row-info';

        const statusDot = document.createElement('span');
        statusDot.className = 'agy-status-dot agy-status-off';
        statusDot.title = 'Connection status unknown (test to verify)';

        const title = document.createElement('div');
        title.className = 'agy-row-name';
        title.textContent = (model.displayName as string) || (model.name as string);

        const badge = document.createElement('span');
        badge.className = 'agy-badge';
        const badgeColor = getProviderColor(model.provider as string);
        badge.style.backgroundColor = badgeColor + '22';
        badge.style.color = badgeColor;
        badge.textContent = model.provider as string;

        const url = document.createElement('div');
        url.className = 'agy-row-sub';
        url.textContent = model.apiUrl as string;

        info.appendChild(statusDot);
        info.appendChild(title);
        info.appendChild(badge);

        const actions = document.createElement('div');
        actions.className = 'agy-row-actions';

        const testBtn = document.createElement('button');
        testBtn.className = 'agy-btn-ghost';
        testBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`;
        testBtn.title = 'Test connection';
        testBtn.setAttribute('aria-label', `Test connection for ${(model.displayName as string) || (model.name as string)}`);

        testBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const originalHtml = testBtn.innerHTML;
          testBtn.style.color = '#fbbf24';
          testBtn.style.cursor = 'wait';
          testBtn.disabled = true;
          testBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${prefersReducedMotion() ? '' : 'animation: ag-spin 0.8s linear infinite;'}"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>`;

          try {
            const result = await testModelHealth({
              apiUrl: model.apiUrl as string,
              provider: model.provider as string,
              apiKey: model.apiKey as string,
              allowUnauthorized: model.allowUnauthorized as boolean | undefined,
            });

            if (result.success) {
              statusDot.className = 'agy-status-dot agy-status-on';
              statusDot.title = result.message || 'Connected';
              testBtn.title = 'Connected ✓';
              testBtn.style.color = 'var(--agy-success)';
              testBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`;
            } else {
              statusDot.className = 'agy-status-dot';
              statusDot.style.backgroundColor = 'var(--agy-danger)';
              const errMsg = result.error || 'Connection failed';
              statusDot.title = errMsg;
              testBtn.title = errMsg;
              testBtn.style.color = 'var(--agy-danger)';
              testBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
            }
          } catch (err) {
            statusDot.className = 'agy-status-dot';
            statusDot.style.backgroundColor = 'var(--agy-danger)';
            statusDot.title = 'Connection test failed';
            testBtn.title = 'Connection test failed';
            testBtn.style.color = 'var(--agy-danger)';
            testBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
          }
          setTimeout(() => {
            testBtn.disabled = false;
            testBtn.style.cursor = 'pointer';
            testBtn.style.color = '';
            testBtn.innerHTML = originalHtml;
          }, 3000);
        });

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'agy-btn-ghost';
        deleteBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>`;
        deleteBtn.setAttribute('aria-label', `Delete ${(model.displayName as string) || (model.name as string)}`);
        deleteBtn.addEventListener('click', (e) => {
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
          confirmBtn.setAttribute('aria-label', `Confirm deletion of ${(model.displayName as string) || (model.name as string)}`);
          confirmBtn.addEventListener('click', async (ev) => {
            ev.stopPropagation();
            confirmBtn.disabled = true;
            await storageAPI.deleteCustomModel(model.name as string);
            await renderCustomModelsList();
          });

          const cancelBtn = document.createElement('button');
          cancelBtn.className = 'agy-btn-ghost';
          cancelBtn.textContent = 'Cancel';
          cancelBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            actions.replaceChildren(editBtn, testBtn, deleteBtn);
          });

          actions.appendChild(confirmText);
          actions.appendChild(confirmBtn);
          actions.appendChild(cancelBtn);
        });

        const editBtn = document.createElement('button');
        editBtn.className = 'agy-btn-ghost';
        editBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
        editBtn.title = 'Edit provider settings';
        editBtn.setAttribute('aria-label', `Edit ${(model.displayName as string) || (model.name as string)}`);
        editBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const providers = await storageAPI.getProviders();
          const p = providers.find((prov) => prov.provider === model.provider || prov.name === model.provider);
          if (p) {
            const windowObj = window as any;
            if (typeof windowObj.openProviderManagerModal === 'function') {
              windowObj.openProviderManagerModal(p);
            }
          }
        });

        actions.appendChild(editBtn);
        actions.appendChild(testBtn);
        actions.appendChild(deleteBtn);
        header.appendChild(info);
        header.appendChild(actions);
        item.appendChild(header);
        item.appendChild(url);
        listContainer.appendChild(item);
      });

      contentArea.appendChild(listContainer);
    }
  } catch (err) {
    preloadLog.error('Failed to load custom models in list:', err);
  }
}
