/**
 * Electron main process.
 * Creates the BrowserWindow, registers IPC handlers, and spawns the ag-doctor CLI.
 *
 * Performance optimizations:
 *  - CLI Worker Pool: long-lived Node.js processes that handle multiple commands via
 *    JSON-over-stdin. Eliminates per-call process spawn cost (~150-300ms each).
 *  - Cached asset paths and tray icons.
 *  - Streaming batches chunks to avoid IPC flooding.
 *  - No console-message forwarding in production.
 */
import { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, Notification, type NativeImage } from 'electron';
import path from 'path';
import { spawn, ChildProcess, execFile, execSync } from 'child_process';
import fs from 'fs';
import { getProxyManager } from './proxy-manager';
import { DOCTOR_IPC_CHANNELS } from './ipc/channels';
import { EnvironmentConfig } from './config/environment';
import {
  WORKER_CMD_TIMEOUT_MS,
  PROXY_STATS_MAX,
  PROXY_ERROR_HISTORY_MAX,
  TOOLTIP_TITLE_MAX,
  TOOLTIP_MSG_MAX,
  MAX_CLI_WORKERS,
  NOTIFY_DEDUP_MS,
  DEFAULT_STUB_PORT,
} from './constants';
import { detectAntigravityInstallations } from './services/installationDetector';

const isDev = !app.isPackaged;
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
const activeStreams = new Map<string, ChildProcess>();

// Disable GPU sandbox in packaged builds to avoid startup crashes on some Windows setups
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-software-rasterizer');

// ─────────────────────────────────────────────────────────────────────────────
// Cached paths (computed once)
// ─────────────────────────────────────────────────────────────────────────────

let _assetsPath: string | null = null;
let _cliPath: string | null = null;
let _configPath: string | null = null;

function getAssetsPath(): string {
  if (_assetsPath === null) {
    _assetsPath = app.isPackaged
      ? path.join(process.resourcesPath, 'assets')
      : path.join(__dirname, '..', '..', 'assets');
  }
  return _assetsPath;
}

function getCliPath(): string {
  if (_cliPath === null) {
    if (app.isPackaged) {
      _cliPath = path.join(process.resourcesPath, 'ag-doctor', 'bin', 'ag-doctor.js');
    } else {
      _cliPath = path.join(__dirname, '..', '..', 'ag-doctor', 'bin', 'ag-doctor.js');
    }
  }
  return _cliPath;
}

function getConfigPath(): string {
  if (_configPath === null) {
    _configPath = path.join(app.getPath('home'), '.gemini', 'antigravity', 'config.json');
  }
  return _configPath;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cached tray icons
// ─────────────────────────────────────────────────────────────────────────────

const trayIconCache = new Map<'ok' | 'warn' | 'err', NativeImage>();

function getTrayIcon(status: 'ok' | 'warn' | 'err'): NativeImage {
  const cached = trayIconCache.get(status);
  if (cached) return cached;
  const svgPath = path.join(getAssetsPath(), `tray-${status}.svg`);
  let img: NativeImage;
  if (fs.existsSync(svgPath)) {
    img = nativeImage.createFromPath(svgPath).resize({ width: 16, height: 16 });
  } else {
    const fallback = path.join(getAssetsPath(), 'icon.svg');
    if (fs.existsSync(fallback)) {
      img = nativeImage.createFromPath(fallback).resize({ width: 16, height: 16 });
    } else {
      img = nativeImage.createFromPath(svgPath);
    }
  }
  trayIconCache.set(status, img);
  return img;
}

const infoCache = {
  platform: process.platform,
  arch: process.arch,
  versions: process.versions,
  electron: process.versions.electron,
  node: process.versions.node,
  chrome: process.versions.chrome,
  cliPath: '' as string,
};
let infoCacheReady = false;
function getInfoPayload() {
  if (!infoCacheReady) {
    infoCache.cliPath = getCliPath();
    infoCacheReady = true;
  }
  return infoCache;
}

let configCache: Record<string, unknown> | null = null;
function getConfigPayload(): Record<string, unknown> {
  if (configCache) return configCache;
  try {
    const raw = fs.readFileSync(getConfigPath(), 'utf-8');
    configCache = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    configCache = { ui: { theme: 'dark' } };
  }
  return configCache;
}

function invalidateConfigCache(): void {
  configCache = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tray + proxy-error bridge
// ─────────────────────────────────────────────────────────────────────────────

let lastProxyError: { title: string; provider: string; message: string; at: number; traceId: string } | null = null;

const proxyErrorHistory: Array<{
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
}> = [];

function pushProxyErrorHistory(p: typeof proxyErrorHistory[number]): void {
  proxyErrorHistory.push(p);
  if (proxyErrorHistory.length > PROXY_ERROR_HISTORY_MAX) {
    proxyErrorHistory.splice(0, proxyErrorHistory.length - PROXY_ERROR_HISTORY_MAX);
  }
}

function isNotifyEnabled(): boolean {
  try {
    const cfg = getConfigPayload();
    const ui = cfg.ui as Record<string, unknown> | undefined;
    if (ui && typeof ui.notifyEnabled === 'boolean') return ui.notifyEnabled;
  } catch {
    // fall through
  }
  return true;
}

let lastNotifiedTraceId: string | null = null;
let lastNotifiedAt = 0;

function notifyProxyError(p: {
  traceId: string;
  provider: string;
  title: string;
  message: string;
}): void {
  if (!Notification.isSupported()) return;
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && mainWindow.isFocused()) return;
  if (p.traceId === lastNotifiedTraceId && Date.now() - lastNotifiedAt < NOTIFY_DEDUP_MS) return;
  lastNotifiedTraceId = p.traceId;
  lastNotifiedAt = Date.now();
  const n = new Notification({
    title: `${p.provider}: ${p.title}`.slice(0, 120),
    body: (p.message || '').slice(0, 180) || 'A provider request failed — open ag-doctor for details.',
    silent: false,
    urgency: 'critical' as const,
  });
  n.on('click', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send(DOCTOR_IPC_CHANNELS.PROXY_ERROR, {
        traceId: p.traceId || 'notify',
        provider: p.provider,
        errorType: 'notification-replay',
        rawError: p.message,
        title: p.title,
        message: p.message,
        suggestions: [],
      });
    }
  });
  n.show();
}

