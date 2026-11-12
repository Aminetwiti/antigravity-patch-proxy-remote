import https from 'https';
import log from 'electron-log';
import type { CustomModel } from '../../../core/types';
import { getHttpsAgent } from '../../pools/agentPool';
import { PREFLIGHT_HEALTH_CHECK_TIMEOUT_MS } from '../../../../constants';
import {
  getValidGoogleAccessToken,
  isGeminiCliModel,
  isGoogleCloudCodeModel,
  isTokenRevoked,
  getLiveAccountQuota,
  updateLiveAccountQuota,
  type AccountLiveQuota,
} from '../../../../services/auth/googleAuth';
import { loadCustomModels } from '../../../models/modelLoader';
import { getAccountVirtualDeviceHeaders } from '../identity/deviceHeaders';
import { getAccountQuotaKey } from '../identity/accountKeys';
import { markAccountUnlicensed, unmarkAccountUnlicensed } from '../identity/licensing';
import { clearAccountChallengeFromDisk } from '../identity/diskPersistence';
import {
  isAccountInCooldown,
  setAccountCooldown,
  clearAccountCooldown,
} from '../cooldown/cooldownRegistry';
import { markAccountQuotaExhausted } from '../cooldown/cooldownState';
import { getAccountInFlight } from '../concurrency/inFlightManager';
import { recordAccountLatency } from '../concurrency/latencyTracker';
import { getAccountLastUsed } from '../concurrency/rateLimiter';
import { resolveGoogleProjectId } from './scoring';
import { classifyGoogleCloudCode429 } from './classifier429';

export interface PreflightProbeResult {
  email: string;
  ok: boolean;
  statusCode: number;
  latencyMs: number;
  reason: string;
}

/**
 * Executes a fast non-streaming single-token health check on a Google account.
 * Accounts that stall > timeoutMs (default 3.5s) are isolated as Black-Hole accounts
 * and quarantined to protect IDE sessions from hangs.
 */
