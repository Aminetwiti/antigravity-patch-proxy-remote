import { app, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';
import util from 'util';
import { execFile } from 'child_process';
import { DOCTOR_IPC_CHANNELS } from '../../../ipc/channels';
import { EnvironmentConfig } from '../../../config/environment';
import { PROXY_STATS_MAX } from '../../../constants';
import { refreshGoogleToken } from '../../../services/discovery/ideAccountDiscovery';
import { getCustomModelsPath, atomicWriteCustomModels, formatApiError } from './providersIpc';
import { isNotifyEnabled } from '../system/updatesConfigIpc';
import type { MainContext } from '../../types';

const proxyStatsHistory: Array<{ ts: number; latencyMs: number; ok: boolean }> = [];

let tokenEventsCache: {
  mtimeMs: number;
  size: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  requestsCount: number;
  dailyEventsMap: Map<string, { requests: number; promptTokens: number; completionTokens: number; totalTokens: number; cachedTokens: number }>;
  recentEvents: any[];
} | null = null;

const execFileAsync = util.promisify(execFile);

async function queryConversationSummariesDb(dbPath: string): Promise<{
  agg: { c?: number; s?: number; max_s?: number } | null;
  daily: Array<{ day: string; convs: number; steps: number }>;
  sessions: Array<{ conversation_id: string; title: string; step_count: number; last_modified_time: string }>;
}> {
  // Method 1: node:sqlite (native if supported in runtime)
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const agg = db.prepare('SELECT count(*) as c, sum(step_count) as s, max(step_count) as max_s FROM conversation_summaries').get() as any;
    const daily = db.prepare('SELECT substr(last_modified_time, 1, 10) as day, count(*) as convs, sum(step_count) as steps FROM conversation_summaries GROUP BY day ORDER BY day DESC').all() as any[];
    const sessions = db.prepare('SELECT conversation_id, title, step_count, last_modified_time FROM conversation_summaries ORDER BY last_modified_time DESC LIMIT 300').all() as any[];
    db.close();
    return { agg, daily, sessions };
  } catch {
    // node:sqlite unavailable or failed, fallback to python/sqlite3
  }

  // Method 2: Python (standard library sqlite3 available on macOS/Linux/Windows)
  const pyScript = `import sqlite3, json, sys
try:
    conn = sqlite3.connect(sys.argv[1])
    conn.row_factory = sqlite3.Row
    agg_row = conn.execute("SELECT count(*) as c, sum(step_count) as s, max(step_count) as max_s FROM conversation_summaries").fetchone()
    agg = dict(agg_row) if agg_row else {}
    daily_rows = conn.execute("SELECT substr(last_modified_time, 1, 10) as day, count(*) as convs, sum(step_count) as steps FROM conversation_summaries GROUP BY day ORDER BY day DESC").fetchall()
    daily = [dict(r) for r in daily_rows]
    session_rows = conn.execute("SELECT conversation_id, title, step_count, last_modified_time FROM conversation_summaries ORDER BY last_modified_time DESC LIMIT 300").fetchall()
    sessions = [dict(r) for r in session_rows]
    conn.close()
    print(json.dumps({"agg": agg, "daily": daily, "sessions": sessions}))
except Exception as e:
    print(json.dumps({"error": str(e)}))
`;

  for (const pyBin of ['python', 'python3']) {
    try {
      const { stdout } = await execFileAsync(pyBin, ['-c', pyScript, dbPath], { encoding: 'utf-8', timeout: 4000 });
      const res = JSON.parse(stdout);
      if (!res.error && res.daily) return res;
    } catch {
      // Python binary not found or timed out, try next
    }
  }

  // Method 3: sqlite3 CLI fallback
  try {
    const [aggRes, dailyRes, sessRes] = await Promise.all([
      execFileAsync('sqlite3', [dbPath, '-json', 'SELECT count(*) as c, sum(step_count) as s, max(step_count) as max_s FROM conversation_summaries'], { encoding: 'utf-8', timeout: 3000 }),
      execFileAsync('sqlite3', [dbPath, '-json', 'SELECT substr(last_modified_time, 1, 10) as day, count(*) as convs, sum(step_count) as steps FROM conversation_summaries GROUP BY day ORDER BY day DESC'], { encoding: 'utf-8', timeout: 3000 }),
      execFileAsync('sqlite3', [dbPath, '-json', 'SELECT conversation_id, title, step_count, last_modified_time FROM conversation_summaries ORDER BY last_modified_time DESC LIMIT 300'], { encoding: 'utf-8', timeout: 3000 }),
    ]);
    const aggParsed = JSON.parse(aggRes.stdout);
    const dailyParsed = JSON.parse(dailyRes.stdout);
    const sessParsed = JSON.parse(sessRes.stdout);
    return {
      agg: Array.isArray(aggParsed) && aggParsed.length > 0 ? aggParsed[0] : null,
      daily: Array.isArray(dailyParsed) ? dailyParsed : [],
      sessions: Array.isArray(sessParsed) ? sessParsed : [],
    };
  } catch {
    // sqlite3 CLI not found or query failed
  }

  return { agg: null, daily: [], sessions: [] };
}

