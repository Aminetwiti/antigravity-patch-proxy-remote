import { app, ipcMain, shell, Notification } from 'electron';
import path from 'path';
import fs from 'fs';
import { DOCTOR_IPC_CHANNELS } from '../../../ipc/channels';
import {
  checkForUpdates,
  downloadUpdate,
  installUpdate,
  loadUpdateSettings,
  saveUpdateSettings,
} from '../../../services/runtime/updateService';
import { getCustomModelsPath } from '../accounts/providersIpc';
import type { MainContext } from '../../types';

export function isNotifyEnabled(ctx: MainContext): boolean {
  try {
    const cfg = ctx.getConfigPayload();
    const ui = cfg.ui as Record<string, unknown> | undefined;
    if (ui && typeof ui.notifyEnabled === 'boolean') return ui.notifyEnabled;
  } catch {
    // fall through
  }
  return true;
}

export function registerUpdatesConfigIpc(ctx: MainContext): void {
  ipcMain.handle(DOCTOR_IPC_CHANNELS.UPDATE_CHECK, async (_evt, channel?: 'stable' | 'beta') => {
    try {
      return await checkForUpdates(channel, true);
    } catch (err: any) {
      return {
        hasUpdate: false,
        currentVersion: app.getVersion(),
        latestVersion: app.getVersion(),
        releaseNotes: '',
        publishedAt: new Date().toISOString(),
        downloadUrl: '',
        channel: channel || 'stable',
        isPrerelease: false,
        error: err?.message || String(err),
      };
    }
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.UPDATE_DOWNLOAD, async (_evt, downloadUrl?: string) => {
    return downloadUpdate(downloadUrl, (progress) => {
      const mainWindow = ctx.getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(DOCTOR_IPC_CHANNELS.UPDATE_PROGRESS, progress);
      }
    });
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.UPDATE_INSTALL, async (_evt, filePath?: string, silent?: boolean) => {
    return installUpdate(filePath, silent ?? false);
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.UPDATE_GET_SETTINGS, async () => {
    return loadUpdateSettings();
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.UPDATE_SAVE_SETTINGS, async (_evt, settings: any) => {
    return saveUpdateSettings(settings);
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.INFO, async () => {
    return ctx.getInfoPayload();
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.CONFIG, async () => {
    return ctx.getConfigPayload();
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.CONFIG_SET_THEME, async (_evt, theme: 'dark' | 'light') => {
    try {
      const cfgPath = ctx.getConfigPath();
      let cfg: Record<string, unknown> = {};
      if (fs.existsSync(cfgPath)) {
        cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
      }
      cfg.ui = { ...(typeof cfg.ui === 'object' && cfg.ui !== null ? cfg.ui : {}), theme };
      fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
      fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
      ctx.invalidateConfigCache();
      const mainWindow = ctx.getMainWindow();
      mainWindow?.webContents.send(DOCTOR_IPC_CHANNELS.THEME_CHANGED, theme);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.CONFIG_SET_NOTIFY, async (_evt, enabled: boolean) => {
    try {
      const cfgPath = ctx.getConfigPath();
      let cfg: Record<string, unknown> = {};
      if (fs.existsSync(cfgPath)) {
        cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
      }
      cfg.ui = { ...(typeof cfg.ui === 'object' && cfg.ui !== null ? cfg.ui : {}), notifyEnabled: !!enabled };
      fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
      fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
      ctx.invalidateConfigCache();
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
      const cfgPath = ctx.getConfigPath();
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
      ctx.invalidateConfigCache();
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
      ctx.invalidateConfigCache();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to restore backup (invalid JSON format)' };
    }
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.NOTIFY, async (_evt, title: string, body: string) => {
    if (Notification.isSupported()) {
      new Notification({ title, body }).show();
    }
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.TRAY_STATUS, async (_evt, status: 'ok' | 'warn' | 'err') => {
    ctx.updateTray(status);
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.REVEAL, async (_evt, p: string) => {
    shell.showItemInFolder(p);
  });
}
