import log from 'electron-log';
import type { CustomModel } from '../../../../core/types';
import type { PoolLoopState } from '../types';
import {
  setAccountCooldown,
  getModelQuotaScore,
  isAccountInCooldown,
  recordAccountLatency,
} from '../../../../resilience/pools/googlePool';
import { sessionAffinities } from '../../../../resilience/pools/sessionAffinities';
import { observe as metricObserve } from '../../../../../shared/metrics';
import { trimContextPayload } from '../../../transforms/contextTrimmer';
import { trimOldestHistory } from '../../../transforms/historyTrimmer';
import { normalizeConversationTurns } from '../../../../../services/auth/googleAuth';
import { CAPACITY_503_CASCADE_THRESHOLD, CONSECUTIVE_504_CASCADE_THRESHOLD } from '../../../../../constants';

export async function processOutcomeCapacityOrTimeout(
  candidate: CustomModel,
  candidateName: string,
  modelFamily: string,
  targetModel: string,
  elapsedMs: number,
  sessId: string | null,
  sortedAccounts: CustomModel[],
  candidateIndex: number,
  wasTimeoutCappedByBudget: boolean,
  isLargePayload: boolean,
  isContextualPayload: boolean,
  poolHeaderTimeout: number,
  baseCandidateTimeout: number,
  hostOverride: string | undefined,
  reqJson: Record<string, unknown>,
  state: PoolLoopState,
): Promise<{ breakLoop: boolean }> {
  const isCapacityExhausted =
    state.lastStatus === 503 ||
    /MODEL_CAPACITY_EXHAUSTED|no capacity available|overloaded|unavailable/i.test(state.lastErrorText);

  if (isCapacityExhausted) {
    state.consecutive503CapacityCount++;
    const capacityThreshold = Math.min(CAPACITY_503_CASCADE_THRESHOLD, Math.max(2, Math.ceil(sortedAccounts.length * 0.5)));
    log.warn(
      `[Proxy] ⚠️ Account [${candidateName}] hit MODEL_CAPACITY_EXHAUSTED / 503 Overload for [${targetModel}]. Placing in 45s cooldown.`,
    );
    setAccountCooldown(candidate, 45_000, modelFamily, true);
    recordAccountLatency(candidate, 45_000);

    const combinedOutageCount = state.consecutive503CapacityCount + state.consecutive504TimeoutCount;
    if (state.consecutive503CapacityCount >= capacityThreshold || combinedOutageCount >= Math.max(2, capacityThreshold)) {
      log.warn(`[Proxy] ⚠️ Global TPU/Cluster Capacity Exhaustion detected on [${targetModel}]. Triggering immediate cascade...`);
      state.lastStatus = 503;
      state.lastErrorText = `Google Cloud Code API capacity unavailable across ${state.consecutive503CapacityCount} consecutive accounts`;
      return { breakLoop: true };
    }
    return { breakLoop: false };
  }

  const isServerOutage =
    state.lastStatus === 500 ||
    state.lastStatus === 502 ||
    state.lastStatus === 503 ||
    state.lastStatus === 504 ||
    /timed out|unavailable|overloaded|service unavailable|backend error|internal error/i.test(state.lastErrorText);

  if (isServerOutage) {
    state.consecutiveTimeoutCount++;
    const maxOutageLimit = Math.max(4, Math.min(6, Math.ceil(sortedAccounts.length * 0.4)));
    const configuredOutage = Number(process.env.AG_OUTAGE_CONSECUTIVE_TIMEOUTS || 0);
    const upstreamOutageThreshold = configuredOutage >= 4 ? configuredOutage : maxOutageLimit;
    const isUpstreamOutage = state.consecutiveTimeoutCount >= upstreamOutageThreshold;
    const timeoutCooldownMs =
      state.lastStatus === 500 ? 20_000 : state.lastStatus === 504 ? 60_000 : isUpstreamOutage ? 45_000 : 30_000;
    const isPayloadInducedTimeout =
      state.lastStatus === 504 && (isLargePayload || isContextualPayload || state.consecutive504TimeoutCount > 0);
    const isCappedTimeout =
      wasTimeoutCappedByBudget || (state.lastStatus === 504 && poolHeaderTimeout < baseCandidateTimeout);

    if (state.lastStatus === 504) {
      const cooldownDuration = isPayloadInducedTimeout ? 15_000 : 60_000;
      setAccountCooldown(candidate, cooldownDuration, modelFamily, false);
      metricObserve('proxy_upstream_ms', elapsedMs, {
        upstream: hostOverride || 'cloudcode',
        status: '504',
        type: 'raw',
      });
      recordAccountLatency(candidate, isCappedTimeout || isPayloadInducedTimeout ? Math.min(elapsedMs, 25_000) : 60_000);
      if (sessId) sessionAffinities.delete(sessId);

      const reqObj = (reqJson.request || reqJson) as any;
      if (Array.isArray(reqObj?.contents) && reqObj.contents.length > 4) {
        trimContextPayload(reqJson as any);
        const didTrim = trimOldestHistory(reqJson, 30);
        if (didTrim) {
          state.consecutive504TimeoutCount = Math.min(state.consecutive504TimeoutCount, 1);
        }
        normalizeConversationTurns(reqObj.contents);
      }
    } else {
      setAccountCooldown(candidate, timeoutCooldownMs, modelFamily, true);
    }

    const remainingHealthyWithQuota = sortedAccounts
      .slice(candidateIndex + 1)
      .some((c) => !isAccountInCooldown(c, modelFamily) && getModelQuotaScore(c, modelFamily) > 0);
    if (isUpstreamOutage && !remainingHealthyWithQuota) {
      state.lastErrorText = `Google Cloud Code API upstream failure (HTTP ${state.lastStatus}) across ${state.consecutiveTimeoutCount} accounts`;
      return { breakLoop: true };
    }

    if (state.lastStatus === 504 || /timed out|deadline exceeded|gateway timeout/i.test(state.lastErrorText)) {
      state.consecutive504TimeoutCount++;
      const combinedOutageCount = state.consecutive504TimeoutCount + state.consecutive503CapacityCount;
      const dynamicPoolThreshold = Math.min(
        CONSECUTIVE_504_CASCADE_THRESHOLD,
        Math.max(3, Math.ceil(sortedAccounts.length * 0.25)),
      );
      if (state.consecutive504TimeoutCount >= dynamicPoolThreshold || combinedOutageCount >= dynamicPoolThreshold) {
        state.lastStatus = 504;
        state.lastErrorText = `Google Cloud Code API gateway timeout (504) across ${state.consecutive504TimeoutCount} consecutive accounts`;
        return { breakLoop: true };
      }
    }
  } else {
    state.consecutiveTimeoutCount = 0;
    state.consecutive504TimeoutCount = 0;
  }

  return { breakLoop: false };
}
