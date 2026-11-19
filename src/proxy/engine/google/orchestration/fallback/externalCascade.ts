import log from 'electron-log';
import type { CustomModel, GeminiRequestBody } from '../../../../core/types';
import type { FallbackParams } from './types';
import { isGoogleCloudCodeModel } from '../../../../../services/auth/googleAuth';
import { getOpenBreaker } from '../../../../resilience/circuit/circuitBreaker';
import { isProviderRateLimited } from '../../../../models/catalog/modelRouter';
import { writeSafeSseChunk } from '../../../stream/streamPipeline';
import { safeWriteHead } from '../../../../http/server/httpUtils';
import { flattenAllToolCallsToText } from '../../../../core/shared';
import {
  getSessionModelFallback,
  setSessionModelFallback,
} from '../../../../resilience/pools/sessionAffinities';

type HandleCustomModelRequestFn = (typeof import('../../../executors/customModelEngine'))['handleCustomModelRequest'];
let cachedHandleCustomModelRequest: HandleCustomModelRequestFn | null = null;

function getCustomModelHandler(): HandleCustomModelRequestFn {
  if (!cachedHandleCustomModelRequest) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('../../../executors/customModelEngine') as {
      handleCustomModelRequest: HandleCustomModelRequestFn;
    };
    cachedHandleCustomModelRequest = mod.handleCustomModelRequest;
  }
  return cachedHandleCustomModelRequest;
}

export async function attemptExternalCascade(
  params: FallbackParams,
  allCustomModels: CustomModel[],
  currentBase: string,
  allowCrossModelFallback: boolean,
  isClaudeRequest: boolean,
  isPreconditionLocationError: boolean,
): Promise<boolean> {
  const { req, res, reqJson, convId, sessId } = params;
  const isStream = req.url!.includes('streamGenerateContent') || req.url!.includes('alt=sse');

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
        let targetBody = actualGeminiBody;
        if (isAiStudio && targetBody) {
          try {
            const cloned = JSON.parse(JSON.stringify(targetBody));
            if (cloned.generationConfig) {
              delete cloned.generationConfig.thinkingConfig;
              delete cloned.generationConfig.thinking_config;
            }
            if (cloned.generation_config) {
              delete cloned.generation_config.thinkingConfig;
              delete cloned.generation_config.thinking_config;
            }
            const contents = cloned.contents || cloned.request?.contents;
            if (Array.isArray(contents)) {
              flattenAllToolCallsToText(contents);
            }
            targetBody = cloned;
          } catch (_) {}
        }
        const handler = getCustomModelHandler();
        handler(res, fallbackModel, targetBody, isStream);
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
