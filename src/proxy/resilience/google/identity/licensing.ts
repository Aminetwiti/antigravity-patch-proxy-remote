import type { CustomModel } from '../../../core/types';
import { getLiveAccountQuota } from '../../../../services/auth/googleAuth';
import { triggerQuotaCachePersist, registerUnlicensedAccountsHandlers } from '../../../../services/storage/quotaCacheStore';
import { getAccountQuotaKey } from './accountKeys';

// Tracks accounts that lack a valid product license (HTTP 403) so they are quarantined
// permanently rather than wasting round trips on every request attempt.
const unlicensedAccountKeys = new Set<string>();

export function isAccountUnlicensed(candidate: CustomModel): boolean {
  if (!candidate) return false;
  if ((candidate as any).isUnlicensed === true || (candidate as any).quotas?.isUnlicensed === true) {
    return true;
  }
  const key = getAccountQuotaKey(candidate);
  const liveQ = getLiveAccountQuota(key);
  if (liveQ?.isUnlicensed === true) {
    return true;
  }
  const email = (candidate.accountEmail || '').toLowerCase();
  return unlicensedAccountKeys.has(key) ||
         (email !== '' && (unlicensedAccountKeys.has(email) ||
                           unlicensedAccountKeys.has(`google:${email}`) ||
                           unlicensedAccountKeys.has(`gemini-cli:${email}`)));
}

export function isAccountTrial(candidate: CustomModel): boolean {
  if (!candidate) return false;
  if ((candidate as any).isTrial === true || (candidate as any).planType === 'trial') {
    return true;
  }
  const liveQ = getLiveAccountQuota(getAccountQuotaKey(candidate));
  if ((liveQ as any)?.isTrial === true || (liveQ as any)?.planType === 'trial') {
    return true;
  }
  const quotas = (candidate as any).quotas;
  if (quotas?.isTrial === true || quotas?.planType === 'trial') {
    return true;
  }
  return false;
}

export function markAccountUnlicensed(candidate: CustomModel): void {
  const key = getAccountQuotaKey(candidate);
  const email = (candidate.accountEmail || '').toLowerCase();
  unlicensedAccountKeys.add(key);
  if (email) {
    unlicensedAccountKeys.add(email);
    unlicensedAccountKeys.add(`google:${email}`);
    unlicensedAccountKeys.add(`gemini-cli:${email}`);
  }
  triggerQuotaCachePersist();
}

export function unmarkAccountUnlicensed(candidate: CustomModel | string): void {
  const key = typeof candidate === 'string' ? candidate : getAccountQuotaKey(candidate);
  const email = typeof candidate === 'string'
    ? (candidate.includes('@') ? candidate.toLowerCase() : '')
    : (candidate.accountEmail || '').toLowerCase();
  let changed = unlicensedAccountKeys.delete(key);
  if (email) {
    if (unlicensedAccountKeys.delete(email)) changed = true;
    if (unlicensedAccountKeys.delete(`google:${email}`)) changed = true;
    if (unlicensedAccountKeys.delete(`gemini-cli:${email}`)) changed = true;
  }
  if (changed) {
    triggerQuotaCachePersist();
  }
}

export function getUnlicensedAccountKeys(): string[] {
  return Array.from(unlicensedAccountKeys);
}

export function restoreUnlicensedAccountKeys(keys: string[]): void {
  for (const k of keys) {
    if (typeof k === 'string' && k.trim()) {
      unlicensedAccountKeys.add(k.trim());
    }
  }
}

export function _resetUnlicensedAccounts(): void {
  unlicensedAccountKeys.clear();
}

// Wire persistence handlers into quotaCacheStore
registerUnlicensedAccountsHandlers(getUnlicensedAccountKeys, restoreUnlicensedAccountKeys);
