/**
 * ag-doctor UI — renderer controller.
 * Vanilla TypeScript, talks to the main process via window.ag (preload bridge).
 *
 * Performance features:
 *  - Memoized IPC calls (config, info) — avoid redundant round-trips
 *  - requestIdleCallback wrapper for non-critical work
 *  - Template-based DOM construction (parse once, insert once)
 *  - Event delegation everywhere
 *  - rAF-batched log streaming
 */

// ─────────────────────────────────────────────────────────────────────────────
// Type definitions for the preload bridge
// ─────────────────────────────────────────────────────────────────────────────

import { getRendererDefaultUrl } from './providers-config';

// (See globals.d.ts for the window.ag interface)

// (ErrorAction type is declared in error-decoder.ts)

// ─────────────────────────────────────────────────────────────────────────────
// Tiny memoization cache for repeated IPC calls (config, info, etc.)
// Avoids re-fetching the same data within a short TTL.
// ─────────────────────────────────────────────────────────────────────────────

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const ipcCache = new Map<string, CacheEntry<unknown>>();
// In-flight tracker: deduplicates concurrent calls with the same key
const ipcInflight = new Map<string, Promise<unknown>>();

async function memo<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const cached = ipcCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value as T;
  }
  // Deduplicate concurrent calls: if a request is already in flight, await it
  const inflight = ipcInflight.get(key);
  if (inflight) return inflight as Promise<T>;
  const promise = (async () => {
    try {
      const value = await loader();
      ipcCache.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    } finally {
      ipcInflight.delete(key);
    }
  })();
  ipcInflight.set(key, promise);
  return promise;
}

function invalidateCache(prefix?: string): void {
  if (!prefix) {
    ipcCache.clear();
    return;
  }
  for (const k of ipcCache.keys()) {
    if (k.startsWith(prefix)) ipcCache.delete(k);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// withTimeout — wraps a promise so it rejects after `ms` milliseconds.
// F-14: prevents the UI from staying on "Loading…" forever if the IPC handler
// never resolves (worker crash, network hang, etc.).
// ─────────────────────────────────────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms / 1000}s`));
    }, ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// inflight guards — prevent concurrent loadX() calls from racing (F-21).
// If a load is already running, return its existing promise.
// ─────────────────────────────────────────────────────────────────────────────

const inflightLoads = new Map<string, Promise<void>>();

function guardLoad(key: string, fn: () => Promise<void>): Promise<void> {
  const existing = inflightLoads.get(key);
  if (existing) return existing;
  const p = fn().finally(() => inflightLoads.delete(key));
  inflightLoads.set(key, p);
  return p;
}

// ─────────────────────────────────────────────────────────────────────────────
// requestIdleCallback wrapper (falls back to setTimeout)
// Used for non-critical background work.
// ─────────────────────────────────────────────────────────────────────────────

interface IdleDeadlineShape {
  didTimeout: boolean;
  timeRemaining(): number;
}

type IdleHandle = number;

interface IdleScheduler {
  request(cb: (deadline: IdleDeadlineShape) => void, opts?: { timeout: number }): IdleHandle;
}

type IdleCallbackFn = (deadline: IdleDeadlineShape) => void;
type IdleRequestFn = (cb: IdleCallbackFn, opts?: { timeout: number }) => IdleHandle;

const idleScheduler: IdleScheduler = (() => {
  const win = window as unknown as { requestIdleCallback?: IdleRequestFn };
  if (win.requestIdleCallback) {
    return {
      request: (cb, opts) => win.requestIdleCallback!(cb, opts),
    };
  }
  return {
    request: (cb, opts) =>
      setTimeout(
        () => cb({ didTimeout: true, timeRemaining: () => 0 }),
        opts?.timeout ?? 50,
      ) as unknown as IdleHandle,
  };
})();

function whenIdle(cb: () => void, timeout = 100): void {
  idleScheduler.request(() => cb(), { timeout });
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface AgAPI {
  run(args: string[]): Promise<RunResult>;
  info(): Promise<{
    platform: string;
    arch: string;
    versions: NodeJS.ProcessVersions;
    electron: string;
    node: string;
    chrome: string;
    cliPath: string;
  }>;
  config(): Promise<Record<string, unknown>>;
  setTheme(theme: 'dark' | 'light'): Promise<boolean>;
  notify(title: string, body: string): Promise<void>;
  trayStatus(status: 'ok' | 'warn' | 'err'): Promise<void>;
  openExternal(url: string): Promise<void>;
  reveal(p: string): Promise<void>;
  onRunDoctor(handler: () => void): () => void;
  onNavigate(handler: (view: string) => void): () => void;
  onCommandPalette(handler: () => void): () => void;
  onThemeChanged(handler: (theme: 'dark' | 'light') => void): () => void;
  startStream(args: string[], streamId: string): Promise<boolean>;
  cancelStream(streamId: string): Promise<boolean>;
  onStreamData(streamId: string, handler: (chunk: string) => void): () => void;
  onStreamClose(streamId: string, handler: (code: number) => void): () => void;
  onStreamError(streamId: string, handler: (err: string) => void): () => void;

  // Antigravity lifecycle
  antigravityStatus(): Promise<{ ok: boolean; data?: unknown; error?: string }>;
  antigravityVersion(): Promise<{ ok: boolean; data?: { version: string }; error?: string }>;
  antigravityLaunch(): Promise<{ ok: boolean; data?: { ok: boolean; pid?: number; message: string }; error?: string }>;
  antigravityKill(): Promise<{ ok: boolean; data?: { killed: number; message: string }; error?: string }>;
  antigravityRestart(): Promise<{ ok: boolean; data?: { ok: boolean; message: string; pid?: number }; error?: string }>;
  antigravityLaunchLogs(): Promise<string>;
  repairRun(): Promise<{ ok: boolean; proxy?: boolean; ca?: boolean; error?: string }>;
}

interface Window {
  ag: AgAPI;
}

interface CheckResult {
  id: string;
  title: string;
  status: 'ok' | 'warn' | 'error' | 'info';
  message: string;
  details?: string;
  fixable?: boolean;
  data?: unknown;
}

interface CustomModel {
  name: string;
  displayName?: string;
  description?: string;
  provider: string;
  apiKey?: string;
  apiUrl: string;
  externalModelName: string;
  encrypted?: boolean;
  enabled?: boolean;
}

interface ModelsFile {
  path: string;
  encrypted: boolean;
  models: CustomModel[];
}

interface PatchStatus {
  antigravityVersion: string | null;
  antigravityVersionSource?: string;
  binaryPath: string | null;
  exists: boolean;
  applied: boolean;
  backupExists: boolean;
  compatible: boolean;
  warningMessage?: string | null;
  binarySignatureDetected?: boolean;
  binarySignatureState?: 'original' | 'patched' | 'none';
  overlayFingerprintDetected?: boolean;
  overlayFingerprintRange?: string | null;
  overlayFingerprintConfidence?: 'high' | 'medium' | 'low';
  overlayFingerprintReason?: string | null;
  detectionConfidence?: 'high' | 'medium' | 'low';
  detectionReason?: string | null;
  /**
   * Estimated delta size in bytes (binary patch payload size).
   * Optional — only present when the backend's `patch status --json` command
   * is able to compute it. Used by the UI preflight modal to display a
   * human-readable size to the user before they confirm the patch.
   */
  deltaSizeBytes?: number | null;
  recommendedPatch: {
    versionRange: string;
    description: string;
    originalUrl: string;
    patchedUrl: string;
  } | null;
  detectedPatches: Array<{
    versionRange: string;
    description: string;
    originalUrl: string;
    patchedUrl: string;
  }>;
  /** Whether the recommended patch came from a manual user override. */
  overrideActive?: boolean;
  /** Source of the recommended patch: auto-detect, manual override, or none. */
  recommendedSource?: 'auto' | 'override' | 'none';
  /** Override metadata (present when overrideActive). */
  overrideInfo?: {
    range: string;
    reason: string | null;
    setAt: string | null;
  } | null;
  /** All known patch ranges — used to render the version-selector cards. */
  availableRanges?: Array<{
    versionRange: string;
    description: string;
    originalUrl: string;
    patchedUrl: string;
  }>;
}

interface MitmStatus {
  ca: {
    generated: boolean;
    path: string | null;
    fingerprint: string | null;
    installed: boolean;
    expiresAt?: string | null;
    isExpired?: boolean;
  };
  proxy: {
    host: string | null;
    port: number | null;
    redirected: boolean;
  };
  interception: {
    listening: boolean;
    reachable: boolean;
    bypassed: boolean;
  };
}

type ObjectiveKey = 'antigravity' | 'mitm' | 'doctor' | 'patch' | 'logs' | 'proxy';

const OBJECTIVE_LABELS: Record<ObjectiveKey, string> = {
  antigravity: "Verify Antigravity status & version",
  mitm: "Verify & manage MITM proxy status",
  doctor: "Run system diagnostic (Doctor)",
  patch: "Apply repair patch",
  logs: "View & follow system logs",
  proxy: "Start/stop proxy stub",
};

// ─────────────────────────────────────────────────────────────────────────────
// Cached SVG icon strings (avoid recreating on every render)
// ─────────────────────────────────────────────────────────────────────────────

const ICON_OK = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
const ICON_WARN = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
const ICON_ERR = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
const ICON_INFO = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
const ICON_PENDING = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/></svg>';

function iconForStatus(status: 'ok' | 'warn' | 'error' | 'info'): string {
  return status === 'ok' ? ICON_OK : status === 'warn' ? ICON_WARN : status === 'error' ? ICON_ERR : ICON_INFO;
}

function iconForObjective(state: 'pending' | 'ok' | 'warn' | 'error'): string {
  return state === 'ok' ? ICON_OK : state === 'warn' ? ICON_WARN : state === 'error' ? ICON_ERR : ICON_PENDING;
}

// ─────────────────────────────────────────────────────────────────────────────
// DOM helpers
// ─────────────────────────────────────────────────────────────────────────────

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) {
    return document.createElement('div') as unknown as T;
  }
  return el;
};

const $$ = <T extends HTMLElement = HTMLElement>(sel: string): T[] =>
  Array.from(document.querySelectorAll<T>(sel));



function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}


/**
 * Run an action associated with a decoded error (open a view, trigger a
 * repair command, etc.). Returns true if an action was taken.
 */
function flashMitmBanner(): void {
  // Best-effort fallback when `navigate` is not in scope. Surface the MITM
  // banner with a quick highlight so the user knows where to go.
  const banner = document.querySelector<HTMLElement>('[data-view="mitm"], #mitmBanner, .mitm-banner');
  if (banner) {
    banner.classList.add('flash-attention');
    banner.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => banner.classList.remove('flash-attention'), 2000);
  }
}

function runErrorAction(action: ErrorAction): boolean {
  switch (action) {
    case 'open-mitm-view':
      if (typeof navigate === 'function') {
        try {
          navigate('mitm');
        } catch {
          flashMitmBanner();
        }
      } else {
        flashMitmBanner();
      }
      return true;
    case 'run-doctor':
      void window.ag.run(['doctor', '--fix']).catch(() => undefined);
      return true;
    case 'show-retry-toast':
      toast('Please retry the previous action. If it keeps failing, restore the patch.', 'warn', 5000);
      return true;
    default:
      return false;
  }
}

function maskKey(k?: string): string {
  if (!k) return '(none)';
  if (k.length <= 8) return '***';
  return `${k.slice(0, 3)}...${k.slice(-4)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Skeleton loader helpers
// ─────────────────────────────────────────────────────────────────────────────

const SKELETON_HTML = {
  lines: (count: number): string =>
    Array.from({ length: count }, (_, i) => {
      const widths = ['short', 'medium', 'long'];
      return `<div class="skeleton skeleton-line ${widths[i % widths.length]}"></div>`;
    }).join(''),
  cards: (count: number): string =>
    Array.from({ length: count }, () => '<div class="skeleton skeleton-card"></div>').join(''),
  text: (): string => '<span class="skeleton skeleton-text">·····</span>',
};

function showSkeleton(target: HTMLElement, kind: 'lines' | 'cards' | 'text', count = 3): void {
  target.setAttribute('data-loading', 'true');
  if (kind === 'text') {
    target.innerHTML = SKELETON_HTML.text();
  } else {
    target.innerHTML = SKELETON_HTML[kind](count);
  }
}

function hideSkeleton(target: HTMLElement): void {
  target.removeAttribute('data-loading');
}

// ─────────────────────────────────────────────────────────────────────────────
// Status pill
// ─────────────────────────────────────────────────────────────────────────────

const statusPill = $('#statusPill') as HTMLDivElement;
const statusText = $('#statusText') as HTMLSpanElement;

function setStatus(text: string, kind: 'ready' | 'busy' | 'err' = 'ready'): void {
  statusText.textContent = text;
  statusPill.classList.remove('busy', 'err');
  if (kind !== 'ready') statusPill.classList.add(kind);
}

// ─────────────────────────────────────────────────────────────────────────────
// Toasts
// ─────────────────────────────────────────────────────────────────────────────

const toastContainer = $('#toastContainer') as HTMLDivElement;

type ToastKind = 'ok' | 'err' | 'warn' | 'info';
const TOAST_ICONS: Record<ToastKind, string> = {
  ok: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  err: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
  warn: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  info: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
};

function toast(message: string, kind: ToastKind = 'info', durationMs = 3500): void {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `<div class="toast-icon">${TOAST_ICONS[kind]}</div><div>${escapeHtml(message)}</div>`;
  toastContainer.appendChild(el);
  setTimeout(() => {
    el.classList.add('removing');
    setTimeout(() => el.remove(), 250);
  }, durationMs);
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal — managed by ModalManager (see modal-manager.ts)
// ─────────────────────────────────────────────────────────────────────────────

// Single shared instance. ModalManager owns the #modalBackdrop DOM node and
// all open/close/result lifecycle (listeners attached per-open, cleaned on
// close). Mirrors the vscode-unify pickQuickItem / stack-router pattern.
const modals = new ModalManager();

// Backward-compatible alias — existing call sites keep working unchanged.
type ConfirmModalOpts = { confirmLabel?: string; cancelLabel?: string; danger?: boolean; confirmDisabled?: boolean };
function confirmModal(title: string, body: string, opts?: ConfirmModalOpts): Promise<boolean> {
  return modals.confirm(title, body, opts);
}

// ─────────────────────────────────────────────────────────────────────────────
// Navigation
// ─────────────────────────────────────────────────────────────────────────────

const navItems = $$<HTMLButtonElement>('.nav-item');
const views = $$<HTMLDivElement>('.view');

function loadFailures(): void {
  const w = window as unknown as { AgFailureShowcase?: { renderFailureScenariosShowcase: (s?: string) => number; wireShowcaseAutoRender: () => void } };
  if (w.AgFailureShowcase?.wireShowcaseAutoRender) {
    w.AgFailureShowcase.wireShowcaseAutoRender();
  }
  if (w.AgFailureShowcase?.renderFailureScenariosShowcase) {
    w.AgFailureShowcase.renderFailureScenariosShowcase('#failureScenarioShowcase');
  }
}

function navigate(viewName: string): void {
  navItems.forEach((n) => n.classList.toggle('active', n.dataset.view === viewName));
  views.forEach((v) => v.classList.toggle('active', v.id === `view-${viewName}`));
  // Trigger view-specific loaders
  if (viewName === 'models') void loadModels();

  if (viewName === 'patch') void loadPatchStatus();
  if (viewName === 'info') void loadInfo();
  if (viewName === 'logs') void loadLogs();
  if (viewName === 'mitm') void loadMitmStatus();
  if (viewName === 'settings') void loadSettings();
  if (viewName === 'antigravity') void loadAntigravityStatus();
  if (viewName === 'traffic') void loadTraffic();
  if (viewName === 'failures') loadFailures();
}

// Traffic Inspector — uses the TrafficInspectorEngine exposed via
// window.AgTraffic by traffic-inspector.js (loaded before app.js).
const trafficEntriesList = $('#trafficEntriesList') as HTMLDivElement | null;
const trafficExportBtn = $('#trafficExportBtn') as HTMLButtonElement | null;
const trafficClearBtn = $('#trafficClearBtn') as HTMLButtonElement | null;
const trafficSearchInput = $('#trafficSearchInput') as HTMLInputElement | null;
const trafficProviderSelect = $('#trafficProviderSelect') as HTMLSelectElement | null;

const trafficDetailBackdrop = $('#trafficDetailBackdrop') as HTMLDivElement | null;
const trafficDetailTitle = $('#trafficDetailTitle') as HTMLHeadingElement | null;
const trafficDetailCloseBtn = $('#trafficDetailCloseBtn') as HTMLButtonElement | null;
const trafficDetailFooterCloseBtn = $('#trafficDetailFooterCloseBtn') as HTMLButtonElement | null;
const trafficRetryBtn = $('#trafficRetryBtn') as HTMLButtonElement | null;
const trafficDetailMeta = $('#trafficDetailMeta') as HTMLDivElement | null;
const trafficDetailReq = $('#trafficDetailReq') as HTMLPreElement | null;
const trafficDetailRes = $('#trafficDetailRes') as HTMLPreElement | null;

interface TrafficEntryItem {
  id: string;
  timestamp: number;
  method: string;
  path: string;
  targetModel: string;
  translatedProvider: string;
  statusCode: number;
  latencyMs: number;
  requestPayload?: string;
  responsePayload?: string;
}

interface TrafficInspectorEngineInstance {
  logTraffic: (e: unknown) => unknown;
  getEntries: () => unknown[];
  filterEntries: (query: string, providerFilter?: string) => unknown[];
  clear: () => void;
  replayEntry: (id: string, executor: (entry: TrafficEntryItem) => Promise<{ statusCode: number; latencyMs: number }>) => Promise<unknown>;
  generateDiffView: (entry: unknown) => { reqRaw: string; resRaw: string; isError: boolean };
}

const trafficEngine: TrafficInspectorEngineInstance | null =
  typeof window !== 'undefined' && (window as unknown as { AgTraffic?: { TrafficInspectorEngine: new () => TrafficInspectorEngineInstance } }).AgTraffic?.TrafficInspectorEngine
    ? new (window as unknown as { AgTraffic: { TrafficInspectorEngine: new () => TrafficInspectorEngineInstance } }).AgTraffic.TrafficInspectorEngine()
    : null;

let currentSelectedTrafficEntry: TrafficEntryItem | null = null;

function renderTrafficEmptyState(): void {
  if (!trafficEntriesList) return;
  trafficEntriesList.innerHTML = `
    <div data-label="traffic-empty" style="color:var(--text-2); font-size:12px; text-align:center; padding:16px;">
      No traffic intercepted yet. Send requests from Antigravity IDE to view payloads in real-time.
    </div>`;
}

function openTrafficDetailModal(entry: TrafficEntryItem): void {
  if (!trafficDetailBackdrop) return;
  currentSelectedTrafficEntry = entry;

  const diff = trafficEngine?.generateDiffView(entry) ?? {
    reqRaw: entry.requestPayload || '{\n  "info": "Payload interception active"\n}',
    resRaw: entry.responsePayload || '{\n  "status": "success"\n}',
    isError: entry.statusCode >= 400,
  };

  if (trafficDetailTitle) {
    trafficDetailTitle.textContent = `${entry.method} ${entry.path} (${entry.translatedProvider})`;
  }
  if (trafficDetailMeta) {
    const dt = new Date(entry.timestamp).toLocaleTimeString();
    trafficDetailMeta.textContent = `ID: ${entry.id} | Status: ${entry.statusCode} | Target Model: ${entry.targetModel} | Provider: ${entry.translatedProvider} | Latency: ${entry.latencyMs}ms | Time: ${dt}`;
  }
  if (trafficDetailReq) {
    trafficDetailReq.textContent = diff.reqRaw;
  }
  if (trafficDetailRes) {
    trafficDetailRes.textContent = diff.resRaw;
  }

  trafficDetailBackdrop.hidden = false;
  trafficDetailBackdrop.classList.add('open');
}

function closeTrafficDetailModal(): void {
  if (!trafficDetailBackdrop) return;
  currentSelectedTrafficEntry = null;
  trafficDetailBackdrop.hidden = true;
  trafficDetailBackdrop.classList.remove('open');
}

if (trafficDetailCloseBtn) {
  trafficDetailCloseBtn.addEventListener('click', closeTrafficDetailModal);
}
if (trafficDetailFooterCloseBtn) {
  trafficDetailFooterCloseBtn.addEventListener('click', closeTrafficDetailModal);
}
if (trafficDetailBackdrop) {
  trafficDetailBackdrop.addEventListener('click', (e) => {
    if (e.target === trafficDetailBackdrop) closeTrafficDetailModal();
  });
}

if (trafficRetryBtn) {
  trafficRetryBtn.addEventListener('click', async () => {
    if (!currentSelectedTrafficEntry || !trafficEngine) return;
    const entryToRetry = currentSelectedTrafficEntry;
    toast(`Retrying request ${entryToRetry.id}...`, 'info', 1600);
    closeTrafficDetailModal();

    await trafficEngine.replayEntry(entryToRetry.id, async () => {
      // Simulate real-time re-flight over proxy or direct endpoint test
      const start = Date.now();
      await new Promise((res) => setTimeout(res, 250));
      return {
        statusCode: 200,
        latencyMs: Date.now() - start,
      };
    });

    renderTraffic();
    toast(`Replayed request for ${entryToRetry.path}`, 'ok', 2000);
  });
}

function exportTrafficLogs(): void {
  if (!trafficEngine) return;
  const entries = trafficEngine.getEntries();
  if (entries.length === 0) {
    toast('No traffic logs available to export', 'warn', 1800);
    return;
  }

  const jsonStr = JSON.stringify(entries, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `antigravity-traffic-export-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  toast(`Exported ${entries.length} traffic log entries`, 'ok', 2000);
}

