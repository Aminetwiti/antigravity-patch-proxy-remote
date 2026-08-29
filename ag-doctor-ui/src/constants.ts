/**
 * Infrastructure constants and default configurations for ag-doctor-ui.
 */

export const DEFAULT_PROXY_PORT = 51074;
export const DEFAULT_STUB_PORT = 51999;
export const DEFAULT_DAEMON_PORT = 8090;
export const DEFAULT_BIND_HOST = '127.0.0.1';
export const DEFAULT_UPSTREAM_TARGET = 'http://127.0.0.1:50999';

// Timeouts & Debounce intervals (in milliseconds)
export const WORKER_CMD_TIMEOUT_MS = 60_000;
export const HTTP_HEALTH_TIMEOUT_MS = 2_000;
export const SOCKET_CONNECT_TIMEOUT_MS = 2_000;
export const PROXY_STARTUP_WAIT_MS = 1_500;
export const PROXY_FORCE_STOP_TIMEOUT_MS = 5_000;
export const PROXY_RESTART_PAUSE_MS = 500;
export const WATCHER_DEBOUNCE_MS = 300;
export const FLUSH_BATCH_MS = 50;
export const PROXY_POLL_INTERVAL_MS = 1_500;
export const NOTIFY_DEDUP_MS = 2_000;

// Capacities & limits
export const PROXY_STATS_MAX = 60;
export const PROXY_ERROR_HISTORY_MAX = 50;
export const TOOLTIP_TITLE_MAX = 60;
export const TOOLTIP_MSG_MAX = 80;
export const MAX_CLI_WORKERS = 3;
