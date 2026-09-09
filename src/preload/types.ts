/**
 * Types shared across preload modules. Pure type declarations — no runtime cost.
 * ponytail: any field added here propagates to renderer types via api.ts `declare global`.
 */

export interface UpdaterState {
  type: string;
  update?: { version: string };
}

export type UnsubscribeFn = () => void;

export interface UpdaterAPI {
  getState: () => Promise<UpdaterState>;
  onStateChanged: (callback: (state: UpdaterState) => void) => UnsubscribeFn;
  applyUpdate: () => Promise<void>;
  quitAndInstall: () => Promise<void>;
  checkForUpdates: () => Promise<void>;
}

export interface DialogAPI {
  showOpenDialog: () => Promise<string | undefined>;
}

export interface NotificationOptions {
  title: string;
  body: string;
  silent?: boolean;
  payload?: unknown;
}

export interface ProviderModelEntry {
  id: string;
  displayName?: string;
  enabled: boolean;
}

export interface ProviderFileEntry {
  id: string;
  name: string;
  provider: string;
  apiUrl: string;
  apiKey: string;
  allowUnauthorized?: boolean;
  encrypted?: boolean;
  enabled: boolean;
  models: ProviderModelEntry[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalRequests: number;
    lastUsed?: number;
  };
}

export interface NotificationAPI {
  send: (options: NotificationOptions) => Promise<void>;
  openSystemPreferences: () => Promise<void>;
  onClicked: (callback: (payload: unknown) => void) => UnsubscribeFn;
}

export interface TestModelParams {
  apiUrl: string;
  provider: string;
  apiKey?: string;
  allowUnauthorized?: boolean;
}

export interface ConnectionTestResult {
  success: boolean;
  status?: number;
  message?: string;
  error?: string;
  latencyMs?: number;
}

export interface FetchModelsParams {
  baseUrl?: string;
  apiUrl?: string;
  apiKey?: string;
  provider: string;
  allowUnauthorized?: boolean;
}

export interface FetchModelsResult {
  success: boolean;
  models?: { id: string; name?: string; displayName?: string; inputModalities?: string[] }[];
  error?: string;
}

export interface StorageAPI {
  getItems: () => Promise<Record<string, string | null>>;
  updateItems: (changes: Record<string, string | null>) => Promise<void>;
  onChanged: (callback: (changes: Record<string, string | null>) => void) => UnsubscribeFn;
  getCustomModels: () => Promise<CustomModelEntry[]>;
  saveCustomModel: (model: CustomModelEntry) => Promise<{ success: boolean; error?: string }>;
  deleteCustomModel: (modelName: string) => Promise<{ success: boolean; error?: string }>;
  testModelConnection: (model: TestModelParams) => Promise<ConnectionTestResult>;
  fetchModels: (params: FetchModelsParams) => Promise<FetchModelsResult>;
  getProviders: () => Promise<ProviderFileEntry[]>;
  saveProvider: (provider: ProviderFileEntry) => Promise<{ success: boolean; error?: string }>;
  deleteProvider: (providerId: string) => Promise<{ success: boolean; error?: string }>;
  exportProviders: () => Promise<{ success: boolean; base64?: string; count?: number; error?: string }>;
  importProviders: (base64Code?: string) => Promise<{ success: boolean; count?: number; error?: string }>;
  getDoctorDiagnostics: () => Promise<any>;
  testRemoteHealth?: (payload: { host: string; token?: string } | string) => Promise<{ ok: boolean; status?: number; data?: Record<string, unknown>; error?: string }>;
  injectUserStatus?: (rawBuffer: Uint8Array) => Promise<Uint8Array>;
  injectAvailableModels?: (rawBuffer: Uint8Array) => Promise<Uint8Array>;
}

export interface LogsAPI {
  getElectronLogs: () => Promise<string>;
}

export interface ExtensionsAPI {
  sendAuthorities: (authoritiesMap: Record<string, string>) => Promise<void>;
}

export interface DeepLinkAPI {
  onDeepLink: (callback: (url: string) => void) => UnsubscribeFn;
  getStoredDeepLink: () => Promise<string | undefined>;
}

export interface AgentAPI {
  updateActiveAgentCount: (count: number) => Promise<void>;
}

export interface TitleBarOverlayOptions {
  color: string;
  symbolColor: string;
}

export interface ElectronNativeAPI {
  getZoomLevel: () => number;
  setTitleBarOverlay: (options: TitleBarOverlayOptions) => Promise<void>;
  minimize: () => Promise<void>;
  maximize: () => Promise<void>;
  unmaximize: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  close: () => Promise<void>;
  toggleDevTools: () => Promise<void>;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  openExternal: (url: string) => Promise<void>;
}

export interface CustomModelEntry {
  name: string;
  displayName?: string;
  description?: string;
  provider: string;
  apiKey: string;
  apiUrl: string;
  externalModelName: string;
  allowUnauthorized?: boolean;
  encrypted?: boolean;
  /**
   * Reasoning effort for this model (fetched from /v1/models, not hardcoded).
   * Values: 'low' | 'medium' | 'high' | 'auto' | 'none'
   */
  reasoningEffort?: string;
  /**
   * Thinking budget for this model (fetched from /v1/models, not hardcoded).
   * Values: 'auto' | 'enabled' | 'disabled'
   */
  thinkingBudget?: string;
  /**
   * Mode for this model (fetched from /v1/models, not hardcoded).
   * Values: 'thinking' | 'reasoning' | 'non-thinking' | 'auto'
   */
  mode?: string;
  /**
   * Input modalities supported by this model.
   * e.g., ['text', 'image', 'audio', 'video']
   */
  inputModalities?: string[];
  [key: string]: unknown;
}

export interface ProviderPreset {
  id: string;
  label: string;
  defaultApiUrl: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: 'openai', label: 'OpenAI-compatible', defaultApiUrl: 'https://api.openai.com/v1' },
  { id: 'minimax', label: 'MiniMax (Global)', defaultApiUrl: 'https://api.minimaxi.chat/v1' },
  { id: 'openrouter', label: 'OpenRouter', defaultApiUrl: 'https://openrouter.ai/api/v1' },
  { id: 'anthropic', label: 'Anthropic', defaultApiUrl: 'https://api.anthropic.com' },
  { id: 'google', label: 'Google AI Studio', defaultApiUrl: 'https://generativelanguage.googleapis.com' },
  { id: 'ollama', label: 'Ollama (local)', defaultApiUrl: 'http://localhost:11434/v1' },
  { id: 'custom', label: 'Custom', defaultApiUrl: '' },
];
