import { app, BrowserWindow } from 'electron';
import path from 'path';
import fs from 'fs';

let mainWindow: BrowserWindow | null = null;
let _assetsPath: string | null = null;
let _cliPath: string | null = null;
let _configPath: string | null = null;

export function getAssetsPath(): string {
  if (_assetsPath === null) {
    const resPath = (process as any).resourcesPath;
    const appPath = typeof app?.getAppPath === 'function' ? app.getAppPath() : null;
    const candidates = [
      path.join(__dirname, '..', 'assets'),
      path.join(__dirname, '..', '..', 'assets'),
      ...(resPath ? [path.join(resPath, 'assets')] : []),
      ...(appPath ? [path.join(appPath, 'assets')] : []),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        _assetsPath = c;
        break;
      }
    }
    if (!_assetsPath) {
      _assetsPath = path.join(__dirname, '..', '..', 'assets');
    }
  }
  return _assetsPath;
}

export function getCliPath(): string {
  if (_cliPath === null || !fs.existsSync(_cliPath)) {
    const resPath = (process as any).resourcesPath;
    const appPath = typeof app?.getAppPath === 'function' ? app.getAppPath() : null;
    const candidates = [
      ...(resPath ? [path.join(resPath, 'ag-doctor', 'bin', 'ag-doctor.js')] : []),
      ...(appPath ? [
        path.join(appPath, '..', 'ag-doctor', 'bin', 'ag-doctor.js'),
        path.join(appPath, 'ag-doctor', 'bin', 'ag-doctor.js'),
      ] : []),
      path.join(__dirname, '..', '..', '..', 'ag-doctor', 'bin', 'ag-doctor.js'),
      path.join(__dirname, '..', '..', 'ag-doctor', 'bin', 'ag-doctor.js'),
      path.join(process.cwd(), 'ag-doctor', 'bin', 'ag-doctor.js'),
      path.join(process.cwd(), '..', 'ag-doctor', 'bin', 'ag-doctor.js'),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        _cliPath = path.normalize(c);
        break;
      }
    }
    if (!_cliPath) {
      _cliPath = path.join(
        app?.isPackaged && resPath ? resPath : path.join(__dirname, '..', '..', '..'),
        'ag-doctor',
        'bin',
        'ag-doctor.js'
      );
    }
  }
  return _cliPath;
}

export function getConfigPath(): string {
  if (_configPath === null) {
    _configPath = path.join(app.getPath('home'), '.gemini', 'antigravity', 'config.json');
  }
  return _configPath;
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

export function getInfoPayload(): Record<string, unknown> {
  if (!infoCacheReady) {
    infoCache.cliPath = getCliPath();
    infoCacheReady = true;
  }
  return infoCache as unknown as Record<string, unknown>;
}

let configCache: Record<string, unknown> | null = null;
let configCacheMtime = 0;

export function getConfigPayload(): Record<string, unknown> {
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

export function invalidateConfigCache(): void {
  configCache = null;
  configCacheMtime = 0;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function setMainWindow(win: BrowserWindow | null): void {
  mainWindow = win;
}

export function createWindow(): BrowserWindow {
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
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: true,
    },
  });

  mainWindow.webContents.on('console-message', (_e, level, msg, line, src) => {
    console.log('[Renderer:' + level + '] ' + msg + ' (' + path.basename(src || '') + ':' + line + ')');
  });

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[CRITICAL: render-process-gone]', JSON.stringify(details));
  });

  mainWindow.webContents.on('unresponsive', () => {
    console.error('[CRITICAL: webContents unresponsive]');
  });

  mainWindow.on('unresponsive', () => {
    console.error('[CRITICAL: mainWindow unresponsive]');
  });

  mainWindow.on('close', () => {
    console.log('[mainWindow close event]');
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  let shown = false;
  const showWindow = () => {
    if (shown || !mainWindow || mainWindow.isDestroyed()) return;
    shown = true;
    clearTimeout(showFallback);
    mainWindow.show();
  };

  const showFallback = setTimeout(showWindow, 2000);
  mainWindow.once('ready-to-show', showWindow);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        import('electron').then(({ shell }) => shell.openExternal(url));
      }
    } catch {
      // Invalid URL ignored
    }
    return { action: 'deny' };
  });

  mainWindow.on('close', (e) => {
    if (process.platform === 'darwin') {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  return mainWindow;
}
