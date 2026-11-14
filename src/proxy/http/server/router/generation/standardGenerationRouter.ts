import * as http from 'http';
import log from 'electron-log';
import { safeWriteHead, safeEnd } from '../../httpUtils';
import { CustomModel, GeminiRequestBody } from '../../../../core/types';
import { expandModelsWithEffort } from '../../../../engine/transforms/effortExpander';
import { loadCustomModels } from '../../../../models/catalog/modelLoader';
import {
  isNativeCloudCodeModel,
  normalizeCloudCodeModelId,
  normalizeGoogleModelId,
  matchesCustomModel,
} from '../../../../models/catalog/modelUtils';
import { getBaseModelId } from '../../../../core/urlBuilder';
import { selectBestModelByQuota } from '../../../../resilience/pools/googlePool';
import { getOpenBreaker } from '../../../../resilience/circuit/circuitBreaker';
import { normalizeConversationTurns, isGoogleCloudCodeModel, sanitizeCloudCodeGenerationConfig } from '../../../../../services/auth/googleAuth';
import { extractSessionId, getSessionBoundModel, bindSessionToModel } from '../../../../resilience/pools/sessionAffinities';
import { resolveFileData } from '../../../../engine/transforms/historyTrimmer';
import { getGoogleAccountPool } from '../../../../resilience/pools/googlePool';
import { executeGoogleCloudCodeWithPool } from '../../../../engine/googleCloudEngine';
import { handleCustomModelRequest } from '../../../../engine/executors/customModelEngine';

