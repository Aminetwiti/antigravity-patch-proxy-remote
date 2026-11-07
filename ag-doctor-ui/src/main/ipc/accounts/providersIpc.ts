import { app, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';
import { DOCTOR_IPC_CHANNELS } from '../../../ipc/channels';
import { refreshGoogleToken, fetchGoogleAccountQuotas } from '../../../services/discovery/ideAccountDiscovery';
import type { MainContext } from '../../types';

export function getCustomModelsPath(): string {
  return path.join(app.getPath('home'), '.gemini', 'antigravity', 'custom_models.json');
}

let customModelsWriteLock: Promise<void> = Promise.resolve();

export async function atomicWriteCustomModels(filePath: string, data: unknown): Promise<void> {
  const op = async () => {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    try {
      await fs.promises.rename(tmp, filePath);
    } catch (err: any) {
      if (err?.code === 'EPERM' || err?.code === 'EBUSY') {
        await new Promise((r) => setTimeout(r, 60));
        await fs.promises.copyFile(tmp, filePath);
        await fs.promises.unlink(tmp).catch(() => {});
      } else {
        await fs.promises.unlink(tmp).catch(() => {});
        throw err;
      }
    }
  };
  customModelsWriteLock = customModelsWriteLock.then(op, op);
  return customModelsWriteLock;
}

export function formatApiError(raw: any, statusCode?: number): string {
  if (!raw) return statusCode ? `HTTP ${statusCode}` : 'Erreur inconnue';
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const msg = parsed?.error?.message || parsed?.message || (typeof parsed?.error === 'string' ? parsed.error : '');
    if (msg) {
      if (parsed?.error?.type === 'billing_error' || /insufficient balance/i.test(msg)) {
        return `Solde épuisé : ${msg}`;
      }
      if (parsed?.error?.status === 'RESOURCE_EXHAUSTED' || /quota|exhausted/i.test(msg)) {
        return `Quota épuisé : ${msg}`;
      }
      if (parsed?.error?.details?.[0]?.reason === 'API_KEY_INVALID' || /API key not valid/i.test(msg)) {
        return `Clé API invalide ou expirée`;
      }
      return msg;
    }
  } catch {}
  return text.length > 200 ? text.slice(0, 200) + '…' : text;
}

let watcherDebounce: NodeJS.Timeout | null = null;

