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
import { IPC_CHANNELS } from './ipc/channels';
import type {
  UpdaterAPI, DialogAPI, NotificationAPI, StorageAPI, LogsAPI,
  ExtensionsAPI, DeepLinkAPI, AgentAPI, ElectronNativeAPI, UpdaterState,
  NotificationOptions, CustomModelEntry, TestModelParams, ConnectionTestResult,
  FetchModelsParams, FetchModelsResult, ProviderFileEntry
} from './preload/types';

const preloadLog = createLogger('Preload');
preloadLog.debug('Preload script loaded');

const updaterAPI: UpdaterAPI = {
  getState: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATER_GET_STATE).catch(() => ({ type: 'idle' })),
  onStateChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, state: UpdaterState) => {
      callback(state);
    };
    ipcRenderer.on(IPC_CHANNELS.UPDATER_STATE_CHANGED, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.UPDATER_STATE_CHANGED, handler);
    };
  },
  applyUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATER_APPLY),
  quitAndInstall: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATER_QUIT_AND_INSTALL),
  checkForUpdates: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATER_CHECK_FOR_UPDATES),
};

const dialogAPI: DialogAPI = {
  showOpenDialog: () => ipcRenderer.invoke(IPC_CHANNELS.DIALOG_OPEN_WORKSPACE),
};

const notificationAPI: NotificationAPI = {
  send: (options: NotificationOptions) => ipcRenderer.invoke(IPC_CHANNELS.NOTIFICATION_SEND, options),
  openSystemPreferences: () => ipcRenderer.invoke(IPC_CHANNELS.NOTIFICATION_OPEN_PREFS),
  onClicked: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      callback(payload);
    };
    ipcRenderer.on(IPC_CHANNELS.NOTIFICATION_CLICKED, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.NOTIFICATION_CLICKED, handler);
    };
  },
};

export const storageAPI: StorageAPI = {
  getItems: () => ipcRenderer.invoke(IPC_CHANNELS.STORAGE_GET_ITEMS),
  updateItems: (changes) => ipcRenderer.invoke(IPC_CHANNELS.STORAGE_UPDATE_ITEMS, changes),
  onChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, changes: Record<string, string | null>) => {
      callback(changes);
    };
    ipcRenderer.on(IPC_CHANNELS.STORAGE_CHANGED, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.STORAGE_CHANGED, handler);
    };
  },
  getCustomModels: () => ipcRenderer.invoke(IPC_CHANNELS.STORAGE_GET_CUSTOM_MODELS),
  saveCustomModel: (model) => ipcRenderer.invoke(IPC_CHANNELS.STORAGE_SAVE_CUSTOM_MODEL, model),
  deleteCustomModel: (modelName) => ipcRenderer.invoke(IPC_CHANNELS.STORAGE_DELETE_CUSTOM_MODEL, modelName),
  testModelConnection: (model) => ipcRenderer.invoke(IPC_CHANNELS.STORAGE_TEST_MODEL_CONNECTION, model),
  fetchModels: (params) => ipcRenderer.invoke(IPC_CHANNELS.STORAGE_FETCH_MODELS, params),
  getProviders: () => ipcRenderer.invoke(IPC_CHANNELS.STORAGE_GET_PROVIDERS),
  saveProvider: (provider) => ipcRenderer.invoke(IPC_CHANNELS.STORAGE_SAVE_PROVIDER, provider),
  deleteProvider: (providerId) => ipcRenderer.invoke(IPC_CHANNELS.STORAGE_DELETE_PROVIDER, providerId),
  discoverLocalAntigravityAccount: () => ipcRenderer.invoke(IPC_CHANNELS.STORAGE_DISCOVER_LOCAL_ACCOUNT),
  exportProviders: () => ipcRenderer.invoke(IPC_CHANNELS.STORAGE_EXPORT_PROVIDERS_BASE64),
  importProviders: (base64Code?: string) =>
    base64Code
      ? ipcRenderer.invoke(IPC_CHANNELS.STORAGE_IMPORT_PROVIDERS_BASE64, base64Code)
      : ipcRenderer.invoke(IPC_CHANNELS.STORAGE_IMPORT_PROVIDERS),
  getDoctorDiagnostics: () => ipcRenderer.invoke(IPC_CHANNELS.STORAGE_GET_DOCTOR_DIAGNOSTICS),
  testRemoteHealth: (payload) => ipcRenderer.invoke(IPC_CHANNELS.REMOTE_TEST_HEALTH, payload),
  executeRemoteCommand: (payload) => ipcRenderer.invoke(IPC_CHANNELS.REMOTE_EXECUTE_COMMAND, payload),
  listRemoteSessions: (payload) => ipcRenderer.invoke(IPC_CHANNELS.REMOTE_LIST_SESSIONS, payload),
  createRemoteSession: (payload) => ipcRenderer.invoke(IPC_CHANNELS.REMOTE_CREATE_SESSION, payload),
  getRemoteWorkspaces: (payload) => ipcRenderer.invoke(IPC_CHANNELS.REMOTE_GET_WORKSPACES, payload),
  injectUserStatus: (rawBuffer: Uint8Array) => ipcRenderer.invoke(IPC_CHANNELS.PROTO_INJECT_USER_STATUS, rawBuffer),
  injectAvailableModels: (rawBuffer: Uint8Array) => ipcRenderer.invoke(IPC_CHANNELS.PROTO_INJECT_AVAILABLE_MODELS, rawBuffer),
  setRemoteState: (payload) => ipcRenderer.invoke(IPC_CHANNELS.REMOTE_SET_STATE, payload),
  getRemoteState: () => ipcRenderer.invoke(IPC_CHANNELS.REMOTE_GET_STATE),
};

const logsAPI: LogsAPI = {
  getElectronLogs: () => ipcRenderer.invoke(IPC_CHANNELS.LOGS_ELECTRON),
};

const extensionsAPI: ExtensionsAPI = {
  sendAuthorities: (authoritiesMap) => ipcRenderer.invoke(IPC_CHANNELS.EXTENSIONS_SEND_AUTHORITIES, authoritiesMap),
};

const deepLinkAPI: DeepLinkAPI = {
  onDeepLink: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, url: string) => {
      callback(url);
    };
    ipcRenderer.on(IPC_CHANNELS.DEEP_LINK, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.DEEP_LINK, handler);
    };
  },
  getStoredDeepLink: () => ipcRenderer.invoke(IPC_CHANNELS.DEEP_LINK_GET_STORED),
};

const agentAPI: AgentAPI = {
  updateActiveAgentCount: (count) => ipcRenderer.invoke(IPC_CHANNELS.AGENT_UPDATE_ACTIVE_COUNT, count),
};

const electronNativeAPI: ElectronNativeAPI = {
  getZoomLevel: () => webFrame.getZoomFactor(),
  setTitleBarOverlay: (options) => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_SET_TITLE_BAR_OVERLAY, options),
  minimize: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MINIMIZE),
  maximize: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MAXIMIZE),
  unmaximize: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_UNMAXIMIZE),
  isMaximized: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_IS_MAXIMIZED),
  close: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_CLOSE),
  toggleDevTools: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_TOGGLE_DEVTOOLS),
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
  openExternal: (url) => ipcRenderer.invoke(IPC_CHANNELS.SHELL_OPEN_EXTERNAL, url),
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