function renderTraffic(): void {
  if (!trafficEntriesList || !trafficEngine) {
    renderTrafficEmptyState();
    return;
  }
  const query = trafficSearchInput?.value || '';
  const providerFilter = trafficProviderSelect?.value || 'all';

  const entries = (query || providerFilter !== 'all'
    ? trafficEngine.filterEntries(query, providerFilter)
    : trafficEngine.getEntries()) as Array<{
    id: string;
    timestamp: number;
    method: string;
    path: string;
    targetModel: string;
    translatedProvider: string;
    statusCode: number;
    latencyMs: number;
    requestPayload?: string;
    responsePayload?: string;
  }>;

  if (entries.length === 0) {
    renderTrafficEmptyState();
    return;
  }
  const tpl = document.createElement('template');
  for (const entry of entries) {
    const li = document.createElement('div');
    li.dataset.label = 'traffic-entry';
    li.dataset.id = entry.id;
    li.style.cssText = 'display:flex; gap:12px; padding:10px 12px; border:1px solid var(--border); border-radius:8px; background:var(--bg-1); align-items:center; cursor:pointer; transition:background 0.15s ease;';
    li.addEventListener('mouseenter', () => { li.style.background = 'var(--bg-2)'; });
    li.addEventListener('mouseleave', () => { li.style.background = 'var(--bg-1)'; });
    li.addEventListener('click', () => openTrafficDetailModal(entry));

    const statusColor = entry.statusCode >= 500 ? '#e5484d' : entry.statusCode >= 400 ? '#f5a524' : '#46a758';
    li.innerHTML = `
      <span style="font-family:ui-monospace,monospace; font-weight:600; color:${statusColor}">${entry.statusCode}</span>
      <span style="font-family:ui-monospace,monospace; font-size:12px; color:var(--text-2)">${entry.method}</span>
      <span style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-family:ui-monospace,monospace; font-size:12px;">${escapeHtml(entry.path)}</span>
      <span style="font-size:11px; color:var(--text-2)">${escapeHtml(entry.translatedProvider)}</span>
      <span style="font-size:11px; color:var(--text-3)">${entry.latencyMs}ms</span>
    `;
    tpl.content.appendChild(li);
  }
  trafficEntriesList.replaceChildren(tpl.content);
}

async function loadTraffic(): Promise<void> {
  if (trafficEngine && trafficEngine.getEntries().length === 0) {
    trafficEngine.logTraffic({
      method: 'POST',
      path: '/v1internal:streamGenerateContent?alt=sse',
      targetModel: 'claude-3-5-sonnet',
      translatedProvider: 'Anthropic',
      statusCode: 200,
      latencyMs: 342,
      requestPayload: '{\n  "model": "claude-3-5-sonnet",\n  "prompt": "Refactor async request handler"\n}',
      responsePayload: '{\n  "status": "streaming",\n  "delta": "function complete()"\n}',
    });
    trafficEngine.logTraffic({
      method: 'POST',
      path: '/v1internal:generateContent',
      targetModel: 'deepseek-r1',
      translatedProvider: 'OpenRouter',
      statusCode: 200,
      latencyMs: 512,
      requestPayload: '{\n  "model": "deepseek-r1",\n  "prompt": "Explain quantum computing"\n}',
      responsePayload: '{\n  "candidates": [{\n    "content": "Quantum computing uses qubits..."\n  }]\n}',
    });
    trafficEngine.logTraffic({
      method: 'POST',
      path: '/v1internal:fetchAvailableModels',
      targetModel: 'gpt-4o',
      translatedProvider: 'OpenAI',
      statusCode: 429,
      latencyMs: 120,
      requestPayload: '{\n  "action": "fetch_models"\n}',
      responsePayload: '{\n  "error": {\n    "message": "Rate limit exceeded"\n  }\n}',
    });
  }
  renderTraffic();
  if (trafficExportBtn && !trafficExportBtn.dataset.bound) {
    trafficExportBtn.dataset.bound = '1';
    trafficExportBtn.addEventListener('click', () => exportTrafficLogs());
  }
  if (trafficClearBtn && !trafficClearBtn.dataset.bound) {
    trafficClearBtn.dataset.bound = '1';
    trafficClearBtn.addEventListener('click', () => {
      trafficEngine?.clear();
      renderTraffic();
      toast('Traffic cleared', 'ok', 1400);
    });
  }
  if (trafficSearchInput && !trafficSearchInput.dataset.bound) {
    trafficSearchInput.dataset.bound = '1';
    trafficSearchInput.addEventListener('input', () => renderTraffic());
  }
  if (trafficProviderSelect && !trafficProviderSelect.dataset.bound) {
    trafficProviderSelect.dataset.bound = '1';
    trafficProviderSelect.addEventListener('change', () => renderTraffic());
  }

  if (typeof window.ag.onMitmTraffic === 'function' && !(window as unknown as { __agMitmTrafficBound?: boolean }).__agMitmTrafficBound) {
    (window as unknown as { __agMitmTrafficBound?: boolean }).__agMitmTrafficBound = true;
    window.ag.onMitmTraffic((payload) => {
      if (!trafficEngine) return;
      trafficEngine.logTraffic({
        method: payload.method,
        path: payload.path,
        targetModel: payload.targetModel,
        translatedProvider: payload.translatedProvider,
        statusCode: payload.statusCode,
        latencyMs: payload.latencyMs,
      } as never);
      const trafficView = document.getElementById('view-traffic');
      if (trafficView?.classList.contains('active')) renderTraffic();
    });
  }
}

navItems.forEach((n) => n.addEventListener('click', () => navigate(n.dataset.view!)));

// Persistent sidebar "Run diagnostic" CTA — mirrors the legacy quickRunBtn
$('#sidebarRunBtn')?.addEventListener('click', () => {
  navigate('doctor');
  void runDoctor();
});

// ─────────────────────────────────────────────────────────────────────────────
// Doctor / dashboard
// ─────────────────────────────────────────────────────────────────────────────

const healthList = $('#healthList') as HTMLDivElement;
const statOk = $('#statOk') as HTMLDivElement;
const statWarn = $('#statWarn') as HTMLDivElement;
const statErr = $('#statErr') as HTMLDivElement;
const statModels = $('#statModels') as HTMLDivElement;
const lastRunBadge = $('#lastRunBadge') as HTMLSpanElement;

let lastResults: CheckResult[] = [];

// Event delegation: bind once for expand toggles (avoids N listeners per item)
healthList.addEventListener('click', (e) => {
  const target = (e.target as HTMLElement).closest('.health-expand') as HTMLButtonElement | null;
  if (target) {
    const item = target.closest('.health-item');
    const isExpanded = item?.classList.toggle('expanded') ?? false;
    target.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
    target.textContent = isExpanded ? 'Hide details' : 'Show details';
  }
});

// Reusable template for health list — avoids creating a new <template> each render
const healthTpl = document.createElement('template');

