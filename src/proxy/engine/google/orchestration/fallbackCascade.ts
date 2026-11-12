import type * as http from 'http';
import log from 'electron-log';
import type { CustomModel, GeminiRequestBody } from '../../../core/types';
import { loadCustomModels } from '../../../models/modelLoader';
import { expandModelsWithEffort } from '../../effortExpander';
import { getOpenBreaker } from '../../../resilience/circuitBreaker';
import { isProviderRateLimited } from '../../../models/modelRouter';
import {
  normalizeCloudCodeModelId,
  isGoogleCloudCodeModel,
  isAccountEntitledToClaude55,
  sanitizeCloudCodeGenerationConfig,
  normalizeConversationTurns,
} from '../../../../services/auth/googleAuth';
import {
  getModelQuotaScore,
  selectBestModelByQuota,
  getGoogleAccountPool,
  isAccountUnlicensed,
  isAccountInCooldown,
} from '../../../resilience/googlePool';
import {
  restoreThoughtSignatures,
  flattenAllToolCallsToText,
  sanitizeUnsignedToolCalls,
} from '../../../core/shared';
import {
  writeSafeSseChunk,
  injectAntiHallucinationInstruction,
} from '../../streamPipeline';
import { safeWriteHead } from '../../../http/httpUtils';
import {
  getSessionModelFallback,
  setSessionModelFallback,
  clearSessionModelFallback,
} from '../../../resilience/sessionAffinities';
import { handleCustomModelRequest } from '../../customModelEngine';

export interface FallbackParams {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  reqJson: Record<string, unknown>;
  accountPool: CustomModel[];
  isSessionRemote: boolean;
  convId: string;
  sessId: string | null;
  attemptedModels: Set<string>;
  fallbackDepth: number;
  lastStatus: number;
  lastErrorText: string;
  targetRaw: string;
  poolExecutor: (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    reqJson: Record<string, unknown>,
    fallbackPool: CustomModel[],
    isSessionRemote: boolean,
    convId: string,
    sessId: string | null,
    nextAttempted: Set<string>,
    fallbackDepth: number,
  ) => Promise<boolean>;
}

