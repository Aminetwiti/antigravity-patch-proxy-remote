/**
 * ag-doctor-ui Log Inspector Drawer
 * Slide-over drawer for deep-inspecting log lines, payloads, and remediation actions
 */

import { ParsedLogEntry, escapeHtml, explainError } from './log-viewer';

export interface RemediationAction {
  label: string;
  actionId: string;
  hint: string;
  icon?: string;
}

export function detectRemediation(entry: ParsedLogEntry): RemediationAction | null {
  const text = (entry.message || entry.raw).toLowerCase();

  // 1. Quota & cooldown exhaustion (429 / RESOURCE_EXHAUSTED)
  if (text.includes('429') || text.includes('resourceexhausted') || text.includes('quota') || text.includes('cooldown to prevent stalling')) {
    return {
      label: 'Inspect Quota & Cooldowns',
      actionId: 'nav-google-accounts',
      hint: 'Multiple requests hit upstream rate limits or quota. Check active Google accounts and cooldown timers.',
      icon: 'key',
    };
  }

  // 2. Local Proxy down / Port 51074 unreachable
  if (text.includes('connection refused') && text.includes('51074')) {
    return {
      label: 'Restart Proxy Engine',
      actionId: 'proxy-restart',
      hint: 'Antigravity language server cannot reach the local proxy on port 51074.',
      icon: 'refresh',
    };
  }

  // 3. Binary patching needed
  if (text.includes('daily-cloudcode-pa.googleapis.com') || text.includes('failed to patch') || text.includes('signature mismatch')) {
    return {
      label: 'Repatch Language Server',
      actionId: 'nav-patch',
      hint: 'Binary patch is missing or reverted after an official update.',
      icon: 'tool',
    };
  }

  // 4. Integrated explainError mappings (400, 504, AUTH)
  const explanation = explainError(entry);
  if (explanation) {
    if (explanation.code === 400) {
      return {
        label: 'Inspect Request Payload',
        actionId: 'inspect-payload',
        hint: explanation.explanation,
        icon: 'alert',
      };
    }
    if (explanation.code === 504) {
      return {
        label: 'Check Network Host & Failover',
        actionId: 'view-network',
        hint: explanation.explanation,
        icon: 'globe',
      };
    }
    if (explanation.code === 'AUTH') {
      return {
        label: 'Re-authenticate Google Account',
        actionId: 'nav-google-accounts',
        hint: explanation.explanation,
        icon: 'key',
      };
    }
  }

  return null;
}

export class LogInspectorDrawer {
  private container: HTMLElement;
  private currentEntry: ParsedLogEntry | null = null;
  private onActionCallback?: (actionId: string) => void;
  private onNavigateCallback?: (direction: 'prev' | 'next') => void;

  constructor(
    container: HTMLElement,
    onAction?: (actionId: string) => void,
    onNavigate?: (direction: 'prev' | 'next') => void
  ) {
    this.container = container;
    this.onActionCallback = onAction;
    this.onNavigateCallback = onNavigate;
    this.container.classList.add('log-inspector-drawer');
    this.container.classList.add('logs-inspector-drawer');
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (!this.isOpen()) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
      return;
    }