function updateTray(status: 'ok' | 'warn' | 'err'): void {
  if (!tray) return;
  tray.setImage(getTrayIcon(status));
  const tooltip = lastProxyError && status !== 'ok'
    ? `ag-doctor · ${status.toUpperCase()} · ${lastProxyError.provider}: ${lastProxyError.title.slice(0, TOOLTIP_TITLE_MAX)}`
    : `ag-doctor · ${status.toUpperCase()}`;
  tray.setToolTip(tooltip);
  tray.setContextMenu(buildTrayMenu());
}

function buildTrayMenu(): Menu {
  const items: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Open dashboard',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createWindow();
        }
      },
    },
    {
      label: 'Run doctor',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.send(DOCTOR_IPC_CHANNELS.RUN_DOCTOR);
        }
      },
    },
    { type: 'separator' },
  ];

  if (lastProxyError) {
    items.push({
      label: `Last error: ${lastProxyError.provider} — ${lastProxyError.title.slice(0, TOOLTIP_TITLE_MAX)}`,
      enabled: false,
    });
    items.push({
      label: 'Show details',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.send(DOCTOR_IPC_CHANNELS.PROXY_ERROR, {
            traceId: 'tray',
            provider: lastProxyError!.provider,
            errorType: 'tray-replay',
            rawError: lastProxyError!.message,
            title: lastProxyError!.title,
            message: lastProxyError!.message.slice(0, TOOLTIP_MSG_MAX),
            suggestions: [],
          });
        }
      },
    });
    items.push({
      label: 'Clear error',
      click: () => {
        lastProxyError = null;
        updateTray('ok');
      },
    });
    items.push({ type: 'separator' });
  }

  items.push({
    label: 'Quit',
    click: () => {
      app.quit();
    },
  });

  return Menu.buildFromTemplate(items);
}

