/**
 * Preload script — exposes a strictly whitelisted IPC bridge to the renderer.
 */
import { contextBridge, ipcRenderer } from 'electron';
import { DOCTOR_IPC_CHANNELS } from './ipc/channels';

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

const api = {
  run: (args: string[]): Promise<RunResult> => ipcRenderer.invoke(DOCTOR_IPC_CHANNELS.RUN, args),

  // Provider Management APIs
  providers: {
    get: (): Promise<unknown[]> => ipcRenderer.invoke(DOCTOR_IPC_CHANNELS.PROVIDERS_GET),
    save: (p: unknown): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke(DOCTOR_IPC_CHANNELS.PROVIDERS_SAVE, p),
    delete: (id: string): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke(DOCTOR_IPC_CHANNELS.PROVIDERS_DELETE, id),
    fetchModels: (params: { apiUrl: string; apiKey: string }): Promise<{ success: boolean; models?: Array<{ id: string; displayName?: string; enabled?: boolean }>; error?: string }> => ipcRenderer.invoke(DOCTOR_IPC_CHANNELS.PROVIDERS_FETCH_MODELS, params),
    test: (params: { apiUrl: string; apiKey: string; id?: string; modelId?: string }): Promise<{ success: boolean; status?: number; latencyMs?: number; healthStatus?: 'healthy' | 'degraded' | 'offline'; error?: string }> =>
      ipcRenderer.invoke(DOCTOR_IPC_CHANNELS.PROVIDERS_TEST, params),
    onChanged: (handler: () => void): (() => void) => {
      const listener = () => handler();
      ipcRenderer.on(DOCTOR_IPC_CHANNELS.PROVIDERS_CHANGED, listener);
      return () => ipcRenderer.removeListener(DOCTOR_IPC_CHANNELS.PROVIDERS_CHANGED, listener);
    },
  },
  info: (): Promise<{
    platform: string;
    arch: string;
    versions: NodeJS.ProcessVersions;
    electron: string;
    node: string;
    chrome: string;
    cliPath: string;
  }> => ipcRenderer.invoke(DOCTOR_IPC_CHANNELS.INFO),
  config: (): Promise<Record<string, unknown>> => ipcRenderer.invoke(DOCTOR_IPC_CHANNELS.CONFIG),
  setTheme: (theme: 'dark' | 'light'): Promise<boolean> => ipcRenderer.invoke(DOCTOR_IPC_CHANNELS.CONFIG_SET_THEME, theme),
  setNotifyEnabled: (enabled: boolean): Promise<boolean> => ipcRenderer.invoke(DOCTOR_IPC_CHANNELS.CONFIG_SET_NOTIFY, enabled),
  restoreBackup: (): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke(DOCTOR_IPC_CHANNELS.CONFIG_RESTORE_BACKUP),
  getProxyErrorHistory: (): Promise<Array<{
    traceId: string;
    provider: string;
    status?: number;
    errorType: string;
    rawError: string;
    title: string;
    message: string;
    suggestions: string[];
    actionUrl?: string;
    at: number;
  }>> => ipcRenderer.invoke(DOCTOR_IPC_CHANNELS.PROXY_ERROR_HISTORY),
  notify: (title: string, body: string): Promise<void> => ipcRenderer.invoke(DOCTOR_IPC_CHANNELS.NOTIFY, title, body),
  trayStatus: (status: 'ok' | 'warn' | 'err'): Promise<void> => ipcRenderer.invoke(DOCTOR_IPC_CHANNELS.TRAY_STATUS, status),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke(DOCTOR_IPC_CHANNELS.OPEN_EXTERNAL, url),
  reveal: (p: string): Promise<void> => ipcRenderer.invoke(DOCTOR_IPC_CHANNELS.REVEAL, p),

  // MITM Proxy Server Management
  proxyStart: (): Promise<{ ok: boolean; message: string; pid?: number }> =>
    ipcRenderer.invoke(DOCTOR_IPC_CHANNELS.PROXY_START),
  proxyStop: (): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke(DOCTOR_IPC_CHANNELS.PROXY_STOP),
  proxyStatus: (): Promise<{ ok: boolean; data?: { running: boolean; port: number; pid?: number; error?: string }; error?: string }> =>
    ipcRenderer.invoke(DOCTOR_IPC_CHANNELS.PROXY_STATUS),
  proxyRestart: (): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke(DOCTOR_IPC_CHANNELS.PROXY_RESTART),

  // Network Utils
  getLocalIp: (): Promise<string> => ipcRenderer.invoke(DOCTOR_IPC_CHANNELS.NETWORK_GET_LOCAL_IP),
  generateQr: (text: string): Promise<string> => ipcRenderer.invoke(DOCTOR_IPC_CHANNELS.NETWORK_GENERATE_QR, text),
  startDaemon: (options: { port: number; tunnel: string; token: string; allowFirstAdmin?: boolean }): Promise<any> => 
    ipcRenderer.invoke(DOCTOR_IPC_CHANNELS.NETWORK_START_DAEMON, options),
  stopDaemon: (): Promise<any> => ipcRenderer.invoke(DOCTOR_IPC_CHANNELS.NETWORK_STOP_DAEMON),
  getDaemonStatus: (port?: number, token?: string): Promise<any> =>
    ipcRenderer.invoke(DOCTOR_IPC_CHANNELS.NETWORK_GET_DAEMON_STATUS, port, token),
  onDaemonLog: (callback: (data: string) => void) => {
    const handler = (_event: any, data: string) => callback(data);
    ipcRenderer.on(DOCTOR_IPC_CHANNELS.NETWORK_DAEMON_LOG, handler);
    return () => ipcRenderer.removeListener(DOCTOR_IPC_CHANNELS.NETWORK_DAEMON_LOG, handler);
  },

  // Antigravity lifecycle (version, status, launch, kill, restart)
  antigravityStatus: (): Promise<{ ok: boolean; data?: unknown; error?: string }> =>
    ipcRenderer.invoke(DOCTOR_IPC_CHANNELS.ANTIGRAVITY_STATUS),
  antigravityVersion: (): Promise<{ ok: boolean; data?: { version: string }; error?: string }> =>
    ipcRenderer.invoke(DOCTOR_IPC_CHANNELS.ANTIGRAVITY_VERSION),
  antigravityLaunch: (): Promise<{ ok: boolean; data?: { ok: boolean; pid?: number; message: string }; error?: string }> =>
    ipcRenderer.invoke(DOCTOR_IPC_CHANNELS.ANTIGRAVITY_LAUNCH),
  antigravityKill: (): Promise<{ ok: boolean; data?: { killed: number; message: string }; error?: string }> =>
    ipcRenderer.invoke(DOCTOR_IPC_CHANNELS.ANTIGRAVITY_KILL),
  antigravityRestart: (): Promise<{ ok: boolean; data?: { ok: boolean; message: string; pid?: number }; error?: string }> =>
    ipcRenderer.invoke(DOCTOR_IPC_CHANNELS.ANTIGRAVITY_RESTART),
  antigravityLaunchLogs: (): Promise<string> =>
    ipcRenderer.invoke(DOCTOR_IPC_CHANNELS.ANTIGRAVITY_LAUNCH_LOGS),

  // Proxy stub lifecycle — emergency fallback when Antigravity's bundled proxy fails
  proxyStartStub: (): Promise<{ ok: boolean; pid?: number; port?: number; note?: string; error?: string }> =>
    ipcRenderer.invoke(DOCTOR_IPC_CHANNELS.PROXY_START_STUB),
  proxyStubStatus: (): Promise<{ ok: boolean; data?: { ok: boolean; stub: boolean; latencyMs: number; error?: string }; error?: string }> =>
    ipcRenderer.invoke(DOCTOR_IPC_CHANNELS.PROXY_STUB_STATUS),
  proxyStats: (): Promise<{
    ok: boolean;
    data?: {
      current: { ok: boolean; latencyMs: number; stub: boolean; error?: string };
      history: Array<{ ts: number; latencyMs: number; ok: boolean }>;
      uptime: number;
    };
    error?: string;
  }> => ipcRenderer.invoke(DOCTOR_IPC_CHANNELS.PROXY_STATS),

  // Installation Detector — scans for Antigravity binaries (v1.x vs v2.0+)
  detectInstallation: (): Promise<{
    ok: boolean;
    data?: {
      candidates: Array<{
        path: string;
        version: 'v1.x' | 'v2.0+' | 'unknown';
        exists: boolean;
        size?: number;
        modified?: string;
        process?: { pid: number; name: string } | null;
        portInUse?: { port: number; by: string } | null;
        recommended?: boolean;
        reason?: string;
      }>;
      hasConflict: boolean;
      summary: string;
    };
    error?: string;
  }> => ipcRenderer.invoke(DOCTOR_IPC_CHANNELS.DETECT_INSTALLATION),

  // Model testing — tests a single model's connection
  testModel: (name: string): Promise<{ ok: boolean; data?: unknown; error?: string }> =>
    ipcRenderer.invoke(DOCTOR_IPC_CHANNELS.TEST_MODEL, name),

  repairRun: (): Promise<{ ok: boolean; proxy?: boolean; ca?: boolean; error?: string }> =>
    ipcRenderer.invoke(DOCTOR_IPC_CHANNELS.REPAIR_RUN),

  onRunDoctor: (handler: () => void): (() => void) => {
    const listener = () => handler();
    ipcRenderer.on(DOCTOR_IPC_CHANNELS.RUN_DOCTOR, listener);
    return () => ipcRenderer.removeListener(DOCTOR_IPC_CHANNELS.RUN_DOCTOR, listener);
  },
  onNavigate: (handler: (view: string) => void): (() => void) => {
    const listener = (_: unknown, view: string) => handler(view);
    ipcRenderer.on(DOCTOR_IPC_CHANNELS.NAVIGATE, listener);
    return () => ipcRenderer.removeListener(DOCTOR_IPC_CHANNELS.NAVIGATE, listener);
  },
  onCommandPalette: (handler: () => void): (() => void) => {
    const listener = () => handler();
    ipcRenderer.on(DOCTOR_IPC_CHANNELS.COMMAND_PALETTE, listener);
    return () => ipcRenderer.removeListener(DOCTOR_IPC_CHANNELS.COMMAND_PALETTE, listener);
  },
  onThemeChanged: (handler: (theme: 'dark' | 'light') => void): (() => void) => {
    const listener = (_: unknown, theme: 'dark' | 'light') => handler(theme);
    ipcRenderer.on(DOCTOR_IPC_CHANNELS.THEME_CHANGED, listener);
    return () => ipcRenderer.removeListener(DOCTOR_IPC_CHANNELS.THEME_CHANGED, listener);
  },

  startStream: (args: string[], streamId: string): Promise<boolean> =>
    ipcRenderer.invoke(DOCTOR_IPC_CHANNELS.STREAM_START, args, streamId),
  cancelStream: (streamId: string): Promise<boolean> =>
    ipcRenderer.invoke(DOCTOR_IPC_CHANNELS.STREAM_CANCEL, streamId),
  onStreamData: (streamId: string, handler: (chunk: string) => void): (() => void) => {
    const channel = `ag:stream:${streamId}:data`;
    const listener = (_: unknown, chunk: string) => handler(chunk);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  onStreamClose: (streamId: string, handler: (code: number) => void): (() => void) => {
    const channel = `ag:stream:${streamId}:close`;
    const listener = (_: unknown, code: number) => handler(code);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  onStreamError: (streamId: string, handler: (err: string) => void): (() => void) => {
    const channel = `ag:stream:${streamId}:error`;
    const listener = (_: unknown, err: string) => handler(err);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },

  // MITM traffic fan-out
  onMitmTraffic: (handler: (payload: {
    id: string;
    ts: number;
    method: string;
    path: string;
    targetModel: string;
    translatedProvider: string;
    statusCode: number;
    latencyMs: number;
  }) => void): (() => void) => {
    const listener = (_: unknown, payload: any) => handler(payload);
    ipcRenderer.on(DOCTOR_IPC_CHANNELS.MITM_TRAFFIC, listener);
    return () => ipcRenderer.removeListener(DOCTOR_IPC_CHANNELS.MITM_TRAFFIC, listener);
  },

  // Real-time proxy error fan-out
  onProxyError: (handler: (payload: {
    traceId: string;
    provider: string;
    status?: number;
    errorType: string;
    rawError: string;
    title: string;
    message: string;
    suggestions: string[];
    actionUrl?: string;
  }) => void): (() => void) => {
    const listener = (_: unknown, payload: any) => handler(payload);
    ipcRenderer.on(DOCTOR_IPC_CHANNELS.PROXY_ERROR, listener);
    return () => ipcRenderer.removeListener(DOCTOR_IPC_CHANNELS.PROXY_ERROR, listener);
  },
};

contextBridge.exposeInMainWorld('ag', api);

export type AgAPI = typeof api;
