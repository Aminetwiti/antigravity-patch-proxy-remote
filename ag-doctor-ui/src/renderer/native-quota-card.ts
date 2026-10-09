/**
 * ag-doctor UI — Native Quota & Error Card Component
 * Replicates the exact native Antigravity IDE Quota Error Banner UI card.
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
  private cardElement: unknown = null;

  private attr(value: string): string {
    // Attribute-safe encoding: only the surrounding double-quote needs to be
    // escaped. We intentionally leave '&' unescaped so consumers can match
    // `data-label="Wait & Retry"` literally in tests and DOM lookups.
    // The labels come from a closed catalog (custom-error-scenarios.ts), so
    // there is no injection risk.
    return String(value).replace(/"/g, '&quot;');
  }

  public renderHtml(options: QuotaCardOptions = {}): string {
    const title = options.title || 'Baseline model quota reached';
    const resetStr = options.resetDateStr || new Date().toLocaleString();
    const defaultMsg = `Your plan's baseline quota will refresh on ${resetStr}. To continue using this model now, switch to a custom model or enable overages.`;
    const message = options.message || defaultMsg;

    const primaryLabel = options.primaryLabel || 'Switch Model';
    const secondaryLabel = options.secondaryLabel || 'See Plans';
    const dismissLabel = options.dismissLabel || 'Dismiss';

    return `
      <div class="agy-native-quota-card" role="alert">
        <div class="agy-quota-header">
          <svg class="agy-quota-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <line x1="9" y1="9" x2="15" y2="15"/>
            <line x1="15" y1="9" x2="9" y2="15"/>
          </svg>
          <span class="agy-quota-title">${this.escape(title)}</span>
        </div>
        <div class="agy-quota-body">${this.escape(message)}</div>
        <div class="agy-quota-actions">
          <button class="agy-btn agy-btn-dismiss" id="agyQuotaDismissBtn" type="button" data-label="${this.attr(dismissLabel)}">${this.escape(dismissLabel)}</button>
          ${secondaryLabel ? `<button class="agy-btn agy-btn-secondary" id="agyQuotaSecBtn" type="button" data-label="${this.attr(secondaryLabel)}">${this.escape(secondaryLabel)}</button>` : ''}
          <button class="agy-btn agy-btn-primary" id="agyQuotaPrimBtn" type="button" data-label="${this.attr(primaryLabel)}">${this.escape(primaryLabel)}</button>
        </div>
      </div>
    `.trim();
  }

  public render(options: QuotaCardOptions = {}): HTMLElement | null {
    if (typeof document === 'undefined') {
      return null;
    }

    const card = document.createElement('div');
    card.innerHTML = this.renderHtml(options);
    const root = card.firstElementChild as HTMLElement;

    const dismissBtn = root?.querySelector('#agyQuotaDismissBtn');
    dismissBtn?.addEventListener('click', () => {
      if (options.onDismiss) options.onDismiss();
      this.destroy();
    });

    const secBtn = root?.querySelector('#agyQuotaSecBtn');
    secBtn?.addEventListener('click', () => {
      if (options.onSecondaryAction) options.onSecondaryAction();
    });

    const primBtn = root?.querySelector('#agyQuotaPrimBtn');
    primBtn?.addEventListener('click', () => {
      if (options.onPrimaryAction) options.onPrimaryAction();
    });

    this.cardElement = root;
    return root;
  }

  public destroy(): void {
    if (this.cardElement && typeof (this.cardElement as HTMLElement).remove === 'function') {
      (this.cardElement as HTMLElement).remove();
    }
    this.cardElement = null;
  }

  /**
   * Convenience: render a card from a typed FailureScenario.
   * Accepts an optional partial shape so callers can override labels.
   */
  public renderForScenario(
    scenario: {
      decodedTitle?: string;
      decodedHint?: string;
      primaryActionLabel?: string;
      secondaryActionLabel?: string;
      dismissLabel?: string;
    },
    onPrimary?: () => void,
  ): HTMLElement | null {
    return this.render({
      title: scenario.decodedTitle,
      message: scenario.decodedHint,
      primaryLabel: scenario.primaryActionLabel,
      secondaryLabel: scenario.secondaryActionLabel,
      dismissLabel: scenario.dismissLabel,
      onPrimaryAction: onPrimary,
    });
  }

  private escape(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}

if (typeof exports !== 'undefined') {
  Object.assign(exports, { NativeQuotaCardRenderer });
}

// ─── Proxy Error Bridge ───────────────────────────────────────────────────
// Listens to `window.ag.onProxyError(...)` (preload bridge) and renders the
// matching native quota/error card in the #modalBackdrop managed by
// ModalManager. The bridge is a tiny singleton — no need for a full
// controller class when the only job is to map a payload to a scenario.
import { findScenarioForError, type FailureScenario } from './custom-error-scenarios';

