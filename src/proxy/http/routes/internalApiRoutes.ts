import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import log from 'electron-log';
import { DEFAULT_REMOTE_HOST, DEFAULT_REMOTE_TOKEN } from '../../../constants';
import { readBodyWithLimit } from './bodyLimitGuard';
import { safeWriteHead, safeEnd } from '../server/httpUtils';
import {
  isRemoteVpsActive,
  remoteVpsHost,
  remoteVpsToken,
  remoteSessionsMap,
  updateRemoteVpsConfig,
  executeOnRemoteDaemon,
} from '../../state/remote/remoteState';
import { snapshot as diagnosticsSnapshot, formatSnapshot as diagnosticsFormat } from '../../state/observability/diagnostics';
import { metricsEnabled, getMetricsSnapshot, formatPrometheus, negotiateContentType } from './metricsRoute';
import { loadCustomModels } from '../../models/catalog/modelLoader';
import { generateModelPlaceholderId } from '../../models/catalog/idGenerator';
import { getOpenBreaker } from '../../resilience/circuit/circuitBreaker';
import {
  isGoogleCloudCodeModel,
  getLiveAccountQuota,
  pollAllGoogleQuotas,
  isTokenRevoked,
  isTokenCached,
} from '../../../services/auth/googleAuth';
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
} from '../../resilience/pools/googlePool';