export function registerStatsTokensIpc(ctx: MainContext): void {
  ipcMain.handle(DOCTOR_IPC_CHANNELS.PROXY_STATS, async () => {
    const start = Date.now();
    try {
      const result = await new Promise<{ ok: boolean; latencyMs: number; stub: boolean; error?: string }>((resolve) => {
        const req = require('http').request(
          { hostname: EnvironmentConfig.bindHost, port: EnvironmentConfig.stubPort, path: '/health', method: 'GET', timeout: 2000 },
          (res: { statusCode: number; headers: Record<string, string>; resume: () => void }) => {
            res.resume();
            resolve({
              ok: true,
              latencyMs: Date.now() - start,
              stub: res.headers['x-proxy-stub'] === '1',
            });
          },
        );
        req.on('timeout', () => { req.destroy(); resolve({ ok: false, latencyMs: 0, stub: false, error: 'timeout' }); });
        req.on('error', (err: Error) => resolve({ ok: false, latencyMs: 0, stub: false, error: err.message }));
        req.end();
      });

      proxyStatsHistory.push({ ts: Date.now(), latencyMs: result.latencyMs, ok: result.ok });
      if (proxyStatsHistory.length > PROXY_STATS_MAX) proxyStatsHistory.shift();

      return {
        ok: true,
        data: {
          current: result,
          history: [...proxyStatsHistory],
          uptime: proxyStatsHistory.length > 0 ? Date.now() - proxyStatsHistory[0].ts : 0,
        },
      };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.TOKEN_REAL_STATS, async () => {
    try {
      const dataDir = path.join(app.getPath('home'), '.gemini', 'antigravity');
      const dbPath = path.join(dataDir, 'conversation_summaries.db');

      let totalConversations = 0;
      let totalSteps = 0;
      let longestTaskSteps = 0;
      let activityByDay: Array<{ day: string; convs: number; steps: number; estimatedTokens: number }> = [];
      let currentStreakDays = 0;
      let longestStreakDays = 0;
      let sessions: any[] = [];

      const GEMINI_5H = 250_000_000;
      const GEMINI_WK_RATIO = 0.13;
      const GEMINI_WK = Math.round(GEMINI_5H / GEMINI_WK_RATIO);
      let poolConsumedWeekly = 0;
      let poolConsumed5h = 0;
      let poolAvailable5h = 0;
      let poolAvailableWeekly = 0;
      let accountsInPool = 0;

      try {
        const cmPath = getCustomModelsPath();
        if (fs.existsSync(cmPath)) {
          const cm = JSON.parse(await fs.promises.readFile(cmPath, 'utf8'));
          const googleProv = cm.providers?.find((p: any) => p.id === 'provider-google');
          if (googleProv && Array.isArray(googleProv.accounts)) {
            accountsInPool = googleProv.accounts.length;
            for (const acc of googleProv.accounts) {
              if (!acc || acc.enabled === false) continue;
              const q = acc.quotas || {};
              const pct5h = q.geminiFiveHourPct ?? q.fiveHourPercentage ?? 100;
              const wkPct = typeof q.geminiWeeklyPct === 'number'
                ? q.geminiWeeklyPct
                : (typeof q.weeklyPercentage === 'number' ? q.weeklyPercentage : 100);
              poolConsumed5h += Math.round((GEMINI_5H * Math.max(0, 100 - pct5h)) / 100);
              poolAvailable5h += Math.round((GEMINI_5H * Math.max(0, Math.min(100, pct5h))) / 100);
              poolConsumedWeekly += Math.round((GEMINI_WK * Math.max(0, 100 - wkPct)) / 100);
              poolAvailableWeekly += Math.round((GEMINI_WK * Math.max(0, Math.min(100, wkPct))) / 100);
            }
          }
        }
      } catch {}

      const eventsPath = path.join(dataDir, 'token_usage_events.jsonl');
      let realTotalTokens = 0;
      let realPromptTokens = 0;
      let realCompletionTokens = 0;
      let realCachedTokens = 0;
      let realTotalRequests = 0;
      let liveEvents: any[] = [];
      let dailyEventsMap = new Map<string, { requests: number; promptTokens: number; completionTokens: number; totalTokens: number; cachedTokens: number }>();

      if (fs.existsSync(eventsPath)) {
        try {
          const stat = await fs.promises.stat(eventsPath);
          const cacheDiskPath = path.join(dataDir, 'token_events_cache.json');
          if (!tokenEventsCache && fs.existsSync(cacheDiskPath)) {
            try {
              const raw = JSON.parse(await fs.promises.readFile(cacheDiskPath, 'utf8'));
              if (raw && typeof raw.totalTokens === 'number') {
                tokenEventsCache = {
                  mtimeMs: raw.mtimeMs || 0,
                  size: raw.size || 0,
                  totalTokens: raw.totalTokens || 0,
                  promptTokens: raw.promptTokens || 0,
                  completionTokens: raw.completionTokens || 0,
                  cachedTokens: raw.cachedTokens || 0,
                  requestsCount: raw.requestsCount || 0,
                  dailyEventsMap: new Map(Object.entries(raw.dailyEvents || {})),
                  recentEvents: Array.isArray(raw.recentEvents) ? raw.recentEvents : [],
                };
              }
            } catch {}
          }

          if (tokenEventsCache && tokenEventsCache.mtimeMs === stat.mtimeMs && tokenEventsCache.size === stat.size) {
            realTotalTokens = tokenEventsCache.totalTokens;
            realPromptTokens = tokenEventsCache.promptTokens;
            realCompletionTokens = tokenEventsCache.completionTokens;
            realCachedTokens = tokenEventsCache.cachedTokens;
            realTotalRequests = tokenEventsCache.requestsCount;
            dailyEventsMap = tokenEventsCache.dailyEventsMap;
            liveEvents = tokenEventsCache.recentEvents;
          } else {
            const eventsContent = await fs.promises.readFile(eventsPath, 'utf8');
            const lines = eventsContent.split('\n');
            const recent: any[] = [];
            const dMap = new Map<string, { requests: number; promptTokens: number; completionTokens: number; totalTokens: number; cachedTokens: number }>();

            for (let i = lines.length - 1; i >= 0; i--) {
              const line = lines[i].trim();
              if (!line) continue;
              try {
                const ev = JSON.parse(line);
                const total = Number(ev.totalTokens) || 0;
                const prompt = Number(ev.promptTokens) || 0;
                const comp = Number(ev.completionTokens) || 0;
                const cached = Number(ev.cachedTokens) || 0;

                realTotalTokens += total;
                realPromptTokens += prompt;
                realCompletionTokens += comp;
                realCachedTokens += cached;
                realTotalRequests++;

                if (recent.length < 50) {
                  recent.push(ev);
                }

                if (ev.timestamp) {
                  let day = '';
                  if (typeof ev.timestamp === 'number') {
                    const d = new Date(ev.timestamp);
                    if (!isNaN(d.getTime())) day = d.toISOString().slice(0, 10);
                  } else if (typeof ev.timestamp === 'string') {
                    if (ev.timestamp.includes('T')) {
                      day = ev.timestamp.slice(0, 10);
                    } else {
                      const d = new Date(Number(ev.timestamp) || ev.timestamp);
                      if (!isNaN(d.getTime())) day = d.toISOString().slice(0, 10);
                    }
                  }
                  if (day) {
                    const existing = dMap.get(day) || { requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedTokens: 0 };
                    existing.requests++;
                    existing.promptTokens += prompt;
                    existing.completionTokens += comp;
                    existing.totalTokens += total;
                    existing.cachedTokens += cached;
                    dMap.set(day, existing);
                  }
                }
              } catch {}
            }

            dailyEventsMap = dMap;
            liveEvents = recent;
            tokenEventsCache = {
              mtimeMs: stat.mtimeMs,
              size: stat.size,
              totalTokens: realTotalTokens,
              promptTokens: realPromptTokens,
              completionTokens: realCompletionTokens,
              cachedTokens: realCachedTokens,
              requestsCount: realTotalRequests,
              dailyEventsMap: dMap,
              recentEvents: recent,
            };

            // Persist cache to disk asynchronously
            try {
              const dailyObj: Record<string, any> = {};
              for (const [k, v] of dMap.entries()) dailyObj[k] = v;
              fs.promises.writeFile(
                cacheDiskPath,
                JSON.stringify({
                  mtimeMs: stat.mtimeMs,
                  size: stat.size,
                  totalTokens: realTotalTokens,
                  promptTokens: realPromptTokens,
                  completionTokens: realCompletionTokens,
                  cachedTokens: realCachedTokens,
                  requestsCount: realTotalRequests,
                  dailyEvents: dailyObj,
                  recentEvents: recent,
                }),
                'utf8'
              ).catch(() => {});
            } catch {}
          }
        } catch {}
      }

      if (fs.existsSync(dbPath)) {
        try {
          const queryResult = await queryConversationSummariesDb(dbPath);
          if (queryResult.agg) {
            totalConversations = Number(queryResult.agg.c) || 0;
            totalSteps = Number(queryResult.agg.s) || 0;
            longestTaskSteps = Number(queryResult.agg.max_s) || 0;
          }
          if (Array.isArray(queryResult.daily)) {
            activityByDay = queryResult.daily.map((d: any) => {
              const ev = dailyEventsMap.get(d.day);
              const realTokens = ev ? ev.totalTokens : 0;
              const fallbackTokens = (Number(d.steps) || 0) * 1250;
              return {
                day: d.day,
                convs: Number(d.convs) || 0,
                steps: Number(d.steps) || 0,
                estimatedTokens: realTokens > 0 ? realTokens : fallbackTokens,
              };
            });
          }
          if (Array.isArray(queryResult.sessions)) {
            sessions = queryResult.sessions.map((s: any) => ({
              id: s.conversation_id,
              title: s.title || 'Untitled Session',
              steps: Number(s.step_count) || 0,
              lastModified: s.last_modified_time || '',
              estimatedTokens: (Number(s.step_count) || 0) * 1250,
            }));
          }
        } catch {}
      }

      const existingDaysSet = new Set(activityByDay.map((a) => a.day));
      for (const [day, ev] of dailyEventsMap.entries()) {
        if (!existingDaysSet.has(day)) {
          existingDaysSet.add(day);
          activityByDay.push({
            day,
            convs: 1,
            steps: ev.requests,
            estimatedTokens: ev.totalTokens,
          });
        }
      }
      activityByDay.sort((a, b) => b.day.localeCompare(a.day));

      if (activityByDay.length > 0) {
        const sortedDays = [...activityByDay].map((a) => a.day).sort();
        let streak = 0;
        let maxStreak = 0;
        let prevDate: Date | null = null;

        for (const dayStr of sortedDays) {
          const curDate = new Date(dayStr);
          if (!prevDate) {
            streak = 1;
          } else {
            const diffDays = Math.round((curDate.getTime() - prevDate.getTime()) / (1000 * 3600 * 24));
            if (diffDays === 1) {
              streak++;
            } else if (diffDays > 1) {
              streak = 1;
            }
          }
          if (streak > maxStreak) maxStreak = streak;
          prevDate = curDate;
        }

        longestStreakDays = maxStreak;

        const todayStr = new Date().toISOString().slice(0, 10);
        const yesterdayDate = new Date();
        yesterdayDate.setDate(yesterdayDate.getDate() - 1);
        const yesterdayStr = yesterdayDate.toISOString().slice(0, 10);

        if (sortedDays.includes(todayStr) || sortedDays.includes(yesterdayStr)) {
          let revStreak = 0;
          let checkDate = sortedDays.includes(todayStr) ? new Date() : yesterdayDate;
          while (true) {
            const checkStr = checkDate.toISOString().slice(0, 10);
            if (sortedDays.includes(checkStr)) {
              revStreak++;
              checkDate.setDate(checkDate.getDate() - 1);
            } else {
              break;
            }
          }
          currentStreakDays = revStreak;
        } else {
          currentStreakDays = 0;
        }
      }

      const totalTokens = realTotalTokens > 0 ? realTotalTokens : (totalSteps * 1250);
      const promptTokens = realPromptTokens > 0 ? realPromptTokens : Math.round(totalTokens * 0.72);
      const completionTokens = realCompletionTokens > 0 ? realCompletionTokens : Math.round(totalTokens * 0.28);
      const cachedTokens = realCachedTokens > 0 ? realCachedTokens : Math.round(promptTokens * 0.45);

      const todayStr = new Date().toISOString().slice(0, 10);
      const todayActivity = activityByDay.find((a) => a.day === todayStr);
      const todayDailyEvent = dailyEventsMap.get(todayStr);
      const tokensToday = todayDailyEvent ? todayDailyEvent.totalTokens : (todayActivity ? todayActivity.estimatedTokens : 0);

      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
      const tokensLast7Days = activityByDay
        .filter((a) => a.day >= sevenDaysAgo)
        .reduce((sum, a) => sum + a.estimatedTokens, 0);

      const daysCount = Math.max(1, activityByDay.length);
      const avgTokensPerDay = Math.round(totalTokens / daysCount);
      const avgTokensPerConv = totalConversations > 0 ? Math.round(totalTokens / totalConversations) : 0;
      const avgStepsPerConv = totalConversations > 0 ? Math.round(totalSteps / totalConversations) : 0;

      const topSessions = [...sessions].sort((a, b) => b.steps - a.steps).slice(0, 10);

      return {
        ok: true,
        data: {
          totalConversations,
          totalSteps,
          longestTaskSteps,
          totalTokens,
          promptTokens,
          completionTokens,
          cachedTokens,
          tokensToday,
          tokensLast7Days,
          avgTokensPerDay,
          avgTokensPerConv,
          avgStepsPerConv,
          currentStreakDays,
          longestStreakDays,
          activityByDay: activityByDay.slice(0, 30),
          recentSessions: sessions.slice(0, 15),
          topSessions,
          liveEvents,
          poolMetrics: {
            accountsInPool,
            poolConsumed5h,
            poolAvailable5h,
            poolConsumedWeekly,
            poolAvailableWeekly,
            singleAccount5hCap: GEMINI_5H,
            singleAccountWeeklyCap: GEMINI_WK,
          },
        },
      };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.PROXY_ERROR_HISTORY, async () => {
    return ctx.getProxyErrorHistory().slice().reverse();
  });

  ipcMain.on(DOCTOR_IPC_CHANNELS.PROXY_ERROR, (_evt, payload: {
    traceId: string;
    provider: string;
    status?: number;
    errorType: string;
    rawError: string;
    title: string;
    message: string;
    suggestions: string[];
    actionUrl?: string;
  }) => {
    if (!payload || !payload.title) return;
    const sev: 'warn' | 'err' = payload.status && payload.status >= 500
      || payload.errorType === 'auth_401' || payload.errorType === 'auth_403'
      || payload.errorType === 'quota_429' || payload.errorType === 'timeout'
      ? 'err'
      : 'warn';
    ctx.updateTray(sev);
    ctx.pushProxyErrorHistory({
      traceId: payload.traceId,
      provider: payload.provider,
      status: payload.status,
      errorType: payload.errorType,
      rawError: payload.rawError,
      title: payload.title,
      message: payload.message,
      suggestions: payload.suggestions ?? [],
      actionUrl: payload.actionUrl,
      at: Date.now(),
    });
    if (sev === 'err' && isNotifyEnabled(ctx)) {
      ctx.notifyProxyError({
        traceId: payload.traceId,
        provider: payload.provider,
        title: payload.title,
        message: payload.message || payload.rawError,
      });
    }
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.TEST_MODEL, async (_evt, name: string) => {
    try {
      const r = await ctx.getCliPool().run(['models', 'test', name, '--json']);
      try {
        return { ok: true, data: JSON.parse(r.stdout) };
      } catch {
        return { ok: r.code === 0, data: { ok: r.code === 0, message: r.stdout.trim() || r.stderr.trim() } };
      }
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.MODEL_PING_PONG, async (_evt, params: { modelId: string; providerId?: string; prompt?: string }) => {
    try {
      const cleanModel = (params.modelId || '').replace(/^models\//, '');
      const prompt = params.prompt || 'ping';
      let apiKey = '';
      let apiUrl = '';
      let providerName = '';
      let provId = params.providerId;
      let isOAuthGoogle = false;
      let projectId = 'aicode-consumers';

      let fp = '';
      let parsed: any = null;
      let prov: any = null;
      let candidateAccounts: any[] = [];

      try {
        fp = getCustomModelsPath();
        if (fs.existsSync(fp)) {
          const c = await fs.promises.readFile(fp, 'utf8');
          parsed = JSON.parse(c.replace(/^\uFEFF/, ''));
          if (parsed.providers && Array.isArray(parsed.providers)) {
            prov = provId
              ? parsed.providers.find((p: any) => p.id === provId)
              : parsed.providers.find((p: any) =>
                  (p.models || []).some((m: any) => (m.id || m.name) === cleanModel || (m.id || m.name) === params.modelId || (m.id || m.name) === `models/${cleanModel}`)
                );
            if (!prov && (cleanModel.startsWith('gemini-') || cleanModel.startsWith('claude-'))) {
              prov = parsed.providers.find((p: any) => p.provider === 'google' || p.provider === 'gemini');
            }
            if (prov) {
              apiKey = prov.apiKey || '';
              apiUrl = prov.apiUrl || '';
              providerName = prov.provider || '';
              provId = prov.id;
              if (Array.isArray(prov.accounts) && prov.accounts.length > 0) {
                candidateAccounts = prov.accounts.filter((a: any) => a.enabled !== false && (a.apiKey || a.refreshToken));
                if (candidateAccounts.length === 0) candidateAccounts = [prov.accounts[0]];
                const firstAcc = candidateAccounts[0];
                if (firstAcc) {
                  if (firstAcc.projectId) projectId = firstAcc.projectId;
                  if (firstAcc.apiKey) apiKey = firstAcc.apiKey;
                  if (firstAcc.refreshToken || (firstAcc.apiKey && firstAcc.apiKey.startsWith('ya29.'))) {
                    isOAuthGoogle = true;
                  }
                }
              }
            }
          }
        }
      } catch {}

      const isGoogle = providerName === 'google' || providerName === 'gemini' || (apiUrl && apiUrl.includes('googleapis.com')) || (!apiUrl && cleanModel.toLowerCase().includes('gemini'));
      const isCloudCodeGoogle = isGoogle && (isOAuthGoogle || (apiKey && apiKey.startsWith('ya29.')) || cleanModel.includes('tiered') || cleanModel.includes('-pro-high'));

      if (!apiUrl) {
        apiUrl = isGoogle ? 'https://generativelanguage.googleapis.com/v1beta' : 'http://127.0.0.1:51074/v1';
      }

      const { net } = require('electron') as typeof import('electron');
      const startTime = Date.now();

      const doRequest = (targetUrl: string, body: string, headers: Record<string, string>): Promise<{ statusCode: number; data: string; latencyMs: number }> => {
        return new Promise((resolve, reject) => {
          const req = net.request({ url: targetUrl, method: 'POST' });
          for (const [k, v] of Object.entries(headers)) {
            if (v) req.setHeader(k, v);
          }
          req.on('response', (res: Electron.IncomingMessage) => {
            let data = '';
            res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
            res.on('end', () => {
              resolve({ statusCode: res.statusCode ?? 500, data, latencyMs: Date.now() - startTime });
            });
          });
          req.on('error', (err: Error) => reject(err));
          req.write(body);
          req.end();
        });
      };

      let targetUrl = '';
      let body = '';
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      let res: { statusCode: number; data: string; latencyMs: number } = { statusCode: 500, data: '', latencyMs: 0 };

      if (isCloudCodeGoogle) {
        const cloudCodeHosts = ['https://daily-cloudcode-pa.googleapis.com', 'https://cloudcode-pa.googleapis.com'];
        headers['User-Agent'] = 'antigravity';

        const accountsList = candidateAccounts.length > 0 ? candidateAccounts : [{ apiKey, refreshToken: undefined, projectId }];
        for (let i = 0; i < accountsList.length; i++) {
          const curAcc = accountsList[i];
          let curKey = curAcc.apiKey || apiKey;
          if (curAcc.refreshToken) {
            const refreshed = await refreshGoogleToken(curAcc.refreshToken);
            if (refreshed && refreshed.accessToken) {
              curKey = refreshed.accessToken;
              curAcc.apiKey = refreshed.accessToken;
              if (fp && parsed) {
                try { await atomicWriteCustomModels(fp, parsed); } catch {}
              }
            }
          }
          if (curKey && curKey !== 'auto' && curKey !== 'none' && !curKey.startsWith('enc:')) {
            headers['Authorization'] = `Bearer ${curKey}`;
          }
          body = JSON.stringify({
            project: curAcc.projectId || projectId,
            model: cleanModel,
            request: {
              contents: [{ role: 'user', parts: [{ text: prompt }] }],
              generationConfig: { maxOutputTokens: 64 }
            }
          });

          for (const host of cloudCodeHosts) {
            res = await doRequest(`${host}/v1internal:generateContent`, body, headers);
            if (res.statusCode >= 200 && res.statusCode < 300) break;
          }
          if (res.statusCode >= 200 && res.statusCode < 300) break;
        }
      } else if (isGoogle) {
        targetUrl = `${apiUrl.replace(/\/+$/, '')}/models/${cleanModel}:generateContent`;
        if (apiKey && apiKey !== 'auto' && apiKey !== 'none' && !apiKey.startsWith('enc:')) {
          headers['x-goog-api-key'] = apiKey;
        }
        body = JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 64 }
        });
        res = await doRequest(targetUrl, body, headers);
      } else {
        targetUrl = `${apiUrl.replace(/\/+$/, '')}/chat/completions`;
        if (apiKey && apiKey !== 'auto' && apiKey !== 'none' && !apiKey.startsWith('enc:')) {
          headers['Authorization'] = `Bearer ${apiKey}`;
        }
        body = JSON.stringify({
          model: cleanModel,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 16
        });
        res = await doRequest(targetUrl, body, headers);
      }
      let pongText = '';
      try {
        const parsed = JSON.parse(res.data);
        if (isGoogle) {
          const parts = parsed.response?.candidates?.[0]?.content?.parts || parsed.candidates?.[0]?.content?.parts;
          pongText = parts?.find((p: any) => p.text)?.text || parts?.[0]?.text || '';
        } else {
          pongText = parsed.choices?.[0]?.message?.content || parsed.choices?.[0]?.text || '';
        }
      } catch {
        pongText = res.data;
      }

      const ok = res.statusCode >= 200 && res.statusCode < 300;
      return {
        ok,
        status: res.statusCode,
        latencyMs: res.latencyMs,
        pongText: pongText.trim(),
        error: ok ? undefined : formatApiError(res.data, res.statusCode)
      };
    } catch (err) {
      return {
        ok: false,
        status: 0,
        latencyMs: 0,
        pongText: '',
        error: (err as Error).message
      };
    }
  });
}
