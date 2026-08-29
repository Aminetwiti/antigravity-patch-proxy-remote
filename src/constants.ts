/**
 * Constants for the proxy module.
 * Centralizes magic numbers and configuration values to improve maintainability.
 */

// ─── App Constants (used by main.ts, languageServer.ts, paths.ts) ─────────

export const DEFAULT_BIND_HOST = '127.0.0.1';

/** Origin used by the main BrowserWindow. */
export const WINDOW_ORIGIN = `https://${DEFAULT_BIND_HOST}`;

/** Pass 0 to the LS so the OS assigns an available port automatically. */
export const DYNAMIC_PORT = 0;

/** Log file name for the language server. */
export const LS_LOG_FILE_NAME = 'language_server.log';

/** SHA-256 fingerprint of the bundled language server certificate. */
export const LS_CERT_FINGERPRINT = 'sha256/sTZpQemOWEytaZqa7P/y/dNXbHMdOAzMvzHEhUwHZXw=';

// ─── Network ───────────────────────────────────────────────────────────────

/**
 * Default port for the local proxy server.
 *
 * Override via the AG_PROXY_PORT environment variable. If the default is in
 * use, the proxy will bind to a random dynamic port as a last resort.
 */
export const DEFAULT_PROXY_PORT = 51074;

/**
 * Default port for the ag-doctor-ui emergency proxy stub.
 * Kept separate from DEFAULT_PROXY_PORT to prevent conflicts.
 */
export const STUB_PORT_DEFAULT = 51999;

/** Path (relative to home) where the active proxy port is persisted for IPC. */
export const ACTIVE_PORT_FILE = '.gemini/antigravity/active_port';



/** Timeout for Google proxy requests (60 seconds). */
export const GOOGLE_PROXY_TIMEOUT_MS = 60_000;



/** Timeout for downloading file content from external URIs (30 seconds). */
export const FILE_DOWNLOAD_TIMEOUT_MS = 30_000;

/**
 * Per-chunk idle timeout for streaming upstream responses.
 *
 * If no new SSE chunk arrives within this window, the proxy treats the
 * upstream as stuck and aborts the request. This is fundamentally different
 * from a *total* request timeout (which `request.setTimeout()` enforces):
 * a total timeout kills healthy streams that legitimately take several
 * minutes; the idle timeout only fires when the upstream *stops saying
 * anything* mid-stream.
 *
 * Ported from vscode-unify-chat-provider's `withIdleTimeout` (vendors/...).
 * Default: 60 seconds — generous enough for slow reasoning models, short
 * enough that a stuck upstream doesn't tie up the proxy indefinitely.
 */
export const STREAM_IDLE_TIMEOUT_MS = 60_000;

/**
 * Default request timeout for custom model requests.
 *
 * Lowered from 120_000 to 30_000 to bound the worst-case blocking time
 * of an upstream connection (3 attempts × 30s = 90s max). Combined with
 * DEFAULT_MAX_RETRIES = 1, a fully-failing model holds the proxy open
 * for at most 60s before giving up, freeing connections for the rest of
 * the dropdown models.
 */
export const DEFAULT_MODEL_REQUEST_TIMEOUT_MS = 30_000;

/** Default retry delay for streaming errors (1 second). */
export const STREAM_RETRY_BASE_DELAY_MS = 1_000;

/** Default retry delay for non-streaming errors (1 second). */
export const NON_STREAM_RETRY_BASE_DELAY_MS = 1_000;

/** Base delay for 429 rate-limit retries (2 seconds). */
export const RATE_LIMIT_RETRY_BASE_DELAY_MS = 2_000;

/** Base delay for 5xx server error retries (1 second). */
export const SERVER_ERROR_RETRY_BASE_DELAY_MS = 1_000;

/**
 * Exponential backoff multiplier (AWS-style decorrelated jitter).
 *
 * The delay for attempt N is roughly:
 *     min(initialDelay * MULTIPLIER^N, maxDelay) * (1 +/- JITTER)
 *
 * 2x is the AWS-recommended default — fast enough to recover from transient
 * errors, gentle enough to avoid pile-up.
 */
export const RETRY_BACKOFF_MULTIPLIER = 2;

