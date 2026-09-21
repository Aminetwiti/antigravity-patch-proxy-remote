import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

vi.mock('electron-log', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  loadPersistentQuotaCache,
  savePersistentQuotaCache,
  triggerQuotaCachePersist,
  getQuotaCachePath,
  _clearQuotaPersistTimersForTests,
} from '../services/quotaCacheStore';

import {
  updateLiveAccountQuota,
  getLiveAccountQuota,
  getAllLiveAccountQuotas,
  _clearLiveQuotasForTests,
  markTokenRevoked,
  isTokenRevoked,
  clearRevokedTokens,
  getAllRevokedTokens,
} from '../services/googleAuth';

describe('Persistent Quota & Quarantine Cache Store', () => {
  const testDir = path.join(os.tmpdir(), `quota-cache-test-${Date.now()}`);
  const testFilePath = path.join(testDir, 'quota_cache.json');

  beforeEach(async () => {
    _clearQuotaPersistTimersForTests();
    _clearLiveQuotasForTests();
    clearRevokedTokens();
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    _clearQuotaPersistTimersForTests();
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (_) {}
  });

  it('computes default cache path under .gemini/antigravity', () => {
    const p = getQuotaCachePath();
    expect(p).toContain('.gemini');
    expect(p).toContain('quota_cache.json');
  });

  it('saves and restores live quotas and revoked tokens correctly', async () => {
    // 1. Set up live quota and revoked token
    updateLiveAccountQuota('google:alice@example.com', {
      geminiFiveHourPct: 85,
      geminiWeeklyPct: 90,
      claudeFiveHourPct: 40,
      claudeWeeklyPct: 50,
      fiveHourPercentage: 85,
      weeklyPercentage: 90,
      updatedAt: Date.now(),
    });

    markTokenRevoked('revoked-refresh-token-12345');

    // 2. Save to disk
    await savePersistentQuotaCache(testFilePath);

    // Verify file exists
    const exists = await fs.readFile(testFilePath, 'utf8');
    expect(exists).toContain('alice@example.com');
    expect(exists).toContain('revoked-refresh-token-12345');

    // 3. Clear in-memory state
    _clearLiveQuotasForTests();
    clearRevokedTokens();
    expect(getLiveAccountQuota('google:alice@example.com')).toBeUndefined();
    expect(isTokenRevoked('revoked-refresh-token-12345')).toBe(false);

    // 4. Restore from disk
    const ok = await loadPersistentQuotaCache(testFilePath);
    expect(ok).toBe(true);

    const restoredQuota = getLiveAccountQuota('google:alice@example.com');
    expect(restoredQuota).toBeDefined();
    expect(restoredQuota?.geminiFiveHourPct).toBe(85);
    expect(restoredQuota?.claudeFiveHourPct).toBe(40);

    expect(isTokenRevoked('revoked-refresh-token-12345')).toBe(true);
  });

  it('handles non-existent file gracefully without crashing', async () => {
    const nonExistent = path.join(testDir, 'does_not_exist.json');
    const res = await loadPersistentQuotaCache(nonExistent);
    expect(res).toBe(false);
  });

  it('handles corrupted JSON gracefully', async () => {
    const corruptPath = path.join(testDir, 'corrupt.json');
    await fs.writeFile(corruptPath, 'INVALID_JSON{{{', 'utf8');
    const res = await loadPersistentQuotaCache(corruptPath);
    expect(res).toBe(false);
  });
});
