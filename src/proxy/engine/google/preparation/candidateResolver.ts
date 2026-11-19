import log from 'electron-log';
import type { CustomModel } from '../../../core/types';
import {
  isTokenRevoked,
  getLiveAccountQuota,
  isAccountEntitledToClaude55,
} from '../../../../services/auth/googleAuth';
import {
  getAccountQuotaKey,
  isAccountUnlicensed,
  isAccountInCooldown,
  isAccountInProbation,
  getAccountInFlight,
  getModelQuotaScore,
  isAccountNearExhaustion,
  getAccountDynamicScore,
  selectCandidateP2C,
  waitForAccountSlot,
  MAX_CONCURRENT_PER_ACCOUNT,
} from '../../../resilience/pools/googlePool';
import { getOpenBreaker } from '../../../resilience/circuit/circuitBreaker';
import { sessionAffinities } from '../../../resilience/pools/sessionAffinities';

export function isAccountEligible(candidate: CustomModel): boolean {
  return !(
    (candidate as any).enabled === false ||
    isAccountUnlicensed(candidate) ||
    (candidate as any).isValidationRequired === true ||
    (candidate as any).status === 'validation_required' ||
    (candidate as any).status === 'unhealthy'
  );
}

export function filterAndPrioritizeEligibleAccounts(
  accountPool: CustomModel[],
  targetRaw: string,
  resolvedTarget: string,
  reqJson: Record<string, unknown>,
  modelFamily: string,
): { eligibleAccounts: CustomModel[]; isClaude55: boolean } {
  const isClaude55 =
    targetRaw.includes('5-5') ||
    targetRaw.includes('5.5') ||
    resolvedTarget.includes('5-5') ||
    (typeof reqJson.requestedModel === 'string' &&
      (reqJson.requestedModel.includes('5.5') || reqJson.requestedModel.includes('5-5'))) ||
    (typeof reqJson.model === 'string' &&
      (reqJson.model.includes('5.5') || reqJson.model.includes('5-5')));

  const activePool = accountPool.filter((a) => {
    const qKey = getAccountQuotaKey(a);
    const liveQ = (getLiveAccountQuota(qKey) || a.quotas) as Record<string, any> | undefined;
    return (
      (a as any).enabled !== false &&
      (a as any).status !== 'unhealthy' &&
      !(a as any).isValidationRequired &&
      (a as any).status !== 'validation_required' &&
      !(a as any).isUnlicensed &&
      !liveQ?.isUnlicensed &&
      !isAccountUnlicensed(a)
    );
  });

  let eligibleAccounts =
    activePool.length > 0
      ? activePool
      : accountPool.filter((a) => (a as any).enabled !== false && !isAccountUnlicensed(a));

  if (modelFamily === 'claude') {
    const claudeCapable = eligibleAccounts.filter((a) => {
      const qKey = getAccountQuotaKey(a);
      const liveQ = (getLiveAccountQuota(qKey) || a.quotas) as Record<string, any> | undefined;
      const claudeFraction = liveQ?.claude?.remainingFraction ?? liveQ?.claudeQuota;
      if (claudeFraction !== undefined && claudeFraction <= 0) return false;
      return !isAccountInCooldown(a, 'claude') && getModelQuotaScore(a, 'claude') > 0;
    });
    eligibleAccounts = claudeCapable;
  }

  if (isClaude55) {
    const candidates55 = eligibleAccounts.filter((a) => isAccountEntitledToClaude55(a));
    const otherCandidates = eligibleAccounts.filter((a) => !isAccountEntitledToClaude55(a));
    const healthy55 = candidates55.filter(
      (a) => !isAccountInCooldown(a, modelFamily) && getModelQuotaScore(a, modelFamily) > 0,
    );
    if (healthy55.length > 0) {
      log.info(
        `[Proxy] [5.5 Routing] Prioritizing ${healthy55.length}/${candidates55.length} healthy 5.5-entitled account(s) (PARTAGE), retaining ${otherCandidates.length} account(s) as pool fallback.`,
      );
      eligibleAccounts = [...candidates55, ...otherCandidates];
    } else if (candidates55.length > 0) {
      log.warn(
        `[Proxy] [5.5 Routing] 5.5-entitled account(s) have 0% quota or are in cooldown; falling back to remaining pool (${otherCandidates.length} account(s)).`,
      );
      eligibleAccounts = [...otherCandidates, ...candidates55];
    } else {
      log.warn(`[Proxy] [5.5 Routing] No accounts auto-detected with 5.5 entitlement; falling back to full pool.`);
      eligibleAccounts = accountPool;
    }
  }

  return { eligibleAccounts, isClaude55 };
}

