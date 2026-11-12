import { randomInt } from 'crypto';
import type { CustomModel } from '../../../core/types';
import { P2C_SCORE_DELTA } from '../../../../constants';
import { isGoogleCloudCodeModel, normalizeCloudCodeModelId } from '../../../../services/auth/googleAuth';
import { getBaseModelId } from '../../../core/urlBuilder';
import { getOpenBreaker } from '../../circuitBreaker';
import { getAccountQuotaKey } from '../identity/accountKeys';
import { isAccountUnlicensed, isAccountTrial } from '../identity/licensing';
import { isAccountInCooldown } from '../cooldown/cooldownRegistry';
import { isAccountInProbation } from '../cooldown/probationRegistry';
import { getAccountInFlight, MAX_CONCURRENT_PER_ACCOUNT } from '../concurrency/inFlightManager';
import { getAccountLastUsed } from '../concurrency/rateLimiter';
import { getModelQuotaScore, isAccountNearExhaustion, getAccountDynamicScore } from './scoring';

export function selectCandidateP2C(candidates: CustomModel[], modelFamily = 'gemini'): CustomModel | undefined {
  if (!candidates || candidates.length === 0) return undefined;
  if (candidates.length === 1) {
    const single = candidates[0];
    if (
      (single as any).enabled === false ||
      (single as any).isValidationRequired === true ||
      (single as any).status === 'validation_required' ||
      (single as any).errorDetails?.status === 'VALIDATION_REQUIRED' ||
      isAccountUnlicensed(single) ||
      isAccountInCooldown(single, modelFamily) ||
      getOpenBreaker(single) ||
      getModelQuotaScore(single, modelFamily) <= 0
    ) {
      return undefined;
    }
    return single;
  }

  const fam = (modelFamily || '').toLowerCase();
  const isRestrictedTarget = fam.includes('argon') || fam.includes('claude-5-5') || fam.includes('claude-5.5') || fam.includes('5.5') || fam.includes('5-5');

  const available = candidates.filter(
    (m) =>
      (m as any).enabled !== false &&
      (m as any).isValidationRequired !== true &&
      (m as any).status !== 'validation_required' &&
      (m as any).errorDetails?.status !== 'VALIDATION_REQUIRED' &&
      !isAccountInCooldown(m, modelFamily) &&
      !getOpenBreaker(m) &&
      !isAccountUnlicensed(m)
  );
  const tierFiltered = isRestrictedTarget
    ? available.filter((m) => !isAccountTrial(m))
    : available;
  const targetCandidates = tierFiltered.length > 0 ? tierFiltered : available;

  if (targetCandidates.length === 0) return undefined;

  const availableWithQuota = targetCandidates.filter((m) => getModelQuotaScore(m, modelFamily) > 0);
  if (availableWithQuota.length === 0) return undefined;
  const pool = availableWithQuota;
  if (pool.length === 0) return undefined;

  const freePool = pool.filter(
    (m) => getAccountInFlight(m) < (isAccountInProbation(m, modelFamily) ? 1 : MAX_CONCURRENT_PER_ACCOUNT),
  );
  const targetPool = freePool.length > 0 ? freePool : pool;
  if (targetPool.length === 1) return targetPool[0];

  const nonExhausted = targetPool.filter((m) => !isAccountNearExhaustion(m, modelFamily));
  const candidatePool = nonExhausted.length > 0 ? nonExhausted : targetPool;
  if (candidatePool.length === 1) return candidatePool[0];

  const sorted = [...candidatePool].sort((a, b) => getAccountDynamicScore(b, modelFamily) - getAccountDynamicScore(a, modelFamily));
  const topScore = getAccountDynamicScore(sorted[0], modelFamily);

  const delta = typeof P2C_SCORE_DELTA === 'number' ? P2C_SCORE_DELTA : 45;
  const topTier = sorted.filter((m) => {
    const s = getAccountDynamicScore(m, modelFamily);
    if (topScore > 0 && s <= 0) return false;
    return topScore - s <= delta;
  });
  if (topTier.length <= 1) {
    return sorted[0];
  }

  const i = randomInt(topTier.length);
  let j = randomInt(topTier.length - 1);
  if (j >= i) j++;

  const candA = topTier[i];
  const candB = topTier[j];

  const lastA = getAccountLastUsed(candA);
  const lastB = getAccountLastUsed(candB);

  if (lastA !== lastB) {
    return lastA < lastB ? candA : candB;
  }

  const scoreA = getAccountDynamicScore(candA, modelFamily);
  const scoreB = getAccountDynamicScore(candB, modelFamily);

  return scoreA >= scoreB ? candA : candB;
}