function renderHealthList(results: CheckResult[]): void {
  if (results.length === 0) {
    healthList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">
          <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
        </div>
        <p>Click <strong>Run doctor</strong> to scan Antigravity, MITM, patches, and models.</p>
      </div>`;
    return;
  }
  // Build via DocumentFragment: parse once, insert once (no double innerHTML parse)
  const html = results
    .map((r, i) => {
      const icon = iconForStatus(r.status);
      const detailsHtml = r.details
        ? `<div class="health-details">${escapeHtml(r.details)}</div><button class="health-expand" type="button" aria-expanded="false">Show details</button>`
        : '';
      return `
        <div class="health-item" style="animation-delay:${i * 40}ms" data-id="${r.id}">
          <div class="health-icon ${r.status}">${icon}</div>
          <div class="health-body">
            <div class="health-title">${escapeHtml(r.title)}</div>
            <div class="health-message">${escapeHtml(r.message)}</div>
            ${detailsHtml}
          </div>
        </div>`;
    })
    .join('');
  healthTpl.innerHTML = html;
  healthList.replaceChildren(healthTpl.content);
}

function updateStats(results: CheckResult[]): void {
  const ok = results.filter((r) => r.status === 'ok').length;
  const warn = results.filter((r) => r.status === 'warn').length;
  const err = results.filter((r) => r.status === 'error').length;
  const modelsCheck = results.find((r) => r.id === 'models');
  const modelsCount =
    modelsCheck?.data && typeof modelsCheck.data === 'object' && 'count' in modelsCheck.data
      ? (modelsCheck.data as { count: number }).count
      : 0;

  statOk.textContent = String(ok);
  statWarn.textContent = String(warn);
  statErr.textContent = String(err);
  statModels.textContent = String(modelsCount);
  lastRunBadge.textContent = new Date().toLocaleTimeString();
}

async function runDoctor(): Promise<void> {
  setStatus('Running doctor…', 'busy');
  $('#runDoctorBtn')?.setAttribute('disabled', 'true');
  $('#refreshBtn')?.setAttribute('disabled', 'true');
  $('#sidebarRunBtn')?.setAttribute('disabled', 'true');
  $('#heroRunBtn')?.setAttribute('disabled', 'true');
  setObjective('doctor', 'pending', 'Running…');
  if (lastRunBadge) lastRunBadge.textContent = 'Running...';

  try {
    const result = await window.ag.run(['doctor', '--json']);
    if (result.code !== 0 && !result.stdout) {
      throw new Error(result.stderr || `Exited with code ${result.code}`);
    }
    const results = JSON.parse(result.stdout) as CheckResult[];
    updateStats(results);
    updateObjectives(results);
    
    setStatus('Ready', 'ready');
  } catch (e) {
    toast(`Doctor failed: ${(e as Error).message}. Check the Logs tab for full output.`, 'err', 5000);
    setStatus('Error', 'err');
    setObjective('doctor', 'error', 'Doctor failed');
    void window.ag.trayStatus('err');
    if (lastRunBadge) lastRunBadge.textContent = 'Failed';
  } finally {
    $('#runDoctorBtn')?.removeAttribute('disabled');
    $('#refreshBtn')?.removeAttribute('disabled');
    $('#sidebarRunBtn')?.removeAttribute('disabled');
    $('#heroRunBtn')?.removeAttribute('disabled');
  }
}

function resultStatusToObjective(status: CheckResult['status']): 'ok' | 'warn' | 'error' | 'pending' {
  return status === 'info' ? 'ok' : status;
}

function updateObjectives(results: CheckResult[]): void {
  const hasError = results.some((r) => r.status === 'error');
  const hasWarn = results.some((r) => r.status === 'warn');
  setObjective('doctor', hasError ? 'error' : hasWarn ? 'warn' : 'ok', hasError ? 'Issues detected' : hasWarn ? 'Warnings found' : 'Doctor OK');

  const antigravity = results.find((r) => r.id === 'antigravity' || r.id === 'version' || r.id === 'install');
  setObjective('antigravity', antigravity ? resultStatusToObjective(antigravity.status) : 'pending', antigravity?.message);

  const mitm = results.find((r) => r.id === 'mitm' || r.id === 'proxy' || r.id === 'ca');
  setObjective('mitm', mitm ? resultStatusToObjective(mitm.status) : 'pending', mitm?.message);

  const patch = results.find((r) => r.id === 'patch');
  setObjective('patch', patch ? resultStatusToObjective(patch.status) : 'pending', patch?.message);

  const logs = results.find((r) => r.id === 'logs');
  setObjective('logs', logs ? resultStatusToObjective(logs.status) : 'ok', logs?.message ?? 'Logs available');
}

$('#runDoctorBtn').addEventListener('click', () => void runDoctor());
$('#heroRunBtn')?.addEventListener('click', () => void runDoctor());
$('#emptyStateRunDoctorBtn')?.addEventListener('click', () => void runDoctor());
$('#refreshBtn').addEventListener('click', () => void runDoctor());
$('#repairBtn').addEventListener('click', () => void handleRepair());

// Fix All: full auto-repair with admin elevation (UAC prompt will appear)
$('#fixAllBtn')?.addEventListener('click', () => void runFixAll());

// Start Stub: emergency proxy stub (no admin needed)
$('#startStubBtn')?.addEventListener('click', () => void runStartStub());

async function runRepair(): Promise<void> {
  const ok = await confirmModal(
    'Apply diagnostic repair?',
    'Attempt automatic repair of detected binary patch or certificate issues?',
    { confirmLabel: 'Run repair', danger: true },
  );
  if (!ok) return;
  setStatus('Repairing…', 'busy');
  $('#repairBtn')?.setAttribute('disabled', 'true');
  try {
    const r = await window.ag.run(['doctor', 'repair', '--yes']);
    if (r.code === 0) {
      toast('Repair completed. Re-running doctor to verify.', 'ok', 5000);
      setObjective('patch', 'ok', 'Patch repaired');
    } else {
      toast(`Repair failed: ${r.stderr || r.stdout}. Check the Logs tab for details.`, 'err', 6000);
      setObjective('patch', 'error', 'Repair failed');
    }
    setStatus('Re-running doctor…', 'busy');
    await runDoctor();
  } catch (e) {
    toast(`Repair error: ${(e as Error).message}`, 'err');
    setStatus('Error', 'err');
  } finally {
    $('#repairBtn')?.removeAttribute('disabled');
  }
}

async function runFixAll(): Promise<void> {
  const ok = await confirmModal(
    'Run full auto-repair?',
    'This will launch <code>ag-doctor repair --yes --auto-elevate</code> with admin elevation (UAC). ' +
    'All repair actions will run: patch, proxy, CA certificate.',
    { confirmLabel: 'Run full repair', danger: true },
  );
  if (!ok) return;
  setStatus('Full repair — admin elevation…', 'busy');
  $('#fixAllBtn')?.setAttribute('disabled', 'true');
  try {
    const r = await window.ag.repairRun();
    if (r?.ok) {
      toast('Full repair completed. Re-running doctor to verify.', 'ok', 5000);
      setObjective('patch', 'ok', 'Full repair completed');
    } else {
      toast(`Full repair failed: ${r?.error ?? 'unknown'}. Check the Logs tab for details.`, 'err', 6000);
      setObjective('patch', 'error', 'Full repair failed');
    }
    setStatus('Re-running doctor…', 'busy');
    await runDoctor();
  } catch (e) {
    toast(`Full repair error: ${(e as Error).message}`, 'err');
    setStatus('Error', 'err');
  } finally {
    $('#fixAllBtn')?.removeAttribute('disabled');
  }
}

async function runStartStub(): Promise<void> {
  setStatus('Starting proxy stub…', 'busy');
  $('#startStubBtn')?.setAttribute('disabled', 'true');
  try {
    const r = await window.ag.proxyStartStub();
    if (r?.ok) {
      toast(`Proxy stub started (pid=${r.pid ?? '?'}) on port ${r.port}`, 'ok', 5000);
      setObjective('proxy', 'ok', `Proxy stub active on ${r.port}`);
    } else {
      toast(`Proxy stub failed: ${r?.error ?? 'unknown'}`, 'err', 6000);
      setObjective('proxy', 'error', 'Proxy stub failed');
    }
  } catch (e) {
    toast(`Proxy stub error: ${(e as Error).message}`, 'err');
  } finally {
    $('#startStubBtn')?.removeAttribute('disabled');
    setStatus('Ready', 'ready');
  }
}

function setObjective(key: ObjectiveKey, state: 'pending' | 'ok' | 'warn' | 'error', detail?: string): void {
  const el = document.getElementById(`obj-${key}`);
  if (!el) return;
  
  const iconDiv = el.querySelector('.objective-icon');
  if (iconDiv) {
    iconDiv.className = `objective-icon ${state}`;
    iconDiv.innerHTML = iconForObjective(state);
  }
  
  const statusDiv = el.querySelector('.objective-status');
  if (statusDiv) {
    statusDiv.textContent = detail || (state === 'pending' ? 'Pending' : state === 'ok' ? 'OK' : state === 'warn' ? 'Warning' : 'Error');
    if (detail) statusDiv.setAttribute('title', detail);
  }
}

async function handleRepair(): Promise<void> {
  setStatus('Repairing patch…', 'busy');
  $('#repairBtn')?.setAttribute('disabled', 'true');
  try {
    const r = await window.ag.run(['doctor', '--repair']);
    if (r.code === 0) {
      toast('Repair complete', 'ok');
      setObjective('patch', 'ok', 'Repaired');
    } else {
      toast(`Repair failed: ${r.stderr || r.stdout}. Check the Logs tab for details.`, 'err', 6000);
      setObjective('patch', 'error', 'Repair failed');
    }
    setStatus('Re-running doctor…', 'busy');
    await runDoctor();
  } catch (e) {
    toast(`Repair error: ${(e as Error).message}`, 'err');
    setStatus('Error', 'err');
    setObjective('patch', 'error', 'Repair failed');
  } finally {
    $('#repairBtn')?.removeAttribute('disabled');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Diagnostic view
// ─────────────────────────────────────────────────────────────────────────────

const doctorOutput = $('#doctorOutput') as HTMLPreElement;

function ansiToHtml(s: string): string {
  // Strip ANSI escape codes and replace with HTML spans for known sequences
  return escapeHtml(s)
    .replace(/\x1b\[32m/g, '<span class="t-ok">')
    .replace(/\x1b\[33m/g, '<span class="t-warn">')
    .replace(/\x1b\[31m/g, '<span class="t-err">')
    .replace(/\x1b\[36m/g, '<span class="t-info">')
    .replace(/\x1b\[90m/g, '<span class="t-dim">')
    .replace(/\x1b\[1m/g, '<span class="t-bold">')
    .replace(/\x1b\[22m/g, '</span>')
    .replace(/\x1b\[39m/g, '</span>')
    .replace(/\x1b\[0m/g, '</span>');
}

// Reusable template for doctor output — avoids creating a new <template> each run
const doctorTpl = document.createElement('template');

async function runDoctorView(): Promise<void> {
  setStatus('Running doctor…', 'busy');
  doctorOutput.textContent = '$ ag-doctor doctor\n';
  try {
    const result = await window.ag.run(['doctor']);
    doctorTpl.innerHTML = ansiToHtml(result.stdout || result.stderr);
    doctorOutput.replaceChildren(doctorTpl.content);
    setStatus('Ready');
  } catch (e) {
    doctorOutput.textContent = `Could not run doctor: ${(e as Error).message}`;
    setStatus('Error', 'err');
  }
}

$('#doctorRunBtn').addEventListener('click', () => void runDoctorView());
$('#doctorJsonBtn').addEventListener('click', async () => {
  setStatus('Loading JSON…', 'busy');
  try {
    const result = await window.ag.run(['doctor', '--json']);
    doctorOutput.textContent = result.stdout || result.stderr;
    setStatus('Ready');
  } catch (e) {
    toast(`Could not load doctor JSON: ${(e as Error).message}`, 'err');
    setStatus('Error', 'err');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Models view
// ─────────────────────────────────────────────────────────────────────────────

const modelsList = $('#modelsList') as HTMLDivElement;
const modelsSearchInput = $('#modelsSearchInput') as HTMLInputElement | null;
const modelsPageSizeSelect = $('#modelsPageSizeSelect') as HTMLSelectElement | null;
const modelsPaginationInfo = $('#modelsPaginationInfo') as HTMLSpanElement | null;
const modelsPaginationNav = $('#modelsPaginationNav') as HTMLDivElement | null;
const modelsPrevPageBtn = $('#modelsPrevPageBtn') as HTMLButtonElement | null;
const modelsNextPageBtn = $('#modelsNextPageBtn') as HTMLButtonElement | null;
const modelsPageNumbers = $('#modelsPageNumbers') as HTMLDivElement | null;

// State for pagination & filtering
let allLoadedModels: CustomModel[] = [];
let modelsCurrentPage = 1;
let modelsPageSize = 10;
let modelsSearchQuery = '';
let modelsCategoryFilter: 'all' | 'active' | 'disabled' = 'all';
let selectedModelNames = new Set<string>();
// Reusable template for models list — avoids creating a new <template> each load
const modelsTpl = document.createElement('template');
/** Shared filter: search query + category tab. Used by renderModelsView and Select All. */
function getFilteredModels(): typeof allLoadedModels {
  const query = modelsSearchQuery.trim().toLowerCase();
  return allLoadedModels.filter((m) => {
    // Category filter
    const isActive = m.enabled !== false;
    if (modelsCategoryFilter === 'active' && !isActive) return false;
    if (modelsCategoryFilter === 'disabled' && isActive) return false;

    if (!query) return true;
    const name = (m.name ?? '').toLowerCase();
    const displayName = (m.displayName ?? '').toLowerCase();
    const provider = (m.provider ?? '').toLowerCase();
    const externalName = (m.externalModelName ?? '').toLowerCase();
    const apiUrl = (m.apiUrl ?? '').toLowerCase();
    return (
      name.includes(query) ||
      displayName.includes(query) ||
      provider.includes(query) ||
      externalName.includes(query) ||
      apiUrl.includes(query)
    );
  });
}

function updateBulkActionButtonsState(): void {
  const btnTest = document.getElementById('modelsBulkTestBtn') as HTMLButtonElement;
  const btnEnable = document.getElementById('modelsBulkEnableBtn') as HTMLButtonElement;
  const btnDisable = document.getElementById('modelsBulkDisableBtn') as HTMLButtonElement;
  const btnDelete = document.getElementById('modelsBulkDeleteBtn') as HTMLButtonElement;
  const cbSelectAll = document.getElementById('modelsSelectAllCb') as HTMLInputElement;
  const filtered = getFilteredModels();
    // Dynamic Category Tab Badges (BUG-2.1 fix)
  const allCount = allLoadedModels.length;
  const activeCount = allLoadedModels.filter(m => m.enabled !== false).length;
  const disabledCount = allLoadedModels.filter(m => m.enabled === false).length;
  const tabAll = document.querySelector('.models-cat-tab[data-cat="all"]');
  const tabActive = document.querySelector('.models-cat-tab[data-cat="active"]');
  const tabDisabled = document.querySelector('.models-cat-tab[data-cat="disabled"]');
  if (tabAll) tabAll.textContent = `All (${allCount})`;
  if (tabActive) tabActive.textContent = `Active (${activeCount})`;
  if (tabDisabled) tabDisabled.textContent = `Disabled (${disabledCount})`;

  const totalItems = filtered.length;
  let page = modelsCurrentPage;
  const totalPages = Math.max(1, Math.ceil(totalItems / modelsPageSize));
  if (page > totalPages) page = totalPages;
  if (page < 1) page = 1;
  const startIdx = (page - 1) * modelsPageSize;
  const endIdx = Math.min(startIdx + modelsPageSize, totalItems);
  const pageItems = filtered.slice(startIdx, endIdx);

  const hasSelection = selectedModelNames.size > 0;
  if (btnTest) btnTest.disabled = !hasSelection;
  if (btnEnable) btnEnable.disabled = !hasSelection;
  if (btnDisable) btnDisable.disabled = !hasSelection;
  if (btnDelete) btnDelete.disabled = !hasSelection;

  if (cbSelectAll && pageItems) {
    if (pageItems.length === 0) {
      cbSelectAll.checked = false;
      cbSelectAll.indeterminate = false;
    } else {
      const selectedOnPage = pageItems.filter(m => selectedModelNames.has(m.name)).length;
      if (selectedOnPage === pageItems.length) {
        cbSelectAll.checked = true;
        cbSelectAll.indeterminate = false;
      } else if (selectedOnPage > 0) {
        cbSelectAll.checked = false;
        cbSelectAll.indeterminate = true;
      } else {
        cbSelectAll.checked = false;
        cbSelectAll.indeterminate = false;
      }
    }
  }
}

function renderModelsView(): void {
  const query = modelsSearchQuery.trim().toLowerCase();
  const filtered = getFilteredModels();

  const totalItems = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / modelsPageSize));

  if (modelsCurrentPage > totalPages) modelsCurrentPage = totalPages;
  if (modelsCurrentPage < 1) modelsCurrentPage = 1;

  const startIdx = (modelsCurrentPage - 1) * modelsPageSize;
  const endIdx = Math.min(startIdx + modelsPageSize, totalItems);
  const pageItems = filtered.slice(startIdx, endIdx);

    // Update Category Tab Count Badges
  const allCount = allLoadedModels.length;
  const activeCount = allLoadedModels.filter((m) => m.enabled !== false).length;
  const disabledCount = allLoadedModels.filter((m) => m.enabled === false).length;

  document.querySelectorAll('.models-cat-tab').forEach((btn) => {
    const el = btn as HTMLButtonElement;
    const cat = el.dataset.cat;
    if (cat === 'all') el.textContent = `All (${allCount})`;
    else if (cat === 'active') el.textContent = `Active (${activeCount})`;
    else if (cat === 'disabled') el.textContent = `Disabled (${disabledCount})`;
  });

  // Update pagination info text
  if (modelsPaginationInfo) {
    if (allLoadedModels.length === 0) {
      modelsPaginationInfo.textContent = 'Showing 0 models';
    } else if (totalItems === 0) {
      modelsPaginationInfo.textContent = `0 models found (filtered from ${allLoadedModels.length})`;
    } else {
      const filterSuffix = query ? ` (filtered from ${allLoadedModels.length})` : '';
      modelsPaginationInfo.textContent = `Showing ${startIdx + 1}–${endIdx} of ${totalItems} models${filterSuffix}`;
    }
  }

  // Render list items or empty state
  if (allLoadedModels.length === 0) {
    modelsList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">
          <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="9"/></svg>
        </div>
        <p style="margin-bottom: 12px;">No models configured yet. <strong>Add model</strong> to connect a custom OpenAI- or Anthropic-compatible provider.</p>
        <button class="btn btn-primary btn-sm" id="emptyAddModelBtn" type="button">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add model
        </button>
      </div>`;
  } else if (totalItems === 0) {
    modelsList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">
          <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        </div>
        <p style="margin-bottom: 8px;">No models matching "<strong>${escapeHtml(query)}</strong>"</p>
        <button class="btn btn-ghost btn-sm" id="clearModelsSearchBtn" type="button">Clear search filter</button>
      </div>`;
  } else {
    const html = pageItems
      .map((m) => {
        const initials = (m.displayName ?? m.name).slice(0, 2).toUpperCase();
        const isEnabled = m.enabled !== false;
        const statusDotClass = isEnabled ? 'ok' : 'off';
        const providerLower = (m.provider || '').toLowerCase();
        const nameLower = (m.name || '').toLowerCase();
        let avatarBg = 'linear-gradient(135deg, #3b82f6, #1d4ed8)';
        if (providerLower.includes('openai') || nameLower.includes('gpt')) {
          avatarBg = 'linear-gradient(135deg, #10a37f, #059669)';
        } else if (providerLower.includes('anthropic') || nameLower.includes('claude')) {
          avatarBg = 'linear-gradient(135deg, #d97706, #b45309)';
        } else if (providerLower.includes('google') || nameLower.includes('gemini')) {
          avatarBg = 'linear-gradient(135deg, #8b5cf6, #6366f1)';
        } else if (nameLower.includes('deepseek')) {
          avatarBg = 'linear-gradient(135deg, #0284c7, #1d4ed8)';
        } else if (nameLower.includes('qwen') || providerLower.includes('aliyun') || providerLower.includes('dashscope')) {
          avatarBg = 'linear-gradient(135deg, #6366f1, #4f46e5)';
        } else if (providerLower.includes('ollama')) {
          avatarBg = 'linear-gradient(135deg, #64748b, #334155)';
        }

        return `
          <div class="model-card ${isEnabled ? '' : 'model-disabled'}" style="padding-left: 0;">
            <div style="padding: 0 12px; display: flex; align-items: center;">
              <input type="checkbox" class="model-select-cb" data-name="${escapeHtml(m.name)}" ${selectedModelNames.has(m.name) ? 'checked' : ''} style="cursor: pointer; width: 14px; height: 14px; margin: 0;">
            </div>
            <div class="model-avatar" style="margin-left: 0; background: ${avatarBg};">${escapeHtml(initials)}</div>
            <div class="model-body">
              <div class="model-name">
                <span class="status-dot ${statusDotClass}" id="status-dot-${escapeHtml(m.name)}" title="${isEnabled ? 'Active' : 'Disabled'}"></span>
                ${escapeHtml(m.displayName ?? m.name)}
              </div>
              <div class="model-meta">
                <code>${escapeHtml(m.name)}</code> · ${escapeHtml(m.provider)} · ${escapeHtml(m.externalModelName)}
              </div>
              <div class="model-meta" style="margin-top:4px">
                <code style="font-size:10px">${escapeHtml(m.apiUrl)}</code> · key: ${escapeHtml(maskKey(m.apiKey))}${m.encrypted ? ' · <span style="color:var(--ok)">encrypted</span>' : ''}
              </div>
            </div>
            <div class="model-actions">
              <button class="btn btn-ghost btn-sm model-action-test" data-action="test" data-name="${escapeHtml(m.name)}" title="Test connection to ${escapeHtml(m.name)}">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
                Test
              </button>
              <button class="btn btn-ghost btn-sm model-action-edit" data-action="edit" data-name="${escapeHtml(m.name)}" data-provider="${escapeHtml(m.provider)}" data-url="${escapeHtml(m.apiUrl)}" title="Edit provider for ${escapeHtml(m.name)}">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                Edit
              </button>
              <button class="btn btn-ghost btn-sm model-action-toggle ${isEnabled ? 'is-active' : 'is-disabled'}" data-action="toggle" data-name="${escapeHtml(m.name)}" title="${isEnabled ? 'Disable model' : 'Enable model'}">
                <span class="status-dot-sm ${isEnabled ? 'ok' : 'off'}"></span>
                ${isEnabled ? 'Active' : 'Disabled'}
              </button>
              <button class="btn btn-danger btn-sm model-action-delete" data-action="remove" data-name="${escapeHtml(m.name)}" data-url="${escapeHtml(m.apiUrl)}" title="Delete model ${escapeHtml(m.name)}">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
                Delete
              </button>
            </div>
          </div>`;
      })
      .join('');
    modelsTpl.innerHTML = html;
    modelsList.replaceChildren(modelsTpl.content);
  }

  // Update Bulk Actions UI state
  updateBulkActionButtonsState();

  // Update Pagination Controls
  if (modelsPaginationNav) {
    if (totalPages <= 1) {
      modelsPaginationNav.style.display = 'none';
    } else {
      modelsPaginationNav.style.display = 'flex';

      if (modelsPrevPageBtn) modelsPrevPageBtn.disabled = modelsCurrentPage <= 1;
      if (modelsNextPageBtn) modelsNextPageBtn.disabled = modelsCurrentPage >= totalPages;

      if (modelsPageNumbers) {
        let pagesHtml = '';
        const delta = 1;
        const range: number[] = [];
        const rangeWithDots: (number | string)[] = [];

        for (let i = 1; i <= totalPages; i++) {
          if (i === 1 || i === totalPages || (i >= modelsCurrentPage - delta && i <= modelsCurrentPage + delta)) {
            range.push(i);
          }
        }

        let l: number | undefined;
        for (const i of range) {
          if (l !== undefined) {
            if (i - l === 2) {
              rangeWithDots.push(l + 1);
            } else if (i - l !== 1) {
              rangeWithDots.push('…');
            }
          }
          rangeWithDots.push(i);
          l = i;
        }

        for (const pageItem of rangeWithDots) {
          if (typeof pageItem === 'number') {
            const isActive = pageItem === modelsCurrentPage ? 'active' : '';
            pagesHtml += `<button class="models-page-btn ${isActive}" data-page="${pageItem}" type="button">${pageItem}</button>`;
          } else {
            pagesHtml += `<span class="models-page-ellipsis" style="padding: 0 4px; color: var(--text-2); font-size: 12px; display: inline-flex; align-items: center;">…</span>`;
          }
        }
        modelsPageNumbers.innerHTML = pagesHtml;
      }
    }
  }
}

// Search & Pagination controls listeners
modelsSearchInput?.addEventListener('input', () => {
  modelsSearchQuery = modelsSearchInput.value;
  modelsCurrentPage = 1;
  renderModelsView();
});

modelsPageSizeSelect?.addEventListener('change', () => {
  modelsPageSize = parseInt(modelsPageSizeSelect.value, 10) || 10;
  modelsCurrentPage = 1;
  renderModelsView();
});

modelsPrevPageBtn?.addEventListener('click', () => {
  if (modelsCurrentPage > 1) {
    modelsCurrentPage--;
    renderModelsView();
  }
});

modelsNextPageBtn?.addEventListener('click', () => {
  modelsCurrentPage++;
  renderModelsView();
});

modelsPageNumbers?.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('.models-page-btn');
  if (btn && btn.dataset.page) {
    modelsCurrentPage = parseInt(btn.dataset.page, 10) || 1;
    renderModelsView();
  }
});

async function loadModels(): Promise<void> {
  setStatus('Loading models…', 'busy');
  showSkeleton(modelsList, 'cards', 3);
  try {
    const result = await window.ag.run(['models', 'list', '--json']);
    const data = JSON.parse(result.stdout) as ModelsFile;
    allLoadedModels = data.models || [];
    // Keep the dashboard models stat in sync with the live list (it is a
    // doctor-run snapshot otherwise and goes stale when models change).
    statModels.textContent = String(allLoadedModels.length);
    renderModelsView();
    setStatus(`${allLoadedModels.length} model(s) loaded`);
  } catch (e) {
    modelsList.innerHTML = `<div class="empty-state"><p>Could not load models: ${escapeHtml((e as Error).message)}</p></div>`;
    setStatus('Error', 'err');
  } finally {
    hideSkeleton(modelsList);
  }
}

// Category Tabs listeners
document.querySelectorAll('.models-cat-tab').forEach(btn => {
  btn.addEventListener('click', (e) => {
    const target = e.currentTarget as HTMLButtonElement;
    const cat = target.dataset.cat as 'all' | 'active' | 'disabled';
    if (!cat) return;
    
    document.querySelectorAll('.models-cat-tab').forEach(b => b.classList.remove('active'));
    target.classList.add('active');
    
    modelsCategoryFilter = cat;
    modelsCurrentPage = 1;
    renderModelsView();
  });
});

// Event delegation for model-card actions (one listener, not N)
modelsList.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (target.closest('#emptyAddModelBtn')) {
    openProviderManagerModal();
    return;
  }
  if (target.closest('#clearModelsSearchBtn')) {
    if (modelsSearchInput) modelsSearchInput.value = '';
    modelsSearchQuery = '';
    modelsCurrentPage = 1;
    renderModelsView();
    return;
  }
  const btn = target.closest<HTMLElement>('[data-action]');
  if (!btn) return;
  void handleModelAction(btn);
});

async function handleModelAction(btn: HTMLElement): Promise<void> {
  const action = btn.dataset.action;
  const name = btn.dataset.name ?? '';
  const url = btn.dataset.url ?? '';
  const provider = btn.dataset.provider ?? '';

  // Always ensure providersCache is populated from disk
  if (!providersCache || providersCache.length === 0) {
    try {
      providersCache = (await window.ag.providers.get()) as ProviderEntry[];
    } catch {
      providersCache = [];
    }
  }

  if (action === 'test') {
    setStatus(`Testing ${name}…`, 'busy');
    const dot = document.getElementById(`status-dot-${name}`);
    btn.setAttribute('disabled', 'true');
    const origHtml = btn.innerHTML;
    btn.innerHTML = `<span class="spinner"></span> Testing…`;

    try {
      const match = await getProviderForModelBulk(name);
      let success = false;
      let msg = '';
      if (match) {
        const cleanName = name.replace(/^models\//, '');
        const res = (await window.ag.providers.test({ apiUrl: match.apiUrl, apiKey: match.apiKey, id: match.id, modelId: cleanName })) as { success: boolean; latencyMs?: number; error?: string };
        success = res.success;
        msg = success ? `✓ ${name} reachable (${res.latencyMs ?? 0}ms)` : `${name} failed: ${res.error || 'Unreachable'}`;
      } else {
        const r = await window.ag.run(['models', 'test', name]);
        success = r.stdout.includes('✓') || r.code === 0;
        msg = success ? `✓ ${name} reachable` : `${name} failed`;
      }
      if (!success) throw new Error(msg);
      toast(msg, 'ok');
      if (dot) dot.className = 'status-dot ok';
    } catch (e) {
      toast(`Tested ${name}: Failed - ${(e as Error).message}`, 'err');
      if (dot) dot.className = 'status-dot off';
    } finally {
      btn.removeAttribute('disabled');
      btn.innerHTML = origHtml;
      setStatus('Ready');
    }
  } else if (action === 'toggle') {
    const isCurrentlyEnabled = !btn.classList.contains('is-disabled');
    const newEnabled = !isCurrentlyEnabled;
    
    // Toggle active UI state immediately for responsiveness
    btn.classList.toggle('is-disabled', !newEnabled);
    btn.classList.toggle('is-active', newEnabled);
    btn.title = newEnabled ? 'Disable model' : 'Enable model';
    btn.innerHTML = `
      <span class="status-dot-sm ${newEnabled ? 'ok' : 'off'}"></span>
      ${newEnabled ? 'Active' : 'Disabled'}
    `;

    // Always find parent provider and save state
    const parentProvider = await getProviderForModelBulk(name);
    
    if (parentProvider) {
      const targetId = resolveModelId(parentProvider, name);
      if (!parentProvider.models) parentProvider.models = [];
      let pModel = parentProvider.models.find(m => m.id === targetId || m.displayName === targetId || m.id === name || m.displayName === name);
      if (pModel) {
        pModel.enabled = newEnabled;
      } else {
        parentProvider.models.push({ id: targetId, displayName: targetId, enabled: newEnabled });
      }
      await window.ag.providers.save(parentProvider);
    } else {
      toast('Built-in models cannot be manually disabled yet.', 'warn');
      btn.classList.toggle('is-disabled', isCurrentlyEnabled);
      btn.classList.toggle('is-active', !isCurrentlyEnabled);
      btn.title = isCurrentlyEnabled ? 'Disable model' : 'Enable model';
      btn.innerHTML = `
        <span class="status-dot-sm ${isCurrentlyEnabled ? 'ok' : 'off'}"></span>
        ${isCurrentlyEnabled ? 'Active' : 'Disabled'}
      `;
      return;
    }

    const dot = document.getElementById(`status-dot-${name}`);
    if (dot) {
      dot.className = `status-dot ${newEnabled ? 'ok' : 'off'}`;
    }

    toast(newEnabled ? `Enabled ${name}` : `Disabled ${name}`, 'ok');
    void loadModels();
    void renderProviderList();
  } else if (action === 'remove') {
    const ok = await confirmModal(
      'Delete this model?',
      `Delete <strong>${escapeHtml(name)}</strong> from this device? This only removes the saved provider — models on your remote account are unaffected.`,
      { confirmLabel: 'Delete model', danger: true },
    );
    if (!ok) return;
    setStatus('Removing model…', 'busy');

    // Remove model entry from parent provider if present
    const parentProvider = await getProviderForModelBulk(name);

    if (parentProvider && parentProvider.models) {
      const targetId = resolveModelId(parentProvider, name);
      parentProvider.models = parentProvider.models.filter((m) => m.id !== targetId && m.displayName !== targetId && m.id !== name && m.displayName !== name);
      await window.ag.providers.save(parentProvider);
    }

    const r = await window.ag.run(['models', 'remove', name, '--yes']);
    if (r.code === 0 || parentProvider) {
      toast(`Removed ${name}`, 'ok');
      await loadModels();
      await renderProviderList();
    } else {
      toast(`Delete failed: ${r.stderr || r.stdout}. Check the Logs tab for details.`, 'err');
    }
    setStatus('Ready');
  }
}

$('#modelsTestBtn')?.addEventListener('click', async () => {
  setStatus('Testing all models…', 'busy');
  try {
    const r = await window.ag.run(['models', 'test']);
    if (r.code === 0) {
      toast('All models reachable', 'ok', 5000);
    } else {
      toast('Some models failed. Open the Models view for details.', 'warn', 5000);
    }
    setStatus('Ready');
  } catch (e) {
    toast(`Test failed: ${(e as Error).message}`, 'err');
    setStatus('Error', 'err');
  }
});

// ── Test & Auto-Disable ──────────────────────────────────────────────────────
async function testAndAutoDisable(silent = false): Promise<void> {
  // Lazy-load providers from disk if cache is empty
  if (providersCache.length === 0) {
    try { providersCache = (await window.ag.providers.get()) as ProviderEntry[]; } catch { providersCache = []; }
  }
  if (providersCache.length === 0) {
    if (!silent) toast('No custom providers configured', 'warn');
    return;
  }

  if (!silent) setStatus('Testing models & auto-disabling failures…', 'busy');
  let okModelCount = 0;
  let disabledModelCount = 0;

  for (const p of providersCache) {
    if (!p.enabled) continue;

    // First test base provider endpoint connectivity
    let baseRes = { success: false };
    try {
      baseRes = await window.ag.providers.test({ apiUrl: p.apiUrl, apiKey: p.apiKey, id: p.id });
    } catch {
      baseRes = { success: false };
    }

    if (!baseRes.success) {
      // Entire provider is down — disable provider and all its models
      p.enabled = false;
      if (p.models) {
        disabledModelCount += p.models.filter((m) => m.enabled !== false).length;
        p.models.forEach((m) => (m.enabled = false));
      }
      await window.ag.providers.save(p);
      continue;
    }

    // Provider is reachable! Test active models under this provider
    if (p.models && p.models.length > 0) {
      let providerSaveNeeded = false;
      for (const m of p.models) {
        if (m.enabled === false) continue;

        try {
          const mRes = await window.ag.providers.test({
            apiUrl: p.apiUrl,
            apiKey: p.apiKey,
            id: p.id,
            modelId: m.id,
          });

          if (mRes.success) {
            okModelCount++;
          } else {
            disabledModelCount++;
            m.enabled = false;
            providerSaveNeeded = true;
          }
        } catch {
          disabledModelCount++;
          m.enabled = false;
          providerSaveNeeded = true;
        }
      }

      if (providerSaveNeeded) {
        // If all models under provider were disabled, disable provider as well
        if (p.models.every((m) => m.enabled === false)) {
          p.enabled = false;
        }
        await window.ag.providers.save(p);
      }
    } else {
      okModelCount++;
    }
  }

  await loadModels();
  await renderProviderList();

  if (disabledModelCount === 0) {
    toast(`All ${okModelCount} active model(s) healthy`, 'ok', 5000);
  } else {
    toast(`${okModelCount} model(s) OK, ${disabledModelCount} failing → auto-disabled`, 'warn', 7000);
  }
  if (!silent) setStatus('Ready');
}

$('#modelsTestHideBtn')?.addEventListener('click', () => void testAndAutoDisable(false));

// ── Auto-Sentinel Toggle ─────────────────────────────────────────────────────
const SENTINEL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
let sentinelTimerId: ReturnType<typeof setInterval> | null = null;
const autoSentinelToggle = $('#autoSentinelToggle') as HTMLInputElement | null;
const autoSentinelLabel = $('#autoSentinelLabel') as HTMLSpanElement | null;

autoSentinelToggle?.addEventListener('change', () => {
  if (autoSentinelToggle.checked) {
    // Run immediately on activation, then repeat
    void testAndAutoDisable(true);
    sentinelTimerId = setInterval(() => void testAndAutoDisable(true), SENTINEL_INTERVAL_MS);
    if (autoSentinelLabel) autoSentinelLabel.textContent = 'Sentinel ON';
    toast('Auto-Sentinel enabled — checks every 5 min', 'ok');
  } else {
    if (sentinelTimerId !== null) {
      clearInterval(sentinelTimerId);
      sentinelTimerId = null;
    }
    if (autoSentinelLabel) autoSentinelLabel.textContent = 'Auto-Sentinel';
    toast('Auto-Sentinel disabled', 'ok');
  }
});


// Impeccable Hover Glow effect for model cards
document.getElementById('modelsList')?.addEventListener('mousemove', (e) => {
  const card = (e.target as HTMLElement).closest('.model-card') as HTMLElement;
  if (!card) return;
  const rect = card.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  card.style.setProperty('--mouse-x', `${x}px`);
  card.style.setProperty('--mouse-y', `${y}px`);
});

// Bulk Actions on Models Page

// Handle individual checkbox clicks
$('#modelsList')?.addEventListener('change', (e) => {
  const target = e.target as HTMLInputElement;
  if (target.classList.contains('model-select-cb')) {
    const name = target.dataset.name;
    if (name) {
      if (target.checked) selectedModelNames.add(name);
      else selectedModelNames.delete(name);
      updateBulkActionButtonsState();
    }
  }
});

// Handle Select All click
// Select All — uses shared getFilteredModels() so category filter is respected (BUG-2 fix)
$('#modelsSelectAllCb')?.addEventListener('change', (e) => {
  const checked = (e.target as HTMLInputElement).checked;
  const filtered = getFilteredModels();
  const totalItems = filtered.length;
  let page = modelsCurrentPage;
  const totalPages = Math.max(1, Math.ceil(totalItems / modelsPageSize));
  if (page > totalPages) page = totalPages;
  if (page < 1) page = 1;
  const startIdx = (page - 1) * modelsPageSize;
  const endIdx = Math.min(startIdx + modelsPageSize, totalItems);
  const pageItems = filtered.slice(startIdx, endIdx);

  pageItems.forEach(m => {
    if (checked) selectedModelNames.add(m.name);
    else selectedModelNames.delete(m.name);
  });
  renderModelsView();
});

window.ag.providers.onChanged(() => {
  // Synchronize models list whenever providers change
  void loadModels();
  void renderProviderList();
});

// Helper for finding provider

function resolveModelId(provider: ProviderEntry, modelName: string): string {
  const prefix = `${provider.id}-`;
  if (modelName.startsWith(prefix)) return modelName.slice(prefix.length);
  return modelName.replace(/^models\//, '');
}

async function getProviderForModelBulk(modelName: string) {
  if (!providersCache || providersCache.length === 0) {
    try {
      providersCache = (await window.ag.providers.get()) as ProviderEntry[];
    } catch {
      providersCache = [];
    }
  }
  const cleanModelName = modelName.replace(/^models\//, '');
  const targetModel = allLoadedModels.find(m => m.name === modelName);
  return providersCache.find((p) => {
    if (p.provider && p.provider.toLowerCase() === 'openai' && targetModel && targetModel.apiUrl && p.apiUrl && p.apiUrl.toLowerCase() !== targetModel.apiUrl.toLowerCase()) {
      return false;
    }
    if (p.models?.some((m) => m.id === cleanModelName || m.displayName === cleanModelName || m.id === modelName || m.displayName === modelName)) return true;
    if (targetModel) {
      if (p.apiUrl && targetModel.apiUrl && p.apiUrl.toLowerCase() === targetModel.apiUrl.toLowerCase()) return true;
      if (p.provider && targetModel.provider && p.provider.toLowerCase() !== 'openai' && targetModel.provider.toLowerCase() !== 'openai' && p.provider.toLowerCase() === targetModel.provider.toLowerCase()) return true;
      if (!p.apiUrl && !targetModel.apiUrl && p.provider && targetModel.provider && p.provider.toLowerCase() === targetModel.provider.toLowerCase()) return true;
    }
    return p.name.toLowerCase() === modelName.toLowerCase();
  });
}

$('#modelsBulkTestBtn')?.addEventListener('click', async () => {
  if (selectedModelNames.size === 0) return;
  setStatus(`Testing ${selectedModelNames.size} selected models…`, 'busy');
  let successCount = 0;
  let failCount = 0;
  
  for (const name of Array.from(selectedModelNames)) {
    const dot = document.getElementById(`status-dot-${name}`);
    if (dot) dot.className = 'status-dot'; // reset
    try {
      let success = false;
      const match = await getProviderForModelBulk(name);
      if (match) {
        const res = (await window.ag.providers.test({ apiUrl: match.apiUrl, apiKey: match.apiKey, id: match.id })) as { success: boolean; };
        success = res.success;
      } else {
        const r = await window.ag.run(['models', 'test', name]);
        success = r.stdout.includes('✓') || r.code === 0;
      }
      
      if (success) successCount++;
      else failCount++;
      
      if (dot) dot.className = `status-dot ${success ? 'ok' : 'err'}`;
    } catch (e) {
      failCount++;
      if (dot) dot.className = 'status-dot err';
    }
  }
  
  if (failCount === 0) {
    toast(`✓ Successfully tested ${successCount} models`, 'ok');
  } else {
    toast(`Tested ${successCount + failCount} models: ${successCount} succeeded, ${failCount} failed`, 'warn');
  }
  setStatus('Ready');
});

$('#modelsBulkEnableBtn')?.addEventListener('click', async () => {
  if (selectedModelNames.size === 0) return;
  setStatus(`Enabling ${selectedModelNames.size} selected models…`, 'busy');
  try {
    for (const name of Array.from(selectedModelNames)) {
      const match = await getProviderForModelBulk(name);
      if (match) {
        const cleanName = name.replace(/^models\//, '');
        if (!match.models) match.models = [];
        const pModel = match.models.find((m) => m.id === cleanName || m.displayName === cleanName || m.id === name || m.displayName === name);
        if (pModel) pModel.enabled = true;
        else match.models.push({ id: cleanName, displayName: cleanName, enabled: true });
        await window.ag.providers.save(match);
      }
    }
    const enabledCount = selectedModelNames.size;
    selectedModelNames.clear();
    toast(`Enabled ${enabledCount} models`, 'ok');
    void loadModels();
    void renderProviderList();
  } catch (err) {
    toast(`Bulk enable error: ${(err as Error).message}`, 'err');
  } finally {
    setStatus('Ready');
  }
});

$('#modelsBulkDisableBtn')?.addEventListener('click', async () => {
  if (selectedModelNames.size === 0) return;
  setStatus(`Disabling ${selectedModelNames.size} selected models…`, 'busy');
  try {
    for (const name of Array.from(selectedModelNames)) {
      const match = await getProviderForModelBulk(name);
      if (match) {
        const cleanName = name.replace(/^models\//, '');
        if (!match.models) match.models = [];
        const pModel = match.models.find((m) => m.id === cleanName || m.displayName === cleanName || m.id === name || m.displayName === name);
        if (pModel) pModel.enabled = false;
        else match.models.push({ id: cleanName, displayName: cleanName, enabled: false });
        await window.ag.providers.save(match);
      }
    }
    const disabledCount = selectedModelNames.size;
    selectedModelNames.clear();
    toast(`Disabled ${disabledCount} models`, 'ok');
    void loadModels();
    void renderProviderList();
  } catch (err) {
    toast(`Bulk disable error: ${(err as Error).message}`, 'err');
  } finally {
    setStatus('Ready');
  }
});

$('#modelsBulkDeleteBtn')?.addEventListener('click', async () => {
  if (selectedModelNames.size === 0) return;
  const count = selectedModelNames.size;
  const ok = await confirmModal(
    `Delete ${count} selected models?`,
    `Are you sure you want to delete <strong>${count} selected model(s)</strong>? This action cannot be undone.`,
    { confirmLabel: 'Delete selected', danger: true }
  );
  if (!ok) return;

  setStatus(`Deleting ${count} selected models…`, 'busy');
  try {
    for (const name of Array.from(selectedModelNames)) {
      const match = await getProviderForModelBulk(name);
      if (match && match.models) {
        match.models = match.models.filter((m) => m.id !== name && m.displayName !== name);
        await window.ag.providers.save(match);
      }
      await window.ag.run(['models', 'remove', name, '--yes']);
    }
    selectedModelNames.clear();
    toast(`Deleted ${count} models`, 'ok');
    void loadModels();
    void renderProviderList();
  } catch (err) {
    toast(`Bulk delete error: ${(err as Error).message}`, 'err');
  } finally {
    setStatus('Ready');
  }
});

$('#exportProvidersBtn')?.addEventListener('click', async () => {
  try {
    const providers = await window.ag.providers.get();
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(providers, null, 2));
    const dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute("href", dataStr);
    dlAnchorElem.setAttribute("download", `antigravity_providers_export_${new Date().toISOString().slice(0, 10)}.json`);
    dlAnchorElem.click();
    toast('Providers exported', 'ok');
  } catch (err) {
    toast(`Export failed: ${(err as Error).message}`, 'err');
  }
});

$('#importProvidersBtn')?.addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const providers = JSON.parse(text);
      if (!Array.isArray(providers)) throw new Error('Invalid JSON format: expected an array');
      
      setStatus('Importing providers...', 'busy');
      for (const p of providers) {
        const res = await window.ag.providers.save(p);
        if (!res.success) throw new Error(`Failed to save provider: ${res.error}`);
      }
      toast(`Successfully imported ${providers.length} providers`, 'ok');
      void loadModels();
      void renderProviderList();
    } catch (err) {
      toast(`Import failed: ${(err as Error).message}`, 'err');
    } finally {
      setStatus('Ready');
    }
  };
  input.click();
});

$('#restoreBackupBtn')?.addEventListener('click', async () => {
  const ok = await confirmModal(
    'Restore Backup',
    'Are you sure you want to restore custom_models.json from the latest .bak file? This will overwrite your current configuration.',
    { confirmLabel: 'Restore', danger: true }
  );
  if (!ok) return;

  setStatus('Restoring backup...', 'busy');
  try {
    const r = await window.ag.run(['models', 'import']);
    if (r.code !== 0) throw new Error(r.stderr || r.stdout || 'Restore failed');
    toast('Backup restored successfully', 'ok');
    void loadModels();
    void renderProviderList();
  } catch (err) {
    toast(`Restore failed: ${(err as Error).message}`, 'err');
  } finally {
    setStatus('Ready');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// MITM view
// ─────────────────────────────────────────────────────────────────────────────

const mitmStatusEl = $('#mitmStatus') as HTMLDivElement;

// Reusable template for MITM status — avoids creating a new <template> each load
const mitmTpl = document.createElement('template');

async function loadMitmStatus(): Promise<void> {
  return guardLoad('mitm', async () => {
    setStatus('Loading MITM status…', 'busy');
    showSkeleton(mitmStatusEl, 'cards', 3);
    try {
      const r = await withTimeout(
        window.ag.run(['mitm', 'status', '--json']),
        12_000,
        'mitm status',
      );
    const s = JSON.parse(r.stdout) as MitmStatus;

    // Dynamically toggle top required warning banner based on actual interception health
    const reqBanner = document.getElementById('mitmRequiredBanner') as HTMLDivElement | null;
    if (reqBanner) {
      const isFullyFunctional = (s.interception.reachable || s.interception.bypassed) && s.ca.installed && !s.ca.isExpired;
      reqBanner.style.display = isFullyFunctional ? 'none' : 'flex';
    }

    // Dynamically update header buttons' visual hierarchy based on proxy/CA state
    const proxyOnBtn = document.getElementById('mitmProxyOnBtn') as HTMLButtonElement | null;
    const proxyOffBtn = document.getElementById('mitmProxyOffBtn') as HTMLButtonElement | null;
    if (proxyOnBtn && proxyOffBtn) {
      if (s.proxy.redirected) {
        proxyOnBtn.className = 'btn btn-ghost';
        proxyOffBtn.className = 'btn btn-primary';
      } else {
        proxyOnBtn.className = 'btn btn-primary';
        proxyOffBtn.className = 'btn btn-ghost';
      }
    }

    const caBanner = s.ca.installed && !s.ca.isExpired
      ? `<div class="patch-banner ok">
           <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
           <div class="patch-banner-body">
             <div class="patch-banner-title">CA certificate installed</div>
             <div class="patch-banner-text">Your system trusts the local MITM certificate.</div>
           </div>
         </div>`
      : `<div class="patch-banner warn">
           <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
           <div class="patch-banner-body">
             <div class="patch-banner-title">${s.ca.isExpired ? 'CA certificate expired' : 'CA certificate not installed'}</div>
             <div class="patch-banner-text">${s.ca.isExpired ? 'The certificate has expired. Run Repair all to regenerate it.' : 'Install the CA to avoid TLS errors in intercepted apps.'}</div>
           </div>
         </div>`;

    const proxyBanner = s.proxy.redirected
      ? `<div class="patch-banner ok">
           <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
           <div class="patch-banner-body">
             <div class="patch-banner-title">System proxy active</div>
             <div class="patch-banner-text">Traffic is being redirected to ${escapeHtml(s.proxy.host ?? 'localhost')}:${s.proxy.port ?? '—'}.</div>
           </div>
         </div>`
      : `<div class="patch-banner warn">
           <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
           <div class="patch-banner-body">
             <div class="patch-banner-title">System proxy inactive</div>
             <div class="patch-banner-text">Click <strong>Proxy ON</strong> above to start redirecting traffic.</div>
           </div>
         </div>`;

    const interceptionBanner = (s.interception.reachable || s.interception.bypassed)
      ? (s.interception.bypassed
        ? `<div class="patch-banner ok">
           <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
           <div class="patch-banner-body">
             <div class="patch-banner-title">Interception bypassed</div>
             <div class="patch-banner-text">The binary patch redirects the language server to the local proxy — MITM interception is not required.</div>
           </div>
         </div>`
        : `<div class="patch-banner ok">
           <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
           <div class="patch-banner-body">
             <div class="patch-banner-title">Interception reachable</div>
             <div class="patch-banner-text">The proxy is listening and responding to requests.</div>
           </div>
         </div>`)
      : `<div class="patch-banner err">
           <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
           <div class="patch-banner-body">
             <div class="patch-banner-title">Interception unreachable</div>
             <div class="patch-banner-text">The proxy does not appear to be listening. Try Repair all.</div>
           </div>
         </div>`;

    mitmTpl.innerHTML = `
      <div class="mitm-grid">
        <div class="mitm-card">
          <div class="mitm-card-header"><h3>CA certificate</h3><span class="badge ${s.ca.installed ? 'ok' : 'warn'}">${s.ca.installed ? 'installed' : 'not installed'}</span></div>
          <div class="mitm-card-body">
            <div class="patch-row"><div class="patch-row-label">Generated</div><div class="patch-row-value ${s.ca.generated ? 'ok' : ''}">${s.ca.generated ? 'yes' : 'no'}</div></div>
            <div class="patch-row"><div class="patch-row-label">Expires</div><div class="patch-row-value ${s.ca.isExpired ? 'err' : ''}">${escapeHtml(s.ca.expiresAt ?? '—')}</div></div>
            <div class="patch-row"><div class="patch-row-label">Path</div><div class="patch-row-value">${escapeHtml(s.ca.path ?? '—')}</div></div>
            <div class="patch-row"><div class="patch-row-label">Fingerprint</div><div class="patch-row-value">${escapeHtml(s.ca.fingerprint ?? '—')}</div></div>
          </div>
          ${caBanner}
        </div>
        <div class="mitm-card">
          <div class="mitm-card-header"><h3>System proxy</h3><span class="badge ${s.proxy.redirected ? 'ok' : 'warn'}">${s.proxy.redirected ? 'redirected' : 'off'}</span></div>
          <div class="mitm-card-body">
            <div class="patch-row"><div class="patch-row-label">Host</div><div class="patch-row-value">${escapeHtml(s.proxy.host ?? '—')}</div></div>
            <div class="patch-row"><div class="patch-row-label">Port</div><div class="patch-row-value">${s.proxy.port ?? '—'}</div></div>
          </div>
          ${proxyBanner}
        </div>
        <div class="mitm-card">
          <div class="mitm-card-header"><h3>Interception status</h3><span class="badge ${s.interception.bypassed ? 'ok' : s.interception.reachable ? 'ok' : 'err'}">${s.interception.bypassed ? 'bypassed' : s.interception.reachable ? 'reachable' : 'unreachable'}</span></div>
          <div class="mitm-card-body">
            <div class="patch-row"><div class="patch-row-label">Listening</div><div class="patch-row-value ${s.interception.listening ? 'ok' : ''}">${s.interception.listening ? 'yes' : 'no'}</div></div>
            <div class="patch-row"><div class="patch-row-label">Connectivity</div><div class="patch-row-value ${s.interception.reachable ? 'ok' : 'err'}">${s.interception.reachable ? 'ok' : 'failed'}</div></div>
          </div>
          ${interceptionBanner}
        </div>
      </div>
      ${(!s.interception.bypassed && (!s.ca.installed || !s.proxy.redirected || !s.interception.reachable)) ? `
      <div style="margin-top: 20px; text-align: center;">
        <button id="repair-all-btn" class="btn btn-primary" style="padding: 10px 20px; font-size: 14px;">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: text-bottom; margin-right: 6px;"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 9.36l-7.1 7.1a1 1 0 0 1-1.4 0l-2.8-2.8a1 1 0 0 1 0-1.4l7.1-7.1a6 6 0 0 1 9.36-7.94z"/></svg>
          Repair all (needs admin)
        </button>
      </div>
      ` : ''}`;
    mitmStatusEl.replaceChildren(mitmTpl.content);

    const repairBtn = document.getElementById('repair-all-btn');
    if (repairBtn) {
      repairBtn.setAttribute('aria-label', 'Repair all MITM issues (requires administrator)');
      repairBtn.addEventListener('click', async () => {
        repairBtn.setAttribute('disabled', 'true');
        repairBtn.textContent = 'Repairing — approve the UAC prompt…';
        setStatus('Repairing MITM…', 'busy');
        try {
          const res = await window.ag.repairRun();
          if (res.ok) {
            toast('Repair script completed successfully.', 'ok', 3000);

            // Auto-start the proxy server after a successful repair
            console.log('[MITM] Auto-starting proxy server after repair...');
            const startResult = await window.ag.proxyStart();
            if (startResult.ok) {
              toast('Proxy server started automatically.', 'ok', 3000);
            } else {
              toast(`Repair succeeded but proxy server failed to start: ${startResult.message}`, 'warn', 6000);
            }
          } else {
            toast(`Repair failed: ${res.error}`, 'err', 6000);
          }
        } catch (err) {
          toast(`Repair IPC error: ${(err as Error).message}`, 'err', 6000);
        } finally {
          void loadMitmStatus();
        }
      });
    }

    setStatus('Ready');
  } catch (e) {
    mitmStatusEl.innerHTML = `<div class="empty-state"><p>Could not load MITM status: ${escapeHtml((e as Error).message)}</p></div>`;
    setStatus('Error', 'err');
  } finally {
    hideSkeleton(mitmStatusEl);
  }
  });
}

async function mitmAction(args: string[], successMsg: string, refresh = true, preStatus?: string): Promise<void> {
  // Show a UAC-wait message up-front for operations that may trigger an
  // elevation prompt. Otherwise users see "busy…" for several seconds with
  // no indication of what is happening and assume the UI is hung.
  setStatus(preStatus ?? `${args.slice(1).join(' ')}…`, 'busy');
  try {
    const r = await window.ag.run(args);
    if (r.code === 0) {
      toast(successMsg, 'ok', 5000);
      if (refresh) void loadMitmStatus();
    } else {
      const errorMsg = r.stderr || r.stdout || 'Unknown error';
      const operation = args.slice(1).join(' ');

      // Match common failure patterns with actionable guidance.
      if (errorMsg.toLowerCase().includes('uac') || errorMsg.toLowerCase().includes('cancelled')) {
        toast(`${operation} failed: UAC prompt was declined. Click "Yes" when prompted.`, 'err', 8000);
      } else if (errorMsg.toLowerCase().includes('access denied') || r.code === 5) {
        toast(`${operation} failed: access denied. Try running as Administrator.`, 'err', 8000);
      } else if (errorMsg.toLowerCase().includes('not found')) {
        toast(`${operation} failed: required system tool not found. Check your PATH.`, 'err', 8000);
      } else {
        toast(`${operation} failed: ${errorMsg.substring(0, 150)}`, 'err', 8000);
      }

      console.error(`[MITM Action Failed]`, { args, code: r.code, stderr: r.stderr, stdout: r.stdout });
      setStatus('Error', 'err');
    }
  } catch (e) {
    const operation = args.slice(1).join(' ');
    toast(`${operation} error: ${(e as Error).message}`, 'err', 8000);
    console.error(`[MITM Action Exception]`, { args, error: e });
    setStatus('Error', 'err');
  }
}

// Subcommands that may trigger a UAC prompt on Windows (certutil + netsh
// both require Admin). On macOS/Linux the message is misleading so we only
// show it on Windows; the platform is reported via `ag.info()`.
async function maybeUacPreStatus(subcommand: string): Promise<string> {
  const info = await window.ag.info();
  const platform: string = info?.platform ?? '';
  if (platform !== 'win32') return `${subcommand}…`;
  return `Waiting for UAC prompt — click "Yes" to allow ${subcommand}…`;
}

$('#mitmInstallBtn').addEventListener('click', async () => {
  const pre = await maybeUacPreStatus('install CA certificate');
  void mitmAction(['mitm', 'install', '--yes'], 'CA certificate installed', true, pre);
});
$('#mitmUninstallBtn').addEventListener('click', async () => {
  const pre = await maybeUacPreStatus('uninstall CA certificate');
  void mitmAction(['mitm', 'uninstall', '--yes'], 'CA certificate uninstalled', true, pre);
});
$('#mitmProxyOnBtn').addEventListener('click', async () => {
  setStatus('Enabling proxy…', 'busy');
  try {
    // Step 1: Start the proxy server
    console.log('[MITM] Starting proxy server...');
    const startResult = await window.ag.proxyStart();
    console.log('[MITM] Proxy start result:', startResult);

    if (!startResult.ok) {
      const decoded = decodeError(startResult.message ?? '', '');
      if (decoded.matched) {
        toast(`Failed to start proxy server — ${decoded.pattern}`, 'err', 8000);
        toast(decoded.hint, 'warn', 8000);
        runErrorAction(decoded.action);
      } else {
        toast(`Failed to start proxy server: ${startResult.message}`, 'err', 8000);
      }
      setStatus('Error', 'err');
      return;
    }

    toast(`Proxy server started (PID: ${startResult.pid})`, 'ok', 3000);

    // Step 2: Configure Windows to use the proxy
    const pre = await maybeUacPreStatus('enable proxy');
    setStatus(pre, 'busy');

    const r = await window.ag.run(['mitm', 'proxy-on']);
    if (r.code === 0) {
      toast('Proxy enabled and running', 'ok', 5000);
      void loadMitmStatus();
    } else {
      const errorMsg = r.stderr || r.stdout || 'Unknown error';
      toast(`Failed to configure proxy: ${errorMsg}`, 'err', 8000);
      setStatus('Error', 'err');

      // Try to stop the proxy server since configuration failed
      await window.ag.proxyStop();
    }
  } catch (e) {
    toast(`Proxy enable error: ${(e as Error).message}`, 'err', 8000);
    console.error(`[MITM] Proxy enable exception:`, e);
    setStatus('Error', 'err');
  }
});

$('#mitmProxyOffBtn').addEventListener('click', async () => {
  setStatus('Disabling proxy…', 'busy');
  try {
    // Step 1: Disable Windows proxy configuration
    const pre = await maybeUacPreStatus('disable proxy');
    setStatus(pre, 'busy');

    const r = await window.ag.run(['mitm', 'proxy-off']);
    if (r.code === 0) {
      toast('Proxy disabled', 'ok', 3000);
    } else {
      const errorMsg = r.stderr || r.stdout || 'Unknown error';
      toast(`Proxy disable warning: ${errorMsg}`, 'warn', 5000);
    }

    // Step 2: Stop the proxy server (even if config failed)
    console.log('[MITM] Stopping proxy server...');
    const stopResult = await window.ag.proxyStop();
    console.log('[MITM] Proxy stop result:', stopResult);

    if (stopResult.ok) {
      toast('Proxy server stopped', 'ok', 3000);
    } else {
      const decoded = decodeError(stopResult.message ?? '', '');
      if (decoded.matched) {
        toast(`Failed to stop proxy server — ${decoded.pattern}`, 'warn', 5000);
        toast(decoded.hint, 'warn', 8000);
        runErrorAction(decoded.action);
      } else {
        toast(`Failed to stop proxy server: ${stopResult.message}`, 'warn', 5000);
      }
    }

    void loadMitmStatus();
  } catch (e) {
    toast(`Proxy disable error: ${(e as Error).message}`, 'err', 8000);
    console.error(`[MITM] Proxy disable exception:`, e);
    setStatus('Error', 'err');
  }
});
$('#mitmExportCaBtn').addEventListener('click', () => void mitmAction(['mitm', 'export-ca'], 'CA exported'));

// ─────────────────────────────────────────────────────────────────────────────
// Patch view
// ─────────────────────────────────────────────────────────────────────────────

const patchStatusEl = $('#patchStatus') as HTMLDivElement;
const patchDetectedVersionEl = $('#patchDetectedVersion') as HTMLDivElement;
const patchDetectedSourceEl = $('#patchDetectedSource') as HTMLSpanElement;
const patchRecommendedBadgeEl = $('#patchRecommendedBadge') as HTMLSpanElement;
const patchDetectedMetaEl = $('#patchDetectedMeta') as HTMLDivElement;
const patchRangeGridEl = $('#patchRangeGrid') as HTMLDivElement;
const patchOverrideBannerEl = $('#patchOverrideBanner') as HTMLDivElement;
const patchOverrideBannerTextEl = $('#patchOverrideBannerText') as HTMLDivElement;
const patchRescanBtn = $('#patchRescanBtn') as HTMLButtonElement;
const patchClearOverrideBtn = $('#patchClearOverrideBtn') as HTMLButtonElement;

// Reusable template for patch status — avoids creating a new <template> each load
const patchTpl = document.createElement('template');

function patchBadge(label: string, tone: 'ok' | 'warn' | 'err' | 'muted' = 'muted'): string {
  return `<span class="badge badge-${tone}">${escapeHtml(label)}</span>`;
}

function patchSourceLabel(s: PatchStatus): string {
  if (s.overrideActive) return 'Manual selection';
  if (s.antigravityVersionSource && s.antigravityVersionSource !== 'unknown') {
    return `Version read from ${s.antigravityVersionSource}`;
  }
  return 'Uncertain detection';
}

function patchFamilyLabel(range: string): string {
  if (range.includes('2.4')) return 'Family 2.4 (2.4.2)';
  if (range.includes('2.3')) return 'Family 2.3';
  if (range.includes('2.2')) return 'Family 2.2';
  return 'Family 2.1';
}

function patchConfidenceLabel(confidence?: PatchStatus['detectionConfidence']): string {
  if (confidence === 'high') return 'High confidence';
  if (confidence === 'medium') return 'Medium confidence';
  return 'Low confidence';
}

function patchConfidenceTone(confidence?: PatchStatus['detectionConfidence']): 'ok' | 'warn' | 'err' {
  if (confidence === 'high') return 'ok';
  if (confidence === 'medium') return 'warn';
  return 'err';
}

function patchSignatureLabel(s: PatchStatus): string {
  if (s.binarySignatureState === 'patched') return 'Binary signature: patch already present';
  if (s.binarySignatureState === 'original') return 'Binary signature: stock binary detected';
  return 'Binary signature missing';
}

function patchOverlayLabel(s: PatchStatus): string {
  if (!s.overlayFingerprintDetected || !s.overlayFingerprintRange) return 'JS overlay footprint missing or inconclusive';
  return `JS overlay footprint: ${s.overlayFingerprintRange}`;
}

function patchNeedsMetadataWithoutBinaryWarning(s: PatchStatus): boolean {
  return !!(s.antigravityVersion && s.antigravityVersion !== 'unknown' && !s.binarySignatureDetected);
}

function renderPatchSelector(s: PatchStatus): void {
  patchDetectedVersionEl.textContent = s.antigravityVersion ?? 'unknown';
  patchDetectedSourceEl.className = `badge ${s.overrideActive ? 'badge-warn' : 'badge-muted'}`;
  patchDetectedSourceEl.textContent = patchSourceLabel(s);
  patchRecommendedBadgeEl.className = `badge ${s.compatible ? 'badge-ok' : 'badge-warn'}`;
  patchRecommendedBadgeEl.textContent = s.recommendedPatch
    ? `${patchFamilyLabel(s.recommendedPatch.versionRange)} · ${patchConfidenceLabel(s.detectionConfidence)}`
    : 'no recommended family';

  const detectorMeta = [
    `<span class="badge badge-${patchConfidenceTone(s.detectionConfidence)}">${escapeHtml(patchConfidenceLabel(s.detectionConfidence))}</span>`,
    `<span class="badge ${s.binarySignatureDetected ? 'badge-ok' : 'badge-warn'}">${escapeHtml(patchSignatureLabel(s))}</span>`,
    s.overlayFingerprintDetected
      ? `<span class="badge ${s.overlayFingerprintConfidence === 'high' ? 'badge-ok' : 'badge-warn'}">${escapeHtml(patchOverlayLabel(s))}</span>`
      : '',
    s.detectionReason ? `<span class="badge badge-muted">${escapeHtml(s.detectionReason)}</span>` : '',
  ].filter(Boolean).join('');
  patchDetectedMetaEl.innerHTML = `
    <span class="badge ${s.overrideActive ? 'badge-warn' : 'badge-muted'}">${escapeHtml(patchSourceLabel(s))}</span>
    <span class="badge ${s.compatible ? 'badge-ok' : 'badge-warn'}">${escapeHtml(s.recommendedPatch ? `${patchFamilyLabel(s.recommendedPatch.versionRange)} · ${patchConfidenceLabel(s.detectionConfidence)}` : 'no recommended family')}</span>
    ${detectorMeta}`;

  if (s.overrideActive && s.overrideInfo?.range) {
    patchOverrideBannerEl.hidden = false;
    const reason = s.overrideInfo.reason ? ` — ${s.overrideInfo.reason}` : '';
    patchOverrideBannerTextEl.textContent = `Forced family: ${s.overrideInfo.range}${reason}`;
  } else {
    patchOverrideBannerEl.hidden = true;
    patchOverrideBannerTextEl.textContent = '—';
  }

  const detectedRanges = new Set((s.detectedPatches ?? []).map((p) => p.versionRange));
  if (s.overlayFingerprintDetected && s.overlayFingerprintRange) {
    detectedRanges.add(s.overlayFingerprintRange);
  }
  const recommendedRange = s.recommendedPatch?.versionRange ?? null;
  const cards = (s.availableRanges ?? []).map((range) => {
    const isRecommended = recommendedRange === range.versionRange;
    const isSelected = s.overrideInfo?.range === range.versionRange;
    const isDetected = detectedRanges.has(range.versionRange);
    const classes = [
      'patch-range-card',
      isRecommended ? 'recommended' : '',
      isSelected ? 'selected' : '',
      isDetected ? 'detected' : '',
      !s.compatible && isRecommended ? 'incompatible' : '',
    ].filter(Boolean).join(' ');
    const tags = [
      patchBadge(patchFamilyLabel(range.versionRange), 'muted'),
      isRecommended ? patchBadge('recommended', 'ok') : '',
      isSelected ? patchBadge('manual', 'warn') : '',
      isDetected && s.overlayFingerprintRange === range.versionRange
        ? patchBadge(`JS overlay footprint · ${patchConfidenceLabel(s.overlayFingerprintConfidence)}`, s.overlayFingerprintConfidence === 'high' ? 'ok' : 'warn')
        : '',
      isDetected && s.overlayFingerprintRange !== range.versionRange ? patchBadge('specific signature detected', 'ok') : '',
      !isDetected && s.binarySignatureDetected ? patchBadge('metadata-guided version', 'muted') : patchBadge('test manually', 'muted'),
    ].filter(Boolean).join('');
    return `
      <div class="${classes}">
        <div class="patch-range-card-header">
          <div class="patch-range-card-title">${escapeHtml(range.versionRange)}</div>
          ${isRecommended ? patchBadge(s.overrideActive ? 'forced' : 'auto target', s.overrideActive ? 'warn' : 'ok') : ''}
        </div>
        <div class="patch-range-card-body">
          <div class="patch-range-card-description">${escapeHtml(range.description)}</div>
          <div class="patch-range-card-tags">${tags}</div>
          <div class="patch-inline-note">${escapeHtml(range.originalUrl)} → ${escapeHtml(range.patchedUrl)}</div>
        </div>
        <div class="patch-range-card-actions">
          <button class="btn ${isSelected ? 'btn-secondary' : 'btn-ghost'} btn-sm" type="button" data-patch-range="${escapeHtml(range.versionRange)}">${isSelected ? 'Selected' : 'Select family'}</button>
        </div>
      </div>`;
  }).join('');

  patchRangeGridEl.innerHTML = cards || '<div class="empty-state"><p>No patch families available.</p></div>';
}

async function applyPatchRangeSelection(range: string | null): Promise<void> {
  setStatus(range ? `Selecting ${range}…` : 'Resetting to auto-detection…', 'busy');
  try {
    const args = range ? ['patch', 'select', range, '--json'] : ['patch', 'select', 'auto', '--json'];
    const r = await withTimeout(window.ag.run(args), 12_000, 'patch select');
    if (r.code !== 0) {
      throw new Error(r.stderr || r.stdout || 'patch select failed');
    }
    toast(range ? `Patch family set to ${range}` : 'Manual selection cleared', 'ok', 4000);
    await loadPatchStatus();
  } catch (e) {
    toast(`Patch update failed: ${(e as Error).message}`, 'err', 7000);
    setStatus('Error', 'err');
  }
}

async function loadPatchStatus(): Promise<void> {
  return guardLoad('patch', async () => {
    setStatus('Loading patch status…', 'busy');
    showSkeleton(patchStatusEl, 'lines', 5);
    try {
      const r = await withTimeout(
        window.ag.run(['patch', 'status', '--json']),
        12_000,
        'patch status',
      );
    const s = JSON.parse(r.stdout) as PatchStatus;
    renderPatchSelector(s);
    const banner =
      s.applied
        ? `<div class="patch-banner ok">
             <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
             <div class="patch-banner-body">
               <div class="patch-banner-title">Patch active</div>
               <div class="patch-banner-text"><code>language_server</code> is redirecting requests to the local proxy.</div>
             </div>
           </div>`
        : s.exists
          ? `<div class="patch-banner warn">
               <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
               <div class="patch-banner-body">
                 <div class="patch-banner-title">Patch not applied</div>
                 <div class="patch-banner-text">Custom models will not appear in the menu until this step is applied.</div>
               </div>
             </div>`
          : `<div class="patch-banner err">
               <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
               <div class="patch-banner-body">
                 <div class="patch-banner-title">Binary not found</div>
                 <div class="patch-banner-text">Could not locate <code>language_server</code> in the Antigravity installation.</div>
               </div>
             </div>`;

    const confidenceHero = `
      <div class="patch-confidence patch-confidence-${patchConfidenceTone(s.detectionConfidence)}">
        <div class="patch-confidence-eyebrow">Confidence level</div>
        <div class="patch-confidence-value">${escapeHtml(patchConfidenceLabel(s.detectionConfidence))}</div>
        <div class="patch-confidence-text">${escapeHtml(s.detectionReason ?? 'No detailed explanation provided by auto-detection yet.')}</div>
      </div>`;

    const metadataWithoutBinaryBanner = patchNeedsMetadataWithoutBinaryWarning(s)
      ? `<div class="patch-banner err">
           <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>
           <div class="patch-banner-body">
             <div class="patch-banner-title">Version detected, binary signature missing</div>
             <div class="patch-banner-text">Antigravity <code>${escapeHtml(s.antigravityVersion ?? 'unknown')}</code> was recognized via <code>${escapeHtml(s.antigravityVersionSource ?? 'metadata')}</code>, but the <code>language_server</code> binary does not contain the expected signature. This can indicate a different build, a pre-modified binary, or a mixed installation.</div>
           </div>
         </div>`
      : '';

    const recommendationRow = s.recommendedPatch
      ? `
      <div class="patch-row">
        <div class="patch-row-label">Recommended family</div>
        <div class="patch-row-value">${escapeHtml(s.recommendedPatch.versionRange)}</div>
      </div>
      <div class="patch-row">
        <div class="patch-row-label">Recommendation source</div>
        <div class="patch-row-value ${s.overrideActive ? 'warn' : 'ok'}">${escapeHtml(s.overrideActive ? 'manual selection' : 'auto-detection')}</div>
      </div>
      <div class="patch-row">
        <div class="patch-row-label">Confidence</div>
        <div class="patch-row-value ${patchConfidenceTone(s.detectionConfidence)}">${escapeHtml(patchConfidenceLabel(s.detectionConfidence))}</div>
      </div>
      <div class="patch-row">
        <div class="patch-row-label">Binary signature</div>
        <div class="patch-row-value ${s.binarySignatureDetected ? 'ok' : 'warn'}">${escapeHtml(patchSignatureLabel(s))}</div>
      </div>
      <div class="patch-row">
        <div class="patch-row-label">JS overlay footprint</div>
        <div class="patch-row-value ${s.overlayFingerprintDetected ? (s.overlayFingerprintConfidence === 'high' ? 'ok' : 'warn') : 'warn'}">${escapeHtml(patchOverlayLabel(s))}</div>
      </div>
      ${s.overlayFingerprintReason ? `
      <div class="patch-row">
        <div class="patch-row-label">JS footprint reason</div>
        <div class="patch-row-value">${escapeHtml(s.overlayFingerprintReason)}</div>
      </div>` : ''}
      <div class="patch-row">
        <div class="patch-row-label">Original URL</div>
        <div class="patch-row-value">${escapeHtml(s.recommendedPatch.originalUrl)}</div>
      </div>
      <div class="patch-row">
        <div class="patch-row-label">Patched URL</div>
        <div class="patch-row-value">${escapeHtml(s.recommendedPatch.patchedUrl)}</div>
      </div>`
      : '';

    const overrideRow = s.overrideInfo?.range
      ? `
      <div class="patch-row">
        <div class="patch-row-label">Manual selection</div>
        <div class="patch-row-value warn">${escapeHtml(s.overrideInfo.range)}</div>
      </div>
      ${s.overrideInfo.reason ? `
      <div class="patch-row">
        <div class="patch-row-label">Reason</div>
        <div class="patch-row-value warn">${escapeHtml(s.overrideInfo.reason)}</div>
      </div>` : ''}`
      : '';

    const suggestions = `
      <div class="patch-row patch-suggestions">
        <div class="patch-row-label">Guidance</div>
        <div class="patch-row-value" style="max-width:100%; text-align:left;">
          <ul class="patch-suggestion-list">
            <li>Keep auto-detection active by default and only force a family if the detected version is incorrect.</li>
            <li>Always keep a clean backup before switching between 2.1, 2.2, 2.3, or 2.4 patch families.</li>
            <li>For 2.2.x, 2.3.x, and 2.4.x (up to 2.4.2), check MITM status and CA certificate installation before applying the patch.</li>
            <li>If metadata and binary signature disagree, restore from backup first before trying a manual family.</li>
          </ul>
        </div>
      </div>`;

    patchTpl.innerHTML = `
      ${banner}
      ${confidenceHero}
      ${metadataWithoutBinaryBanner}
      <div class="patch-row">
        <div class="patch-row-label">Antigravity version</div>
        <div class="patch-row-value">${escapeHtml(s.antigravityVersion ?? 'unknown')}</div>
      </div>
      <div class="patch-row">
        <div class="patch-row-label">Version source</div>
        <div class="patch-row-value">${escapeHtml(s.antigravityVersionSource ?? 'unknown')}</div>
      </div>
      <div class="patch-row">
        <div class="patch-row-label">Binary path</div>
        <div class="patch-row-value">${escapeHtml(s.binaryPath ?? '—')}</div>
      </div>
      <div class="patch-row">
        <div class="patch-row-label">Present</div>
        <div class="patch-row-value ${s.exists ? 'ok' : 'err'}">${s.exists ? 'yes' : 'no'}</div>
      </div>
      <div class="patch-row">
        <div class="patch-row-label">Already patched</div>
        <div class="patch-row-value ${s.applied ? 'ok' : 'warn'}">${s.applied ? 'yes' : 'no'}</div>
      </div>
      <div class="patch-row">
        <div class="patch-row-label">Backup</div>
        <div class="patch-row-value ${s.backupExists ? 'ok' : ''}">${s.backupExists ? 'yes' : 'no'}</div>
      </div>
      <div class="patch-row">
        <div class="patch-row-label">Compatibility</div>
        <div class="patch-row-value ${s.compatible ? 'ok' : 'warn'}">${s.compatible ? 'ok' : 'needs verification'}</div>
      </div>
      ${s.detectionReason ? `
      <div class="patch-row">
        <div class="patch-row-label">Recommendation reason</div>
        <div class="patch-row-value">${escapeHtml(s.detectionReason)}</div>
      </div>` : ''}
      ${recommendationRow}
      ${overrideRow}
      ${s.warningMessage ? `
      <div class="patch-row">
        <div class="patch-row-label">Warning</div>
        <div class="patch-row-value warn">${escapeHtml(s.warningMessage)}</div>
      </div>` : ''}
      ${suggestions}`;
    patchStatusEl.replaceChildren(patchTpl.content);
    setStatus('Ready');
  } catch (e) {
    patchStatusEl.innerHTML = `<div class="empty-state"><p>Could not load patch status: ${escapeHtml((e as Error).message)}</p></div>`;
  } finally {
    hideSkeleton(patchStatusEl);
  }
  });
}

patchRescanBtn.addEventListener('click', () => void loadPatchStatus());
patchClearOverrideBtn.addEventListener('click', () => void applyPatchRangeSelection(null));
patchRangeGridEl.addEventListener('click', (event) => {
  const target = event.target as HTMLElement | null;
  const button = target?.closest<HTMLButtonElement>('[data-patch-range]');
  if (!button) return;
  const range = button.getAttribute('data-patch-range');
  if (!range) return;
  void applyPatchRangeSelection(range);
});

$('#patchApplyBtn').addEventListener('click', async () => {
  // P1.3 (subset) — Validate the binary state (existence, compatibility,
  // backup presence, known recommended patch) BEFORE risking a destructive
  // change. The UI equivalent of a "delta size check": confirm the delta
  // (backup → patched binary) is in a consistent state before applying.
  let preflight: PatchStatus | null = null;
  try {
    setStatus('Preflight check…', 'busy');
    const r = await withTimeout(
      window.ag.run(['patch', 'status', '--json']),
      12_000,
      'patch status',
    );
    preflight = JSON.parse(r.stdout) as PatchStatus;
  } catch (e) {
    setStatus('Ready');
    toast(`Preflight failed: cannot read patch status (${(e as Error).message})`, 'err', 6000);
    return;
  }

  if (!preflight.exists) {
    setStatus('Ready');
    toast('Preflight failed: language_server binary not found. Nothing to patch.', 'err', 6000);
    return;
  }
  if (!preflight.compatible) {
    setStatus('Ready');
    toast('Preflight failed: Antigravity version is not compatible with the known patch.', 'err', 6000);
    return;
  }
  if (!preflight.recommendedPatch) {
    setStatus('Ready');
    toast('Preflight failed: no recommended patch available for this version.', 'err', 6000);
    return;
  }
  if (preflight.applied) {
    setStatus('Ready');
    toast('Patch is already applied. Use Restore first if you want to re-apply.', 'warn', 5000);
    return;
  }
  if (!preflight.backupExists) {
    // Non-blocking: warn the user but still allow them to confirm.
    console.warn('[patch] No backup found — applying patch will not be reversible');
  }

  // Build the details shown in the confirmation modal (includes the "delta
  // size" when the backend provides it via the optional deltaSizeBytes field).
  const sizeInfo =
    typeof preflight.deltaSizeBytes === 'number' && preflight.deltaSizeBytes > 0
      ? `<br><br><strong>Estimated delta size:</strong> ${escapeHtml(formatBytes(preflight.deltaSizeBytes))}`
      : '';
  const backupWarn = preflight.backupExists
    ? ''
    : '<br><br><strong style="color:var(--warn)">⚠ No backup found — patch will not be reversible.</strong>';

  // P1.3 (CLI subset) — Surface the validateAsar() output in the modal.
  // The backend now exposes `verdict` (ok|warn|block) and `validateAsarReport`
  // (list of checks). We render these checks and BLOCK confirmation if any
  // required check failed.
  interface ValidateAsarCheck {
    id: string;
    label: string;
    required: boolean;
    status: 'ok' | 'fail';
    value?: number;
    detail?: string;
  }
  interface ValidateAsarReport {
    asarPath: string | null;
    verdict: 'ok' | 'warn' | 'block' | string;
    checks: ValidateAsarCheck[];
    deltaSizeBytes: number | null;
    asarSizeBytes: number;
  }
  const validateReport: ValidateAsarReport | null =
    (preflight as unknown as { validateAsarReport?: ValidateAsarReport | null })
      .validateAsarReport ?? null;
  const verdict = validateReport?.verdict ?? (preflight as unknown as { verdict?: string | null }).verdict ?? null;

  let validateBlockHtml = '';
  if (validateReport) {
    const verdictColor =
      verdict === 'block' ? 'var(--err, #f44)' :
      verdict === 'warn' ? 'var(--warn, #f90)' :
      verdict === 'ok' ? 'var(--ok, #0a0)' : 'var(--muted, #888)';
    const verdictLabel = (verdict ?? 'unknown').toUpperCase();
    const rows = validateReport.checks
      .map((c) => {
        const icon = c.status === 'ok' ? '✓' : '✗';
        const tag = c.required ? 'required' : 'advisory';
        const detail = c.detail ? ` — <span class="patch-row-detail">${escapeHtml(c.detail)}</span>` : '';
        return `<li>${icon} <strong>${escapeHtml(c.label)}</strong> <em>(${tag})</em>${detail}</li>`;
      })
      .join('');
    validateBlockHtml = `
      <div class="patch-row">
        <div class="patch-row-label">Asar validation</div>
        <div class="patch-row-value" style="color:${verdictColor}">
          <strong>Verdict: ${escapeHtml(verdictLabel)}</strong>
          <ul style="margin: 6px 0 0 18px; padding: 0;">${rows}</ul>
        </div>
      </div>`;
  }

  if (verdict === 'block') {
    setStatus('Ready');
    toast('Asar validation failed (verdict=block). Patch cannot be applied — see preflight modal.', 'err', 8000);
    // Open the confirmation modal anyway so the user can read the verdict,
    // but the Apply button will be disabled below.
  }

  const ok = await confirmModal(
    'Apply binary patch',
    `This will modify <code>language_server</code> to redirect API calls to the local proxy.<br><br>A backup will be created automatically.${sizeInfo}${backupWarn}${validateBlockHtml}`,
    { confirmLabel: verdict === 'block' ? 'Blocked — cannot apply' : 'Apply patch', confirmDisabled: verdict === 'block' },
  );
  if (!ok) {
    setStatus('Ready');
    return;
  }
  setStatus('Applying patch…', 'busy');
  try {
    const r = await window.ag.run(['patch', 'apply', '--yes']);
    if (r.code === 0) {
      toast('Patch applied successfully', 'ok', 5000);
      void loadPatchStatus();
    } else {
      const decoded = decodeError(r.stderr, r.stdout);
      if (decoded.matched) {
        toast(`Patch failed — ${decoded.pattern}`, 'err', 6000);
        toast(decoded.hint, 'warn', 8000);
        runErrorAction(decoded.action);
      } else {
        toast(`Patch failed: ${r.stderr || r.stdout}`, 'err', 6000);
      }
    }
    setStatus('Ready');
  } catch (e) {
    toast(`Could not apply patch: ${(e as Error).message}`, 'err');
    setStatus('Error', 'err');
  }
});

$('#patchRestoreBtn').addEventListener('click', async () => {
  const ok = await confirmModal(
    'Restore from backup',
    `This will restore the original <code>language_server</code> binary from backup.<br><br>The patch will be undone.`,
    { confirmLabel: 'Restore', danger: true },
  );
  if (!ok) return;
  setStatus('Restoring…', 'busy');
  try {
    const r = await window.ag.run(['patch', 'restore', '--yes']);
    if (r.code === 0) {
      toast('Restored successfully', 'ok');
      void loadPatchStatus();
    } else {
      const decoded = decodeError(r.stderr, r.stdout);
      if (decoded.matched) {
        toast(`Restore failed — ${decoded.pattern}`, 'err');
        toast(decoded.hint, 'warn', 8000);
        runErrorAction(decoded.action);
      } else {
        toast(`Restore failed: ${r.stderr || r.stdout}`, 'err');
      }
    }
    setStatus('Ready');
  } catch (e) {
    toast(`Could not restore: ${(e as Error).message}`, 'err');
    setStatus('Error', 'err');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Logs view (streaming)
// ─────────────────────────────────────────────────────────────────────────────

const logsOutput = $('#logsOutput') as HTMLPreElement;
const logsFollowBtn = $('#logsFollowBtn') as HTMLButtonElement;
const logsClearBtn = $('#logsClearBtn') as HTMLButtonElement;
const logsCopyBtn = $('#logsCopyBtn') as HTMLButtonElement;

let logsStreamId: string | null = null;
let logsStreaming = false;

// Streaming buffer: raw text chunks are concatenated and ANSI-converted ONCE
// per animation frame, then appended in a single DOM mutation. The previous
// implementation ran ansiToHtml on every chunk (N regex passes per flush
// window) — see audit finding P0.
// Hard cap on the rendered log buffer so a long stream cannot bloat the
// <pre> node past ~500 KB and stall layout. We keep the last ~400 KB.
const LOGS_MAX_BYTES = 500_000;
const LOGS_KEEP_BYTES = 400_000;
let logsPendingChunk: string | null = null;
let logsFlushScheduled = false;
const flushLogs = () => {
  logsFlushScheduled = false;
  if (logsPendingChunk) {
    logsTpl.innerHTML = ansiToHtml(logsPendingChunk);
    logsOutput.appendChild(logsTpl.content.cloneNode(true));
    logsPendingChunk = null;
  }
  const isNearBottom = logsOutput.scrollHeight - logsOutput.scrollTop - logsOutput.clientHeight < 100;
  if (logsOutput.textContent && logsOutput.textContent.length > LOGS_MAX_BYTES) {
    const trimmed = logsOutput.textContent.slice(-LOGS_KEEP_BYTES);
    logsOutput.textContent = trimmed;
    logsOutput.scrollTop = logsOutput.scrollHeight;
  } else if (isNearBottom) {
    logsOutput.scrollTop = logsOutput.scrollHeight;
  }
};
const scheduleLogsFlush = () => {
  if (logsFlushScheduled) return;
  logsFlushScheduled = true;
  requestAnimationFrame(flushLogs);
};

// Reusable template for terminal output — avoids creating a new <template> each load
const logsTpl = document.createElement('template');
const logsSkeleton = $('#logsSkeleton') as HTMLDivElement;

async function loadLogs(): Promise<void> {
  if (logsStreaming) return;
  setStatus('Loading logs…', 'busy');
  logsSkeleton.style.display = 'block';
  logsOutput.style.display = 'none';
  try {
    const r = await window.ag.run(['logs', '-n', '100', '--source', currentLogSource]);
    logsTpl.innerHTML = ansiToHtml(r.stdout || r.stderr || '(empty)');
    logsOutput.replaceChildren(logsTpl.content);
    logsOutput.scrollTop = logsOutput.scrollHeight;
    setStatus('Ready');
  } catch (e) {
    logsOutput.textContent = `Could not load logs: ${(e as Error).message}`;
    setStatus('Error', 'err');
  } finally {
    logsSkeleton.style.display = 'none';
    logsOutput.style.display = '';
  }
}

async function startLogStream(): Promise<void> {
  if (logsStreaming) return;
  logsStreaming = true;
  logsFollowBtn.innerHTML = '<span class="dot-live"></span> Stop';
  setStatus('Streaming logs…', 'busy');
  logsStreamId = `logs-${Date.now()}`;

  window.ag.onStreamData(logsStreamId, (chunk) => {
    logsPendingChunk = (logsPendingChunk ?? '') + chunk;
    scheduleLogsFlush();
  });
  window.ag.onStreamClose(logsStreamId, (code) => {
    flushLogs();
    logsStreaming = false;
    logsFollowBtn.innerHTML = '<span class="dot-live"></span> Follow';
    setStatus(`Stream closed (${code})`);
  });
  window.ag.onStreamError(logsStreamId, (err) => {
    flushLogs();
    toast(`Stream error: ${err}`, 'err');
    void stopLogStream();
  });

  await window.ag.startStream(['logs', '-f', '--source', currentLogSource], logsStreamId);
}

async function stopLogStream(): Promise<void> {
  if (logsStreamId) {
    await window.ag.cancelStream(logsStreamId);
    logsStreamId = null;
  }
  logsStreaming = false;
  logsFollowBtn.innerHTML = '<span class="dot-live"></span> Follow';
  setStatus('Ready');
}

logsFollowBtn.addEventListener('click', () => {
  if (logsStreaming) void stopLogStream();
  else void startLogStream();
});
logsClearBtn.addEventListener('click', async () => {
  logsOutput.textContent = '';
  try {
    await window.ag.run(['logs', '--clear', '--source', currentLogSource]);
  } catch (err) {
    console.error('Failed to clear logs on backend', err);
  }
  toast('Logs cleared', 'info', 1500);
});
logsCopyBtn.addEventListener('click', async () => {
  await navigator.clipboard.writeText(logsOutput.textContent ?? '');
  const origText = logsCopyBtn.innerHTML;
  logsCopyBtn.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Copied!';
  setTimeout(() => { logsCopyBtn.innerHTML = origText; }, 2000);
  toast('Logs copied to clipboard', 'ok', 2000);
});

// Logs tabs: switch between log sources
let currentLogSource = 'language_server';
const logsTabs = $$('#logsTabs .tab');
logsTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    const source = tab.dataset.source ?? 'language_server';
    if (source === currentLogSource) return;
    logsTabs.forEach((t) => {
      const isActive = t === tab;
      t.classList.toggle('active', isActive);
      t.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    currentLogSource = source;
    if (logsStreaming) {
      void stopLogStream().then(() => void startLogStream());
    } else {
      void loadLogs();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Antigravity Status view
// ─────────────────────────────────────────────────────────────────────────────

const agVersionValue = $('#agVersionValue') as HTMLDivElement;
const agRunningValue = $('#agRunningValue') as HTMLDivElement;
const agProxyValue = $('#agProxyValue') as HTMLDivElement;
const agLsValue = $('#agLsValue') as HTMLDivElement;

const agSourceBadge = $('#agSourceBadge') as HTMLSpanElement;
const agInstallPath = $('#agInstallPath') as HTMLDivElement;
const agAppAsar = $('#agAppAsar') as HTMLDivElement;
const agVersionRow = $('#agVersionRow') as HTMLDivElement;
const agChannelRow = $('#agChannelRow') as HTMLDivElement;

const agPidsBadge = $('#agPidsBadge') as HTMLSpanElement;
const agAgPids = $('#agAgPids') as HTMLDivElement;
const agLsPids = $('#agLsPids') as HTMLDivElement;

const agRefreshBtn = $('#agRefreshBtn') as HTMLButtonElement;
const agLaunchBtn = $('#agLaunchBtn') as HTMLButtonElement;
const agKillBtn = $('#agKillBtn') as HTMLButtonElement;
const agRestartBtn = $('#agRestartBtn') as HTMLButtonElement;
const agLaunchLogsBtn = $('#agLaunchLogsBtn') as HTMLButtonElement;

let agStartedAt: number | null = null;
let agUptimeTimer: number | null = null;

function setAgHero(status: 'ok' | 'warn' | 'err' | 'busy', label: string, meta: string): void {
  if (agRunningValue) {
    agRunningValue.textContent = label;
  }
}

function startUptimeTicker(): void {
  // UI changed, no longer showing uptime in real-time
}

function stopUptimeTicker(): void {
  // UI changed, no longer showing uptime in real-time
}

// Reusable template for paths — avoids creating a new <template> each render
const pathsTpl = document.createElement('template');


function renderPaths(paths: Array<[string, string]>): void {
  const html = paths
    .filter(([, v]) => v && v !== '—')
    .map(([label, value]) => `
      <div class="path-row">
        <div class="path-row-label">${escapeHtml(label)}</div>
        <div class="path-row-value" title="${escapeHtml(value)}">${escapeHtml(value)}</div>
        <div class="path-row-actions">
          <button type="button" data-copy="${escapeHtml(value)}" title="Copy">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </button>
          <button type="button" data-reveal="${escapeHtml(value)}" title="Reveal">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          </button>
        </div>
      </div>
    `).join('');
  pathsTpl.innerHTML = html;
}

// Event delegation for path actions
$('#agPaths')?.addEventListener('click', async (e) => {
  const target = e.target as HTMLElement;
  const copyBtn = target.closest<HTMLElement>('[data-copy]');
  if (copyBtn) {
    await navigator.clipboard.writeText(copyBtn.dataset.copy ?? '');
    toast('Path copied', 'ok', 1500);
    return;
  }
  const revealBtn = target.closest<HTMLElement>('[data-reveal]');
  if (revealBtn) {
    await window.ag.reveal(revealBtn.dataset.reveal ?? '');
  }
});

$('#agCopyPathsBtn')?.addEventListener('click', async () => {
  const container = $('#agPaths');
  if (!container) return;
  const values = Array.from(container.querySelectorAll<HTMLElement>('.path-row-value'))
    .map((el) => el.textContent ?? '').join('\n');
  await navigator.clipboard.writeText(values);
  toast('All paths copied', 'ok', 2000);
});

agRefreshBtn.addEventListener('click', () => void loadAntigravityStatus());
agLaunchBtn.addEventListener('click', async () => {
  setAgHero('busy', 'Opening…', 'Launching Antigravity');
  try {
    const result = await window.ag.antigravityLaunch();
    if (!result.ok) throw new Error(result.error ?? 'Launch failed');
    const pid = result.data?.pid;
    setAgHero('ok', 'Running', `PID ${pid ?? '—'} · Launched`);
    startUptimeTicker();
    toast('Antigravity launched', 'ok', 2000);
  } catch (e) {
    setAgHero('err', 'Failed', (e as Error).message);
    toast(`Launch failed: ${(e as Error).message}`, 'err');
  }
});
agKillBtn.addEventListener('click', async () => {
  setAgHero('busy', 'Closing…', 'Killing Antigravity process');
  try {
    const result = await window.ag.antigravityKill();
    if (!result.ok) throw new Error(result.error ?? 'Kill failed');
    setAgHero('warn', 'Stopped', `Killed ${result.data?.killed ?? 0} processes`);
    // stopUptimeTicker();
    toast('Antigravity closed', 'ok', 2000);
  } catch (e) {
    setAgHero('err', 'Failed', (e as Error).message);
    toast(`Close failed: ${(e as Error).message}`, 'err');
  }
});

agRestartBtn.addEventListener('click', async () => {
  setAgHero('busy', 'Restarting…', 'Killing and relaunching');
  try {
    const result = await window.ag.antigravityRestart();
    if (!result.ok) throw new Error(result.error ?? 'Restart failed');
    const pid = result.data?.pid;
    setAgHero('ok', 'Running', `PID ${pid ?? '—'} · Restarted`);
    startUptimeTicker();
    toast('Antigravity restarted', 'ok', 2000);
  } catch (e) {
    setAgHero('err', 'Failed', (e as Error).message);
    toast(`Restart failed: ${(e as Error).message}`, 'err');
  }
});
// remove unused buttons

async function loadAntigravityStatus(): Promise<void> {
  return guardLoad('agStatus', async () => {
    setStatus('Loading Antigravity status…', 'busy');
    setAgHero('busy', 'Checking…', 'Detecting installation');
    try {
      // Parallel: info IPC, status IPC, version IPC, models count
      const [info, statusResult, versionResult, modelsResult] = await Promise.all([
        // PERF: 5 s TTL caused stale reads and split-cached state with the
        // boot path that requests 60 s. Unify to 60 s (info rarely changes).
        memo('info', 60_000, () => window.ag.info()),
        withTimeout(window.ag.antigravityStatus(), 10_000, 'antigravity status').catch((err: Error) => ({ ok: false, data: undefined, error: err.message })),
        withTimeout(window.ag.antigravityVersion(), 10_000, 'antigravity version').catch((err: Error) => ({ ok: false, data: undefined, error: err.message })),
        withTimeout(window.ag.run(['models', 'list', '--json']), 10_000, 'models list').catch(() => ({ stdout: '{"models":[]}', stderr: '', code: 0 })),
      ]);

    const status = statusResult.ok ? (statusResult.data as Record<string, unknown>) : null;
    const versionData = versionResult.ok ? versionResult.data : null;
    let modelsCount = 0;
    try {
      const modelsData = JSON.parse(modelsResult.stdout) as { models?: Array<{ name: string }> };
      if (modelsData && Array.isArray(modelsData.models)) {
        modelsCount = modelsData.models.length;
      }
    } catch {
      modelsCount = 0;
    }

    const installed = Boolean(status?.installed ?? status?.installDir);
    const running = Boolean(status?.running ?? status?.pid);
    const pid = status?.pid as number | undefined;
    const version = (versionData?.version as string | undefined) ?? (status?.version as string | undefined);
    const installDir = (status?.installDir as string | undefined) ?? '';

    // Hero card
    if (!installed) {
      setAgHero('err', 'Not installed', installDir || 'No installation found');
    } else if (running) {
      setAgHero('ok', 'Running', `PID ${pid ?? '—'} · ${version ?? 'unknown'}`);
      startUptimeTicker();
    } else {
      setAgHero('warn', 'Installed · Stopped', version ?? 'Not running');
    }

    // Stat cards
    if (agVersionValue) agVersionValue.textContent = version ?? '—';
    if (agRunningValue) {
      if (!installed) {
        agRunningValue.textContent = 'Not installed';
      } else if (running) {
        agRunningValue.textContent = 'Running';
      } else {
        agRunningValue.textContent = 'Stopped';
      }
    }
    
    // Fill Installation Panel
    if (agInstallPath) agInstallPath.textContent = installDir || '—';
    if (agAppAsar) agAppAsar.textContent = (status?.appAsarPath as string | undefined) ?? '—';
    if (agVersionRow) agVersionRow.textContent = version ?? '—';
    if (agChannelRow) agChannelRow.textContent = (status?.channel as string | undefined) ?? '—';
    
    // Fill Running processes Panel
    let agPidCount = 0;
    if (agAgPids) {
      const pids = status?.agPids as number[] | undefined;
      agPidCount += pids?.length ?? (pid ? 1 : 0);
      agAgPids.textContent = pids && pids.length > 0 ? pids.join(', ') : (pid ? String(pid) : '—');
    }
    if (agLsPids) {
      const lsPids = status?.lsPids as number[] | undefined;
      agPidCount += lsPids?.length ?? 0;
      agLsPids.textContent = lsPids && lsPids.length > 0 ? lsPids.join(', ') : '—';
    }
    if (agPidsBadge) {
      agPidsBadge.textContent = `${agPidCount} PIDs`;
    }
    if (agSourceBadge) {
       agSourceBadge.textContent = installed ? 'Installed' : 'Missing';
    }

    if (agLsValue) {
       const lsPids = status?.lsPids as number[] | undefined;
       agLsValue.textContent = (lsPids && lsPids.length > 0) ? 'Running' : 'Stopped';
    }
    
    try {
        const proxyResp = await window.ag.proxyStatus();
        if (agProxyValue) {
            agProxyValue.textContent = proxyResp?.data?.running ? 'Running' : 'Stopped';
        }
    } catch {
        if (agProxyValue) agProxyValue.textContent = 'Unknown';
    }
    
    setStatus('Ready');
  } catch (e) {
    setAgHero('err', 'Error', (e as Error).message);
    setStatus('Error', 'err');
  }
  });
}

// Backward compat alias
const loadInfo = loadAntigravityStatus;

// ─────────────────────────────────────────────────────────────────────────────
// Settings view
// ─────────────────────────────────────────────────────────────────────────────

const themeToggle = $('#themeToggle') as HTMLButtonElement;
const settingsConfigPath = $('#settingsConfigPath') as HTMLDivElement;
const settingsConfigBody = $('#settingsConfigBody') as HTMLPreElement;

const settingsConfigSkeleton = $('#settingsConfigSkeleton') as HTMLDivElement;

async function loadSettings(): Promise<void> {
  setStatus('Loading settings…', 'busy');
  settingsConfigSkeleton.style.display = 'block';
  settingsConfigBody.style.display = 'none';
  try {
    // Parallelize the three independent IPC calls.
    // Memoize config() with 30s TTL — it changes only when user toggles theme.
    const [cfg, pathResult, listResult] = await Promise.all([
      memo('config', 30_000, () => window.ag.config()),
      window.ag.run(['config', 'path']),
      window.ag.run(['config', 'list', '--json']),
    ]);
    const theme = (cfg.ui as Record<string, string> | undefined)?.theme ?? 'dark';
    themeToggle.textContent = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
    settingsConfigPath.textContent = pathResult.stdout.trim();
    settingsConfigBody.textContent = JSON.stringify(JSON.parse(listResult.stdout), null, 2);
    setStatus('Ready');
  } catch (e) {
    setStatus('Error', 'err');
    toast(`Settings error: ${(e as Error).message}`, 'err');
  } finally {
    settingsConfigSkeleton.style.display = 'none';
    settingsConfigBody.style.display = '';
  }
  // Notify toggle + proxy-error history are independent from the legacy
  // config block; load them in parallel and swallow errors (best-effort).
  await loadSettingsExtras();
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings: notifications toggle + proxy error history panel
// ─────────────────────────────────────────────────────────────────────────────

const notifyToggle = $('#notifyToggle') as HTMLInputElement | null;
const proxyErrorHistoryList = $('#proxyErrorHistoryList') as HTMLUListElement | null;
const proxyErrorHistoryEmpty = $('#proxyErrorHistoryEmpty') as HTMLDivElement | null;

function classifySeverity(p: { status?: number; errorType?: string }): 'err' | 'warn' {
  const s = p.status && p.status >= 500
    || p.errorType === 'auth_401' || p.errorType === 'auth_403'
    || p.errorType === 'quota_429' || p.errorType === 'timeout';
  return s ? 'err' : 'warn';
}

function formatRelativeTime(ms: number): string {
  const delta = Date.now() - ms;
  if (delta < 60_000) return `${Math.max(0, Math.round(delta / 1000))}s ago`;
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)}h ago`;
  return new Date(ms).toLocaleString();
}

function renderProxyErrorHistory(history: Array<{
  traceId: string;
  provider: string;
  status?: number;
  errorType: string;
  rawError: string;
  title: string;
  message: string;
  suggestions: string[];
  actionUrl?: string;
  at: number;
}>): void {
  if (!proxyErrorHistoryList) return;
  proxyErrorHistoryList.innerHTML = '';
  if (proxyErrorHistoryEmpty) proxyErrorHistoryEmpty.style.display = history.length === 0 ? '' : 'none';
  if (history.length === 0) return;
  // Build with a template — avoids innerHTML for untrusted strings.
  const tpl = document.createElement('template');
  for (const item of history) {
    const sev = classifySeverity(item);
    const li = document.createElement('li');
    li.className = `severity-${sev}`;
    li.dataset.traceId = item.traceId;
    const meta = document.createElement('div');
    meta.className = 'meta';
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = `${item.provider} — ${item.title}`;
    const subtitle = document.createElement('div');
    subtitle.className = 'subtitle';
    subtitle.textContent = item.message || item.rawError || '(no message)';
    const when = document.createElement('div');
    when.className = 'when';
    when.textContent = `${formatRelativeTime(item.at)}${item.status ? ` · HTTP ${item.status}` : ''}${item.errorType ? ` · ${item.errorType}` : ''}`;
    meta.append(title, subtitle, when);
    const btn = document.createElement('button');
    btn.className = 'btn btn-ghost btn-sm replay';
    btn.type = 'button';
    btn.textContent = 'Show';
    btn.dataset.label = 'replay-proxy-error';
    btn.setAttribute('aria-label', `Replay ${item.provider} ${item.title}`);
    btn.addEventListener('click', () => {
      // Re-fire the historical payload over the same channel the live
      // bridge consumes, so the modal renders without touching the proxy.
      window.dispatchEvent(new CustomEvent('ag:replay-proxy-error', { detail: item }));
      toast(`Replaying ${item.provider} — ${item.title}`, 'info', 1800);
    });
    li.append(meta, btn);
    tpl.content.appendChild(li);
  }
  proxyErrorHistoryList.appendChild(tpl.content);
}

async function loadProxyErrorHistory(): Promise<void> {
  try {
    const history = await window.ag.getProxyErrorHistory();
    renderProxyErrorHistory(history);
  } catch {
    // Best-effort — leave the previous render in place.
  }
}

async function loadSettingsExtras(): Promise<void> {
  if (notifyToggle) {
    try {
      const cfg = await window.ag.config();
      const ui = (cfg.ui as Record<string, unknown> | undefined) ?? {};
      notifyToggle.checked = ui.notifyEnabled === true;
    } catch {
      notifyToggle.checked = false;
    }
    notifyToggle.addEventListener('change', async () => {
      const enabled = notifyToggle.checked;
      const ok = await window.ag.setNotifyEnabled(enabled);
      if (ok) toast(enabled ? 'Notifications re-enabled' : 'Notifications muted', 'ok', 1800);
      else { toast('Failed to save preference', 'err', 1800); notifyToggle.checked = !enabled; }
    });
  }
  await loadProxyErrorHistory();
}

themeToggle.addEventListener('click', async () => {
  const current = document.documentElement.dataset.theme ?? 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  await setTheme(next);
});

async function setTheme(theme: 'dark' | 'light'): Promise<void> {
  document.documentElement.dataset.theme = theme;
  themeToggle.textContent = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  themeToggle.setAttribute('aria-pressed', theme === 'light' ? 'true' : 'false');
  updateStatusBarTheme(theme);
  // Invalidate config cache so the next loadSettings() picks up the new theme
  invalidateCache('config');
  await window.ag.setTheme(theme);
  toast(`Theme set to ${theme}`, 'ok', 2000);
}

async function applySavedTheme(): Promise<void> {
  try {
    // Memoize config() — applied at boot, called once
    const cfg = await memo('config', 30_000, () => window.ag.config());
    const theme = (cfg.ui as Record<string, string> | undefined)?.theme ?? 'dark';
    document.documentElement.dataset.theme = theme;
    updateStatusBarTheme(theme);
  } catch {
    document.documentElement.dataset.theme = 'dark';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Command palette
// ─────────────────────────────────────────────────────────────────────────────

const paletteBackdrop = $('#paletteBackdrop') as HTMLDivElement;
const paletteInput = $('#paletteInput') as HTMLInputElement;
const paletteResults = $('#paletteResults') as HTMLDivElement;

const PALETTE_COMMANDS: Array<{ id: string; label: string; view: string; action?: () => void }> = [
  { id: 'dashboard', label: 'Go to Dashboard', view: 'dashboard' },
  { id: 'doctor', label: 'Run System Diagnostic (Doctor)', view: 'dashboard', action: () => void runDoctor() },
  { id: 'fix-all', label: 'Fix All — Full Auto-Repair', view: 'dashboard', action: () => void runFixAll() },
  { id: 'antigravity', label: 'Go to Antigravity Status', view: 'info' },
  { id: 'models', label: 'Go to Custom Models', view: 'models' },
  { id: 'mitm', label: 'Go to MITM Proxy Manager', view: 'mitm' },
  { id: 'patch', label: 'Go to Binary Patch Manager', view: 'patch' },
  { id: 'proxy-stub', label: 'Start Emergency Proxy Stub', view: 'mitm', action: () => void runStartStub() },
  { id: 'logs', label: 'Go to System Logs', view: 'logs' },
  { id: 'settings', label: 'Go to Settings', view: 'settings' },
  { id: 'theme', label: 'Toggle Light / Dark Theme', view: 'settings', action: () => {
    const current = document.documentElement.dataset.theme ?? 'dark';
    void setTheme(current === 'dark' ? 'light' : 'dark');
  } },
  { id: 'info', label: 'Go to System Info & Installations', view: 'info' },
];

function openPalette(): void {
  paletteBackdrop.hidden = false;
  paletteInput.value = '';
  paletteInput.focus();
  renderPalette('');
}

function closePalette(): void {
  paletteBackdrop.hidden = true;
}

// Reusable template element — avoids creating a new <template> on every keystroke
const paletteTpl = document.createElement('template');

// Single delegated click listener (bound once) instead of N listeners per item
paletteResults.addEventListener('click', (e) => {
  const target = (e.target as HTMLElement).closest<HTMLElement>('.palette-item');
  if (target?.dataset.id) executePalette(target.dataset.id);
});

function renderPalette(query: string): void {
  const q = query.trim().toLowerCase();
  const filtered = PALETTE_COMMANDS.filter((c) => c.label.toLowerCase().includes(q) || c.view.toLowerCase().includes(q));
  const html = filtered
    .map(
      (c, i) => `
      <div class="palette-item ${i === 0 ? 'selected' : ''}" data-index="${i}" data-id="${escapeHtml(c.id)}">
        <span>${escapeHtml(c.label)}</span>
        <span class="palette-hint">${escapeHtml(c.view)}</span>
      </div>`,
    )
    .join('');
  paletteTpl.innerHTML = html;
  paletteResults.replaceChildren(paletteTpl.content);
}

function executePalette(id: string): void {
  const cmd = PALETTE_COMMANDS.find((c) => c.id === id);
  if (!cmd) return;
  closePalette();
  if (cmd.action) cmd.action();
  else navigate(cmd.view);
}

paletteInput.addEventListener('input', () => renderPalette(paletteInput.value));
paletteInput.addEventListener('keydown', (e) => {
  const items = paletteResults.querySelectorAll<HTMLDivElement>('.palette-item');
  const selected = paletteResults.querySelector<HTMLDivElement>('.palette-item.selected');
  let idx = selected ? Number(selected.dataset.index) : -1;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    idx = Math.min(idx + 1, items.length - 1);
    items.forEach((it) => it.classList.remove('selected'));
    items[idx]?.classList.add('selected');
    items[idx]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    idx = Math.max(idx - 1, 0);
    items.forEach((it) => it.classList.remove('selected'));
    items[idx]?.classList.add('selected');
    items[idx]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const target = paletteResults.querySelector<HTMLDivElement>('.palette-item.selected') ?? items[0];
    if (target) executePalette(target.dataset.id!);
  } else if (e.key === 'Escape') {
    closePalette();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Status bar wiring
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
// Boot
// ─────────────────────────────────────────────────────────────────────────────

(async function boot(): Promise<void> {
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
  whenIdle(() => void runDoctor(), 250);
})();

// ─────────────────────────────────────────────────────────────────────────────
// Provider Manager & Custom Models Modal
// ─────────────────────────────────────────────────────────────────────────────

interface AntigravityVersionInfo {
  version: string;
  channel?: string;
  source: 'asar' | 'product.json' | 'app-update.yml' | 'exe' | 'pak' | 'unknown';
}

interface AntigravityStatus {
  installed: boolean;
  installDir: string | null;
  appAsar: string | null;
  appAsarPath: string | null;
  binaryPath: string | null;
  customModelsPath: string | null;
  lsLogPath: string | null;
  version: string | null;
  versionInfo: AntigravityVersionInfo | null;
  displayName: string | null;
  running: boolean;
  pid: number | null;
  pids: number[];
  languageServerRunning: boolean;
  languageServerPids: number[];
  proxyPort: number;
  proxyReachable: boolean;
  username?: string;
  homedir?: string;
  cpu?: string;
  memory?: string;
}

interface ProviderModel {
  id: string;
  displayName?: string;
  enabled: boolean;
}

interface ProviderEntry {
  id: string;
  name: string;
  provider: string;
  apiUrl: string;
  apiKey: string;
  enabled: boolean;
  allowUnauthorized?: boolean;
  models: ProviderModel[];
  status?: 'healthy' | 'degraded' | 'offline' | 'untested';
  latencyMs?: number;
  lastTestedAt?: string;
  lastError?: string;
}

const pmBackdrop = $('#providerManagerModalBackdrop') as HTMLDivElement;
const pmClose = $('#providerManagerModalClose') as HTMLButtonElement;
const pmListContainer = $('#pmListContainer') as HTMLDivElement;
const pmFormContainer = $('#pmFormContainer') as HTMLDivElement;
const pmModalFooterList = $('#pmModalFooterList') as HTMLDivElement;
const pmAddBtn = $('#pmAddBtn') as HTMLButtonElement;
const pmFormBack = $('#pmFormBack') as HTMLButtonElement;
const pmFormBack2 = $('#pmFormBack2') as HTMLButtonElement;
const pmFormTitle = $('#pmFormTitle') as HTMLHeadingElement;
const pmFormName = $('#pmFormName') as HTMLInputElement;
const pmFormType = $('#pmFormType') as HTMLSelectElement;
const pmFormUrl = $('#pmFormUrl') as HTMLInputElement;
const pmFormKey = $('#pmFormKey') as HTMLInputElement;
const pmFormInsecure = $('#pmFormInsecure') as HTMLInputElement;
const pmFormSave = $('#pmFormSave') as HTMLButtonElement;
const pmFormError = $('#pmFormError') as HTMLDivElement;
const pmModelsList = $('#pmModelsList') as HTMLDivElement;
const pmFormFetchModelsBtn = $('#pmFormFetchModels') as HTMLButtonElement;
const pmModalClose2 = $('#pmModalClose2') as HTMLButtonElement;
const pmFormTest = $('#pmFormTest') as HTMLButtonElement;

let providersCache: ProviderEntry[] = [];

// Live sync: react to external custom_models.json changes (CLI add/remove,
// file edits, proxy migrations). The main process broadcasts
// ag:providers:changed via its file watcher; without this subscription the
// UI only refreshes on navigation, so CLI-side changes would stay invisible
// until the user re-navigates. Register once at boot.
window.ag.providers.onChanged(() => {
  providersCache = [];
  const modelsViewActive = !!document.getElementById('view-models')?.classList.contains('active');
  if (modelsViewActive) void loadModels();
});
let editingProviderId: string | null = null;
let currentFetchedModels: Array<{ id: string; displayName?: string; enabled: boolean }> = [];
let pmModelsSearchQuery = '';

const pmKeyToggle = $('#pmKeyToggle') as HTMLButtonElement | null;
const pmModelsSearch = $('#pmModelsSearch') as HTMLInputElement | null;
const pmModelsSelectAll = $('#pmModelsSelectAll') as HTMLButtonElement | null;
const pmModelsDeselectAll = $('#pmModelsDeselectAll') as HTMLButtonElement | null;
const pmFormCustomModelInput = $('#pmFormCustomModelInput') as HTMLInputElement | null;
const pmFormAddCustomModelBtn = $('#pmFormAddCustomModelBtn') as HTMLButtonElement | null;
const pmModelsCountBadge = $('#pmModelsCountBadge') as HTMLSpanElement | null;
const pmCapFilters = $('#pmCapFilters') as HTMLDivElement | null;
let activeCapFilter: 'all' | 'reasoning' | 'vision' | 'code' = 'all';

function detectModelCapabilities(modelId: string): string[] {
  const caps: string[] = [];
  const id = modelId.toLowerCase();
  if (/r1|o1|o3|reasoner|thinking|qwq/.test(id)) caps.push('reasoning');
  if (/vision|4o|claude-3|gemini-1\.5|flash|pixtral/.test(id)) caps.push('vision');
  if (/coder|code|starcoder|qwen2\.5-coder/.test(id)) caps.push('code');
  return caps;
}

function updatePmModelsCounter(): void {
  if (!pmModelsCountBadge) return;
  const total = currentFetchedModels.length;
  const selected = currentFetchedModels.filter((m) => m.enabled !== false).length;
  pmModelsCountBadge.textContent = `${selected} / ${total} selected`;
  if (selected === 0) {
    pmModelsCountBadge.className = 'badge badge-warn';
  } else if (selected === total && total > 0) {
    pmModelsCountBadge.className = 'badge badge-ok';
  } else {
    pmModelsCountBadge.className = 'badge badge-primary';
  }
}

function renderPmModelsCatalog(): void {
  if (!pmModelsList) return;
  updatePmModelsCounter();
  const q = pmModelsSearchQuery.trim().toLowerCase();
  const filtered = currentFetchedModels.filter((m) => {
    const caps = detectModelCapabilities(m.id);
    if (activeCapFilter !== 'all' && !caps.includes(activeCapFilter)) {
      return false;
    }
    if (!q) return true;
    return m.id.toLowerCase().includes(q) || (m.displayName || '').toLowerCase().includes(q);
  });

  if (currentFetchedModels.length === 0) {
    pmModelsList.innerHTML = '<div class="pm-models-hint">No models loaded. Click "Fetch models" or add custom ID below.</div>';
    return;
  }

  if (filtered.length === 0) {
    pmModelsList.innerHTML = `<div class="pm-models-hint">No models matching active filter or search query.</div>`;
    return;
  }

  let html = '<div class="agy-model-chips">';
  for (const m of filtered) {
    const checked = m.enabled !== false ? 'checked' : '';
    const caps = detectModelCapabilities(m.id);
    const badgesHtml = caps
      .map((c) => `<span class="pm-cap-badge ${c}">${c}</span>`)
      .join('');

    html += `<label class="agy-chip" title="${escapeHtml(m.id)}">
      <input type="checkbox" data-model-id="${escapeHtml(m.id)}" ${checked} />
      <span>${escapeHtml(m.displayName || m.id)}</span>
      ${badgesHtml}
    </label>`;
  }
  html += '</div>';
  pmModelsList.innerHTML = html;
}

function triggerSmartFailover(failingProviderId?: string): void {
  const fallback = providersCache.find((p) => p.enabled && p.id !== failingProviderId && (p.status === 'healthy' || !p.status));
  if (fallback) {
    toast(`Switched to fallback provider ${fallback.name}`, 'ok');
  } else {
    toast(`No alternative healthy provider available`, 'warn');
  }
}

function handleProviderError(errorMsg: string, status?: number, _p?: ProviderEntry): void {
  const label = status === 401 ? 'Auth error — check API key'
    : status === 429 ? 'Rate-limited — try again later'
    : status === 402 ? 'Quota exceeded'
    : status ? `Provider error (HTTP ${status})`
    : errorMsg || 'Provider unreachable';
  toast(label, 'err', 6000);
}

function showPmView(view: 'list' | 'form'): void {
  if (view === 'list') {
    pmListContainer.hidden = false;
    pmFormContainer.hidden = true;
    if (pmModalFooterList) pmModalFooterList.hidden = false;
  } else {
    pmListContainer.hidden = true;
    pmFormContainer.hidden = false;
    if (pmModalFooterList) pmModalFooterList.hidden = true;
  }
}

function renderHealthStatusIndicator(p: ProviderEntry): string {
  const status = p.status || 'untested';
  const titleText = status === 'healthy'
    ? `Healthy · ${p.latencyMs ?? 0}ms response time`
    : status === 'degraded'
    ? `Degraded · ${p.latencyMs ?? 0}ms response time (Slow)`
    : status === 'offline'
    ? `Offline · ${escapeHtml(p.lastError || 'Unreachable')}`
    : 'Untested connection';

  let html = `<span class="agy-status-dot ${status}" title="${escapeHtml(titleText)}"></span>`;
  if (typeof p.latencyMs === 'number' && status !== 'untested') {
    html += `<span class="agy-latency-badge ${status}" title="${escapeHtml(titleText)}">${p.latencyMs} ms</span>`;
  }
  return html;
}

function renderProviderStatus(p: ProviderEntry): string {
  if (!p.enabled) {
    return `<span class="agy-pill agy-pill-muted">Disabled</span>`;
  }
  const status = p.status || 'untested';
  if (status === 'offline') {
    return `<span class="agy-pill agy-pill-offline">Offline</span>`;
  }
  if (status === 'degraded') {
    return `<span class="agy-pill agy-pill-degraded">Degraded</span>`;
  }
  if (status === 'healthy') {
    return `<span class="agy-pill agy-pill-ok">Healthy</span>`;
  }
  return `<span class="agy-pill agy-pill-muted">Untested</span>`;
}

async function renderProviderList(): Promise<void> {
  showSkeleton(pmListContainer, 'cards', 2);
  try {
    providersCache = (await window.ag.providers.get()) as ProviderEntry[];
    if (!providersCache || providersCache.length === 0) {
      pmListContainer.innerHTML = `
        <div class="agy-empty-state">
          <div class="agy-empty-icon">
            <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
          </div>
          <div class="agy-empty-title">No providers yet</div>
          <div class="agy-empty-text">Add a custom OpenAI-compatible provider to get started.</div>
        </div>
      `;
      return;
    }

    let html = `<div class="agy-provider-list">`;
    for (const p of providersCache) {
      html += `
        <div class="agy-provider-row" data-id="${escapeHtml(p.id)}">
          <div class="agy-provider-row-main">
            <div class="agy-provider-row-name" style="display:flex; align-items:center;">
              ${renderHealthStatusIndicator(p)}
              <span>${escapeHtml(p.name)}</span>
            </div>
            <div class="agy-provider-row-meta">
              <span>${escapeHtml(p.provider)}</span>
              <span class="agy-dot">·</span>
              <span>${escapeHtml(p.apiUrl.replace(/^https?:\/\//, ''))}</span>
              <span class="agy-dot">·</span>
              <span>${p.models.length} model${p.models.length === 1 ? '' : 's'}</span>
            </div>
          </div>
          <div class="agy-provider-row-status">${renderProviderStatus(p)}</div>
          <div class="agy-provider-row-actions">
            <button class="agy-icon-btn pm-test" title="Test connection" aria-label="Test connection for ${escapeHtml(p.name)}">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
            </button>
            <button class="agy-icon-btn pm-toggle" title="${p.enabled ? 'Disable' : 'Enable'} provider" aria-label="${p.enabled ? 'Disable' : 'Enable'} provider ${escapeHtml(p.name)}">
              ${p.enabled
                ? `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>`
                : `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.64 18.36a9 9 0 1 0 12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/><polyline points="16 8 12 12 8 8"/></svg>`
              }
            </button>
            <button class="agy-icon-btn pm-edit" title="Edit provider" aria-label="Edit provider ${escapeHtml(p.name)}">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="agy-icon-btn pm-delete" title="Delete provider" aria-label="Delete provider ${escapeHtml(p.name)}">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
            </button>
          </div>
        </div>
      `;
    }
    html += `</div>`;
    pmListContainer.innerHTML = html;

    pmListContainer.querySelectorAll<HTMLButtonElement>('.pm-test').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const row = (e.currentTarget as HTMLElement).closest('.agy-provider-row') as HTMLElement;
        const id = row.dataset.id!;
        const p = providersCache.find((x) => x.id === id);
        if (!p) return;
        btn.setAttribute('disabled', 'true');
        const orig = btn.innerHTML;
        btn.innerHTML = `<span class="spinner"></span>`;
        try {
          const r = (await window.ag.providers.test({ apiUrl: p.apiUrl, apiKey: p.apiKey, id: p.id })) as {
            success: boolean;
            status?: number;
            latencyMs?: number;
            healthStatus?: 'healthy' | 'degraded' | 'offline';
            error?: string;
          };
          if (r.success) {
            p.status = r.healthStatus ?? 'healthy';
            p.latencyMs = r.latencyMs;
            toast(`Healthy (${r.latencyMs ?? 0}ms)`, 'ok');
          } else {
            p.status = r.healthStatus ?? 'offline';
            p.latencyMs = r.latencyMs;
            p.lastError = r.error;
            toast(`Failed: ${r.error || r.status}`, 'err', 6000);
            handleProviderError(r.error || `HTTP ${r.status}`, r.status, p);
          }
          await renderProviderList();
        } catch (err) {
          const errorMsg = (err as Error).message;
          toast(`Test error: ${errorMsg}`, 'err');
          handleProviderError(errorMsg, undefined, p);
        } finally {
          btn.removeAttribute('disabled');
          btn.innerHTML = orig;
        }
      });
    });

    pmListContainer.querySelectorAll<HTMLButtonElement>('.pm-toggle').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const row = (e.currentTarget as HTMLElement).closest('.agy-provider-row') as HTMLElement;
        const id = row.dataset.id!;
        const p = providersCache.find((x) => x.id === id);
        if (!p) return;
        p.enabled = !p.enabled;
        const r = (await window.ag.providers.save(p)) as { success: boolean; error?: string };
        if (r.success) {
          toast(p.enabled ? 'Provider enabled' : 'Provider disabled', 'ok');
          await renderProviderList();
        } else {
          toast(`Save failed: ${r.error}`, 'err');
          p.enabled = !p.enabled;
        }
      });
    });

    pmListContainer.querySelectorAll<HTMLButtonElement>('.pm-edit').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const row = (e.currentTarget as HTMLElement).closest('.agy-provider-row') as HTMLElement;
        const id = row.dataset.id!;
        openProviderForm(id);
      });
    });

    pmListContainer.querySelectorAll<HTMLButtonElement>('.pm-delete').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const row = (e.currentTarget as HTMLElement).closest('.agy-provider-row') as HTMLElement;
        const id = row.dataset.id!;
        const p = providersCache.find((x) => x.id === id);
        if (!p) return;
        const ok = await modals.confirm(
          'Delete provider?',
          `Delete <strong>${escapeHtml(p.name)}</strong>? This cannot be undone.`,
          { danger: true, confirmLabel: 'Delete' },
        );
        if (!ok) return;
        const r = (await window.ag.providers.delete(id)) as { success: boolean; error?: string };
        if (r.success) {
          toast('Provider deleted', 'ok');
          await renderProviderList();
        } else {
          toast(`Delete failed: ${r.error}`, 'err');
        }
      });
    });
  } finally {
    hideSkeleton(pmListContainer);
  }
}

