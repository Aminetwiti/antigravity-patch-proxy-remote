/**
 * Auto-Update Notification Component for ag-doctor-ui.
 *
 * Provides a fully automated update workflow:
 * - When an update is detected, automatically begins downloading in background.
 * - Displays a sleek floating card with real-time download progress.
 * - When download completes, automatically schedules restart & install (with a 5s grace countdown).
 * - Allows immediate application or postponement by the user.
 */

export interface UpdateNotificationState {
  info: any | null;
  state: 'checking' | 'available' | 'downloading' | 'ready' | 'error';
  progress: number;
  error?: string;
  countdown: number;
}

export class UpdateNotificationManager {
  private static instance: UpdateNotificationManager | null = null;
  private container: HTMLDivElement | null = null;
  private countdownTimer: any = null;
  private state: UpdateNotificationState = {
    info: null,
    state: 'available',
    progress: 0,
    countdown: 5,
  };

  public static getInstance(): UpdateNotificationManager {
    if (!UpdateNotificationManager.instance) {
      UpdateNotificationManager.instance = new UpdateNotificationManager();
    }
    return UpdateNotificationManager.instance;
  }

  constructor() {
    this.initListeners();
  }

  private initListeners(): void {
    if (typeof window !== 'undefined' && window.ag && window.ag.updater) {
      // Whenever backend detects an available update, automatically show and download it
      window.ag.updater.onUpdateAvailable((info: any) => {
        this.show(info, true);
      });

      window.ag.updater.onProgress((p: { percent: number; transferred: number; total: number }) => {
        this.updateProgress(p.percent);
      });
    }
  }

  private ensureContainer(): HTMLDivElement {
    if (!this.container) {
      let existing = document.getElementById('updateNotificationContainer') as HTMLDivElement;
      if (!existing) {
        existing = document.createElement('div');
        existing.id = 'updateNotificationContainer';
        existing.className = 'update-notification-container';
        document.body.appendChild(existing);
      }
      this.container = existing;
    }
    return this.container;
  }

  /**
   * Display the update card. If autoDownload is true, begins downloading immediately.
   */
  public show(info: any, autoDownload = true): void {
    this.clearCountdown();
    this.state = {
      info,
      state: autoDownload ? 'downloading' : 'available',
      progress: 0,
      countdown: 5,
    };
    this.render();

    if (autoDownload) {
      void this.startDownload();
    }
  }

  public hide(): void {
    this.clearCountdown();
    if (this.container) {
      this.container.innerHTML = '';
      this.container.style.display = 'none';
    }
  }

  private clearCountdown(): void {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  }

  public updateProgress(percent: number): void {
    this.state.progress = percent;
    if (this.state.state === 'downloading') {
      const bar = document.getElementById('updateProgressBarFill') as HTMLDivElement;
      const text = document.getElementById('updateProgressText') as HTMLSpanElement;
      if (bar) bar.style.width = `${percent}%`;
      if (text) text.textContent = `${percent}%`;
    }
  }

  public async startDownload(): Promise<void> {
    if (!window.ag?.updater || !this.state.info) return;

    this.clearCountdown();
    this.state.state = 'downloading';
    this.state.progress = 0;
    this.render();

    try {
      const res = await window.ag.updater.download(this.state.info.downloadUrl);
      if (res.success) {
        this.state.state = 'ready';
        this.state.countdown = 5;
        this.render();
        this.startAutoApplyCountdown();
      } else {
        this.state.state = 'error';
        this.state.error = res.error || 'Échec du téléchargement';
        this.render();
      }
    } catch (err: any) {
      this.state.state = 'error';
      this.state.error = err?.message || String(err);
      this.render();
    }
  }

  /**
   * Automatic 5-second countdown to apply update & restart seamlessly.
   */
  private startAutoApplyCountdown(): void {
    this.clearCountdown();
    this.state.countdown = 5;

    this.countdownTimer = setInterval(() => {
      this.state.countdown -= 1;
      const cdEl = document.getElementById('updateCountdownVal');
      const btnEl = document.getElementById('updateCardRestartBtn');
      if (cdEl) cdEl.textContent = `${this.state.countdown}s`;
      if (btnEl) btnEl.innerHTML = `Redémarrer et appliquer (${this.state.countdown}s)`;

      if (this.state.countdown <= 0) {
        this.clearCountdown();
        void this.applyRestart();
      }
    }, 1000);
  }

  public async applyRestart(): Promise<void> {
    this.clearCountdown();
    if (!window.ag?.updater) return;
    try {
      // Pass silent = true to execute update and replace app seamlessly
      await window.ag.updater.install(undefined, true);
    } catch (err: any) {
      console.error('[UpdateNotification] Erreur lors de l\'application:', err);
    }
  }

