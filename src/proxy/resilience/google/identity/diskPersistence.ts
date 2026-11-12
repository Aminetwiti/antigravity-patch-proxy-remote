import fs from 'fs';
import log from 'electron-log';
import { getCustomModelsPath } from '../../../models/catalog/modelLoader';
import { withWriteLock, invalidateModelStoreCache, atomicWriteJson } from '../../../../services/storage/modelStore';
import {
  googleAccountCooldowns,
  rateLimitedCooldownKeys,
  quotaExhaustedAccountKeys,
} from '../cooldown/cooldownState';

/**
 * Persists validation challenge state (403 VALIDATION_REQUIRED) to custom_models.json
 * so Doctor UI immediately visualizes it in the Validation Requise category.
 */
export function persistAccountChallengeToDisk(accountEmail: string, errorMsg: string): void {
  if (!accountEmail) return;
  withWriteLock(async () => {
    try {
      const filePath = getCustomModelsPath();
      if (!fs.existsSync(filePath)) return;
      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(content.charCodeAt(0) === 0xFEFF ? content.slice(1) : content);
      let mutated = false;
      const cleanTarget = accountEmail.trim().toLowerCase();
      if (parsed.providers && Array.isArray(parsed.providers)) {
        for (const pr of parsed.providers) {
          if (Array.isArray(pr.accounts)) {
            for (const a of pr.accounts) {
              const email = (a.email || '').trim().toLowerCase();
              if (email === cleanTarget) {
                a.isValidationRequired = true;
                a.status = 'validation_required';
                a.lastError = `HTTP 403: VALIDATION_REQUIRED (${errorMsg || 'Challenge requis'})`;
                a.errorDetails = {
                  status: 'VALIDATION_REQUIRED',
                  reason: 'VALIDATION_REQUIRED',
                  message: 'Validation Sécurité Requise (SMS/Captcha)',
                  validationUrl: 'https://accounts.google.com/signin/continue',
                };
                mutated = true;
              }
            }
          }
        }
      }
      if (mutated) {
        await atomicWriteJson(filePath, parsed);
        invalidateModelStoreCache();
        // Clear active cooldowns so account is strictly categorized as validation_required, NOT cooldown
        const baseKey = `google:${cleanTarget}`;
        googleAccountCooldowns.delete(baseKey);
        googleAccountCooldowns.delete(cleanTarget);
        googleAccountCooldowns.delete(`${baseKey}:gemini`);
        googleAccountCooldowns.delete(`${baseKey}:claude`);
        googleAccountCooldowns.delete(`${cleanTarget}:gemini`);
        googleAccountCooldowns.delete(`${cleanTarget}:claude`);
        rateLimitedCooldownKeys.delete(baseKey);
        rateLimitedCooldownKeys.delete(cleanTarget);
        rateLimitedCooldownKeys.delete(`${baseKey}:gemini`);
        rateLimitedCooldownKeys.delete(`${baseKey}:claude`);
        quotaExhaustedAccountKeys.delete(baseKey);
        quotaExhaustedAccountKeys.delete(cleanTarget);
        quotaExhaustedAccountKeys.delete(`${baseKey}:gemini`);
        quotaExhaustedAccountKeys.delete(`${baseKey}:claude`);
        log.info(`[GooglePool] 💾 Persisted validation challenge state to custom_models.json for ${cleanTarget}`);
      }
    } catch (err) {
      log.error(`[GooglePool] Failed to persist account challenge for ${accountEmail}:`, err);
    }
  }).catch((err) => {
    log.error(`[GooglePool] withWriteLock failed in persistAccountChallengeToDisk for ${accountEmail}:`, err);
  });
}

/**
 * Persists quota exhausted state (429) to custom_models.json
 * so Doctor UI immediately reflects the account status.
 */
export function persistAccountQuotaExhaustedToDisk(accountEmail: string, resetIso: string): void {
  if (!accountEmail) return;
  withWriteLock(async () => {
    try {
      const filePath = getCustomModelsPath();
      if (!fs.existsSync(filePath)) return;
      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(content.charCodeAt(0) === 0xFEFF ? content.slice(1) : content);
      let mutated = false;
      const cleanTarget = accountEmail.trim().toLowerCase();
      if (parsed.providers && Array.isArray(parsed.providers)) {
        for (const pr of parsed.providers) {
          if (Array.isArray(pr.accounts)) {
            for (const a of pr.accounts) {
              const email = (a.email || '').trim().toLowerCase();
              if (email === cleanTarget) {
                if (a.status !== 'exhausted' && a.status !== 'validation_required' && !a.isValidationRequired) {
                  a.status = 'exhausted';
                  if (!a.quotas) a.quotas = {};
                  a.quotas.geminiFiveHourPct = 0;
                  a.quotas.fiveHourPercentage = 0;
                  a.quotas.geminiFiveHourReset = resetIso;
                  mutated = true;
                }
              }
            }
          }
        }
      }
      if (mutated) {
        await atomicWriteJson(filePath, parsed);
        invalidateModelStoreCache();
        log.info(`[GooglePool] 💾 Persisted exhausted quota status to custom_models.json for ${cleanTarget}`);
      }
    } catch (err) {
      log.error(`[GooglePool] Failed to persist exhausted quota for ${accountEmail}:`, err);
    }
  }).catch((err) => {
    log.error(`[GooglePool] withWriteLock failed in persistAccountQuotaExhaustedToDisk for ${accountEmail}:`, err);
  });
}