    if (this.onNavigateCallback) {
      if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        this.onNavigateCallback('prev');
      } else if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        this.onNavigateCallback('next');
      }
    }
  };

  public open(entry: ParsedLogEntry): void {
    this.currentEntry = entry;
    this.render();
    this.container.classList.add('open');
    if (typeof document !== 'undefined') {
      document.addEventListener('keydown', this.handleKeyDown);
    }
  }

  public close(): void {
    this.container.classList.remove('open');
    this.currentEntry = null;
    if (typeof document !== 'undefined') {
      document.removeEventListener('keydown', this.handleKeyDown);
    }
  }

  public isOpen(): boolean {
    return this.container.classList.contains('open');
  }

  private render(): void {
    if (!this.currentEntry) {
      this.container.innerHTML = '';
      return;
    }

    const entry = this.currentEntry;
    const remediation = detectRemediation(entry);

    let payloadHtml = '';
    if (entry.hasPayload && entry.jsonPayload) {
      const prettyJson = JSON.stringify(entry.jsonPayload, null, 2);
      payloadHtml = `
        <div class="inspector-section">
          <div class="inspector-section-title">Detected Payload (JSON)</div>
          <pre class="inspector-code">${escapeHtml(prettyJson)}</pre>
          <button type="button" class="btn btn-ghost btn-sm" id="inspectorCopyJsonBtn">Copy JSON</button>
        </div>
      `;
    }

    let remediationHtml = '';
    if (remediation) {
      remediationHtml = `
        <div class="inspector-remediation">
          <div class="remediation-header">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <strong>Recommended Action</strong>
          </div>
          <p class="remediation-hint">${escapeHtml(remediation.hint)}</p>
          <button type="button" class="btn btn-primary btn-sm" data-action="${escapeHtml(remediation.actionId)}" id="inspectorRemediateBtn">
            ${escapeHtml(remediation.label)}
          </button>
        </div>
      `;
    }

    const navButtonsHtml = this.onNavigateCallback ? `
      <div class="inspector-nav-group">
        <button type="button" class="btn btn-ghost btn-xs btn-icon" id="inspectorPrevBtn" title="Previous log line (↑)" aria-label="Previous log line">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="18 15 12 9 6 15"/></svg>
        </button>
        <button type="button" class="btn btn-ghost btn-xs btn-icon" id="inspectorNextBtn" title="Next log line (↓)" aria-label="Next log line">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
      </div>
    ` : '';

    this.container.innerHTML = `
      <div class="inspector-header">
        <div class="inspector-title">
          <span class="log-tag log-tag-${escapeHtml(entry.subsystem || entry.level)}">${escapeHtml((entry.subsystem || entry.level).toUpperCase())}</span>
          <span>Log Inspector</span>
        </div>
        <div class="inspector-header-actions">
          ${navButtonsHtml}
          <button type="button" class="inspector-close btn btn-ghost btn-sm btn-icon" id="inspectorCloseBtn" title="Close (Esc)" aria-label="Close log inspector">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      </div>

      <div class="inspector-body">
        <div class="inspector-meta-grid">
          <div><span class="meta-label">Time:</span> <span class="meta-value">${escapeHtml(entry.time || '—')}</span></div>
          <div><span class="meta-label">Level:</span> <span class="meta-value">${escapeHtml(entry.level)}</span></div>
          ${entry.location ? `<div><span class="meta-label">Location:</span> <span class="meta-value">${escapeHtml(entry.location)}</span></div>` : ''}
          ${entry.traceId ? `<div><span class="meta-label">Trace ID:</span> <span class="meta-value highlight-trace">${escapeHtml(entry.traceId)}</span></div>` : ''}
          ${entry.repeatCount && entry.repeatCount > 1 ? `<div><span class="meta-label">Repeats:</span> <span class="meta-value">×${entry.repeatCount}</span></div>` : ''}
        </div>

        ${remediationHtml}

        <div class="inspector-section">
          <div class="inspector-section-title">Message</div>
          <div class="inspector-raw-message">${escapeHtml(entry.message)}</div>
        </div>

        ${payloadHtml}

        <div class="inspector-actions">
          <button type="button" class="btn btn-ghost btn-sm" id="inspectorCopyRawBtn">Copy Raw</button>
          <button type="button" class="btn btn-secondary btn-sm" id="inspectorFooterCloseBtn" title="Fermer l'inspecteur (Esc)">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
            Fermer
          </button>
        </div>
      </div>
    `;

    // Event listeners
    const closeBtn = this.container.querySelector('#inspectorCloseBtn');
    closeBtn?.addEventListener('click', () => this.close());

    const footerCloseBtn = this.container.querySelector('#inspectorFooterCloseBtn');
    footerCloseBtn?.addEventListener('click', () => this.close());

    if (this.onNavigateCallback) {
      const prevBtn = this.container.querySelector('#inspectorPrevBtn');
      prevBtn?.addEventListener('click', () => this.onNavigateCallback?.('prev'));

      const nextBtn = this.container.querySelector('#inspectorNextBtn');
      nextBtn?.addEventListener('click', () => this.onNavigateCallback?.('next'));
    }

    const copyRawBtn = this.container.querySelector('#inspectorCopyRawBtn');
    copyRawBtn?.addEventListener('click', () => {
      void navigator.clipboard.writeText(entry.raw);
      if (copyRawBtn instanceof HTMLElement) {
        copyRawBtn.textContent = 'Copied!';
        setTimeout(() => { copyRawBtn.textContent = 'Copy Raw'; }, 1500);
      }
    });

    const copyJsonBtn = this.container.querySelector('#inspectorCopyJsonBtn');
    if (copyJsonBtn && entry.jsonPayload) {
      copyJsonBtn.addEventListener('click', () => {
        void navigator.clipboard.writeText(JSON.stringify(entry.jsonPayload, null, 2));
        if (copyJsonBtn instanceof HTMLElement) {
          copyJsonBtn.textContent = 'Copied!';
          setTimeout(() => { copyJsonBtn.textContent = 'Copy JSON'; }, 1500);
        }
      });
    }

    const remediateBtn = this.container.querySelector('#inspectorRemediateBtn');
    if (remediateBtn && remediation) {
      remediateBtn.addEventListener('click', () => {
        if (this.onActionCallback) {
          this.onActionCallback(remediation.actionId);
        }
      });
    }
  }
}

