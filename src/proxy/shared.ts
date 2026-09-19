/**
 * Shared state module for proxy orchestration.
 * Extracted from proxy.ts to decouple translators from main orchestration.
 */

// ─── Types ────────────────────────────────────────────────────────────────

export interface StreamContext {
  accumulatedText: string;
  accumulatedReasoning: string;
  toolCalls: Record<number, { id: string; name: string; arguments: string }>;
  signature?: string;
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

    // Scan for any thought signature emitted anywhere across parts in this candidate
    let turnSig: string | undefined;
    for (const part of c.content!.parts!) {
      const p = part as Record<string, unknown>;
      const fc = (p?.functionCall || p?.function_call) as Record<string, unknown> | undefined;
      const s = (typeof p?.thought_signature === 'string' && p.thought_signature) ||
                (typeof p?.thoughtSignature === 'string' && p.thoughtSignature) ||
                (typeof fc?.thought_signature === 'string' && fc.thought_signature) ||
                (typeof fc?.thoughtSignature === 'string' && fc.thoughtSignature);
      if (s) {
        turnSig = s;
        break;
      }
    }

    for (const part of c.content!.parts!) {
      const p = part as Record<string, unknown>;
      const fc = (p?.functionCall || p?.function_call) as Record<string, unknown> | undefined;
      const fnName = (fc?.name as string) || (p?.name as string);
      const sig = (typeof p?.thought_signature === 'string' && p.thought_signature) ||
                  (typeof p?.thoughtSignature === 'string' && p.thoughtSignature) ||
                  (typeof fc?.thought_signature === 'string' && fc.thought_signature) ||
                  (typeof fc?.thoughtSignature === 'string' && fc.thoughtSignature) ||
                  turnSig;
      if (sig) {
        const meta: ThoughtSignatureMetadata = {
          signature: sig,
          family,
          messageCount: currentMessageCount,
        };

        if (convId) {
          if (fnName) {
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

          const convLastKey = `${convId}:__last__`;
          thoughtSignatureCache.set(convLastKey, sig);
          thoughtSignatureMeta.set(convLastKey, meta);
          touchStateTimestamp(stateTimestamps.thoughtSigs, convLastKey);
        }

        if (fnName) {
          thoughtSignatureCache.set(fnName, sig);
          thoughtSignatureMeta.set(fnName, meta);
          touchStateTimestamp(stateTimestamps.thoughtSigs, fnName);
        }
      }
    }
  }
}

/**
 * Scans outgoing request contents[] for functionCall parts missing
 * thought_signature and restores cached values where available.
 * Strips thought_signature completely if targeting Gemini and the signature originated from Claude.
 * Returns true if at least one signature was restored.
 */