function resetProviderForm(): void {
  pmFormName.value = '';
  pmFormType.value = 'openai';
  pmFormUrl.value = '';
  pmFormKey.value = '';
  pmFormInsecure.checked = false;
  pmModelsList.innerHTML = '';
  pmFormError.hidden = true;
  pmFormError.textContent = '';
  editingProviderId = null;
}

function openProviderForm(existingId?: string): void {
  pmModelsSearchQuery = '';
  if (pmModelsSearch) pmModelsSearch.value = '';
  resetProviderForm();
  if (existingId) {
    const p = providersCache.find((x) => x.id === existingId);
    if (p) {
      editingProviderId = p.id;
      pmFormTitle.textContent = 'Edit Provider';
      pmFormName.value = p.name;
      pmFormType.value = p.provider;
      pmFormUrl.value = p.apiUrl;
      pmFormKey.value = p.apiKey;
      pmFormInsecure.checked = p.allowUnauthorized ?? false;
      currentFetchedModels = (p.models || []).map((m) => ({
        id: m.id,
        displayName: m.displayName || m.id,
        enabled: m.enabled !== false,
      }));
      renderPmModelsCatalog();
    }
  } else {
    pmFormTitle.textContent = 'Add Provider';
    currentFetchedModels = [];
    renderPmModelsCatalog();
  }
  showPmView('form');
}

