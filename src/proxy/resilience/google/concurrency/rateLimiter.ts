import type { CustomModel } from '../../../core/types';
import { getAccountQuotaKey } from '../identity/accountKeys';

const accountRequestTimestamps = new Map<string, number[]>();
const accountLastUsedTime = new Map<string, number>();
export const accountRecentBurstCount = new Map<string, { count: number; windowStart: number }>();

export function recordAccountRequest(candidate: CustomModel): void {
  const key = getAccountQuotaKey(candidate);
  const now = Date.now();
  accountLastUsedTime.set(key, now);
  const windowStart = now - 60_000;
  const timestamps = (accountRequestTimestamps.get(key) || []).filter((ts) => ts > windowStart);
  timestamps.push(now);
  accountRequestTimestamps.set(key, timestamps);
}

export function getAccountLastUsed(candidate: CustomModel): number {
  const key = getAccountQuotaKey(candidate);
  return accountLastUsedTime.get(key) || 0;
}

export function getAccountRpmCount(candidate: CustomModel): number {
  const key = getAccountQuotaKey(candidate);
  const now = Date.now();
  const windowStart = now - 60_000;
  const timestamps = (accountRequestTimestamps.get(key) || []).filter((ts) => ts > windowStart);
  accountRequestTimestamps.set(key, timestamps);
  return timestamps.length;
}

export function _resetAccountRpm(): void {
  accountRequestTimestamps.clear();
  accountLastUsedTime.clear();
}

export function recordAccountBurst(candidate: CustomModel): number {
  const key = getAccountQuotaKey(candidate);
  const now = Date.now();
  const current = accountRecentBurstCount.get(key);
  if (!current || now - current.windowStart > 60_000) {
    accountRecentBurstCount.set(key, { count: 1, windowStart: now });
    return 1;
  }
  current.count++;
  return current.count;
}

export function getAccountBurstCount(candidate: CustomModel): number {
  const key = getAccountQuotaKey(candidate);
  const current = accountRecentBurstCount.get(key);
  if (!current || Date.now() - current.windowStart > 60_000) return 0;
  return current.count;
}

export function clearAccountBurst(candidate: CustomModel): void {
  const key = getAccountQuotaKey(candidate);
  accountRecentBurstCount.delete(key);
}

export function _resetAccountBurst(): void {
  accountRecentBurstCount.clear();
}
