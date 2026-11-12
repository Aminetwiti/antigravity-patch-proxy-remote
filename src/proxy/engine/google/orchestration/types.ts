import type { CustomModel } from '../../../core/types';

export interface PoolLoopState {
  lastStatus: number;
  lastErrorText: string;
  consecutive429Count: number;
  consecutiveQuotaExhausted: number;
  consecutiveTimeoutCount: number;
  consecutive504TimeoutCount: number;
  consecutiveTransportErrorCount: number;
  consecutive503CapacityCount: number;
  testedAccountsCount: number;
  networkAttemptCount: number;
  busyEligibleAccountsCount: number;
  busyCandidateAccounts: CustomModel[];
  hasRetriedBusyPool: boolean;
}

export function createInitialPoolLoopState(): PoolLoopState {
  return {
    lastStatus: 500,
    lastErrorText: 'All accounts in Google Cloud Code pool exhausted',
    consecutive429Count: 0,
    consecutiveQuotaExhausted: 0,
    consecutiveTimeoutCount: 0,
    consecutive504TimeoutCount: 0,
    consecutiveTransportErrorCount: 0,
    consecutive503CapacityCount: 0,
    testedAccountsCount: 0,
    networkAttemptCount: 0,
    busyEligibleAccountsCount: 0,
    busyCandidateAccounts: [],
    hasRetriedBusyPool: false,
  };
}
