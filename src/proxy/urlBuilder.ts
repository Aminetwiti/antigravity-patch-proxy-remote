/**
 * URL construction for custom model requests.
 * Pure functions — no I/O, no side effects, fully testable.
 */

import type { CustomModel } from './types';

/**
 * Resolves the effective provider for routing purposes.
 * `custom` and `openrouter` are translated as OpenAI-compatible.
 */
export function resolveProvider(model: CustomModel): string {
  return model.provider === 'custom' || model.provider === 'openrouter' ? 'openai' : model.provider;
}

/**
 * Strips model anchors/variants (e.g., `claude-3-5-sonnet#thinking` -> `claude-3-5-sonnet`).
 */
export function getBaseModelId(modelId: string): string {
  if (!modelId) return '';
  const hashIdx = modelId.indexOf('#');
  return hashIdx !== -1 ? modelId.substring(0, hashIdx) : modelId;
}

/**
 * Resolves the effective URL for a custom model request, applying provider-specific
 * URL construction rules.
 *
 * - If `model.useRawBaseUrl` is true: uses `model.apiUrl` as-is without modification.
 * - `google` / `ollama`: delegated to a provider-specific translator via the registry.
 * - `openai` / `custom` / `openrouter`: appends `/chat/completions` if missing.
 *
 * @param model          The custom model configuration.
 * @param isStream       Whether this is a streaming request.
 * @param getProviderUrl Provider-URL resolver (typically the registry).
 *                       For google/ollama, this is `registry.getProviderUrl(...)`.
 *                       For openai/custom/openrouter, this can be a no-op identity.
 */
export function resolveCustomModelUrl(
  model: CustomModel,
  isStream: boolean,
  getProviderUrl: (
    apiUrl: string,
    externalModelName: string,
    isStream: boolean,
    translator: unknown,
  ) => string,
): string {
  if (model.useRawBaseUrl) {
    return model.apiUrl;
  }

  const provider = resolveProvider(model);
  let finalUrlStr = (model.apiUrl || '').replace(/\/v1\/v1(?=\/|$)/gi, '/v1');
  const cleanModelName = getBaseModelId(model.externalModelName);

  if (provider === 'google' || provider === 'ollama') {
    const providerTranslator = (model as unknown as { _translator?: unknown })._translator;
    finalUrlStr = getProviderUrl(finalUrlStr, cleanModelName, isStream, providerTranslator);
  } else if (provider === 'openai' || model.provider === 'custom' || model.provider === 'openrouter') {
    const urlLower = finalUrlStr.toLowerCase();
    if (!urlLower.includes('/chat/completions') && !urlLower.includes('/completions')) {
      finalUrlStr = finalUrlStr.replace(/\/+$/, '');
      if (finalUrlStr.endsWith('/v1')) {
        finalUrlStr += '/chat/completions';
      } else {
        finalUrlStr += '/v1/chat/completions';
      }
    }
  }

  return finalUrlStr.replace(/\/v1\/v1(?=\/|$)/gi, '/v1');
}


/**
 * Resolves the effective max retries for a custom model request.
 * Clamped to [0, 5]. Default lowered from 3 to 1 (see DEFAULT_MAX_RETRIES).
 */
export function resolveMaxRetries(model: CustomModel): number {
  return Math.min(Math.max(model.maxRetries ?? 1, 0), 5);
}

/**
 * Resolves the effective request timeout in milliseconds.
 * Default lowered from 120_000 to 30_000 (see DEFAULT_MODEL_REQUEST_TIMEOUT_MS).
 */
export function resolveRequestTimeout(model: CustomModel): number {
  return model.timeout || 30_000;
}
