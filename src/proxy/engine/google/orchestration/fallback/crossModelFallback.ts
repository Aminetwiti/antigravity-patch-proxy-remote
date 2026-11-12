import log from 'electron-log';
import type { CustomModel } from '../../../../core/types';
import type { FallbackParams } from './types';
import {
  normalizeCloudCodeModelId,
  isGoogleCloudCodeModel,
  isAccountEntitledToClaude55,
  sanitizeCloudCodeGenerationConfig,
  normalizeConversationTurns,
} from '../../../../../services/auth/googleAuth';
import {
  getModelQuotaScore,
  selectBestModelByQuota,
  getGoogleAccountPool,
  isAccountUnlicensed,
  isAccountInCooldown,
} from '../../../../resilience/pools/googlePool';
import { getOpenBreaker } from '../../../../resilience/circuit/circuitBreaker';
import {
  restoreThoughtSignatures,
  flattenAllToolCallsToText,
  sanitizeUnsignedToolCalls,
} from '../../../../core/shared';
import { writeSafeSseChunk, injectAntiHallucinationInstruction } from '../../../stream/streamPipeline';
import { safeWriteHead } from '../../../../http/server/httpUtils';
import {
  getSessionModelFallback,
  setSessionModelFallback,
  clearSessionModelFallback,
} from '../../../../resilience/pools/sessionAffinities';

