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
  fallbackChain?: string[] | string;
  models?: Array<{
    id: string;
    displayName?: string;
    description?: string;
    enabled?: boolean;
    fallbackModel?: string;
    fallbackChain?: string[] | string;
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
  enabled?: boolean;
  useRawBaseUrl?: boolean;
  extraHeaders?: Record<string, string>;
  extraBody?: Record<string, unknown>;
  fallbackModel?: string;
  fallbackChain?: string[] | string;
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
   * Values: 'auto' | 'enabled' | 'disabled' | number (token count like 1000, 4000, 10001)
   */
  thinkingBudget?: string | number;
  /**
   * Mode for this model (fetched from /v1/models, not hardcoded).
   * Values: 'thinking' | 'reasoning' | 'non-thinking' | 'auto'
   */
  mode?: string;
  /** Whether the model supports multimodal image inputs. */
  supportsImages?: boolean;
  /** Alias for supportsImages. */
  supportsVision?: boolean;
  /** Optional account metadata for multi-account pools. */
  accountName?: string;
  accountEmail?: string;
  refreshToken?: string;
  projectId?: string;
  quotas?: {
    fiveHourPercentage?: number;
    weeklyPercentage?: number;
    geminiFiveHourPct?: number;
    geminiWeeklyPct?: number;
    claudeFiveHourPct?: number;
    claudeWeeklyPct?: number;
    [key: string]: unknown;
  };
  /** Internal: marks a real per-account Google entry kept only for dispatch/quota; hidden from dropdown. */
  _poolOnly?: boolean;
}



export interface GeminiFunctionCall {
  name: string;
  args?: Record<string, unknown>;
  id?: string;
}

export interface GeminiFunctionResponse {
  name: string;
  response?: unknown;
  id?: string;
}

export interface GeminiPart {
  text?: string;
  thought?: boolean;
  inlineData?: {
    mimeType: string;
    data: string;
  };
  fileData?: {
    mimeType: string;
    fileUri: string;
  };
  functionCall?: GeminiFunctionCall;
  functionResponse?: GeminiFunctionResponse;
}

export interface GeminiContent {
  role?: string;
  parts?: GeminiPart[];
}

export interface GeminiParameters {
  type: string;
  properties?: Record<string, unknown>;
}

export interface GeminiFunctionDeclaration {
  name: string;
  description?: string;
  parameters?: GeminiParameters;
}

export interface GeminiTool {
  functionDeclarations?: GeminiFunctionDeclaration[];
}

export interface GeminiRequestBody {
  model?: string;
  modelId?: string;
  model_id?: string;
  request?: GeminiRequestBody;
  systemInstruction?: { parts: GeminiPart[] | { text?: string }[] };
  contents?: GeminiContent[];
  tools?: GeminiTool[] | unknown[];
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
  };
}

/**
 * Shape of a Gemini-format response candidate.
 */
export interface GeminiCandidate {
  content?: GeminiContent | { parts?: unknown[]; role?: string };
  finishReason?: string;
  index?: number;
  safetyRatings?: unknown[];
}

/**
 * Shape of a Cloud Code response envelope.
 */
export interface CloudCodeResponse {
  response: { candidates?: GeminiCandidate[] } | unknown;
  traceId?: string;
  metadata?: Record<string, unknown>;
}