export function registerProvidersIpc(ctx: MainContext): void {
  // Real-time File Watcher
  try {
    const customModelsPath = getCustomModelsPath();
    const customModelsDir = path.dirname(customModelsPath);
    if (!fs.existsSync(customModelsDir)) {
      fs.mkdirSync(customModelsDir, { recursive: true });
    }
    fs.watch(customModelsDir, (_eventType, filename) => {
      if (filename && filename.includes('custom_models.json')) {
        if (watcherDebounce) clearTimeout(watcherDebounce);
        watcherDebounce = setTimeout(() => {
          const mainWindow = ctx.getMainWindow();
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(DOCTOR_IPC_CHANNELS.PROVIDERS_CHANGED);
          }
        }, 300);
      }
    });
  } catch (err) {
    console.warn('[providersIpc] Error setting up custom_models watcher:', err);
  }

  ipcMain.handle(DOCTOR_IPC_CHANNELS.PROVIDERS_GET, async () => {
    try {
      const p = getCustomModelsPath();
      const c = await fs.promises.readFile(p, 'utf8');
      const parsed = JSON.parse(c.replace(/^\uFEFF/, ''));

      let quotaCache: Record<string, any> = {};
      let unlicensedAccountsList: string[] = [];
      let accountCooldownsMap: Record<string, number> = {};
      try {
        const qCachePath = path.join(app.getPath('home'), '.gemini', 'antigravity', 'quota_cache.json');
        const qRaw = await fs.promises.readFile(qCachePath, 'utf8');
        const parsedCache = JSON.parse(qRaw);
        quotaCache = parsedCache.quotas || {};
        unlicensedAccountsList = Array.isArray(parsedCache.unlicensedAccounts) ? parsedCache.unlicensedAccounts : [];
        accountCooldownsMap = parsedCache.accountCooldowns || {};
      } catch { /* skip */ }

      if (parsed.providers && Array.isArray(parsed.providers) && (Object.keys(quotaCache).length > 0 || unlicensedAccountsList.length > 0 || Object.keys(accountCooldownsMap).length > 0)) {
        const unSet = new Set(unlicensedAccountsList.map((s) => s.toLowerCase().trim()));
        const now = Date.now();
        for (const prov of parsed.providers) {
          if (!Array.isArray(prov.accounts)) continue;
          for (const acc of prov.accounts) {
            const email = (acc.email || '').toLowerCase().trim();
            const id = (acc.id || '').toLowerCase().trim();
            const cleanId = id.replace(/^(google|gemini-cli):/, '');
            const isMarkedUnlicensed = unSet.has(email) || unSet.has(`google:${email}`) || unSet.has(`gemini-cli:${email}`) || unSet.has(id) || unSet.has(cleanId);
            let cacheEntry = quotaCache[`google:${email}`] || quotaCache[`gemini-cli:${email}`] || quotaCache[email] || quotaCache[acc.id] || quotaCache[cleanId];
            if (!cacheEntry && (email || cleanId)) {
              for (const [ck, cv] of Object.entries(quotaCache)) {
                const lck = ck.toLowerCase();
                if ((email && lck.includes(email)) || (cleanId && lck.includes(cleanId))) {
                  cacheEntry = cv;
                  break;
                }
              }
            }

            let hasGeminiCd = false;
            let isGeminiWk = false;
            let cdGeminiUntil = 0;
            let hasClaudeCd = false;
            let isClaudeWk = false;
            let cdClaudeUntil = 0;

            for (const [cdK, until] of Object.entries(accountCooldownsMap)) {
              if (typeof until !== 'number' || until <= now) continue;
              const lcdk = cdK.toLowerCase();
              const cleanCdk = lcdk.replace(/^(google|gemini-cli):/, '').replace(/:(gemini|claude)$/, '');
              const matchesAcc = (email && cleanCdk === email) || (cleanId && cleanCdk === cleanId) || (email && lcdk.includes(email)) || (cleanId && lcdk.includes(cleanId));
              if (!matchesAcc) continue;
              const isWkCap = (until - now) > 5 * 3600000;
              if (lcdk.endsWith(':claude')) {
                hasClaudeCd = true;
                if (isWkCap) isClaudeWk = true;
                cdClaudeUntil = Math.max(cdClaudeUntil, until);
              } else if (lcdk.endsWith(':gemini')) {
                hasGeminiCd = true;
                if (isWkCap) isGeminiWk = true;
                cdGeminiUntil = Math.max(cdGeminiUntil, until);
              } else {
                hasGeminiCd = true;
                hasClaudeCd = true;
                if (isWkCap) { isGeminiWk = true; isClaudeWk = true; }
                cdGeminiUntil = Math.max(cdGeminiUntil, until);
                cdClaudeUntil = Math.max(cdClaudeUntil, until);
              }
            }

            if (!cacheEntry && !isMarkedUnlicensed && !hasGeminiCd && !hasClaudeCd) continue;
            if (!acc.quotas) acc.quotas = {};

            const cacheAgeMs = cacheEntry?.updatedAt ? (now - Number(cacheEntry.updatedAt)) : Infinity;
            const accAgeMs = acc.quotas?.updatedAt ? (now - Number(acc.quotas.updatedAt)) : Infinity;
            const isCacheFreshEnough = cacheAgeMs <= 10 * 60 * 1000 || cacheAgeMs <= accAgeMs;

            if (cacheEntry && typeof cacheEntry.geminiFiveHourPct === 'number' && (isCacheFreshEnough || typeof acc.quotas.geminiFiveHourPct !== 'number')) {
              acc.quotas.geminiFiveHourPct = cacheEntry.geminiFiveHourPct;
            }
            if (cacheEntry && typeof cacheEntry.geminiWeeklyPct === 'number' && (isCacheFreshEnough || typeof acc.quotas.geminiWeeklyPct !== 'number')) {
              acc.quotas.geminiWeeklyPct = cacheEntry.geminiWeeklyPct;
            }
            if (cacheEntry && typeof cacheEntry.fiveHourPercentage === 'number' && (isCacheFreshEnough || typeof acc.quotas.fiveHourPercentage !== 'number')) {
              acc.quotas.fiveHourPercentage = cacheEntry.fiveHourPercentage;
            } else if (cacheEntry && typeof cacheEntry.geminiFiveHourPct === 'number' && (isCacheFreshEnough || typeof acc.quotas.fiveHourPercentage !== 'number')) {
              acc.quotas.fiveHourPercentage = cacheEntry.geminiFiveHourPct;
            }
            if (cacheEntry && typeof cacheEntry.weeklyPercentage === 'number' && (isCacheFreshEnough || typeof acc.quotas.weeklyPercentage !== 'number')) {
              acc.quotas.weeklyPercentage = cacheEntry.weeklyPercentage;
            } else if (cacheEntry && typeof cacheEntry.geminiWeeklyPct === 'number' && (isCacheFreshEnough || typeof acc.quotas.weeklyPercentage !== 'number')) {
              acc.quotas.weeklyPercentage = cacheEntry.geminiWeeklyPct;
            }
            if (cacheEntry && (cacheEntry.geminiFiveHourReset || cacheEntry.geminiResetTime)) {
              acc.quotas.geminiFiveHourReset = cacheEntry.geminiFiveHourReset || cacheEntry.geminiResetTime;
              acc.quotas.geminiResetTime = acc.quotas.geminiFiveHourReset;
            }
            if (cacheEntry && cacheEntry.geminiWeeklyReset) {
              acc.quotas.geminiWeeklyReset = cacheEntry.geminiWeeklyReset;
            }
            if (cacheEntry && typeof cacheEntry.claudeFiveHourPct === 'number' && (isCacheFreshEnough || typeof acc.quotas.claudeFiveHourPct !== 'number')) {
              acc.quotas.claudeFiveHourPct = cacheEntry.claudeFiveHourPct;
            }
            if (cacheEntry && typeof cacheEntry.claudeWeeklyPct === 'number' && (isCacheFreshEnough || typeof acc.quotas.claudeWeeklyPct !== 'number')) {
              acc.quotas.claudeWeeklyPct = cacheEntry.claudeWeeklyPct;
            }
            if (cacheEntry && (cacheEntry.claudeFiveHourReset || cacheEntry.claudeResetTime)) {
              acc.quotas.claudeFiveHourReset = cacheEntry.claudeFiveHourReset || cacheEntry.claudeResetTime;
              acc.quotas.claudeResetTime = acc.quotas.claudeFiveHourReset;
            }
            if (cacheEntry && cacheEntry.claudeWeeklyReset) {
              acc.quotas.claudeWeeklyReset = cacheEntry.claudeWeeklyReset;
            }
            if (cacheEntry && typeof cacheEntry.argonFiveHourPct === 'number' && (isCacheFreshEnough || typeof acc.quotas.argonFiveHourPct !== 'number')) {
              acc.quotas.argonFiveHourPct = cacheEntry.argonFiveHourPct;
            }
            if (cacheEntry && typeof cacheEntry.argonWeeklyPct === 'number' && (isCacheFreshEnough || typeof acc.quotas.argonWeeklyPct !== 'number')) {
              acc.quotas.argonWeeklyPct = cacheEntry.argonWeeklyPct;
            }
            if (cacheEntry && cacheEntry.argonFiveHourReset) {
              acc.quotas.argonFiveHourReset = cacheEntry.argonFiveHourReset;
            }
            if (cacheEntry && cacheEntry.argonWeeklyReset) {
              acc.quotas.argonWeeklyReset = cacheEntry.argonWeeklyReset;
            }
            if (cacheEntry && cacheEntry.updatedAt && (isCacheFreshEnough || !acc.quotas.updatedAt)) {
              acc.quotas.updatedAt = cacheEntry.updatedAt;
              acc.updatedAt = cacheEntry.updatedAt;
            } else if (acc.quotas.updatedAt && !acc.updatedAt) {
              acc.updatedAt = acc.quotas.updatedAt;
            }
            if (cacheEntry && cacheEntry.tier) acc.tier = cacheEntry.tier;
            if (cacheEntry && cacheEntry.tierId) acc.tierId = cacheEntry.tierId;

            if (hasGeminiCd) {
              acc.quotas.geminiFiveHourPct = 0;
              acc.quotas.fiveHourPercentage = 0;
              acc.quotas.geminiFiveHourReset = new Date(cdGeminiUntil).toISOString();
              if (isGeminiWk) {
                acc.quotas.geminiWeeklyPct = 0;
                acc.quotas.weeklyPercentage = 0;
                acc.quotas.geminiWeeklyReset = new Date(cdGeminiUntil).toISOString();
              }
            }
            if (hasClaudeCd) {
              acc.quotas.claudeFiveHourPct = 0;
              acc.quotas.claudeFiveHourReset = new Date(cdClaudeUntil).toISOString();
              if (isClaudeWk) {
                acc.quotas.claudeWeeklyPct = 0;
                acc.quotas.claudeWeeklyReset = new Date(cdClaudeUntil).toISOString();
              }
            }

            if (isMarkedUnlicensed || cacheEntry?.isUnlicensed) {
              acc.isUnlicensed = true;
              if (acc.quotas) acc.quotas.isUnlicensed = true;
            } else {
              delete acc.isUnlicensed;
              if (acc.quotas) delete acc.quotas.isUnlicensed;
            }
            if (cacheEntry?.errorDetails) {
              acc.errorDetails = cacheEntry.errorDetails;
              acc.quotas.errorDetails = cacheEntry.errorDetails;
            }
          }
        }
      }

      if (parsed.providers && Array.isArray(parsed.providers)) {
        return parsed.providers;
      }
      if (parsed.models && Array.isArray(parsed.models)) {
        const pm = new Map<string, any>();
        for (const m of parsed.models) {
          const provId = m.provider || 'custom';
          if (!pm.has(provId)) {
            pm.set(provId, {
              id: provId,
              name: provId.charAt(0).toUpperCase() + provId.slice(1),
              provider: provId,
              apiUrl: m.apiUrl || '',
              apiKey: m.apiKey || '',
              enabled: true,
              models: [],
            });
          }
          pm.get(provId).models.push({
            id: m.id || m.name,
            displayName: m.displayName || m.name || m.id,
            enabled: m.enabled !== false,
          });
        }
        const migrated = Array.from(pm.values());
        parsed.providers = migrated;
        delete parsed.models;
        await fs.promises.writeFile(p, JSON.stringify(parsed, null, 2), 'utf8');
        return migrated;
      }
      return [];
    } catch (err) {
      console.error("[DOCTOR PROVIDERS_GET ERROR]", err);
      return [];
    }
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.PROVIDERS_SAVE, async (_, p) => {
    try {
      const fp = getCustomModelsPath();
      let parsed: { providers: any[]; models?: any[] } = { providers: [], models: [] };
      try {
        const c = await fs.promises.readFile(fp, 'utf8');
        parsed = JSON.parse(c.replace(/^\uFEFF/, ''));
      } catch {}

      if (!parsed.providers) parsed.providers = [];
      const idx = parsed.providers.findIndex((x: any) => x.id === p.id);
      if (idx !== -1) {
        const existing = parsed.providers[idx];
        const isGoogle = p.provider === 'google' || existing.provider === 'google';
        const modelsToSave = (isGoogle && (!p.models || p.models.length === 0))
          ? (existing.models && existing.models.length > 0 ? existing.models : undefined)
          : (p.models !== undefined ? p.models : existing.models);

        let accountsToSave = p.accounts !== undefined ? p.accounts : existing.accounts;
        if (Array.isArray(accountsToSave) && Array.isArray(modelsToSave)) {
          for (const acc of accountsToSave) {
            if (Array.isArray(acc.models)) {
              for (const pm of modelsToSave) {
                const pmId = pm.id || pm.displayName;
                if (!pmId) continue;
                const cleanPmId = String(pmId).replace(/^models\//, '');
                const accM = acc.models.find((m: any) => m && (m.id === pmId || m.id === cleanPmId || m.displayName === pm.displayName || m.displayName === pmId));
                if (accM) {
                  accM.enabled = pm.enabled !== false;
                } else if (pm.enabled === false) {
                  acc.models.push({
                    id: cleanPmId,
                    displayName: pm.displayName || cleanPmId,
                    enabled: false,
                  });
                }
              }
            }
          }
        }

        parsed.providers[idx] = {
          ...existing,
          ...p,
          models: modelsToSave,
          accounts: accountsToSave,
          updatedAt: new Date().toISOString(),
        };

        // If this is a Google provider, sync the updated model enabled states across all other Google providers in parsed.providers
        if (isGoogle && Array.isArray(modelsToSave)) {
          for (let i = 0; i < parsed.providers.length; i++) {
            if (i === idx) continue;
            const other = parsed.providers[i];
            if (other && (other.provider === 'google' || other.provider === 'gemini' || other.id?.startsWith('google-'))) {
              if (Array.isArray(other.models)) {
                for (const pm of modelsToSave) {
                  const pmId = pm.id || pm.displayName;
                  if (!pmId) continue;
                  const cleanPmId = String(pmId).replace(/^models\//, '');
                  const om = other.models.find((m: any) => m && (m.id === pmId || m.id === cleanPmId || m.displayName === pm.displayName || m.displayName === pmId));
                  if (om) {
                    om.enabled = pm.enabled !== false;
                  } else if (pm.enabled === false) {
                    other.models.push({
                      id: cleanPmId,
                      displayName: pm.displayName || cleanPmId,
                      enabled: false,
                    });
                  }
                }
              }
              if (Array.isArray(other.accounts)) {
                for (const acc of other.accounts) {
                  if (Array.isArray(acc.models)) {
                    for (const pm of modelsToSave) {
                      const pmId = pm.id || pm.displayName;
                      if (!pmId) continue;
                      const cleanPmId = String(pmId).replace(/^models\//, '');
                      const accM = acc.models.find((m: any) => m && (m.id === pmId || m.id === cleanPmId || m.displayName === pm.displayName || m.displayName === pmId));
                      if (accM) {
                        accM.enabled = pm.enabled !== false;
                      } else if (pm.enabled === false) {
                        acc.models.push({
                          id: cleanPmId,
                          displayName: pm.displayName || cleanPmId,
                          enabled: false,
                        });
                      }
                    }
                  }
                }
              }
            }
          }
        }
      } else {
        parsed.providers.push({
          ...p,
          enabled: p.enabled !== false,
          createdAt: new Date().toISOString(),
        });
      }
      delete parsed.models;
      await atomicWriteCustomModels(fp, parsed);
      const mainWindow = ctx.getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(DOCTOR_IPC_CHANNELS.PROVIDERS_CHANGED);
      return { success: true };
    } catch(e) {
      return { success: false, error: (e as Error).message };
    }
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.PROVIDERS_DELETE, async (_, id) => {
    try {
      const fp = getCustomModelsPath();
      const c = await fs.promises.readFile(fp, 'utf8');
      const parsed = JSON.parse(c.replace(/^\uFEFF/, ''));
      if (parsed.providers) {
        const initialCount = parsed.providers.length;
        parsed.providers = parsed.providers.filter((x: any) => x.id !== id);
        if (parsed.providers.length === initialCount) {
          for (const prov of parsed.providers) {
            if (Array.isArray(prov.accounts)) {
              prov.accounts = prov.accounts.filter((a: any) => a.id !== id);
            }
          }
        }
        delete parsed.models;
        await atomicWriteCustomModels(fp, parsed);
        const mainWindow = ctx.getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(DOCTOR_IPC_CHANNELS.PROVIDERS_CHANGED);
      }
      return { success: true };
    } catch(e) {
      return { success: false, error: (e as Error).message };
    }
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.PROVIDERS_FETCH_MODELS, async (_evt, params: { apiUrl: string; apiKey: string; provider?: string }) => {
    try {
      const { net } = require('electron') as typeof import('electron');
      let rawKey = (params.apiKey || '').trim();
      let isGoogle = params.provider === 'google' || (params.apiUrl && params.apiUrl.includes('googleapis.com'));

      if ((isGoogle || !rawKey || rawKey === 'auto' || rawKey === 'none') && !rawKey.startsWith('ya29.')) {
        try {
          const fp = getCustomModelsPath();
          const c = await fs.promises.readFile(fp, 'utf8');
          const parsed = JSON.parse(c.replace(/^\uFEFF/, ''));
          if (parsed.providers && Array.isArray(parsed.providers)) {
            const googleProv = parsed.providers.find((p: any) => p.provider === 'google' || p.provider === 'gemini');
            if (googleProv && Array.isArray(googleProv.accounts)) {
              const activeAcc = googleProv.accounts.find((a: any) => a.enabled !== false && (a.apiKey?.startsWith('ya29.') || a.refreshToken)) || googleProv.accounts[0];
              if (activeAcc) {
                if (activeAcc.apiKey && activeAcc.apiKey.startsWith('ya29.')) {
                  rawKey = activeAcc.apiKey;
                } else if (activeAcc.refreshToken) {
                  const refreshed = await refreshGoogleToken(activeAcc.refreshToken);
                  if (refreshed?.accessToken) {
                    rawKey = refreshed.accessToken;
                    activeAcc.apiKey = refreshed.accessToken;
                    await atomicWriteCustomModels(fp, parsed);
                  }
                }
              }
            }
          }
        } catch {}
      }

      const isIdeToken = rawKey.startsWith('ya29.');

      if (isIdeToken || (params.provider === 'google' && isIdeToken)) {
        try {
          const cloudCodeRes = await fetch('https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${rawKey}`,
              'Content-Type': 'application/json',
              'User-Agent': 'antigravity',
            },
            body: JSON.stringify({}),
            signal: AbortSignal.timeout(8000),
          });

          if (cloudCodeRes.ok) {
            const data = (await cloudCodeRes.json()) as any;
            const rawModels = data.models || data.availableModels || {};
            const models = Object.keys(rawModels)
              .filter((k) => !k.startsWith('chat_') && !k.startsWith('tab_'))
              .map((k) => {
                const m = rawModels[k];
                const rawDisplayName = (m.displayName || k).replace(/^\[[^\]]+\]\s*/, '');
                return {
                  id: k,
                  displayName: rawDisplayName || k,
                  enabled: true,
                };
              });

            if (models.length > 0) {
              return { success: true, models };
            }
          }
        } catch {}

        const fallbackModels = [
          { id: 'gemini-4-argon-medium', displayName: 'Gemini 4 Argon (Medium)', enabled: true },
          { id: 'gemini-3.8-flash-tiered', displayName: 'Gemini 3.8 Flash', enabled: true },
          { id: 'gemini-3.8-flash-low', displayName: 'Gemini 3.8 Flash (Low)', enabled: true },
          { id: 'gemini-3.8-flash-medium', displayName: 'Gemini 3.8 Flash (Medium)', enabled: true },
          { id: 'gemini-3.8-flash-high', displayName: 'Gemini 3.8 Flash (High)', enabled: true },
          { id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6 (Thinking)', enabled: true },
          { id: 'claude-opus-4-6-thinking', displayName: 'Claude Opus 4.6 (Thinking)', enabled: true },
        ];
        return { success: true, models: fallbackModels };
      }

      const baseUrl = params.apiUrl.replace(/\/+$/, '');
      const url = new URL(baseUrl.endsWith('/models') ? baseUrl : `${baseUrl}/models`);
      if (!['http:', 'https:'].includes(url.protocol)) {
        return { success: false, error: `Unsupported URL scheme: ${url.protocol}` };
      }
      const blockedHosts = ['169.254.169.254', 'metadata.google.internal', 'metadata.internal', 'metadata'];
      if (blockedHosts.includes(url.hostname.toLowerCase())) {
        return { success: false, error: 'Blocked: metadata endpoint' };
      }

      isGoogle = isGoogle || url.hostname.includes('googleapis.com');
      if (isGoogle && rawKey && !rawKey.startsWith('enc:')) {
        url.searchParams.set('key', rawKey);
      }

      return new Promise((resolve) => {
        const req = net.request({ url: url.toString(), method: 'GET' });
        if (rawKey && !rawKey.startsWith('enc:')) {
          if (isGoogle) {
            req.setHeader('x-goog-api-key', rawKey);
          } else {
            req.setHeader('Authorization', 'Bearer ' + rawKey);
          }
        }
        req.on('response', (res: Electron.IncomingMessage) => {
          let data = '';
          res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              try {
                const parsed = JSON.parse(data);
                let rawList: any[] = [];
                if (Array.isArray(parsed.data)) rawList = parsed.data;
                else if (Array.isArray(parsed.models)) rawList = parsed.models;
                else if (Array.isArray(parsed)) rawList = parsed;

                const models = rawList
                  .filter((m: any) => {
                    if (isGoogle && Array.isArray(m.supportedGenerationMethods)) {
                      return m.supportedGenerationMethods.includes('generateContent');
                    }
                    return true;
                  })
                  .map((m: any) => {
                    let id = typeof m === 'string' ? m : (m.id || m.name || 'unknown');
                    let displayName = typeof m === 'string' ? m : (m.displayName || m.name || m.id || 'unknown');
                    if (isGoogle) {
                      id = id.replace(/^models\//, '');
                      displayName = displayName.replace(/^models\//, '');
                    }
                    return { id, displayName, enabled: true };
                  });
                resolve({ success: true, models });
              } catch {
                resolve({ success: false, error: 'Invalid JSON response from /models endpoint' });
              }
            } else {
              let errDetail = data ? data.slice(0, 150) : 'Failed to fetch models';
              try {
                const parsedErr = JSON.parse(data);
                if (parsedErr?.error?.message) {
                  errDetail = parsedErr.error.message;
                }
              } catch {}
              if (isGoogle && errDetail.toLowerCase().includes('api key not valid')) {
                errDetail = 'API key not valid. Please enter a valid Google AI Studio API key starting with "AIzaSy…" from https://aistudio.google.com/apikey. (If connecting Antigravity IDE, use "Importer depuis IDE").';
              }
              resolve({ success: false, error: `HTTP ${res.statusCode}: ${errDetail}` });
            }
          });
        });
        req.on('error', (err: Error) => resolve({ success: false, error: err.message }));
        req.end();
      });
    } catch(e) {
      return { success: false, error: (e as Error).message };
    }
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.PROVIDERS_TEST, async (_evt: Electron.IpcMainInvokeEvent, params: { apiUrl: string; apiKey: string; id?: string; modelId?: string; provider?: string }) => {
    try {
      const { net } = require('electron') as typeof import('electron');
      let rawKey = (params.apiKey || '').trim();
      let isGoogle = params.provider === 'google' || (params.apiUrl && params.apiUrl.includes('googleapis.com'));
      let targetAccountId: string | undefined = undefined;

      if ((isGoogle || !rawKey || rawKey === 'auto' || rawKey === 'none') && !rawKey.startsWith('ya29.')) {
        try {
          const fp = getCustomModelsPath();
          const c = await fs.promises.readFile(fp, 'utf8');
          const parsed = JSON.parse(c.replace(/^\uFEFF/, ''));
          if (parsed.providers && Array.isArray(parsed.providers)) {
            let prov = parsed.providers.find((x: any) => x.id === params.id || (isGoogle && (x.provider === 'google' || x.provider === 'gemini')));
            let activeAcc: any = null;
            if (prov && Array.isArray(prov.accounts) && prov.accounts.length > 0) {
              activeAcc = prov.accounts.find((a: any) => a.enabled !== false && (a.apiKey?.startsWith('ya29.') || a.refreshToken)) || prov.accounts[0];
            } else {
              for (const p of parsed.providers) {
                if (Array.isArray(p.accounts)) {
                  const acc = p.accounts.find((a: any) => a.id === params.id);
                  if (acc) {
                    activeAcc = acc;
                    prov = p;
                    break;
                  }
                }
              }
            }

            if (activeAcc) {
              isGoogle = true;
              targetAccountId = activeAcc.id;
              if (activeAcc.apiKey && activeAcc.apiKey.startsWith('ya29.')) {
                rawKey = activeAcc.apiKey;
              } else if (activeAcc.refreshToken) {
                const refreshed = await refreshGoogleToken(activeAcc.refreshToken);
                if (refreshed && refreshed.accessToken) {
                  rawKey = refreshed.accessToken;
                  activeAcc.apiKey = refreshed.accessToken;
                  await atomicWriteCustomModels(fp, parsed);
                }
              }
            }
          }
        } catch (err) {
          console.warn('[PROVIDERS_TEST] Failed to resolve account token from pool:', err);
        }
      }

      const baseUrl = params.apiUrl ? params.apiUrl.replace(/\/+$/, '') : 'https://generativelanguage.googleapis.com/v1beta';

      let parsedBase: URL;
      try {
        parsedBase = new URL(baseUrl);
        if (!['http:', 'https:'].includes(parsedBase.protocol)) {
          return { success: false, healthStatus: 'offline' as const, error: `Unsupported URL scheme: ${parsedBase.protocol}` };
        }
        const blockedHosts = ['169.254.169.254', 'metadata.google.internal', 'metadata.internal', 'metadata'];
        if (blockedHosts.includes(parsedBase.hostname.toLowerCase())) {
          return { success: false, healthStatus: 'offline' as const, error: 'Blocked: metadata endpoint' };
        }
      } catch (err) {
        return { success: false, healthStatus: 'offline' as const, error: `Invalid URL: ${(err as Error).message}` };
      }

      const startTime = Date.now();
      const isIdeToken = !!(rawKey && rawKey.startsWith('ya29.'));
      if (isIdeToken && !params.modelId) {
        try {
          let quotaRes = await fetchGoogleAccountQuotas(rawKey);
          let freshToken: string | undefined;
          if (!quotaRes) {
            try {
              const fp = getCustomModelsPath();
              const c = await fs.promises.readFile(fp, 'utf8');
              const parsed = JSON.parse(c.replace(/^\uFEFF/, ''));
              if (parsed.providers && Array.isArray(parsed.providers)) {
                let prov = parsed.providers.find((x: any) => x.id === params.id);
                let targetAcc: any = null;
                if (prov && Array.isArray(prov.accounts)) {
                  targetAcc = prov.accounts.find((a: any) => a.id === targetAccountId || a.apiKey === rawKey || a.enabled !== false);
                } else {
                  for (const pr of parsed.providers) {
                    if (Array.isArray(pr.accounts)) {
                      const acc = pr.accounts.find((a: any) => a.id === params.id || a.id === targetAccountId || a.apiKey === rawKey);
                      if (acc) {
                        targetAcc = acc;
                        prov = pr;
                        break;
                      }
                    }
                  }
                }
                if (targetAcc && targetAcc.refreshToken) {
                  const refreshed = await refreshGoogleToken(targetAcc.refreshToken);
                  if (refreshed && refreshed.accessToken) {
                    freshToken = refreshed.accessToken;
                    quotaRes = await fetchGoogleAccountQuotas(refreshed.accessToken);
                  }
                }
              }
            } catch { /* ignore */ }
          }
          const latencyMs = Date.now() - startTime;
          const isSuccess = quotaRes !== null;
          const healthStatus = isSuccess ? (latencyMs >= 1500 ? 'degraded' : 'healthy') : 'offline';
          const result = {
            success: isSuccess,
            status: isSuccess ? 200 : 401,
            latencyMs,
            healthStatus,
            error: isSuccess ? undefined : 'Jeton Antigravity IDE expiré ou inaccessible',
          };

          if (params.id || targetAccountId) {
            try {
              const fp = getCustomModelsPath();
              const c = await fs.promises.readFile(fp, 'utf8');
              const parsed = JSON.parse(c.replace(/^\uFEFF/, ''));
              if (parsed.providers && Array.isArray(parsed.providers)) {
                const idx = parsed.providers.findIndex((x: any) => x.id === params.id);
                if (idx !== -1) {
                  parsed.providers[idx].status = result.healthStatus;
                  parsed.providers[idx].latencyMs = result.latencyMs;
                  parsed.providers[idx].lastTestedAt = new Date().toISOString();
                  parsed.providers[idx].lastError = result.error;
                  if (freshToken && parsed.providers[idx].apiKey !== 'auto') parsed.providers[idx].apiKey = freshToken;
                  if (targetAccountId && Array.isArray(parsed.providers[idx].accounts)) {
                    const acc = parsed.providers[idx].accounts.find((a: any) => a.id === targetAccountId);
                    if (acc) {
                      acc.status = result.healthStatus;
                      acc.latencyMs = result.latencyMs;
                      acc.lastTestedAt = new Date().toISOString();
                      acc.lastError = result.error;
                      if (freshToken) acc.apiKey = freshToken;
                      if (quotaRes) acc.quotas = quotaRes;
                    }
                  }
                  await atomicWriteCustomModels(fp, parsed);
                } else {
                  for (const pr of parsed.providers) {
                    if (Array.isArray(pr.accounts)) {
                      const aIdx = pr.accounts.findIndex((a: any) => a.id === params.id || a.id === targetAccountId);
                      if (aIdx !== -1) {
                        pr.accounts[aIdx].status = result.healthStatus;
                        pr.accounts[aIdx].latencyMs = result.latencyMs;
                        pr.accounts[aIdx].lastTestedAt = new Date().toISOString();
                        pr.accounts[aIdx].lastError = result.error;
                        if (freshToken) pr.accounts[aIdx].apiKey = freshToken;
                        if (quotaRes) pr.accounts[aIdx].quotas = quotaRes;
                        await atomicWriteCustomModels(fp, parsed);
                        break;
                      }
                    }
                  }
                }
              }
            } catch { /* ignore */ }
          }
          return result;
        } catch (err) {
          return { success: false, healthStatus: 'offline' as const, error: (err as Error).message };
        }
      }

      const doRequest = (targetUrl: string, method: string, body?: string): Promise<{ statusCode: number; data: string; latencyMs: number }> => {
        return new Promise((resolve, reject) => {
          const req = net.request({ url: targetUrl, method });
          const keyToUse = rawKey || params.apiKey;
          if (keyToUse && !keyToUse.startsWith('enc:') && keyToUse !== 'auto' && keyToUse !== 'none') {
            if (keyToUse.startsWith('ya29.')) {
              req.setHeader('Authorization', 'Bearer ' + keyToUse);
              req.setHeader('User-Agent', 'antigravity');
            } else if (isGoogle) {
              req.setHeader('x-goog-api-key', keyToUse);
            } else {
              req.setHeader('Authorization', 'Bearer ' + keyToUse);
            }
          }
          if (body) {
            req.setHeader('Content-Type', 'application/json');
          }
          req.on('response', (res: Electron.IncomingMessage) => {
            let data = '';
            res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
            res.on('end', () => {
              resolve({ statusCode: res.statusCode ?? 500, data, latencyMs: Date.now() - startTime });
            });
          });
          req.on('error', (err: Error) => reject(err));
          if (body) req.write(body);
          req.end();
        });
      };

      let statusCode = 500;
      let responseData = '';
      let latencyMs = 0;

      if (params.modelId) {
        try {
          if (isGoogle) {
            const cleanModel = params.modelId.replace(/^models\//, '');
            const keyToUse = rawKey || params.apiKey;
            const isCloudCode = isIdeToken || keyToUse?.startsWith('ya29.') || cleanModel.includes('tiered') || cleanModel.includes('-pro-high');
            if (isCloudCode) {
              const postBody = JSON.stringify({
                project: 'aicode-consumers',
                model: cleanModel,
                request: {
                  contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
                  generationConfig: { maxOutputTokens: 5 },
                },
              });
              let postRes = await doRequest('https://daily-cloudcode-pa.googleapis.com/v1internal:generateContent', 'POST', postBody);
              if (postRes.statusCode === 429) {
                const fbRes = await doRequest('https://cloudcode-pa.googleapis.com/v1internal:generateContent', 'POST', postBody);
                if (fbRes.statusCode >= 200 && fbRes.statusCode < 300) postRes = fbRes;
              }
              statusCode = postRes.statusCode;
              responseData = postRes.data;
              latencyMs = postRes.latencyMs;
            } else {
              const postBody = JSON.stringify({
                contents: [{ parts: [{ text: 'ping' }] }],
                generationConfig: { maxOutputTokens: 5 },
              });
              const postRes = await doRequest(`${baseUrl}/models/${cleanModel}:generateContent`, 'POST', postBody);
              statusCode = postRes.statusCode;
              responseData = postRes.data;
              latencyMs = postRes.latencyMs;
            }
          } else {
            const postBody = JSON.stringify({
              model: params.modelId,
              messages: [{ role: 'user', content: 'ping' }],
              max_tokens: 16
            });
            const postRes = await doRequest(`${baseUrl}/chat/completions`, 'POST', postBody);
            statusCode = postRes.statusCode;
            responseData = postRes.data;
            latencyMs = postRes.latencyMs;
          }
        } catch (err) {
          responseData = (err as Error).message;
        }
      } else {
        try {
          const res = await doRequest(`${baseUrl}/models`, 'GET');
          statusCode = res.statusCode;
          responseData = res.data;
          latencyMs = res.latencyMs;
        } catch (err) {
          responseData = (err as Error).message;
        }

        if (!isGoogle && (statusCode < 200 || statusCode >= 300)) {
          let testModel: string | undefined = undefined;
          if (params.id) {
            try {
              const fp = getCustomModelsPath();
              const c = await fs.promises.readFile(fp, 'utf8');
              const parsed = JSON.parse(c.replace(/^\uFEFF/, ''));
              const prov = (parsed.providers || []).find((x: any) => x.id === params.id);
              if (prov && prov.models && prov.models.length > 0) {
                testModel = prov.models[0].id || prov.models[0].name;
              }
            } catch { /* ignore */ }
          }
          if (!testModel) testModel = 'MiniMax-M3';

          try {
            const postBody = JSON.stringify({
              model: testModel,
              messages: [{ role: 'user', content: 'ping' }],
              max_tokens: 16
            });
            const postRes = await doRequest(`${baseUrl}/chat/completions`, 'POST', postBody);
            if (postRes.statusCode >= 200 && postRes.statusCode < 300) {
              statusCode = postRes.statusCode;
              responseData = postRes.data;
              latencyMs = postRes.latencyMs;
            } else if (postRes.statusCode === 401 || postRes.statusCode === 403) {
              statusCode = postRes.statusCode;
              responseData = postRes.data;
              latencyMs = postRes.latencyMs;
            }
          } catch { /* keep original */ }
        }
      }

      const isSuccess = statusCode >= 200 && statusCode < 300;
      const healthStatus = isSuccess
        ? (latencyMs >= 1500 ? 'degraded' : 'healthy')
        : (statusCode === 429 ? 'degraded' : 'offline');

      let pongText = '';
      if (params.modelId && isSuccess) {
        try {
          const parsed = JSON.parse(responseData);
          if (isGoogle) {
            pongText = parsed.response?.candidates?.[0]?.content?.parts?.[0]?.text
              || parsed.candidates?.[0]?.content?.parts?.[0]?.text
              || '';
          } else {
            pongText = parsed.choices?.[0]?.message?.content || parsed.choices?.[0]?.text || '';
          }
        } catch {
          pongText = responseData;
        }
      }

      const result = {
        success: isSuccess,
        status: statusCode,
        latencyMs,
        healthStatus,
        pongText: pongText ? pongText.trim() : undefined,
        error: isSuccess ? undefined : formatApiError(responseData, statusCode)
      };

      if (params.id) {
        try {
          const fp = getCustomModelsPath();
          const c = await fs.promises.readFile(fp, 'utf8');
          const parsed = JSON.parse(c.replace(/^\uFEFF/, ''));
          if (parsed.providers && Array.isArray(parsed.providers)) {
            const idx = parsed.providers.findIndex((x: any) => x.id === params.id);
            if (idx !== -1) {
              parsed.providers[idx].status = result.healthStatus;
              parsed.providers[idx].latencyMs = result.latencyMs;
              parsed.providers[idx].lastTestedAt = new Date().toISOString();
              parsed.providers[idx].lastError = result.error;
              await atomicWriteCustomModels(fp, parsed);
            }
          }
        } catch { /* ignore */ }
      }

      return result;
    } catch(e) {
      const err = e as Error;
      return { success: false, healthStatus: 'offline' as const, error: err.message };
    }
  });
}
