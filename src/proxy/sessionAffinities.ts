import * as http from 'http';
import log from 'electron-log';
import type { CustomModel } from './types';
import { getBaseModelId } from './urlBuilder';
import { isNativeCloudCodeModel } from './modelUtils';
import { getAccountQuotaKey, isAccountUnlicensed, isAccountInCooldown, getModelQuotaScore } from './googlePool';
import { getOpenBreaker } from './circuitBreaker';

// ─── TTL Constants ──────────────────────────────────────────────────────────

export const SESSION_AFFINITY_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
export const SESSION_MODEL_FALLBACK_TTL_MS = 3 * 60 * 1000; // 3 minutes auto-recovery back to primary model
export const NATIVE_SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
export const NATIVE_CASCADE_BLOCK_WINDOW_MS = 15 * 1000; // 15 seconds (Language Server automated fallback retry occurs within 1-5 seconds)

// ─── Session ID Extraction ──────────────────────────────────────────────────

export function extractSessionId(body: Record<string, unknown> | any, headers?: Record<string, unknown> | any): string | null {
  if (body?.sessionId && typeof body.sessionId === 'string') return body.sessionId;
  if (body?.conversationId && typeof body.conversationId === 'string') return body.conversationId;
  if (body?.conversation_id && typeof body.conversation_id === 'string') return body.conversation_id;
  if ((body?.context as any)?.sessionId && typeof (body.context as any).sessionId === 'string') {
    return (body.context as any).sessionId;
  }
  if ((body?.context as any)?.conversationId && typeof (body.context as any).conversationId === 'string') {
    return (body.context as any).conversationId;
  }
  if ((body?.request as any)?.sessionId && typeof (body.request as any).sessionId === 'string') {
    return (body.request as any).sessionId;
  }
  if ((body?.request as any)?.conversationId && typeof (body.request as any).conversationId === 'string') {
    return (body.request as any).conversationId;
  }
  if (headers) {
    const h = headers['x-session-id'] || headers['x-request-session-id'] || headers['x-conversation-id'];
    if (typeof h === 'string' && h) return h;
  }
  const contents = (body?.contents || (body?.request as any)?.contents) as Array<any> | undefined;
  if (Array.isArray(contents) && contents.length > 0) {
    for (const c of contents) {
      if (Array.isArray(c?.parts)) {
        for (const p of c.parts) {
          if (typeof p?.text === 'string') {
            const m = p.text.match(
              /(?:conversation|session|trajectory)[_\-\s:]+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
            );
            if (m && m[1]) return m[1];
          }
        }
      }
    }
    const firstUser = contents.find((c) => c && c.role === 'user');
    if (firstUser && Array.isArray(firstUser.parts) && firstUser.parts[0]?.text) {
      const snippet = String(firstUser.parts[0].text).slice(0, 120);
      let hash = 5381;
      for (let i = 0; i < snippet.length; i++) {
        hash = ((hash << 5) + hash) + snippet.charCodeAt(i);
        hash |= 0;
      }
      return 'conv_' + (hash >>> 0).toString(16);
    }
  }
  return null;
}

// ─── Session Model / Account Binding ─────────────────────────────────────────

export interface SessionAffinity {
  modelName: string;
  accountKey: string;
  lastUsed: number;
}

export const sessionAffinities = new Map<string, SessionAffinity>();

export function getSessionBoundModel(
  sessionId: string,
  targetModel: CustomModel,
  allModels: CustomModel[],
): CustomModel {
  const now = Date.now();
  const affinity = sessionAffinities.get(sessionId);
  if (!affinity) return targetModel;

  if (now - affinity.lastUsed > SESSION_AFFINITY_TTL_MS) {
    sessionAffinities.delete(sessionId);
    return targetModel;
  }

  const targetBase = getBaseModelId(targetModel.externalModelName);
  const targetEffort = targetModel._effortSuffix || targetModel.reasoningEffort || '';
  const bound = allModels.find((m) => {
    const mBase = getBaseModelId(m.externalModelName);
    const mEffort = m._effortSuffix || m.reasoningEffort || '';
    return mBase === targetBase && mEffort === targetEffort && getAccountQuotaKey(m) === affinity.accountKey;
  });

  const fam = (targetModel.externalModelName || targetModel.name || '').toLowerCase().includes('claude') ? 'claude' : 'gemini';

  if (
    bound &&
    (bound as any).enabled !== false &&
    !isAccountUnlicensed(bound) &&
    !getOpenBreaker(bound) &&
    !isAccountInCooldown(bound, fam) &&
    getModelQuotaScore(bound, fam) > 0
  ) {
    affinity.lastUsed = now;
    return bound;
  }

  sessionAffinities.delete(sessionId);
  return targetModel;
}

