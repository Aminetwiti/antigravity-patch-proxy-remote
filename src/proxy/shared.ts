/**
 * Shared state module for proxy orchestration.
 * Extracted from proxy.ts to decouple translators from main orchestration.
 */

// ─── Types ────────────────────────────────────────────────────────────────

export interface StreamContext {
  accumulatedText: string;
  accumulatedReasoning: string;
  toolCalls: Record<number, { id: string; name: string; arguments: string }>;
}

export interface StateTimestamps {
  streamCtx: Map<string, number>;
  toolCallIds: Map<string, number>;
  translatedCalls: Map<string, number>;
  reasoning: Map<string, number>;
  thoughtSigs: Map<string, number>;
}

export interface TranslatedCallInfo {
  originalName: string;
  translatedName: string;
  cmd: string;
  cwd: string;
}

// ─── State ────────────────────────────────────────────────────────────────

/** modelName → { "functionName": "original_tool_call_id" } */
export const modelToolCallIds = new Map<string, Record<string, string>>();

/** modelName → preserved reasoning_content from previous turn */
export const modelReasoningContent = new Map<string, string>();

/** streamId → { accumulatedText, accumulatedReasoning, toolCalls } */
export const activeStreamContexts = new Map<string, StreamContext>();

/** toolCallId → { originalName, translatedName, cmd, cwd } */
export const translatedToolCalls = new Map<string, TranslatedCallInfo>();

/**
 * `convId:funcName` → last seen thought_signature string.
 * Gemini 3+ requires thought_signature on every functionCall part in history.
 * The LS strips it when building subsequent requests; we cache and restore it.
 */
export const thoughtSignatureCache = new Map<string, string>();

/** State entry timestamps for periodic cleanup */
export const stateTimestamps: StateTimestamps = {
  streamCtx: new Map(),
  toolCallIds: new Map(),
  translatedCalls: new Map(),
  reasoning: new Map(),
  thoughtSigs: new Map(),
};

// ─── Helpers ──────────────────────────────────────────────────────────────

export function touchStateTimestamp(map: Map<string, number>, key: string): void {
  map.set(key, Date.now());
}

/**
 * Helper to build composite key for per-session model state isolation.
 * When sessionId is absent, falls back to modelName for backward compatibility.
 */
export function getSessionModelKey(modelName: string, sessionId?: string): string {
  if (sessionId && typeof sessionId === 'string' && sessionId.trim()) {
    return `${sessionId.trim()}:${modelName}`;
  }
  return modelName;
}

/**
 * Scans Gemini SSE/JSON response data for functionCall parts that carry a
 * thought_signature sibling field and caches them keyed by convId:funcName.
 * Also caches by funcName as a global fallback.
 */
export function extractAndCacheThoughtSignatures(data: unknown, convId: string): void {
  if (!data || typeof data !== 'object') return;
  const d = data as { candidates?: unknown[] };
  if (!Array.isArray(d.candidates)) return;
  for (const cand of d.candidates) {
    const c = cand as { content?: { parts?: unknown[] } };
    if (!Array.isArray(c?.content?.parts)) continue;
    for (const part of c.content!.parts!) {
      const p = part as Record<string, unknown>;
      const fc = p.functionCall as Record<string, unknown> | undefined;
      const fnName = (fc?.name as string) || (p.name as string);
      const sig = (typeof p.thought_signature === 'string' && p.thought_signature) ||
                  (typeof p.thoughtSignature === 'string' && p.thoughtSignature) ||
                  (typeof fc?.thought_signature === 'string' && fc.thought_signature) ||
                  (typeof fc?.thoughtSignature === 'string' && fc.thoughtSignature);
      if (fnName && sig) {
        if (convId) {
          const scopedKey = `${convId}:${fnName}`;
          thoughtSignatureCache.set(scopedKey, sig);
          touchStateTimestamp(stateTimestamps.thoughtSigs, scopedKey);
        }
        thoughtSignatureCache.set(fnName, sig);
        touchStateTimestamp(stateTimestamps.thoughtSigs, fnName);
      }
    }
  }
}

/**
 * Scans outgoing request contents[] for functionCall parts missing
 * thought_signature and restores cached values where available.
 * Returns true if any signature was restored.
 */
export function restoreThoughtSignatures(contents: unknown[], convId: string): boolean {
  let restoredCount = 0;
  for (const content of contents) {
    const c = content as { parts?: unknown[] };
    if (!Array.isArray(c?.parts)) continue;
    for (const part of c.parts) {
      const p = part as Record<string, unknown>;
      const fc = p.functionCall as Record<string, unknown> | undefined;
      if (!fc || typeof fc.name !== 'string' || !fc.name) continue;

      const existingSig = (typeof p.thought_signature === 'string' && p.thought_signature) ||
                          (typeof p.thoughtSignature === 'string' && p.thoughtSignature) ||
                          (typeof fc.thought_signature === 'string' && fc.thought_signature) ||
                          (typeof fc.thoughtSignature === 'string' && fc.thoughtSignature);
      if (existingSig) continue;

      const scopedKey = convId ? `${convId}:${fc.name}` : '';
      const cached = (scopedKey && thoughtSignatureCache.get(scopedKey)) ||
                     thoughtSignatureCache.get(fc.name as string);
      const sigToUse = cached || 'skip_thought_signature_validator';

      p.thought_signature = sigToUse;
      p.thoughtSignature = sigToUse;
      fc.thought_signature = sigToUse;
      fc.thoughtSignature = sigToUse;
      restoredCount++;
    }
  }
  return restoredCount > 0;
}

// ─── Periodic Cleanup (managed lifecycle) ─────────────────────────────────

let cleanupInterval: ReturnType<typeof setInterval> | null = null;

export function startCleanupInterval(): void {
  if (cleanupInterval) return; // already running
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    const STREAM_TTL = 600_000; // 10 minutes for active stream contexts
    const TOOL_TTL = 1_800_000; // 30 minutes for tool call IDs & reasoning

    for (const [key, ts] of stateTimestamps.streamCtx) {
      if (now - ts > STREAM_TTL) {
        activeStreamContexts.delete(key);
        stateTimestamps.streamCtx.delete(key);
      }
    }
    for (const [key, ts] of stateTimestamps.toolCallIds) {
      if (now - ts > TOOL_TTL) {
        modelToolCallIds.delete(key);
        stateTimestamps.toolCallIds.delete(key);
      }
    }
    for (const [key, ts] of stateTimestamps.translatedCalls) {
      if (now - ts > TOOL_TTL) {
        translatedToolCalls.delete(key);
        stateTimestamps.translatedCalls.delete(key);
      }
    }
    for (const [key, ts] of stateTimestamps.reasoning) {
      if (now - ts > TOOL_TTL) {
        modelReasoningContent.delete(key);
        stateTimestamps.reasoning.delete(key);
      }
    }
    for (const [key, ts] of stateTimestamps.thoughtSigs) {
      if (now - ts > TOOL_TTL) {
        thoughtSignatureCache.delete(key);
        stateTimestamps.thoughtSigs.delete(key);
      }
    }
  }, 300_000);
}

export function stopCleanupInterval(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

// Auto-start for backward compatibility (will be replaced by proxy.ts lifecycle)
startCleanupInterval();