function createTray(): void {
  tray = new Tray(getTrayIcon('ok'));
  tray.setToolTip('ag-doctor');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    icon: path.join(getAssetsPath(), 'icon.png'),
    backgroundColor: '#0a0e1a',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0a0e1a',
      symbolColor: '#e8eef9',
      height: 36,
    },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  const showFallback = setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.show();
    }
  }, 2000);

  mainWindow.once('ready-to-show', () => {
    clearTimeout(showFallback);
    mainWindow?.show();
  });

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[main] did-fail-load: ${code} ${desc} ${url}`);
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error(`[main] render-process-gone: ${JSON.stringify(details)}`);
  });

  if (isDev) {
    mainWindow.webContents.on('console-message', (_e, _level, message) => {
      console.log(`[renderer] ${message}`);
    });
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev && process.env.OPEN_DEVTOOLS === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('close', (e) => {
    if (process.platform === 'darwin') {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI Worker Pool
// ─────────────────────────────────────────────────────────────────────────────

interface CliWorker {
  proc: ChildProcess;
  busy: boolean;
  pending: {
    resolve: (val: { code: number; stdout: string; stderr: string }) => void;
    reject: (err: Error) => void;
  } | null;
  buffer: string;
  errBuffer: string;
}

class CliWorkerPool {
  private workers: CliWorker[] = [];
  private readonly maxWorkers = MAX_CLI_WORKERS;
  private readonly cliPath: string;
  private nextId = 1;
  private readonly waitQueue: Array<{
    args: string[];
    resolve: (val: { code: number; stdout: string; stderr: string }) => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
  }> = [];

  constructor(cliPath: string) {
    this.cliPath = cliPath;
  }

  private spawnWorker(): CliWorker | null {
    if (!fs.existsSync(this.cliPath)) return null;
    const proc = spawn(process.execPath, [this.cliPath, '--worker'], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', AG_WORKER_ID: String(this.nextId++) },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const worker: CliWorker = { proc, busy: false, pending: null, buffer: '', errBuffer: '' };
    proc.stdout?.on('data', (chunk: Buffer) => this.handleData(worker, chunk));
    proc.stderr?.on('data', (chunk: Buffer) => {
      worker.errBuffer += chunk.toString();
      if (isDev && worker.errBuffer.trim()) {
        console.warn(`[pool:worker-${worker.proc.pid}] stderr:`, worker.errBuffer.slice(-500));
      }
    });
    proc.on('close', () => this.handleClose(worker));
    proc.on('error', (err) => this.handleError(worker, err));
    this.workers.push(worker);
    return worker;
  }

  private handleData(worker: CliWorker, chunk: Buffer): void {
    worker.buffer += chunk.toString();
    let idx: number;
    while ((idx = worker.buffer.indexOf('\n')) >= 0) {
      const line = worker.buffer.slice(0, idx);
      worker.buffer = worker.buffer.slice(idx + 1);
      if (!line) continue;
      if (worker.pending) {
        try {
          const msg = JSON.parse(line);
          worker.pending.resolve({
            code: msg.code ?? 0,
            stdout: msg.stdout ?? '',
            stderr: msg.stderr ?? '',
          });
        } catch {
          worker.pending.resolve({ code: 0, stdout: line, stderr: '' });
        }
        worker.pending = null;
        worker.busy = false;
        this.dispatchNext();
      }
    }
  }

  private handleClose(worker: CliWorker): void {
    if (worker.pending) {
      worker.pending.reject(new Error('CLI worker closed unexpectedly'));
      worker.pending = null;
    }
    worker.busy = false;
    const idx = this.workers.indexOf(worker);
    if (idx >= 0) this.workers.splice(idx, 1);

    if (this.waitQueue.length > 0 && this.workers.length === 0 && !fs.existsSync(this.cliPath)) {
      const err = new Error('CLI worker pool exhausted — no workers available');
      for (const item of this.waitQueue) {
        clearTimeout(item.timer);
        item.reject(err);
      }
      this.waitQueue.length = 0;
      return;
    }
    this.dispatchNext();
  }

  private handleError(worker: CliWorker, err: Error): void {
    if (worker.pending) {
      worker.pending.reject(err);
      worker.pending = null;
    }
    worker.busy = false;
  }

  private dispatchNext(): void {
    if (this.waitQueue.length === 0) return;
    const idle = this.workers.find((w) => !w.busy);
    if (!idle) {
      if (this.workers.length < this.maxWorkers) {
        const w = this.spawnWorker();
        if (w) {
          const next = this.waitQueue.shift()!;
          clearTimeout(next.timer);
          this.runOn(w, next.args).then(next.resolve).catch(next.reject);
        }
      }
      return;
    }
    const next = this.waitQueue.shift()!;
    clearTimeout(next.timer);
    this.runOn(idle, next.args).then(next.resolve).catch(next.reject);
  }

  private async runOn(
    worker: CliWorker,
    args: string[],
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      worker.busy = true;
      const timer = setTimeout(() => {
        if (worker.pending) {
          worker.pending = null;
          worker.busy = false;
          try { worker.proc.kill(); } catch { /* ignore */ }
          reject(new Error(`CLI worker timed out after ${WORKER_CMD_TIMEOUT_MS / 1000}s running: ${args.join(' ')}`));
        }
      }, WORKER_CMD_TIMEOUT_MS);

      worker.pending = {
        resolve: (val) => { clearTimeout(timer); resolve(val); },
        reject:  (err) => { clearTimeout(timer); reject(err); },
      };

      try {
        worker.proc.stdin?.write(JSON.stringify({ args }) + '\n');
      } catch (err) {
        clearTimeout(timer);
        worker.pending = null;
        worker.busy = false;
        reject(err as Error);
      }
    });
  }

  async run(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
    if (!fs.existsSync(this.cliPath)) {
      return { code: -1, stdout: '', stderr: `CLI not found: ${this.cliPath}` };
    }
    const idle = this.workers.find((w) => !w.busy);
    if (idle) return this.runOn(idle, args);

    if (this.workers.length < this.maxWorkers) {
      const w = this.spawnWorker();
      if (w) return this.runOn(w, args);
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waitQueue.findIndex((q) => q.timer === timer);
        if (idx >= 0) this.waitQueue.splice(idx, 1);
        reject(new Error(`CLI command timed out in queue after ${WORKER_CMD_TIMEOUT_MS / 1000}s: ${args.join(' ')}`));
      }, WORKER_CMD_TIMEOUT_MS);
      this.waitQueue.push({ args, resolve, reject, timer });
    });
  }

  shutdown(): void {
    const shutdownErr = new Error('Worker pool is shutting down');
    for (const item of this.waitQueue) {
      clearTimeout(item.timer);
      item.reject(shutdownErr);
    }
    this.waitQueue.length = 0;
    for (const w of this.workers) {
      try { w.proc.stdin?.end(); } catch { /* ignore */ }
      try { w.proc.kill(); } catch { /* ignore */ }
    }
    this.workers = [];
  }
}

let cliPool: CliWorkerPool | null = null;
function getCliPool(): CliWorkerPool {
  if (!cliPool) cliPool = new CliWorkerPool(getCliPath());
  return cliPool;
}

// ─────────────────────────────────────────────────────────────────────────────
// IPC Handlers
// ─────────────────────────────────────────────────────────────────────────────

function getCustomModelsPath(): string {
  return path.join(app.getPath('home'), '.gemini', 'antigravity', 'custom_models.json');
}

// Real-time File Watcher
let watcherDebounce: NodeJS.Timeout | null = null;
try {
  const customModelsPath = getCustomModelsPath();
  const customModelsDir = path.dirname(customModelsPath);
  if (!fs.existsSync(customModelsDir)) {
    fs.mkdirSync(customModelsDir, { recursive: true });
  }
  fs.watch(customModelsDir, (_eventType, filename) => {
    if (filename && filename.includes('custom_models.json')) {
      if (watcherDebounce) clearTimeout(watcherDebounce);
      watcherDebounce = setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(DOCTOR_IPC_CHANNELS.PROVIDERS_CHANGED);
        }
      }, 300);
    }
  });
} catch { /* ignore watcher errors */ }

// Secure External Link & Network Handlers
ipcMain.handle(DOCTOR_IPC_CHANNELS.NETWORK_GET_LOCAL_IP, async () => {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]!) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return EnvironmentConfig.bindHost;
});

ipcMain.handle(DOCTOR_IPC_CHANNELS.NETWORK_GENERATE_QR, async (_event, text: string) => {
  const qrcode = require('qrcode');
  try {
    const dataUrl = await qrcode.toDataURL(text, { width: 256, margin: 2, color: { dark: '#000000FF', light: '#FFFFFFFF' } });
    return dataUrl;
  } catch (e: any) {
    throw new Error('Failed to generate QR code: ' + e.message);
  }
});

let daemonProcess: any = null;

function killOrphanDaemonProcesses(): void {
  try {
    execSync('taskkill /F /IM daemon.exe /T 2>nul & taskkill /F /IM cloudflared.exe /T 2>nul', { stdio: 'ignore', windowsHide: true });
  } catch { /* ignore */ }
}

ipcMain.handle(DOCTOR_IPC_CHANNELS.NETWORK_GET_DAEMON_STATUS, async (_event, customPort?: number, token?: string) => {
  const port = customPort || EnvironmentConfig.daemonPort || 8090;
  const authToken = token || '11';
  let running = false;
  let diagData: any = {};
  let healthData: any = {};

  try {
    const res = await fetch(`http://127.0.0.1:${port}/health/diagnostic?token=${encodeURIComponent(authToken)}`, { signal: AbortSignal.timeout(1500) });
    if (res.ok) {
      diagData = await res.json();
      running = true;
    }
  } catch { /* offline */ }

  try {
    const hRes = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: { Authorization: `Bearer ${authToken}` },
      signal: AbortSignal.timeout(1500),
    });
    if (hRes.ok) {
      healthData = await hRes.json();
      running = true;
    }
  } catch { /* ignore */ }

  return { running, port, ...diagData, telemetry: healthData };
});

