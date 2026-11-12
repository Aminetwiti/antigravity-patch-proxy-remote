import log from 'electron-log';
import type { CustomModel } from '../../../../core/types';
import type { PoolLoopState } from '../types';
import {
  clearAccountCooldown,
  endAccountProbation,
  clearAccountBurst,
  getAccountQuotaKey,
  getModelQuotaScore,
  unmarkAccountUnlicensed,
  isAccountInCooldown,
  isAccountUnlicensed,
} from '../../../../resilience/googlePool';
import { recordSuccess } from '../../../../resilience/circuitBreaker';
import { sessionAffinities, bindSessionToModel } from '../../../../resilience/sessionAffinities';

export async function handleRequestSuccess(
  candidate: CustomModel,
  modelFamily: string,
  targetModel: string,
  elapsedMs: number,
  sessId: string | null,
  boundAccount: CustomModel | undefined,
  useStickySessions: boolean,
  state: PoolLoopState,
): Promise<void> {
  state.consecutiveTimeoutCount = 0;
  state.consecutiveTransportErrorCount = 0;
  state.consecutive503CapacityCount = 0;
  recordSuccess(candidate);
  unmarkAccountUnlicensed(candidate);
  clearAccountCooldown(candidate, modelFamily);
  endAccountProbation(candidate, modelFamily);

  if (sessId && useStickySessions) {
    const existingAffinity = sessionAffinities.get(sessId);
    const isDivertedFromHealthySticky = Boolean(
      boundAccount &&
      candidate !== boundAccount &&
      existingAffinity &&
      existingAffinity.accountKey === getAccountQuotaKey(boundAccount) &&
      !isAccountInCooldown(boundAccount, modelFamily) &&
      !isAccountUnlicensed(boundAccount) &&
      getModelQuotaScore(boundAccount, modelFamily) > 0,
    );
    if (!isDivertedFromHealthySticky) {
      bindSessionToModel(sessId, candidate);
    } else {
      log.debug(
        `[Proxy] Preserving sticky session binding to [${boundAccount.accountEmail || boundAccount.name}] after concurrency diversion.`,
      );
    }
  }

  clearAccountBurst(candidate);
  log.info(
    `[Proxy] ✅ [Feedback] Model: [${targetModel}] | Account: [${candidate.accountEmail || candidate.name}] -> HTTP 200 OK (${elapsedMs}ms)`,
  );
}