/**
 * Jitter factor in [0, 1]. With 0.1, each delay is randomly scaled within
 * +/-10% of its computed value, preventing retry-wave synchronization when
 * many concurrent requests hit the same upstream at the same time.
 *
 * Inspired by `vscode-unify-chat-provider`'s DEFAULT_CHAT_RETRY_CONFIG.
 */
export const RETRY_BACKOFF_JITTER_FACTOR = 0.1;

// ─── Retry Configuration ──────────────────────────────────────────────────

/**
 * Default maximum number of retries per model.
 *
 * Lowered from 3 to 1 to prevent retry storms: a stuck upstream used to
 * block the proxy for up to ~360s (3 × 120s) per model, which cascaded
 * across 8+ custom models and starved the rest of the dropdown.
 * With 1 retry, a fully-failing model gives up in ≤ 60s (2 × 30s).
 */
export const DEFAULT_MAX_RETRIES = 1;

/** Minimum allowed retry count. */
export const MIN_MAX_RETRIES = 0;

/** Maximum allowed retry count. */
export const MAX_MAX_RETRIES = 5;

// ─── Circuit Breaker ──────────────────────────────────────────────────────

/** Maximum consecutive cache refresh failures before backing off. */
export const CACHE_REFRESH_MAX_FAILURES = 3;

/** Backoff duration after circuit breaker trips (5 minutes). */
export const CACHE_REFRESH_BACKOFF_MS = 5 * 60 * 1000;

// ─── Model Capabilities ────────────────────────────────────────────────────

/** Maximum input tokens for custom models. */
export const CUSTOM_MODEL_MAX_TOKENS = 1_048_576;

/** Maximum output tokens for custom models. */
export const CUSTOM_MODEL_MAX_OUTPUT_TOKENS = 4_096;

/** Default sampling temperature for non-thinking models. */
export const DEFAULT_TEMPERATURE = 0.7;

/** Default top-P sampling parameter. */
export const DEFAULT_TOP_P = 0.9;

/** Default top-K sampling parameter. */
export const DEFAULT_TOP_K = 40;

// ─── Model Placeholder ID Generation ──────────────────────────────────────

/** Initial seed for DJB2 hashing algorithm used in deterministic model ID generation. */
export const DJB2_SEED = 5381;

/** Base number for placeholder IDs (e.g., MODEL_PLACEHOLDER_M400). */
export const PLACEHOLDER_ID_BASE = 400;

/** Range for placeholder IDs (e.g., 200 = IDs from 400 to 599). */
export const PLACEHOLDER_ID_RANGE = 200;

// ─── DNS Resolution ───────────────────────────────────────────────────────

/** Public DNS servers used to bypass local DNS poisoning. */
export const PUBLIC_DNS_SERVERS = ['8.8.8.8', '1.1.1.1', '8.8.4.4'];



// ─── Google API Hosts ─────────────────────────────────────────────────────

export const GOOGLE_HOSTS = {
  CLOUD_CODE: 'daily-cloudcode-pa.googleapis.com',
  GENERATIVE_LANGUAGE: 'generativelanguage.googleapis.com',
} as const;

// ─── Loopback Hosts ───────────────────────────────────────────────────────

export const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '::1'] as const;

// ─── Local Service Defaults ────────────────────────────────────────────────

export const LOCAL_SERVICES = {
  OLLAMA: `http://${DEFAULT_BIND_HOST}:11434`,
  LMSTUDIO: `http://${DEFAULT_BIND_HOST}:1234`,
  LLAMACPP: `http://${DEFAULT_BIND_HOST}:8080`,
} as const;

// ─── Content Types ────────────────────────────────────────────────────────

export const CONTENT_TYPES = {
  JSON: 'application/json',
  EVENT_STREAM: 'text/event-stream',
  GRPC_WEB_PROTO: 'application/grpc-web+proto',
} as const;

// ─── Provider Names ───────────────────────────────────────────────────────
// Single source of truth for all supported providers.

export const PROVIDERS = {
  OPENAI: 'openai',
  OLLAMA: 'ollama',
  OPENROUTER: 'openrouter',
  CUSTOM: 'custom',
  GROQ: 'groq',
  MISTRAL: 'mistral',
  CEREBRAS: 'cerebras',
  NVIDIA: 'nvidia',
  OPENCODE: 'opencode',
  CODESTRAL: 'codestral',
  // Anthropic-compatible transport
  ANTHROPIC: 'anthropic',
  DEEPSEEK: 'deepseek',
  KIMI: 'kimi',
  FIREWORKS: 'fireworks',
  LMSTUDIO: 'lmstudio',
  LLAMACPP: 'llamacpp',
  WAFER: 'wafer',
  ZAI: 'zai',
  MINIMAX: 'minimax',
  // Native
  GOOGLE: 'google',
} as const;