export function handleInternalApiRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): boolean {
  const url = req.url || '';

  // Remote VPS Agent State Sync (from IDE Webview or preload)
  if (url === '/api/remote/status' || url.startsWith('/api/remote/status?')) {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          active: isRemoteVpsActive,
          host: remoteVpsHost,
          hasToken: Boolean(remoteVpsToken || DEFAULT_REMOTE_TOKEN),
          remoteSessions: remoteSessionsMap,
        }),
      );
      return true;
    }
    if (req.method === 'POST') {
      readBodyWithLimit(req, res).then((buf) => {
        if (!buf) return;
        try {
          const b = JSON.parse(buf.toString('utf-8')) as {
            active?: boolean;
            host?: string;
            token?: string;
            remoteSessions?: Record<string, boolean>;
          };
          updateRemoteVpsConfig(b);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, active: isRemoteVpsActive, host: remoteVpsHost }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid payload', detail: (e as Error).message }));
        }
      });
      return true;
    }
    return true;
  }

  // Marketplace Plugin Installation Bridge
  if (url === '/api/plugins/install' && req.method === 'POST') {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
        const files: Array<{ path: string; content: string }> = body.files || [];
        const baseDir = path.join(os.homedir(), '.gemini', 'config', 'plugins');
        for (const file of files) {
          const targetPath = path.isAbsolute(file.path) ? file.path : path.join(baseDir, file.path);
          fs.mkdirSync(path.dirname(targetPath), { recursive: true });
          fs.writeFileSync(targetPath, file.content, 'utf-8');
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: true, count: files.length }));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: false, error: err?.message }));
      }
    });
    return true;
  }

  if (url === '/api/plugins/uninstall' && req.method === 'POST') {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
        const rawId = body.pluginId || body.id || body.slug || '';
        const slug = rawId.split('/').pop() || rawId;
        const targetDir = path.join(os.homedir(), '.gemini', 'config', 'plugins', slug);
        if (fs.existsSync(targetDir)) {
          fs.rmSync(targetDir, { recursive: true, force: true });
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: false, error: err?.message }));
      }
    });
    return true;
  }

  // UI & Chat Enhancements Configuration Bridge (GET/POST /api/ui/config)
  if (url === '/api/ui/config' || url.startsWith('/api/ui/config?')) {
    const DEFAULT_SUGGESTIONS = [
      { label: '/plan', text: '/plan ' },
      { label: 'Continue', text: 'Continue' },
      { label: 'Analyser et auditer', text: 'Analyser et auditer le code et les erreurs' },
      { label: 'Keep going', text: 'Keep going' },
      { label: 'Ex�cuter all steps', text: 'Ex�cuter toutes les �tapes pr�vues' },
      { label: 'Next phase', text: 'Passer � la phase suivante (Next phase)' },
    ];
    const getConfigPath = () => {
      const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
      return path.join(home, '.gemini', 'antigravity', 'config.json');
    };
    const readUiConfig = () => {
      try {
        const p = getConfigPath();
        if (fs.existsSync(p)) {
          const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
          const ui = parsed.ui || {};
          return {
            retryButton: ui.retryButton !== false,
            suggestionPills: ui.suggestionPills !== false,
            suggestions: Array.isArray(ui.suggestions) && ui.suggestions.length > 0 ? ui.suggestions : DEFAULT_SUGGESTIONS,
          };
        }
      } catch (_) {}
      return { retryButton: true, suggestionPills: true, suggestions: DEFAULT_SUGGESTIONS };
    };

    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(readUiConfig()));
      return true;
    }
    if (req.method === 'POST') {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const p = getConfigPath();
          let parsed: any = {};
          if (fs.existsSync(p)) {
            try { parsed = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) {}
          }
          parsed.ui = { ...(parsed.ui || {}), ...body };
          fs.mkdirSync(path.dirname(p), { recursive: true });
          fs.writeFileSync(p, JSON.stringify(parsed, null, 2), 'utf8');
          log.info(`[Proxy] Updated UI configuration: retryButton=${parsed.ui.retryButton}, suggestionPills=${parsed.ui.suggestionPills}`);
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ ok: true, ...readUiConfig() }));
        } catch (e: any) {
          res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: e?.message || 'Invalid JSON' }));
        }
      });
      return true;
    }
    return true;
  }

  // Remote VPS Command Execution Bridge (POST /api/remote/cmd)
  if (url === '/api/remote/cmd' || url.startsWith('/api/remote/cmd?')) {
    if (req.method === 'POST') {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', async () => {
        try {
          const b = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as {
            command?: string;
            host?: string;
            token?: string;
            workspaceId?: string;
            sessionId?: string;
            timeoutMs?: number;
          };
          const targetHost = b.host || remoteVpsHost || DEFAULT_REMOTE_HOST;
          const rawToken = b.token ? String(b.token).trim() : '';
          const token = (rawToken && rawToken !== 'null' && rawToken !== 'undefined')
            ? rawToken
            : (remoteVpsToken || DEFAULT_REMOTE_TOKEN);
          const cmd = b.command || '';
          const result = await executeOnRemoteDaemon(targetHost, token, cmd, b.workspaceId, b.sessionId, b.timeoutMs);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: (e as Error).message }));
        }
      });
      return true;
    }
    return true;
  }

  // Diagnostics (__diag__)
  if (req.method === 'GET' && (url === '/__diag__' || url.startsWith('/__diag__?'))) {
    try {
      const accept = String(req.headers['accept'] ?? '');
      const snapshot = diagnosticsSnapshot();
      if (accept.includes('text/markdown') || accept.includes('text/plain')) {
        res.writeHead(200, {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(diagnosticsFormat(snapshot));
        return true;
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(snapshot, null, 2));
      return true;
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'failed to render diagnostics', detail: (e as Error).message }));
      return true;
    }
  }

  // Prometheus Metrics (__metrics__)
  if (req.method === 'GET' && (url === '/__metrics__' || url.startsWith('/__metrics__?'))) {
    if (!metricsEnabled()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('metrics disabled; set AG_METRICS_ENABLED=1 to enable\n');
      return true;
    }
    try {
      const snap = getMetricsSnapshot();
      const ct = negotiateContentType(String(req.headers['accept'] ?? ''));
      if (ct.includes('json')) {
        res.writeHead(200, { 'Content-Type': ct, 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(snap, null, 2));
        return true;
      }
      res.writeHead(200, { 'Content-Type': ct, 'Cache-Control': 'no-store' });
      res.end(formatPrometheus(snap));
      return true;
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'failed to render metrics', detail: (e as Error).message }));
      return true;
    }
  }

  // Per-model health status
  if (req.method === 'GET' && url === '/model-health') {
    const customModels = loadCustomModels();
    const statuses: Record<string, { status: string; errorType?: string; trippedAt?: number; failures?: number }> = {};
    for (const m of customModels) {
      const placeholderId = generateModelPlaceholderId(m);
      const breaker = getOpenBreaker(m);
      if (breaker) {
        statuses[placeholderId] = {
          status: 'error',
          errorType: breaker.errorType,
          trippedAt: breaker.trippedAt,
          failures: breaker.failures,
        };
      } else {
        statuses[placeholderId] = { status: 'healthy' };
      }
    }
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify({ models: statuses, timestamp: Date.now() }));
    return true;
  }

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