export async function probeGoogleAccountPreflight(
  account: CustomModel,
  timeoutMs = PREFLIGHT_HEALTH_CHECK_TIMEOUT_MS,
): Promise<PreflightProbeResult> {
  const email = (account.accountEmail || account.name || 'unknown').toLowerCase();
  if (
    (account as any).isValidationRequired === true ||
    (account as any).status === 'validation_required' ||
    (account as any).errorDetails?.status === 'VALIDATION_REQUIRED'
  ) {
    return {
      email,
      ok: false,
      statusCode: 403,
      latencyMs: 0,
      reason: 'Validation required (challenge)',
    };
  }
  const token = await getValidGoogleAccessToken(account).catch(() => null);

  if (!token) {
    if (account.refreshToken && isTokenRevoked(account.refreshToken)) {
      markAccountUnlicensed(account);
    }
    return {
      email,
      ok: false,
      statusCode: 401,
      latencyMs: 0,
      reason: 'Failed to obtain access token (revoked or expired)',
    };
  }

  const projectId = resolveGoogleProjectId(account) || 'aicode-consumers';
  const postData = JSON.stringify({
    project: projectId,
    model: 'gemini-3.8-flash-tiered',
    request: {
      contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
      generationConfig: { maxOutputTokens: 1, temperature: 0 },
    },
  });

  const host = isGeminiCliModel(account) ? 'cloudcode-pa.googleapis.com' : 'daily-cloudcode-pa.googleapis.com';
  const startTime = Date.now();

  return new Promise<PreflightProbeResult>((resolve) => {
    let settled = false;
    const finish = (res: PreflightProbeResult) => {
      if (settled) return;
      settled = true;
      resolve(res);
    };

    const virtualDevHeaders = getAccountVirtualDeviceHeaders(account);
    const req = https.request(
      `https://${host}/v1internal:generateContent`,
      {
        method: 'POST',
        agent: getHttpsAgent({ host }),
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'antigravity',
          'X-Goog-Api-Client': 'google-cloud-sdk antigravity',
          ...virtualDevHeaders,
          'Content-Length': Buffer.byteLength(postData),
        },
        timeout: timeoutMs,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          const latencyMs = Date.now() - startTime;
          const status = res.statusCode || 0;
          const ok = status >= 200 && status < 300;

          if (ok) {
            unmarkAccountUnlicensed(account);
            clearAccountCooldown(account, 'gemini');
            clearAccountCooldown(account, 'claude');
            recordAccountLatency(account, latencyMs);
            delete (account as any).isValidationRequired;
            clearAccountChallengeFromDisk(email);
            log.info(`[PreFlight] ? Account [${email}] is healthy (HTTP 200, ${latencyMs}ms)`);
            finish({ email, ok: true, statusCode: status, latencyMs, reason: 'OK' });
            return;
          }

          let reason = '';
          try {
            const j = JSON.parse(body);
            reason = j.error?.message || j.error?.details?.[0]?.reason || body.substring(0, 100);
          } catch (_) {
            reason = body.substring(0, 100);
          }

          const isLocationBlock = (status === 400 || status === 403) && /location is not supported|user location|failed_precondition/i.test(reason);
          if (isLocationBlock) {
            log.warn(`[PreFlight] ?? Account [${email}] network location blocked (HTTP ${status}): ${reason}`);
            finish({ email, ok: false, statusCode: status, latencyMs, reason: `Location not supported: ${reason}` });
            return;
          }

          const isSecurityChallenge = status === 403 || /verify your account|validation_required|permission_denied/i.test(reason);
          if (isSecurityChallenge) {
            markAccountUnlicensed(account);
            setAccountCooldown(account, 7 * 24 * 3600 * 1000);
            log.warn(`[PreFlight] ?? Account [${email}] security challenge (HTTP ${status}): quarantined. (${reason})`);
            finish({ email, ok: false, statusCode: status, latencyMs, reason: `Security challenge: ${reason}` });
            return;
          }

          if (status === 429) {
            const retryAfterRaw = res.headers['retry-after'] || null;
            const decision = classifyGoogleCloudCode429(body, retryAfterRaw);
            const isQuotaExhausted = decision.category === 'quota_exhausted';
            const cooldownMs = isQuotaExhausted ? decision.cooldownMs : Math.min(decision.cooldownMs, 30_000);
            setAccountCooldown(account, cooldownMs, 'gemini', !isQuotaExhausted);
            if (isQuotaExhausted) {
              const accKey = getAccountQuotaKey(account);
              markAccountQuotaExhausted(accKey, 'gemini');
              const existingQuota = getLiveAccountQuota(accKey);
              const nowMs = Date.now();
              const resetIso = new Date(nowMs + decision.cooldownMs).toISOString();
              updateLiveAccountQuota(accKey, {
                ...existingQuota,
                geminiFiveHourPct: 0,
                geminiWeeklyPct: decision.weeklyResetMs ? 0 : existingQuota?.geminiWeeklyPct ?? 100,
                geminiFiveHourReset: resetIso,
                geminiWeeklyReset: decision.weeklyResetMs ? new Date(nowMs + decision.weeklyResetMs).toISOString() : existingQuota?.geminiWeeklyReset,
                updatedAt: nowMs,
              } as AccountLiveQuota);
              log.warn(`[PreFlight] ?? Account [${email}] quota exhausted (HTTP 429, ${decision.reason}): cooldown ${Math.round(cooldownMs / 3600_000)}h.`);
            } else {
              log.warn(`[PreFlight] ?? Account [${email}] rate-limited (HTTP 429, ${decision.category}): paused ${Math.round(cooldownMs / 1000)}s.`);
            }
            finish({ email, ok: false, statusCode: status, latencyMs, reason: `HTTP 429 (${decision.category})` });
            return;
          }

          setAccountCooldown(account, 60_000, 'gemini', true);
          log.warn(`[PreFlight] ?? Account [${email}] HTTP ${status}: placed in 60s cooldown.`);
          finish({ email, ok: false, statusCode: status, latencyMs, reason: `HTTP ${status}: ${reason}` });
        });
      },
    );

    req.on('timeout', () => {
      const latencyMs = Date.now() - startTime;
      if (process.env.AG_PREFLIGHT_QUARANTINE_ON_TIMEOUT !== '0') {
        setAccountCooldown(account, 60_000, 'gemini', true);
        log.warn(`[PreFlight] ?? Preflight probe timed out for [${email}] on Gemini (> ${timeoutMs}ms). Placed in 60s transient cooldown.`);
      } else {
        recordAccountLatency(account, Math.max(latencyMs, 45_000));
        log.warn(`[PreFlight] ?? Preflight probe timed out for [${email}] on Gemini (> ${timeoutMs}ms). Latency penalized without hard cooldown.`);
      }
      finish({
        email,
        ok: false,
        statusCode: 504,
        latencyMs,
        reason: `TIMEOUT (>${timeoutMs}ms - High Latency)`,
      });
      try { req.destroy(); } catch (_) {}
    });

    req.on('error', (err) => {
      if (settled) return;
      const latencyMs = Date.now() - startTime;
      log.warn(`[PreFlight] Transport error probing [${email}]: ${err.message}`);
      finish({
        email,
        ok: false,
        statusCode: 0,
        latencyMs,
        reason: err.message,
      });
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Concurrently audits all unique Google accounts in the pool with bounded concurrency.
 * Isolates and quarantines black-hole accounts so they are never picked during IDE sessions.
 */
export async function probeAllGoogleAccountsPreflight(
  customModels?: CustomModel[],
  concurrencyLimit = 4,
): Promise<{ healthy: number; quarantined: number; results: PreflightProbeResult[] }> {
  const models = customModels || loadCustomModels();
  const googleAccounts = models.filter((m) => isGoogleCloudCodeModel(m) && (m.accountEmail || m.refreshToken));
  if (googleAccounts.length === 0) {
    return { healthy: 0, quarantined: 0, results: [] };
  }

  const uniqueMap = new Map<string, CustomModel>();
  for (const acc of googleAccounts) {
    const key = (acc.accountEmail || acc.refreshToken || '').toLowerCase();
    if (key && !uniqueMap.has(key)) {
      uniqueMap.set(key, acc);
    }
  }

  const queue = Array.from(uniqueMap.values());
  log.info(`[PreFlight] ?? Starting proactive health check across ${queue.length} unique Google account(s)...`);

  const results: PreflightProbeResult[] = [];
  const safeConcurrency = Math.min(2, concurrencyLimit, queue.length);
  const workers = Array.from({ length: safeConcurrency }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;

      if (
        (item as any).isValidationRequired === true ||
        (item as any).status === 'validation_required' ||
        (item as any).errorDetails?.status === 'VALIDATION_REQUIRED' ||
        isAccountInCooldown(item, 'gemini') ||
        getAccountInFlight(item) > 0
      ) {
        continue;
      }

      const lastUsed = getAccountLastUsed(item);
      if (lastUsed > 0 && Date.now() - lastUsed < 60_000) {
        continue;
      }

      try {
        const probeTimeout = Math.max(10_000, PREFLIGHT_HEALTH_CHECK_TIMEOUT_MS);
        const res = await probeGoogleAccountPreflight(item, probeTimeout);
        results.push(res);
        await new Promise((r) => setTimeout(r, 200));
      } catch (err) {
        log.warn(`[PreFlight] Error probing ${(item.accountEmail || item.name)}:`, err);
      }
    }
  });

  await Promise.allSettled(workers);

  const healthy = results.filter((r) => r.ok).length;
  const quarantined = results.filter((r) => !r.ok && (r.statusCode === 504 || r.statusCode === 403 || r.statusCode === 401)).length;
  log.info(`[PreFlight] Proactive audit finished: ${healthy} Healthy, ${quarantined} Quarantined out of ${results.length} accounts.`);

  return { healthy, quarantined, results };
}
