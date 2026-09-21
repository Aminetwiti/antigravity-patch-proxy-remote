/**
 * Preload script — runs in every BrowserWindow before the page loads.
 * Exposes a minimal, secure API via contextBridge so the renderer can
 * communicate with the main-process auto-updater without nodeIntegration.
 */

import * as fs from 'fs';
import * as path from 'path';
import { contextBridge, ipcRenderer, webFrame } from 'electron';
import { generateModelPlaceholderId, toSlug } from './proxy/idGenerator';
import { classifyError } from './proxy/errorClassifier';
import { createLogger } from './shared/logger';
import type {
  UpdaterAPI, DialogAPI, NotificationAPI, StorageAPI, LogsAPI,
  ExtensionsAPI, DeepLinkAPI, AgentAPI, ElectronNativeAPI, UpdaterState,
  NotificationOptions, CustomModelEntry, TestModelParams, ConnectionTestResult,
  FetchModelsParams, FetchModelsResult, ProviderFileEntry
} from './preload/types';

const preloadLog = createLogger('Preload');
preloadLog.debug('Preload script loaded');

const updaterAPI: UpdaterAPI = {
  getState: () => ipcRenderer.invoke('updater:get-state').catch(() => ({ type: 'idle' })),
  onStateChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, state: UpdaterState) => {
      callback(state);
    };
    ipcRenderer.on('updater:state-changed', handler);
    return () => {
      ipcRenderer.removeListener('updater:state-changed', handler);
    };
  },
  applyUpdate: () => ipcRenderer.invoke('updater:apply'),
  quitAndInstall: () => ipcRenderer.invoke('updater:quit-and-install'),
  checkForUpdates: () => ipcRenderer.invoke('updater:check-for-updates'),
};

const dialogAPI: DialogAPI = {
  showOpenDialog: () => ipcRenderer.invoke('dialog:open-workspace'),
};

const notificationAPI: NotificationAPI = {
  send: (options: NotificationOptions) => ipcRenderer.invoke('notification:send', options),
  openSystemPreferences: () => ipcRenderer.invoke('notification:open-system-preferences'),
  onClicked: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      callback(payload);
    };
    ipcRenderer.on('notification:clicked', handler);
    return () => {
      ipcRenderer.removeListener('notification:clicked', handler);
    };
  },
};

export const storageAPI: StorageAPI = {
  getItems: () => ipcRenderer.invoke('storage:get-items'),
  updateItems: (changes) => ipcRenderer.invoke('storage:update-items', changes),
  onChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, changes: Record<string, string | null>) => {
      callback(changes);
    };
    ipcRenderer.on('storage:changed', handler);
    return () => {
      ipcRenderer.removeListener('storage:changed', handler);
    };
  },
  getCustomModels: () => ipcRenderer.invoke('storage:get-custom-models'),
  saveCustomModel: (model) => ipcRenderer.invoke('storage:save-custom-model', model),
  deleteCustomModel: (modelName) => ipcRenderer.invoke('storage:delete-custom-model', modelName),
  testModelConnection: (model) => ipcRenderer.invoke('storage:test-model-connection', model),
  fetchModels: (params) => ipcRenderer.invoke('storage:fetch-models', params),
  getProviders: () => ipcRenderer.invoke('storage:get-providers'),
  saveProvider: (provider) => ipcRenderer.invoke('storage:save-provider', provider),
  deleteProvider: (providerId) => ipcRenderer.invoke('storage:delete-provider', providerId),
  exportProviders: () => ipcRenderer.invoke('storage:export-providers-base64'),
  importProviders: (base64Code?: string) =>
    base64Code
      ? ipcRenderer.invoke('storage:import-providers-base64', base64Code)
      : ipcRenderer.invoke('storage:import-providers'),
  getDoctorDiagnostics: () => ipcRenderer.invoke('storage:get-doctor-diagnostics'),
  testRemoteHealth: (payload) => ipcRenderer.invoke('remote:test-health', payload),
  executeRemoteCommand: (payload) => ipcRenderer.invoke('remote:execute-command', payload),
  listRemoteSessions: (payload) => ipcRenderer.invoke('remote:list-sessions', payload),
  createRemoteSession: (payload) => ipcRenderer.invoke('remote:create-session', payload),
  getRemoteWorkspaces: (payload) => ipcRenderer.invoke('remote:get-workspaces', payload),
  injectUserStatus: (rawBuffer: Uint8Array) => ipcRenderer.invoke('proto:inject-user-status', rawBuffer),
  injectAvailableModels: (rawBuffer: Uint8Array) => ipcRenderer.invoke('proto:inject-available-models', rawBuffer),
  setRemoteState: (payload) => ipcRenderer.invoke('remote:set-state', payload),
  getRemoteState: () => ipcRenderer.invoke('remote:get-state'),
};

