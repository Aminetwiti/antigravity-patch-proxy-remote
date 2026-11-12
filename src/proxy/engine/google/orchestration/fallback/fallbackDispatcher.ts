import log from 'electron-log';
import type { FallbackParams } from './types';
import { loadCustomModels } from '../../../../models/catalog/modelLoader';
import { expandModelsWithEffort } from '../../../transforms/effortExpander';
import { getOpenBreaker } from '../../../../resilience/circuit/circuitBreaker';
import { normalizeCloudCodeModelId } from '../../../../../services/auth/googleAuth';
import { attemptCrossModelFallback } from './crossModelFallback';
import { attemptExternalCascade } from './externalCascade';

export async function attemptFallbackCascade(params: FallbackParams): Promise<boolean> {
  const { reqJson, attemptedModels, fallbackDepth, res, lastErrorText, targetRaw } = params;

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

  if (allowCrossModelFallback && attemptedModels.size <= 1) {
    const crossSuccess = await attemptCrossModelFallback(params, allCustomModels, currentBase, isClaudeRequest);
    if (crossSuccess) return true;
  }

  return attemptExternalCascade(
    params,
    allCustomModels,
    currentBase,
    allowCrossModelFallback,
    isClaudeRequest,
    isPreconditionLocationError,
  );
}
