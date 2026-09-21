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

    // Restore live quotas
    if (data.quotas && typeof data.quotas === 'object') {
      let count = 0;
      for (const [key, quota] of Object.entries(data.quotas)) {
        if (quota && typeof quota.geminiFiveHourPct === 'number') {
          updateLiveAccountQuota(key, quota);
          count++;
        }
      }
      log.info(`[QuotaCacheStore] Restored ${count} account quota entries from disk cache`);
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
    };

    const tempPath = `${filePath}.tmp.${Date.now()}`;
    await fs.writeFile(tempPath, JSON.stringify(payload, null, 2), 'utf8');
    await fs.rename(tempPath, filePath);
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