export function restoreThoughtSignatures(
  contents: unknown[],
  convId: string,
  targetModel?: string,
): boolean {
  let restoredCount = 0;
  const targetFamily = detectSignatureFamily(targetModel);
  if (targetFamily === 'claude') {
    return false;
  }

  for (const content of contents) {
    const c = content as { parts?: unknown[] };
    if (!Array.isArray(c?.parts)) continue;

    // Scan if any sibling part in the SAME turn has a thought_signature
    let siblingSig: string | undefined;
    for (const part of c.parts) {
      const p = part as Record<string, unknown>;
      const s = (typeof p?.thought_signature === 'string' && p.thought_signature) ||
                (typeof p?.thoughtSignature === 'string' && p.thoughtSignature);
      if (s) {
        siblingSig = s;
        break;
      }
    }

    for (const part of c.parts) {
      const p = part as Record<string, unknown>;
      const fc = p.functionCall as Record<string, unknown> | undefined;
      if (!fc || typeof fc.name !== 'string' || !fc.name) continue;

      // ponytail: Google API rejects unknown fields inside function_call.
      // thought_signature is part-level only. Strip from fc unconditionally,
      // promoting to part-level if the sig was only inside fc.
      const fcs = [p.functionCall as Record<string, unknown> | undefined, p.function_call as Record<string, unknown> | undefined];
      let fcSig: string | undefined = undefined;

      for (const fcItem of fcs) {
        if (!fcItem) continue;
        const sig = (typeof fcItem.thought_signature === 'string' && fcItem.thought_signature) ||
                    (typeof fcItem.thoughtSignature === 'string' && fcItem.thoughtSignature);
        if (sig && !fcSig) fcSig = sig;
        delete fcItem.thought_signature;
        delete fcItem.thoughtSignature;
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
      let cached = (scopedKey && thoughtSignatureCache.get(scopedKey)) ||
                   siblingSig ||
                   (convId ? thoughtSignatureCache.get(`${convId}:__last__`) : undefined) ||
                   thoughtSignatureCache.get(fcForName.name as string);

      // If cached signature is from an incompatible model family, skip it
      if (cached) {
        const cachedMeta = (scopedKey && thoughtSignatureMeta.get(scopedKey)) ||
                           (convId ? thoughtSignatureMeta.get(`${convId}:__last__`) : undefined) ||
                           thoughtSignatureMeta.get(fcForName.name as string) ||
                           thoughtSignatureMeta.get(cached);
        if (targetFamily === 'gemini' && cachedMeta?.family === 'claude') {
          cached = undefined;
        }
      }

      // No cached signature — don't set anything. Sending a placeholder string
      // causes Google's API to return INVALID_ARGUMENT (400).
      if (!cached) continue;

      p.thought_signature = cached;
      p.thoughtSignature = cached;
      restoredCount++;
    }
  }
  return restoredCount > 0;
}

/**
 * For Gemini 2.5 / 3+ models on Vertex AI / Cloud Code:
 * If a functionCall part has NO thought_signature and none could be restored from cache,
 * Vertex AI rejects the request with HTTP 400 "Function call is missing a thought_signature in functionCall parts".
 * This function converts any unsigned functionCall part and its corresponding functionResponse into text parts.
 * Since text parts require no thought_signature, Vertex AI accepts the request while preserving full context.
 */
export function sanitizeUnsignedToolCalls(contents: unknown[]): boolean {
  if (!Array.isArray(contents)) return false;
  let modified = false;
  const convertedToolNames = new Set<string>();

  for (const item of contents) {
    const turn = item as { role?: string; parts?: unknown[] };
    if (!Array.isArray(turn?.parts)) continue;

    turn.parts = turn.parts.map((part) => {
      if (!part || typeof part !== 'object') return part;
      const p = part as Record<string, unknown>;

      const fc = (p.functionCall || p.function_call) as Record<string, unknown> | undefined;
      if (fc && typeof fc === 'object') {
        const sig =
          (typeof p.thought_signature === 'string' && p.thought_signature) ||
          (typeof p.thoughtSignature === 'string' && p.thoughtSignature);
        if (!sig) {
          modified = true;
          const fnName = String(fc.name || 'tool');
          convertedToolNames.add(fnName);
          const args = fc.args ? (typeof fc.args === 'string' ? fc.args : JSON.stringify(fc.args)) : '{}';
          return { text: `[Executed tool: ${fnName} with arguments: ${args}]` };
        }
      }

      const fr = (p.functionResponse || p.function_response) as Record<string, unknown> | undefined;
      if (fr && typeof fr === 'object') {
        const fnName = String(fr.name || 'tool');
        if (convertedToolNames.has(fnName)) {
          modified = true;
          const rObj = fr.response as Record<string, unknown> | undefined;
          const resp = fr.response
            ? (typeof fr.response === 'string' ? fr.response : (rObj?.output || rObj?.result || JSON.stringify(fr.response)))
            : '';
          return { text: `[Tool ${fnName} output: ${resp}]` };
        }
      }

      return part;
    });
  }

  return modified;
}

/**
 * Unconditionally converts all functionCall and functionResponse parts to text parts,
 * used when Vertex AI returns HTTP 400 for corrupted or invalid signatures.
 */
export function flattenAllToolCallsToText(contents: unknown[]): boolean {
  if (!Array.isArray(contents)) return false;
  let modified = false;

  for (const item of contents) {
    const turn = item as { role?: string; parts?: unknown[] };
    if (!Array.isArray(turn?.parts)) continue;

    turn.parts = turn.parts.map((part) => {
      if (!part || typeof part !== 'object') return part;
      const p = part as Record<string, unknown>;

      const fc = (p.functionCall || p.function_call) as Record<string, unknown> | undefined;
      if (fc && typeof fc === 'object') {
        modified = true;
        const fnName = String(fc.name || 'tool');
        const args = fc.args ? (typeof fc.args === 'string' ? fc.args : JSON.stringify(fc.args)) : '{}';
        return { text: `[Executed tool: ${fnName} with arguments: ${args}]` };
      }

      const fr = (p.functionResponse || p.function_response) as Record<string, unknown> | undefined;
      if (fr && typeof fr === 'object') {
        modified = true;
        const fnName = String(fr.name || 'tool');
        const rObj = fr.response as Record<string, unknown> | undefined;
        const resp = fr.response
          ? (typeof fr.response === 'string' ? fr.response : (rObj?.output || rObj?.result || JSON.stringify(fr.response)))
          : '';
        return { text: `[Tool ${fnName} output: ${resp}]` };
      }

      delete p.thought_signature;
      delete p.thoughtSignature;
      delete p.signature;
      delete p.thought;
      return part;
    });
  }

  return modified;
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
