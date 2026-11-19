import type * as http from 'http';
import log from 'electron-log';
import type { CustomModel, GeminiRequestBody } from '../../../core/types';
import { trimContextPayload } from '../../transforms/contextTrimmer';
import { trimOldestHistory } from '../../transforms/historyTrimmer';
import {
  normalizeCloudCodeModelId,
  sanitizeCloudCodeGenerationConfig,
  applyAntiTruncation,
  isGeminiCliModel,
  isTokenRevoked,
} from '../../../../services/auth/googleAuth';
import { detectAndMitigateToolLoops } from '../../../core/shared';
import {
  isPoolUnderQuotaStress,
  isAccountInCooldown,
  resolveGoogleProjectId,
} from '../../../resilience/pools/googlePool';
import { getOpenBreaker } from '../../../resilience/circuit/circuitBreaker';

/**
 * Wraps flat Gemini request (contents at root) inside reqJson.request if needed
 */
export function normalizeGeminiPayload(reqJson: Record<string, unknown>): Record<string, unknown> {
  if (!reqJson.request && Array.isArray((reqJson as any).contents)) {
    const { contents, generationConfig, tools, safetySettings, systemInstruction } = reqJson as any;
    reqJson.request = {
      contents,
      ...(generationConfig ? { generationConfig } : {}),
      ...(tools ? { tools } : {}),
      ...(safetySettings ? { safetySettings } : {}),
      ...(systemInstruction ? { systemInstruction } : {}),
    };
    delete (reqJson as any).contents;
    delete (reqJson as any).generationConfig;
    delete (reqJson as any).tools;
    delete (reqJson as any).safetySettings;
    delete (reqJson as any).systemInstruction;
  }
  return reqJson;
}

/**
 * Optimizes prompt payload by sanitizing synthetic error cards & compacting oversized historical tool outputs.
 */
export function optimizePayloadContext(reqJson: Record<string, unknown>): Record<string, unknown> {
  if (process.env.AG_DISABLE_CONTEXT_TRIMMER !== '1') {
    reqJson = trimContextPayload(reqJson as unknown as GeminiRequestBody) as unknown as Record<string, unknown>;
  }

  if (process.env.AG_PROACTIVE_TRIM_HISTORY === '1') {
    const initialContents = (reqJson.request as any)?.contents || (reqJson as any).contents;
    if (Array.isArray(initialContents) && initialContents.length > 35) {
      const turnsCount = initialContents.length;
      if (trimOldestHistory(reqJson, 30)) {
        const remainingTurns = ((reqJson.request || reqJson) as any)?.contents?.length;
        log.info(
          `[Proxy] ⚡ [Proactive Context Trimmer] Heavy session detected (${turnsCount} turns). Proactively trimmed oldest history to ${remainingTurns} turns before first network dispatch.`,
        );
      }
    }
  }

  // Detect and mitigate repetitive tool execution loops once per request before candidate rotation
  const targetContents = (reqJson.request as any)?.contents || (reqJson as any).contents;
  if (Array.isArray(targetContents)) {
    const loopMitigated = detectAndMitigateToolLoops(targetContents);
    if (loopMitigated) {
      log.warn(`[Proxy] 🛡️ [Anti-Loop Guardrail] Repetitive tool calls detected in conversation. Injected anti-loop advisory.`);
    }
  }

  return reqJson;
}

/**
 * Resolves raw and normalized model IDs from request and pool candidates
 */
export function resolveTargetModelName(
  reqJson: Record<string, unknown>,
  accountPool: CustomModel[],
  attemptedModels: Set<string>,
): { targetRaw: string; resolvedTarget: string; modelFamily: string } {
  let targetRaw = String(reqJson.model || (reqJson.request as any)?.model || '');
  if (/MODEL_PLACEHOLDER_/i.test(targetRaw) || !targetRaw) {
    const poolCandidate = accountPool?.[0]?.externalModelName || accountPool?.[0]?.name;
    if (poolCandidate) {
      targetRaw = poolCandidate;
      reqJson.model = targetRaw;
      if (reqJson.request && typeof reqJson.request === 'object') {
        (reqJson.request as Record<string, unknown>).model = targetRaw;
      }
    }
  }
  const resolvedTarget = normalizeCloudCodeModelId(targetRaw).toLowerCase();
  if (resolvedTarget) {
    reqJson.model = resolvedTarget;
    if (reqJson.request && typeof reqJson.request === 'object') {
      (reqJson.request as Record<string, unknown>).model = resolvedTarget;
    }
    attemptedModels.add(resolvedTarget);
  }

  const isClaude = resolvedTarget.includes('claude');
  const isSonar = resolvedTarget.includes('sonar');
  const modelFamily = isClaude ? 'claude' : (isSonar ? 'sonar' : 'gemini');

  return { targetRaw, resolvedTarget, modelFamily };
}

