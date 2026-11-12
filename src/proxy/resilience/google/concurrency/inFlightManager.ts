import type { CustomModel } from '../../../core/types';
import { getAccountQuotaKey } from '../identity/accountKeys';
import { getOpenBreaker } from '../../circuit/circuitBreaker';
import { isAccountInCooldown } from '../cooldown/cooldownRegistry';
import { isAccountInProbation } from '../cooldown/probationRegistry';
import { getModelQuotaScore } from '../selection/scoring';

// ─── Google Account In-Flight Concurrency Tracker ──────────────────────────────
const accountInFlightRequests = new Map<string, number>();

export function getAccountInFlight(candidate: CustomModel): number {
  const key = getAccountQuotaKey(candidate);
  return accountInFlightRequests.get(key) || 0;
}

export const MAX_CONCURRENT_PER_ACCOUNT = Number(process.env.AG_MAX_CONCURRENT_PER_ACCOUNT) || 2;

interface SlotWaiter {
  resolve: (hasSlot: boolean) => void;
  timer: NodeJS.Timeout;
}

const slotWaiters: SlotWaiter[] = [];

export function notifySlotAvailable(all = false): void {
  if (all) {
    while (slotWaiters.length > 0) {
      const waiter = slotWaiters.shift();
      if (waiter) {
        clearTimeout(waiter.timer);
        waiter.resolve(true);
      }
    }
    return;
  }
  const waiter = slotWaiters.shift();
  if (waiter) {
    clearTimeout(waiter.timer);
    waiter.resolve(true);
  }
}

export function _clearSlotWaitersForTests(): void {
  for (const w of slotWaiters) {
    clearTimeout(w.timer);
  }
  slotWaiters.length = 0;
}

export async function waitForAccountSlot(
  accounts: CustomModel[],
  modelFamily?: string,
  maxWaitMs = 1500,
): Promise<boolean> {
  const hasAvailableSlot = accounts.some((a) => {
    if (isAccountInCooldown(a, modelFamily) || getOpenBreaker(a)) return false;
    if (getModelQuotaScore(a, modelFamily) <= 0) return false;
    const max = isAccountInProbation(a, modelFamily) ? 1 : MAX_CONCURRENT_PER_ACCOUNT;
    return getAccountInFlight(a) < max;
  });

  if (hasAvailableSlot) return true;
  if (maxWaitMs <= 0) return false;

  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      const idx = slotWaiters.findIndex((w) => w.timer === timer);
      if (idx !== -1) {
        slotWaiters.splice(idx, 1);
      }
      resolve(false);
    }, maxWaitMs);
    if (timer.unref) timer.unref();

    slotWaiters.push({ resolve, timer });
  });
}

export function incrementAccountInFlight(candidate: CustomModel): void {
  const key = getAccountQuotaKey(candidate);
  accountInFlightRequests.set(key, (accountInFlightRequests.get(key) || 0) + 1);
}

export function decrementAccountInFlight(candidate: CustomModel): void {
  const key = getAccountQuotaKey(candidate);
  const current = accountInFlightRequests.get(key) || 0;
  if (current <= 1) {
    accountInFlightRequests.delete(key);
  } else {
    accountInFlightRequests.set(key, current - 1);
  }
  notifySlotAvailable();
}

export function _resetAccountInFlight(): void {
  accountInFlightRequests.clear();
}