export async function attemptFallbackCascade(params: FallbackParams): Promise<boolean> {
  const {
    req,
    res,
    reqJson,
    isSessionRemote,
    convId,
    sessId,
    attemptedModels,
    fallbackDepth,
    lastStatus,
    lastErrorText,
    targetRaw,
    poolExecutor,
  } = params;

  const allowCrossModelFallback = process.env.AG_ENABLE_CROSS_MODEL_FALLBACK !== '0';
  const allCustomModels = expandModelsWithEffort(loadCustomModels(true));
  const currentBase = normalizeCloudCodeModelId((reqJson.model as string) || (reqJson.request as any)?.model || '');
  if (currentBase) attemptedModels.add(currentBase.toLowerCase());
  const isClaudeRequest = currentBase.toLowerCase().includes('claude');

  const aiStudioRecoveryModels = allCustomModels.filter(
    (m) =>
      m.provider === 'google-gemini' &&
      !m._poolOnly &&
      !getOpenBreaker(m) &&
      m.apiKey &&
      m.apiKey !== 'auto',
  );

  const isPreconditionLocationError = /location is not supported|user location|unsupported region/i.test(lastErrorText);
  const canAttemptSameFamilyRecovery = !isClaudeRequest && aiStudioRecoveryModels.length > 0;
  const canAttemptFallback =
    fallbackDepth === 0 &&
    attemptedModels.size <= 3 &&
    !res.writableEnded &&
    !res.destroyed &&
    (allowCrossModelFallback || canAttemptSameFamilyRecovery || isPreconditionLocationError);

  if (!canAttemptFallback && !allowCrossModelFallback) {
    log.warn(`[Proxy] Strict model locking: Cross-model fallback disabled for [${targetRaw}].`);
    return false;
  }
  if (!canAttemptFallback) return false;

  const isStream = req.url!.includes('streamGenerateContent') || req.url!.includes('alt=sse');

  if (allowCrossModelFallback && attemptedModels.size <= 1) {
    if (attemptedModels.size > 3) {
      log.warn(`[Proxy] Agent resilience: Max fallback depth reached (${attemptedModels.size} models).`);
      return false;
    }

    const allModelBases: string[] = [
      ...new Set<string>(
        allCustomModels
          .filter((m) => isGoogleCloudCodeModel(m) && !getOpenBreaker(m) && m.apiKey !== 'auto')
          .map((m) => normalizeCloudCodeModelId(m.externalModelName || m.name))
          .filter((b): b is string => Boolean(b && !b.includes('3.7') && !b.includes('3.6') && !attemptedModels.has(b.toLowerCase()) && !attemptedModels.has(b))),
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
  }

  const nonGoogleFallbacks = allCustomModels.filter(
    (m) =>
      (m.provider !== 'google' || !isGoogleCloudCodeModel(m)) &&
      (!m._poolOnly || m.provider === 'google-gemini') &&
      !getOpenBreaker(m) &&
      m.apiKey !== 'auto' &&
      (allowCrossModelFallback || (!isClaudeRequest && m.provider === 'google-gemini') || isPreconditionLocationError),
  );

  if (nonGoogleFallbacks.length > 0) {
    const aiStudioFallbacks = nonGoogleFallbacks.filter((m) => m.provider === 'google-gemini');
    const otherFallbacks = nonGoogleFallbacks.filter((m) => m.provider !== 'google-gemini');
    const orderedFallbacks = [...aiStudioFallbacks, ...otherFallbacks];

    const sessionKey = convId || sessId;
    const existingFallback = sessionKey ? getSessionModelFallback(sessionKey) : undefined;
    const alreadyNotified = existingFallback?.notified === true;
    const actualGeminiBody = (reqJson.request as GeminiRequestBody) || (reqJson as unknown as GeminiRequestBody);

    for (let fi = 0; fi < orderedFallbacks.length; fi++) {
      const fallbackModel = orderedFallbacks[fi];
      const isAiStudio = fallbackModel.provider === 'google-gemini';

      if (isProviderRateLimited(fallbackModel.apiUrl)) continue;

      log.warn(
        `[Proxy] 🔀 [Account Cascade] Cascading to ${isAiStudio ? 'Google AI Studio' : fallbackModel.provider} [${fallbackModel.displayName || fallbackModel.name}]...`,
      );

      if (process.env.AG_ENABLE_FALLBACK_NOTICE === '1' && fi === 0 && isStream && !res.writableEnded && !res.destroyed && !alreadyNotified) {
        if (!res.headersSent) {
          safeWriteHead(res, 200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          });
        }
        const notice = isAiStudio
          ? `> 🔄 **Pool Cloud Code saturé** — Poursuite avec **Google AI Studio** (${fallbackModel.displayName || fallbackModel.name}).\n\n`
          : `> 🌐 **Pool Google saturé** — Poursuite avec **${fallbackModel.displayName || fallbackModel.name}** (${fallbackModel.provider}).\n\n`;
        writeSafeSseChunk(res, {
          response: { candidates: [{ content: { parts: [{ text: notice }], role: 'model' }, index: 0 }] },
        });
      }

      try {
        handleCustomModelRequest(res, fallbackModel, actualGeminiBody, isStream);
        if (sessionKey && fi === 0) {
          setSessionModelFallback(sessionKey, currentBase, fallbackModel.displayName || fallbackModel.name, true);
        }
        return true;
      } catch (tpErr) {
        log.warn(`[Proxy] Fallback to ${fallbackModel.name} failed: ${(tpErr as Error).message}`);
        if (res.writableEnded || res.destroyed) return true;
      }
    }
  }

  return false;
}