const logsAPI: LogsAPI = {
  getElectronLogs: () => ipcRenderer.invoke('logs:electron'),
};

const extensionsAPI: ExtensionsAPI = {
  sendAuthorities: (authoritiesMap) => ipcRenderer.invoke('extensions:send-authorities', authoritiesMap),
};

const deepLinkAPI: DeepLinkAPI = {
  onDeepLink: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, url: string) => {
      callback(url);
    };
    ipcRenderer.on('deep-link', handler);
    return () => {
      ipcRenderer.removeListener('deep-link', handler);
    };
  },
  getStoredDeepLink: () => ipcRenderer.invoke('deep-link:get-stored'),
};

const agentAPI: AgentAPI = {
  updateActiveAgentCount: (count) => ipcRenderer.invoke('agent:update-active-count', count),
};

const electronNativeAPI: ElectronNativeAPI = {
  getZoomLevel: () => webFrame.getZoomFactor(),
  setTitleBarOverlay: (options) => ipcRenderer.invoke('window:set-title-bar-overlay', options),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  unmaximize: () => ipcRenderer.invoke('window:unmaximize'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  close: () => ipcRenderer.invoke('window:close'),
  toggleDevTools: () => ipcRenderer.invoke('window:toggle-devtools'),
  zoomIn: () => {
    const current = webFrame.getZoomLevel();
    webFrame.setZoomLevel(current + 0.5);
  },
  zoomOut: () => {
    const current = webFrame.getZoomLevel();
    webFrame.setZoomLevel(current - 0.5);
  },
  resetZoom: () => {
    webFrame.setZoomLevel(0);
  },
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
};

// Helper calls for patcher pattern matching
if (process.env.NODE_ENV === 'test-patcher-never-run') {
  (generateModelPlaceholderId as unknown as (m: unknown) => string)('x');
  (toSlug as unknown as (m: unknown) => string)('x');
  (classifyError as unknown as (s: number, e: unknown, b: unknown) => unknown)(0, null, null);
}

contextBridge.exposeInMainWorld('electronUpdater', updaterAPI);
contextBridge.exposeInMainWorld('dialog', dialogAPI);
contextBridge.exposeInMainWorld('nativeNotifications', notificationAPI);
contextBridge.exposeInMainWorld('nativeStorage', storageAPI);
contextBridge.exposeInMainWorld('logs', logsAPI);
contextBridge.exposeInMainWorld('extensions', extensionsAPI);
contextBridge.exposeInMainWorld('deepLink', deepLinkAPI);
contextBridge.exposeInMainWorld('agent', agentAPI);
contextBridge.exposeInMainWorld('electronNative', electronNativeAPI);

// Intercept GetUserStatus, GetAvailableModels, and RunCommand in the renderer without redirects (which break ConnectRPC)
try {
  webFrame.executeJavaScript(`
    (function() {
      if (window.__ag_fetch_hooked) return;
      window.__ag_fetch_hooked = true;
      const origFetch = window.fetch;

      function readVarintFromUint8(buf, offset) {
        let res = 0, shift = 0, bytes = 0;
        while (offset + bytes < buf.length) {
          const b = buf[offset + bytes];
          res |= (b & 0x7f) << shift;
          bytes++;
          if (!(b & 0x80)) break;
          shift += 7;
        }
        return { value: res >>> 0, bytes };
      }

      function encodeVarint(val) {
        const b = [];
        let v = val >>> 0;
        do {
          let byte = v & 0x7f;
          v >>>= 7;
          if (v !== 0) byte |= 0x80;
          b.push(byte);
        } while (v !== 0);
        return b;
      }

      function encodeStringField(fieldNum, str) {
        const strBytes = new TextEncoder().encode(str || '');
        const tag = (fieldNum << 3) | 2;
        return [...encodeVarint(tag), ...encodeVarint(strBytes.length), ...strBytes];
      }

      function encodeVarintField(fieldNum, val) {
        const tag = (fieldNum << 3) | 0;
        return [...encodeVarint(tag), ...encodeVarint(val)];
      }

      function buildRunCommandResponse(stdout, stderr, exitCode, timedOut) {
        const payload = [
          ...encodeStringField(1, stdout || ''),
          ...encodeStringField(2, stderr || ''),
          ...encodeVarintField(3, exitCode || 0),
          ...encodeVarintField(4, timedOut ? 1 : 0),
        ];
        const header = [0x00, (payload.length >>> 24) & 0xff, (payload.length >>> 16) & 0xff, (payload.length >>> 8) & 0xff, payload.length & 0xff];
        return new Uint8Array([...header, ...payload]);
      }

      function parseRunCommandRequest(buffer) {
        let offset = 0;
        if (buffer.length >= 5 && (buffer[0] === 0x00 || buffer[0] === 0x80)) {
          offset = 5;
        }
        let command = '';
        const args = [];
        let cwd = '';
        while (offset < buffer.length) {
          const tagVar = readVarintFromUint8(buffer, offset);
          offset += tagVar.bytes;
          const tag = tagVar.value;
          const wireType = tag & 0x07;
          const fieldNum = tag >>> 3;
          if (wireType === 2) {
            const lenVar = readVarintFromUint8(buffer, offset);
            offset += lenVar.bytes;
            const len = lenVar.value;
            const strVal = new TextDecoder().decode(buffer.subarray(offset, offset + len));
            offset += len;
            if (fieldNum === 1) command = strVal;
            else if (fieldNum === 2) args.push(strVal);
            else if (fieldNum === 3) cwd = strVal;
          } else if (wireType === 0) {
            const v = readVarintFromUint8(buffer, offset);
            offset += v.bytes;
          } else {
            break;
          }
        }
        return { command, args, cwd };
      }

      window.fetch = async function(...args) {
        const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : (args[0] && args[0].href ? args[0].href : ''));
        const isUserStatus = typeof url === 'string' && url.includes('LanguageServerService/GetUserStatus');
        const isAvailableModels = typeof url === 'string' && url.includes('LanguageServerService/GetAvailableModels');
        const isRunCommand = typeof url === 'string' && url.includes('LanguageServerService/RunCommand');

        // Handle RunCommand interception for remote sessions
        if (isRunCommand && window.__ag_is_remote_session && window.__ag_is_remote_session()) {
          try {
            let reqBuf = null;
            if (args[1] && args[1].body) {
              if (args[1].body instanceof Uint8Array) reqBuf = args[1].body;
              else if (args[1].body instanceof ArrayBuffer) reqBuf = new Uint8Array(args[1].body);
            }
            if (reqBuf) {
              const parsed = parseRunCommandRequest(reqBuf);
              let fullCmd = parsed.command;
              if (parsed.args && parsed.args.length > 0) {
                fullCmd += ' ' + parsed.args.join(' ');
              }
              if (fullCmd && window.__ag_execute_remote_command) {
                console.log('[AG Remote] Intercepting RunCommand for Remote VPS:', fullCmd);
                const res = await window.__ag_execute_remote_command(fullCmd);
                const respBytes = buildRunCommandResponse(res.stdout || '', res.stderr || '', res.exitCode ?? 0, false);
                return new Response(respBytes, {
                  status: 200,
                  statusText: 'OK',
                  headers: {
                    'content-type': 'application/grpc-web+proto',
                    'content-length': String(respBytes.length)
                  }
                });
              }
            }
          } catch (e) {
            console.error('[AG Remote] RunCommand interception error, falling back:', e);
          }
        }

        if (!isUserStatus && !isAvailableModels) {
          return origFetch.apply(this, args);
        }

        try {
          const response = await origFetch.apply(this, args);
          if (!response.ok) {
            return response;
          }
          const rawBuf = await response.arrayBuffer();
          let modifiedBytes = null;
          if (isUserStatus && window.nativeStorage && window.nativeStorage.injectUserStatus) {
            try {
              modifiedBytes = await window.nativeStorage.injectUserStatus(new Uint8Array(rawBuf));
            } catch (e) {
              console.warn('[AG] injectUserStatus IPC error:', e);
              modifiedBytes = null;
            }
          } else if (isAvailableModels && window.nativeStorage && window.nativeStorage.injectAvailableModels) {
            try {
              modifiedBytes = await window.nativeStorage.injectAvailableModels(new Uint8Array(rawBuf));
            } catch (e) {
              console.warn('[AG] injectAvailableModels IPC error:', e);
              modifiedBytes = null;
            }
          }
          if (modifiedBytes && modifiedBytes.length > 0) {
            const headers = new Headers(response.headers);
            headers.set('content-length', String(modifiedBytes.length));
            return new Response(modifiedBytes, {
              status: response.status,
              statusText: response.statusText,
              headers: headers,
            });
          }
          return new Response(rawBuf, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
        } catch (err) {
          console.error('[AG] Fetch interceptor error:', err);
          return origFetch.apply(this, args);
        }
      };
    })();
  `);
} catch (e) {
  preloadLog.error('Failed to install fetch interceptor in main world', e);
}

// Inject Remote environment option into Antigravity 2.0 React UI and DOM
try {
  const hookPath = path.join(__dirname, 'rendererHook.js');
  if (fs.existsSync(hookPath)) {
    const hookScript = fs.readFileSync(hookPath, 'utf-8');
    webFrame.executeJavaScript(hookScript).catch((err) => {
      preloadLog.warn('Non-fatal error in remote UI hook:', err);
    });
  } else {
    preloadLog.warn('rendererHook.js not found at:', hookPath);
  }
} catch (e) {
  preloadLog.error('Failed to install Remote environment hook', e);
}

export * from './preload/types';
