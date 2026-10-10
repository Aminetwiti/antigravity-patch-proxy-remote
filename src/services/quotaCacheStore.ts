/**
 * Persistent Quota & Quarantined Accounts Store
 * Saves live quota statuses and revoked token states to ~/.gemini/antigravity/quota_cache.json.
 * On proxy startup, loads the state to immediately know quota levels and avoid cold-start degradation.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import log from 'electron-log';
import {
  getAllLiveAccountQuotas,
  updateLiveAccountQuota,
  getAllRevokedTokens,
  markTokenRevoked,
  onQuotaOrTokenChange,
  AccountLiveQuota,
} from './googleAuth';

export interface PersistentQuotaCacheData {
  version: number;
  savedAt: number;
  quotas: Record<string, AccountLiveQuota>;
  revokedTokens: string[];
  unlicensedAccounts?: string[];
  accountCooldowns?: Record<string, number>;
}

let getUnlicensedAccountsFn: (() => string[]) | null = null;
let restoreUnlicensedAccountsFn: ((keys: string[]) => void) | null = null;

export function registerUnlicensedAccountsHandlers(
  getFn: () => string[],
  restoreFn: (keys: string[]) => void,
): void {
  getUnlicensedAccountsFn = getFn;
  restoreUnlicensedAccountsFn = restoreFn;
}

let getAccountCooldownsFn: (() => Record<string, number>) | null = null;
let restoreAccountCooldownsFn: ((cooldowns: Record<string, number>, quotas?: Map<string, AccountLiveQuota>) => void) | null = null;

export function registerAccountCooldownHandlers(
  getFn: () => Record<string, number>,
  restoreFn: (cooldowns: Record<string, number>, quotas?: Map<string, AccountLiveQuota>) => void,
): void {
  getAccountCooldownsFn = getFn;
  restoreAccountCooldownsFn = restoreFn;
}

let persistTimeout: NodeJS.Timeout | null = null;

// Automatically schedule debounced disk save on quota / quarantine updates
onQuotaOrTokenChange(() => {
  triggerQuotaCachePersist(500);
});

export function getQuotaCachePath(): string {
  const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
  return path.join(home, '.gemini', 'antigravity', 'quota_cache.json');
}

/**
 * Loads cached quotas and quarantined tokens from disk into memory.
 */
export async function loadPersistentQuotaCache(customPath?: string): Promise<boolean> {
  const filePath = customPath || getQuotaCachePath();
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const data = JSON.parse(raw) as PersistentQuotaCacheData;
    if (!data || typeof data !== 'object') return false;

    // Restore live quotas — skip entries older than 6h to avoid stale 0% readings
    // causing false quota-exhausted cooldowns after a restart.
    // ponytail: 6h ceiling matches the Gemini 5h rolling window plus a 1h grace period.
    const QUOTA_STALE_MS = 6 * 3600_000;
    if (data.quotas && typeof data.quotas === 'object') {
      let count = 0;
      let skipped = 0;
      for (const [key, quota] of Object.entries(data.quotas)) {
        if (quota && typeof quota.geminiFiveHourPct === 'number') {
          const age = Date.now() - (quota.updatedAt || 0);
          if (age > QUOTA_STALE_MS) {
            skipped++;
            log.debug(`[QuotaCacheStore] Skipping stale quota for ${key} (age=${Math.round(age / 3600_000)}h)`);
            continue;
          }
          updateLiveAccountQuota(key, quota);
          count++;
        }
      }
      log.info(`[QuotaCacheStore] Restored ${count} account quota entries from disk cache (${skipped} skipped as stale)`);
    }

    // Restore quarantined tokens
    if (Array.isArray(data.revokedTokens)) {
      for (const token of data.revokedTokens) {
        if (typeof token === 'string' && token.trim()) {
          markTokenRevoked(token.trim());
        }
      }
      log.info(`[QuotaCacheStore] Restored ${data.revokedTokens.length} quarantined token(s) from disk cache`);
    }

    // Restore unlicensed accounts (HTTP 403)
    if (Array.isArray(data.unlicensedAccounts) && restoreUnlicensedAccountsFn) {
      restoreUnlicensedAccountsFn(data.unlicensedAccounts);
      log.info(`[QuotaCacheStore] Restored ${data.unlicensedAccounts.length} unlicensed account(s) from disk cache`);
    }

    // Restore active account cooldowns (HTTP 429)
    // Pass the freshly-loaded quota map so the restore fn can skip quota-exhausted
    // cooldowns for accounts that already have positive remaining quota.
    if (data.accountCooldowns && typeof data.accountCooldowns === 'object' && restoreAccountCooldownsFn) {
      const now = Date.now();
      const active: Record<string, number> = {};
      for (const [k, until] of Object.entries(data.accountCooldowns)) {
        if (typeof until === 'number' && until > now) {
          active[k] = until;
        }
      }
      const freshQuotaMap = getAllLiveAccountQuotas();
      restoreAccountCooldownsFn(active, freshQuotaMap);
      log.info(`[QuotaCacheStore] Restored ${Object.keys(active).length} active account cooldown(s) from disk cache`);
    }

    return true;
  } catch (err: any) {
    if (err?.code !== 'ENOENT') {
      log.debug(`[QuotaCacheStore] Could not read persistent quota cache: ${err?.message || err}`);
    }
    return false;
  }
}

