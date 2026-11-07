/**
 * Provider Manager Modal Shell & Controller
 */
import type { ProviderFileEntry } from '../types';
import { renderProviderListView, loadProvidersList } from './providerList';
import { renderProviderFormView } from './providerForm';

export interface ProviderModalContext {
  modal: HTMLElement;
  overlay: HTMLElement;
  headerActions: HTMLElement;
  titleIcon: HTMLElement;
  titleText: HTMLElement;
  listContainer: HTMLElement;
  formContainer: HTMLFormElement;
  footer: HTMLElement;
  closeModal: () => void;
  showListView: () => void;
  showFormView: (existing?: ProviderFileEntry) => void;
  loadProvidersList: () => Promise<void>;
}

export function getFocusableElements(root: HTMLElement): HTMLElement[] {
  const selector = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');
  return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(
    (el) => !el.hasAttribute('inert') && el.offsetParent !== null,
  );
}

/**
 * Open the Provider Manager Modal.
 */
export function openProviderManagerModal(existingProvider?: ProviderFileEntry): void {
  const existing = document.getElementById('agy-modal-overlay');
  if (existing) existing.remove();

  const triggerElement = document.activeElement as HTMLElement | null;

  const overlay = document.createElement('div');
  overlay.id = 'agy-modal-overlay';
  overlay.className = 'agy-overlay';

  const modal = document.createElement('div');
  modal.className = 'agy-modal agy-modal-lg';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'agy-modal-title');

  // ─── Modal Header ──────────────────────────────────────────────────
  const header = document.createElement('div');
  header.className = 'agy-modal-header';

  const titleWrap = document.createElement('div');
  titleWrap.className = 'agy-modal-header-title-wrap';
  const titleIcon = document.createElement('div');
  titleIcon.className = 'agy-modal-header-icon';
  titleIcon.textContent = '☁️';
  const titleText = document.createElement('h2');
  titleText.id = 'agy-modal-title';
  titleText.textContent = 'Provider Manager';
  titleWrap.appendChild(titleIcon);
  titleWrap.appendChild(titleText);

  const headerActions = document.createElement('div');
  headerActions.style.display = 'flex';
  headerActions.style.alignItems = 'center';
  headerActions.style.gap = '8px';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'agy-icon-btn modal-close';
  closeBtn.setAttribute('aria-label', 'Close Provider Manager');
  closeBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

  header.appendChild(titleWrap);
  header.appendChild(headerActions);
  header.appendChild(closeBtn);
  modal.appendChild(header);

  // ─── Modal Body ────────────────────────────────────────────────────
  const body = document.createElement('div');
  body.className = 'agy-modal-body';

  const listContainer = document.createElement('div');
  listContainer.className = 'agy-modal-list';
  listContainer.style.display = 'flex';

  const formContainer = document.createElement('form');
  formContainer.id = 'agy-addModelForm';
  formContainer.className = 'agy-modal-form';
  formContainer.style.display = 'none';

  body.appendChild(listContainer);
  body.appendChild(formContainer);
  modal.appendChild(body);

  // ─── Modal Footer ──────────────────────────────────────────────────
  const footer = document.createElement('div');
  footer.className = 'agy-modal-footer';
  modal.appendChild(footer);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const closeModal = (): void => {
    overlay.remove();
    document.removeEventListener('keydown', keyHandler);
    if (triggerElement && typeof triggerElement.focus === 'function') {
      try {
        triggerElement.focus();
      } catch {
        // Ignored
      }
    }
  };

  closeBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay) closeModal();
  });

  const keyHandler = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      closeModal();
      return;
    }
    if (ev.key === 'Tab') {
      const focusable = getFocusableElements(modal);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (ev.shiftKey && document.activeElement === first) {
        ev.preventDefault();
        last.focus();
      } else if (!ev.shiftKey && document.activeElement === last) {
        ev.preventDefault();
        first.focus();
      }
    }
  };
  document.addEventListener('keydown', keyHandler);

  const ctx: ProviderModalContext = {
    modal,
    overlay,
    headerActions,
    titleIcon,
    titleText,
    listContainer,
    formContainer,
    footer,
    closeModal,
    showListView: () => renderProviderListView(ctx),
    showFormView: (existing?: ProviderFileEntry) => renderProviderFormView(ctx, existing),
    loadProvidersList: () => loadProvidersList(ctx),
  };

  // Initial View Determination
  if (existingProvider) {
    ctx.showFormView(existingProvider);
  } else {
    ctx.showListView();
  }
}
