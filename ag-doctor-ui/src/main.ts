/**
 * Electron main process.
 * Creates the BrowserWindow, registers modular IPC handlers, and orchestrates the ag-doctor services.
 *
 * Performance & Architecture:
 *  - Modular SOLID architecture: domain IPC handlers decoupled into src/main/ipc/
 *  - CLI Worker Pool: long-lived Node.js processes for JSON-over-stdin execution
 *  - Cached asset paths, tray icons, and system info payloads
 *  - Batched chunk streaming with throttling to prevent IPC flooding
 */
import { app, BrowserWindow, shell } from 'electron';
import type { ChildProcess } from 'child_process';
import { DOCTOR_IPC_CHANNELS } from './ipc/channels';
import { getProxyManager } from './proxy-manager';
import { initAutoUpdateScheduler } from './services/updateService';
import { CliWorkerPool } from './main/cliWorkerPool';
import {
  createWindow,
  getMainWindow,
  getAssetsPath,
  getCliPath,
  getConfigPath,
  getInfoPayload,
  getConfigPayload,
  invalidateConfigCache,
} from './main/windowManager';
import {
  createTray,
  updateTray,
  pushProxyErrorHistory,
  getProxyErrorHistory,
  notifyProxyError,
} from './main/trayManager';
import {
  registerAllIpcHandlers,
  cleanupDaemonProcess,
} from './main/ipc';
import type { MainContext } from './main/types';

// Post-Quantum TLS stability: prevent oversized Kyber handshakes dropping in Go backend
process.env.GODEBUG = (process.env.GODEBUG ? process.env.GODEBUG + ',' : '') + 'tlsmlkem=0';

// Disable hardware acceleration cleanly for software rendering if requested
if (process.env.AG_DISABLE_GPU === '1') {
  app.disableHardwareAcceleration();
} else {
  app.commandLine.appendSwitch('disable-gpu-sandbox');
  app.commandLine.appendSwitch('enable-gpu-rasterization');
  app.commandLine.appendSwitch('enable-zero-copy');
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
}

app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,SpareRendererForSitePerProcess');

const activeStreams = new Map<string, ChildProcess>();

let cliPool: CliWorkerPool | null = null;
function getCliPool(): CliWorkerPool {
  if (!cliPool) {
    cliPool = new CliWorkerPool(getCliPath());
    cliPool.warmUp();
  }
  return cliPool;
}

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
    const mainWindow = getMainWindow();
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

// Wire the decoupled MainContext interface
const mainContext: MainContext = {
  getMainWindow,
  createWindow,
  getCliPath,
  getConfigPath,
  getAssetsPath,
  getInfoPayload,
  getConfigPayload,
  invalidateConfigCache,
  updateTray,
  pushProxyErrorHistory,
  getProxyErrorHistory,
  notifyProxyError,
  activeStreams,
  getCliPool,
  checkAndNotifyOAuthIntercept,
};

// Register all decoupled IPC handlers
registerAllIpcHandlers(mainContext);

app.whenReady().then(() => {
  createWindow();
  createTray();
  getCliPool().warmUp();
  initAutoUpdateScheduler(() => getMainWindow()?.webContents ?? null);

  const mainWindow = getMainWindow();
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
    else getMainWindow()?.show();
  });
});

app.on('window-all-closed', () => {
  for (const proc of activeStreams.values()) proc.kill();
  activeStreams.clear();
  cliPool?.shutdown();

  try {
    cleanupDaemonProcess();
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
