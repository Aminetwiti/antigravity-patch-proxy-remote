// Ambient declarations for the renderer global window.ag bridge.
// Loaded as a script (no module). Types are erased at build time.

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface AgAPI {
  run(args: string[]): Promise<RunResult>;
  info(): Promise<{
    platform: string;
    arch: string;
    versions: NodeJS.ProcessVersions;
    electron: string;
    node: string;
    chrome: string;
    cliPath: string;
  }>;
  config(): Promise<Record<string, unknown>>;
  onMitmTraffic(handler: (payload: {
    id: string;
    ts: number;
    method: string;
    path: string;
    targetModel: string;
    translatedProvider: string;
    statusCode: number;
    latencyMs: number;
  }) => void): () => void;
  setTheme(theme: 'dark' | 'light'): Promise<boolean>;
  setNotifyEnabled(enabled: boolean): Promise<boolean>;
  getProxyErrorHistory(): Promise<Array<{
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
  }>>;
  notify(title: string, body: string): Promise<void>;
  trayStatus(status: 'ok' | 'warn' | 'err'): Promise<void>;
  openExternal(url: string): Promise<void>;
  reveal(p: string): Promise<void>;

  // Provider Management APIs
  providers: {
    get(): Promise<unknown[]>;
    save(p: unknown): Promise<{ success: boolean; error?: string }>;
    delete(id: string): Promise<{ success: boolean; error?: string }>;
    fetchModels(params: { apiUrl: string; apiKey: string }): Promise<{ success: boolean; models?: Array<{ id: string; displayName?: string; enabled?: boolean }>; error?: string }>;
    test(params: { apiUrl: string; apiKey: string; id?: string; modelId?: string }): Promise<{ success: boolean; status?: number; latencyMs?: number; healthStatus?: 'healthy' | 'degraded' | 'offline'; error?: string }>;
    onChanged(handler: () => void): () => void;
  };

  // MITM Proxy Server Management
  proxyStart(): Promise<{ ok: boolean; message: string; pid?: number }>;
  proxyStop(): Promise<{ ok: boolean; message: string }>;
  proxyStatus(): Promise<{ ok: boolean; data?: { running: boolean; port: number; pid?: number; error?: string }; error?: string }>;
  proxyRestart(): Promise<{ ok: boolean; message: string }>;
  
  onRunDoctor(handler: () => void): () => void;
  onNavigate(handler: (view: string) => void): () => void;
  onCommandPalette(handler: () => void): () => void;
  onThemeChanged(handler: (theme: 'dark' | 'light') => void): () => void;
  startStream(args: string[], streamId: string): Promise<boolean>;
  cancelStream(streamId: string): Promise<boolean>;
  onStreamData(streamId: string, handler: (chunk: string) => void): () => void;
  onStreamClose(streamId: string, handler: (code: number) => void): () => void;
  onStreamError(streamId: string, handler: (err: string) => void): () => void;

  // Real-time proxy error fan-out (see preload.ts). The renderer receives a
  // payload from src/proxy.ts:buildProxyErrorPayload() and renders the
  // matching native quota/error card via NativeQuotaCardRenderer.
  onProxyError(handler: (payload: {
    traceId: string;
    provider: string;
    status?: number;
    errorType: string;
    rawError: string;
    title: string;
    message: string;
    suggestions: string[];
    actionUrl?: string;
  }) => void): () => void;

  // Network Utils
  getLocalIp: () => Promise<string>;
  generateQr: (text: string) => Promise<string>;
  startDaemon: (options: { port: number; tunnel: string; token: string; allowFirstAdmin?: boolean }) => Promise<any>;
  stopDaemon: () => Promise<any>;
  getDaemonStatus: (port?: number, token?: string) => Promise<any>;
  onDaemonLog: (callback: (data: string) => void) => () => void;

  // Antigravity lifecycle
  antigravityStatus(): Promise<{ ok: boolean; data?: unknown; error?: string }>;
  antigravityVersion(): Promise<{ ok: boolean; data?: { version: string }; error?: string }>;
  antigravityLaunch(): Promise<{ ok: boolean; data?: { ok: boolean; pid?: number; message: string }; error?: string }>;
  antigravityKill(): Promise<{ ok: boolean; data?: { killed: number; message: string }; error?: string }>;
  antigravityRestart(): Promise<{ ok: boolean; data?: { ok: boolean; message: string; pid?: number }; error?: string }>;
  antigravityLaunchLogs(): Promise<string | null>;
  repairRun(): Promise<{ ok: boolean; proxy?: boolean; ca?: boolean; error?: string }>;

  // Proxy stub lifecycle — emergency fallback when Antigravity's bundled proxy fails
  proxyStartStub(): Promise<{ ok: boolean; pid?: number; port?: number; note?: string; error?: string }>;
  proxyStubStatus(): Promise<{ ok: boolean; data?: { ok: boolean; stub: boolean; latencyMs: number; error?: string }; error?: string }>;
}

interface Window {
  ag: AgAPI;
}

// Real-time proxy error bridge — defined in native-quota-card.ts.
declare function startProxyErrorBridge(): () => void;

// NOTE: SmartBannerManager is declared as a top-level class in
// src/renderer/smart-banner.ts (script-mode → global). We intentionally do
// NOT redeclare it here to avoid TS2300 "Duplicate identifier" when both
// files are compiled together. Consumers that need the type can refer to
// it directly from smart-banner.ts via a triple-slash reference or import.