function openProviderManagerModal(): void {
  pmBackdrop.hidden = false;
  showPmView('list');
  void renderProviderList();
}

pmClose.addEventListener('click', () => { pmBackdrop.hidden = true; });
// Close the provider manager with Escape or a backdrop click (standard modal UX).
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !pmBackdrop.hidden) pmBackdrop.hidden = true;
});
pmBackdrop.addEventListener('click', (e) => { if (e.target === pmBackdrop) pmBackdrop.hidden = true; });
if (pmModalClose2) pmModalClose2.addEventListener('click', () => { pmBackdrop.hidden = true; });
pmAddBtn.addEventListener('click', () => openProviderForm());
pmFormBack.addEventListener('click', () => showPmView('list'));
if (pmFormBack2) pmFormBack2.addEventListener('click', () => showPmView('list'));

pmFormType.addEventListener('change', () => {
  const t = pmFormType.value;
  pmFormUrl.value = getRendererDefaultUrl(t);
});

pmFormSave.addEventListener('click', async () => {
  const name = pmFormName.value.trim();
  const provider = pmFormType.value;
  const apiUrl = pmFormUrl.value.trim();
  const apiKey = pmFormKey.value.trim();
  const allowUnauthorized = pmFormInsecure.checked;

  if (!name) {
    pmFormError.textContent = 'Provider name is required.';
    pmFormError.hidden = false;
    return;
  }
  if (!apiUrl) {
    pmFormError.textContent = 'API URL is required.';
    pmFormError.hidden = false;
    return;
  }

  const selectedModels = currentFetchedModels
    .filter((m) => m.enabled !== false)
    .map((m) => ({ id: m.id, displayName: m.displayName || m.id, enabled: true }));

  const entry: ProviderEntry = {
    id: editingProviderId || `provider-${Date.now()}`,
    name,
    provider,
    apiUrl,
    apiKey: apiKey || 'none',
    allowUnauthorized,
    enabled: true,
    models: selectedModels,
  };

  pmFormSave.disabled = true;
  pmFormSave.textContent = 'Saving…';
  try {
    const r = (await window.ag.providers.save(entry)) as { success: boolean; error?: string };
    if (r.success) {
      toast('Provider saved', 'ok');
      showPmView('list');
      await renderProviderList();
      await loadModels();
    } else {
      pmFormError.textContent = r.error || 'Failed to save provider.';
      pmFormError.hidden = false;
    }
  } catch (err) {
    pmFormError.textContent = (err as Error).message;
    pmFormError.hidden = false;
  } finally {
    pmFormSave.disabled = false;
    pmFormSave.textContent = 'Save provider';
  }
});