export function bindSessionToModel(sessionId: string, model: CustomModel): void {
  if (model.name?.includes(':auto-pool') || model.apiKey === 'auto') return;
  if (sessionAffinities.size >= 500) {
    const now = Date.now();
    for (const [sId, aff] of sessionAffinities.entries()) {
      if (now - aff.lastUsed > SESSION_AFFINITY_TTL_MS) {
        sessionAffinities.delete(sId);
      }
    }
    if (sessionAffinities.size >= 500) {
      const sorted = Array.from(sessionAffinities.entries()).sort((a, b) => a[1].lastUsed - b[1].lastUsed);
      const toRemove = sorted.slice(0, sessionAffinities.size - 400);
      for (const [oldId] of toRemove) {
        sessionAffinities.delete(oldId);
      }
    }
  }
  sessionAffinities.set(sessionId, {
    modelName: model.name,
    accountKey: getAccountQuotaKey(model),
    lastUsed: Date.now(),
  });
}

export function clearSessionAffinities(): void {
  sessionAffinities.clear();
  sessionModelFallbacks.clear();
  sessionEffortAffinities.clear();
}

// ─── Session Effort Affinities ───────────────────────────────────────────────

export interface SessionEffortEntry {
  effort: string;
  lastUsed: number;
}

export const sessionEffortAffinities = new Map<string, SessionEffortEntry>();

export function setSessionEffortAffinity(sessionId: string, effort: string): void {
  if (!sessionId || !effort) return;
  sessionEffortAffinities.set(sessionId, { effort: effort.toLowerCase(), lastUsed: Date.now() });
}

export function getSessionEffortAffinity(sessionId: string): string | undefined {
  if (!sessionId) return undefined;
  const entry = sessionEffortAffinities.get(sessionId);
  if (!entry) return undefined;
  if (Date.now() - entry.lastUsed > SESSION_AFFINITY_TTL_MS) {
    sessionEffortAffinities.delete(sessionId);
    return undefined;
  }
  return entry.effort;
}

export function clearSessionEffortAffinity(sessionId: string): void {
  if (sessionId) sessionEffortAffinities.delete(sessionId);
}

export function clearAllSessionEffortAffinities(): void {
  sessionEffortAffinities.clear();
}

// ─── Session Model Fallbacks ────────────────────────────────────────────────

export interface SessionModelFallback {
  originalModel: string;
  fallbackModel: string;
  notified: boolean;
  lastUsed: number;
}

export const sessionModelFallbacks = new Map<string, SessionModelFallback>();

export function getSessionModelFallback(sessionKey: string): SessionModelFallback | undefined {
  if (!sessionKey) return undefined;
  const fb = sessionModelFallbacks.get(sessionKey);
  if (!fb) return undefined;
  if (
    Date.now() - fb.lastUsed > SESSION_MODEL_FALLBACK_TTL_MS ||
    /gemini-(?:3\.[0-7]|2\.0|1\.)/i.test(fb.fallbackModel) ||
    /gpt-[34]/i.test(fb.fallbackModel)
  ) {
    sessionModelFallbacks.delete(sessionKey);
    return undefined;
  }
  return fb;
}

export function clearSessionModelFallback(sessionKey: string): void {
  if (sessionKey) {
    sessionModelFallbacks.delete(sessionKey);
  }
}

export function setSessionModelFallback(
  sessionKey: string,
  originalModel: string,
  fallbackModel: string,
  notified = false,
): void {
  if (!sessionKey || !originalModel || !fallbackModel) return;
  // Strict Zero-Fallback: Gemini 4 Argon or unreleased models must NEVER have a fallback model assigned
  if (originalModel === 'gemini-4-argon' || originalModel === 'gemini-4-argon-medium') {
    return;
  }
  if (/gemini-(?:3\.[0-7]|2\.0|1\.)/i.test(fallbackModel) || /gpt-[34]/i.test(fallbackModel)) {
    return;
  }
  const cleanOrig = originalModel.trim().toLowerCase();
  const cleanFb = fallbackModel.trim().toLowerCase();
  if (cleanOrig === cleanFb && !notified) return;

  const existing = sessionModelFallbacks.get(sessionKey);
  if (existing) {
    const existOrig = existing.originalModel.trim().toLowerCase();
    const existFb = existing.fallbackModel.trim().toLowerCase();
    // Prevent circular flip-flop (A -> B then B -> A)
    if (cleanOrig === existFb && cleanFb === existOrig) {
      log.warn(
        `[Proxy] Preventing circular session fallback loop for ${sessionKey}: existing (${existing.originalModel} -> ${existing.fallbackModel}) vs new (${originalModel} -> ${fallbackModel})`,
      );
      return;
    }
  }

  sessionModelFallbacks.set(sessionKey, {
    originalModel,
    fallbackModel,
    notified,
    lastUsed: Date.now(),
  });
}

