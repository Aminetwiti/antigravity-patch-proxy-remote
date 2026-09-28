/**
 * customIpcBridge.ts — Safe bridge to register custom model & remote IPC handlers
 * on top of official Antigravity 2.17+ ipcHandlers without colliding or overriding
 * new official handlers (like WSL).
 */
import { ipcMain } from 'electron';
import { registerIpcHandlers as registerBaseHandlers } from './ipcHandlers';

export function registerCustomIpcHandlers(storageManager: any): void {
  // Wrap ipcMain.handle with safe deduplication so Electron never throws
  // "Attempted to register a second handler for <channel>"
  const origHandle = ipcMain.handle.bind(ipcMain);
  (ipcMain as any).handle = function (channel: string, listener: any) {
    try {
      ipcMain.removeHandler(channel);
    } catch (_) {}
    return origHandle(channel, listener);
  };

  try {
    registerBaseHandlers(storageManager);
  } catch (err) {
    console.error('[customIpcBridge] Error registering base handlers:', err);
  } finally {
    (ipcMain as any).handle = origHandle;
  }
}