export type ProviderName = (typeof PROVIDERS)[keyof typeof PROVIDERS];

/** All provider names as an array, useful for validation. */
export const ALL_PROVIDERS: readonly ProviderName[] = Object.values(PROVIDERS);

/** Providers that use OpenAI-compatible API format (chat/completions). */
export const OPENAI_COMPATIBLE_PROVIDERS = [
  PROVIDERS.OPENAI,
  PROVIDERS.CUSTOM,
  PROVIDERS.OPENROUTER,
] as const;

/** Providers that use OpenAI-compatible transport (expanded set for registry). */
export const OPENAI_COMPAT = new Set<string>([
  PROVIDERS.OPENAI,
  PROVIDERS.OLLAMA,
  PROVIDERS.OPENROUTER,
  PROVIDERS.CUSTOM,
  PROVIDERS.GROQ,
  PROVIDERS.MISTRAL,
  PROVIDERS.CEREBRAS,
  PROVIDERS.NVIDIA,
  PROVIDERS.OPENCODE,
  PROVIDERS.CODESTRAL,
]);

/** Providers that use Anthropic-compatible transport. */
export const ANTHROPIC_COMPAT = new Set<string>([
  PROVIDERS.ANTHROPIC,
  PROVIDERS.DEEPSEEK,
  PROVIDERS.KIMI,
  PROVIDERS.FIREWORKS,
  PROVIDERS.LMSTUDIO,
  PROVIDERS.LLAMACPP,
  PROVIDERS.WAFER,
  PROVIDERS.ZAI,
]);

/** Providers that require an API key for authentication. */
export const PROVIDERS_REQUIRING_API_KEY: readonly ProviderName[] = [
  PROVIDERS.OPENAI,
  PROVIDERS.ANTHROPIC,
  PROVIDERS.OPENROUTER,
  PROVIDERS.GOOGLE,
  PROVIDERS.DEEPSEEK,
  PROVIDERS.GROQ,
  PROVIDERS.MISTRAL,
  PROVIDERS.CEREBRAS,
  PROVIDERS.KIMI,
  PROVIDERS.FIREWORKS,
  PROVIDERS.NVIDIA,
  PROVIDERS.OPENCODE,
  PROVIDERS.CODESTRAL,
  PROVIDERS.WAFER,
  PROVIDERS.ZAI,
];

/** Default API URLs per provider. Override per-model via apiUrl in custom_models.json. */
export const PROVIDER_DEFAULT_URLS: Record<ProviderName, string> = {
  [PROVIDERS.OPENAI]: 'https://api.openai.com/v1/chat/completions',
  [PROVIDERS.ANTHROPIC]: 'https://api.anthropic.com/v1/messages',
  [PROVIDERS.OPENROUTER]: 'https://openrouter.ai/api/v1/chat/completions',
  [PROVIDERS.OLLAMA]: 'http://localhost:11434/v1/chat/completions',
  [PROVIDERS.GOOGLE]: 'https://generativelanguage.googleapis.com/v1beta/models/',
  [PROVIDERS.CUSTOM]: '',
  [PROVIDERS.DEEPSEEK]: 'https://api.deepseek.com/v1',
  [PROVIDERS.GROQ]: 'https://api.groq.com/openai/v1',
  [PROVIDERS.MISTRAL]: 'https://api.mistral.ai/v1',
  [PROVIDERS.CEREBRAS]: 'https://api.cerebras.ai/v1',
  [PROVIDERS.KIMI]: 'https://api.moonshot.ai/v1',
  [PROVIDERS.FIREWORKS]: 'https://api.fireworks.ai/inference/v1',
  [PROVIDERS.LMSTUDIO]: 'http://localhost:1234/v1',
  [PROVIDERS.LLAMACPP]: 'http://localhost:8080/v1',
  [PROVIDERS.NVIDIA]: 'https://integrate.api.nvidia.com/v1',
  [PROVIDERS.OPENCODE]: '',
  [PROVIDERS.CODESTRAL]: 'https://codestral.mistral.ai/v1',
  [PROVIDERS.WAFER]: '',
  [PROVIDERS.ZAI]: '',
  [PROVIDERS.MINIMAX]: 'https://api.minimaxi.chat/v1/chat/completions',
};