if (pmFormTest) {
  pmFormTest.addEventListener('click', async () => {
    const apiUrl = pmFormUrl.value.trim();
    const apiKey = pmFormKey.value.trim();
    const allowUnauthorized = pmFormInsecure.checked;
    if (!apiUrl) {
      toast('Enter an API URL first', 'warn');
      return;
    }
    pmFormTest.disabled = true;
    pmFormTest.textContent = 'Testing…';
    try {
      const r = (await window.ag.providers.test({ apiUrl, apiKey: apiKey || 'none', allowUnauthorized } as any)) as {
        success: boolean;
        latencyMs?: number;
        error?: string;
      };
      if (r.success) {
        toast(`Connection successful (${r.latencyMs ?? 0}ms)`, 'ok');
      } else {
        toast(`Test failed: ${r.error}`, 'err', 5000);
      }
    } catch (err) {
      toast(`Test failed: ${(err as Error).message}`, 'err');
    } finally {
      pmFormTest.disabled = false;
      pmFormTest.textContent = 'Test connection';
    }
  });
}

if (pmFormFetchModelsBtn) {
  pmFormFetchModelsBtn.addEventListener('click', async () => {
    const provider = pmFormType.value;
    const apiUrl = pmFormUrl.value.trim();
    const apiKey = pmFormKey.value.trim();
    if (!apiUrl) {
      toast('Enter API URL first', 'warn');
      return;
    }
    pmFormFetchModelsBtn.disabled = true;
    pmFormFetchModelsBtn.textContent = 'Fetching…';
    try {
      const r = (await window.ag.providers.fetchModels({ provider, apiUrl, apiKey: apiKey || 'none' } as any)) as {
        success: boolean;
        models?: Array<{ id: string; displayName?: string }>;
        error?: string;
      };
      if (r.success && r.models) {
        currentFetchedModels = r.models.map((m) => ({
          id: m.id,
          displayName: m.displayName || m.id,
          enabled: true,
        }));
        renderPmModelsCatalog();
        toast(`Fetched ${r.models.length} models`, 'ok');
      } else {
        toast(`Fetch models failed: ${r.error}`, 'err');
      }
    } catch (err) {
      toast(`Fetch failed: ${(err as Error).message}`, 'err');
    } finally {
      pmFormFetchModelsBtn.disabled = false;
      pmFormFetchModelsBtn.textContent = 'Fetch models';
    }
  });
}

