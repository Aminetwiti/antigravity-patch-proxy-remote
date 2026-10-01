/**
 * customIpcBridge.ts — Safe bridge to register custom model & remote IPC handlers
 * on top of official Antigravity 2.17+ ipcHandlers without circular recursion
 * or colliding with official handlers.
 */
import { ipcMain } from 'electron';

let isRegistered = false;

export function registerCustomIpcHandlers(storageManager: any): void {
  if (isRegistered) {
    return;
  }
  isRegistered = true;

  // Wrap ipcMain.handle with safe deduplication so Electron never throws
  // "Attempted to register a second handler for <channel>".
  // Only register custom channels so official 2.18.1 handlers are never overwritten.
  const origHandle = ipcMain.handle.bind(ipcMain);
  (ipcMain as any).handle = function (channel: string, listener: any) {
    const isCustom =
      (channel.startsWith('storage:') &&
        !['storage:get-items', 'storage:update-items'].includes(channel)) ||
      channel.startsWith('remote:') ||
      channel.startsWith('proto:') ||
      channel.startsWith('ag:') ||
      channel.startsWith('chat-ui:');

    if (!isCustom) {
      return;
    }
    try {
      ipcMain.removeHandler(channel);
    } catch (_) {}
    return origHandle(channel, listener);
  };

  try {
    // Require our custom handlers specifically (customIpcHandlers.js) to avoid any
    // circular dependency with the official ipcHandlers.js
    const customHandlersModule = require('./customIpcHandlers');
    if (customHandlersModule && typeof customHandlersModule.registerIpcHandlers === 'function') {
      customHandlersModule.registerIpcHandlers(storageManager);
    }
    // Handler to serve rendererHook.js to sandboxed preload scripts safely
    ipcMain.handle('ag:get-renderer-hook', async () => {
      try {
        const fs = require('fs');
        const path = require('path');
        const hookPath = path.join(__dirname, 'rendererHook.js');
        if (fs.existsSync(hookPath)) {
          return fs.readFileSync(hookPath, 'utf8');
        }
      } catch (e) {
        console.warn('[customIpcBridge] Error reading rendererHook:', e);
      }
      return '';
    });
  } catch (err) {
    console.error('[customIpcBridge] Error registering custom handlers:', err);
  } finally {
    (ipcMain as any).handle = origHandle;
  }
}
