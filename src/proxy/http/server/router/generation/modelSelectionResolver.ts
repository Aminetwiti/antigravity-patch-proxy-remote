import { CustomModel } from '../../../../core/types';
import {
  matchesCustomModel,
  normalizeCloudCodeModelId,
  normalizeGoogleModelId,
} from '../../../../models/catalog/modelUtils';
import { getBaseModelId } from '../../../../core/urlBuilder';
import { selectBestModelByQuota } from '../../../../resilience/pools/googlePool';
import { getOpenBreaker } from '../../../../resilience/circuit/circuitBreaker';
import log from 'electron-log';

export function resolveCloudCodeCustomModel(
  cleanRequested: string,
  requestedRaw: string,
  candidateNames: string[],
  inheritedEffort: string,
  isNativeCloudCode: boolean,
  customModels: CustomModel[],
): { matchedCustomModel?: CustomModel; isClaudeRequest: boolean; effectiveModelName: string } {
  let matchingCandidates: CustomModel[] = [];
  let isNativeRoutedToPool = false;

  if (isNativeCloudCode) {
    const googlePoolCandidates = customModels.filter(
      (m) => (m.provider === 'google' || m.apiKey === 'auto') &&
             m.enabled !== false &&
             !(m as any)._poolOnly
    );
    if (googlePoolCandidates.length > 0 && process.env.AG_POOL_NATIVE_MODELS !== '0') {
      const normReq = normalizeCloudCodeModelId(cleanRequested);
      const matchedPool = googlePoolCandidates.filter((m) => {
        const mTarget = (m.externalModelName || m.name || (m as any).id || '').replace(/^models\//, '').toLowerCase();
        return mTarget === cleanRequested.toLowerCase() ||
               (normReq && normalizeCloudCodeModelId(mTarget) === normReq);
      });
      let effectivePool = matchedPool;
      if (inheritedEffort && matchedPool.some((m) => (m._effortSuffix || m.reasoningEffort || '').toLowerCase().includes(inheritedEffort))) {
        effectivePool = matchedPool.filter((m) => (m._effortSuffix || m.reasoningEffort || '').toLowerCase().includes(inheritedEffort));
      }
      if (effectivePool.length > 0) {
        log.info(`[Proxy] ?? Routing native model [${requestedRaw}] through Google multi-account pool (${effectivePool.length} candidate(s))${inheritedEffort ? ` [Inherited Effort: ${inheritedEffort}]` : ''}.`);
        matchingCandidates = effectivePool;
        isNativeRoutedToPool = true;
      } else {
        log.info(`[Proxy] ? Native Antigravity model requested [${requestedRaw}]. Bypassing multi-account pool and transparently proxying to Google. (Strict: NO fallback on failure/quota).`);
      }
    } else {
      log.info(`[Proxy] ? Native Antigravity model requested [${requestedRaw}]. Bypassing multi-account pool and transparently proxying to Google. (Strict: NO fallback on failure/quota).`);
    }
  } else {
    let candidates = customModels.filter((m) => matchesCustomModel(m, cleanRequested));
    if (inheritedEffort && candidates.some((m) => (m._effortSuffix || m.reasoningEffort || '').toLowerCase().includes(inheritedEffort))) {
      candidates = candidates.filter((m) => (m._effortSuffix || m.reasoningEffort || '').toLowerCase().includes(inheritedEffort));
    }
    matchingCandidates = candidates;
    if (matchingCandidates.length === 0) {
      for (const cn of candidateNames) {
        let matched = customModels.filter((m) => matchesCustomModel(m, cn));
        if (inheritedEffort && matched.some((m) => (m._effortSuffix || m.reasoningEffort || '').toLowerCase().includes(inheritedEffort))) {
          matched = matched.filter((m) => (m._effortSuffix || m.reasoningEffort || '').toLowerCase().includes(inheritedEffort));
        }
        if (matched.length > 0) {
          matchingCandidates = matched;
          break;
        }
      }
    }
    if (matchingCandidates.length === 0) {
      for (const cn of candidateNames) {
        if (/MODEL_PLACEHOLDER_/i.test(cn) || cn.startsWith('custom-')) continue;
        const norm = normalizeGoogleModelId(cn);
        if (norm) {
          const matched = customModels.filter((m) => matchesCustomModel(m, norm) || matchesCustomModel(m, `models/${norm}`));
          if (matched.length > 0) {
            matchingCandidates = matched;
            break;
          }
        }
      }
    }
  }

  const targetFam = (cleanRequested || candidateNames[0] || '').toLowerCase().includes('claude') ? 'claude' : 'gemini';
  let matchedCustomModel = (isNativeCloudCode && !isNativeRoutedToPool) ? undefined : selectBestModelByQuota(matchingCandidates, customModels, targetFam);

  if (!isNativeCloudCode && !matchedCustomModel && candidateNames.some((cn) => /MODEL_PLACEHOLDER_/i.test(cn))) {
    const activePool = customModels.filter((m) => !(m as any)._poolOnly && m.enabled !== false);
    matchedCustomModel = selectBestModelByQuota(activePool.length > 0 ? activePool : customModels, customModels, targetFam) || activePool[0] || customModels[0];
  }

  const effectiveModelName = (
    matchedCustomModel?.externalModelName ||
    matchedCustomModel?.name ||
    candidateNames[0] ||
    ''
  ).toLowerCase();
  const isClaudeRequest = effectiveModelName.includes('claude');

  if (matchedCustomModel && (matchedCustomModel.apiKey === 'auto' || matchedCustomModel.name.includes(':auto-pool'))) {
    const rawTarget = (matchedCustomModel.externalModelName || matchedCustomModel.name)
      .replace(/^models\//, '')
      .replace(/^google:/, '')
      .replace(/:auto-pool.*$/, '');
    const baseName = getBaseModelId(rawTarget);
    const baseNorm = normalizeCloudCodeModelId(baseName);
    const targetEffort = matchedCustomModel._effortSuffix || matchedCustomModel.reasoningEffort || '';
    const realSiblings = customModels.filter((m) => {
      if (m.apiKey === 'auto' || m.name.includes(':auto-pool') || getOpenBreaker(m)) return false;
      const mRaw = (m.externalModelName || m.name)
        .replace(/^models\//, '')
        .replace(/^google:/, '')
        .replace(/:auto-pool.*$/, '');
      const mBase = getBaseModelId(mRaw);
      const mNorm = normalizeCloudCodeModelId(mBase);
      const mEffort = m._effortSuffix || m.reasoningEffort || '';
      return (mBase === baseName || (baseNorm && mNorm === baseNorm)) && mEffort === targetEffort;
    });
    matchedCustomModel = selectBestModelByQuota(realSiblings, customModels, isClaudeRequest ? 'claude' : 'gemini') || matchedCustomModel;
  }

  return { matchedCustomModel, isClaudeRequest, effectiveModelName };
}
