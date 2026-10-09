/**
 * Google AI Studio Translator.
 *
 * Google AI Studio speaks Gemini format natively, so request/response
 * translation is a passthrough. The main addition is SSE streaming chunk
 * parsing and proper endpoint URL handling.
 */

import log from 'electron-log';

import type {
  GeminiPart,
  GeminiContent,
  GeminiCandidate,
  GeminiRequestBody,
} from '../types';

// ─── Types ────────────────────────────────────────────────────────────────

interface GeminiStreamChunk {
  candidates?: GeminiCandidate[];
  usageMetadata?: unknown;
  modelVersion?: string;
}

// ─── Model Normalization ──────────────────────────────────────────────────
import { normalizeGoogleModelId, sanitizeCloudCodeGenerationConfig } from '../../services/googleAuth';
export { normalizeGoogleModelId };

/**
 * Strips internal Cloud Code suffixes (-tiered, -high) when calling Google AI Studio REST endpoints.
 */
export function toAiStudioModelId(modelName: string): string {
  const norm = normalizeGoogleModelId(modelName);
  return norm.replace(/-tiered$/, '').replace(/-high$/, '');
}

// ─── Request Translation (Passthrough) ────────────────────────────────────

/**
 * Google AI Studio uses the same Gemini format — just pass through.
 * The caller handles URL routing (streamGenerateContent vs generateContent).
 */
export function mapGeminiToGoogle(geminiBody: GeminiRequestBody, modelName: string): GeminiRequestBody {
  // If wrapped in a Cloud Code request envelope, unwrap the inner request first
  let raw: Record<string, unknown>;
  const input = (geminiBody || {}) as Record<string, unknown>;
  if (input.request && typeof input.request === 'object') {
    raw = { ...(input.request as Record<string, unknown>) };
  } else {
    raw = { ...input };
  }

  const effectiveModel = (raw.model as string) || (input.model as string) || modelName || '';
  const targetModel = toAiStudioModelId(effectiveModel);

  // Only set body.model if body originally specified a model; Google AI Studio passes model in the URL path
  if (raw.model || input.model) {
    if (targetModel) {
      raw.model = targetModel;
    }
  }

  // Sanitize generationConfig (e.g. resolve thinkingBudget vs thinkingLevel mutual exclusivity)
  sanitizeCloudCodeGenerationConfig(raw, targetModel || effectiveModel);

  // Strip Cloud Code internal fields that Google AI Studio rejects with HTTP 400
  delete raw.project;
  delete raw.enabledCreditTypes;
  delete raw.userAgent;
  delete raw.requestId;
  delete raw.requestType;
  delete raw.planModel;
  delete raw.requestedModel;
  delete raw.selectedModel;
  delete raw.modelId;
  delete raw.agentModel;
  delete raw.request;

  return raw as unknown as GeminiRequestBody;
}

// ─── Response Translation (Passthrough) ───────────────────────────────────

/**
 * Google AI Studio returns Gemini-format responses directly.
 * Just pass through — the proxy wraps it in the Cloud Code envelope.
 */
export function mapGoogleToGemini(googleRes: unknown, _modelName: string): unknown {
  // Google AI Studio response is already in Gemini format
  // Wrapped by caller in { response, traceId, metadata }
  return googleRes;
}

// ─── Streaming Chunk Translation ──────────────────────────────────────────

/**
 * Parse a Google AI Studio SSE streaming chunk into a Gemini candidate.
 *
 * Google AI Studio streams JSON chunks like:
 *   {"candidates":[{"content":{"parts":[{"text":"Hello"}],"role":"model"},...}]}
 *
 * Each chunk contains complete candidate objects (not deltas).
 */
export function mapGoogleChunkToGemini(chunk: unknown, _modelName: string): GeminiCandidate | null {
  if (!chunk || typeof chunk !== 'object') return null;

  const data = chunk as GeminiStreamChunk;

  // Extract first candidate
  if (!data.candidates || data.candidates.length === 0) return null;

  const candidate = data.candidates[0];

  // Check if there's actual content to emit
  const parts = candidate.content?.parts;
  if (!parts || parts.length === 0) {
    // Might be a final chunk with just finishReason
    if (candidate.finishReason) {
      return {
        content: { parts: [{ text: '' }], role: 'model' },
        finishReason: candidate.finishReason,
        index: candidate.index ?? 0,
      };
    }
    return null;
  }

  return {
    content: candidate.content,
    finishReason: candidate.finishReason || 'OTHER',
    index: candidate.index ?? 0,
    safetyRatings: candidate.safetyRatings,
  };
}

// ─── URL Helpers ──────────────────────────────────────────────────────────

export function getGoogleApiUrl(baseUrl: string, modelName: string, isStream: boolean): string {
  let urlObj: URL;
  try {
    urlObj = new URL(baseUrl);
  } catch {
    // Fallback if somehow not a valid URL (e.g. just a path)
    log.warn(`[GoogleTranslator] Invalid baseUrl provided: ${baseUrl}`);
    return baseUrl;
  }

  const method = isStream ? ':streamGenerateContent' : ':generateContent';

  if (!urlObj.pathname.includes(':generateContent') && !urlObj.pathname.includes(':streamGenerateContent')) {
    urlObj.pathname = urlObj.pathname.replace(/\/$/, '');

    // Check if the URL ends with the model path (e.g. /models/gemini-3.1-pro-high)
    const modelPathPattern = /\/models\/([^\/]+)$/;
    const modelMatch = modelPathPattern.exec(urlObj.pathname);

    if (modelMatch) {
      // URL like .../v1beta/models/gemini-3.1-pro-high → normalize model & append :method
      const normalized = toAiStudioModelId(modelMatch[1]);
      if (normalized !== modelMatch[1]) {
        urlObj.pathname = urlObj.pathname.replace(modelPathPattern, `/models/${normalized}`);
      }
      urlObj.pathname += method;
    } else if (modelName) {
      // Append full path with normalized model name (without internal Cloud Code suffixes)
      const cleanName = toAiStudioModelId(modelName);
      urlObj.pathname += `/models/${cleanName}${method}`;
    } else {
      // Fallback: assume the URL is already complete
      log.warn('[GoogleTranslator] Could not determine model name for URL construction');
    }
  } else {
    // URL already has method suffix — normalize existing model name in path
    const existingModelMatch = /\/models\/([^/:]+)(:(?:streamG|g)enerateContent)/.exec(urlObj.pathname);
    if (existingModelMatch) {
      const norm = toAiStudioModelId(existingModelMatch[1]);
      if (norm !== existingModelMatch[1]) {
        urlObj.pathname = urlObj.pathname.replace(
          existingModelMatch[0],
          `/models/${norm}${existingModelMatch[2]}`,
        );
      }
    }
  }

  // Add alt=sse for streaming if not already present
  if (isStream && !urlObj.searchParams.has('alt')) {
    urlObj.searchParams.set('alt', 'sse');
  }

  return urlObj.toString();
}