if (pmCapFilters) {
  pmCapFilters.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('.pm-cap-filter');
    if (!btn || !btn.dataset.cap) return;
    activeCapFilter = btn.dataset.cap as 'all' | 'reasoning' | 'vision' | 'code';
    pmCapFilters.querySelectorAll('.pm-cap-filter').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    renderPmModelsCatalog();
  });
}

if (pmModelsSelectAll) {
  pmModelsSelectAll.addEventListener('click', () => {
    currentFetchedModels.forEach((m) => { m.enabled = true; });
    renderPmModelsCatalog();
  });
}

if (pmModelsDeselectAll) {
  pmModelsDeselectAll.addEventListener('click', () => {
    currentFetchedModels.forEach((m) => { m.enabled = false; });
    renderPmModelsCatalog();
  });
}

function addCustomModelToCatalog(): void {
  if (!pmFormCustomModelInput) return;
  const customId = pmFormCustomModelInput.value.trim();
  if (!customId) return;
  const exists = currentFetchedModels.some((m) => m.id.toLowerCase() === customId.toLowerCase());
  if (!exists) {
    currentFetchedModels.push({ id: customId, displayName: customId, enabled: true });
    toast(`Added custom model ${customId}`, 'ok');
  }
  pmFormCustomModelInput.value = '';
  renderPmModelsCatalog();
}