export async function attemptCrossModelFallback(
  params: FallbackParams,
  allCustomModels: CustomModel[],
  currentBase: string,
  isClaudeRequest: boolean,
): Promise<boolean> {
  const { req, res, reqJson, isSessionRemote, convId, sessId, attemptedModels, fallbackDepth, lastStatus, poolExecutor } =
    params;
  const isStream = req.url!.includes('streamGenerateContent') || req.url!.includes('alt=sse');

  if (attemptedModels.size > 3) {
    log.warn(`[Proxy] Agent resilience: Max fallback depth reached (${attemptedModels.size} models).`);
    return false;
  }

  const allModelBases: string[] = [
    ...new Set<string>(
      allCustomModels
        .filter((m) => isGoogleCloudCodeModel(m) && !getOpenBreaker(m) && m.apiKey !== 'auto')
        .map((m) => normalizeCloudCodeModelId(m.externalModelName || m.name))
        .filter(
          (b): b is string =>
            Boolean(b && !b.includes('3.7') && !b.includes('3.6') && !attemptedModels.has(b.toLowerCase()) && !attemptedModels.has(b)),
        ),
    ),
  ];

  const sameFamily = allModelBases.filter((m) => m.toLowerCase().includes('claude') === isClaudeRequest);
  const crossFamily = allModelBases.filter((m) => m.toLowerCase().includes('claude') !== isClaudeRequest);
  const eligibleFallbacks =
    lastStatus === 429 || lastStatus === 503 || lastStatus === 504 ? crossFamily : [...sameFamily, ...crossFamily];

  for (const fallbackModel of eligibleFallbacks) {
    const fbFamily = fallbackModel.toLowerCase().includes('claude') ? 'claude' : 'gemini';
    const isFb55 = fallbackModel.includes('5.5') || fallbackModel.includes('5-5');
    const hasAnyQuotaInFamily = allCustomModels.some(
      (m) => isGoogleCloudCodeModel(m) && getModelQuotaScore(m, fbFamily) > 0,
    );
    if (!hasAnyQuotaInFamily) continue;

    const fallbackCandidates = allCustomModels.filter(
      (m) =>
        isGoogleCloudCodeModel(m) &&
        (m as any).enabled !== false &&
        (m as any).status !== 'unhealthy' &&
        !(m as any).isValidationRequired &&
        (m as any).status !== 'validation_required' &&
        !isAccountUnlicensed(m) &&
        !normalizeCloudCodeModelId(m.externalModelName || m.name).toLowerCase().includes('3.7') &&
        !normalizeCloudCodeModelId(m.externalModelName || m.name).toLowerCase().includes('3.6') &&
        normalizeCloudCodeModelId(m.externalModelName || m.name).toLowerCase() === fallbackModel.toLowerCase() &&
        (!isFb55 || isAccountEntitledToClaude55(m)) &&
        !getOpenBreaker(m) &&
        !isAccountInCooldown(m, fbFamily) &&
        getModelQuotaScore(m, fbFamily) > 0,
    );

    if (fallbackCandidates.length === 0) continue;

    log.warn(`[Proxy] 🔀 [Model Fallback] Pool exhausted for [${currentBase}]. Switching to fallback: [${fallbackModel}]...`);
    const selectedFallback = selectBestModelByQuota(fallbackCandidates, allCustomModels, fbFamily) || fallbackCandidates[0];
    const fallbackPool = getGoogleAccountPool(selectedFallback, allCustomModels);

    reqJson.model = fallbackModel;
    if (reqJson.request && typeof reqJson.request === 'object') {
      (reqJson.request as Record<string, unknown>).model = fallbackModel;
      sanitizeCloudCodeGenerationConfig(reqJson.request as Record<string, unknown>, fallbackModel);
    }
    const fbContents = (reqJson.request as any)?.contents || reqJson.contents;
    if (Array.isArray(fbContents)) {
      const isFbClaude = fallbackModel.toLowerCase().includes('claude');
      if (isFbClaude) {
        sanitizeCloudCodeGenerationConfig((reqJson.request as Record<string, unknown>) || reqJson, fallbackModel);
      } else {
        if (lastStatus === 400) {
          flattenAllToolCallsToText(fbContents);
          injectAntiHallucinationInstruction((reqJson.request as Record<string, unknown>) || reqJson);
        } else {
          restoreThoughtSignatures(fbContents, convId || '', fallbackModel);
          if (sanitizeUnsignedToolCalls(fbContents)) {
            injectAntiHallucinationInstruction((reqJson.request as Record<string, unknown>) || reqJson);
          }
        }
      }
      normalizeConversationTurns(fbContents);
    }

    const sessionKey = convId || sessId;
    const existingFallback = sessionKey ? getSessionModelFallback(sessionKey) : undefined;
    const alreadyNotified = existingFallback?.notified === true;

    if (process.env.AG_ENABLE_FALLBACK_NOTICE === '1' && isStream && !res.writableEnded && !res.destroyed && !alreadyNotified) {
      if (!res.headersSent) {
        safeWriteHead(res, 200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
      }
      const isClaude = currentBase.toLowerCase().includes('claude');
      const fbNotice = isClaude
        ? `> 🔄 **Quota Claude atteint** — Poursuite automatique avec **${fallbackModel}**.\n\n`
        : `> 🔄 **Modèle temporairement indisponible** — Poursuite automatique avec **${fallbackModel}**.\n\n`;
      writeSafeSseChunk(res, {
        response: { candidates: [{ content: { parts: [{ text: fbNotice }], role: 'model' }, index: 0 }] },
      });
    }

    try {
      const nextAttempted = new Set(attemptedModels);
      nextAttempted.add(fallbackModel.toLowerCase());
      nextAttempted.add(fallbackModel);
      const fallbackOk = await poolExecutor(
        req,
        res,
        reqJson,
        fallbackPool,
        isSessionRemote,
        convId,
        sessId,
        nextAttempted,
        fallbackDepth + 1,
      );
      if (fallbackOk) {
        if (sessionKey) {
          const existing = getSessionModelFallback(sessionKey);
          if (existing && normalizeCloudCodeModelId(fallbackModel).toLowerCase() === normalizeCloudCodeModelId(existing.originalModel).toLowerCase()) {
            clearSessionModelFallback(sessionKey);
          } else {
            setSessionModelFallback(sessionKey, currentBase, fallbackModel, true);
          }
        }
        log.info(`[Proxy] ✅ [Model Fallback] Cross-model fallback to ${fallbackModel} SUCCEEDED!`);
        return true;
      }
    } catch (fbErr) {
      log.warn(`[Proxy] Fallback to ${fallbackModel} failed:`, (fbErr as Error).message);
    }
  }

  return false;
}