let roundRobinCounter = 0;

export function selectBestModelByQuota(
  candidates: CustomModel[],
  allModels?: CustomModel[],
  modelFamily = 'gemini',
): CustomModel | undefined {
  if (!candidates || candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];

  const healthy = candidates.filter(
    (m) =>
      (m as any).enabled !== false &&
      !isAccountUnlicensed(m) &&
      !getOpenBreaker(m) &&
      !isAccountInCooldown(m, modelFamily),
  );
  const pool =
    healthy.length > 0
      ? healthy
      : candidates.filter((m) => (m as any).enabled !== false && !isAccountUnlicensed(m));
  if (pool.length === 0) return candidates[0];

  const withRefresh = pool.filter((m) => !isGoogleCloudCodeModel(m) || Boolean(m.refreshToken));
  const candidatePool = withRefresh.length > 0 ? withRefresh : pool;

  const hasCloudCodeWithQuota = candidatePool.some(
    (m) => isGoogleCloudCodeModel(m) && Boolean(m.refreshToken) && getModelQuotaScore(m, modelFamily) > 0,
  );
  const filteredCandidates = hasCloudCodeWithQuota
    ? candidatePool.filter((m) => isGoogleCloudCodeModel(m) && Boolean(m.refreshToken))
    : candidatePool;

  const withQuota = filteredCandidates.filter((m) => getModelQuotaScore(m, modelFamily) > 0);
  const candidatesToSort = withQuota.length > 0 ? withQuota : filteredCandidates;

  const sorted = [...candidatesToSort].sort(
    (a, b) => getModelQuotaScore(b, modelFamily) - getModelQuotaScore(a, modelFamily),
  );
  const topScore = getModelQuotaScore(sorted[0], modelFamily);
  const topTier = sorted.filter((m) => topScore - getModelQuotaScore(m, modelFamily) <= 5);

  if (topTier.length > 1) {
    const selected = topTier[Math.abs(roundRobinCounter++) % topTier.length];
    return selected;
  }

  return sorted[0];
}

export function getGoogleAccountPool(
  matchedModel: CustomModel,
  allModels: CustomModel[],
): CustomModel[] {
  if (!allModels || allModels.length === 0) return [matchedModel];
  const rawTarget = (matchedModel.externalModelName || matchedModel.name)
    .replace(/^models\//, '')
    .replace(/^google:/, '')
    .replace(/:auto-pool.*$/, '');
  const targetBase = getBaseModelId(rawTarget);
  const targetNorm = normalizeCloudCodeModelId(targetBase);

  const pool = allModels.filter((m) => {
    if (!isGoogleCloudCodeModel(m)) return false;
    if (m.name?.includes(':auto-pool') || m.apiKey === 'auto') return false;
    if ((m as any).enabled === false) return false;
    if ((m as any).status === 'unhealthy') return false;
    if (
      (m as any).isValidationRequired === true ||
      (m as any).status === 'validation_required' ||
      (m as any).errorDetails?.status === 'VALIDATION_REQUIRED'
    ) return false;
    if (isAccountUnlicensed(m)) return false;
    const mRaw = (m.externalModelName || m.name || (m as any).id || "")
      .replace(/^models\//, '')
      .replace(/^google:/, '')
      .replace(/:auto-pool.*$/, '');
    const mBase = getBaseModelId(mRaw);
    const mNorm = normalizeCloudCodeModelId(mBase);
    return mBase === targetBase || mNorm === targetNorm;
  });

  const seenAccounts = new Set<string>();
  const distinctPool: CustomModel[] = [];
  for (const m of pool) {
    const accKey = getAccountQuotaKey(m);
    if (!seenAccounts.has(accKey)) {
      seenAccounts.add(accKey);
      distinctPool.push(m);
    }
  }

  return distinctPool.length > 0 ? distinctPool : [matchedModel];
}
