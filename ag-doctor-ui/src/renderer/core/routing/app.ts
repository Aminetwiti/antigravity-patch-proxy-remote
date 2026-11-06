
declare function loadTraffic(): Promise<void>;
declare function loadDashboard(): Promise<void>;
declare function loadRemoteView(): Promise<void>;
declare function openProviderModal(provider?: any): void;
declare function closeProviderModal(): void;

/**
 * ag-doctor UI — Main App Orchestrator.
 * Coordinates view routers, global shortcuts, status bar, and background telemetry.
 * Decoupled from monolithic 16k lines into dedicated, high-cohesion view controllers.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Diagnostic error banners (prevent UI lockup)
// ─────────────────────────────────────────────────────────────────────────────

window.addEventListener('error', (e) => {
  const banner = document.createElement('div');
  banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#dc2626;color:#fff;padding:12px 16px;font:13px/1.5 monospace;white-space:pre-wrap;';
  banner.textContent = `[app.ts ERROR] ${e.message}\nat ${e.filename}:${e.lineno}:${e.colno}`;
  document.body.prepend(banner);
});

window.addEventListener('unhandledrejection', (e) => {
  const reasonText = e.reason instanceof Error ? (e.reason.stack || e.reason.message) : String(e.reason);
  console.error('[app.ts UNHANDLED REJECTION]', e.reason);
  const banner = document.createElement('div');
  banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#dc2626;color:#fff;padding:12px 16px;font:13px/1.5 monospace;white-space:pre-wrap;box-shadow:0 4px 12px rgba(0,0,0,0.5);display:flex;justify-content:space-between;align-items:flex-start;';

  const textSpan = document.createElement('div');
  textSpan.style.cssText = 'flex:1;overflow:auto;max-height:160px;';
  textSpan.textContent = `[app.ts UNHANDLED REJECTION] ${reasonText}`;

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.style.cssText = 'margin-left:12px;background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.4);color:#fff;padding:4px 8px;border-radius:4px;cursor:pointer;font-weight:bold;font-size:12px;';
  closeBtn.textContent = '✕ Fermer';
  closeBtn.addEventListener('click', () => banner.remove());

  banner.appendChild(textSpan);
  banner.appendChild(closeBtn);
  document.body.prepend(banner);
});

// ─────────────────────────────────────────────────────────────────────────────
// Register View Loaders (Open / Closed Principle)
// ─────────────────────────────────────────────────────────────────────────────

registerViewLoader('google-accounts', () => void loadGoogleAccounts());
registerViewLoader('models', () => void loadModels());
registerViewLoader('patch', () => void loadPatchStatus());
registerViewLoader('logs', () => void loadLogs());
registerViewLoader('mitm', () => void loadMitmStatus());
registerViewLoader('settings', () => void loadSettings());
registerViewLoader('antigravity', () => void loadAntigravityStatus());
registerViewLoader('traffic', () => void loadTraffic());
registerViewLoader('tokenizer', () => void loadTokenizer());
registerViewLoader('dashboard', () => void loadDashboard());
registerViewLoader('doctor', () => void loadDoctor());
registerViewLoader('remote', () => void loadRemoteView());

// Expose views globally for template inline calls and IPC events
if (typeof window !== 'undefined') {
  const w = window as any;
  if (typeof runDoctorView !== 'undefined') w.runDoctorView = runDoctorView;
  if (typeof runDoctor !== 'undefined') w.runDoctor = runDoctor;
  if (typeof loadDoctor !== 'undefined') w.loadDoctor = loadDoctor;
  if (typeof loadPatchStatus !== 'undefined') w.loadPatchStatus = loadPatchStatus;
  if (typeof loadMitmStatus !== 'undefined') w.loadMitmStatus = loadMitmStatus;
  if (typeof loadLogs !== 'undefined') w.loadLogs = loadLogs;
  if (typeof loadAntigravityStatus !== 'undefined') w.loadAntigravityStatus = loadAntigravityStatus;
  if (typeof loadSettings !== 'undefined') w.loadSettings = loadSettings;
  if (typeof loadRemoteView !== 'undefined') w.loadRemoteView = loadRemoteView;
  if (typeof loadModels !== 'undefined') w.loadModels = loadModels;
  if (typeof loadDashboard !== 'undefined') w.loadDashboard = loadDashboard;
  if (typeof loadTokenizer !== 'undefined') w.loadTokenizer = loadTokenizer;
  if (typeof loadTraffic !== 'undefined') w.loadTraffic = loadTraffic;
  if (typeof loadGoogleAccounts !== 'undefined') w.loadGoogleAccounts = loadGoogleAccounts;
  if (typeof openPalette !== 'undefined') w.openPalette = openPalette;
  if (typeof closePalette !== 'undefined') w.closePalette = closePalette;
  if (typeof openProviderModal !== 'undefined') w.openProviderModal = openProviderModal;
  if (typeof closeProviderModal !== 'undefined') w.closeProviderModal = closeProviderModal;
}

// ─────────────────────────────────────────────────────────────────────────────
// Status Bar Wiring
// ─────────────────────────────────────────────────────────────────────────────

const statusPlatformText = $('#statusPlatformText') as HTMLSpanElement;
const statusVersion = $('#statusVersion') as HTMLSpanElement;
const statusTheme = $('#statusTheme') as HTMLSpanElement;

function updateStatusBarTheme(theme: string): void {
  if (!statusTheme) return;
  const label = statusTheme.querySelector('span');
  if (label) label.textContent = theme === 'light' ? 'Light' : 'Dark';
}

function updateStatusBarPlatform(platform: string, arch: string): void {
  if (statusPlatformText) statusPlatformText.textContent = `${platform}/${arch}`;
}

if (statusTheme) {
  statusTheme.addEventListener('click', async () => {
    const current = document.documentElement.dataset.theme ?? 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    await setTheme(next as 'dark' | 'light');
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Proactive Zero-Friction Telemetry Auto-Sync
// ─────────────────────────────────────────────────────────────────────────────

let gaAutoSyncDebounce: any = null;
function triggerAutoSyncGoogleAccounts(): void {
  if (gaAutoSyncDebounce) clearTimeout(gaAutoSyncDebounce);
  gaAutoSyncDebounce = setTimeout(() => {
    if (document.visibilityState === 'visible') {
      const isModalOpen = Boolean(document.querySelector('.modal-backdrop:not([hidden])'));
      const isDropdownOpen = Boolean(document.querySelector('.ga-more-dropdown-wrap.open'));
      if (isModalOpen || isDropdownOpen) return;
      const fn = (window as any).loadGoogleAccounts || (typeof loadGoogleAccounts === 'function' ? loadGoogleAccounts : null);
      if (typeof fn === 'function') {
        void fn(false).catch((err: unknown) => {
          console.warn('[AutoSync] loadGoogleAccounts failed:', err);
        });
      }
    }
  }, 300);
}

// Auto-sync listeners
window.addEventListener('focus', triggerAutoSyncGoogleAccounts);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') triggerAutoSyncGoogleAccounts();
});

// Background telemetry heartbeat (every 20s while window is visible)
setInterval(() => {
  if (document.visibilityState === 'visible' && !document.hidden) {
    triggerAutoSyncGoogleAccounts();
  }
}, 20_000);

// ─────────────────────────────────────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────────────────────────────────────

(async function boot(): Promise<void> {
  initNavigation();
  setStatus('Initializing…', 'busy');
  try {
    const [, info] = await Promise.all([
      applySavedTheme(),
      memo('info', 60_000, () => window.ag.info()),
    ]);
    setStatus(`Ready · ${info.platform}/${info.arch}`);
    updateStatusBarPlatform(info.platform, info.arch);
    updateStatusBarTheme(document.documentElement.dataset.theme ?? 'dark');
    if (statusVersion) statusVersion.textContent = `v${info.electron ? '1.0.0' : '1.0.0'}`;
  } catch {
    setStatus('Ready');
  }
  whenIdle(() => {
    const rd = (window as any).runDoctor || (typeof runDoctor === 'function' ? runDoctor : null);
    if (typeof rd === 'function') {
      void rd();
    } else if (typeof runDoctorView === 'function') {
      void runDoctorView();
    }
  }, 400);
})();
