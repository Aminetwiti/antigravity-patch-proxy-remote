/**
 * ag-doctor UI — Smart Banner Manager
 * Cause-specific error banners, live rate-limit reset countdown, 1-click fallback router,
 * and Patch Verdict evaluator (P0.1).
 */

interface SystemPatchState {
  proxyListening: boolean;
  proxyResponding: boolean;
  mitmListening: boolean;
  mitmCaInstalled: boolean;
  customModelsLoaded: number;
  startProxyErrors: number;
}

interface PatchVerdict {
  label: string;
  severity: 'ok' | 'warn' | 'error';
  action?: 'patch' | 'launch-mitm' | 'repair' | 'install-ca' | 'add-model';
  message: string;
}

interface SmartBannerOptions {
  category: 'quota_429' | 'auth_401' | 'credits_402' | 'offline_econn' | 'context_400' | 'generic';
  title: string;
  hint: string;
  resetSeconds?: number;
  providerName?: string;
  onFallback?: () => void;
  onEditKey?: () => void;
  onStartStub?: () => void;
}

class SmartBannerManager {
  private containerEl: HTMLElement | null = null;
  private timerId: number | null = null;
  private remainingSeconds = 0;

  constructor(containerId = 'globalSmartBanner') {
    this.containerEl = document.getElementById(containerId);
  }

  /**
   * Computes unified patch state verdict (P0.1 recommendation).
   */
  public static computeVerdict(state: SystemPatchState): PatchVerdict {
    if (!state.proxyListening) {
      return { label: 'Proxy OFF', severity: 'error', action: 'patch', message: 'Local proxy is down. Run repair to start proxy.' };
    }
    if (!state.mitmListening) {
      return { label: 'MITM REQUIS', severity: 'error', action: 'launch-mitm', message: 'MITM proxy on port 443 is required but not listening.' };
    }
    if (state.startProxyErrors > 0) {
      return { label: 'PATCH KAPUT', severity: 'error', action: 'repair', message: 'Proxy startup errors detected in main.log.' };
    }
    if (!state.mitmCaInstalled) {
      return { label: 'CA NOT TRUSTED', severity: 'warn', action: 'install-ca', message: 'MITM root CA certificate is not installed in OS trust store.' };
    }
    if (state.customModelsLoaded === 0) {
      return { label: 'NO CUSTOM MODELS', severity: 'warn', action: 'add-model', message: 'No custom model providers configured.' };
    }
    return { label: 'PATCH OK', severity: 'ok', message: 'System is fully operational.' };
  }

  public show(options: SmartBannerOptions): void {
    if (!this.containerEl) {
      this.containerEl = document.getElementById('globalSmartBanner');
      if (!this.containerEl) return;
    }

    this.clearTimer();
    this.remainingSeconds = options.resetSeconds ?? 0;

    const banner = document.createElement('div');
    banner.className = `smart-banner ${options.category}`;
    banner.setAttribute('role', 'alert');

    const contentHtml = `
      <div class="smart-banner-icon">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
      </div>
      <div class="smart-banner-body">
        <div class="smart-banner-title">
          <span>${this.escape(options.title)}</span>
          ${this.remainingSeconds > 0 ? `<span class="smart-banner-countdown" id="sbCountdown">${this.formatCountdown(this.remainingSeconds)}</span>` : ''}
        </div>
        <div class="smart-banner-text">${this.escape(options.hint)}</div>
      </div>
      <div class="smart-banner-actions" id="sbActions"></div>
    `;

    banner.innerHTML = contentHtml;
    const actionsEl = banner.querySelector('#sbActions') as HTMLElement;

    if (options.onFallback || options.category === 'quota_429' || options.category === 'context_400') {
      const btn = document.createElement('button');
      btn.className = 'btn btn-primary btn-sm';
      btn.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg> Switch to Fallback Model`;
      btn.addEventListener('click', () => {
        if (options.onFallback) options.onFallback();
        this.dismiss();
      });
      actionsEl.appendChild(btn);
    }

    if (options.category === 'auth_401' || options.category === 'credits_402') {
      const btn = document.createElement('button');
      btn.className = 'btn btn-ghost btn-sm';
      btn.textContent = 'Edit API Key';
      btn.addEventListener('click', () => {
        if (options.onEditKey) options.onEditKey();
        this.dismiss();
      });
      actionsEl.appendChild(btn);
    }

    if (options.category === 'offline_econn') {
      const btn = document.createElement('button');
      btn.className = 'btn btn-ghost btn-sm';
      btn.textContent = 'Start Proxy Stub';
      btn.addEventListener('click', () => {
        if (options.onStartStub) options.onStartStub();
        this.dismiss();
      });
      actionsEl.appendChild(btn);
    }

    const dismissBtn = document.createElement('button');
    dismissBtn.className = 'btn btn-ghost btn-sm';
    dismissBtn.textContent = 'Dismiss';
    dismissBtn.addEventListener('click', () => this.dismiss());
    actionsEl.appendChild(dismissBtn);

    this.containerEl.innerHTML = '';
    this.containerEl.appendChild(banner);

    if (this.remainingSeconds > 0) {
      this.timerId = window.setInterval(() => {
        this.remainingSeconds--;
        const cdEl = document.getElementById('sbCountdown');
        if (cdEl) cdEl.textContent = this.formatCountdown(this.remainingSeconds);
        if (this.remainingSeconds <= 0) {
          this.clearTimer();
          if (cdEl) cdEl.textContent = 'Reset ready';
        }
      }, 1000);
    }
  }

  public dismiss(): void {
    this.clearTimer();
    if (this.containerEl) this.containerEl.innerHTML = '';
  }

  private clearTimer(): void {
    if (this.timerId !== null) {
      window.clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  private formatCountdown(sec: number): string {
    if (sec <= 0) return 'Reset ready';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `Resets in ${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  private escape(str: string): string {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }
}

if (typeof exports !== 'undefined') {
  Object.assign(exports, { SmartBannerManager });
}