ipcMain.handle(DOCTOR_IPC_CHANNELS.NETWORK_START_DAEMON, async (event, options: { port: number; tunnel: string; token: string; allowFirstAdmin?: boolean }) => {
  const port = options.port || EnvironmentConfig.daemonPort || 8090;
  const token = (options.token && options.token.trim().length > 0) ? options.token.trim() : '11';

  // Vérifie si un daemon est déjà actif et répond sur ce port (évite conflits et double-lancement)
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health/diagnostic?token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(1500) });
    if (res.ok) {
      const data: any = await res.json();
      event.sender.send(DOCTOR_IPC_CHANNELS.NETWORK_DAEMON_LOG, `> Daemon déjà actif et opérationnel sur le port ${port} (PID ${data.pid || 'actif'})\n`);
      if (data.publicUrl) {
        event.sender.send(DOCTOR_IPC_CHANNELS.NETWORK_DAEMON_LOG, `🚀 Tunnel public actif : ${data.publicUrl}\n`);
      }
      return { success: true, alreadyRunning: true, port, token, ...data };
    }
  } catch { /* Daemon non démarré sur ce port, lancement normal */ }

  if (daemonProcess) {
    daemonProcess.kill();
    daemonProcess = null;
  }

  killOrphanDaemonProcesses();

  const daemonExePath = path.join(__dirname, '..', '..', 'remote', 'daemon', 'daemon.exe');
  const args = ['--port', port.toString()];
  if (options.tunnel && options.tunnel !== 'none') {
    args.push('--tunnel', options.tunnel);
  }
  args.push('--auth-token', token);
  if (options.allowFirstAdmin) {
    args.push('--allow-first-admin');
  }

  const daemonDir = path.dirname(daemonExePath);
  const daemonBinDir = path.join(daemonDir, 'bin');
  const envPath = `${daemonDir}${path.delimiter}${daemonBinDir}${path.delimiter}${process.env.PATH || ''}`;

  daemonProcess = spawn(daemonExePath, args, {
    cwd: daemonDir,
    windowsHide: true,
    env: {
      ...process.env,
      PATH: envPath,
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  daemonProcess.stdout?.on('data', (data: Buffer) => {
    event.sender.send(DOCTOR_IPC_CHANNELS.NETWORK_DAEMON_LOG, data.toString());
  });

  daemonProcess.stderr?.on('data', (data: Buffer) => {
    event.sender.send(DOCTOR_IPC_CHANNELS.NETWORK_DAEMON_LOG, data.toString());
  });

  daemonProcess.on('close', (code: number) => {
    event.sender.send(DOCTOR_IPC_CHANNELS.NETWORK_DAEMON_LOG, `[Daemon terminé avec le code ${code}]\n`);
    daemonProcess = null;
  });

  return { success: true, alreadyRunning: false, port, token };
});

ipcMain.handle(DOCTOR_IPC_CHANNELS.NETWORK_STOP_DAEMON, async (event) => {
  if (daemonProcess) {
    daemonProcess.kill();
    daemonProcess = null;
  }
  killOrphanDaemonProcesses();
  event.sender.send(DOCTOR_IPC_CHANNELS.NETWORK_DAEMON_LOG, `> Daemon arrêté manuellement.\n`);
  return { success: true };
});

ipcMain.handle(DOCTOR_IPC_CHANNELS.OPEN_EXTERNAL, async (_event, url: string) => {
  try {
    if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
      await shell.openExternal(url);
    } else {
      console.warn(`[IPC] Blocked unsafe external URL opening attempt: ${url}`);
    }
  } catch (err) {
    console.error('[IPC] Failed to open external URL:', err);
  }
});

// --- Provider Management IPCs ---
ipcMain.handle(DOCTOR_IPC_CHANNELS.PROVIDERS_GET, async () => {
  try {
    const p = getCustomModelsPath();
    const c = await fs.promises.readFile(p, 'utf8');
    const parsed = JSON.parse(c.replace(/^\uFEFF/, ''));
    if (parsed.providers) return parsed.providers;
    
    if (parsed.models && parsed.models.length > 0) {
      const pm = new Map();
      let pid = 1;
      for (const m of parsed.models) {
        const k = m.apiUrl + '|' + m.provider + '|' + m.apiKey;
        if (!pm.has(k)) {
          pm.set(k, {
            id: 'provider-' + Date.now() + '-' + (pid++),
            name: 'Legacy ' + m.provider,
            provider: m.provider,
            apiUrl: m.apiUrl,
            apiKey: m.apiKey,
            enabled: true,
            models: []
          });
        }
        pm.get(k).models.push({
          id: m.externalModelName || m.name,
          displayName: m.displayName || m.name,
          enabled: m.enabled !== false
        });
      }
      return Array.from(pm.values());
    }
    return [];
  } catch {
    return [];
  }
});

ipcMain.handle(DOCTOR_IPC_CHANNELS.PROVIDERS_SAVE, async (_, p) => {
  try {
    const fp = getCustomModelsPath();
    let parsed: { providers: any[]; models: any[] } = { providers: [], models: [] };
    try {
      const c = await fs.promises.readFile(fp, 'utf8');
      parsed = JSON.parse(c.replace(/^\uFEFF/, ''));
    } catch {}

    if (!parsed.providers) parsed.providers = [];
    const idx = parsed.providers.findIndex((x: any) => x.id === p.id);
    if (idx !== -1) parsed.providers[idx] = p;
    else parsed.providers.push(p);

    if (Array.isArray(parsed.models) && Array.isArray(p.models)) {
      for (const pm of p.models) {
        const pmId = pm.id || pm.displayName;
        if (!pmId) continue;
        const cleanId = pmId.startsWith('models/') ? pmId.slice(7) : pmId;
        const mIdx = parsed.models.findIndex(m => {
          const mClean = (m.name || '').startsWith('models/') ? (m.name || '').slice(7) : (m.name || '');
          const urlMatch = !p.apiUrl || !m.apiUrl || p.apiUrl.toLowerCase() === m.apiUrl.toLowerCase();
          return (m.name === pmId || m.name === `models/${pmId}` || mClean === cleanId) && urlMatch;
        });
        if (mIdx !== -1) {
          parsed.models[mIdx].enabled = pm.enabled !== false && p.enabled !== false;
        }
      }
    }

    await fs.promises.writeFile(fp, JSON.stringify(parsed, null, 2), 'utf8');
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(DOCTOR_IPC_CHANNELS.PROVIDERS_CHANGED);
    return { success: true };
  } catch(e) {
    return { success: false, error: (e as Error).message };
  }
});

ipcMain.handle(DOCTOR_IPC_CHANNELS.PROVIDERS_DELETE, async (_, id) => {
  try {
    const fp = getCustomModelsPath();
    const c = await fs.promises.readFile(fp, 'utf8');
    const parsed = JSON.parse(c.replace(/^\uFEFF/, ''));
    if (parsed.providers) {
      parsed.providers = parsed.providers.filter((x: any) => x.id !== id);
      await fs.promises.writeFile(fp, JSON.stringify(parsed, null, 2), 'utf8');
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(DOCTOR_IPC_CHANNELS.PROVIDERS_CHANGED);
    }
    return { success: true };
  } catch(e) {
    return { success: false, error: (e as Error).message };
  }
});

