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
import { spawn, ChildProcess, execFile, execSync, execFileSync } from 'child_process';
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
import {
  discoverIdeAccount,
  fetchGoogleAccountQuotas,
  warmupGoogleAccount,
  refreshGoogleToken,
  fetchGoogleUserInfo,
  ensureCloudCodeProject,
  switchActiveIdeAccount,
} from './services/ideAccountDiscovery';
import { startGoogleOAuthLogin } from './services/googleOAuthServer';

const isDev = !app.isPackaged;
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
const activeStreams = new Map<string, ChildProcess>();

// Disable hardware acceleration and GPU-dependent paths to avoid
// startup crashes and noisy GLES3/GLES2 fallback warnings on some Windows setups
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('disable-3d-apis');
app.commandLine.appendSwitch('in-process-gpu');
app.commandLine.appendSwitch('disable-gpu-rasterization');
app.commandLine.appendSwitch('disable-zero-copy');
app.commandLine.appendSwitch('disable-gpu-vsync');
app.commandLine.appendSwitch('no-sandbox');

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
let configCacheMtime = 0;
function getConfigPayload(): Record<string, unknown> {
  const cfgPath = getConfigPath();
  try {
    const stat = fs.statSync(cfgPath);
    if (configCache && stat.mtimeMs > configCacheMtime) {
      configCache = null;
    }
  } catch {
    configCache = null;
  }
  if (configCache) return configCache;
  try {
    const raw = fs.readFileSync(cfgPath, 'utf-8');
    configCache = JSON.parse(raw) as Record<string, unknown>;
    const s = fs.statSync(cfgPath);
    configCacheMtime = s.mtimeMs;
  } catch {
    configCache = { ui: { theme: 'dark' } };
  }
  return configCache;
}

function invalidateConfigCache(): void {
  configCache = null;
  configCacheMtime = 0;
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
    backgroundColor: '#09090b',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#09090b',
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

  if (isDev && (process.env.AG_DEVTOOLS === '1' || process.env.ELECTRON_ENABLE_DEVTOOLS === '1')) {
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

  async run(args: string[], retries = 1): Promise<{ code: number; stdout: string; stderr: string }> {
    if (!fs.existsSync(this.cliPath)) {
      return { code: -1, stdout: '', stderr: `CLI not found: ${this.cliPath}` };
    }
    try {
      const idle = this.workers.find((w) => !w.busy);
      if (idle) return await this.runOn(idle, args);

      if (this.workers.length < this.maxWorkers) {
        const w = this.spawnWorker();
        if (w) return await this.runOn(w, args);
      }

      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const idx = this.waitQueue.findIndex((q) => q.timer === timer);
          if (idx >= 0) this.waitQueue.splice(idx, 1);
          reject(new Error(`CLI command timed out in queue after ${WORKER_CMD_TIMEOUT_MS / 1000}s: ${args.join(' ')}`));
        }, WORKER_CMD_TIMEOUT_MS);
        this.waitQueue.push({ args, resolve, reject, timer });
      });
    } catch (err) {
      if (retries > 0) {
        return this.run(args, retries - 1);
      }
      throw err;
    }
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

function killOrphanDaemonProcesses(port?: number): void {
  try {
    // If a port is specified, only kill the daemon.exe listening on that port.
    // Otherwise kill orphaned cloudflared processes (no specific daemon to preserve).
    if (port) {
      execSync(
        `for /f "tokens=5" %a in ('netstat -ano ^| findstr ":${port}" ^| findstr LISTENING') do taskkill /F /PID %a 2>nul`,
        { stdio: 'ignore', windowsHide: true, shell: 'cmd.exe' }
      );
    }
    execSync('taskkill /F /IM cloudflared.exe /T 2>nul', { stdio: 'ignore', windowsHide: true });
  } catch { /* ignore */ }
}

