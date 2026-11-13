import { app, BrowserWindow, dialog, ipcMain, Notification, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import { broadcastState, checkForUpdates } from '../../compat/updater';
import log from 'electron-log/main';
import * as fs from 'fs/promises';
import * as path from 'path';
import { setProxyErrorEmitter, type ProxyErrorPayload } from '../../proxy';
import { extensionAuthorities } from '../../shared/customScheme';
import { updateTrayAgentCount } from '../../ui/tray';
import { IPC_CHANNELS } from '../channels';

export function registerSystemHandlers(): void {
  // Fan-out proxy errors from proxy.ts to every BrowserWindow via the
  // 'proxy:error' IPC channel. The renderer subscribes through preload.ts
  // (window.ag.onProxyError) and renders the matching native quota card.
  setProxyErrorEmitter((payload: ProxyErrorPayload) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('proxy:error', payload);
      }
    }
  });

  // Dialog
  ipcMain.handle(IPC_CHANNELS.DIALOG_OPEN_WORKSPACE, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Open workspace',
    });
    if (result.canceled || result.filePaths.length === 0) {
      return undefined;
    }
    return result.filePaths[0];
  });

  // Auto-updater
  ipcMain.handle(IPC_CHANNELS.UPDATER_APPLY, async () => {
    broadcastState({ type: 'ready' });
  });
  ipcMain.handle(IPC_CHANNELS.UPDATER_QUIT_AND_INSTALL, () => {
    if (!app.isPackaged) {
      console.log('[AutoUpdater] Skipping quitAndInstall (requires a packaged app).');
      return;
    }
    autoUpdater.quitAndInstall();
  });

  // IDE bridge (2.3.1+) � exposed via window.ide.isInstalled() in the preload.
  // The renderer asks the main process whether the IDE is installed; since this
  // IS the IDE process, we always answer true. Without this handler the renderer
  // hits "No handler registered for 'ide:is-installed'" and stays on a black
  // screen because the mount path throws before React can render.
  ipcMain.handle(IPC_CHANNELS.IDE_IS_INSTALLED, () => true);

  // Notifications
  ipcMain.handle(
    IPC_CHANNELS.NOTIFICATION_SEND,
    (_event, options: { title: string; body: string; silent?: boolean; payload?: unknown }) => {
      const notification = new Notification({
        title: options.title,
        body: options.body,
        silent: options.silent ?? false,
      });
      notification.on('click', () => {
        const win = BrowserWindow.getAllWindows()[0];
        if (win) {
          if (win.isMinimized()) {
            win.restore();
          }
          win.show();
          win.focus();
          if (options.payload) {
            win.webContents.send(IPC_CHANNELS.NOTIFICATION_CLICKED, options.payload);
          }
        }
      });
      notification.show();
    },
  );

  // Note: copied from our desktop AGY implementation:
  // vs/platform/nativeNotification/electron-main/electronNotificationService.ts
  ipcMain.handle(IPC_CHANNELS.NOTIFICATION_OPEN_PREFS, async () => {
    if (process.platform === 'darwin') {
      void shell.openExternal('x-apple.systempreferences:com.apple.preference.notifications');
    } else if (process.platform === 'win32') {
      void shell.openExternal('ms-settings:notifications');
    } else if (process.platform === 'linux') {
      const { exec } = await import('child_process');
      const commands = [
        'gnome-control-center notifications',
        'systemsettings kcm_notifications',
        'xfce4-notifyd-config',
        'gnome-control-center',
        'systemsettings',
      ];
      for (const command of commands) {
        try {
          exec(command);
          return; // If one command executes without immediate error, assume success for now
        } catch {
          // Try next
        }
      }
    }
  });


  // Logs
  ipcMain.handle(IPC_CHANNELS.LOGS_ELECTRON, async () => {
    try {
      const logPath = log.transports.file.getFile().path;
      const contents = await fs.readFile(logPath, 'utf-8');
      if (contents.length > 100_000) {
        return '... [Truncated for IPC limits] ...\n' + contents.slice(-100_000);
      }
      return contents;
    } catch (err) {
      return `Failed to read logs: ${String(err)}`;
    }
  });

  // Sidecar extension custom scheme
  ipcMain.handle(IPC_CHANNELS.EXTENSIONS_SEND_AUTHORITIES, async (_event, authorities: Record<string, string>) => {
    extensionAuthorities.clear();
    for (const [key, value] of Object.entries(authorities)) {
      extensionAuthorities.set(key, value);
    }
  });

  // Agent
  ipcMain.handle(IPC_CHANNELS.AGENT_UPDATE_ACTIVE_COUNT, async (_event, count: number) => {
    updateTrayAgentCount(count);
  });

  // Window
  ipcMain.handle(IPC_CHANNELS.WINDOW_SET_TITLE_BAR_OVERLAY, async (_event, options: { color: string; symbolColor: string }) => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    if (win && process.platform === 'win32') {
      win.setTitleBarOverlay({
        color: options.color,
        symbolColor: options.symbolColor,
        height: 30,
      });
    }
  });
  ipcMain.handle(IPC_CHANNELS.WINDOW_MINIMIZE, async () => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    if (win) {
      win.minimize();
    }
  });
  ipcMain.handle(IPC_CHANNELS.WINDOW_MAXIMIZE, async () => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    if (win) {
      win.maximize();
    }
  });
  ipcMain.handle(IPC_CHANNELS.WINDOW_UNMAXIMIZE, async () => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    if (win) {
      win.unmaximize();
    }
  });
  ipcMain.handle(IPC_CHANNELS.WINDOW_IS_MAXIMIZED, async () => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    return win ? win.isMaximized() : false;
  });
  ipcMain.handle(IPC_CHANNELS.WINDOW_CLOSE, async () => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    if (win) {
      win.close();
    }
  });
  ipcMain.handle(IPC_CHANNELS.WINDOW_TOGGLE_DEVTOOLS, async () => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    if (win) {
      win.webContents.toggleDevTools();
    }
  });

  // Auto-updater manual check
  ipcMain.handle(IPC_CHANNELS.UPDATER_GET_STATE, () => ({ type: 'idle' }));
  ipcMain.handle(IPC_CHANNELS.UPDATER_CHECK_FOR_UPDATES, () => {
    checkForUpdates(true);
  });

  // Safe external shell launch
  ipcMain.handle(IPC_CHANNELS.SHELL_OPEN_EXTERNAL, async (_event, url: string) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      await shell.openExternal(url);
    }
  });
}
