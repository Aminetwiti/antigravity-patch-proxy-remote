import log from 'electron-log';
import {
  GOOGLE_PROXY_TIMEOUT_MS,
  GOOGLE_POOL_HEADER_TIMEOUT_MS,
  GOOGLE_POOL_HEADER_TIMEOUT_FLASH_MS,
  GOOGLE_POOL_HEADER_TIMEOUT_LARGE_PROMPT_MS,
} from '../../../../constants';

export const MAX_POOL_LOOP_DURATION_MS = 280_000;

export interface TimeoutCalculationParams {
  targetModel: string;
  updatedBody: Buffer;
  reqJson: Record<string, unknown>;
  targetRaw: string;
  hasOtherCandidates: boolean;
  healthySiblingAccountsCount: number;
  consecutive504TimeoutCount: number;
  poolLoopStartTime: number;
  initialHealthyCount: number;
  attemptIndex: number;
}

export interface TimeoutCalculationResult {
  poolHeaderTimeout: number;
  wasTimeoutCappedByBudget: boolean;
  isFlashModel: boolean;
  isLargePayload: boolean;
  isThinkingModel: boolean;
  isContextualPayload: boolean;
  shouldHaltDueToBudget: boolean;
  haltReason?: string;
}

export function computeCandidateHeaderTimeout(params: TimeoutCalculationParams): TimeoutCalculationResult {
  const {
    targetModel,
    updatedBody,
    reqJson,
    targetRaw,
    hasOtherCandidates,
    healthySiblingAccountsCount,
    consecutive504TimeoutCount,
    poolLoopStartTime,
    initialHealthyCount,
    attemptIndex,
  } = params;

  const isFlash = /flash/i.test(targetModel);
  const candidateReqObj =
    reqJson.request && typeof reqJson.request === 'object'
      ? (reqJson.request as Record<string, unknown>)
      : undefined;
  const candidateGenConfig = (candidateReqObj?.generationConfig ||
    candidateReqObj?.generation_config ||
    reqJson?.generationConfig ||
    reqJson?.generation_config) as Record<string, unknown> | undefined;
  const hasThinkingConfig = Boolean(candidateGenConfig?.thinkingConfig || candidateGenConfig?.thinking_config);
  const reqContents = (candidateReqObj?.contents || reqJson.contents) as any[] | undefined;
  const isMultiTurn = Array.isArray(reqContents) && reqContents.length > 1;
  const isContextualPayload = updatedBody.length > 8_000 || isMultiTurn;
  const rawModelIdentifiers = `${targetModel} ${reqJson.requestedModel || ''} ${reqJson.model || ''} ${targetRaw || ''}`;
  const isThinkingModel =
    /thinking|thought|-high$|-medium$|\(medium\)|\(high\)|-tiered$|tiered/i.test(rawModelIdentifiers) ||
    hasThinkingConfig ||
    updatedBody.includes('/think-');
  const isFlashModel = isFlash;
  const isLargePayload = updatedBody.length > 60_000;
  const isLargePayloadOrThinking = isLargePayload || isThinkingModel;

  let dynamicAdaptiveTimeout: number;
  if (updatedBody.length > 150_000) {
    dynamicAdaptiveTimeout = 70_000;
  } else if (updatedBody.length > 60_000 || isThinkingModel) {
    dynamicAdaptiveTimeout = 60_000;
  } else if (isContextualPayload || updatedBody.length > 25_000) {
    dynamicAdaptiveTimeout = 45_000;
  } else {
    dynamicAdaptiveTimeout = 35_000;
  }

  const flashTimeoutMs = hasOtherCandidates
    ? healthySiblingAccountsCount >= 1
      ? isLargePayloadOrThinking
        ? Math.min(40_000, Math.max(30_000, dynamicAdaptiveTimeout))
        : dynamicAdaptiveTimeout
      : isLargePayloadOrThinking
      ? Math.max(55_000, dynamicAdaptiveTimeout)
      : dynamicAdaptiveTimeout
    : isLargePayloadOrThinking
    ? 65_000
    : Math.min(50_000, GOOGLE_PROXY_TIMEOUT_MS);

  const largeTimeoutMs = Math.min(
    isFlashModel
      ? hasOtherCandidates && healthySiblingAccountsCount >= 1
        ? isThinkingModel
          ? Math.min(60_000, Math.max(50_000, GOOGLE_POOL_HEADER_TIMEOUT_LARGE_PROMPT_MS))
          : 45_000
        : isThinkingModel
        ? updatedBody.length > 100_000
          ? 70_000
          : 65_000
        : 55_000
      : (hasOtherCandidates && healthySiblingAccountsCount >= 1
          ? Math.min(healthySiblingAccountsCount >= 2 ? 45_000 : 60_000, GOOGLE_POOL_HEADER_TIMEOUT_LARGE_PROMPT_MS)
          : 70_000),
    GOOGLE_PROXY_TIMEOUT_MS,
  );

  const standardTimeoutMs = hasOtherCandidates
    ? healthySiblingAccountsCount >= 1
      ? Math.max(GOOGLE_POOL_HEADER_TIMEOUT_MS, dynamicAdaptiveTimeout)
      : dynamicAdaptiveTimeout
    : Math.min(dynamicAdaptiveTimeout, GOOGLE_PROXY_TIMEOUT_MS);

  const baseCandidateTimeout = isFlashModel
    ? hasOtherCandidates
      ? isLargePayloadOrThinking
        ? largeTimeoutMs
        : flashTimeoutMs
      : Math.min(35_000, GOOGLE_PROXY_TIMEOUT_MS)
    : isLargePayloadOrThinking
    ? largeTimeoutMs
    : standardTimeoutMs;

  let poolHeaderTimeout = hasOtherCandidates
    ? baseCandidateTimeout
    : isFlashModel
    ? isLargePayloadOrThinking
      ? 35_000
      : flashTimeoutMs
    : Math.min(45_000, GOOGLE_PROXY_TIMEOUT_MS);

  if (consecutive504TimeoutCount > 0) {
    const flashEscalation =
      hasOtherCandidates && healthySiblingAccountsCount >= 2
        ? 35_000
        : isLargePayloadOrThinking
        ? 50_000
        : 40_000;
    const maxEscalation =
      hasOtherCandidates && healthySiblingAccountsCount >= 2
        ? isFlashModel
          ? flashEscalation
          : 45_000
        : isFlashModel
        ? isLargePayloadOrThinking
          ? 65_000
          : 45_000
        : 75_000;
    const escalatingTimeout = Math.min(maxEscalation, GOOGLE_PROXY_TIMEOUT_MS);
    if (escalatingTimeout > poolHeaderTimeout) {
      log.info(`[Proxy] Prior candidate experienced 504 timeout. Escalating candidate timeout to ${escalatingTimeout / 1000}s`);
      poolHeaderTimeout = escalatingTimeout;
    }
  }

  const remainingPoolBudgetMs = MAX_POOL_LOOP_DURATION_MS - (Date.now() - poolLoopStartTime) - 8_000;
  const minViableTimeout = isFlashModel ? 8_000 : isLargePayloadOrThinking ? 20_000 : 12_000;

  if (remainingPoolBudgetMs < minViableTimeout && attemptIndex > 0) {
    log.warn(
      `[Proxy] Remaining pool loop budget (${Math.round(remainingPoolBudgetMs / 1000)}s) is below minimum viable inference timeout (${minViableTimeout / 1000}s). Halting rotation to avoid guaranteed timeout failure.`,
    );
    return {
      poolHeaderTimeout,
      wasTimeoutCappedByBudget: true,
      isFlashModel,
      isLargePayload,
      isThinkingModel,
      isContextualPayload,
      shouldHaltDueToBudget: true,
      haltReason: 'Pool loop budget exhausted before minimum viable inference timeout',
    };
  }

  const wasTimeoutCappedByBudget = poolHeaderTimeout > remainingPoolBudgetMs;
  if (wasTimeoutCappedByBudget) {
    log.info(
      `[Proxy] Capping candidate timeout from ${Math.round(poolHeaderTimeout / 1000)}s to ${Math.round(remainingPoolBudgetMs / 1000)}s based on remaining pool loop budget`,
    );
    poolHeaderTimeout = Math.max(minViableTimeout, remainingPoolBudgetMs);
  }

  const isLowHeadroom = initialHealthyCount > 0 && initialHealthyCount <= 2;
  if (isLowHeadroom && initialHealthyCount === 2 && poolHeaderTimeout > 40_000) {
    log.info(`[Proxy] Low headroom pool (2 healthy accounts). Allocating 40s per candidate to prevent client disconnect.`);
    poolHeaderTimeout = 40_000;
  }

  return {
    poolHeaderTimeout,
    wasTimeoutCappedByBudget,
    isFlashModel,
    isLargePayload,
    isThinkingModel,
    isContextualPayload,
    shouldHaltDueToBudget: false,
  };
}
