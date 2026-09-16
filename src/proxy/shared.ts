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
 * Track signature metadata: model family and message count at generation time.
 * Layer 2 & 3 from Antigravity-Manager signature cache architecture.
 */
export interface ThoughtSignatureMetadata {
  signature: string;
  family: 'gemini' | 'claude' | 'unknown';
  messageCount?: number;
}

export const thoughtSignatureMeta = new Map<string, ThoughtSignatureMetadata>();

/** Detects model family from model name or string identifier */
export function detectSignatureFamily(modelOrSig?: string): 'gemini' | 'claude' | 'unknown' {
  if (!modelOrSig) return 'unknown';
  const lower = modelOrSig.toLowerCase();
  if (lower.includes('claude') || lower.includes('anthropic') || lower.startsWith('c-')) return 'claude';
  if (lower.includes('gemini') || lower.includes('google') || lower.startsWith('g-')) return 'gemini';
  return 'unknown';
}

/**
 * Extracts thought_signature from response candidates and stores them in cache.
 * Scoped by convId:funcName and funcName, with rewind detection.
 */
export function extractAndCacheThoughtSignatures(
  data: unknown,
  convId: string,
  modelName?: string,
  currentMessageCount?: number,
): void {
  if (!data || typeof data !== 'object') return;
  const d = data as { candidates?: unknown[] };
  if (!Array.isArray(d.candidates)) return;
  const family = detectSignatureFamily(modelName);

  for (const cand of d.candidates) {
    const c = cand as { content?: { parts?: unknown[] } };
    if (!Array.isArray(c?.content?.parts)) continue;
    for (const part of c.content!.parts!) {
      const p = part as Record<string, unknown>;
      const fc = (p.functionCall || p.function_call) as Record<string, unknown> | undefined;
      const fnName = (fc?.name as string) || (p.name as string);
      const sig = (typeof p.thought_signature === 'string' && p.thought_signature) ||
                  (typeof p.thoughtSignature === 'string' && p.thoughtSignature) ||
                  (typeof fc?.thought_signature === 'string' && fc.thought_signature) ||
                  (typeof fc?.thoughtSignature === 'string' && fc.thoughtSignature);
      if (fnName && sig) {
        const meta: ThoughtSignatureMetadata = {
          signature: sig,
          family,
          messageCount: currentMessageCount,
        };

        if (convId) {
          const scopedKey = `${convId}:${fnName}`;
          // Rewind detection: if stored messageCount is greater than current, clear forward history
          const existing = thoughtSignatureMeta.get(scopedKey);
          if (existing?.messageCount && currentMessageCount && existing.messageCount > currentMessageCount) {
            thoughtSignatureCache.delete(scopedKey);
            thoughtSignatureMeta.delete(scopedKey);
          }

          thoughtSignatureCache.set(scopedKey, sig);
          thoughtSignatureMeta.set(scopedKey, meta);
          touchStateTimestamp(stateTimestamps.thoughtSigs, scopedKey);
        }

        thoughtSignatureCache.set(fnName, sig);
        thoughtSignatureMeta.set(fnName, meta);
        touchStateTimestamp(stateTimestamps.thoughtSigs, fnName);
      }
    }
  }
}

/**
 * Scans outgoing request contents[] for functionCall parts missing
 * thought_signature and restores cached values where available.
 * Strips cross-model incompatible signatures (e.g. Claude thought signatures on Gemini models).
 * Returns true if any signature was restored.
 */
export function restoreThoughtSignatures(
  contents: unknown[],
  convId: string,
  targetModel?: string,
): boolean {
  let restoredCount = 0;
  const targetFamily = detectSignatureFamily(targetModel);

  for (const content of contents) {
    const c = content as { parts?: unknown[] };
    if (!Array.isArray(c?.parts)) continue;
    for (const part of c.parts) {
      const p = part as Record<string, unknown>;
      const fc = p.functionCall as Record<string, unknown> | undefined;
      if (!fc || typeof fc.name !== 'string' || !fc.name) continue;

      // ponytail: Google API rejects unknown fields inside function_call.
      // thought_signature is part-level only. Strip from fc unconditionally,
      // promoting to part-level if the sig was only inside fc.
      const fcs = [p.functionCall as Record<string, unknown> | undefined, p.function_call as Record<string, unknown> | undefined];
      let fcSig: string | undefined = undefined;

      for (const fc of fcs) {
        if (!fc) continue;
        const sig = (typeof fc.thought_signature === 'string' && fc.thought_signature) ||
                    (typeof fc.thoughtSignature === 'string' && fc.thoughtSignature);
      delete fc.thought_signature;
      delete fc.thoughtSignature;
        if (sig && !fcSig) fcSig = sig;
        delete fc.thought_signature;
        delete fc.thoughtSignature;
      }

      const fcForName = fcs[0] || fcs[1];
      if (!fcForName || typeof fcForName.name !== 'string' || !fcForName.name) continue;

      if (fcSig && !p.thought_signature && !p.thoughtSignature) {
        p.thought_signature = fcSig;
        p.thoughtSignature = fcSig;
      }

      const existingSig = (typeof p.thought_signature === 'string' && p.thought_signature) ||
                          (typeof p.thoughtSignature === 'string' && p.thoughtSignature);

      // Cross-model sanitize: if targeting Gemini and existing signature is from Claude, strip it
      if (existingSig) {
        const sigMeta = thoughtSignatureMeta.get(existingSig) ||
                        (convId ? thoughtSignatureMeta.get(`${convId}:${fcForName.name}`) : undefined) ||
                        thoughtSignatureMeta.get(fcForName.name as string);
        if (targetFamily === 'gemini' && sigMeta?.family === 'claude') {
          delete p.thought_signature;
          delete p.thoughtSignature;
        } else {
          continue;
        }
      }

      const scopedKey = convId ? `${convId}:${fcForName.name}` : '';
      const cached = (scopedKey && thoughtSignatureCache.get(scopedKey)) ||
                     thoughtSignatureCache.get(fcForName.name as string);

      // If cached signature is from an incompatible model family, skip it
      const cachedMeta = (scopedKey && thoughtSignatureMeta.get(scopedKey)) ||
                         thoughtSignatureMeta.get(fcForName.name as string);
      if (targetFamily === 'gemini' && cachedMeta?.family === 'claude') {
        continue;
      }

      const sigToUse = cached || 'skip_thought_signature_validator';

      p.thought_signature = sigToUse;
      p.thoughtSignature = sigToUse;
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