export function clearSessionModelFallbacks(): void {
  sessionModelFallbacks.clear();
}

export function getActiveSessionModelFallbacks(): Record<string, SessionModelFallback> {
  const result: Record<string, SessionModelFallback> = {};
  const now = Date.now();
  for (const [key, fb] of sessionModelFallbacks.entries()) {
    if (now - fb.lastUsed <= SESSION_MODEL_FALLBACK_TTL_MS) {
      result[key] = { ...fb };
    } else {
      sessionModelFallbacks.delete(key);
    }
  }
  return result;
}

// ─── Native Session Tracking & Error Buffering ──────────────────────────────

export interface NativeSessionRecord {
  originalModel: string;
  lastSeen: number;
  lastError?: {
    statusCode: number;
    headers: Record<string, string>;
    body: Buffer;
  };
}

export const nativeSessions = new Map<string, NativeSessionRecord>();

export function markNativeSession(sessionKey: string, model: string): void {
  if (!sessionKey) return;
  const now = Date.now();
  const existing = nativeSessions.get(sessionKey);
  nativeSessions.set(sessionKey, {
    originalModel: model || existing?.originalModel || '',
    lastSeen: now,
    lastError: existing?.lastError,
  });
}

export function getNativeSession(sessionKey: string): NativeSessionRecord | undefined {
  if (!sessionKey) return undefined;
  const rec = nativeSessions.get(sessionKey);
  if (!rec) return undefined;
  if (Date.now() - rec.lastSeen > NATIVE_SESSION_TTL_MS) {
    nativeSessions.delete(sessionKey);
    return undefined;
  }
  return rec;
}

export let latestNativeGlobalError: {
  originalModel: string;
  statusCode: number;
  headers: Record<string, string>;
  body: Buffer;
  timestamp: number;
} | null = null;

export function recordLatestNativeError(
  statusCode: number,
  headers: Record<string, string>,
  body: Buffer,
  modelName: string,
): void {
  if (!modelName || !isNativeCloudCodeModel(modelName)) return;
  latestNativeGlobalError = {
    originalModel: modelName,
    statusCode,
    headers,
    body: body || Buffer.alloc(0),
    timestamp: Date.now(),
  };
}

export function updateLatestNativeErrorBody(body: Buffer): void {
  if (latestNativeGlobalError) {
    latestNativeGlobalError.body = body;
  }
}

export function getLatestNativeErrorAsSession(): NativeSessionRecord | undefined {
  if (!latestNativeGlobalError) return undefined;
  if (Date.now() - latestNativeGlobalError.timestamp > NATIVE_CASCADE_BLOCK_WINDOW_MS) {
    latestNativeGlobalError = null;
    return undefined;
  }
  return {
    originalModel: latestNativeGlobalError.originalModel,
    lastSeen: latestNativeGlobalError.timestamp,
    lastError: {
      statusCode: latestNativeGlobalError.statusCode,
      headers: latestNativeGlobalError.headers,
      body: latestNativeGlobalError.body,
    },
  };
}

export function recordNativeSessionError(
  sessionKey: string,
  statusCode: number,
  headers: Record<string, string>,
  body: Buffer,
  modelName?: string,
): void {
  const effectiveModel = modelName || (sessionKey ? nativeSessions.get(sessionKey)?.originalModel : '') || '';
  if (effectiveModel) {
    recordLatestNativeError(statusCode, headers, body, effectiveModel);
  }
  if (!sessionKey) return;
  const rec = nativeSessions.get(sessionKey);
  if (rec) {
    rec.lastError = { statusCode, headers, body };
    rec.lastSeen = Date.now();
    if (modelName && !rec.originalModel) {
      rec.originalModel = modelName;
    }
  } else if (modelName && isNativeCloudCodeModel(modelName)) {
    nativeSessions.set(sessionKey, {
      originalModel: modelName,
      lastSeen: Date.now(),
      lastError: { statusCode, headers, body },
    });
  }
}

export function clearLatestNativeGlobalError(): void {
  latestNativeGlobalError = null;
}

export function clearNativeSessions(): void {
  nativeSessions.clear();
  latestNativeGlobalError = null;
}
