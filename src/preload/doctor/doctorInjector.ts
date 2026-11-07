/**
 * Doctor UI — Main Entry point coordinating:
 * 1. Module 1: Custom Provider Manager (provider-manager.ts)
 * 2. Module 2: Custom Model Fetcher (model-fetcher.ts)
 */
import { storageAPI } from '../api';
import { preloadLog } from '../logger';
import { openProviderManagerModal, getFocusableElements } from '../providers/providerModal';
import type { ProviderFileEntry } from '../types';
import {
  renderCustomModelsList,
  fetchModelsFromProvider,
  testModelHealth,
  getProviderColor,
  prefersReducedMotion,
} from '../model-fetcher';
import { ensureAgyTokens } from './doctorStyles';

export {
  openProviderManagerModal,
  getFocusableElements,
  renderCustomModelsList,
  fetchModelsFromProvider,
  testModelHealth,
  getProviderColor,
  prefersReducedMotion,
};

// ─── Direct Access Surface & Globals ─────────────────────────────────
export const doctorUiAPI = {
  openModal: (existingProvider?: ProviderFileEntry) => openProviderManagerModal(existingProvider),
  openProvider: async (providerIdOrName: string) => {
    const providers = await storageAPI.getProviders();
    const p = providers.find(
      (x) => x.id === providerIdOrName || x.name === providerIdOrName || x.provider === providerIdOrName,
    );
    openProviderManagerModal(p);
  },
  closeModal: () => {
    const overlay = document.getElementById('agy-modal-overlay');
    if (overlay) overlay.remove();
  },
  refreshModels: () => renderCustomModelsList(),
  sync: async () => {
    await renderCustomModelsList();
    const refreshBtn = findRefreshButton();
    if (refreshBtn) refreshBtn.click();
  },
};

(window as any).antigravityDoctorUI = doctorUiAPI;
(window as any).openProviderManagerModal = openProviderManagerModal;
(window as any).renderCustomModelsList = renderCustomModelsList;

interface McpLayout {
  mainContainer: Node;
  headerRow: Element;
  contentBlock: Element | null;
}

function findRefreshButton(): HTMLButtonElement | null {
  const buttons = Array.from(document.querySelectorAll('button'));
  return (
    (buttons.find((b) => {
      const text = b.textContent?.trim() || '';
      return text.includes('Refresh') || text.includes('Open MCP Config');
    }) as HTMLButtonElement) || null
  );
}

function findMcpSectionContainer(): Node | null {
  // Strategy 1: Look for "Open MCP Config", "Add MCP", or "Refresh" buttons
  const buttons = Array.from(document.querySelectorAll('button'));
  const mcpBtn = buttons.find((b) => {
    const text = b.textContent?.trim() || '';
    return text.includes('Open MCP Config') || text.includes('Add MCP') || text.includes('Refresh');
  });

  if (mcpBtn && mcpBtn.parentNode) {
    let curr: Node | null = mcpBtn;
    while (curr && curr.parentNode && curr.parentNode !== document.body) {
      const parent = curr.parentNode as HTMLElement;
      if (parent && parent.children && parent.children.length >= 2) {
        // Return section container
        if (parent.tagName === 'SECTION' || parent.classList?.length > 0 || parent.children.length >= 3) {
          return parent;
        }
      }
      curr = curr.parentNode;
    }
  }

  // Strategy 2: Look for heading containing "Installed MCP Servers" or "Build With Google Plugins"
  const elements = Array.from(document.querySelectorAll('div, h2, h3, span, p'));
  const mcpHeader = elements.find((el) => {
    const txt = el.textContent?.trim() || '';
    return txt.includes('Installed MCP Servers') || txt.includes('Build With Google Plugins');
  });

  if (mcpHeader && mcpHeader.parentNode) {
    let curr: Node | null = mcpHeader.parentNode;
    while (curr && curr.parentNode && curr.parentNode !== document.body) {
      const parent = curr.parentNode as HTMLElement;
      if (parent && parent.children && parent.children.length >= 2) {
        return parent;
      }
      curr = curr.parentNode;
    }
    return mcpHeader.parentNode;
  }

  return null;
}

export async function injectCustomModelsSection(): Promise<void> {
  const mainContainer = findMcpSectionContainer();
  if (!mainContainer) return;

  if (document.getElementById('agy-custom-models-section')) return;

  ensureAgyTokens();

  const section = document.createElement('div');
  section.id = 'agy-custom-models-section';
  section.className = 'agy-view';
  section.style.marginTop = '0px';

  const viewHeader = document.createElement('div');
  viewHeader.className = 'agy-view-header';

  const viewTitleGroup = document.createElement('div');
  viewTitleGroup.innerHTML = `
    <h1 class="agy-view-title">Custom models</h1>
    <p class="agy-view-subtitle">Configured providers and their status</p>
  `;

  const viewActions = document.createElement('div');
  viewActions.className = 'agy-header-actions';

  const testAllBtn = document.createElement('button');
  testAllBtn.className = 'agy-btn-ghost';
  testAllBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg> Test all`;
  testAllBtn.addEventListener('click', async () => {
    const testBtns = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '#agy-custom-models-content .agy-row-actions .agy-btn-ghost[title="Test connection"]',
      ),
    );
    testAllBtn.disabled = true;
    for (const btn of testBtns) {
      btn.click();
      await new Promise((r) => setTimeout(r, 150));
    }
    testAllBtn.disabled = false;
  });

  const addModelBtn = document.createElement('button');
  addModelBtn.className = 'agy-btn-primary';
  addModelBtn.innerHTML = `☁️ Provider Manager`;
  addModelBtn.addEventListener('click', () => openProviderManagerModal());

  viewActions.appendChild(testAllBtn);
  viewActions.appendChild(addModelBtn);
  viewHeader.appendChild(viewTitleGroup);
  viewHeader.appendChild(viewActions);

  const panel = document.createElement('div');
  panel.className = 'agy-panel';
  const panelBody = document.createElement('div');
  panelBody.className = 'agy-panel-body';
  panelBody.id = 'agy-custom-models-content';

  panel.appendChild(panelBody);
  section.appendChild(viewHeader);
  section.appendChild(panel);

  mainContainer.appendChild(section);

  await renderCustomModelsList();
}

/**
 * MutationObserver to auto-inject the Custom Models section when Settings → Customizations is open.
 */

let _injectionObserver: MutationObserver | null = null;
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;

export function setupDoctorUiInjection(): void {
  if (_injectionObserver) return;

  const tryInject = (): void => {
    if (_debounceTimer) clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(() => {
      if (!document.getElementById('agy-custom-models-section')) {
        void injectCustomModelsSection();
      }
    }, 200);
  };

  tryInject();

  // Live Real-Time Storage Listener for Modal & UI Synchronization
  storageAPI.onChanged((changes) => {
    preloadLog.debug('Storage change detected — syncing Custom Models UI & modals in real time.', changes);
    void renderCustomModelsList();
    const refreshBtn = findRefreshButton();
    if (refreshBtn) refreshBtn.click();
  });

  _injectionObserver = new MutationObserver(() => {
    if (!document.getElementById('agy-custom-models-section')) {
      tryInject();
    }
  });

  const startObserving = () => {
    if (document.body && _injectionObserver) {
      _injectionObserver.observe(document.body, {
        childList: true,
        subtree: true,
      });
    }
  };

  if (document.body) {
    startObserving();
  } else {
    document.addEventListener('DOMContentLoaded', startObserving, { once: true });
  }
}