ipcMain.handle(DOCTOR_IPC_CHANNELS.PROVIDERS_FETCH_MODELS, async (_evt, params: { apiUrl: string; apiKey: string }) => {
  try {
    const { net } = require('electron') as typeof import('electron');
    const baseUrl = params.apiUrl.replace(/\/+$/, '');
    const url = baseUrl.endsWith('/models') ? baseUrl : `${baseUrl}/models`;

    return new Promise((resolve) => {
      const req = net.request({ url, method: 'GET' });
      if (params.apiKey && !params.apiKey.startsWith('enc:')) {
        req.setHeader('Authorization', 'Bearer ' + params.apiKey);
      }
      req.on('response', (res: Electron.IncomingMessage) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const parsed = JSON.parse(data);
              let rawList: any[] = [];
              if (Array.isArray(parsed.data)) rawList = parsed.data;
              else if (Array.isArray(parsed.models)) rawList = parsed.models;
              else if (Array.isArray(parsed)) rawList = parsed;

              const models = rawList.map((m: any) => {
                const id = typeof m === 'string' ? m : (m.id || m.name || 'unknown');
                const displayName = typeof m === 'string' ? m : (m.displayName || m.name || m.id || 'unknown');
                return { id, displayName, enabled: true };
              });
              resolve({ success: true, models });
            } catch {
              resolve({ success: false, error: 'Invalid JSON response from /models endpoint' });
            }
          } else {
            resolve({ success: false, error: `HTTP ${res.statusCode}: ${data ? data.slice(0, 150) : 'Failed to fetch models'}` });
          }
        });
      });
      req.on('error', (err: Error) => resolve({ success: false, error: err.message }));
      req.end();
    });
  } catch(e) {
    return { success: false, error: (e as Error).message };
  }
});

ipcMain.handle(DOCTOR_IPC_CHANNELS.PROVIDERS_TEST, async (_evt: Electron.IpcMainInvokeEvent, params: { apiUrl: string; apiKey: string; id?: string; modelId?: string }) => {
   try {
     const { net } = require('electron') as typeof import('electron');
     const startTime = Date.now();

     const doRequest = (targetUrl: string, method: string, body?: string): Promise<{ statusCode: number; data: string; latencyMs: number }> => {
       return new Promise((resolve, reject) => {
         const req = net.request({ url: targetUrl, method });
         if (params.apiKey && !params.apiKey.startsWith('enc:')) {
           req.setHeader('Authorization', 'Bearer ' + params.apiKey);
         }
         if (body) {
           req.setHeader('Content-Type', 'application/json');
         }
         req.on('response', (res: Electron.IncomingMessage) => {
           let data = '';
           res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
           res.on('end', () => {
             resolve({ statusCode: res.statusCode ?? 500, data, latencyMs: Date.now() - startTime });
           });
         });
         req.on('error', (err: Error) => reject(err));
         if (body) req.write(body);
         req.end();
       });
     };

     const baseUrl = params.apiUrl.replace(/\/+$/, '');
     let statusCode = 500;
     let responseData = '';
     let latencyMs = 0;

     if (params.modelId) {
       try {
         const postBody = JSON.stringify({
           model: params.modelId,
           messages: [{ role: 'user', content: 'ping' }],
           max_tokens: 1
         });
         const postRes = await doRequest(`${baseUrl}/chat/completions`, 'POST', postBody);
         statusCode = postRes.statusCode;
         responseData = postRes.data;
         latencyMs = postRes.latencyMs;
       } catch (err) {
         responseData = (err as Error).message;
       }
     } else {
       try {
         const res = await doRequest(`${baseUrl}/models`, 'GET');
         statusCode = res.statusCode;
         responseData = res.data;
         latencyMs = res.latencyMs;
       } catch (err) {
         responseData = (err as Error).message;
       }

       if (statusCode < 200 || statusCode >= 300) {
         let testModel: string | undefined = undefined;
         if (params.id) {
           try {
             const fp = getCustomModelsPath();
             const c = await fs.promises.readFile(fp, 'utf8');
             const parsed = JSON.parse(c.replace(/^\uFEFF/, ''));
             const prov = (parsed.providers || []).find((x: any) => x.id === params.id);
             if (prov && prov.models && prov.models.length > 0) {
               testModel = prov.models[0].id || prov.models[0].name;
             }
           } catch { /* ignore */ }
         }
         if (!testModel) testModel = 'MiniMax-M3';

         try {
           const postBody = JSON.stringify({
             model: testModel,
             messages: [{ role: 'user', content: 'ping' }],
             max_tokens: 1
           });
           const postRes = await doRequest(`${baseUrl}/chat/completions`, 'POST', postBody);
           if (postRes.statusCode >= 200 && postRes.statusCode < 300) {
             statusCode = postRes.statusCode;
             responseData = postRes.data;
             latencyMs = postRes.latencyMs;
           } else if (postRes.statusCode === 401 || postRes.statusCode === 403) {
             statusCode = postRes.statusCode;
             responseData = postRes.data;
             latencyMs = postRes.latencyMs;
           }
         } catch { /* keep original */ }
       }
     }

     const isSuccess = statusCode >= 200 && statusCode < 300;
     const healthStatus = isSuccess
       ? (latencyMs >= 1500 ? 'degraded' : 'healthy')
       : (statusCode === 429 ? 'degraded' : 'offline');

     const result = {
       success: isSuccess,
       status: statusCode,
       latencyMs,
       healthStatus,
       error: isSuccess ? undefined : (responseData || `HTTP ${statusCode}`)
     };

     if (params.id) {
       try {
         const fp = getCustomModelsPath();
         const c = await fs.promises.readFile(fp, 'utf8');
         const parsed = JSON.parse(c.replace(/^\uFEFF/, ''));
         if (parsed.providers && Array.isArray(parsed.providers)) {
           const idx = parsed.providers.findIndex((x: any) => x.id === params.id);
           if (idx !== -1) {
             parsed.providers[idx].status = result.healthStatus;
             parsed.providers[idx].latencyMs = result.latencyMs;
             parsed.providers[idx].lastTestedAt = new Date().toISOString();
             parsed.providers[idx].lastError = result.error;
             await fs.promises.writeFile(fp, JSON.stringify(parsed, null, 2), 'utf8');
           }
         }
       } catch { /* ignore */ }
     }

     return result;
   } catch(e) {
     const err = e as Error;
     return { success: false, healthStatus: 'offline' as const, error: err.message };
   }
});

ipcMain.handle(DOCTOR_IPC_CHANNELS.RUN, async (_evt, args: string[]) => {
  return getCliPool().run(args);
});

ipcMain.handle(DOCTOR_IPC_CHANNELS.INFO, async () => {
  return getInfoPayload();
});

ipcMain.handle(DOCTOR_IPC_CHANNELS.CONFIG, async () => {
  return getConfigPayload();
});