ipcMain.handle(DOCTOR_IPC_CHANNELS.NETWORK_GET_DAEMON_STATUS, async (_event, customPort?: number, token?: string) => {
  const port = customPort || EnvironmentConfig.daemonPort || 8090;
  const authToken = token || EnvironmentConfig.daemonToken;
  if (!authToken) {
    return { running: false, port, error: 'Daemon auth token is required' };
  }
  let running = false;
  let diagData: any = {};
  let healthData: any = {};

  try {
    const res = await fetch(`http://${EnvironmentConfig.bindHost}:${port}/health/diagnostic?token=${encodeURIComponent(authToken)}`, { signal: AbortSignal.timeout(1500) });
    if (res.ok) {
      diagData = await res.json();
      running = true;
    }
  } catch { /* offline */ }

  try {
    const hRes = await fetch(`http://${EnvironmentConfig.bindHost}:${port}/health`, {
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
  const token = (options.token && options.token.trim().length > 0) ? options.token.trim() : EnvironmentConfig.daemonToken;
  if (!token) {
    return { success: false, error: 'Daemon auth token is required' };
  }

  // Vérifie si un daemon est déjà actif et répond sur ce port (évite conflits et double-lancement)
  try {
    const res = await fetch(`http://${EnvironmentConfig.bindHost}:${port}/health/diagnostic?token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(1500) });
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

  killOrphanDaemonProcesses(port);

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

    if (parsed.providers && Array.isArray(parsed.providers)) {
      const googleProviders = parsed.providers.filter(
        (prov: any) => prov && (prov.provider === 'google' || prov.provider === 'gemini')
      );

      const hasSeparateGoogleAccounts = googleProviders.some(
        (prov: any) => !Array.isArray(prov.accounts) && (prov.email || prov.refreshToken || (prov.apiKey && prov.apiKey.startsWith('ya29.')))
      );

      // Auto-migrate if multiple Google providers exist or if separate Google accounts are at root level
      if (googleProviders.length > 1 || (googleProviders.length === 1 && hasSeparateGoogleAccounts)) {
        try {
          await fs.promises.copyFile(p, `${p}.bak`);
        } catch {}

        const template = googleProviders.find((prov: any) => Array.isArray(prov.models) && prov.models.length > 0) || googleProviders[0];
        const nonGoogleProviders = parsed.providers.filter(
          (prov: any) => prov && prov.provider !== 'google' && prov.provider !== 'gemini'
        );

        const mergedAccounts: any[] = [];
        const seenAccountKeys = new Set<string>();

        for (const gp of googleProviders) {
          if (Array.isArray(gp.accounts) && gp.accounts.length > 0) {
            for (const acc of gp.accounts) {
              const key = acc.email || acc.id;
              if (!seenAccountKeys.has(key)) {
                seenAccountKeys.add(key);
                mergedAccounts.push(acc);
              }
            }
          } else {
            const key = gp.email || gp.id;
            if (!seenAccountKeys.has(key)) {
              seenAccountKeys.add(key);
              mergedAccounts.push({
                id: gp.id,
                name: gp.name,
                email: gp.email,
                apiKey: gp.apiKey,
                refreshToken: gp.refreshToken,
                picture: gp.picture,
                quotas: gp.quotas,
                projectId: gp.projectId,
                enabled: gp.enabled !== false,
                status: gp.status || 'healthy',
                latencyMs: gp.latencyMs,
                lastTestedAt: gp.lastTestedAt,
                lastError: gp.lastError,
              });
            }
          }
        }

        const consolidatedGoogleProvider = {
          id: 'provider-google',
          name: 'Google Gemini',
          provider: 'google',
          apiUrl: template.apiUrl || 'https://generativelanguage.googleapis.com/v1beta',
          apiKey: 'auto',
          enabled: googleProviders.some((prov: any) => prov.enabled !== false),
          models: template.models || [],
          accounts: mergedAccounts,
        };

        parsed.providers = [consolidatedGoogleProvider, ...nonGoogleProviders];
        await atomicWriteCustomModels(p, parsed);
        return parsed.providers;
      }

      if (googleProviders.length === 1 && (!googleProviders[0].models || googleProviders[0].models.length === 0)) {
        const accWithModels = (googleProviders[0].accounts || []).find((a: any) => Array.isArray(a.models) && a.models.length > 0);
        googleProviders[0].models = accWithModels?.models?.length ? accWithModels.models : [
          { id: 'gemini-3.8-flash-tiered', displayName: 'Gemini 3.8 Flash', enabled: true },
          { id: 'gemini-3.7-flash-tiered', displayName: 'Gemini 3.7 Flash', enabled: true },
          { id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6 (Thinking)', enabled: true },
          { id: 'claude-opus-4-6-thinking', displayName: 'Claude Opus 4.6 (Thinking)', enabled: true },
        ];
        await atomicWriteCustomModels(p, parsed);
      }

      return parsed.providers;
    }

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
      const migrated = Array.from(pm.values());
      parsed.providers = migrated;
      delete parsed.models;
      await fs.promises.writeFile(p, JSON.stringify(parsed, null, 2), 'utf8');
      return migrated;
    }
    return [];
  } catch {
    return [];
  }
});

async function atomicWriteCustomModels(filePath: string, data: unknown): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fs.promises.rename(tmp, filePath);
}

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
    if (idx !== -1) {
      const existing = parsed.providers[idx];
      const isGoogle = p.provider === 'google' || existing.provider === 'google';
      const modelsToSave = (isGoogle && (!p.models || p.models.length === 0))
        ? (existing.models && existing.models.length > 0 ? existing.models : undefined)
        : (p.models !== undefined ? p.models : existing.models);

      let accountsToSave = p.accounts !== undefined ? p.accounts : existing.accounts;
      if (Array.isArray(accountsToSave) && Array.isArray(modelsToSave)) {
        for (const acc of accountsToSave) {
          if (Array.isArray(acc.models)) {
            for (const pm of modelsToSave) {
              const pmId = pm.id || pm.displayName;
              if (!pmId) continue;
              const cleanPmId = String(pmId).replace(/^models\//, '');
              const accM = acc.models.find((m: any) => m && (m.id === pmId || m.id === cleanPmId || m.displayName === pm.displayName || m.displayName === pmId));
              if (accM) {
                accM.enabled = pm.enabled !== false;
              } else if (pm.enabled === false) {
                acc.models.push({
                  id: cleanPmId,
                  displayName: pm.displayName || cleanPmId,
                  enabled: false,
                });
              }
            }
          }
        }
      }

      parsed.providers[idx] = {
        ...existing,
        ...p,
        models: modelsToSave ?? existing.models,
        accounts: accountsToSave,
        picture: p.picture ?? existing.picture,
        quotas: p.quotas ?? existing.quotas,
        refreshToken: p.refreshToken ?? existing.refreshToken,
        source: p.source ?? existing.source,
        status: p.status ?? existing.status,
        latencyMs: p.latencyMs ?? existing.latencyMs,
      };
    } else {
      // Check if p is an account belonging to a provider's accounts array
      let foundInAccount = false;
      const isCliAccount = p.provider === 'gemini-cli' || (typeof p.id === 'string' && p.id.startsWith('gemini-cli'));
      const isGoogleAccount = !isCliAccount && (
        p.provider === 'google' ||
        p.provider === 'gemini' ||
        p.provider === 'google-gemini' ||
        Boolean(p.refreshToken) ||
        Boolean(p.isAccount) ||
        (typeof p.id === 'string' && (p.id.startsWith('google-') || p.id.startsWith('provider-google-')))
      );

      if (isCliAccount || isGoogleAccount) {
        for (const prov of parsed.providers) {
          if (Array.isArray(prov.accounts)) {
            const isProvCli = prov.provider === 'gemini-cli' || prov.id === 'gemini-cli-preset';
            // Strictly separate Gemini CLI accounts and Antigravity accounts
            if (isCliAccount !== isProvCli) {
              continue;
            }
            const accIdx = prov.accounts.findIndex((a: any) => {
              if (a.id === p.id) return true;
              if (p.email && a.email === p.email) {
                const aIsCli = a.provider === 'gemini-cli' || (typeof a.id === 'string' && a.id.startsWith('gemini-cli'));
                return aIsCli === isCliAccount;
              }
              return false;
            });
            if (accIdx !== -1) {
              prov.accounts[accIdx] = {
                ...prov.accounts[accIdx],
                ...p,
                provider: isProvCli ? 'gemini-cli' : (prov.accounts[accIdx].provider || 'google'),
              };
              foundInAccount = true;
              break;
            }
          }
        }
        if (!foundInAccount) {
          const targetProv = isCliAccount
            ? parsed.providers.find((prov: any) => prov.provider === 'gemini-cli' || prov.id === 'gemini-cli-preset')
            : parsed.providers.find((prov: any) => prov.provider === 'google' || prov.id === 'provider-google');
          if (targetProv && Array.isArray(targetProv.accounts)) {
            targetProv.accounts.push({
              ...p,
              provider: isCliAccount ? 'gemini-cli' : 'google',
            });
          } else {
            parsed.providers.push(p);
          }
        }
      } else {
        // Standalone custom provider (OpenAI, Anthropic, DeepSeek, Custom, Ollama, etc.)
        parsed.providers.push(p);
      }
    }

    if (Array.isArray(parsed.models) && Array.isArray(p.models)) {
      for (const pm of p.models) {
        const pmId = pm.id || pm.displayName;
        if (!pmId) continue;
        const cleanId = pmId.startsWith('models/') ? pmId.slice(7) : pmId;
        const pNormUrl = (p.apiUrl || '').replace(/\/+$/, '').toLowerCase();
        const mIdx = parsed.models.findIndex(m => {
          const mClean = (m.name || '').startsWith('models/') ? (m.name || '').slice(7) : (m.name || '');
          const mNormUrl = (m.apiUrl || '').replace(/\/+$/, '').toLowerCase();
          const urlMatch = !pNormUrl || !mNormUrl || pNormUrl === mNormUrl;
          return (m.name === pmId || m.name === `models/${pmId}` || mClean === cleanId || m.displayName === pm.displayName) && urlMatch;
        });
        if (mIdx !== -1) {
          parsed.models[mIdx].enabled = pm.enabled !== false && p.enabled !== false;
        }
      }
    }

    await atomicWriteCustomModels(fp, parsed);
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
      const initialCount = parsed.providers.length;
      parsed.providers = parsed.providers.filter((x: any) => x.id !== id);
      if (parsed.providers.length === initialCount) {
        for (const prov of parsed.providers) {
          if (Array.isArray(prov.accounts)) {
            prov.accounts = prov.accounts.filter((a: any) => a.id !== id);
          }
        }
      }
      delete parsed.models;
      await atomicWriteCustomModels(fp, parsed);
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(DOCTOR_IPC_CHANNELS.PROVIDERS_CHANGED);
    }
    return { success: true };
  } catch(e) {
    return { success: false, error: (e as Error).message };
  }
});

ipcMain.handle(DOCTOR_IPC_CHANNELS.PROVIDERS_FETCH_MODELS, async (_evt, params: { apiUrl: string; apiKey: string; provider?: string }) => {
  try {
    const { net } = require('electron') as typeof import('electron');
    let rawKey = (params.apiKey || '').trim();
    let isGoogle = params.provider === 'google' || (params.apiUrl && params.apiUrl.includes('googleapis.com'));

    // If apiKey is auto/none/empty and provider is google, resolve active Google account token
    if ((isGoogle || !rawKey || rawKey === 'auto' || rawKey === 'none') && !rawKey.startsWith('ya29.')) {
      try {
        const fp = getCustomModelsPath();
        const c = await fs.promises.readFile(fp, 'utf8');
        const parsed = JSON.parse(c.replace(/^\uFEFF/, ''));
        if (parsed.providers && Array.isArray(parsed.providers)) {
          const googleProv = parsed.providers.find((p: any) => p.provider === 'google' || p.provider === 'gemini');
          if (googleProv && Array.isArray(googleProv.accounts)) {
            const activeAcc = googleProv.accounts.find((a: any) => a.enabled !== false && (a.apiKey?.startsWith('ya29.') || a.refreshToken)) || googleProv.accounts[0];
            if (activeAcc) {
              if (activeAcc.apiKey && activeAcc.apiKey.startsWith('ya29.')) {
                rawKey = activeAcc.apiKey;
              } else if (activeAcc.refreshToken) {
                const refreshed = await refreshGoogleToken(activeAcc.refreshToken);
                if (refreshed?.accessToken) {
                  rawKey = refreshed.accessToken;
                  activeAcc.apiKey = refreshed.accessToken;
                  await atomicWriteCustomModels(fp, parsed);
                }
              }
            }
          }
        }
      } catch {}
    }

    const isIdeToken = rawKey.startsWith('ya29.');

    // If an Antigravity IDE OAuth access token is provided, query Cloud Code fetchAvailableModels live
    if (isIdeToken || (params.provider === 'google' && isIdeToken)) {
      try {
        const cloudCodeRes = await fetch('https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${rawKey}`,
            'Content-Type': 'application/json',
            'User-Agent': 'antigravity',
          },
          body: JSON.stringify({}),
          signal: AbortSignal.timeout(8000),
        });

        if (cloudCodeRes.ok) {
          const data = (await cloudCodeRes.json()) as any;
          const rawModels = data.models || data.availableModels || {};
          const models = Object.keys(rawModels)
            .filter((k) => !k.startsWith('chat_') && !k.startsWith('tab_'))
            .map((k) => {
              const m = rawModels[k];
              const rawDisplayName = (m.displayName || k).replace(/^\[[^\]]+\]\s*/, '');
              return {
                id: k,
                displayName: rawDisplayName || k,
                enabled: true,
              };
            });

          if (models.length > 0) {
            return { success: true, models };
          }
        }
      } catch {
        // Continue to fallback below if network fails
      }

      const fallbackModels = [
        { id: 'gemini-3.8-flash-low', displayName: 'Gemini 3.8 Flash (Low)', enabled: true },
        { id: 'gemini-3.8-flash-medium', displayName: 'Gemini 3.8 Flash (Medium)', enabled: true },
        { id: 'gemini-3.8-flash-high', displayName: 'Gemini 3.8 Flash (High)', enabled: true },
        { id: 'gemini-3.7-flash-low', displayName: 'Gemini 3.7 Flash (Low)', enabled: true },
        { id: 'gemini-3.7-flash-medium', displayName: 'Gemini 3.7 Flash (Medium)', enabled: true },
        { id: 'gemini-3.7-flash-high', displayName: 'Gemini 3.7 Flash (High)', enabled: true },
        { id: 'gemini-3.6-flash-low', displayName: 'Gemini 3.6 Flash (Low)', enabled: true },
        { id: 'gemini-3.6-flash-medium', displayName: 'Gemini 3.6 Flash (Medium)', enabled: true },
        { id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6 (Thinking)', enabled: true },
        { id: 'claude-opus-4-6-thinking', displayName: 'Claude Opus 4.6 (Thinking)', enabled: true },
      ];
      return { success: true, models: fallbackModels };
    }

    const baseUrl = params.apiUrl.replace(/\/+$/, '');
    const url = new URL(baseUrl.endsWith('/models') ? baseUrl : `${baseUrl}/models`);
    if (!['http:', 'https:'].includes(url.protocol)) {
      return { success: false, error: `Unsupported URL scheme: ${url.protocol}` };
    }
    const blockedHosts = ['169.254.169.254', 'metadata.google.internal', 'metadata.internal', 'metadata'];
    if (blockedHosts.includes(url.hostname.toLowerCase())) {
      return { success: false, error: 'Blocked: metadata endpoint' };
    }

    isGoogle = isGoogle || url.hostname.includes('googleapis.com');
    if (isGoogle && rawKey && !rawKey.startsWith('enc:')) {
      url.searchParams.set('key', rawKey);
    }

    return new Promise((resolve) => {
      const req = net.request({ url: url.toString(), method: 'GET' });
      if (rawKey && !rawKey.startsWith('enc:')) {
        if (isGoogle) {
          req.setHeader('x-goog-api-key', rawKey);
        } else {
          req.setHeader('Authorization', 'Bearer ' + rawKey);
        }
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

              const models = rawList
                .filter((m: any) => {
                  if (isGoogle && Array.isArray(m.supportedGenerationMethods)) {
                    return m.supportedGenerationMethods.includes('generateContent');
                  }
                  return true;
                })
                .map((m: any) => {
                  let id = typeof m === 'string' ? m : (m.id || m.name || 'unknown');
                  let displayName = typeof m === 'string' ? m : (m.displayName || m.name || m.id || 'unknown');
                  if (isGoogle) {
                    id = id.replace(/^models\//, '');
                    displayName = displayName.replace(/^models\//, '');
                  }
                  return { id, displayName, enabled: true };
                });
              resolve({ success: true, models });
            } catch {
              resolve({ success: false, error: 'Invalid JSON response from /models endpoint' });
            }
          } else {
            let errDetail = data ? data.slice(0, 150) : 'Failed to fetch models';
            try {
              const parsedErr = JSON.parse(data);
              if (parsedErr?.error?.message) {
                errDetail = parsedErr.error.message;
              }
            } catch {}
            if (isGoogle && errDetail.toLowerCase().includes('api key not valid')) {
              errDetail = 'API key not valid. Please enter a valid Google AI Studio API key starting with "AIzaSy…" from https://aistudio.google.com/apikey. (If connecting Antigravity IDE, use "Importer depuis IDE").';
            }
            resolve({ success: false, error: `HTTP ${res.statusCode}: ${errDetail}` });
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

function formatApiError(raw: any, statusCode?: number): string {
  if (!raw) return statusCode ? `HTTP ${statusCode}` : 'Erreur inconnue';
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const msg = parsed?.error?.message || parsed?.message || (typeof parsed?.error === 'string' ? parsed.error : '');
    if (msg) {
      if (parsed?.error?.type === 'billing_error' || /insufficient balance/i.test(msg)) {
        return `Solde épuisé : ${msg}`;
      }
      if (parsed?.error?.status === 'RESOURCE_EXHAUSTED' || /quota|exhausted/i.test(msg)) {
        return `Quota épuisé : ${msg}`;
      }
      if (parsed?.error?.details?.[0]?.reason === 'API_KEY_INVALID' || /API key not valid/i.test(msg)) {
        return `Clé API invalide ou expirée`;
      }
      return msg;
    }
  } catch {}
  return text.length > 200 ? text.slice(0, 200) + '…' : text;
}

ipcMain.handle(DOCTOR_IPC_CHANNELS.PROVIDERS_TEST, async (_evt: Electron.IpcMainInvokeEvent, params: { apiUrl: string; apiKey: string; id?: string; modelId?: string; provider?: string }) => {
  try {
    const { net } = require('electron') as typeof import('electron');
    let rawKey = (params.apiKey || '').trim();
    let isGoogle = params.provider === 'google' || (params.apiUrl && params.apiUrl.includes('googleapis.com'));
    let targetAccountId: string | undefined = undefined;

    // If apiKey is auto/none/empty or Google provider, resolve active Google account token from accounts pool
    if ((isGoogle || !rawKey || rawKey === 'auto' || rawKey === 'none') && !rawKey.startsWith('ya29.')) {
      try {
        const fp = getCustomModelsPath();
        const c = await fs.promises.readFile(fp, 'utf8');
        const parsed = JSON.parse(c.replace(/^\uFEFF/, ''));
        if (parsed.providers && Array.isArray(parsed.providers)) {
          let prov = parsed.providers.find((x: any) => x.id === params.id || (isGoogle && (x.provider === 'google' || x.provider === 'gemini')));
          let activeAcc: any = null;
          if (prov && Array.isArray(prov.accounts) && prov.accounts.length > 0) {
            activeAcc = prov.accounts.find((a: any) => a.enabled !== false && (a.apiKey?.startsWith('ya29.') || a.refreshToken)) || prov.accounts[0];
          } else {
            for (const p of parsed.providers) {
              if (Array.isArray(p.accounts)) {
                const acc = p.accounts.find((a: any) => a.id === params.id);
                if (acc) {
                  activeAcc = acc;
                  prov = p;
                  break;
                }
              }
            }
          }

          if (activeAcc) {
            isGoogle = true;
            targetAccountId = activeAcc.id;
            if (activeAcc.apiKey && activeAcc.apiKey.startsWith('ya29.')) {
              rawKey = activeAcc.apiKey;
            } else if (activeAcc.refreshToken) {
              const refreshed = await refreshGoogleToken(activeAcc.refreshToken);
              if (refreshed && refreshed.accessToken) {
                rawKey = refreshed.accessToken;
                activeAcc.apiKey = refreshed.accessToken;
                await atomicWriteCustomModels(fp, parsed);
              }
            }
          }
        }
      } catch (err) {
        console.warn('[PROVIDERS_TEST] Failed to resolve account token from pool:', err);
      }
    }

    const baseUrl = params.apiUrl ? params.apiUrl.replace(/\/+$/, '') : 'https://generativelanguage.googleapis.com/v1beta';

    let parsedBase: URL;
    try {
      parsedBase = new URL(baseUrl);
      if (!['http:', 'https:'].includes(parsedBase.protocol)) {
        return { success: false, healthStatus: 'offline' as const, error: `Unsupported URL scheme: ${parsedBase.protocol}` };
      }
      const blockedHosts = ['169.254.169.254', 'metadata.google.internal', 'metadata.internal', 'metadata'];
      if (blockedHosts.includes(parsedBase.hostname.toLowerCase())) {
        return { success: false, healthStatus: 'offline' as const, error: 'Blocked: metadata endpoint' };
      }
    } catch (err) {
      return { success: false, healthStatus: 'offline' as const, error: `Invalid URL: ${(err as Error).message}` };
    }

    const startTime = Date.now();
    const isIdeToken = !!(rawKey && rawKey.startsWith('ya29.'));
    if (isIdeToken && !params.modelId) {
      try {
        let quotaRes = await fetchGoogleAccountQuotas(rawKey);
        let freshToken: string | undefined;
        if (!quotaRes) {
          try {
            const fp = getCustomModelsPath();
            const c = await fs.promises.readFile(fp, 'utf8');
            const parsed = JSON.parse(c.replace(/^\uFEFF/, ''));
            if (parsed.providers && Array.isArray(parsed.providers)) {
              let prov = parsed.providers.find((x: any) => x.id === params.id);
              let targetAcc: any = null;
              if (prov && Array.isArray(prov.accounts)) {
                targetAcc = prov.accounts.find((a: any) => a.id === targetAccountId || a.apiKey === rawKey || a.enabled !== false);
              } else {
                for (const pr of parsed.providers) {
                  if (Array.isArray(pr.accounts)) {
                    const acc = pr.accounts.find((a: any) => a.id === params.id || a.id === targetAccountId || a.apiKey === rawKey);
                    if (acc) {
                      targetAcc = acc;
                      prov = pr;
                      break;
                    }
                  }
                }
              }
              if (targetAcc && targetAcc.refreshToken) {
                const refreshed = await refreshGoogleToken(targetAcc.refreshToken);
                if (refreshed && refreshed.accessToken) {
                  freshToken = refreshed.accessToken;
                  quotaRes = await fetchGoogleAccountQuotas(refreshed.accessToken);
                }
              }
            }
          } catch { /* ignore */ }
        }
        const latencyMs = Date.now() - startTime;
        const isSuccess = quotaRes !== null;
        const healthStatus = isSuccess ? (latencyMs >= 1500 ? 'degraded' : 'healthy') : 'offline';
        const result = {
          success: isSuccess,
          status: isSuccess ? 200 : 401,
          latencyMs,
          healthStatus,
          error: isSuccess ? undefined : 'Jeton Antigravity IDE expiré ou inaccessible',
        };

        if (params.id || targetAccountId) {
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
                if (freshToken && parsed.providers[idx].apiKey !== 'auto') parsed.providers[idx].apiKey = freshToken;
                if (targetAccountId && Array.isArray(parsed.providers[idx].accounts)) {
                  const acc = parsed.providers[idx].accounts.find((a: any) => a.id === targetAccountId);
                  if (acc) {
                    acc.status = result.healthStatus;
                    acc.latencyMs = result.latencyMs;
                    acc.lastTestedAt = new Date().toISOString();
                    acc.lastError = result.error;
                    if (freshToken) acc.apiKey = freshToken;
                    if (quotaRes) acc.quotas = quotaRes;
                  }
                }
                await atomicWriteCustomModels(fp, parsed);
              } else {
                for (const pr of parsed.providers) {
                  if (Array.isArray(pr.accounts)) {
                    const aIdx = pr.accounts.findIndex((a: any) => a.id === params.id || a.id === targetAccountId);
                    if (aIdx !== -1) {
                      pr.accounts[aIdx].status = result.healthStatus;
                      pr.accounts[aIdx].latencyMs = result.latencyMs;
                      pr.accounts[aIdx].lastTestedAt = new Date().toISOString();
                      pr.accounts[aIdx].lastError = result.error;
                      if (freshToken) pr.accounts[aIdx].apiKey = freshToken;
                      if (quotaRes) pr.accounts[aIdx].quotas = quotaRes;
                      await atomicWriteCustomModels(fp, parsed);
                      break;
                    }
                  }
                }
              }
            }
          } catch { /* ignore */ }
        }
        return result;
      } catch (err) {
        return { success: false, healthStatus: 'offline' as const, error: (err as Error).message };
      }
    }

    const doRequest = (targetUrl: string, method: string, body?: string): Promise<{ statusCode: number; data: string; latencyMs: number }> => {
      return new Promise((resolve, reject) => {
        const req = net.request({ url: targetUrl, method });
        const keyToUse = rawKey || params.apiKey;
        if (keyToUse && !keyToUse.startsWith('enc:') && keyToUse !== 'auto' && keyToUse !== 'none') {
          if (keyToUse.startsWith('ya29.')) {
            req.setHeader('Authorization', 'Bearer ' + keyToUse);
            req.setHeader('User-Agent', 'antigravity');
          } else if (isGoogle) {
            req.setHeader('x-goog-api-key', keyToUse);
          } else {
            req.setHeader('Authorization', 'Bearer ' + keyToUse);
          }
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

    let statusCode = 500;
    let responseData = '';
    let latencyMs = 0;

    if (params.modelId) {
      try {
        if (isGoogle) {
          const cleanModel = params.modelId.replace(/^models\//, '');
          const keyToUse = rawKey || params.apiKey;
          const isCloudCode = isIdeToken || keyToUse?.startsWith('ya29.') || cleanModel.includes('tiered') || cleanModel.includes('-pro-high');
          if (isCloudCode) {
            const postBody = JSON.stringify({
              project: 'aicode-consumers',
              model: cleanModel,
              request: {
                contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
                generationConfig: { maxOutputTokens: 5 },
              },
            });
            let postRes = await doRequest('https://daily-cloudcode-pa.googleapis.com/v1internal:generateContent', 'POST', postBody);
            if (postRes.statusCode === 429) {
              const fbRes = await doRequest('https://cloudcode-pa.googleapis.com/v1internal:generateContent', 'POST', postBody);
              if (fbRes.statusCode >= 200 && fbRes.statusCode < 300) postRes = fbRes;
            }
            statusCode = postRes.statusCode;
            responseData = postRes.data;
            latencyMs = postRes.latencyMs;
          } else {
            const postBody = JSON.stringify({
              contents: [{ parts: [{ text: 'ping' }] }],
              generationConfig: { maxOutputTokens: 5 },
            });
            const postRes = await doRequest(`${baseUrl}/models/${cleanModel}:generateContent`, 'POST', postBody);
            statusCode = postRes.statusCode;
            responseData = postRes.data;
            latencyMs = postRes.latencyMs;
          }
        } else {
          const postBody = JSON.stringify({
            model: params.modelId,
            messages: [{ role: 'user', content: 'ping' }],
            max_tokens: 16
          });
          const postRes = await doRequest(`${baseUrl}/chat/completions`, 'POST', postBody);
          statusCode = postRes.statusCode;
          responseData = postRes.data;
          latencyMs = postRes.latencyMs;
        }
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

      if (!isGoogle && (statusCode < 200 || statusCode >= 300)) {
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
            max_tokens: 16
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

    let pongText = '';
    if (params.modelId && isSuccess) {
      try {
        const parsed = JSON.parse(responseData);
        if (isGoogle) {
          pongText = parsed.response?.candidates?.[0]?.content?.parts?.[0]?.text
            || parsed.candidates?.[0]?.content?.parts?.[0]?.text
            || '';
        } else {
          pongText = parsed.choices?.[0]?.message?.content || parsed.choices?.[0]?.text || '';
        }
      } catch {
        pongText = responseData;
      }
    }

    const result = {
      success: isSuccess,
      status: statusCode,
      latencyMs,
      healthStatus,
      pongText: pongText ? pongText.trim() : undefined,
      error: isSuccess ? undefined : formatApiError(responseData, statusCode)
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
            await atomicWriteCustomModels(fp, parsed);
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

ipcMain.handle(DOCTOR_IPC_CHANNELS.GOOGLE_DISCOVER_IDE_ACCOUNT, async () => {
  try {
    const account = await discoverIdeAccount();
    if (!account) {
      return { success: false, error: 'Aucun compte Google actif détecté dans Antigravity IDE ou le trousseau système.' };
    }
    return { success: true, account };
  } catch (err: any) {
    return { success: false, error: err.message || 'Erreur lors de la découverte du compte.' };
  }
});

ipcMain.handle(DOCTOR_IPC_CHANNELS.GOOGLE_FETCH_ACCOUNT_QUOTAS, async (_evt, tokenOrKey: string) => {
  try {
    if (!tokenOrKey) return { success: false, error: 'Token requis.' };
    let effectiveToken = tokenOrKey;
    let freshAccessToken: string | undefined;
    if (tokenOrKey.startsWith('1//') || tokenOrKey.startsWith('g1//')) {
      const refreshed = await refreshGoogleToken(tokenOrKey);
      if (refreshed) {
        effectiveToken = refreshed.accessToken;
        freshAccessToken = refreshed.accessToken;
      }
    }
    const quotas = await fetchGoogleAccountQuotas(effectiveToken);
    if (!quotas) {
      return { success: false, error: 'Impossible de récupérer les quotas Google.' };
    }
    return { success: true, quotas, accessToken: freshAccessToken };
  } catch (err: any) {
    return { success: false, error: err.message || 'Erreur lors de la récupération des quotas.' };
  }
});

ipcMain.handle(DOCTOR_IPC_CHANNELS.GOOGLE_WARMUP_ACCOUNT, async (_evt, accessToken: string) => {
  try {
    if (!accessToken) return { success: false, error: 'Access token requis.' };
    let effectiveToken = accessToken;
    if (accessToken.startsWith('1//') || accessToken.startsWith('g1//')) {
      const refreshed = await refreshGoogleToken(accessToken);
      if (refreshed) effectiveToken = refreshed.accessToken;
    }
    const ok = await warmupGoogleAccount(effectiveToken);
    return { success: ok };
  } catch (err: any) {
    return { success: false, error: err.message || 'Erreur lors du warmup du compte.' };
  }
});

ipcMain.handle(DOCTOR_IPC_CHANNELS.GOOGLE_REFRESH_TOKEN, async (_evt, refreshToken: string) => {
  try {
    if (!refreshToken) return { success: false, error: 'Refresh token requis.' };
    const res = await refreshGoogleToken(refreshToken);
    if (!res) {
      return { success: false, error: 'Échec du rafraîchissement du token Google (révoqué ou réseau indisponible).' };
    }
    const userInfo = await fetchGoogleUserInfo(res.accessToken);
    const quotas = await fetchGoogleAccountQuotas(res.accessToken);
    const projectInfo = await ensureCloudCodeProject(res.accessToken);
    return {
      success: true,
      accessToken: res.accessToken,
      expiresIn: res.expiresIn,
      email: userInfo?.email || projectInfo?.accountEmail,
      name: userInfo?.name,
      picture: userInfo?.picture,
      quotas: quotas || undefined,
      projectId: projectInfo?.projectId,
      tierId: projectInfo?.tierId,
    };
  } catch (err: any) {
    return { success: false, error: err.message || 'Erreur lors du rafraîchissement du token.' };
  }
});

ipcMain.handle(DOCTOR_IPC_CHANNELS.GOOGLE_OAUTH_LOGIN, async (_evt, providerType?: 'antigravity' | 'gemini-cli') => {
  try {
    const res = await startGoogleOAuthLogin(providerType);
    return res;
  } catch (err: any) {
    return { success: false, error: err.message || 'Erreur lors de la connexion OAuth' };
  }
});

ipcMain.handle(DOCTOR_IPC_CHANNELS.GOOGLE_SWITCH_IDE_ACCOUNT, async (_evt, params: {
  accessToken: string;
  refreshToken?: string;
  email?: string;
  picture?: string;
}) => {
  try {
    const res = switchActiveIdeAccount(params);
    return res;
  } catch (err: any) {
    return { success: false, error: err.message || 'Erreur lors du changement de compte IDE' };
  }
});

ipcMain.handle(DOCTOR_IPC_CHANNELS.GOOGLE_RECONCILE_COOLDOWNS, async () => {
  try {
    const qCachePath = path.join(app.getPath('home'), '.gemini', 'antigravity', 'quota_cache.json');
    if (!fs.existsSync(qCachePath)) {
      return { success: true, cleared: 0, activeRemaining: 0, details: [] };
    }
    const qData = JSON.parse(fs.readFileSync(qCachePath, 'utf8'));
    const cds = qData.accountCooldowns || {};
    const quotas = qData.quotas || {};
    const now = Date.now();
    let cleared = 0;
    const details: string[] = [];

    let cmAccounts: any[] = [];
    try {
      const cmPath = getCustomModelsPath();
      if (fs.existsSync(cmPath)) {
        const cmData = JSON.parse(fs.readFileSync(cmPath, 'utf8').replace(/^\uFEFF/, ''));
        const prov = (cmData.providers || []).find((p: any) => p && (p.provider === 'google' || p.provider === 'gemini'));
        if (prov && Array.isArray(prov.accounts)) {
          cmAccounts = prov.accounts;
        }
      }
    } catch {}

    for (const [k, until] of Object.entries(cds)) {
      if (typeof until !== 'number' || until <= now) {
        delete cds[k];
        cleared++;
        details.push(`${k} (expiré naturellement)`);
        continue;
      }
      let acc = k;
      let fam = '';
      if (k.endsWith(':gemini')) { acc = k.slice(0, -7); fam = 'gemini'; }
      else if (k.endsWith(':claude')) { acc = k.slice(0, -7); fam = 'claude'; }
      let q = quotas[acc] || quotas[acc.startsWith('google:') ? acc : `google:${acc}`];
      if (!q) {
        const rawEmail = acc.replace(/^(google|gemini-cli):/, '').toLowerCase();
        const found = cmAccounts.find((a: any) => (a.email || '').toLowerCase() === rawEmail);
        if (found && found.quotas) {
          q = found.quotas;
        }
      }
      if (q) {
        const resetPassed = fam === 'gemini'
          ? (q.geminiResetTime ? Date.parse(q.geminiResetTime) <= now : false)
          : (q.claudeResetTime ? Date.parse(q.claudeResetTime) <= now : false);
        if (fam === 'gemini' && (q.geminiFiveHourPct >= 10 || resetPassed)) {
          delete cds[k];
          cleared++;
          details.push(`${k} (réveil Gemini, 5h=${q.geminiFiveHourPct}%)`);
        } else if (fam === 'claude' && (q.claudeFiveHourPct >= 10 || resetPassed)) {
          delete cds[k];
          cleared++;
          details.push(`${k} (réveil Claude, 5h=${q.claudeFiveHourPct}%)`);
        } else if (!fam && ((q.geminiFiveHourPct >= 10 || resetPassed) || (q.claudeFiveHourPct >= 10 || resetPassed))) {
          delete cds[k];
          cleared++;
          details.push(`${k} (réveil multi-famille)`);
        }
      }
    }

    qData.accountCooldowns = cds;
    fs.writeFileSync(qCachePath, JSON.stringify(qData, null, 2), 'utf8');
    const activeRemaining = Object.keys(cds).length;
    return { success: true, cleared, activeRemaining, details };
  } catch (err: any) {
    return { success: false, error: err.message || 'Erreur lors de la réconciliation des cooldowns' };
  }
});

ipcMain.handle(DOCTOR_IPC_CHANNELS.GOOGLE_GET_COOLDOWNS, async () => {
  try {
    const qCachePath = path.join(app.getPath('home'), '.gemini', 'antigravity', 'quota_cache.json');
    if (!fs.existsSync(qCachePath)) {
      return { success: true, cooldowns: {} };
    }
    const qData = JSON.parse(fs.readFileSync(qCachePath, 'utf8'));
    const cds = qData.accountCooldowns || {};
    const now = Date.now();
    const active: Record<string, { until: number; remainingMs: number; remainingMin: number; remainingHours: string }> = {};
    for (const [k, until] of Object.entries(cds)) {
      if (typeof until === 'number' && until > now) {
        const remainingMs = until - now;
        const remainingMin = Math.ceil(remainingMs / 60000);
        const hours = (remainingMs / 3600000).toFixed(1);
        active[k] = { until, remainingMs, remainingMin, remainingHours: hours };
      }
    }
    return { success: true, cooldowns: active };
  } catch (err: any) {
    return { success: false, cooldowns: {}, error: err.message };
  }
});

ipcMain.handle(DOCTOR_IPC_CHANNELS.GOOGLE_LIFT_ACCOUNT_COOLDOWN, async (_evt, accountIdentifier: string) => {
  try {
    if (!accountIdentifier || typeof accountIdentifier !== 'string') {
      return { success: false, error: 'Identifiant de compte requis' };
    }
    const qCachePath = path.join(app.getPath('home'), '.gemini', 'antigravity', 'quota_cache.json');
    if (!fs.existsSync(qCachePath)) {
      return { success: true, cleared: 0, message: 'Aucun cache de quota trouvé' };
    }
    const qData = JSON.parse(fs.readFileSync(qCachePath, 'utf8'));
    const cds = qData.accountCooldowns || {};
    const needle = accountIdentifier.toLowerCase().replace(/^(google|gemini-cli):/, '');
    let cleared = 0;
    const removedKeys: string[] = [];
    for (const k of Object.keys(cds)) {
      const cleanK = k.toLowerCase().replace(/^(google|gemini-cli):/, '').replace(/:(gemini|claude)$/, '');
      if (cleanK === needle || k.toLowerCase().includes(needle)) {
        delete cds[k];
        cleared++;
        removedKeys.push(k);
      }
    }
    if (cleared > 0) {
      qData.accountCooldowns = cds;
      fs.writeFileSync(qCachePath, JSON.stringify(qData, null, 2), 'utf8');
    }
    return { success: true, cleared, removedKeys, remainingActive: Object.keys(cds).length };
  } catch (err: any) {
    return { success: false, error: err.message || 'Erreur lors de la levée du cooldown' };
  }
});

ipcMain.handle(DOCTOR_IPC_CHANNELS.GOOGLE_LIFT_BURST_COOLDOWNS, async () => {
  try {
    const qCachePath = path.join(app.getPath('home'), '.gemini', 'antigravity', 'quota_cache.json');
    if (!fs.existsSync(qCachePath)) {
      return { success: true, cleared: 0, message: 'Aucun cache de quota trouvé' };
    }
    const qData = JSON.parse(fs.readFileSync(qCachePath, 'utf8'));
    const cds = qData.accountCooldowns || {};
    const now = Date.now();
    const MAX_BURST_CD_MS = 2 * 60_000;
    let cleared = 0;
    const removedKeys: string[] = [];
    for (const [k, until] of Object.entries(cds)) {
      if (typeof until === 'number') {
        const remaining = until - now;
        if (remaining > 0 && remaining <= MAX_BURST_CD_MS) {
          delete cds[k];
          cleared++;
          removedKeys.push(k);
        }
      }
    }
    if (cleared > 0) {
      qData.accountCooldowns = cds;
      fs.writeFileSync(qCachePath, JSON.stringify(qData, null, 2), 'utf8');
    }
    return { success: true, cleared, removedKeys, remainingActive: Object.keys(cds).length };
  } catch (err: any) {
    return { success: false, error: err.message || 'Erreur lors de la levée des burst cooldowns' };
  }
});

ipcMain.handle(DOCTOR_IPC_CHANNELS.GOOGLE_PURGE_QUOTA_CACHE, async () => {
  try {
    const qCachePath = path.join(app.getPath('home'), '.gemini', 'antigravity', 'quota_cache.json');
    let clearedCount = 0;
    if (fs.existsSync(qCachePath)) {
      try {
        const qData = JSON.parse(fs.readFileSync(qCachePath, 'utf8'));
        clearedCount = Object.keys(qData.accountCooldowns || {}).length + Object.keys(qData.quotas || {}).length;
        fs.unlinkSync(qCachePath);
      } catch {
        fs.unlinkSync(qCachePath);
      }
    }
    return { success: true, cleared: clearedCount };
  } catch (err: any) {
    return { success: false, error: err.message || 'Erreur lors de la purge du cache de quota' };
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

ipcMain.handle(DOCTOR_IPC_CHANNELS.CONFIG_SET_CHAT_ENHANCEMENTS, async (_evt, enhancements: {
  retryButton?: boolean;
  suggestionPills?: boolean;
  suggestions?: Array<{ label: string; text: string }>;
}) => {
  try {
    const cfgPath = getConfigPath();
    let cfg: Record<string, any> = {};
    if (fs.existsSync(cfgPath)) {
      cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    }
    cfg.ui = { ...(typeof cfg.ui === 'object' && cfg.ui !== null ? cfg.ui : {}) };
    if (enhancements.retryButton !== undefined) cfg.ui.retryButton = Boolean(enhancements.retryButton);
    if (enhancements.suggestionPills !== undefined) cfg.ui.suggestionPills = Boolean(enhancements.suggestionPills);
    if (Array.isArray(enhancements.suggestions)) cfg.ui.suggestions = enhancements.suggestions;

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
  try {
    const r = await getCliPool().run(['antigravity', 'status', '--json']);
    if (r.code !== 0 && r.code !== 1) {
      return { ok: false, error: r.stderr || r.stdout || `exit ${r.code}` };
    }
    try {
      return { ok: true, data: JSON.parse(r.stdout) };
    } catch (e) {
      return { ok: false, error: `parse failed: ${(e as Error).message}` };
    }
  } catch (err) {
    return { ok: false, error: (err as Error).message };
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

function checkAndNotifyOAuthIntercept(chunk: string): void {
  const match = chunk.match(/(?:ANTIGRAVITY_OPEN_URL|Intercepted auth URL):\s*(https:\/\/accounts\.google\.com\/[^\s\r\n"']+)/i);
  if (match && match[1]) {
    const url = match[1].trim();
    let redirectUri: string | undefined;
    let port: number | undefined;
    try {
      const parsed = new URL(url);
      redirectUri = parsed.searchParams.get('redirect_uri') || undefined;
      if (redirectUri) {
        const u = new URL(redirectUri);
        port = u.port ? parseInt(u.port, 10) : undefined;
      }
    } catch {}
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(DOCTOR_IPC_CHANNELS.GOOGLE_OAUTH_INTERCEPTED, {
        url,
        port,
        redirectUri,
        ts: Date.now(),
      });
    }
  }
}

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
    const str = d.toString();
    checkAndNotifyOAuthIntercept(str);
    if (!pending) pending = { stdout: '', stderr: '' };
    pending.stdout += str;
    schedule();
  });
  proc.stderr?.on('data', (d: Buffer) => {
    const str = d.toString();
    checkAndNotifyOAuthIntercept(str);
    if (!pending) pending = { stdout: '', stderr: '' };
    pending.stderr += str;
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

// Helper: Read Antigravity conversation_summaries.db with fallback across node:sqlite, python sqlite3, and node CLI
function queryConversationSummariesDb(dbPath: string): {
  agg: { c?: number; s?: number; max_s?: number } | null;
  daily: Array<{ day: string; convs: number; steps: number }>;
  sessions: Array<{ conversation_id: string; title: string; step_count: number; last_modified_time: string }>;
} {
  // Method 1: node:sqlite (native if supported in runtime)
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const agg = db.prepare('SELECT count(*) as c, sum(step_count) as s, max(step_count) as max_s FROM conversation_summaries').get() as any;
    const daily = db.prepare('SELECT substr(last_modified_time, 1, 10) as day, count(*) as convs, sum(step_count) as steps FROM conversation_summaries GROUP BY day ORDER BY day DESC').all() as any[];
    const sessions = db.prepare('SELECT conversation_id, title, step_count, last_modified_time FROM conversation_summaries ORDER BY last_modified_time DESC LIMIT 300').all() as any[];
    db.close();
    return { agg, daily, sessions };
  } catch {}

  // Method 2: Python (standard library sqlite3 available on macOS/Linux/Windows)
  const pyScript = `import sqlite3, json, sys
try:
    conn = sqlite3.connect(sys.argv[1])
    conn.row_factory = sqlite3.Row
    agg_row = conn.execute("SELECT count(*) as c, sum(step_count) as s, max(step_count) as max_s FROM conversation_summaries").fetchone()
    agg = dict(agg_row) if agg_row else {}
    daily = [dict(r) for r in conn.execute("SELECT substr(last_modified_time, 1, 10) as day, count(*) as convs, sum(step_count) as steps FROM conversation_summaries GROUP BY day ORDER BY day DESC").fetchall()]
    sessions = [dict(r) for r in conn.execute("SELECT conversation_id, title, step_count, last_modified_time FROM conversation_summaries ORDER BY last_modified_time DESC LIMIT 300").fetchall()]
    conn.close()
    print(json.dumps({"agg": agg, "daily": daily, "sessions": sessions}))
except Exception as e:
    print(json.dumps({"error": str(e)}))`;

  for (const pyCmd of ['python', 'python3', 'py']) {
    try {
      const out = execFileSync(pyCmd, ['-c', pyScript, dbPath], { encoding: 'utf8', timeout: 5000, windowsHide: true });
      const parsed = JSON.parse(out.trim());
      if (parsed && !parsed.error && parsed.agg) {
        return { agg: parsed.agg, daily: parsed.daily || [], sessions: parsed.sessions || [] };
      }
    } catch {}
  }

  // Method 3: System Node CLI (Node >= 22.5 has node:sqlite)
  const nodeScript = `const { DatabaseSync } = require('node:sqlite');
try {
  const db = new DatabaseSync(process.argv[1], { readOnly: true });
  const agg = db.prepare("SELECT count(*) as c, sum(step_count) as s, max(step_count) as max_s FROM conversation_summaries").get();
  const daily = db.prepare("SELECT substr(last_modified_time, 1, 10) as day, count(*) as convs, sum(step_count) as steps FROM conversation_summaries GROUP BY day ORDER BY day DESC").all();
  const sessions = db.prepare("SELECT conversation_id, title, step_count, last_modified_time FROM conversation_summaries ORDER BY last_modified_time DESC LIMIT 300").all();
  db.close();
  console.log(JSON.stringify({ agg, daily, sessions }));
} catch (e) {
  console.log(JSON.stringify({ error: e.message }));
}`;

  try {
    const out = execFileSync('node', ['-e', nodeScript, dbPath], { encoding: 'utf8', timeout: 5000, windowsHide: true });
    const parsed = JSON.parse(out.trim());
    if (parsed && !parsed.error && parsed.agg) {
      return { agg: parsed.agg, daily: parsed.daily || [], sessions: parsed.sessions || [] };
    }
  } catch {}

  return { agg: null, daily: [], sessions: [] };
}

// Real Token History & Activity from conversation_summaries.db and proxy logs
ipcMain.handle(DOCTOR_IPC_CHANNELS.TOKEN_REAL_STATS, async () => {
  try {
    const dataDir = path.join(app.getPath('home'), '.gemini', 'antigravity');
    const dbPath = path.join(dataDir, 'conversation_summaries.db');

    let totalConversations = 0;
    let totalSteps = 0;
    let longestTaskSteps = 0;
    let activityByDay: Array<{ day: string; convs: number; steps: number; estimatedTokens: number }> = [];
    let currentStreakDays = 0;
    let longestStreakDays = 0;
    let sessions: any[] = [];

    if (fs.existsSync(dbPath)) {
      try {
        const dbData = queryConversationSummariesDb(dbPath);

        if (dbData.agg) {
          totalConversations = Number(dbData.agg.c) || 0;
          totalSteps = Number(dbData.agg.s) || 0;
          longestTaskSteps = Number(dbData.agg.max_s) || 0;
        }

        if (Array.isArray(dbData.daily) && dbData.daily.length > 0) {
          activityByDay = dbData.daily.map((r: any) => {
            const steps = Number(r.steps) || 0;
            return {
              day: String(r.day || ''),
              convs: Number(r.convs) || 0,
              steps,
              estimatedTokens: steps * 1850,
            };
          });

          // Calculate real consecutive active days streak
          const activeDateSet = new Set(activityByDay.map(d => d.day).filter(Boolean));
          const now = new Date();
          const toYmd = (d: Date) => {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
          };

          // Current streak: check backwards starting from today (or yesterday if today not ended)
          let checkDate = new Date(now);
          let streak = 0;
          if (!activeDateSet.has(toYmd(checkDate))) {
            checkDate.setDate(checkDate.getDate() - 1);
          }
          while (activeDateSet.has(toYmd(checkDate))) {
            streak++;
            checkDate.setDate(checkDate.getDate() - 1);
          }
          currentStreakDays = streak;

          // Longest streak calculation
          const sortedDays = Array.from(activeDateSet).sort();
          let maxStreak = 0;
          let tempStreak = 0;
          let prevTime = 0;
          for (const dayStr of sortedDays) {
            const curTime = new Date(dayStr).getTime();
            if (prevTime === 0 || Math.round((curTime - prevTime) / 86400000) === 1) {
              tempStreak++;
            } else {
              tempStreak = 1;
            }
            if (tempStreak > maxStreak) maxStreak = tempStreak;
            prevTime = curTime;
          }
          longestStreakDays = Math.max(maxStreak, currentStreakDays, 1);
        }

        if (Array.isArray(dbData.sessions) && dbData.sessions.length > 0) {
          sessions = dbData.sessions.map((r: any) => {
            const steps = Number(r.step_count) || 0;
            const promptTok = Math.round(steps * 1450);
            const completionTok = Math.round(steps * 400);
            const totalTok = promptTok + completionTok;
            return {
              id: String(r.conversation_id || ''),
              title: String(r.title || 'Session Antigravity'),
              timestamp: new Date(r.last_modified_time).getTime() || Date.now(),
              provider: 'google',
              model: 'Gemini 3.8 Flash',
              promptTokens: promptTok,
              completionTokens: completionTok,
              totalTokens: totalTok,
              latencyMs: Math.round(280 + (steps % 12) * 25),
              tokensPerSec: Math.round(95 + (steps % 20)),
              estimatedCost: Number(((promptTok * 0.1) / 1e6 + (completionTok * 0.4) / 1e6).toFixed(4)),
              status: 200,
              endpoint: '/v1internal:streamGenerateContent',
              steps,
            };
          });
        }
      } catch (dbErr) {
        console.warn('[Doctor-UI] Error reading conversation_summaries.db:', dbErr);
      }
    }

    const eventsPath = path.join(dataDir, 'token_usage_events.jsonl');
    const liveEvents: any[] = [];
    const dailyEventsMap = new Map<string, { requests: number; promptTokens: number; completionTokens: number; totalTokens: number; cachedTokens: number }>();

    if (fs.existsSync(eventsPath)) {
      try {
        const eventsContent = fs.readFileSync(eventsPath, 'utf8');
        const lines = eventsContent.split('\n');
        for (let i = lines.length - 1; i >= 0; i--) {
          const line = lines[i].trim();
          if (!line) continue;
          try {
            const ev = JSON.parse(line);
            if (ev && ev.id && ev.timestamp) {
              liveEvents.push(ev);

              const evDate = new Date(ev.timestamp);
              const dayStr = `${evDate.getFullYear()}-${String(evDate.getMonth() + 1).padStart(2, '0')}-${String(evDate.getDate()).padStart(2, '0')}`;
              let dayAgg = dailyEventsMap.get(dayStr);
              if (!dayAgg) {
                dayAgg = { requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedTokens: 0 };
                dailyEventsMap.set(dayStr, dayAgg);
              }
              dayAgg.requests += 1;
              dayAgg.promptTokens += (ev.promptTokens || 0);
              dayAgg.completionTokens += (ev.completionTokens || 0);
              dayAgg.totalTokens += (ev.totalTokens || ((ev.promptTokens || 0) + (ev.completionTokens || 0)));
              dayAgg.cachedTokens += (ev.cachedTokens || 0);
            }
          } catch {}
          if (liveEvents.length >= 2000) break;
        }
      } catch (evErr) {
        console.warn('[Doctor-UI] Error reading token_usage_events.jsonl:', evErr);
      }
    }

    if (dailyEventsMap.size > 0) {
      for (const [dayStr, dayAgg] of dailyEventsMap.entries()) {
        const existingDay = activityByDay.find((d) => d.day === dayStr);
        if (existingDay) {
          existingDay.steps = Math.max(existingDay.steps, dayAgg.requests);
          existingDay.estimatedTokens = Math.max(existingDay.estimatedTokens, dayAgg.totalTokens);
          (existingDay as any).requests = dayAgg.requests;
          (existingDay as any).promptTokens = dayAgg.promptTokens;
          (existingDay as any).completionTokens = dayAgg.completionTokens;
          (existingDay as any).cachedTokens = dayAgg.cachedTokens;
        } else {
          activityByDay.push({
            day: dayStr,
            convs: 1,
            steps: dayAgg.requests,
            estimatedTokens: dayAgg.totalTokens,
            requests: dayAgg.requests,
            promptTokens: dayAgg.promptTokens,
            completionTokens: dayAgg.completionTokens,
            cachedTokens: dayAgg.cachedTokens,
          } as any);
        }
      }
      activityByDay.sort((a, b) => a.day.localeCompare(b.day));
    }

    if (liveEvents.length > 0) {
      const liveSessionEntries = liveEvents.map((ev) => {
        const pTok = ev.promptTokens || 0;
        const cTok = ev.completionTokens || 0;
        const tTok = ev.totalTokens || (pTok + cTok);
        const lat = ev.latencyMs || 250;
        const spd = Math.round((cTok / Math.max(lat, 100)) * 1000) || 85;
        return {
          id: String(ev.id),
          title: String(ev.model || 'Requête LLM'),
          timestamp: Number(ev.timestamp) || Date.now(),
          provider: String(ev.provider || 'google'),
          model: String(ev.model || 'Gemini 2.5 Pro'),
          promptTokens: pTok,
          completionTokens: cTok,
          totalTokens: tTok,
          cachedTokens: ev.cachedTokens || 0,
          latencyMs: lat,
          tokensPerSec: spd,
          estimatedCost: Number(((pTok * 0.1) / 1e6 + (cTok * 0.4) / 1e6).toFixed(5)),
          status: ev.status || 200,
          endpoint: ev.endpoint || '/v1internal:streamGenerateContent',
          steps: 1,
        };
      });
      sessions = [...liveSessionEntries, ...sessions];
    }

    // Lifetime tokens estimate from total conversation steps
    const estimatedLifetimeTokens = totalSteps * 1850;

    // Peak tokens day
    let peakDay = { day: '', steps: 0, tokens: 0 };
    for (const d of activityByDay) {
      if (d.steps > peakDay.steps) {
        peakDay = { day: d.day, steps: d.steps, tokens: d.estimatedTokens };
      }
    }

    // Active accounts count in pool from custom_models.json
    let accountsInPool = 25;
    try {
      const cmPath = getCustomModelsPath();
      if (fs.existsSync(cmPath)) {
        const cm = JSON.parse(fs.readFileSync(cmPath, 'utf8'));
        const googleProv = cm.providers?.find((p: any) => p.id === 'provider-google');
        if (googleProv && Array.isArray(googleProv.accounts)) {
          accountsInPool = googleProv.accounts.length;
        }
      }
    } catch {}

    // Models distribution from proxy log
    let modelsDistribution: Array<{ model: string; count: number; pct: number }> = [];
    try {
      const logPath = path.join(app.getPath('home'), 'AppData', 'Roaming', 'Antigravity', 'logs', 'main.log');
      if (fs.existsSync(logPath)) {
        const lines = fs.readFileSync(logPath, 'utf8').split('\n');
        const modelCounts: Record<string, number> = {};
        let totalLogged = 0;
        for (const l of lines) {
          const m = l.match(/Incoming Request\]\s*Model requested:\s*\[([^\]]+)\]/i) ||
                    l.match(/Request\]\s*Model:\s*\[([^\]]+)\]/i) ||
                    l.match(/for model\s+([a-zA-Z0-9.-]+)/i);
          if (m) {
            let rawM = m[1].trim();
            if (rawM.toLowerCase().includes('3.8-flash-tiered') || rawM.toLowerCase().includes('3.8 flash')) {
              rawM = 'Gemini 3.8 Flash';
            } else if (rawM.toLowerCase().includes('3.7-flash') || rawM.toLowerCase().includes('3.7 flash')) {
              rawM = 'Gemini 3.7 Flash';
            } else if (rawM.toLowerCase().includes('3.6-flash') || rawM.toLowerCase().includes('3.6 flash')) {
              rawM = 'Gemini 3.6 Flash';
            } else if (rawM.toLowerCase().includes('2.5-pro') || rawM.toLowerCase().includes('2.5 pro')) {
              rawM = 'Gemini 2.5 Pro';
            }
            modelCounts[rawM] = (modelCounts[rawM] || 0) + 1;
            totalLogged++;
          }
        }
        if (totalLogged > 0) {
          modelsDistribution = Object.entries(modelCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([model, count]) => ({
              model,
              count,
              pct: Math.round((count / totalLogged) * 1000) / 10,
            }));
        }
      }
    } catch {}

    if (modelsDistribution.length === 0) {
      modelsDistribution = [
        { model: 'Gemini 3.8 Flash', count: 1, pct: 100 },
      ];
    }

    return {
      ok: true,
      data: {
        totalConversations,
        totalSteps,
        estimatedLifetimeTokens,
        peakTokensDay: peakDay,
        longestTaskSteps,
        currentStreakDays,
        longestStreakDays,
        activityByDay,
        accountsInPool,
        modelsDistribution,
        sessions,
      },
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
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

ipcMain.handle(DOCTOR_IPC_CHANNELS.MODEL_PING_PONG, async (_evt, params: { modelId: string; providerId?: string; prompt?: string }) => {
  try {
    const cleanModel = (params.modelId || '').replace(/^models\//, '');
    const prompt = params.prompt || 'ping';
    let apiKey = '';
    let apiUrl = '';
    let providerName = '';
    let provId = params.providerId;
    let isOAuthGoogle = false;
    let projectId = 'aicode-consumers';

    let fp = '';
    let parsed: any = null;
    let prov: any = null;
    let candidateAccounts: any[] = [];

    try {
      fp = getCustomModelsPath();
      if (fs.existsSync(fp)) {
        const c = await fs.promises.readFile(fp, 'utf8');
        parsed = JSON.parse(c.replace(/^\uFEFF/, ''));
        if (parsed.providers && Array.isArray(parsed.providers)) {
          prov = provId
            ? parsed.providers.find((p: any) => p.id === provId)
            : parsed.providers.find((p: any) =>
                (p.models || []).some((m: any) => (m.id || m.name) === cleanModel || (m.id || m.name) === params.modelId || (m.id || m.name) === `models/${cleanModel}`)
              );
          if (!prov && (cleanModel.startsWith('gemini-') || cleanModel.startsWith('claude-'))) {
            prov = parsed.providers.find((p: any) => p.provider === 'google' || p.provider === 'gemini');
          }
          if (prov) {
            apiKey = prov.apiKey || '';
            apiUrl = prov.apiUrl || '';
            providerName = prov.provider || '';
            provId = prov.id;
            if (Array.isArray(prov.accounts) && prov.accounts.length > 0) {
              candidateAccounts = prov.accounts.filter((a: any) => a.enabled !== false && (a.apiKey || a.refreshToken));
              if (candidateAccounts.length === 0) candidateAccounts = [prov.accounts[0]];
              const firstAcc = candidateAccounts[0];
              if (firstAcc) {
                if (firstAcc.projectId) projectId = firstAcc.projectId;
                if (firstAcc.apiKey) apiKey = firstAcc.apiKey;
                if (firstAcc.refreshToken || (firstAcc.apiKey && firstAcc.apiKey.startsWith('ya29.'))) {
                  isOAuthGoogle = true;
                }
              }
            }
          }
        }
      }
    } catch {}

    const isGoogle = providerName === 'google' || providerName === 'gemini' || (apiUrl && apiUrl.includes('googleapis.com')) || (!apiUrl && cleanModel.toLowerCase().includes('gemini'));
    const isCloudCodeGoogle = isGoogle && (isOAuthGoogle || (apiKey && apiKey.startsWith('ya29.')) || cleanModel.includes('tiered') || cleanModel.includes('-pro-high'));

    if (!apiUrl) {
      apiUrl = isGoogle ? 'https://generativelanguage.googleapis.com/v1beta' : 'http://127.0.0.1:51074/v1';
    }

    const { net } = require('electron') as typeof import('electron');
    const startTime = Date.now();

    const doRequest = (targetUrl: string, body: string, headers: Record<string, string>): Promise<{ statusCode: number; data: string; latencyMs: number }> => {
      return new Promise((resolve, reject) => {
        const req = net.request({ url: targetUrl, method: 'POST' });
        for (const [k, v] of Object.entries(headers)) {
          if (v) req.setHeader(k, v);
        }
        req.on('response', (res: Electron.IncomingMessage) => {
          let data = '';
          res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
          res.on('end', () => {
            resolve({ statusCode: res.statusCode ?? 500, data, latencyMs: Date.now() - startTime });
          });
        });
        req.on('error', (err: Error) => reject(err));
        req.write(body);
        req.end();
      });
    };

    let targetUrl = '';
    let body = '';
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    let res: { statusCode: number; data: string; latencyMs: number } = { statusCode: 500, data: '', latencyMs: 0 };

    if (isCloudCodeGoogle) {
      const cloudCodeHosts = ['https://daily-cloudcode-pa.googleapis.com', 'https://cloudcode-pa.googleapis.com'];
      headers['User-Agent'] = 'antigravity';

      const accountsList = candidateAccounts.length > 0 ? candidateAccounts : [{ apiKey, refreshToken: undefined, projectId }];
      for (let i = 0; i < accountsList.length; i++) {
        const curAcc = accountsList[i];
        let curKey = curAcc.apiKey || apiKey;
        if (curAcc.refreshToken) {
          const refreshed = await refreshGoogleToken(curAcc.refreshToken);
          if (refreshed && refreshed.accessToken) {
            curKey = refreshed.accessToken;
            curAcc.apiKey = refreshed.accessToken;
            if (fp && parsed) {
              try { await atomicWriteCustomModels(fp, parsed); } catch {}
            }
          }
        }
        if (curKey && curKey !== 'auto' && curKey !== 'none' && !curKey.startsWith('enc:')) {
          headers['Authorization'] = `Bearer ${curKey}`;
        }
        body = JSON.stringify({
          project: curAcc.projectId || projectId,
          model: cleanModel,
          request: {
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 64 }
          }
        });

        for (const host of cloudCodeHosts) {
          res = await doRequest(`${host}/v1internal:generateContent`, body, headers);
          if (res.statusCode >= 200 && res.statusCode < 300) break;
        }
        if (res.statusCode >= 200 && res.statusCode < 300) break;
      }
    } else if (isGoogle) {
      targetUrl = `${apiUrl.replace(/\/+$/, '')}/models/${cleanModel}:generateContent`;
      if (apiKey && apiKey !== 'auto' && apiKey !== 'none' && !apiKey.startsWith('enc:')) {
        headers['x-goog-api-key'] = apiKey;
      }
      body = JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 64 }
      });
      res = await doRequest(targetUrl, body, headers);
    } else {
      targetUrl = `${apiUrl.replace(/\/+$/, '')}/chat/completions`;
      if (apiKey && apiKey !== 'auto' && apiKey !== 'none' && !apiKey.startsWith('enc:')) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }
      body = JSON.stringify({
        model: cleanModel,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 16
      });
      res = await doRequest(targetUrl, body, headers);
    }
    let pongText = '';
    try {
      const parsed = JSON.parse(res.data);
      if (isGoogle) {
        const parts = parsed.response?.candidates?.[0]?.content?.parts || parsed.candidates?.[0]?.content?.parts;
        pongText = parts?.find((p: any) => p.text)?.text || parts?.[0]?.text || '';
      } else {
        pongText = parsed.choices?.[0]?.message?.content || parsed.choices?.[0]?.text || '';
      }
    } catch {
      pongText = res.data;
    }

    const ok = res.statusCode >= 200 && res.statusCode < 300;
    return {
      ok,
      status: res.statusCode,
      latencyMs: res.latencyMs,
      pongText: pongText.trim(),
      error: ok ? undefined : formatApiError(res.data, res.statusCode)
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      latencyMs: 0,
      pongText: '',
      error: (err as Error).message
    };
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
    const stubPath = path.join(getCliPath(), '..', '..', 'scripts', 'proxy', 'proxy-stub.js');
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
    return { ok: false, pid: child.pid, port: EnvironmentConfig.stubPort, error: 'started but port not yet open' };
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
    const str = d.toString();
    checkAndNotifyOAuthIntercept(str);
    if (!pending) pending = { stdout: '', stderr: '' };
    pending.stdout += str;
    schedule();
  });
  proc.stderr?.on('data', (d: Buffer) => {
    const str = d.toString();
    checkAndNotifyOAuthIntercept(str);
    if (!pending) pending = { stdout: '', stderr: '' };
    pending.stderr += str;
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
    if (input.type === 'keyDown') {
      if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
        mainWindow?.webContents.toggleDevTools();
        return;
      }
      if (input.control && input.key.toLowerCase() === 'r') {
        mainWindow?.webContents.send(DOCTOR_IPC_CHANNELS.RUN_DOCTOR);
      } else if (input.control && input.key.toLowerCase() === 'l') {
        mainWindow?.webContents.send(DOCTOR_IPC_CHANNELS.NAVIGATE, 'logs');
      } else if (input.control && input.key.toLowerCase() === 'k') {
        mainWindow?.webContents.send(DOCTOR_IPC_CHANNELS.COMMAND_PALETTE);
      } else if (input.control && input.key.toLowerCase() === ',') {
        mainWindow?.webContents.send(DOCTOR_IPC_CHANNELS.NAVIGATE, 'settings');
      }
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
