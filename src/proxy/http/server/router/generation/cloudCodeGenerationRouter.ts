import * as http from 'http';
import log from 'electron-log';
import { safeWriteHead, safeEnd } from '../../httpUtils';
import { CustomModel, GeminiRequestBody } from '../../../../core/types';
import { expandModelsWithEffort } from '../../../../engine/transforms/effortExpander';
import { loadCustomModels } from '../../../../models/catalog/modelLoader';
import {
  extractSessionId,
  getSessionBoundModel,
  bindSessionToModel,
  getSessionEffortAffinity,
  getSessionModelFallback,
  setSessionModelFallback,
} from '../../../../resilience/pools/sessionAffinities';
import { matchesCustomModel, clampSubagentReasoning } from '../../../../models/catalog/modelUtils';
import { normalizeConversationTurns } from '../../../../../services/auth/googleAuth';
import { sanitizeCloudCodeGenerationConfig, isGoogleCloudCodeModel } from '../../../../../services/auth/googleAuth';
import { isConvCorruptedSignatures } from '../../../../core/shared';
import { flattenAllToolCallsToText, restoreThoughtSignatures, sanitizeUnsignedToolCalls } from '../../../../core/shared';
import { injectAntiHallucinationInstruction } from '../../../../engine/stream/streamPipeline';
import { resolveFileData } from '../../../../engine/transforms/historyTrimmer';
import { getGoogleAccountPool } from '../../../../resilience/pools/googlePool';
import { normalizeCloudCodeModelId } from '../../../../../services/auth/googleAuth';
import { executeGoogleCloudCodeWithPool } from '../../../../engine/googleCloudEngine';
import { handleCustomModelRequest } from '../../../../engine/executors/customModelEngine';
import { handleNativeCascadeGuard } from './nativeCascadeGuard';
import { resolveCloudCodeCustomModel } from './modelSelectionResolver';

export async function handleCloudCodeGenerationRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  bodyStr: string,
  isSessionRemote: boolean,
): Promise<{ handled: boolean; convId: string | null; sessId: string }> {
  let convId: string | null = null;
  let sessId = '';
  const isCloudCodeStream =
    (req.url!.includes('v1internal') || req.url!.includes('cloudcode')) &&
    (req.url!.includes('streamGenerateContent') || req.url!.includes('generateContent'));

  if (!(req.method === 'POST' && isCloudCodeStream)) {
    return { handled: false, convId, sessId };
  }

  try {
    const reqJson = JSON.parse(bodyStr) as Record<string, unknown>;
    const targetReq = (reqJson.request || reqJson) as Record<string, unknown>;

    if (targetReq.systemInstruction && typeof targetReq.systemInstruction === 'object') {
      const si = targetReq.systemInstruction as { parts?: Array<{ text?: string }> };
      const fullSysText = (si.parts || []).map((p) => p.text || '').join('\n');
      const match = fullSysText.match(/Conversation ID:\s*([a-f0-9\-]+)/i);
      if (match) convId = match[1];
    }

    const candidateNames = [
      reqJson.model,
      reqJson.selectedModel,
      reqJson.requestedModel,
      reqJson.modelId,
      reqJson.model_id,
      reqJson.agentModel,
      targetReq.model,
      targetReq.selectedModel,
      targetReq.requestedModel,
      targetReq.modelId,
      targetReq.model_id,
      targetReq.agentModel,
    ].filter((x): x is string => typeof x === 'string' && Boolean(x));

    const isInputDetection = candidateNames.some((cn) =>
      /2[_\-]5[_\-]flash[_\-]lite|flash[_\-]lite|input[_\-]detect/i.test(cn) ||
      /MODEL_GOOGLE_GEMINI_2_5_FLASH_LITE/i.test(cn)
    );
    if (isInputDetection) {
      const detectedSess = extractSessionId(targetReq, req.headers as Record<string, unknown>) || '';
      log.info(`[Proxy] Mock resolution for input-detection model call [model=${candidateNames[0] || 'input-detect'}${detectedSess ? ` session=${detectedSess}` : ''}]`);
      const isStream = req.url!.includes('streamGenerateContent') || req.url!.includes('alt=sse');
      if (isStream) {
        if (safeWriteHead(res, 200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        })) {
          const mockChunk = JSON.stringify({
            response: {
              candidates: [
                {
                  content: { role: 'model', parts: [{ text: '' }] },
                  finishReason: 'STOP',
                },
              ],
            },
          });
          safeEnd(res, `data: ${mockChunk}\n\ndata: [DONE]\n\n`);
        }
      } else {
        if (safeWriteHead(res, 200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
        })) {
          safeEnd(res, JSON.stringify({
            response: {
              candidates: [
                {
                  content: { role: 'model', parts: [{ text: '' }] },
                  finishReason: 'STOP',
                },
              ],
            },
          }));
        }
      }
      return { handled: true, convId, sessId: detectedSess };
    }

    const customModels = expandModelsWithEffort(loadCustomModels());
    let actualGeminiBody: GeminiRequestBody | undefined;
    let sessionKey = '';
    let isAuxiliaryReq = false;
    let auxiliaryType = '';

    if (candidateNames.length > 0) {
      actualGeminiBody = (reqJson.request || reqJson) as GeminiRequestBody;
      sessId = extractSessionId(actualGeminiBody as Record<string, unknown>, req.headers as Record<string, unknown>) || '';
      sessionKey = convId || sessId;

      const rType = String(
        targetReq.requestType ||
        reqJson.requestType ||
        (targetReq as any).type ||
        ''
      ).toUpperCase();
      if (
        rType === 'CONVERSATION_TITLE' ||
        rType === 'TITLE' ||
        rType === 'SUMMARY' ||
        rType === 'CONVERSATION_SUMMARY' ||
        rType === 'SEARCH' ||
        rType === 'INDEX' ||
        rType === 'CORTEX' ||
        rType === 'SONAR'
      ) {
        isAuxiliaryReq = true;
        auxiliaryType = rType;
      } else {
        const siText = (targetReq.systemInstruction as any)?.parts?.[0]?.text || '';
        if (
          /generate a (?:short |concise )?title/i.test(siText) ||
          /summarize the conversation/i.test(siText)
        ) {
          isAuxiliaryReq = true;
          auxiliaryType = /title/i.test(siText) ? 'TITLE' : 'SUMMARY';
        }
      }

      const customCandidate = candidateNames.find(
        (cn) => /MODEL_PLACEHOLDER_/i.test(cn) || cn.startsWith('custom-') || customModels.some((m) => matchesCustomModel(m, cn))
      );
      const requestedRaw = String(
        customCandidate ||
        reqJson.selectedModel ||
        targetReq.selectedModel ||
        reqJson.model ||
        targetReq.model ||
        reqJson.requestedModel ||
        targetReq.requestedModel ||
        candidateNames[0] ||
        ''
      ).toLowerCase();
      const cleanRequested = requestedRaw.replace(/^models\//, '').trim();
      const isExplicitCustom = Boolean(customCandidate);

      const cascadeResult = handleNativeCascadeGuard(
        candidateNames,
        cleanRequested,
        requestedRaw,
        isExplicitCustom,
        sessionKey,
        convId,
        sessId,
        reqJson,
        targetReq,
        res,
      );
      if (cascadeResult.blocked) {
        return { handled: true, convId, sessId };
      }

      if (sessionKey && !cascadeResult.isNativeCloudCode) {
        const allowCrossModel = process.env.AG_ENABLE_CROSS_MODEL_FALLBACK === '1';
        if (allowCrossModel) {
          const fallbackEntry = getSessionModelFallback(sessionKey);
          if (fallbackEntry && !isExplicitCustom) {
            log.info(`[Proxy] Using persistent session fallback model: [${fallbackEntry.fallbackModel}] for session [${sessionKey}]`);
            candidateNames.unshift(fallbackEntry.fallbackModel);
          } else if (isExplicitCustom) {
            const currentEntry = getSessionModelFallback(sessionKey);
            if (currentEntry) {
              const currentFb = currentEntry.fallbackModel;
              const fbModel = customModels.find((m) => matchesCustomModel(m, currentFb));
              const isFallback = fbModel ? matchesCustomModel(fbModel, cleanRequested) : false;
              const isOriginal = candidateNames.slice(1).some((cn) => {
                const origModel = customModels.find((m) => matchesCustomModel(m, cn));
                return origModel ? matchesCustomModel(origModel, currentFb) : false;
              });
              if (!isFallback && !isOriginal) {
                setSessionModelFallback(sessionKey, currentEntry.originalModel, cleanRequested);
              }
            }
          }
        }
      }

      const requestedRawEffort = String(
        customCandidate ||
        reqJson.selectedModel ||
        targetReq.selectedModel ||
        reqJson.model ||
        targetReq.model ||
        reqJson.requestedModel ||
        targetReq.requestedModel ||
        candidateNames[0] ||
        ''
      ).toLowerCase();
      const detectedExplicitEffort =
        requestedRawEffort.includes(':high') ? 'high' :
        requestedRawEffort.includes(':medium') ? 'medium' :
        requestedRawEffort.includes(':low') ? 'low' : '';
      const inheritedEffort = (!detectedExplicitEffort && !isAuxiliaryReq && (
        (sessionKey ? getSessionEffortAffinity(sessionKey) : '') ||
        (convId ? getSessionEffortAffinity(convId) : '') ||
        (sessId ? getSessionEffortAffinity(sessId) : '')
      )) || '';

      const { matchedCustomModel: resolvedModel, isClaudeRequest, effectiveModelName } = resolveCloudCodeCustomModel(
        cleanRequested,
        requestedRaw,
        candidateNames,
        inheritedEffort,
        cascadeResult.isNativeCloudCode,
        customModels,
      );
      let matchedCustomModel = resolvedModel;

      let signaturesRestored = false;
      let contentsNormalized = false;
      if (Array.isArray(targetReq.contents)) {
        if (normalizeConversationTurns(targetReq.contents)) {
          contentsNormalized = true;
        }
        if (isClaudeRequest) {
          sanitizeCloudCodeGenerationConfig(targetReq, effectiveModelName);
          contentsNormalized = true;
        } else if (sessionKey && isConvCorruptedSignatures(sessionKey)) {
          if (flattenAllToolCallsToText(targetReq.contents)) {
            contentsNormalized = true;
            normalizeConversationTurns(targetReq.contents);
            injectAntiHallucinationInstruction(targetReq);
          }
        } else {
          signaturesRestored = restoreThoughtSignatures(targetReq.contents, sessionKey, effectiveModelName);
          if (sanitizeUnsignedToolCalls(targetReq.contents)) {
            contentsNormalized = true;
            normalizeConversationTurns(targetReq.contents);
            injectAntiHallucinationInstruction(targetReq);
          }
        }
      }

      if (process.env.AG_CLAMP_SUBAGENTS === '1' && clampSubagentReasoning(targetReq)) {
        log.info(`[Proxy] Subagent detected: clamped thinking budget to 2048 tokens`);
        contentsNormalized = true;
      }

      if (!isClaudeRequest && (targetReq.tools || targetReq.toolConfig)) {
        injectAntiHallucinationInstruction(targetReq);
        contentsNormalized = true;
      }

      if (signaturesRestored || contentsNormalized) {
        log.debug(`[Proxy] Re-encoded Cloud Code request with normalized turns/signatures`);
      }

      if (matchedCustomModel) {
        const isStream = req.url!.includes('streamGenerateContent') || req.url!.includes('alt=sse');
        if (sessId) {
          matchedCustomModel = getSessionBoundModel(sessId, matchedCustomModel, customModels);
          bindSessionToModel(sessId, matchedCustomModel);
        }

        const modelEffort = matchedCustomModel.reasoningEffort;
        const modelBudget = matchedCustomModel.thinkingBudget;
        if (modelEffort || modelBudget) {
          const target = (reqJson.request || reqJson) as Record<string, any>;
          if (!target.generationConfig) target.generationConfig = {};
          if (!target.generationConfig.thinkingConfig) target.generationConfig.thinkingConfig = {};
          if (modelEffort) {
            target.generationConfig.thinkingConfig.thinkingLevel = modelEffort;
          }
          if (modelBudget && !target.generationConfig.thinkingConfig.thinkingBudget) {
            target.generationConfig.thinkingConfig.thinkingBudget = modelBudget;
          }
        }

        const auxTag = isAuxiliaryReq ? ` [Auxiliary Task: ${auxiliaryType || 'BACKGROUND'}]` : '';
        log.info(
          `[Proxy] [Incoming Request]${auxTag} Model requested: [${matchedCustomModel.displayName || matchedCustomModel.name}]${sessId ? ` (session: ${sessId})` : ''}`,
        );

        resolveFileData(actualGeminiBody, req.headers as Record<string, string | string[] | undefined>).then(async () => {
          if (isGoogleCloudCodeModel(matchedCustomModel) || matchedCustomModel.name.includes(':auto-pool') || matchedCustomModel.apiKey === 'auto') {
            try {
              const accountPool = getGoogleAccountPool(matchedCustomModel, customModels);
              const resolvedModelName = normalizeCloudCodeModelId(matchedCustomModel.externalModelName || matchedCustomModel.name);
              if (resolvedModelName) {
                reqJson.model = resolvedModelName;
                if (reqJson.request && typeof reqJson.request === 'object') {
                  (reqJson.request as Record<string, unknown>).model = resolvedModelName;
                }
              }
              await executeGoogleCloudCodeWithPool(
                req,
                res,
                reqJson,
                accountPool,
                isSessionRemote,
                sessionKey,
                sessId,
              );
              return;
            } catch (err) {
              log.error('[Proxy] Failed to execute Cloud Code request with pool, falling back to translator:', err);
            }
          }
          if (matchedCustomModel.apiKey === 'auto' || matchedCustomModel.name?.includes(':auto-pool')) {
            if (!res.headersSent && !res.writableEnded) {
              safeWriteHead(res, 503, { 'Content-Type': 'application/json' });
              safeEnd(res, JSON.stringify({ error: { message: 'All Google Cloud Code accounts are currently unavailable or in cooldown.' } }));
            }
            return;
          }

          handleCustomModelRequest(res, matchedCustomModel, actualGeminiBody, isStream);
        }).catch((err) => {
          log.error('[Proxy] Failed to resolve file data or process custom model request:', err);
          if (!res.headersSent && !res.writableEnded) {
            safeWriteHead(res, 502, { 'Content-Type': 'application/json' });
            safeEnd(res, JSON.stringify({ error: { message: `Request processing failed: ${(err as Error)?.message || err}` } }));
          }
        });
        return { handled: true, convId, sessId };
      }
    }
  } catch (err) {
    log.error('[Proxy] Failed to parse Cloud Code stream body:', err);
  }

  return { handled: false, convId, sessId };
}