export function sortCandidateAccounts(
  accounts: CustomModel[],
  modelFamily: string,
  isClaude55 = false,
): CustomModel[] {
  return [...accounts].sort((a, b) => {
    const cdA = isAccountInCooldown(a, modelFamily) ? 1 : 0;
    const cdB = isAccountInCooldown(b, modelFamily) ? 1 : 0;
    if (cdA !== cdB) return cdA - cdB;

    const breakerA = getOpenBreaker(a) ? 1 : 0;
    const breakerB = getOpenBreaker(b) ? 1 : 0;
    if (breakerA !== breakerB) return breakerA - breakerB;

    const hasQuotaA = getModelQuotaScore(a, modelFamily) > 0 ? 1 : 0;
    const hasQuotaB = getModelQuotaScore(b, modelFamily) > 0 ? 1 : 0;
    if (hasQuotaA !== hasQuotaB) return hasQuotaB - hasQuotaA;

    const exhA = isAccountNearExhaustion(a, modelFamily) ? 1 : 0;
    const exhB = isAccountNearExhaustion(b, modelFamily) ? 1 : 0;
    if (exhA !== exhB) return exhA - exhB;

    const maxA = isAccountInProbation(a, modelFamily) ? 1 : MAX_CONCURRENT_PER_ACCOUNT;
    const maxB = isAccountInProbation(b, modelFamily) ? 1 : MAX_CONCURRENT_PER_ACCOUNT;
    const satA = getAccountInFlight(a) >= maxA ? 1 : 0;
    const satB = getAccountInFlight(b) >= maxB ? 1 : 0;
    if (satA !== satB) return satA - satB;

    if (isClaude55) {
      const entA = isAccountEntitledToClaude55(a) ? 1 : 0;
      const entB = isAccountEntitledToClaude55(b) ? 1 : 0;
      if (entA !== entB) {
        const scoreA = getModelQuotaScore(a, modelFamily);
        const scoreB = getModelQuotaScore(b, modelFamily);
        if (entA > entB && scoreA > 0) return -1;
        if (entB > entA && scoreB > 0) return 1;
      }
    }
    return getAccountDynamicScore(b, modelFamily) - getAccountDynamicScore(a, modelFamily);
  });
}

export function applyStickySessionAndP2C(
  sortedAccounts: CustomModel[],
  sessId: string | null,
  modelFamily: string,
): CustomModel | undefined {
  let boundAccount: CustomModel | undefined;
  const useStickySessions = process.env.AG_STICKY_GOOGLE_ACCOUNTS !== '0';

  if (sessId && useStickySessions) {
    const affinity = sessionAffinities.get(sessId);
    if (affinity) {
      boundAccount = sortedAccounts.find((m) => {
        return (
          getAccountQuotaKey(m) === affinity.accountKey &&
          (m as any).enabled !== false &&
          !isAccountUnlicensed(m) &&
          !getOpenBreaker(m) &&
          !isAccountInCooldown(m, modelFamily) &&
          !isAccountNearExhaustion(m, modelFamily) &&
          getModelQuotaScore(m, modelFamily) > 0
        );
      });
      if (boundAccount) {
        const boundIsBusy = getAccountInFlight(boundAccount) >= 1;
        const hasIdleAlternative = sortedAccounts.some(
          (m) =>
            m !== boundAccount &&
            getAccountInFlight(m) === 0 &&
            !isAccountInCooldown(m, modelFamily) &&
            getModelQuotaScore(m, modelFamily) > 0,
        );
        if (!boundIsBusy || !hasIdleAlternative) {
          const idx = sortedAccounts.indexOf(boundAccount);
          if (idx > 0) {
            sortedAccounts.splice(idx, 1);
            sortedAccounts.unshift(boundAccount);
          }
        } else {
          boundAccount = undefined;
        }
      } else {
        const boundCandidate = sortedAccounts.find((m) => getAccountQuotaKey(m) === affinity.accountKey);
        if (
          boundCandidate &&
          ((boundCandidate as any).enabled === false ||
            isAccountUnlicensed(boundCandidate) ||
            isTokenRevoked(boundCandidate.refreshToken))
        ) {
          sessionAffinities.delete(sessId);
        }
      }
    }
  }

  if (!boundAccount && sortedAccounts.length > 1) {
    const lead = selectCandidateP2C(sortedAccounts, modelFamily);
    if (lead) {
      const idx = sortedAccounts.indexOf(lead);
      if (idx > 0) {
        sortedAccounts.splice(idx, 1);
        sortedAccounts.unshift(lead);
      }
    }
  }

  return boundAccount;
}

export async function shouldSkipSaturatedCandidate(
  candidate: CustomModel,
  modelFamily: string,
  fallbackDepth: number,
  boundAccount: CustomModel | undefined,
  sortedAccounts: CustomModel[],
  busyCandidateAccounts: CustomModel[],
): Promise<boolean> {
  const baseMax = isAccountInProbation(candidate, modelFamily) ? 1 : MAX_CONCURRENT_PER_ACCOUNT;
  const maxSlots = fallbackDepth > 0 && !isAccountInProbation(candidate, modelFamily) ? baseMax + 1 : baseMax;
  if (getAccountInFlight(candidate) < maxSlots) return false;

  if (boundAccount && candidate === boundAccount) {
    await waitForAccountSlot([candidate], modelFamily, 2500);
  }
  if (getAccountInFlight(candidate) < maxSlots) return false;

  const hasOther = sortedAccounts.some(
    (c) =>
      c !== candidate &&
      (c as any).enabled !== false &&
      !isAccountInCooldown(c, modelFamily) &&
      getModelQuotaScore(c, modelFamily) > 0 &&
      getAccountInFlight(c) < (isAccountInProbation(c, modelFamily) ? 1 : MAX_CONCURRENT_PER_ACCOUNT),
  );
  if (hasOther) {
    if (!busyCandidateAccounts.includes(candidate)) busyCandidateAccounts.push(candidate);
    return true;
  }

  await waitForAccountSlot(sortedAccounts, modelFamily, 2000);
  if (getAccountInFlight(candidate) >= maxSlots) {
    if (!busyCandidateAccounts.includes(candidate)) busyCandidateAccounts.push(candidate);
    return true;
  }
  return false;
}
