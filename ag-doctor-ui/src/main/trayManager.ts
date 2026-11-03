import { app, Menu, Tray, nativeImage, Notification, type NativeImage } from 'electron';
import path from 'path';
import fs from 'fs';
import { getAssetsPath, getMainWindow, createWindow } from './windowManager';
import { DOCTOR_IPC_CHANNELS } from '../ipc/channels';
import {
  PROXY_ERROR_HISTORY_MAX,
  TOOLTIP_TITLE_MAX,
  TOOLTIP_MSG_MAX,
  NOTIFY_DEDUP_MS,
} from '../constants';
import type { ProxyErrorEntry } from './types';

let tray: Tray | null = null;
const trayIconCache = new Map<'ok' | 'warn' | 'err', NativeImage>();

export function getTrayIcon(status: 'ok' | 'warn' | 'err'): NativeImage {
  const cached = trayIconCache.get(status);
  if (cached) return cached;
  const assets = getAssetsPath();
  const pngPath = path.join(assets, `tray-${status}.png`);
  let img: NativeImage | null = null;
  if (fs.existsSync(pngPath)) {
    const loaded = nativeImage.createFromPath(pngPath);
    if (!loaded.isEmpty()) {
      img = loaded;
    }
  }
  if (!img) {
    const fallbacks = [
      path.join(assets, 'icon-32.png'),
      path.join(assets, 'icon-16.png'),
      path.join(assets, 'icon.png'),
    ];
    for (const fb of fallbacks) {
      if (fs.existsSync(fb)) {
        const loaded = nativeImage.createFromPath(fb);
        if (!loaded.isEmpty()) {
          img = loaded;
          break;
        }
      }
    }
  }
  if (!img) {
    img = nativeImage.createEmpty();
  }
  trayIconCache.set(status, img);
  return img;
}

let lastProxyError: { title: string; provider: string; message: string; at: number; traceId: string } | null = null;
const proxyErrorHistory: ProxyErrorEntry[] = [];

export function pushProxyErrorHistory(p: ProxyErrorEntry): void {
  proxyErrorHistory.push(p);
  if (proxyErrorHistory.length > PROXY_ERROR_HISTORY_MAX) {
    proxyErrorHistory.splice(0, proxyErrorHistory.length - PROXY_ERROR_HISTORY_MAX);
  }
}

export function getProxyErrorHistory(): ProxyErrorEntry[] {
  return proxyErrorHistory;
}

let lastNotifiedTraceId: string | null = null;
let lastNotifiedAt = 0;

export function notifyProxyError(p: {
  traceId: string;
  provider: string;
  title: string;
  message: string;
}): void {
  if (!Notification.isSupported()) return;
  const mainWindow = getMainWindow();
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
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      win.webContents.send(DOCTOR_IPC_CHANNELS.PROXY_ERROR, {
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

export function updateTray(status: 'ok' | 'warn' | 'err'): void {
  if (!tray) return;
  tray.setImage(getTrayIcon(status));
  const tooltip = lastProxyError && status !== 'ok'
    ? `ag-doctor · ${status.toUpperCase()} · ${lastProxyError.provider}: ${lastProxyError.title.slice(0, TOOLTIP_TITLE_MAX)}`
    : `ag-doctor · ${status.toUpperCase()}`;
  tray.setToolTip(tooltip);
  tray.setContextMenu(buildTrayMenu());
}

export function buildTrayMenu(): Menu {
  const mainWindow = getMainWindow();
  const items: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Open dashboard',
      click: () => {
        const win = getMainWindow();
        if (win) {
          win.show();
          win.focus();
        } else {
          createWindow();
        }
      },
    },
    {
      label: 'Run doctor',
      click: () => {
        const win = getMainWindow();
        if (win) {
          win.show();
          win.focus();
          win.webContents.send(DOCTOR_IPC_CHANNELS.RUN_DOCTOR);
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
        const win = getMainWindow();
        if (win) {
          win.show();
          win.focus();
          win.webContents.send(DOCTOR_IPC_CHANNELS.PROXY_ERROR, {
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

export function createTray(): Tray {
  tray = new Tray(getTrayIcon('ok'));
  tray.setToolTip('ag-doctor');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', () => {
    const win = getMainWindow();
    if (win) {
      win.show();
      win.focus();
    } else {
      createWindow();
    }
  });
  return tray;
}

export function getTray(): Tray | null {
  return tray;
}