ipcMain.handle(DOCTOR_IPC_CHANNELS.CONFIG_SET_THEME, async (_evt, theme: 'dark' | 'light') => {
  try {
    const cfgPath = getConfigPath();
    let cfg: Record<string, unknown> = {};
    if (fs.existsSync(cfgPath)) {
      cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    }
    cfg.ui = { ...(typeof cfg.ui === 'object' && cfg.ui !== null ? cfg.ui : {}), theme };
    fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
    configCache = cfg;
    mainWindow?.webContents.send(DOCTOR_IPC_CHANNELS.THEME_CHANGED, theme);
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle(DOCTOR_IPC_CHANNELS.CONFIG_SET_NOTIFY, async (_evt, enabled: boolean) => {
  try {
    const cfgPath = getConfigPath();
    let cfg: Record<string, unknown> = {};
    if (fs.existsSync(cfgPath)) {
      cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    }
    cfg.ui = { ...(typeof cfg.ui === 'object' && cfg.ui !== null ? cfg.ui : {}), notifyEnabled: !!enabled };
    fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
    configCache = cfg;
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle(DOCTOR_IPC_CHANNELS.CONFIG_RESTORE_BACKUP, async () => {
  try {
    const customModelsPath = getCustomModelsPath();
    const bakPath = `${customModelsPath}.bak`;
    if (!fs.existsSync(bakPath)) {
      return { success: false, error: 'No backup file (.bak) found' };
    }
    const content = fs.readFileSync(bakPath, 'utf8');
    JSON.parse(content);
    fs.copyFileSync(bakPath, customModelsPath);
    invalidateConfigCache();
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to restore backup (invalid JSON format)' };
  }
});

ipcMain.handle(DOCTOR_IPC_CHANNELS.PROXY_ERROR_HISTORY, async () => {
  return proxyErrorHistory.slice().reverse();
});

ipcMain.on(DOCTOR_IPC_CHANNELS.PROXY_ERROR, (_evt, payload: {
  traceId: string;
  provider: string;
  status?: number;
  errorType: string;
  rawError: string;
  title: string;
  message: string;
  suggestions: string[];
  actionUrl?: string;
}) => {
  if (!payload || !payload.title) return;
  const sev: 'warn' | 'err' = payload.status && payload.status >= 500
    || payload.errorType === 'auth_401' || payload.errorType === 'auth_403'
    || payload.errorType === 'quota_429' || payload.errorType === 'timeout'
    ? 'err'
    : 'warn';
  lastProxyError = {
    title: payload.title,
    provider: payload.provider,
    message: payload.message || payload.rawError,
    at: Date.now(),
    traceId: payload.traceId,
  };
  updateTray(sev);
  pushProxyErrorHistory({
    traceId: payload.traceId,
    provider: payload.provider,
    status: payload.status,
    errorType: payload.errorType,
    rawError: payload.rawError,
    title: payload.title,
    message: payload.message,
    suggestions: payload.suggestions ?? [],
    actionUrl: payload.actionUrl,
    at: Date.now(),
  });
  if (sev === 'err' && isNotifyEnabled()) {
    notifyProxyError({
      traceId: payload.traceId,
      provider: payload.provider,
      title: payload.title,
      message: payload.message || payload.rawError,
    });
  }
});

ipcMain.handle(DOCTOR_IPC_CHANNELS.NOTIFY, async (_evt, title: string, body: string) => {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
});

ipcMain.handle(DOCTOR_IPC_CHANNELS.TRAY_STATUS, async (_evt, status: 'ok' | 'warn' | 'err') => {
  updateTray(status);
});

ipcMain.handle(DOCTOR_IPC_CHANNELS.REVEAL, async (_evt, p: string) => {
  shell.showItemInFolder(p);
});

// MITM Proxy Server Management
ipcMain.handle(DOCTOR_IPC_CHANNELS.PROXY_START, async () => {
  try {
    const proxyManager = getProxyManager();
    return await proxyManager.start();
  } catch (err) {
    return { ok: false, message: `Failed to start proxy: ${(err as Error).message}` };
  }
});

ipcMain.handle(DOCTOR_IPC_CHANNELS.PROXY_STOP, async () => {
  try {
    const proxyManager = getProxyManager();
    return await proxyManager.stop();
  } catch (err) {
    return { ok: false, message: `Failed to stop proxy: ${(err as Error).message}` };
  }
});

ipcMain.handle(DOCTOR_IPC_CHANNELS.PROXY_STATUS, async () => {
  try {
    const proxyManager = getProxyManager();
    const status = await proxyManager.getStatus();
    return { ok: true, data: status };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
});

ipcMain.handle(DOCTOR_IPC_CHANNELS.PROXY_RESTART, async () => {
  try {
    const proxyManager = getProxyManager();
    return await proxyManager.restart();
  } catch (err) {
    return { ok: false, message: `Failed to restart proxy: ${(err as Error).message}` };
  }
});

// Antigravity Lifecycle
ipcMain.handle(DOCTOR_IPC_CHANNELS.ANTIGRAVITY_STATUS, async () => {
  const r = await getCliPool().run(['antigravity', 'status', '--json']);
  if (r.code !== 0 && r.code !== 1) {
    return { ok: false, error: r.stderr || r.stdout || `exit ${r.code}` };
  }
  try {
    return { ok: true, data: JSON.parse(r.stdout) };
  } catch (e) {
    return { ok: false, error: `parse failed: ${(e as Error).message}` };
  }
});

ipcMain.handle(DOCTOR_IPC_CHANNELS.ANTIGRAVITY_VERSION, async () => {
  const r = await getCliPool().run(['antigravity', 'version', '--json']);
  try {
    return { ok: true, data: JSON.parse(r.stdout) };
  } catch {
    return { ok: true, data: { version: r.stdout.trim() } };
  }
});

ipcMain.handle(DOCTOR_IPC_CHANNELS.ANTIGRAVITY_LAUNCH, async () => {
  const r = await getCliPool().run(['antigravity', 'launch', '--json']);
  try {
    return { ok: true, data: JSON.parse(r.stdout) };
  } catch {
    return { ok: true, data: { ok: r.code === 0, message: r.stdout.trim() } };
  }
});

ipcMain.handle(DOCTOR_IPC_CHANNELS.ANTIGRAVITY_KILL, async () => {
  const r = await getCliPool().run(['antigravity', 'kill', '--json']);
  try {
    return { ok: true, data: JSON.parse(r.stdout) };
  } catch {
    return { ok: true, data: { killed: 0, message: r.stdout.trim() } };
  }
});

ipcMain.handle(DOCTOR_IPC_CHANNELS.ANTIGRAVITY_RESTART, async () => {
  const r = await getCliPool().run(['antigravity', 'restart', '--json']);
  try {
    return { ok: true, data: JSON.parse(r.stdout) };
  } catch {
    return { ok: true, data: { ok: r.code === 0, message: r.stdout.trim() } };
  }
});

ipcMain.handle(DOCTOR_IPC_CHANNELS.ANTIGRAVITY_LAUNCH_LOGS, async (evt) => {
  const streamId = `launch-logs-${Date.now()}`;
  const cli = getCliPath();
  if (!fs.existsSync(cli)) {
    evt.sender.send(`ag:stream:${streamId}:error`, `CLI not found: ${cli}`);
    return streamId;
  }
  const proc = spawn(process.execPath, [cli, 'antigravity', 'launch-logs'], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    windowsHide: true,
  });
  activeStreams.set(streamId, proc);

  let pending: { stdout: string; stderr: string } | null = null;
  let flushTimer: NodeJS.Timeout | null = null;
  const flush = () => {
    if (pending && (pending.stdout || pending.stderr)) {
      if (!evt.sender.isDestroyed()) {
        evt.sender.send(`ag:stream:${streamId}:data`, pending.stdout + pending.stderr);
      }
    }
    pending = null;
    flushTimer = null;
  };
  const schedule = () => {
    if (!flushTimer) flushTimer = setTimeout(flush, 50);
  };

  proc.stdout?.on('data', (d: Buffer) => {
    if (!pending) pending = { stdout: '', stderr: '' };
    pending.stdout += d.toString();
    schedule();
  });
  proc.stderr?.on('data', (d: Buffer) => {
    if (!pending) pending = { stdout: '', stderr: '' };
    pending.stderr += d.toString();
    schedule();
  });
  proc.on('close', (code) => {
    flush();
    if (!evt.sender.isDestroyed()) {
      evt.sender.send(`ag:stream:${streamId}:close`, code ?? 0);
    }
    activeStreams.delete(streamId);
  });
  proc.on('error', (err) => {
    if (!evt.sender.isDestroyed()) {
      evt.sender.send(`ag:stream:${streamId}:error`, err.message);
    }
    activeStreams.delete(streamId);
  });
  return streamId;
});

// Dynamic Installation Detector
ipcMain.handle(DOCTOR_IPC_CHANNELS.DETECT_INSTALLATION, async () => {
  try {
    const result = detectAntigravityInstallations();
    return { ok: true, data: result };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

// Proxy Stats
const proxyStatsHistory: Array<{ ts: number; latencyMs: number; ok: boolean }> = [];

ipcMain.handle(DOCTOR_IPC_CHANNELS.PROXY_STATS, async () => {
  const start = Date.now();
  try {
    const result = await new Promise<{ ok: boolean; latencyMs: number; stub: boolean; error?: string }>((resolve) => {
      const req = require('http').request(
        { hostname: EnvironmentConfig.bindHost, port: EnvironmentConfig.stubPort, path: '/health', method: 'GET', timeout: 2000 },
        (res: { statusCode: number; headers: Record<string, string>; resume: () => void }) => {
          res.resume();
          resolve({
            ok: true,
            latencyMs: Date.now() - start,
            stub: res.headers['x-proxy-stub'] === '1',
          });
        },
      );
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, latencyMs: 0, stub: false, error: 'timeout' }); });
      req.on('error', (err: Error) => resolve({ ok: false, latencyMs: 0, stub: false, error: err.message }));
      req.end();
    });

    proxyStatsHistory.push({ ts: Date.now(), latencyMs: result.latencyMs, ok: result.ok });
    if (proxyStatsHistory.length > PROXY_STATS_MAX) proxyStatsHistory.shift();

    return {
      ok: true,
      data: {
        current: result,
        history: [...proxyStatsHistory],
        uptime: proxyStatsHistory.length > 0 ? Date.now() - proxyStatsHistory[0].ts : 0,
      },
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

ipcMain.handle(DOCTOR_IPC_CHANNELS.TEST_MODEL, async (_evt, name: string) => {
  try {
    const r = await getCliPool().run(['models', 'test', name, '--json']);
    try {
      return { ok: true, data: JSON.parse(r.stdout) };
    } catch {
      return { ok: r.code === 0, data: { ok: r.code === 0, message: r.stdout.trim() || r.stderr.trim() } };
    }
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

async function isPortInUse(port: number, host = EnvironmentConfig.bindHost): Promise<boolean> {
  return new Promise((resolve) => {
    const net = require('net') as typeof import('net');
    const tester = net.createServer()
      .once('error', () => resolve(true))
      .once('listening', () => tester.close(() => resolve(false)))
      .listen(port, host);
  });
}

ipcMain.handle(DOCTOR_IPC_CHANNELS.PROXY_START_STUB, async () => {
  try {
    const stubPath = path.join(getCliPath(), '..', '..', '..', 'proxy-stub.js');
    const resolved = path.resolve(stubPath);
    if (!fs.existsSync(resolved)) {
      return { ok: false, error: `proxy-stub.js not found at ${resolved}` };
    }
    const child = spawn(process.execPath, [resolved], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', AG_STUB_PORT: String(EnvironmentConfig.stubPort) },
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      await new Promise<void>((r) => setTimeout(r, 200));
      const alive = await new Promise<boolean>((resolve) => {
        const req = require('http').request(
          { hostname: EnvironmentConfig.bindHost, port: EnvironmentConfig.stubPort, path: '/health', method: 'GET', timeout: 1000 },
          (res: { resume: () => void }) => { res.resume(); resolve(true); },
        );
        req.on('error', () => resolve(false));
        req.end();
      });
      if (alive) return { ok: true, pid: child.pid, port: EnvironmentConfig.stubPort };
    }
    return { ok: true, pid: child.pid, port: EnvironmentConfig.stubPort, note: 'started but port not yet open' };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

ipcMain.handle(DOCTOR_IPC_CHANNELS.PROXY_CHECK_MAIN_PORT, async () => {
  try {
    const MAIN_PORT = EnvironmentConfig.proxyPort;
    const inUse = await isPortInUse(MAIN_PORT);
    if (inUse) {
      let processInfo = 'unknown';
      try {
        if (process.platform === 'win32') {
          const out = execSync(`netstat -ano | findstr :${MAIN_PORT}`, { encoding: 'utf-8', windowsHide: true });
          processInfo = out.trim().split('\n')[0] || 'unknown';
        } else {
          const out = execSync(`lsof -i :${MAIN_PORT} -P -n 2>/dev/null | tail -n +2 | head -n 1`, { encoding: 'utf-8' });
          processInfo = out.trim() || 'unknown';
        }
      } catch { /* best effort */ }
      return { ok: true, inUse: true, port: MAIN_PORT, process: processInfo };
    }
    return { ok: true, inUse: false, port: MAIN_PORT };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

ipcMain.handle(DOCTOR_IPC_CHANNELS.PROXY_KILL_MAIN_PORT, async () => {
  try {
    const MAIN_PORT = EnvironmentConfig.proxyPort;
    return await new Promise<{ ok: boolean; killed?: string; error?: string }>((resolve) => {
      if (process.platform === 'win32') {
        try {
          const netstatOut = execSync(`netstat -ano | findstr :${MAIN_PORT}`, { encoding: 'utf-8', windowsHide: true });
          const pids = new Set<string>();
          for (const l of netstatOut.trim().split('\n')) {
            const match = l.trim().match(/\s+(\d+)$/);
            if (match && match[1] && match[1] !== '0') pids.add(match[1]);
          }
          for (const pid of pids) {
            execFile('taskkill', ['/F', '/PID', pid], () => {});
          }
          resolve({ ok: true, killed: `PIDs: ${Array.from(pids).join(', ')}` });
        } catch (e) {
          resolve({ ok: false, error: (e as Error).message });
        }
      } else {
        const { exec } = require('child_process');
        exec(`lsof -ti :${MAIN_PORT} | xargs -r kill -9`, (err: Error | null, stdout: string) => {
          if (err) resolve({ ok: false, error: err.message });
          else resolve({ ok: true, killed: stdout.trim() || 'no process found' });
        });
      }
    });
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

ipcMain.handle(DOCTOR_IPC_CHANNELS.REPAIR_RUN, async () => {
  try {
    const isWin = process.platform === 'win32';
    const scriptName = isWin ? 'repair-all.ps1' : 'repair-all.sh';
    const scriptPath = app.isPackaged
      ? path.join(process.resourcesPath, scriptName)
      : path.join(__dirname, '..', 'resources', scriptName);

    if (!fs.existsSync(scriptPath)) {
      return { ok: false, error: `Repair script not found at ${scriptPath}` };
    }

    const tempFile = isWin ? path.join(process.env.TEMP || '', 'ag-repair-result.json') : '/tmp/ag-repair-result.json';
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);

    await new Promise<void>((resolve, reject) => {
      let proc;
      if (isWin) {
        proc = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `Start-Process powershell.exe -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"' -Verb RunAs -Wait -WindowStyle Hidden`], {
          windowsHide: true,
          stdio: 'ignore'
        });
      } else {
        proc = spawn('bash', [scriptPath], {
          stdio: 'ignore'
        });
      }

      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Repair script exited with code ${code}`));
      });
      proc.on('error', reject);
    });

    if (fs.existsSync(tempFile)) {
      const data = JSON.parse(fs.readFileSync(tempFile, 'utf-8'));
      fs.unlinkSync(tempFile);
      return { ok: true, ...data };
    }
    return { ok: true, proxy: false, ca: false, error: 'Result file not found' };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

ipcMain.handle(DOCTOR_IPC_CHANNELS.STREAM_START, (evt, args: string[], streamId: string) => {
  const cli = getCliPath();
  if (!fs.existsSync(cli)) {
    evt.sender.send(`ag:stream:${streamId}:error`, `CLI not found: ${cli}`);
    return false;
  }
  const proc = spawn(process.execPath, [cli, ...args], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    windowsHide: true,
  });
  activeStreams.set(streamId, proc);

  let pending: { stdout: string; stderr: string } | null = null;
  let flushTimer: NodeJS.Timeout | null = null;
  const flush = () => {
    if (pending && (pending.stdout || pending.stderr)) {
      if (!evt.sender.isDestroyed()) {
        evt.sender.send(`ag:stream:${streamId}:data`, pending.stdout + pending.stderr);
      }
    }
    pending = null;
    flushTimer = null;
  };
  const schedule = () => {
    if (!flushTimer) flushTimer = setTimeout(flush, 50);
  };

  proc.stdout?.on('data', (d: Buffer) => {
    if (!pending) pending = { stdout: '', stderr: '' };
    pending.stdout += d.toString();
    schedule();
  });
  proc.stderr?.on('data', (d: Buffer) => {
    if (!pending) pending = { stdout: '', stderr: '' };
    pending.stderr += d.toString();
    schedule();
  });
  proc.on('close', (code) => {
    flush();
    if (!evt.sender.isDestroyed()) {
      evt.sender.send(`ag:stream:${streamId}:close`, code ?? 0);
    }
    activeStreams.delete(streamId);
  });
  proc.on('error', (err) => {
    if (!evt.sender.isDestroyed()) {
      evt.sender.send(`ag:stream:${streamId}:error`, err.message);
    }
    activeStreams.delete(streamId);
  });
  return true;
});

ipcMain.handle(DOCTOR_IPC_CHANNELS.STREAM_CANCEL, (_evt, streamId: string) => {
  const proc = activeStreams.get(streamId);
  if (proc) {
    proc.kill();
    activeStreams.delete(streamId);
    return true;
  }
  return false;
});

app.whenReady().then(() => {
  createWindow();
  createTray();

  mainWindow?.webContents.on('before-input-event', (_e, input) => {
    if (input.control && input.key.toLowerCase() === 'r') {
      mainWindow?.webContents.send(DOCTOR_IPC_CHANNELS.RUN_DOCTOR);
    } else if (input.control && input.key.toLowerCase() === 'l') {
      mainWindow?.webContents.send(DOCTOR_IPC_CHANNELS.NAVIGATE, 'logs');
    } else if (input.control && input.key.toLowerCase() === 'k') {
      mainWindow?.webContents.send(DOCTOR_IPC_CHANNELS.COMMAND_PALETTE);
    } else if (input.control && input.key.toLowerCase() === ',') {
      mainWindow?.webContents.send(DOCTOR_IPC_CHANNELS.NAVIGATE, 'settings');
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else mainWindow?.show();
  });
});

app.on('window-all-closed', () => {
  for (const proc of activeStreams.values()) proc.kill();
  activeStreams.clear();
  cliPool?.shutdown();

  try {
    if (typeof daemonProcess !== 'undefined' && daemonProcess) {
      daemonProcess.kill();
      daemonProcess = null;
    }
  } catch { /* ignore */ }
  try {
    killOrphanDaemonProcesses();
  } catch { /* ignore */ }
  
  try {
    getProxyManager().cleanup();
  } catch (err) {
    console.error('[App] Failed to cleanup proxy manager:', err);
  }
  
  if (process.platform !== 'darwin') app.quit();
});

app.on('web-contents-created', (_e, contents) => {
  contents.on('will-navigate', (event, url) => {
    const parsed = new URL(url);
    if (parsed.protocol !== 'file:') {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
});