export async function handleStandardGenerationRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  bodyStr: string,
  convId: string | null,
  sessId: string,
): Promise<boolean> {
  const generateMatch = req.url!.match(/\/(?:v1|v1beta)\/(models\/[^:]+):generateContent/);
  const streamMatch = req.url!.match(/\/(?:v1|v1beta)\/(models\/[^:]+):streamGenerateContent/);

  const isGenerate = !!generateMatch;
  const isStandardStream = !!streamMatch;

  if (!(req.method === 'POST' && (isGenerate || isStandardStream))) {
    return false;
  }

  const matchedModelName = isGenerate ? generateMatch![1] : streamMatch![1];
  const isNative = !matchedModelName.startsWith('custom-') && isNativeCloudCodeModel(matchedModelName);
  let matchedCustomModel: CustomModel | undefined;

  const customModels = expandModelsWithEffort(loadCustomModels());
  if (isNative) {
    const googlePoolCandidates = customModels.filter(
      (m) => (m.provider === 'google' || m.apiKey === 'auto') &&
             m.enabled !== false &&
             !(m as any)._poolOnly
    );
    const cleanMatched = matchedModelName.replace(/^models\//, '').toLowerCase();
    const normMatched = normalizeCloudCodeModelId(cleanMatched);
    const matchedPool = googlePoolCandidates.filter((m) => {
      const mTarget = (m.externalModelName || m.name || (m as any).id || '').replace(/^models\//, '').toLowerCase();
      return mTarget === cleanMatched || (normMatched && normalizeCloudCodeModelId(mTarget) === normMatched);
    });
    if (matchedPool.length > 0 && process.env.AG_POOL_NATIVE_MODELS === '1') {
      log.info(`[Proxy] Routing native model [${matchedModelName}] on direct URL through Google multi-account pool.`);
      matchedCustomModel = selectBestModelByQuota(matchedPool, customModels);
    } else {
      log.info(`[Proxy] Native Antigravity model requested on direct URL [${matchedModelName}]. Bypassing multi-account pool.`);
    }
  } else {
    let matchingCandidates = customModels.filter((m) =>
      matchesCustomModel(m, matchedModelName),
    );
    if (matchingCandidates.length === 0) {
      const norm = normalizeGoogleModelId(matchedModelName);
      if (norm) {
        matchingCandidates = customModels.filter((m) =>
          matchesCustomModel(m, norm) || matchesCustomModel(m, `models/${norm}`),
        );
      }
    }
    const directFam = (matchedModelName || '').toLowerCase().includes('claude') ? 'claude' : 'gemini';
    matchedCustomModel = selectBestModelByQuota(matchingCandidates, customModels, directFam);
    if (!matchedCustomModel && /MODEL_PLACEHOLDER_/i.test(matchedModelName)) {
      const activePool = customModels.filter((m) => !(m as any)._poolOnly && m.enabled !== false);
      matchedCustomModel = selectBestModelByQuota(activePool.length > 0 ? activePool : customModels, customModels, directFam) || activePool[0] || customModels[0];
    }

    if (matchedCustomModel && matchedCustomModel.apiKey === 'auto') {
      const baseName = getBaseModelId(matchedCustomModel.externalModelName || matchedCustomModel.name);
      const baseNorm = normalizeCloudCodeModelId(baseName);
      const realSiblings = customModels.filter((m) => {
        if (m.apiKey === 'auto' || getOpenBreaker(m)) return false;
        const mBase = getBaseModelId(m.externalModelName || m.name);
        const mNorm = normalizeCloudCodeModelId(mBase);
        return mBase === baseName || (baseNorm && mNorm === baseNorm);
      });
      matchedCustomModel = selectBestModelByQuota(realSiblings, customModels, directFam) || matchedCustomModel;
    }
  }

  if (matchedCustomModel) {
    try {
      const geminiBody = JSON.parse(bodyStr) as GeminiRequestBody;
      if (Array.isArray(geminiBody.contents)) {
        normalizeConversationTurns(geminiBody.contents);
      }

      const activeSessId = extractSessionId(geminiBody as Record<string, unknown>, req.headers as Record<string, unknown>);
      if (activeSessId) {
        matchedCustomModel = getSessionBoundModel(activeSessId, matchedCustomModel, customModels);
        bindSessionToModel(activeSessId, matchedCustomModel);
      }

      resolveFileData(geminiBody, req.headers as Record<string, string | string[] | undefined>).then(async () => {
        if (isGoogleCloudCodeModel(matchedCustomModel)) {
          try {
            const accountPool = getGoogleAccountPool(matchedCustomModel, customModels);
            const targetModel = normalizeCloudCodeModelId(matchedCustomModel.externalModelName || matchedCustomModel.name);
            sanitizeCloudCodeGenerationConfig(geminiBody as Record<string, unknown>, targetModel);
            const cloudCodePayload = {
              project: (matchedCustomModel as { projectId?: string }).projectId || process.env.AG_CLOUD_CODE_PROJECT_ID || 'bamboo-precept-lgxtn',
              model: targetModel,
              request: geminiBody,
            };

            const origUrl = req.url;
            req.url = isStandardStream ? '/v1internal:streamGenerateContent?alt=sse' : '/v1internal:generateContent';
            await executeGoogleCloudCodeWithPool(
              req,
              res,
              cloudCodePayload,
              accountPool,
              false,
              convId || '',
              activeSessId || sessId,
            );
            req.url = origUrl;
            return;
          } catch (err) {
            log.error('[Proxy] Failed to route standard generateContent to Cloud Code natively:', err);
          }
        }

        if (matchedCustomModel.apiKey === 'auto' || matchedCustomModel.name?.includes(':auto-pool')) {
          if (!res.headersSent && !res.writableEnded) {
            safeWriteHead(res, 503, { 'Content-Type': 'application/json' });
            safeEnd(res, JSON.stringify({ error: { message: 'All Google Cloud Code accounts are currently unavailable or in cooldown.' } }));
          }
          return;
        }

        handleCustomModelRequest(res, matchedCustomModel, geminiBody, isStandardStream);
      });
      return true;
    } catch (e) {
      log.error('[Proxy] JSON parse error in request body:', e);
      if (safeWriteHead(res, 400, { 'Content-Type': 'application/json' })) {
        safeEnd(res, JSON.stringify({ error: { message: 'Invalid JSON request body' } }));
      }
      return true;
    }
  }

  return false;
}
