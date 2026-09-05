/**
 * Shared types for the proxy module.
 */

/**
 * CustomModelFileEntry is also exported by ./proxy/types. We re-export
 * the legacy customModelStore definition here under an alias so the
 * ipcHandlers can refer to either type without name clashes.
 */
export interface CustomModelFileEntry {
  name: string;
  displayName?: string;
  description?: string;
  provider?: string;
  apiKey?: string;
  apiUrl?: string;
  externalModelName?: string;
  allowUnauthorized?: boolean;
  encrypted?: boolean;
  enabled?: boolean;
  useRawBaseUrl?: boolean;
  extraHeaders?: Record<string, string>;
  extraBody?: Record<string, unknown>;
  fallbackModel?: string;
  models?: Array<{
    id: string;
    displayName?: string;
    description?: string;
    enabled?: boolean;
    fallbackModel?: string;
  }>;
}

/**
 * Configuration for a user-defined custom model.
 */
export interface CustomModel {
  name: string;
  displayName: string;
  description: string;
  provider: string;
  apiKey: string;
  apiUrl: string;
  externalModelName: string;
  allowUnauthorized?: boolean;
  encrypted?: boolean;
  useRawBaseUrl?: boolean;
  extraHeaders?: Record<string, string>;
  extraBody?: Record<string, unknown>;
  fallbackModel?: string;
  _slug?: string;
  /** Internal: effort suffix appended by effortExpander for unique placeholder IDs. */
  _effortSuffix?: string;
  timeout?: number;
  maxRetries?: number;
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
  /** Whether the model supports multimodal image inputs. */
  supportsImages?: boolean;
  /** Alias for supportsImages. */
  supportsVision?: boolean;
}



export interface GeminiRequestBody {
  model?: string;
  modelId?: string;
  model_id?: string;
  request?: GeminiRequestBody;
  systemInstruction?: { parts: { text?: string }[] };
  contents?: {
    parts?: { text?: string; functionCall?: unknown; functionResponse?: unknown; thought?: boolean }[];
    role?: string;
  }[];
  tools?: unknown[];
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
  };
}

/**
 * Shape of a Gemini-format response candidate.
 */
export interface GeminiCandidate {
  content?: { parts?: unknown[]; role?: string };
  finishReason?: string;
  index?: number;
}

/**
 * Shape of a Cloud Code response envelope.
 */
export interface CloudCodeResponse {
  response: { candidates?: GeminiCandidate[] } | unknown;
  traceId?: string;
  metadata?: Record<string, unknown>;
}
