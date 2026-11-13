import * as http from 'http';
import log from 'electron-log';
import { readBodyWithLimit } from '../bodyLimitGuard';
import { safeWriteHead, safeEnd } from '../../server/httpUtils';
import { loadCustomModels } from '../../../models/catalog/modelLoader';
import { getOpenBreaker } from '../../../resilience/circuit/circuitBreaker';
import {
  isGoogleCloudCodeModel,
  getLiveAccountQuota,
  pollAllGoogleQuotas,
  isTokenRevoked,
  isTokenCached,
} from '../../../../services/auth/googleAuth';
import {
  getAccountQuotaKey,
  verifyAndReconcileCooldowns,
  clearAccountCooldownByKey,
  getAccountInFlight,
  isAccountInProbation,
  getAccountRpmCount,
  getAccountDynamicScore,
  getModelQuotaScore,
  getAccountCooldownRemaining,
  MAX_CONCURRENT_PER_ACCOUNT,
  autoHealAccountOnQuotaRecovery,
} from '../../../resilience/pools/googlePool';

export function handleQuotaAndPoolRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): boolean {
  const url = req.url || '';

  // Force quota refresh
  if (req.method === 'POST' && (url === '/force-quota-refresh' || url === '/pool/quota-refresh')) {
    const models = loadCustomModels();
    const googleModels = models.filter((m) => isGoogleCloudCodeModel(m));
    const accountList = googleModels
      .filter((m, i, arr) => arr.findIndex((x) => getAccountQuotaKey(x) === getAccountQuotaKey(m)) === i)
      .map((m) => m.accountEmail || getAccountQuotaKey(m));

    pollAllGoogleQuotas(googleModels, autoHealAccountOnQuotaRecovery)
      .then(() => { verifyAndReconcileCooldowns(Date.now(), googleModels); })
      .catch(() => {});

    if (safeWriteHead(res, 202, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })) {
      safeEnd(res, JSON.stringify({
        message: 'Quota refresh triggered for all Google accounts. Check /pool-status in ~5s for results.',
        accounts: accountList,
        timestamp: Date.now(),
      }));
    }
    return true;
  }

  // Lift cooldown for an account or family
  if (req.method === 'POST' && (url === '/pool/lift-cooldown' || url === '/lift-cooldown')) {
    readBodyWithLimit(req, res).then((buf) => {
      if (!buf) return;
      try {
        const body = JSON.parse(buf.toString('utf-8')) as { accountKey?: string; family?: string };
        const accountKey = body.accountKey ? String(body.accountKey).trim() : '';
        const family = body.family ? String(body.family).trim() : undefined;
        if (!accountKey) {
          if (safeWriteHead(res, 400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })) {
            safeEnd(res, JSON.stringify({ error: 'accountKey required' }));
          }
          return;
        }
        clearAccountCooldownByKey(accountKey, family);
        log.info(`[Proxy] Cooldown manually lifted for account=${accountKey}${family ? ` (family=${family})` : ''} via API`);
        if (safeWriteHead(res, 200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })) {
          safeEnd(res, JSON.stringify({ ok: true, accountKey, family: family || 'all' }));
        }
      } catch (e: any) {
        if (safeWriteHead(res, 400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })) {
          safeEnd(res, JSON.stringify({ error: 'invalid payload', detail: e?.message }));
        }
      }
    });
    return true;
  }

  // Pool Status Dashboard
  if (req.method === 'GET' && (url === '/pool-status' || url === '/pool/status')) {
    const models = loadCustomModels();
    const googleModels = models.filter((m) => isGoogleCloudCodeModel(m));
    const seenAccounts = new Set<string>();

    const poolStats: Array<{
      accountKey: string;
      email: string;
      name?: string;
      dynamicScore: number;
      baseScore: number;
      geminiQuotaPct: number;
      claudeQuotaPct: number;
      geminiWeeklyPct: number | null;
      claudeWeeklyPct: number | null;
      quotaSource: 'LIVE' | 'STATIC';
      quotaUpdatedAt: number | null;
      quotaAgeMinutes: number | null;
      inFlight: number;
      inProbation: boolean;
      maxConcurrent: number;
      slotAvailable: boolean;
      reauthRequired: boolean;
      rpmLastMinute: number;
      cooldownRemainingSec: number;
      tokenCached: boolean;
      status: 'HEALTHY' | 'PROBATION' | 'COOLDOWN' | 'BREAKER_OPEN' | 'REAUTH_REQUIRED';
    }> = [];

    for (const m of googleModels) {
      const key = getAccountQuotaKey(m);
      if (seenAccounts.has(key)) continue;
      seenAccounts.add(key);

      const email = m.accountEmail || (m as any).email || '';
      const name = m.accountName || m.displayName || m.name;
      const inFlight = getAccountInFlight(m);
      const inProbation = isAccountInProbation(m);
      const rpmLastMinute = getAccountRpmCount(m);
      const dynamicScore = getAccountDynamicScore(m);
      const baseScore = getModelQuotaScore(m);
      const cooldownMs = getAccountCooldownRemaining(m);
      const breaker = getOpenBreaker(m);

      const live = getLiveAccountQuota(key);
      const q = (live || m.quotas) as Record<string, any> | undefined;
      const geminiQuotaPct = typeof q?.geminiFiveHourPct === 'number'
        ? q.geminiFiveHourPct
        : typeof q?.fiveHourPercentage === 'number'
          ? q.fiveHourPercentage
          : 50;
      const claudeQuotaPct = typeof q?.claudeFiveHourPct === 'number' ? q.claudeFiveHourPct : 50;
      const geminiWeeklyPct = typeof q?.geminiWeeklyPct === 'number' ? q.geminiWeeklyPct
        : typeof q?.weeklyPercentage === 'number' ? q.weeklyPercentage : null;
      const claudeWeeklyPct = typeof q?.claudeWeeklyPct === 'number' ? q.claudeWeeklyPct : null;
      const quotaSource: 'LIVE' | 'STATIC' = live ? 'LIVE' : 'STATIC';
      const quotaUpdatedAt = live?.updatedAt || null;
      const quotaAgeMinutes = quotaUpdatedAt ? Math.floor((Date.now() - quotaUpdatedAt) / 60_000) : null;

      const revoked = isTokenRevoked(m.refreshToken);
      let status: 'HEALTHY' | 'PROBATION' | 'COOLDOWN' | 'BREAKER_OPEN' | 'REAUTH_REQUIRED' = 'HEALTHY';
      if (revoked) {
        status = 'REAUTH_REQUIRED';
      } else if (breaker) {
        status = 'BREAKER_OPEN';
      } else if (cooldownMs > 0) {
        status = 'COOLDOWN';
      } else if (inProbation) {
        status = 'PROBATION';
      }

      poolStats.push({
        accountKey: key,
        email,
        name,
        dynamicScore,
        baseScore,
        geminiQuotaPct,
        claudeQuotaPct,
        geminiWeeklyPct,
        claudeWeeklyPct,
        quotaSource,
        quotaUpdatedAt,
        quotaAgeMinutes,
        inFlight,
        inProbation,
        maxConcurrent: MAX_CONCURRENT_PER_ACCOUNT,
        slotAvailable: inFlight < MAX_CONCURRENT_PER_ACCOUNT,
        reauthRequired: revoked,
        rpmLastMinute,
        cooldownRemainingSec: Math.ceil(cooldownMs / 1000),
        tokenCached: isTokenCached(m.refreshToken),
        status,
      });
    }

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(
      JSON.stringify({
        poolSize: poolStats.length,
        maxConcurrentPerAccount: MAX_CONCURRENT_PER_ACCOUNT,
        timestamp: Date.now(),
        accounts: poolStats,
      }),
    );
    return true;
  }

  return false;
}
