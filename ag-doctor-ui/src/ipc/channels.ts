/**
 * Strongly-typed IPC channel constants for ag-doctor-ui.
 * Ensures compile-time consistency across Main, Preload, and Renderer.
 */

export const DOCTOR_IPC_CHANNELS = {
  // CLI & Execution
  RUN: 'ag:run',
  INFO: 'ag:info',
  CONFIG: 'ag:config',
  CONFIG_SET_THEME: 'ag:config:set-theme',
  CONFIG_SET_NOTIFY: 'ag:config:set-notify',
  CONFIG_RESTORE_BACKUP: 'ag:config:restore-backup',
  NOTIFY: 'ag:notify',
  TRAY_STATUS: 'ag:tray-status',
  OPEN_EXTERNAL: 'ag:open-external',
  REVEAL: 'ag:reveal',
  TEST_MODEL: 'ag:test-model',
  REPAIR_RUN: 'ag:repair:run',
  RUN_DOCTOR: 'ag:run-doctor',
  NAVIGATE: 'ag:navigate',
  COMMAND_PALETTE: 'ag:command-palette',
  THEME_CHANGED: 'ag:theme-changed',

  // Providers
  PROVIDERS_GET: 'ag:providers:get',
  PROVIDERS_SAVE: 'ag:providers:save',
  PROVIDERS_DELETE: 'ag:providers:delete',
  PROVIDERS_FETCH_MODELS: 'ag:providers:fetch-models',
  PROVIDERS_TEST: 'ag:providers:test',
  PROVIDERS_CHANGED: 'ag:providers:changed',

  // Google Multi-Account Discovery & Quotas
  GOOGLE_DISCOVER_IDE_ACCOUNT: 'ag:google:discover-ide-account',
  GOOGLE_FETCH_ACCOUNT_QUOTAS: 'ag:google:fetch-account-quotas',
  GOOGLE_WARMUP_ACCOUNT: 'ag:google:warmup-account',
  GOOGLE_REFRESH_TOKEN: 'ag:google:refresh-token',
  GOOGLE_OAUTH_LOGIN: 'ag:google:oauth-login',
  GOOGLE_SWITCH_IDE_ACCOUNT: 'ag:google:switch-ide-account',

  // Proxy & MITM
  PROXY_START: 'ag:proxy:start',
  PROXY_STOP: 'ag:proxy:stop',
  PROXY_STATUS: 'ag:proxy:status',
  PROXY_RESTART: 'ag:proxy:restart',
  PROXY_START_STUB: 'ag:proxy:start-stub',
  PROXY_STUB_STATUS: 'ag:proxy:stub-status',
  PROXY_CHECK_MAIN_PORT: 'ag:proxy:check-main-port',
  PROXY_KILL_MAIN_PORT: 'ag:proxy:kill-main-port',
  PROXY_STATS: 'ag:proxy-stats',
  PROXY_ERROR: 'proxy:error',
  PROXY_ERROR_HISTORY: 'ag:proxy-error-history',
  MITM_TRAFFIC: 'mitm:traffic',

  // Network & Remote Daemon
  NETWORK_GET_LOCAL_IP: 'ag:network:getLocalIp',
  NETWORK_GENERATE_QR: 'ag:network:generateQr',
  NETWORK_START_DAEMON: 'ag:network:startDaemon',
  NETWORK_STOP_DAEMON: 'ag:network:stopDaemon',
  NETWORK_GET_DAEMON_STATUS: 'ag:network:getDaemonStatus',
  NETWORK_DAEMON_LOG: 'ag:network:daemonLog',

  // Antigravity Lifecycle
  ANTIGRAVITY_STATUS: 'ag:antigravity:status',
  ANTIGRAVITY_VERSION: 'ag:antigravity:version',
  ANTIGRAVITY_LAUNCH: 'ag:antigravity:launch',
  ANTIGRAVITY_KILL: 'ag:antigravity:kill',
  ANTIGRAVITY_RESTART: 'ag:antigravity:restart',
  ANTIGRAVITY_LAUNCH_LOGS: 'ag:antigravity:launch-logs',
  DETECT_INSTALLATION: 'ag:detect-installation',

  // Streaming
  STREAM_START: 'ag:stream:start',
  STREAM_CANCEL: 'ag:stream:cancel',
} as const;

export type DoctorIpcChannel = typeof DOCTOR_IPC_CHANNELS[keyof typeof DOCTOR_IPC_CHANNELS];
