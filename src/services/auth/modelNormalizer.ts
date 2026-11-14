import log from 'electron-log';
import { getLiveAccountQuota } from './quotaPoller';

/**
 * Normalizes Google Cloud Code internal model IDs.
 * Maps legacy/alias names (e.g. gemini-3.8-flash-high) to upstream names (e.g. gemini-3.8-flash-tiered).
 */
export function normalizeCloudCodeModelId(modelId: string): string {
  if (!modelId) return 'gemini-3.8-flash-tiered';
  const clean = modelId.replace(/^models\//, '').trim().toLowerCase();

  const validCloudCodeModels = new Set([
    'gemini-3.8-flash-low',
    'gemini-3.8-flash-medium',
    'gemini-3.8-flash-high',
    'gemini-3.8-flash-tiered',
    'gemini-4-argon-high',
    'gemini-4-argon-medium',
    'gemini-4-argon-low',
    'gemini-4-argon',
    'claude-sonnet-4-6',
    'claude-opus-4-6-thinking',
    'claude-sonnet-5-5',
    'claude-opus-5-5',
  ]);

  if (validCloudCodeModels.has(clean)) {
    return clean;
  }

  const map: Record<string, string> = {
    'gemini-4-argon': 'gemini-4-argon-high',
    'gemini-4-argon-high': 'gemini-4-argon-high',
    'gemini-4-argon-medium': 'gemini-4-argon-medium',
    'gemini-4-argon-low': 'gemini-4-argon-low',
    'gemini-3.8-flash-low': 'gemini-3.8-flash-low',
    'gemini-3.8-flash-medium': 'gemini-3.8-flash-medium',
    'gemini-3.8-flash-high': 'gemini-3.8-flash-high',
    'gemini-3.8-flash': 'gemini-3.8-flash-medium',
    'gemini-2.5-flash-lite': 'gemini-3.8-flash-low',
    'gemini-3-preview': 'gemini-3.8-flash-tiered',
    'gemini-3-flash-preview': 'gemini-3.8-flash-tiered',
    'gemini-3.6-flash': 'gemini-3.8-flash-tiered',
    'gemini-3.1-flash-lite': 'gemini-3.8-flash-tiered',
    'model_google_gemini_2_5_flash_lite': 'gemini-3.8-flash-low',
    'model-google-gemini-2-5-flash-lite': 'gemini-3.8-flash-low',
    'model_tier_flash_lite': 'gemini-3.8-flash-low',
    'model-tier-flash-lite': 'gemini-3.8-flash-low',
    'claude-sonnet-5-5-medium': 'claude-sonnet-5-5',
    'claude-sonnet-5-5-high': 'claude-sonnet-5-5',
    'claude-sonnet-5-5': 'claude-sonnet-5-5',
    'claude-opus-5-5-low': 'claude-opus-5-5',
    'claude-opus-5-5-medium': 'claude-opus-5-5',
    'claude-opus-5-5-high': 'claude-opus-5-5',
    'claude-opus-5-5': 'claude-opus-5-5',
    'claude-sonnet-4-6': 'claude-sonnet-4-6',
    'claude-sonnet': 'claude-sonnet-4-6',
    'claude-opus': 'claude-opus-4-6-thinking',
    'claude-opus-4-6': 'claude-opus-4-6-thinking',
    'claude-opus-4-6-thinking': 'claude-opus-4-6-thinking',
  };

  if (map[clean]) return map[clean];

  if (clean.includes('opus')) return clean.includes('5-5') || clean.includes('5.5') ? 'claude-opus-5-5' : 'claude-opus-4-6-thinking';
  if (clean.includes('claude') || clean.includes('sonnet')) return clean.includes('5-5') || clean.includes('5.5') ? 'claude-sonnet-5-5' : 'claude-sonnet-4-6';
  if (clean.includes('argon')) {
    if (clean.includes('low')) return 'gemini-4-argon-low';
    if (clean.includes('medium')) return 'gemini-4-argon-medium';
    return 'gemini-4-argon-high';
  }
  if (clean.includes('flash') || clean.includes('pro')) {
    if (clean.includes('low')) return 'gemini-3.8-flash-low';
    if (clean.includes('high')) return 'gemini-3.8-flash-high';
    return 'gemini-3.8-flash-medium';
  }
  if (clean.includes('gpt')) return 'gemini-3.8-flash-medium';

  return 'gemini-3.8-flash-medium';
}

/**
 * Normalizes Google AI Studio / Gemini model identifiers, mapping unknown, legacy, or alias
 * model names to canonical Google Cloud Code models (e.g. gemini-3.8-flash-tiered, claude-sonnet-4-6) without throwing 404.
 */
export function normalizeGoogleModelId(modelName: string): string {
  if (!modelName) return 'gemini-3.8-flash-tiered';
  let clean = modelName.replace(/^(?:models\/|[^/]+\/)/, '').trim().toLowerCase();

  const validModels = new Set([
    'gemini-3.8-flash-low',
    'gemini-3.8-flash-medium',
    'gemini-3.8-flash-high',
    'gemini-3.8-flash-tiered',
    'gemini-4-argon-high',
    'gemini-4-argon-medium',
    'gemini-4-argon-low',
    'gemini-4-argon',
    'claude-sonnet-4-6',
    'claude-opus-4-6-thinking',
    'claude-sonnet-5-5',
    'claude-opus-5-5',
  ]);

  if (validModels.has(clean)) {
    return clean;
  }

  const aliasMap: Record<string, string> = {
    'gemini-4-argon': 'gemini-4-argon-high',
    'gemini-4-argon-high': 'gemini-4-argon-high',
    'gemini-4-argon-medium': 'gemini-4-argon-medium',
    'gemini-4-argon-low': 'gemini-4-argon-low',
    'gemini-3.8-flash-low': 'gemini-3.8-flash-low',
    'gemini-3.8-flash-medium': 'gemini-3.8-flash-medium',
    'gemini-3.8-flash-high': 'gemini-3.8-flash-high',
    'gemini-3.8-flash': 'gemini-3.8-flash-medium',
    'gemini-3.8-flash-tiered': 'gemini-3.8-flash-tiered',
    'gemini-2.5-flash-lite': 'gemini-3.8-flash-low',
    'gemini-3-preview': 'gemini-3.8-flash-tiered',
    'gemini-3-flash-preview': 'gemini-3.8-flash-tiered',
    'gemini-3.6-flash': 'gemini-3.8-flash-tiered',
    'gemini-3.1-flash-lite': 'gemini-3.8-flash-tiered',
    'model_google_gemini_2_5_flash_lite': 'gemini-3.8-flash-low',
    'model-google-gemini-2-5-flash-lite': 'gemini-3.8-flash-low',
    'model_tier_flash_lite': 'gemini-3.8-flash-low',
    'model-tier-flash-lite': 'gemini-3.8-flash-low',
    'gemini-flash': 'gemini-3.8-flash-medium',
    'gemini-pro': 'gemini-3.8-flash-medium',
    'claude-sonnet-5-5': 'claude-sonnet-5-5',
    'claude-opus-5-5': 'claude-opus-5-5',
    'claude-sonnet-4-6': 'claude-sonnet-4-6',
    'claude-sonnet': 'claude-sonnet-4-6',
    'claude-opus': 'claude-opus-4-6-thinking',
    'claude-opus-4-6': 'claude-opus-4-6-thinking',
    'claude-opus-4-6-thinking': 'claude-opus-4-6-thinking',
  };

  if (aliasMap[clean]) {
    return aliasMap[clean];
  }

  if (clean.includes('opus')) {
    return clean.includes('5-5') || clean.includes('5.5') ? 'claude-opus-5-5' : 'claude-opus-4-6-thinking';
  }

  if (clean.includes('claude') || clean.includes('sonnet')) {
    return clean.includes('5-5') || clean.includes('5.5') ? 'claude-sonnet-5-5' : 'claude-sonnet-4-6';
  }

  if (clean.includes('argon')) {
    if (clean.includes('low')) return 'gemini-4-argon-low';
    if (clean.includes('medium')) return 'gemini-4-argon-medium';
    return 'gemini-4-argon-high';
  }

  if (clean.includes('pro') || clean.includes('flash') || clean.includes('gpt')) {
    if (clean.includes('low')) return 'gemini-3.8-flash-low';
    if (clean.includes('high')) return 'gemini-3.8-flash-high';
    return 'gemini-3.8-flash-medium';
  }

  return 'gemini-3.8-flash-medium';
}

/**
 * Official models supported by Google Gemini CLI (Production Cloud Code).
 * Sourced directly from official Google Gemini CLI (/model manage):
 * 1. gemini-3.8-flash (and tiered variants)
 * 2. gemini-4-argon (and variants)
 * 3. gemma-4-31b-it
 * 4. gemma-4-26b-a4b-it
 */
export const GEMINI_CLI_SUPPORTED_MODELS = new Set<string>([
  'gemini-3.8-flash',
  'gemini-3.8-flash-tiered',
  'gemini-3.8-flash-low',
  'gemini-3.8-flash-medium',
  'gemini-3.8-flash-high',
  'gemini-4-argon',
  'gemini-4-argon-high',
  'gemini-4-argon-medium',
  'gemini-4-argon-low',
  'gemma-4-31b-it',
  'gemma-4-26b-a4b-it',
]);

/**
 * Checks whether a requested model ID is officially supported by the Gemini CLI endpoint.
 */
export function isGeminiCliSupportedModel(modelId: string): boolean {
  if (!modelId) return false;
  const clean = modelId.replace(/^models\//, '').trim().toLowerCase();
  if (GEMINI_CLI_SUPPORTED_MODELS.has(clean)) return true;
  if (clean.includes('3.8-flash')) return true;
  if (clean.includes('argon')) return true;
  if (clean.startsWith('gemma-4-')) return true;
  return false;
}

/**
 * Maps Antigravity model names to exact Gemini CLI production model names.
 */
export function mapToGeminiCliModel(modelId: string): string {
  if (!modelId) return 'gemini-3.8-flash';
  const clean = modelId.replace(/^models\//, '').trim().toLowerCase();
  if (clean.includes('3.8-flash')) return 'gemini-3.8-flash';
  if (clean.includes('argon')) return 'gemini-4-argon-medium';
  if (clean.startsWith('gemma-4-31b')) return 'gemma-4-31b-it';
  if (clean.startsWith('gemma-4-26b')) return 'gemma-4-26b-a4b-it';
  return clean;
}

/**
 * Checks whether a given model candidate represents a Google Cloud Code account
 * (using OAuth ya29 access token or 1// refresh token, or Cloud Code endpoint)
 * rather than an external Google AI Studio key (AIzaSy...).
 */
export function isGoogleCloudCodeModel(m: {
  name?: string;
  provider?: string;
  apiKey?: string;
  refreshToken?: string;
  apiUrl?: string;
}): boolean {
  if (m.provider !== 'google' && m.provider !== 'gemini-cli') return false;
  // If explicitly using an AI Studio Developer API key (AIzaSy... or AQ...), treat as AI Studio
  if (m.apiKey && (m.apiKey.startsWith('AIzaSy') || m.apiKey.startsWith('AQ'))) return false;

  return Boolean(
    m.refreshToken ||
    (m.apiKey && m.apiKey.startsWith('ya29.')) ||
    m.apiUrl?.includes('cloudcode') ||
    m.apiKey === 'auto' ||
    m.name?.includes(':auto-pool')
  );
}

/**
 * Checks whether an account candidate is entitled to Claude 5.5 models (Opus 5.5 / Sonnet 5.5).
 * Discovered dynamically via Family group status, explicit live capability probe, or configuration.
 * Claude 5.5 belongs strictly and exclusively to shared accounts ('partage' / 'family').
 */
export function isAccountEntitledToClaude55(a: any): boolean {
  if (!a) return false;
  if (a.hasClaude55 === true || a.isFamily === true || a.isFamilyShared === true || a.isFamilyPro === true) {
    return true;
  }
  const tierStr = String(a.tier || a.type || a.tierId || a.accountType || '').toLowerCase();
  if (tierStr.includes('partage') || tierStr.includes('family') || tierStr.includes('partag')) {
    return true;
  }
  const nameStr = String(a.name || '').toLowerCase();
  if (nameStr.includes('partage') || nameStr.includes('family')) {
    return true;
  }
  const email = String(a.accountEmail || a.email || '').toLowerCase().trim();
  const accKey = email ? `google:${email}` : (a.apiKey || '');
  const liveQuota = getLiveAccountQuota(accKey);
  if (liveQuota?.hasClaude55 === true || liveQuota?.isFamilyShared === true) {
    return true;
  }
  const liveTier = String(liveQuota?.tier || '').toLowerCase();
  if (liveTier.includes('partage') || liveTier.includes('family') || liveTier.includes('partag')) {
    return true;
  }
  return false;
}

/**
 * Checks whether a given model candidate represents a Gemini CLI account or endpoint.
 */
export function isGeminiCliModel(m?: {
  provider?: string;
  apiUrl?: string;
  name?: string;
  projectId?: string;
}): boolean {
  if (!m) return false;
  if (m.provider === 'gemini-cli') return true;
  if (typeof m.name === 'string' && m.name.toLowerCase().includes('gemini cli')) return true;
  if (m.projectId === 'aicode-consumers' || m.provider === 'google-gemini') return false;
  if (typeof m.apiUrl === 'string' && m.apiUrl.includes('cloudcode-pa.googleapis.com/v1internal') && !m.apiUrl.includes('daily-cloudcode')) {
    return true;
  }
  if (m.provider === 'google' || (m as any).id === 'provider-google') return false;
  return false;
}

/**
 * Sanitizes generationConfig for Google Cloud Code and Vertex AI models to prevent HTTP 400 Bad Request errors.
 * - Deletes thinkingConfig if budget is NaN, 0, or negative (prevents Cloud Code 400 on gpt-oss/gemini).
 * - Clamps thinkingBudget to >= 1024 for Claude models (prevents Vertex AI 400: budget_tokens >= 1024).
 * - Ensures maxOutputTokens > thinkingBudget for Claude models with thinking.
 * - Strips temperature/topP/topK for Claude models when thinking is active (Anthropic API requirement).
 * - Prunes trailing model turns from contents to avoid "request would have ended on a model turn".
 */
