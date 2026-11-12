import type { CustomModel } from '../../../core/types';
import { getAccountQuotaKey } from '../identity/accountKeys';
import { accountProbationUntil } from './cooldownState';

export function isAccountInProbation(candidate: CustomModel, modelFamily?: string): boolean {
  const baseKey = getAccountQuotaKey(candidate);
  const key = modelFamily ? `${baseKey}:${modelFamily}` : baseKey;
  const until = accountProbationUntil.get(key) || (modelFamily ? accountProbationUntil.get(baseKey) : undefined);
  if (!until) return false;
  if (Date.now() >= until) {
    accountProbationUntil.delete(key);
    return false;
  }
  return true;
}

export function endAccountProbation(candidate: CustomModel, modelFamily?: string): void {
  const baseKey = getAccountQuotaKey(candidate);
  if (modelFamily) {
    accountProbationUntil.delete(`${baseKey}:${modelFamily}`);
  }
  accountProbationUntil.delete(baseKey);
}

export function _resetAccountProbation(): void {
  accountProbationUntil.clear();
}