/**
 * Clears quota exhausted state from custom_models.json
 * when an account recovers or cooldown is cleared.
 */
export function clearAccountQuotaExhaustedFromDisk(accountEmail?: string): void {
  if (!accountEmail) return;
  withWriteLock(async () => {
    try {
      const filePath = getCustomModelsPath();
      if (!fs.existsSync(filePath)) return;
      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(content.charCodeAt(0) === 0xFEFF ? content.slice(1) : content);
      let mutated = false;
      const cleanTarget = accountEmail.replace(/^google:/, '').trim().toLowerCase();
      if (parsed.providers && Array.isArray(parsed.providers)) {
        for (const pr of parsed.providers) {
          if (Array.isArray(pr.accounts)) {
            for (const a of pr.accounts) {
              const email = (a.email || '').trim().toLowerCase();
              if (email === cleanTarget) {
                if (a.status === 'exhausted') {
                  a.status = 'healthy';
                  mutated = true;
                }
                if (a.quotas) {
                  if (a.quotas.geminiFiveHourReset) {
                    delete a.quotas.geminiFiveHourReset;
                    mutated = true;
                  }
                  if (a.quotas.geminiResetTime) {
                    delete a.quotas.geminiResetTime;
                    mutated = true;
                  }
                  if (Array.isArray(a.quotas.groups)) {
                    for (const g of a.quotas.groups) {
                      if (Array.isArray(g.buckets)) {
                        for (const b of g.buckets) {
                          if (b.resetTime) {
                            delete b.resetTime;
                            mutated = true;
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
      if (mutated) {
        await atomicWriteJson(filePath, parsed);
        invalidateModelStoreCache();
        log.info(`[GooglePool] 💾 Cleared exhausted quota status from custom_models.json for ${cleanTarget}`);
      }
    } catch (err) {
      log.error(`[GooglePool] Failed to clear exhausted quota for ${accountEmail}:`, err);
    }
  }).catch((err) => {
    log.error(`[GooglePool] withWriteLock failed in clearAccountQuotaExhaustedFromDisk for ${accountEmail}:`, err);
  });
}

/**
 * Clears quota exhausted state for all accounts from custom_models.json.
 */
export function clearAllAccountQuotaExhaustedFromDisk(): void {
  withWriteLock(async () => {
    try {
      const filePath = getCustomModelsPath();
      if (!fs.existsSync(filePath)) return;
      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(content.charCodeAt(0) === 0xFEFF ? content.slice(1) : content);
      let mutated = false;
      if (parsed.providers && Array.isArray(parsed.providers)) {
        for (const pr of parsed.providers) {
          if (Array.isArray(pr.accounts)) {
            for (const a of pr.accounts) {
              if (a.status === 'exhausted') {
                a.status = 'healthy';
                mutated = true;
              }
              if (a.quotas) {
                if (a.quotas.geminiFiveHourReset) { delete a.quotas.geminiFiveHourReset; mutated = true; }
                if (a.quotas.geminiResetTime) { delete a.quotas.geminiResetTime; mutated = true; }
                if (Array.isArray(a.quotas.groups)) {
                  for (const g of a.quotas.groups) {
                    if (Array.isArray(g.buckets)) {
                      for (const b of g.buckets) {
                        if (b.resetTime) { delete b.resetTime; mutated = true; }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
      if (mutated) {
        await atomicWriteJson(filePath, parsed);
        invalidateModelStoreCache();
      }
    } catch {}
  }).catch(() => {});
}

/**
 * Clears validation challenge state (403 VALIDATION_REQUIRED) from custom_models.json
 * when an account challenge is resolved or verified healthy.
 */
export function clearAccountChallengeFromDisk(accountEmail?: string): void {
  if (!accountEmail) return;
  withWriteLock(async () => {
    try {
      const filePath = getCustomModelsPath();
      if (!fs.existsSync(filePath)) return;
      const content = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(content.charCodeAt(0) === 0xFEFF ? content.slice(1) : content);
      let mutated = false;
      const cleanTarget = accountEmail.replace(/^google:/, "").trim().toLowerCase();
      if (parsed.providers && Array.isArray(parsed.providers)) {
        for (const pr of parsed.providers) {
          if (Array.isArray(pr.accounts)) {
            for (const a of pr.accounts) {
              const email = (a.email || "").trim().toLowerCase();
              if (email === cleanTarget) {
                if (a.isValidationRequired) {
                  delete a.isValidationRequired;
                  mutated = true;
                }
                if (a.status === "validation_required") {
                  a.status = "healthy";
                  mutated = true;
                }
                if (a.errorDetails && (a.errorDetails.status === "VALIDATION_REQUIRED" || a.errorDetails.reason === "VALIDATION_REQUIRED")) {
                  delete a.errorDetails;
                  mutated = true;
                }
                if (a.lastError && (a.lastError.includes("VALIDATION_REQUIRED") || a.lastError.includes("Challenge"))) {
                  delete a.lastError;
                  mutated = true;
                }
              }
            }
          }
        }
      }
      if (mutated) {
        await atomicWriteJson(filePath, parsed);
        invalidateModelStoreCache();
        log.info(`[GooglePool] 💾 Cleared validation challenge state from custom_models.json for ${cleanTarget}`);
      }
    } catch (err) {
      log.error(`[GooglePool] Failed to clear validation challenge for ${accountEmail}:`, err);
    }
  }).catch((err) => {
    log.error(`[GooglePool] withWriteLock failed in clearAccountChallengeFromDisk for ${accountEmail}:`, err);
  });
}
