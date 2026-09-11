/**
 * contextBridge surface exposed to the renderer.
 * ponytail: this module owns the renderer-facing API. Anything new should be added
 * here + `declare global` below, never as ad-hoc `window.X = ...` somewhere else.
 */
import { contextBridge, ipcRenderer, webFrame } from 'electron';
import type {
  UpdaterAPI, DialogAPI, NotificationAPI, StorageAPI, LogsAPI,
  ExtensionsAPI, DeepLinkAPI, AgentAPI, ElectronNativeAPI, UpdaterState,
  NotificationOptions,
} from './types';

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
  importProviders: (base64) => ipcRenderer.invoke('storage:import-providers-base64', base64),
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

export function registerApiBridge(): void {
  contextBridge.exposeInMainWorld('electronUpdater', updaterAPI);
  contextBridge.exposeInMainWorld('dialog', dialogAPI);
  contextBridge.exposeInMainWorld('nativeNotifications', notificationAPI);
  contextBridge.exposeInMainWorld('nativeStorage', storageAPI);
  contextBridge.exposeInMainWorld('logs', logsAPI);
  contextBridge.exposeInMainWorld('extensions', extensionsAPI);
  contextBridge.exposeInMainWorld('deepLink', deepLinkAPI);
  contextBridge.exposeInMainWorld('agent', agentAPI);
  contextBridge.exposeInMainWorld('electronNative', electronNativeAPI);
}

declare global {
  interface Window {
    electronUpdater: UpdaterAPI;
    dialog: DialogAPI;
    nativeNotifications: NotificationAPI;
    nativeStorage: StorageAPI;
    logs: LogsAPI;
    extensions: ExtensionsAPI;
    deepLink: DeepLinkAPI;
    agent: AgentAPI;
    electronNative: ElectronNativeAPI;
  }
}