export interface SuggestedModel {
  id: string;
  displayName: string;
}

export interface DetailedProviderPreset {
  id: ProviderName;
  label: string;
  defaultApiUrl: string;
  suggestedModels: SuggestedModel[];
}

export const DETAILED_PROVIDER_PRESETS: DetailedProviderPreset[] = [
  {
    id: PROVIDERS.OPENAI,
    label: 'OpenAI',
    defaultApiUrl: 'https://api.openai.com/v1',
    suggestedModels: [
      { id: 'gpt-4o', displayName: 'GPT-4o (Omni)' },
      { id: 'gpt-4o-mini', displayName: 'GPT-4o Mini' },
      { id: 'o1', displayName: 'OpenAI o1 Reasoning' },
      { id: 'o3-mini', displayName: 'OpenAI o3-mini' },
    ],
  },
  {
    id: PROVIDERS.DEEPSEEK,
    label: 'DeepSeek (Official)',
    defaultApiUrl: 'https://api.deepseek.com/v1',
    suggestedModels: [
      { id: 'deepseek-chat', displayName: 'DeepSeek-V3 (Chat)' },
      { id: 'deepseek-reasoner', displayName: 'DeepSeek-R1 (Reasoner)' },
    ],
  },
  {
    id: PROVIDERS.OPENROUTER,
    label: 'OpenRouter',
    defaultApiUrl: 'https://openrouter.ai/api/v1',
    suggestedModels: [
      { id: 'deepseek/deepseek-r1', displayName: 'DeepSeek R1 (OpenRouter)' },
      { id: 'anthropic/claude-3.5-sonnet', displayName: 'Claude 3.5 Sonnet' },
      { id: 'meta-llama/llama-3.3-70b-instruct', displayName: 'Llama 3.3 70B' },
      { id: 'qwen/qwen-2.5-coder-32b-instruct', displayName: 'Qwen 2.5 Coder 32B' },
    ],
  },
  {
    id: PROVIDERS.GROQ,
    label: 'Groq (Ultra Fast)',
    defaultApiUrl: 'https://api.groq.com/openai/v1',
    suggestedModels: [
      { id: 'llama-3.3-70b-versatile', displayName: 'Llama 3.3 70B Versatile' },
      { id: 'mixtral-8x7b-32768', displayName: 'Mixtral 8x7B (32k)' },
      { id: 'deepseek-r1-distill-llama-70b', displayName: 'DeepSeek R1 Distill 70B' },
    ],
  },
  {
    id: PROVIDERS.OLLAMA,
    label: 'Ollama (Local)',
    defaultApiUrl: 'http://localhost:11434/v1',
    suggestedModels: [
      { id: 'llama3', displayName: 'Llama 3 Local' },
      { id: 'deepseek-r1:8b', displayName: 'DeepSeek R1 8B Local' },
      { id: 'qwen2.5-coder', displayName: 'Qwen 2.5 Coder Local' },
    ],
  },
  {
    id: PROVIDERS.ANTHROPIC,
    label: 'Anthropic Claude',
    defaultApiUrl: 'https://api.anthropic.com/v1',
    suggestedModels: [
      { id: 'claude-3-5-sonnet-latest', displayName: 'Claude 3.5 Sonnet' },
      { id: 'claude-3-5-haiku-latest', displayName: 'Claude 3.5 Haiku' },
    ],
  },
  {
    id: PROVIDERS.MISTRAL,
    label: 'Mistral AI',
    defaultApiUrl: 'https://api.mistral.ai/v1',
    suggestedModels: [
      { id: 'mistral-large-latest', displayName: 'Mistral Large' },
      { id: 'codestral-latest', displayName: 'Codestral (Code)' },
    ],
  },
  {
    id: PROVIDERS.KIMI,
    label: 'Moonshot (Kimi)',
    defaultApiUrl: 'https://api.moonshot.ai/v1',
    suggestedModels: [
      { id: 'moonshot-v1-8k', displayName: 'Kimi Moonshot 8k' },
      { id: 'moonshot-v1-32k', displayName: 'Kimi Moonshot 32k' },
    ],
  },
];