/**
 * Saves current in-memory quotas and quarantined tokens to disk.
 */
export async function savePersistentQuotaCache(customPath?: string): Promise<void> {
  const filePath = customPath || getQuotaCachePath();
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    const liveQuotasMap = getAllLiveAccountQuotas();
    const quotasRecord: Record<string, AccountLiveQuota> = {};
    for (const [k, v] of liveQuotasMap.entries()) {
      quotasRecord[k] = v;
    }

    const payload: PersistentQuotaCacheData = {
      version: 1,
      savedAt: Date.now(),
      quotas: quotasRecord,
      revokedTokens: getAllRevokedTokens(),
      unlicensedAccounts: getUnlicensedAccountsFn ? getUnlicensedAccountsFn() : [],
      accountCooldowns: getAccountCooldownsFn ? getAccountCooldownsFn() : {},
    };

    const tempPath = `${filePath}.tmp.${Date.now()}`;
    await fs.writeFile(tempPath, JSON.stringify(payload, null, 2), 'utf8');
    
    // Windows atomic rename resilience (handles transient EPERM / EBUSY anti-virus locks)
    let renamed = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await fs.rename(tempPath, filePath);
        renamed = true;
        break;
      } catch (renameErr: any) {
        if (attempt < 2 && (renameErr?.code === 'EPERM' || renameErr?.code === 'EBUSY')) {
          await new Promise((r) => setTimeout(r, 60 * (attempt + 1)));
        } else {
          // Fallback to copyFile + unlink if rename is persistently locked
          try {
            await fs.copyFile(tempPath, filePath);
            await fs.unlink(tempPath).catch(() => {});
            renamed = true;
            break;
          } catch {
            throw renameErr;
          }
        }
      }
    }
    if (!renamed) {
      await fs.unlink(tempPath).catch(() => {});
    }

    log.debug(`[QuotaCacheStore] Persisted ${Object.keys(quotasRecord).length} quotas to ${filePath}`);
  } catch (err: any) {
    log.warn(`[QuotaCacheStore] Failed to write persistent quota cache: ${err?.message || err}`);
  }
}

/**
 * Debounced trigger to persist quota cache to disk (500ms).
 */
export function triggerQuotaCachePersist(delayMs = 500): void {
  if (persistTimeout) {
    clearTimeout(persistTimeout);
  }
  persistTimeout = setTimeout(() => {
    persistTimeout = null;
    savePersistentQuotaCache().catch(() => {});
  }, delayMs);
  if (persistTimeout.unref) persistTimeout.unref();
}

/**
  * Test helper to cancel timers and clear pending writes.
  */
export function _clearQuotaPersistTimersForTests(): void {
  if (persistTimeout) {
    clearTimeout(persistTimeout);
    persistTimeout = null;
  }
}

/**
 * Completely purges the persistent quota cache file and memory state.
 */
export async function purgePersistentQuotaCache(customPath?: string): Promise<boolean> {
  const filePath = customPath || getQuotaCachePath();
  try {
    if (persistTimeout) {
      clearTimeout(persistTimeout);
      persistTimeout = null;
    }
    await fs.unlink(filePath).catch(() => {});
    return true;
  } catch {
    return false;
  }
}
