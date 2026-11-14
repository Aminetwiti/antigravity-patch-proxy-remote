import * as http from 'http';
import log from 'electron-log';
import { safeWriteHead, safeEnd } from '../../httpUtils';
import {
  isNativeCloudCodeModel,
  normalizeCloudCodeModelId,
} from '../../../../models/catalog/modelUtils';
import {
  getNativeSession,
  getLatestNativeErrorAsSession,
  nativeSessions,
  clearLatestNativeGlobalError,
  markNativeSession,
  clearSessionModelFallback,
  NATIVE_CASCADE_BLOCK_WINDOW_MS,
} from '../../../../resilience/pools/sessionAffinities';

export interface NativeCascadeCheckResult {
  blocked: boolean;
  isNativeCloudCode: boolean;
}

export function handleNativeCascadeGuard(
  candidateNames: string[],
  cleanRequested: string,
  requestedRaw: string,
  isExplicitCustom: boolean,
  sessionKey: string,
  convId: string | null,
  sessId: string,
  reqJson: Record<string, unknown>,
  targetReq: Record<string, unknown>,
  res: http.ServerResponse,
): NativeCascadeCheckResult {
  const isPrimaryNative = !isExplicitCustom && (isNativeCloudCodeModel(cleanRequested) || cleanRequested.includes('argon'));
  const isNativeCloudCode = isPrimaryNative || (!isExplicitCustom && (
    cleanRequested.includes('argon') ||
    candidateNames.some((cn) => isNativeCloudCodeModel(cn.replace(/^models\//, '').trim()))
  ));

  const activeNative = (sessionKey ? getNativeSession(sessionKey) : undefined) ||
                       (convId ? getNativeSession(convId) : undefined) ||
                       (sessId ? getNativeSession(sessId) : undefined) ||
                       (!sessionKey && !convId && !sessId ? getLatestNativeErrorAsSession() : undefined);
  const isNativeProtected = Boolean(
    activeNative &&
    activeNative.lastError &&
    activeNative.originalModel &&
    isNativeCloudCodeModel(activeNative.originalModel)
  );
  const normOrig = isNativeProtected ? (normalizeCloudCodeModelId(activeNative!.originalModel) || activeNative!.originalModel.toLowerCase()) : '';
  const normCurrent = normalizeCloudCodeModelId(cleanRequested) || cleanRequested.toLowerCase();
  const isSameModel = isNativeProtected && (
    normOrig === normCurrent ||
    (normOrig.includes('sonnet') && normCurrent.includes('sonnet')) ||
    (normOrig.includes('opus') && normCurrent.includes('opus')) ||
    (normOrig.includes('flash') && normCurrent.includes('flash') && !normOrig.includes('pro'))
  );
  const isExplicitUserCustom = isExplicitCustom;

  if (isExplicitUserCustom) {
    if (sessionKey) nativeSessions.delete(sessionKey);
    if (convId) nativeSessions.delete(convId);
    if (sessId) nativeSessions.delete(sessId);
    clearLatestNativeGlobalError();
  }

  const isFallbackToDifferentModel = isNativeProtected && !isSameModel && !isExplicitUserCustom;

  if (isFallbackToDifferentModel) {
    if (process.env.AG_ENABLE_CROSS_MODEL_FALLBACK === '1') {
      return { blocked: false, isNativeCloudCode };
    }
    const timeSinceNative = Date.now() - activeNative!.lastSeen;
    if (timeSinceNative < NATIVE_CASCADE_BLOCK_WINDOW_MS) {
      log.warn(
        `[Proxy] ? Blocked automated Language Server fallback to [${requestedRaw}] on native session [${sessionKey || convId || sessId || 'unknown'}] (original model: [${activeNative!.originalModel}], within cascade window). Strict ZERO fallback rule: rejecting fallback to report original error directly.`
      );
      const err = activeNative!.lastError;
      if (err && err.body && err.body.length > 0) {
        const respHeaders = { ...err.headers };
        delete respHeaders['transfer-encoding'];
        respHeaders['content-length'] = String(err.body.length);
        if (safeWriteHead(res, err.statusCode, respHeaders)) {
          safeEnd(res, err.body);
        }
        return { blocked: true, isNativeCloudCode };
      } else {
        const errCode = err?.statusCode || 429;
        const fallbackPayload = Buffer.from(
          JSON.stringify({
            error: {
              code: errCode,
              message: errCode === 404
                ? `Model ${activeNative!.originalModel || cleanRequested} is not available.`
                : `Resource has been exhausted (e.g. check quota) for model ${activeNative!.originalModel || cleanRequested}.`,
              status: errCode === 404 ? 'NOT_FOUND' : 'RESOURCE_EXHAUSTED',
            },
          }),
          'utf-8',
        );
        if (safeWriteHead(res, errCode, { 'Content-Type': 'application/json; charset=UTF-8', 'Content-Length': String(fallbackPayload.length) })) {
          safeEnd(res, fallbackPayload);
        }
        return { blocked: true, isNativeCloudCode };
      }
    }
  }

  if (isNativeCloudCode) {
    reqJson.model = cleanRequested;
    if (targetReq && typeof targetReq === 'object') {
      targetReq.model = cleanRequested;
    }
    for (let i = candidateNames.length - 1; i >= 0; i--) {
      if (/MODEL_PLACEHOLDER_/i.test(candidateNames[i]) || candidateNames[i].startsWith('custom-')) {
        candidateNames.splice(i, 1);
      }
    }
    if (!candidateNames.includes(cleanRequested)) {
      candidateNames.unshift(cleanRequested);
    }

    if (sessionKey) markNativeSession(sessionKey, cleanRequested);
    if (convId && convId !== sessionKey) markNativeSession(convId, cleanRequested);
    if (sessId && sessId !== sessionKey) markNativeSession(sessId, cleanRequested);

    if (sessionKey) clearSessionModelFallback(sessionKey);
    if (convId) clearSessionModelFallback(convId);
    if (sessId) clearSessionModelFallback(sessId);
  } else {
    if (sessionKey) nativeSessions.delete(sessionKey);
    if (convId) nativeSessions.delete(convId);
    if (sessId) nativeSessions.delete(sessId);
  }

  return { blocked: false, isNativeCloudCode };
}