  public render(): void {
    const root = this.ensureContainer();
    if (!this.state.info) {
      root.style.display = 'none';
      return;
    }

    root.style.display = 'block';

    const { info, state, progress, error, countdown } = this.state;
    const isBeta = info.channel === 'beta' || (info.latestVersion && info.latestVersion.includes('-'));
    const notesSummary = (info.releaseNotes || '')
      .split('\n')
      .filter((line: string) => line.trim().length > 0)
      .slice(0, 3)
      .join('<br>') || 'Nouvelle version disponible.';

    root.innerHTML = `
      <div class="update-card ${state === 'ready' ? 'ready' : ''}">
        <div class="update-card-header">
          <div class="update-card-title-group">
            <div class="update-icon-badge ${state === 'ready' ? 'ready' : ''}">
              ${state === 'ready' ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>'}
            </div>
            <div>
              <div class="update-title">
                ${state === 'ready' ? 'Mise à jour prête' : state === 'downloading' ? 'Téléchargement de la mise à jour...' : 'Mise à jour disponible'}
              </div>
              <div class="update-subtitle">
                <span class="update-version-tag">v${info.latestVersion}</span>
                ${isBeta ? '<span class="update-channel-badge beta">Beta</span>' : '<span class="update-channel-badge stable">Stable</span>'}
                <span class="update-current-hint">(actuel v${info.currentVersion})</span>
              </div>
            </div>
          </div>
          <button class="update-close-btn" id="updateCardCloseBtn" type="button" aria-label="Fermer">✕</button>
        </div>

        <div class="update-card-body">
          ${
            state === 'downloading'
              ? `
              <div class="update-progress-wrap">
                <div class="update-progress-label">
                  <span>Téléchargement automatique en arrière-plan...</span>
                  <span id="updateProgressText" class="update-progress-percent">${progress}%</span>
                </div>
                <div class="update-progress-bar">
                  <div id="updateProgressBarFill" class="update-progress-bar-fill" style="width: ${progress}%"></div>
                </div>
              </div>
            `
              : state === 'ready'
              ? `
              <div class="update-ready-msg">
                Le package a été téléchargé avec succès. Redémarrage automatique dans <strong id="updateCountdownVal">${countdown}s</strong>...
              </div>
            `
              : state === 'error'
              ? `
              <div class="update-error-msg">
                Échec du téléchargement : ${error || 'Erreur réseau.'}
                ${info.downloadUrl ? `<div style="font-size:10px; margin-top:4px; opacity:0.8; word-break:break-all;">Cible : ${info.downloadUrl}</div>` : ''}
              </div>
            `
              : `
              <div class="update-notes-preview">
                ${notesSummary}
                ${
                  info.releaseUrl
                    ? `
                  <div style="margin-top: 6px; padding-top: 6px; border-top: 1px solid var(--border, rgba(255,255,255,0.08));">
                    <a href="#" class="update-github-link" id="updateGithubLink" title="Consulter la release sur GitHub">
                      Notes de version complètes sur GitHub ↗
                    </a>
                  </div>
                `
                    : ''
                }
              </div>
            `
          }
        </div>

        <div class="update-card-footer">
          ${
            state === 'downloading'
              ? `
              <button class="btn btn-sm btn-ghost" id="updateCardCancelBtn" type="button">Masquer</button>
            `
              : state === 'ready'
              ? `
              <button class="btn btn-sm btn-primary update-action-btn" id="updateCardRestartBtn" type="button">
                Redémarrer et appliquer (${countdown}s)
              </button>
              <button class="btn btn-sm btn-ghost" id="updateCardLaterBtn" type="button">Plus tard</button>
            `
              : state === 'error'
              ? `
              <button class="btn btn-sm btn-primary update-action-btn" id="updateCardRetryBtn" type="button">
                Réessayer
              </button>
              <button class="btn btn-sm btn-ghost" id="updateCardCloseBottomBtn" type="button">Fermer</button>
            `
              : `
              <button class="btn btn-sm btn-primary update-action-btn" id="updateCardDownloadBtn" type="button">
                Télécharger &amp; appliquer
              </button>
              <button class="btn btn-sm btn-ghost" id="updateCardLaterBtn" type="button">Plus tard</button>
            `
          }
        </div>
      </div>
    `;

    // Attach button listeners
    const closeBtn = document.getElementById('updateCardCloseBtn');
    if (closeBtn) closeBtn.onclick = () => this.hide();

    const cancelBtn = document.getElementById('updateCardCancelBtn');
    if (cancelBtn) cancelBtn.onclick = () => this.hide();

    const laterBtn = document.getElementById('updateCardLaterBtn');
    if (laterBtn) laterBtn.onclick = () => this.hide();

    const closeBottomBtn = document.getElementById('updateCardCloseBottomBtn');
    if (closeBottomBtn) closeBottomBtn.onclick = () => this.hide();

    const downloadBtn = document.getElementById('updateCardDownloadBtn');
    if (downloadBtn) downloadBtn.onclick = () => this.startDownload();

    const retryBtn = document.getElementById('updateCardRetryBtn');
    if (retryBtn) retryBtn.onclick = () => this.startDownload();

    const restartBtn = document.getElementById('updateCardRestartBtn');
    if (restartBtn) {
      restartBtn.onclick = () => {
        this.clearCountdown();
        void this.applyRestart();
      };
    }

    const ghLink = document.getElementById('updateGithubLink');
    if (ghLink && info.releaseUrl) {
      ghLink.onclick = (e) => {
        e.preventDefault();
        if (window.ag?.updater?.openReleasePage) {
          void window.ag.updater.openReleasePage(info.releaseUrl);
        } else if (window.ag?.openExternal) {
          void window.ag.openExternal(info.releaseUrl);
        }
      };
    }
  }
}

/**
 * Global trigger function to check and display updates manually.
 */
export async function triggerUpdateCheck(manual = true): Promise<void> {
  if (!window.ag?.updater) return;

  try {
    const info = await window.ag.updater.check();
    if (info && info.hasUpdate) {
      // Detected update -> automatically download and prepare application!
      UpdateNotificationManager.getInstance().show(info, true);
    } else if (manual) {
      if (typeof (window as any).toast === 'function') {
        (window as any).toast(`Vous disposez déjà de la dernière version (v${info.currentVersion}).`, 'ok');
      }
    }
  } catch (err: any) {
    if (manual && typeof (window as any).toast === 'function') {
      (window as any).toast(`Échec de la recherche de mise à jour : ${err?.message || err}`, 'warn');
    }
  }
}

// Auto-initialize on DOM ready
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    UpdateNotificationManager.getInstance();
  });
}