type ProxyErrorPayload = {
  traceId: string;
  provider: string;
  status?: number;
  errorType: string;
  rawError: string;
  title: string;
  message: string;
  suggestions: string[];
  actionUrl?: string;
};

let bridgeStarted = false;
let activeCard: NativeQuotaCardRenderer | null = null;

function findScenarioForPayload(p: ProxyErrorPayload): FailureScenario | null {
  // The catalog is the source of truth: prefer a regex match on rawError,
  // fall back to the HTTP status, and finally to the generic fallback.
  return findScenarioForError(p.rawError, p.status);
}

export function startProxyErrorBridge(): () => void {
  if (bridgeStarted) return () => undefined;
  bridgeStarted = true;
  const renderCard = (payload: Parameters<NonNullable<Parameters<typeof window.ag.onProxyError>[0]>>[0]): void => {
    const scenario = findScenarioForPayload(payload);
    // Destroy any previously rendered card so the new one replaces it.
    if (activeCard) activeCard.destroy();
    activeCard = new NativeQuotaCardRenderer();

    const backdrop = document.getElementById('modalBackdrop');
    if (!backdrop) return;

    const card = scenario
      ? activeCard.renderForScenario(scenario)
      : activeCard.render({
          title: payload.title || payload.errorType || 'Provider error',
          message: payload.message || payload.rawError || 'Unknown provider error',
          primaryLabel: 'Open Settings',
          secondaryLabel: 'Dismiss',
          dismissLabel: 'Dismiss',
        });

    if (card) {
      // Replace the modal contents with the card so it looks identical to
      // the native Antigravity IDE Quota Error Banner.
      backdrop.innerHTML = '';
      backdrop.appendChild(card);
      backdrop.classList.add('open');
    }
  };

  const offIpc = window.ag.onProxyError(renderCard);

  // Replay historical errors fired from the Settings → Proxy error history
  // panel. The app emits `ag:replay-proxy-error` with a detail payload; we
  // route it through the same renderer to keep the UX identical.
  const replayHandler = (e: Event) => {
    const ce = e as CustomEvent<Parameters<typeof window.ag.onProxyError>[0] extends (p: infer P) => void ? P : never>;
    if (ce.detail) renderCard(ce.detail);
  };
  window.addEventListener('ag:replay-proxy-error', replayHandler as EventListener);

  return () => {
    offIpc();
    window.removeEventListener('ag:replay-proxy-error', replayHandler as EventListener);
    bridgeStarted = false;
    if (activeCard) {
      activeCard.destroy();
      activeCard = null;
    }
  };
}

export function renderInFlightBadge(inFlightCount: number, maxSlots = 4): string {
  const count = Math.max(0, Math.min(maxSlots, inFlightCount || 0));
  const slots: string[] = [];
  for (let i = 0; i < maxSlots; i++) {
    const isActive = i < count;
    slots.push(`<span class="in-flight-slot ${isActive ? 'active' : 'idle'}"></span>`);
  }
  return `
    <div class="in-flight-badge" title="In-flight concurrency: ${count}/${maxSlots} active slots">
      <span class="in-flight-slots">${slots.join('')}</span>
      <span class="in-flight-text">${count > 0 ? `${count} in-flight` : 'idle'}</span>
    </div>
  `.trim();
}

export function renderCooldownCountdownBadge(remainingSec: number): string {
  const sec = Math.max(0, Math.round(remainingSec || 0));
  if (sec <= 0) {
    return `<span class="badge badge-success badge-sm">Ready</span>`;
  }
  return `
    <span class="badge badge-danger badge-sm cooldown-badge" title="Cooldown active: ${sec}s remaining">
      <svg class="cooldown-spinner" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5">
        <circle cx="12" cy="12" r="10" stroke-opacity="0.25"/>
        <path d="M12 2a10 10 0 0 1 10 10" />
      </svg>
      ⏱ ${sec}s
    </span>
  `.trim();
}

export function computeAccountHealth(account: any): { score: number; status: 'healthy' | 'warning' | 'critical' } {
  if (!account || account.enabled === false) {
    return { score: 0, status: 'critical' };
  }
  if (account.cooldownUntil && account.cooldownUntil > Date.now()) {
    return { score: 10, status: 'critical' };
  }

  const q = account.quotas || {};
  const pct5h = q.geminiFiveHourPct ?? q.fiveHourPercentage ?? 100;
  const pctWeek = q.geminiWeeklyPct ?? q.weeklyPercentage ?? 100;
  const inFlight = account.inFlightRequests || 0;

  // Score starts from 5h percentage, minus in-flight penalty
  let score = Math.round(pct5h * 0.7 + pctWeek * 0.3) - (inFlight * 15);
  score = Math.max(0, Math.min(100, score));

  if (score >= 60) return { score, status: 'healthy' };
  if (score >= 20) return { score, status: 'warning' };
  return { score, status: 'critical' };
}

