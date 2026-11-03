/**
 * dom-utils.ts — Shared DOM helpers, memoization cache, status pill, and toast notifications.
 * Decoupled from the app.ts monolith for high cohesion and single responsibility.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Preload Bridge Types & Interfaces (Domain models)
// Note: AgAPI and RunResult are ambiently declared in types/globals.d.ts
// ─────────────────────────────────────────────────────────────────────────────

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
  accountName?: string;
  accountEmail?: string;
  providerId?: string;
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
  overrideActive?: boolean;
  recommendedSource?: 'auto' | 'override' | 'none';
  overrideInfo?: {
    range: string;
    reason: string | null;
    setAt: string | null;
  } | null;
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
// Memoization Cache for Repeated IPC Calls
// ─────────────────────────────────────────────────────────────────────────────

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const ipcCache = new Map<string, CacheEntry<unknown>>();
const ipcInflight = new Map<string, Promise<unknown>>();

async function memo<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const cached = ipcCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value as T;
  }
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

const inflightLoads = new Map<string, Promise<void>>();

function guardLoad(key: string, fn: () => Promise<void>): Promise<void> {
  const existing = inflightLoads.get(key);
  if (existing) return existing;
  const p = fn().finally(() => inflightLoads.delete(key));
  inflightLoads.set(key, p);
  return p;
}

// ─────────────────────────────────────────────────────────────────────────────
// Idle Scheduler
// ─────────────────────────────────────────────────────────────────────────────

interface IdleDeadlineShape {
  didTimeout: boolean;
  timeRemaining(): number;
}

type IdleHandle = number;
type IdleCallbackFn = (deadline: IdleDeadlineShape) => void;
type IdleRequestFn = (cb: IdleCallbackFn, opts?: { timeout: number }) => IdleHandle;

const idleScheduler = (() => {
  const win = typeof window !== 'undefined' ? (window as unknown as { requestIdleCallback?: IdleRequestFn }) : {};
  if (win.requestIdleCallback) {
    return {
      request: (cb: IdleCallbackFn, opts?: { timeout: number }) => win.requestIdleCallback!(cb, opts),
    };
  }
  return {
    request: (cb: IdleCallbackFn, opts?: { timeout: number }) =>
      setTimeout(
        () => cb({ didTimeout: true, timeRemaining: () => 0 }),
        opts?.timeout ?? 50,
      ) as unknown as IdleHandle,
  };
})();

function whenIdle(cb: () => void, timeout = 100): void {
  idleScheduler.request(() => cb(), { timeout });
}

// ─────────────────────────────────────────────────────────────────────────────
// Cached SVG Icons
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
// DOM Helpers
// ─────────────────────────────────────────────────────────────────────────────

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => {
  if (typeof document === 'undefined') return {} as T;
  const el = document.querySelector<T>(sel);
  if (!el) {
    return document.createElement('div') as unknown as T;
  }
  return el;
};

const $$ = <T extends HTMLElement = HTMLElement>(sel: string): T[] => {
  if (typeof document === 'undefined') return [];
  return Array.from(document.querySelectorAll<T>(sel));
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function maskKey(k?: string): string {
  if (!k) return '(none)';
  if (k.length <= 8) return '***';
  return `${k.slice(0, 3)}...${k.slice(-4)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Skeleton Loader Helpers
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
// Status Pill & Toasts
// ─────────────────────────────────────────────────────────────────────────────

function setStatus(text: string, kind: 'ready' | 'busy' | 'err' = 'ready'): void {
  const statusPill = $('#statusPill') as HTMLDivElement;
  const statusText = $('#statusText') as HTMLSpanElement;
  if (statusText) statusText.textContent = text;
  if (statusPill) {
    statusPill.classList.remove('busy', 'err');
    if (kind !== 'ready') statusPill.classList.add(kind);
  }
}

type ToastKind = 'ok' | 'err' | 'warn' | 'info';
const TOAST_ICONS: Record<ToastKind, string> = {
  ok: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  err: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
  warn: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  info: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
};

function toast(message: string, kind: ToastKind = 'info', durationMs = 3500): void {
  const toastContainer = $('#toastContainer') as HTMLDivElement;
  if (!toastContainer) return;
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `<div class="toast-icon">${TOAST_ICONS[kind]}</div><div>${escapeHtml(message)}</div>`;
  toastContainer.appendChild(el);
  setTimeout(() => {
    el.classList.add('removing');
    setTimeout(() => el.remove(), 250);
  }, durationMs);
}

function flashMitmBanner(): void {
  const banner = document.querySelector<HTMLElement>('[data-view="mitm"], #mitmBanner, .mitm-banner');
  if (banner) {
    banner.classList.add('flash-attention');
    banner.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => banner.classList.remove('flash-attention'), 2000);
  }
}

function runErrorAction(action: any): boolean {
  switch (action) {
    case 'open-mitm-view':
      if (typeof (window as any).navigate === 'function') {
        try {
          (window as any).navigate('mitm');
        } catch {
          flashMitmBanner();
        }
      } else {
        flashMitmBanner();
      }
      return true;
    case 'run-doctor':
      void (window as any).ag?.run(['doctor', '--fix']).catch(() => undefined);
      return true;
    case 'show-retry-toast':
      toast('Please retry the previous action. If it keeps failing, restore the patch.', 'warn', 5000);
      return true;
    default:
      return false;
  }
}

// Global modal manager instance
const modals = typeof (window as any).ModalManager === 'function'
  ? new (window as any).ModalManager()
  : (typeof ModalManager === 'function' ? new ModalManager() : null);

type ConfirmModalOpts = { confirmLabel?: string; cancelLabel?: string; danger?: boolean; confirmDisabled?: boolean };
function confirmModal(title: string, body: string, opts?: ConfirmModalOpts): Promise<boolean> {
  if (modals && typeof modals.confirm === 'function') {
    return modals.confirm(title, body, opts);
  }
  return Promise.resolve(confirm(`${title}\n\n${body}`));
}
