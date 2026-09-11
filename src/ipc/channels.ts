/**
 * Centralized IPC channel names for Antigravity Patch Proxy.
 * Single source of truth across Main process (ipcHandlers) and Preload contextBridge.
 */

export const IPC_CHANNELS = {
  // Dialog & Filesystem
  DIALOG_OPEN_WORKSPACE: 'dialog:open-workspace',

  // Updater
  UPDATER_APPLY: 'updater:apply',
  UPDATER_QUIT_AND_INSTALL: 'updater:quit-and-install',
  UPDATER_GET_STATE: 'updater:get-state',
  UPDATER_CHECK_FOR_UPDATES: 'updater:check-for-updates',

  // IDE Installation
  IDE_IS_INSTALLED: 'ide:is-installed',
  IDE_INSTALL: 'ide:install',

  // System Notifications & Settings
  NOTIFICATION_SEND: 'notification:send',
  NOTIFICATION_CLICKED: 'notification:clicked',
  NOTIFICATION_OPEN_PREFS: 'notification:open-system-preferences',

  // Storage & Provider Configurations
  STORAGE_GET_ITEMS: 'storage:get-items',
  STORAGE_UPDATE_ITEMS: 'storage:update-items',
  STORAGE_GET_CUSTOM_MODELS: 'storage:get-custom-models',
  STORAGE_GET_PROVIDERS: 'storage:get-providers',
  STORAGE_GET_PRESETS: 'storage:get-well-known-presets',
  STORAGE_TEST_PROVIDER_HEALTH: 'storage:test-provider-health',
  STORAGE_EXPORT_PROVIDERS_BASE64: 'storage:export-providers-base64',
  STORAGE_IMPORT_PROVIDERS_BASE64: 'storage:import-providers-base64',
  STORAGE_SAVE_PROVIDER: 'storage:save-provider',
  STORAGE_DELETE_PROVIDER: 'storage:delete-provider',
  STORAGE_EXPORT_PROVIDERS: 'storage:export-providers',
  STORAGE_IMPORT_PROVIDERS: 'storage:import-providers',
  STORAGE_GET_DOCTOR_DIAGNOSTICS: 'storage:get-doctor-diagnostics',
  STORAGE_SAVE_CUSTOM_MODEL: 'storage:save-custom-model',
  STORAGE_DELETE_CUSTOM_MODEL: 'storage:delete-custom-model',
  STORAGE_TEST_MODEL_CONNECTION: 'storage:test-model-connection',
  STORAGE_FETCH_MODELS: 'storage:fetch-models',
  STORAGE_FETCH_PROVIDER_MODELS: 'storage:fetch-provider-models',

  // Logs & Diagnostics
  LOGS_ELECTRON: 'logs:electron',
  PROXY_ERROR: 'proxy:error',

  // Extensions & Agents
  EXTENSIONS_SEND_AUTHORITIES: 'extensions:send-authorities',
  AGENT_UPDATE_ACTIVE_COUNT: 'agent:update-active-count',

  // Window Controls
  WINDOW_SET_TITLE_BAR_OVERLAY: 'window:set-title-bar-overlay',
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_UNMAXIMIZE: 'window:unmaximize',
  WINDOW_IS_MAXIMIZED: 'window:is-maximized',
  WINDOW_CLOSE: 'window:close',
  WINDOW_TOGGLE_DEVTOOLS: 'window:toggle-devtools',

  // External Shell
  SHELL_OPEN_EXTERNAL: 'shell:open-external',

  // Remote Agent Runtime
  REMOTE_TEST_HEALTH: 'remote:test-health',
  REMOTE_EXECUTE_COMMAND: 'remote:execute-command',
  REMOTE_SET_STATE: 'remote:set-state',
  REMOTE_GET_STATE: 'remote:get-state',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