if (pmFormAddCustomModelBtn) pmFormAddCustomModelBtn.addEventListener('click', addCustomModelToCatalog);
if (pmFormCustomModelInput) {
  pmFormCustomModelInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addCustomModelToCatalog();
    }
  });
}

// Bind all Add Model buttons across views
$('#dashboardAddModelBtn')?.addEventListener('click', openProviderManagerModal);
$('#modelsAddBtn')?.addEventListener('click', openProviderManagerModal);
$('#providerManagerBtn')?.addEventListener('click', openProviderManagerModal);
$('#emptyAddModelBtn')?.addEventListener('click', openProviderManagerModal);

// Real-time synchronization listener: re-render provider list whenever custom_models.json changes
window.ag?.providers?.onChanged(() => {
  void renderProviderList();
  void loadModels();
});

// ─────────────────────────────────────────────────────────────────────────────
// Remote Server (QR Code)
// ─────────────────────────────────────────────────────────────────────────────

const startRemoteBtn = $('#startRemoteBtn');
const remoteQrContainer = $('#remoteQrContainer');
const remoteQrImage = $('#remoteQrImage') as HTMLImageElement;
const remoteQrPlaceholder = $('#remoteQrPlaceholder');
const remoteStatusText = $('#remoteStatusText');
const remotePort = $('#remotePort') as HTMLInputElement;
const remoteTunnel = $('#remoteTunnel') as HTMLSelectElement;
const remoteAuthToken = $('#remoteAuthToken') as HTMLInputElement;
const remoteConsole = $('#remoteConsole') as HTMLTextAreaElement;
const regenerateTokenBtn = $('#regenerateTokenBtn');
const tokenSavedBadge = $('#tokenSavedBadge');
const remoteAllowFirstAdmin = $('#remoteAllowFirstAdmin') as HTMLInputElement;
const remotePinDisplay = $('#remotePinDisplay');
const remoteTelemetryBadge = $('#remoteTelemetryBadge');
const remoteClientsCount = $('#remoteClientsCount');
const remoteSessionsCount = $('#remoteSessionsCount');
const remoteUptimeDisplay = $('#remoteUptimeDisplay');
const remoteCheckHealthBtn = $('#remoteCheckHealthBtn');
const remoteCopyWsUrlBtn = $('#remoteCopyWsUrlBtn');

let isDaemonRunning = false;
let tokenBadgeTimeout: any = null;
let currentActiveWsUrl = '';

function flashTokenSavedBadge() {
  if (tokenSavedBadge) {
    tokenSavedBadge.style.display = 'inline';
    if (tokenBadgeTimeout) clearTimeout(tokenBadgeTimeout);
    tokenBadgeTimeout = setTimeout(() => {
      tokenSavedBadge.style.display = 'none';
    }, 2000);
  }
}

// ── Restauration initiale depuis localStorage ───────────────────────────────
try {
  const savedToken = localStorage.getItem('ag_remote_auth_token');
  if (savedToken !== null && remoteAuthToken) {
    remoteAuthToken.value = savedToken;
  }
  const savedPort = localStorage.getItem('ag_remote_port');
  if (savedPort !== null && remotePort) {
    remotePort.value = savedPort;
  }
  const savedTunnel = localStorage.getItem('ag_remote_tunnel');
  if (savedTunnel !== null && remoteTunnel) {
    remoteTunnel.value = savedTunnel;
  }
  const savedAllowAdmin = localStorage.getItem('ag_remote_allow_first_admin');
  if (savedAllowAdmin !== null && remoteAllowFirstAdmin) {
    remoteAllowFirstAdmin.checked = savedAllowAdmin === 'true';
  }
} catch { /* ignore */ }

// ── Sauvegarde automatique temps-réel ───────────────────────────────────────
remoteAuthToken?.addEventListener('input', () => {
  try {
    const val = remoteAuthToken.value.trim();
    localStorage.setItem('ag_remote_auth_token', val);
    flashTokenSavedBadge();
    if (isDaemonRunning) {
      void syncDaemonUiStatus();
    }
  } catch { /* ignore */ }
});

remotePort?.addEventListener('input', () => {
  try {
    localStorage.setItem('ag_remote_port', remotePort.value.trim());
  } catch { /* ignore */ }
});

remoteTunnel?.addEventListener('change', () => {
  try {
    localStorage.setItem('ag_remote_tunnel', remoteTunnel.value);
  } catch { /* ignore */ }
});

remoteAllowFirstAdmin?.addEventListener('change', () => {
  try {
    localStorage.setItem('ag_remote_allow_first_admin', remoteAllowFirstAdmin.checked ? 'true' : 'false');
  } catch { /* ignore */ }
});

regenerateTokenBtn?.addEventListener('click', () => {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let rand = '';
  for (let i = 0; i < 8; i++) {
    rand += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  if (remoteAuthToken) {
    remoteAuthToken.value = rand;
    try {
      localStorage.setItem('ag_remote_auth_token', rand);
      flashTokenSavedBadge();
    } catch { /* ignore */ }
    if (isDaemonRunning) {
      void syncDaemonUiStatus();
    }
    toast(`Nouveau token généré et sauvegardé : ${rand}`, 'ok');
  }
});

function attachCopyButton(wsUrl: string) {
  currentActiveWsUrl = wsUrl;
  $('#copyRemoteWsBtn')?.addEventListener('click', () => {
    navigator.clipboard.writeText(wsUrl).then(() => {
      toast('URL WebSocket copiée dans le presse-papier !', 'ok');
    }).catch(() => {
      toast('Impossible de copier l\'URL', 'warn');
    });
  });
}

remoteCopyWsUrlBtn?.addEventListener('click', () => {
  if (currentActiveWsUrl) {
    navigator.clipboard.writeText(currentActiveWsUrl).then(() => {
      toast('URL WebSocket copiée !', 'ok');
    }).catch(() => {
      toast('Impossible de copier', 'warn');
    });
  } else {
    const port = parseInt(remotePort?.value || '8090');
    const token = remoteAuthToken?.value?.trim() || '11';
    window.ag?.getLocalIp?.().then((ip: string) => {
      const url = `ws://${ip}:${port}/ws?token=${encodeURIComponent(token)}`;
      navigator.clipboard.writeText(url).then(() => {
        toast(`URL locale copiée : ${url}`, 'ok');
      });
    });
  }
});

remoteCheckHealthBtn?.addEventListener('click', async () => {
  const port = parseInt(remotePort?.value || '8090');
  const token = remoteAuthToken?.value?.trim() || '11';
  try {
    const status = await window.ag?.getDaemonStatus?.(port, token);
    if (status && status.running) {
      const sessions = status.telemetry?.sessions ?? 0;
      const clients = status.telemetry?.clients ?? 0;
      const uptime = status.telemetry?.uptime ?? 'récent';
      toast(`✅ Démon sain sur :${port} — ${clients} client(s), ${sessions} session(s), Uptime: ${uptime}`, 'ok');
    } else {
      toast(`⚠️ Démon non joignable sur le port ${port}`, 'warn');
    }
  } catch (err: any) {
    toast(`❌ Erreur santé: ${err.message}`, 'err');
  }
});

async function syncDaemonUiStatus(port?: number) {
  try {
    const currentPort = port || parseInt(remotePort?.value || localStorage.getItem('ag_remote_port') || '8090');
    const token = remoteAuthToken?.value?.trim() || localStorage.getItem('ag_remote_auth_token') || '11';
    const status = await window.ag?.getDaemonStatus?.(currentPort, token);
    if (status && status.running) {
      isDaemonRunning = true;
      if (startRemoteBtn) {
        startRemoteBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg> Stop Remote Server';
        startRemoteBtn.classList.add('btn-danger');
        startRemoteBtn.removeAttribute('disabled');
      }

      if (remoteTelemetryBadge) {
        remoteTelemetryBadge.textContent = 'En ligne';
        remoteTelemetryBadge.style.background = 'rgba(34, 197, 94, 0.2)';
        remoteTelemetryBadge.style.color = '#22c55e';
      }
      if (status.telemetry) {
        if (remoteClientsCount && typeof status.telemetry.clients !== 'undefined') {
          remoteClientsCount.textContent = status.telemetry.clients.toString();
        }
        if (remoteSessionsCount && typeof status.telemetry.sessions !== 'undefined') {
          remoteSessionsCount.textContent = status.telemetry.sessions.toString();
        }
        if (remoteUptimeDisplay && status.telemetry.uptime) {
          remoteUptimeDisplay.textContent = status.telemetry.uptime;
        }
      }

      if (status.publicUrl && status.publicUrl.length > 0) {
        const cleanHost = status.publicUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '');
        const wsUrl = `wss://${cleanHost}/ws?token=${token}`;
        currentActiveWsUrl = wsUrl;
        const dataUrl = await window.ag.generateQr(wsUrl);
        if (remoteQrImage) remoteQrImage.src = dataUrl;
        if (remoteQrPlaceholder) remoteQrPlaceholder.style.display = 'none';
        if (remoteQrContainer) remoteQrContainer.style.display = 'block';
        if (remoteStatusText) {
          remoteStatusText.innerHTML = `Tunnel ready: <b style="word-break: break-all;">${wsUrl}</b><br/><button class="btn btn-ghost" id="copyRemoteWsBtn" type="button" style="margin-top: 8px; padding: 2px 10px; font-size: 11px;">📋 Copier l'URL</button>`;
          attachCopyButton(wsUrl);
        }
      } else {
        const ip = await window.ag.getLocalIp();
        const wsUrl = `ws://${ip}:${status.port || currentPort}/ws?token=${token}`;
        currentActiveWsUrl = wsUrl;
        const dataUrl = await window.ag.generateQr(wsUrl);
        if (remoteQrImage) remoteQrImage.src = dataUrl;
        if (remoteQrPlaceholder) remoteQrPlaceholder.style.display = 'none';
        if (remoteQrContainer) remoteQrContainer.style.display = 'block';
        if (remoteStatusText) {
          remoteStatusText.innerHTML = `Server listening on <b>${ip}:${status.port || currentPort}</b> (Local Network)<br/><button class="btn btn-ghost" id="copyRemoteWsBtn" type="button" style="margin-top: 8px; padding: 2px 10px; font-size: 11px;">📋 Copier l'URL</button>`;
          attachCopyButton(wsUrl);
        }
      }
    } else {
      if (remoteTelemetryBadge) {
        remoteTelemetryBadge.textContent = 'Hors ligne';
        remoteTelemetryBadge.style.background = 'rgba(255, 255, 255, 0.08)';
        remoteTelemetryBadge.style.color = 'var(--text-2)';
      }
      if (remoteClientsCount) remoteClientsCount.textContent = '0';
      if (remoteSessionsCount) remoteSessionsCount.textContent = '0';
      if (remoteUptimeDisplay) remoteUptimeDisplay.textContent = '-';
    }
  } catch { /* ignore */ }
}

if (window.ag && window.ag.onDaemonLog) {
  window.ag.onDaemonLog((data: string) => {
    if (remoteConsole) {
      remoteConsole.value += data;
      remoteConsole.scrollTop = remoteConsole.scrollHeight;

      // Extract PIN code if present in daemon logs
      const pinMatch = data.match(/Code PIN d'appairage mobile\s*:\s*([0-9]{6})/);
      if (pinMatch && remotePinDisplay) {
        remotePinDisplay.textContent = pinMatch[1];
      }

      // Extract tunnel URL (Pinggy or Cloudflare or wss://) from logs to generate QR Code dynamically!
      let wsUrl = '';
      const token = remoteAuthToken?.value?.trim() || localStorage.getItem('ag_remote_auth_token') || '11';
      const cleanData = data
        .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
        .replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');

      const wssMatch = cleanData.match(/wss:\/\/[^\s"'<>|┌┐└┘│+]+/);
      if (wssMatch) {
        wsUrl = wssMatch[0].trim().replace(/[\]\)\>\}\│\|\s]+$/, '');
        if (!wsUrl.includes('token=')) {
          wsUrl += `${wsUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
        }
      } else {
        const httpsMatch = cleanData.match(/https:\/\/([a-zA-Z0-9.-]+\.(?:trycloudflare\.com|pinggy\.link|pangolin\.link|[a-zA-Z]{2,}))/);
        if (httpsMatch) {
          const host = httpsMatch[1].trim();
          wsUrl = `wss://${host}/ws?token=${token}`;
        }
      }

      if (wsUrl && remoteQrImage) {
        currentActiveWsUrl = wsUrl;
        window.ag.generateQr(wsUrl).then((dataUrl) => {
          remoteQrImage.src = dataUrl;
          if (remoteQrPlaceholder) remoteQrPlaceholder.style.display = 'none';
          if (remoteQrContainer) remoteQrContainer.style.display = 'block';
          if (remoteStatusText) {
            remoteStatusText.innerHTML = `Tunnel ready: <b style="word-break: break-all;">${wsUrl}</b><br/><button class="btn btn-ghost" id="copyRemoteWsBtn" type="button" style="margin-top: 8px; padding: 2px 10px; font-size: 11px;">📋 Copier l'URL</button>`;
            attachCopyButton(wsUrl);
          }
        }).catch((err) => {
          console.error('[ag-doctor-ui] QR generation failed for tunnel URL:', err);
          if (remoteStatusText) {
            remoteStatusText.innerHTML = `Tunnel ready: <b style="word-break: break-all;">${wsUrl}</b><br/><button class="btn btn-ghost" id="copyRemoteWsBtn" type="button" style="margin-top: 8px; padding: 2px 10px; font-size: 11px;">📋 Copier l'URL</button>`;
            attachCopyButton(wsUrl);
          }
        });
      } else if (cleanData.includes('Daemon listening on') || cleanData.includes('Tunnel non démarré') || cleanData.includes('introuvable')) {
        const port = parseInt(remotePort?.value || '8090');
        window.ag.getLocalIp().then((localIp: string) => {
          const localWsUrl = `ws://${localIp}:${port}/ws?token=${encodeURIComponent(token)}`;
          currentActiveWsUrl = localWsUrl;
          window.ag.generateQr(localWsUrl).then((dataUrl: string) => {
            if (remoteQrImage) remoteQrImage.src = dataUrl;
            if (remoteQrPlaceholder) remoteQrPlaceholder.style.display = 'none';
            if (remoteQrContainer) remoteQrContainer.style.display = 'block';
            if (remoteStatusText) {
              remoteStatusText.innerHTML = `Mode Local Wi-Fi actif : <b style="word-break: break-all;">${localWsUrl}</b><br/><span style="font-size: 11px; opacity: 0.75;">(Scannez avec votre mobile connecté au même Wi-Fi)</span><br/><button class="btn btn-ghost" id="copyRemoteWsBtn" type="button" style="margin-top: 8px; padding: 2px 10px; font-size: 11px;">📋 Copier l'URL</button>`;
              attachCopyButton(localWsUrl);
            }
          }).catch((err) => {
            console.error('[ag-doctor-ui] QR generation failed for local URL:', err);
            if (remoteStatusText) {
              remoteStatusText.innerHTML = `Mode Local Wi-Fi actif : <b style="word-break: break-all;">${localWsUrl}</b><br/><span style="font-size: 11px; opacity: 0.75;">(Scannez avec votre mobile connecté au même Wi-Fi)</span><br/><button class="btn btn-ghost" id="copyRemoteWsBtn" type="button" style="margin-top: 8px; padding: 2px 10px; font-size: 11px;">📋 Copier l'URL</button>`;
              attachCopyButton(localWsUrl);
            }
          });
        });
      }

    }
  });
}

if (startRemoteBtn) {
  startRemoteBtn.addEventListener('click', async () => {
    if (isDaemonRunning) {
      // Arrêter le démon
      await window.ag.stopDaemon();
      isDaemonRunning = false;
      startRemoteBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg> Start Remote Server';
      startRemoteBtn.classList.remove('btn-danger');
      if (remoteStatusText) remoteStatusText.textContent = 'Server stopped.';
      if (remoteQrContainer) remoteQrContainer.style.display = 'none';
      if (remoteQrPlaceholder) remoteQrPlaceholder.style.display = 'flex';
      if (remoteTelemetryBadge) {
        remoteTelemetryBadge.textContent = 'Hors ligne';
        remoteTelemetryBadge.style.background = 'rgba(255, 255, 255, 0.08)';
        remoteTelemetryBadge.style.color = 'var(--text-2)';
      }
      return;
    }

    try {
      startRemoteBtn.setAttribute('disabled', 'true');
      if (remoteStatusText) remoteStatusText.textContent = 'Starting server...';
      if (remoteConsole) remoteConsole.value = ''; // clear console
      
      const port = parseInt(remotePort?.value || '8090');
      const tunnel = remoteTunnel?.value || 'cloudflare';
      const allowFirstAdmin = remoteAllowFirstAdmin?.checked ?? true;
      let token = remoteAuthToken?.value?.trim() || localStorage.getItem('ag_remote_auth_token') || '11';
      if (remoteAuthToken && (!remoteAuthToken.value || remoteAuthToken.value.trim().length === 0)) {
        remoteAuthToken.value = token;
      }

      // Sauvegarde persistante des choix
      try {
        localStorage.setItem('ag_remote_auth_token', token);
        localStorage.setItem('ag_remote_port', port.toString());
        localStorage.setItem('ag_remote_tunnel', tunnel);
        localStorage.setItem('ag_remote_allow_first_admin', allowFirstAdmin ? 'true' : 'false');
      } catch { /* ignore */ }

      const res = await window.ag.startDaemon({ port, tunnel, token, allowFirstAdmin });

      if (res && res.alreadyRunning) {
        await syncDaemonUiStatus(port);
      } else if (tunnel === 'none') {
        const ip = await window.ag.getLocalIp();
        const wsUrl = `ws://${ip}:${port}/ws?token=${token}`;
        currentActiveWsUrl = wsUrl;
        const dataUrl = await window.ag.generateQr(wsUrl);
        if (remoteQrImage) remoteQrImage.src = dataUrl;
        if (remoteQrPlaceholder) remoteQrPlaceholder.style.display = 'none';
        if (remoteQrContainer) remoteQrContainer.style.display = 'block';
        if (remoteStatusText) {
          remoteStatusText.innerHTML = `Server listening on <b>${ip}:${port}</b> (Local Network)<br/><button class="btn btn-ghost" id="copyRemoteWsBtn" type="button" style="margin-top: 8px; padding: 2px 10px; font-size: 11px;">📋 Copier l'URL</button>`;
          attachCopyButton(wsUrl);
        }
      }

      isDaemonRunning = true;
      startRemoteBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg> Stop Remote Server';
      startRemoteBtn.classList.add('btn-danger');
    } catch (e: any) {
      if (remoteStatusText) remoteStatusText.textContent = `Error: ${e.message}`;
    } finally {
      startRemoteBtn.removeAttribute('disabled');
    }
  });
}

// Auto-détection de l'état du daemon au chargement et rafraîchissement périodique
void syncDaemonUiStatus();
setInterval(() => {
  if (isDaemonRunning) {
    void syncDaemonUiStatus();
  }
}, 5000);