/**
 * Eco-Routing / Graceful Degradation: If pool is under severe quota stress (<15% average),
 * downgrade background / auxiliary tasks (summaries, titles) to Flash to preserve Pro quota.
 */
export function applyEcoRoutingIfEligible(
  reqJson: Record<string, unknown>,
  accountPool: CustomModel[],
  modelFamily: string,
  resolvedTarget: string,
): void {
  if (process.env.AG_ENABLE_CROSS_MODEL_FALLBACK === '1' && isPoolUnderQuotaStress(accountPool, modelFamily)) {
    const hasAnyAvailable = accountPool.some(
      (a) => !isAccountInCooldown(a, modelFamily) && !getOpenBreaker(a) && !isTokenRevoked(a.refreshToken),
    );
    const reqType = String(reqJson.requestType || (reqJson.request as any)?.requestType || '').toUpperCase();
    const isAuxiliary =
      reqType === 'CONVERSATION_TITLE' ||
      reqType === 'TITLE' ||
      reqType === 'SUMMARY' ||
      reqType === 'CONVERSATION_SUMMARY';
    const isAlreadyFlash = resolvedTarget.includes('flash') || resolvedTarget.includes('lite');
    if (isAuxiliary && !isAlreadyFlash && hasAnyAvailable) {
      log.info('[Proxy] [Eco-Routing] Pool under quota stress (<15% avg): routing auxiliary request to gemini-3.8-flash-tiered.');
      reqJson.model = 'gemini-3.8-flash-tiered';
      if (reqJson.request && typeof reqJson.request === 'object') {
        (reqJson.request as Record<string, unknown>).model = 'gemini-3.8-flash-tiered';
      }
    } else if (isAuxiliary && !hasAnyAvailable) {
      log.debug('[Proxy] [Eco-Routing] Pool fully exhausted — skipping flash redirect, fast-fail will handle it.');
    }
  }
}

/**
 * Prepares and serializes request JSON for a specific candidate account
 */
export function prepareCandidatePayload(
  reqJson: Record<string, unknown>,
  candidate: CustomModel,
  targetModel: string,
  req?: http.IncomingMessage,
): Buffer {
  reqJson.model = targetModel;
  if (typeof reqJson.requestedModel === 'string' && /MODEL_PLACEHOLDER_/i.test(reqJson.requestedModel)) {
    reqJson.requestedModel = targetModel;
  }
  if (typeof reqJson.planModel === 'string' && /MODEL_PLACEHOLDER_/i.test(reqJson.planModel)) {
    reqJson.planModel = targetModel;
  }

  const reqObj =
    reqJson.request && typeof reqJson.request === 'object'
      ? (reqJson.request as Record<string, unknown>)
      : (reqJson as Record<string, unknown>);

  if (reqJson.request && typeof reqJson.request === 'object') {
    reqObj.model = targetModel;
    if (typeof reqObj.requestedModel === 'string' && /MODEL_PLACEHOLDER_/i.test(reqObj.requestedModel)) {
      reqObj.requestedModel = targetModel;
    }
    if (typeof reqObj.planModel === 'string' && /MODEL_PLACEHOLDER_/i.test(reqObj.planModel)) {
      reqObj.planModel = targetModel;
    }
    sanitizeCloudCodeGenerationConfig(reqObj, targetModel);

    const wantsAntiTrunc =
      Boolean(req?.headers?.['x-anti-truncation']) ||
      targetModel.includes('anti-trunc') ||
      targetModel.includes('抗截断') ||
      process.env.AG_ENABLE_ANTI_TRUNCATION === '1';
    if (wantsAntiTrunc) {
      applyAntiTruncation(reqObj);
    }
  }

  reqJson.project = resolveGoogleProjectId(candidate);
  if (!isGeminiCliModel(candidate) && !reqJson.enabledCreditTypes) {
    reqJson.enabledCreditTypes = ['GOOGLE_ONE_AI'];
  }

  return Buffer.from(JSON.stringify(reqJson), 'utf-8');
}
