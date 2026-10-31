/**
 * Antigravity Custom Quota & Error Feedback Card Component
 * Replicates the exact native Antigravity IDE Quota Error Banner UI card:
 * - Header row with icon and bold title ("Baseline model quota reached" / "Custom model error")
 * - Subtitle description with reset countdown or error details
 * - Right-aligned action buttons: [Dismiss] [See Plans / Edit Key] [Enable Overages / Switch Model]
 */

export interface QuotaCardOptions {
  title?: string;
  message?: string;
  resetDateStr?: string;
  primaryLabel?: string;
  secondaryLabel?: string;
  dismissLabel?: string;
  onPrimaryAction?: () => void;
  onSecondaryAction?: () => void;
  onDismiss?: () => void;
}

export class NativeQuotaCardRenderer {
  private cardElement: HTMLDivElement | null = null;

  public render(options: QuotaCardOptions = {}): HTMLDivElement {
    const title = options.title || 'Baseline model quota reached';
    const resetStr = options.resetDateStr || new Date().toLocaleString();
    const defaultMsg = `Your plan's baseline quota will refresh on ${resetStr}. To continue using this model now, switch to a custom model or enable overages.`;
    const message = options.message || defaultMsg;

    const primaryLabel = options.primaryLabel || 'Switch Model';
    const secondaryLabel = options.secondaryLabel || 'See Plans';
    const dismissLabel = options.dismissLabel || 'Dismiss';

    const card = document.createElement('div');
    card.className = 'agy-native-quota-card';
    card.setAttribute('role', 'alert');

    card.innerHTML = `
      <style>
        .agy-native-quota-card {
          background: rgba(25, 26, 30, 0.95);
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 8px;
          padding: 14px 16px;
          margin: 8px 0 12px 0;
          font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          color: #e0e0e0;
          box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
          display: flex;
          flex-direction: column;
          gap: 8px;
          transition: all 0.2s ease-in-out;
        }
        .agy-quota-header {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .agy-quota-icon {
          color: #9da5b4;
          flex-shrink: 0;
        }
        .agy-quota-title {
          font-size: 13.5px;
          font-weight: 600;
          color: #ffffff;
          letter-spacing: -0.01em;
        }
        .agy-quota-body {
          font-size: 12.5px;
          color: #abb2bf;
          line-height: 1.5;
        }
        .agy-quota-actions {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          margin-top: 4px;
        }
        .agy-btn {
          border: none;
          border-radius: 6px;
          padding: 6px 14px;
          font-size: 12.5px;
          font-weight: 500;
          cursor: pointer;
          transition: background 0.15s ease, transform 0.1s ease;
        }
        .agy-btn:active {
          transform: scale(0.97);
        }
        .agy-btn-dismiss, .agy-btn-secondary {
          background: rgba(255, 255, 255, 0.1);
          color: #e0e0e0;
        }
        .agy-btn-dismiss:hover, .agy-btn-secondary:hover {
          background: rgba(255, 255, 255, 0.18);
          color: #ffffff;
        }
        .agy-btn-primary {
          background: #007acc;
          color: #ffffff;
          font-weight: 600;
        }
        .agy-btn-primary:hover {
          background: #0088e0;
        }
      </style>
      <div class="agy-quota-header">
        <svg class="agy-quota-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
          <line x1="9" y1="9" x2="15" y2="15"/>
          <line x1="15" y1="9" x2="9" y2="15"/>
        </svg>
        <span class="agy-quota-title">${this.escape(title)}</span>
      </div>
      <div class="agy-quota-body">${this.escape(message)}</div>
      <div class="agy-quota-actions">
        <button class="agy-btn agy-btn-dismiss" id="agyQuotaDismissBtn" type="button">${this.escape(dismissLabel)}</button>
        ${secondaryLabel ? `<button class="agy-btn agy-btn-secondary" id="agyQuotaSecBtn" type="button">${this.escape(secondaryLabel)}</button>` : ''}
        <button class="agy-btn agy-btn-primary" id="agyQuotaPrimBtn" type="button">${this.escape(primaryLabel)}</button>
      </div>
    `;

    // Wire action handlers
    const dismissBtn = card.querySelector('#agyQuotaDismissBtn');
    dismissBtn?.addEventListener('click', () => {
      if (options.onDismiss) options.onDismiss();
      this.destroy();
    });

    const secBtn = card.querySelector('#agyQuotaSecBtn');
    secBtn?.addEventListener('click', () => {
      if (options.onSecondaryAction) options.onSecondaryAction();
    });

    const primBtn = card.querySelector('#agyQuotaPrimBtn');
    primBtn?.addEventListener('click', () => {
      if (options.onPrimaryAction) options.onPrimaryAction();
    });

    this.cardElement = card;
    return card;
  }

  public injectIntoChatContainer(targetSelector = '.chat-input-container, [class*="chatInput"], body'): boolean {
    const target = document.querySelector(targetSelector);
    if (!target) return false;

    this.destroy(); // Remove any existing banner first
    const el = this.render();
    target.prepend(el);
    return true;
  }

  public destroy(): void {
    if (this.cardElement) {
      this.cardElement.remove();
      this.cardElement = null;
    }
  }

  private escape(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}

if (typeof exports !== 'undefined') {
  Object.assign(exports, { NativeQuotaCardRenderer });
}
