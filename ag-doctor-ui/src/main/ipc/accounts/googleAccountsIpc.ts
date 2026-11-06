import { app, ipcMain, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import { DOCTOR_IPC_CHANNELS } from '../../../ipc/channels';
import {
  discoverIdeAccount,
  fetchGoogleAccountQuotas,
  warmupGoogleAccount,
  refreshGoogleToken,
  fetchGoogleUserInfo,
  ensureCloudCodeProject,
  switchActiveIdeAccount,
} from '../../../services/discovery/ideAccountDiscovery';
import { startGoogleOAuthLogin } from '../../../services/runtime/googleOAuthServer';
import { randomizeAllDevices } from '../../../services/runtime/deviceFingerprint';
import {
  detectAntigravityVerificationChallenge,
  resetAntigravityOnboarding,
} from '../../../services/discovery/antigravityVerificationResolver';
import { getCustomModelsPath } from './providersIpc';
import type { MainContext } from '../../types';

export function registerGoogleAccountsIpc(ctx: MainContext): void {
  ipcMain.handle(DOCTOR_IPC_CHANNELS.GOOGLE_DISCOVER_IDE_ACCOUNT, async () => {
    try {
      const account = await discoverIdeAccount();
      if (!account) {
        return { success: false, error: 'Aucun compte Google actif détecté dans Antigravity IDE ou le trousseau système.' };
      }
      return { success: true, account };
    } catch (err: any) {
      return { success: false, error: err.message || 'Erreur lors de la découverte du compte.' };
    }
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.GOOGLE_FETCH_ACCOUNT_QUOTAS, async (_evt, tokenOrKey: string | any, maybeRefreshToken?: string) => {
    try {
      let rawToken = typeof tokenOrKey === 'string' ? tokenOrKey : (tokenOrKey?.accessToken || tokenOrKey?.apiKey || '');
      let rToken = maybeRefreshToken || (typeof tokenOrKey === 'object' ? tokenOrKey?.refreshToken : undefined);

      if (!rawToken && !rToken) return { success: false, error: 'Token requis.' };

      let effectiveToken = rawToken;
      let freshAccessToken: string | undefined;

      if (rawToken.startsWith('1//') || rawToken.startsWith('g1//')) {
        rToken = rawToken;
        effectiveToken = '';
      }

      if (!effectiveToken && rToken) {
        const refreshed = await refreshGoogleToken(rToken);
        if (refreshed) {
          effectiveToken = refreshed.accessToken;
          freshAccessToken = refreshed.accessToken;
        }
      }

      let quotas = effectiveToken ? await fetchGoogleAccountQuotas(effectiveToken) : null;

      if (!quotas && rToken && effectiveToken !== freshAccessToken) {
        const refreshed = await refreshGoogleToken(rToken);
        if (refreshed) {
          effectiveToken = refreshed.accessToken;
          freshAccessToken = refreshed.accessToken;
          quotas = await fetchGoogleAccountQuotas(effectiveToken);
        }
      }

      if (!quotas) {
        return { success: false, error: 'Impossible de récupérer les quotas Google.' };
      }

      let emailToCache = typeof tokenOrKey === 'object' ? (tokenOrKey?.email || tokenOrKey?.accountEmail) : undefined;
      if (!emailToCache && effectiveToken) {
        try {
          const u = await fetchGoogleUserInfo(effectiveToken);
          if (u?.email) emailToCache = u.email;
        } catch {}
      }
      if (emailToCache) {
        try {
          const qCachePath = path.join(app.getPath('home'), '.gemini', 'antigravity', 'quota_cache.json');
          let qData: any = { version: 1, savedAt: Date.now(), quotas: {}, revokedTokens: [] };
          if (fs.existsSync(qCachePath)) {
            try { qData = JSON.parse(fs.readFileSync(qCachePath, 'utf8')); } catch {}
          }
          if (!qData.quotas) qData.quotas = {};
          const cds = qData.accountCooldowns || {};
          const now = Date.now();
          const lowerEmail = emailToCache.toLowerCase();
          let activeGeminiUntil = 0;
          let activeClaudeUntil = 0;
          for (const [cdK, until] of Object.entries(cds)) {
            if (typeof until !== 'number' || until <= now) continue;
            const lcdk = cdK.toLowerCase();
            const clean = lcdk.replace(/^(google|gemini-cli):/, '').replace(/:(gemini|claude)$/, '');
            if (clean === lowerEmail || lcdk.includes(lowerEmail)) {
              if (lcdk.endsWith(':claude')) activeClaudeUntil = Math.max(activeClaudeUntil, until);
              else if (lcdk.endsWith(':gemini')) activeGeminiUntil = Math.max(activeGeminiUntil, until);
              else { activeGeminiUntil = Math.max(activeGeminiUntil, until); activeClaudeUntil = Math.max(activeClaudeUntil, until); }
            }
          }
          if (activeGeminiUntil > now) {
            const isWk = (activeGeminiUntil - now) > 5 * 3600000;
            quotas.geminiFiveHourPct = 0;
            quotas.fiveHourPercentage = 0;
            quotas.geminiFiveHourReset = new Date(activeGeminiUntil).toISOString();
            if (isWk) {
              quotas.geminiWeeklyPct = 0;
              quotas.weeklyPercentage = 0;
              quotas.geminiWeeklyReset = new Date(activeGeminiUntil).toISOString();
            }
          }
          if (activeClaudeUntil > now) {
            const isWk = (activeClaudeUntil - now) > 5 * 3600000;
            quotas.claudeFiveHourPct = 0;
            quotas.claudeFiveHourReset = new Date(activeClaudeUntil).toISOString();
            if (isWk) {
              quotas.claudeWeeklyPct = 0;
              quotas.claudeWeeklyReset = new Date(activeClaudeUntil).toISOString();
            }
          }
          qData.quotas[`google:${emailToCache}`] = {
            ...qData.quotas[`google:${emailToCache}`],
            ...quotas,
            updatedAt: Date.now(),
          };
          fs.writeFileSync(qCachePath, JSON.stringify(qData, null, 2), 'utf8');
        } catch {}
      }

      return { success: true, quotas, accessToken: freshAccessToken };
    } catch (err: any) {
      return { success: false, error: err.message || 'Erreur lors de la récupération des quotas.' };
    }
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.GOOGLE_WARMUP_ACCOUNT, async (_evt, accessToken: string) => {
    try {
      if (!accessToken) return { success: false, error: 'Access token requis.' };
      let effectiveToken = accessToken;
      if (accessToken.startsWith('1//') || accessToken.startsWith('g1//')) {
        const refreshed = await refreshGoogleToken(accessToken);
        if (refreshed) effectiveToken = refreshed.accessToken;
      }
      const ok = await warmupGoogleAccount(effectiveToken);
      return { success: ok };
    } catch (err: any) {
      return { success: false, error: err.message || 'Erreur lors du warmup du compte.' };
    }
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.GOOGLE_REFRESH_TOKEN, async (_evt, refreshToken: string) => {
    try {
      if (!refreshToken) return { success: false, error: 'Refresh token requis.' };
      const res = await refreshGoogleToken(refreshToken);
      if (!res) {
        return { success: false, error: 'Échec du rafraîchissement du token Google (révoqué ou réseau indisponible).' };
      }
      const userInfo = await fetchGoogleUserInfo(res.accessToken);
      const quotas = await fetchGoogleAccountQuotas(res.accessToken);
      const projectInfo = await ensureCloudCodeProject(res.accessToken);
      return {
        success: true,
        accessToken: res.accessToken,
        expiresIn: res.expiresIn,
        email: userInfo?.email || projectInfo?.accountEmail,
        name: userInfo?.name,
        picture: userInfo?.picture,
        quotas: quotas || undefined,
        projectId: projectInfo?.projectId,
        tierId: projectInfo?.tierId,
      };
    } catch (err: any) {
      return { success: false, error: err.message || 'Erreur lors du rafraîchissement du token.' };
    }
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.GOOGLE_OAUTH_LOGIN, async (_evt, providerType?: 'antigravity' | 'gemini-cli') => {
    try {
      const res = await startGoogleOAuthLogin(providerType);
      return res;
    } catch (err: any) {
      return { success: false, error: err.message || 'Erreur lors de la connexion OAuth' };
    }
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.GOOGLE_SWITCH_IDE_ACCOUNT, async (_evt, params: {
    accessToken: string;
    refreshToken?: string;
    email?: string;
    picture?: string;
  }) => {
    try {
      const res = switchActiveIdeAccount(params);
      return res;
    } catch (err: any) {
      return { success: false, error: err.message || 'Erreur lors du changement de compte IDE' };
    }
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.GOOGLE_RECONCILE_COOLDOWNS, async () => {
    try {
      const qCachePath = path.join(app.getPath('home'), '.gemini', 'antigravity', 'quota_cache.json');
      if (!fs.existsSync(qCachePath)) {
        return { success: true, cleared: 0, activeRemaining: 0, details: [] };
      }
      const qData = JSON.parse(fs.readFileSync(qCachePath, 'utf8'));
      const cds = qData.accountCooldowns || {};
      const quotas = qData.quotas || {};
      const now = Date.now();
      let cleared = 0;
      const details: string[] = [];

      let cmAccounts: any[] = [];
      try {
        const cmPath = getCustomModelsPath();
        if (fs.existsSync(cmPath)) {
          const cmData = JSON.parse(fs.readFileSync(cmPath, 'utf8').replace(/^\uFEFF/, ''));
          const prov = (cmData.providers || []).find((p: any) => p && (p.provider === 'google' || p.provider === 'gemini'));
          if (prov && Array.isArray(prov.accounts)) {
            cmAccounts = prov.accounts;
          }
        }
      } catch {}

      for (const [k, until] of Object.entries(cds)) {
        if (typeof until !== 'number' || until <= now) {
          delete cds[k];
          cleared++;
          details.push(`${k} (expiré naturellement)`);
          continue;
        }
        let acc = k;
        let fam = '';
        if (k.endsWith(':gemini')) { acc = k.slice(0, -7); fam = 'gemini'; }
        else if (k.endsWith(':claude')) { acc = k.slice(0, -7); fam = 'claude'; }
        let q = quotas[acc] || quotas[acc.startsWith('google:') ? acc : `google:${acc}`];
        if (!q) {
          const rawEmail = acc.replace(/^(google|gemini-cli):/, '').toLowerCase();
          const found = cmAccounts.find((a: any) => (a.email || '').toLowerCase() === rawEmail);
          if (found && found.quotas) {
            q = found.quotas;
          }
        }
        if (q) {
          const resetPassed = fam === 'gemini'
            ? (q.geminiResetTime ? Date.parse(q.geminiResetTime) <= now : false)
            : (q.claudeResetTime ? Date.parse(q.claudeResetTime) <= now : false);
          if (fam === 'gemini' && (q.geminiFiveHourPct >= 10 || resetPassed)) {
            delete cds[k];
            cleared++;
            details.push(`${k} (réveil Gemini, 5h=${q.geminiFiveHourPct}%)`);
          } else if (fam === 'claude' && (q.claudeFiveHourPct >= 10 || resetPassed)) {
            delete cds[k];
            cleared++;
            details.push(`${k} (réveil Claude, 5h=${q.claudeFiveHourPct}%)`);
          } else if (!fam && ((q.geminiFiveHourPct >= 10 || resetPassed) || (q.claudeFiveHourPct >= 10 || resetPassed))) {
            delete cds[k];
            cleared++;
            details.push(`${k} (réveil multi-famille)`);
          }
        }
      }

      qData.accountCooldowns = cds;
      fs.writeFileSync(qCachePath, JSON.stringify(qData, null, 2), 'utf8');
      const activeRemaining = Object.keys(cds).length;
      return { success: true, cleared, activeRemaining, details };
    } catch (err: any) {
      return { success: false, error: err.message || 'Erreur lors de la réconciliation des cooldowns' };
    }
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.GOOGLE_GET_COOLDOWNS, async () => {
    try {
      const qCachePath = path.join(app.getPath('home'), '.gemini', 'antigravity', 'quota_cache.json');
      if (!fs.existsSync(qCachePath)) {
        return { success: true, cooldowns: {} };
      }
      const qData = JSON.parse(fs.readFileSync(qCachePath, 'utf8'));
      const cds = qData.accountCooldowns || {};
      const now = Date.now();
      const active: Record<string, { until: number; remainingMs: number; remainingMin: number; remainingHours: string }> = {};
      for (const [k, until] of Object.entries(cds)) {
        if (typeof until === 'number' && until > now) {
          const remainingMs = until - now;
          const remainingMin = Math.ceil(remainingMs / 60000);
          const hours = (remainingMs / 3600000).toFixed(1);
          active[k] = { until, remainingMs, remainingMin, remainingHours: hours };
        }
      }
      return { success: true, cooldowns: active };
    } catch (err: any) {
      return { success: false, cooldowns: {}, error: err.message };
    }
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.GOOGLE_LIFT_ACCOUNT_COOLDOWN, async (_evt, accountIdentifier: string) => {
    try {
      if (!accountIdentifier || typeof accountIdentifier !== 'string') {
        return { success: false, error: 'Identifiant de compte requis' };
      }
      const qCachePath = path.join(app.getPath('home'), '.gemini', 'antigravity', 'quota_cache.json');
      if (!fs.existsSync(qCachePath)) {
        return { success: true, cleared: 0, message: 'Aucun cache de quota trouvé' };
      }
      const qData = JSON.parse(fs.readFileSync(qCachePath, 'utf8'));
      const cds = qData.accountCooldowns || {};
      const needle = accountIdentifier.toLowerCase().replace(/^(google|gemini-cli):/, '');
      let needleEmail = '';
      try {
        const cmPath = path.join(app.getPath('home'), '.gemini', 'antigravity', 'custom_models.json');
        if (fs.existsSync(cmPath)) {
          const cm = JSON.parse(fs.readFileSync(cmPath, 'utf8'));
          const accs = (cm.providers || []).find((p: any) => p.provider === 'google')?.accounts || [];
          const found = accs.find((a: any) => (a.id || '').toLowerCase() === needle || (a.email || '').toLowerCase() === needle);
          if (found?.email) needleEmail = found.email.toLowerCase();
        }
      } catch {}
      let cleared = 0;
      const removedKeys: string[] = [];
      for (const k of Object.keys(cds)) {
        const cleanK = k.toLowerCase().replace(/^(google|gemini-cli):/, '').replace(/:(gemini|claude)$/, '');
        if (cleanK === needle || k.toLowerCase().includes(needle) || (needleEmail && (cleanK === needleEmail || k.toLowerCase().includes(needleEmail)))) {
          delete cds[k];
          cleared++;
          removedKeys.push(k);
        }
      }
      if (Array.isArray(qData.unlicensedAccounts)) {
        const unSet = new Set(qData.unlicensedAccounts);
        for (const item of [needle, needleEmail, `google:${needle}`, `google:${needleEmail}`, `gemini-cli:${needle}`, `gemini-cli:${needleEmail}`]) {
          if (item && unSet.delete(item)) cleared++;
        }
        qData.unlicensedAccounts = Array.from(unSet);
      }
      if (cleared > 0) {
        qData.accountCooldowns = cds;
        fs.writeFileSync(qCachePath, JSON.stringify(qData, null, 2), 'utf8');
      }
      return { success: true, cleared, removedKeys, remainingActive: Object.keys(cds).length };
    } catch (err: any) {
      return { success: false, error: err.message || 'Erreur lors de la levée du cooldown' };
    }
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.GOOGLE_LIFT_BURST_COOLDOWNS, async () => {
    try {
      const qCachePath = path.join(app.getPath('home'), '.gemini', 'antigravity', 'quota_cache.json');
      if (!fs.existsSync(qCachePath)) {
        return { success: true, cleared: 0, message: 'Aucun cache de quota trouvé' };
      }
      const qData = JSON.parse(fs.readFileSync(qCachePath, 'utf8'));
      const cds = qData.accountCooldowns || {};
      const now = Date.now();
      const MAX_BURST_CD_MS = 2 * 60_000;
      let cleared = 0;
      const removedKeys: string[] = [];
      for (const [k, until] of Object.entries(cds)) {
        if (typeof until === 'number') {
          const remaining = until - now;
          if (remaining > 0 && remaining <= MAX_BURST_CD_MS) {
            delete cds[k];
            cleared++;
            removedKeys.push(k);
          }
        }
      }
      if (cleared > 0) {
        qData.accountCooldowns = cds;
        fs.writeFileSync(qCachePath, JSON.stringify(qData, null, 2), 'utf8');
      }
      return { success: true, cleared, removedKeys, remainingActive: Object.keys(cds).length };
    } catch (err: any) {
      return { success: false, error: err.message || 'Erreur lors de la levée des burst cooldowns' };
    }
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.GOOGLE_PURGE_QUOTA_CACHE, async () => {
    try {
      const qCachePath = path.join(app.getPath('home'), '.gemini', 'antigravity', 'quota_cache.json');
      let clearedCount = 0;
      if (fs.existsSync(qCachePath)) {
        try {
          const qData = JSON.parse(fs.readFileSync(qCachePath, 'utf8'));
          clearedCount = Object.keys(qData.accountCooldowns || {}).length + Object.keys(qData.quotas || {}).length;
          fs.unlinkSync(qCachePath);
        } catch {
          fs.unlinkSync(qCachePath);
        }
      }
      return { success: true, cleared: clearedCount };
    } catch (err: any) {
      return { success: false, error: err.message || 'Erreur lors de la purge du cache de quota' };
    }
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.GOOGLE_REPAIR_ADC, async (_evt, email?: string) => {
    try {
      const res = await startGoogleOAuthLogin('antigravity', email);
      if (res.success && res.account) {
        const mainWindow = ctx.getMainWindow();
        mainWindow?.webContents.send(DOCTOR_IPC_CHANNELS.PROVIDERS_CHANGED);
        return {
          success: true,
          output: `Compte ${res.account.email} réhabilité avec succès. Jetons et identifiants Google ADC synchronisés.`,
        };
      } else {
        return {
          success: false,
          error: (res as any).error || 'Autorisation annulée ou expirée',
        };
      }
    } catch (err: any) {
      return { success: false, error: err.message || 'Erreur lors de la réparation du compte' };
    }
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.GOOGLE_PROBE_POOL, async (_evt, dryRun?: boolean) => {
    try {
      const appPath = typeof app?.getAppPath === 'function' ? app.getAppPath() : null;
      const candidates = [
        path.resolve(__dirname, '..', '..', '..', '..', '..', 'scripts', 'probe-pool.js'),
        path.resolve(__dirname, '..', '..', '..', 'scripts', 'probe-pool.js'),
        path.resolve(process.cwd(), 'scripts', 'probe-pool.js'),
        path.resolve(process.cwd(), '..', 'scripts', 'probe-pool.js'),
        ...(appPath ? [path.resolve(appPath, '..', 'scripts', 'probe-pool.js'), path.resolve(appPath, 'scripts', 'probe-pool.js')] : []),
      ];
      const probeScript = candidates.find((x) => fs.existsSync(x));
      if (!probeScript) {
        return { success: false, error: 'probe-pool.js script not found' };
      }
      const { runProbe, syncProbeResults } = require(probeScript);
      const data = await runProbe({ autoSync: !dryRun });
      if (!dryRun && typeof syncProbeResults === 'function') {
        try { syncProbeResults(data); } catch (_) {}
      }
      const mainWindow = ctx.getMainWindow();
      mainWindow?.webContents.send(DOCTOR_IPC_CHANNELS.PROVIDERS_CHANGED);
      return {
        success: true,
        results: data.results,
        summary: {
          healthy: data.healthyEmails.size,
          quarantined: data.quarantinedEmails.size,
          challenge: data.challengeEmails.size,
          unlicensed: data.unlicensedEmails.size,
          tos: data.tosEmails.size,
        }
      };
    } catch (err: any) {
      return { success: false, error: err.message || 'Erreur lors de la sonde du pool' };
    }
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.GOOGLE_UNLOCK_ACCOUNT, async (_evt, email: string) => {
    try {
      const challenge = await detectAntigravityVerificationChallenge();
      if (challenge.found && challenge.validationUrl) {
        await shell.openExternal(challenge.validationUrl);
        return { success: true, url: challenge.validationUrl, fromLogs: true };
      }
      if (!email) return { success: false, error: 'Email requis' };
      const url = `https://accounts.google.com/ServiceLogin?Email=${encodeURIComponent(email)}&continue=https://gemini.google.com/`;
      await shell.openExternal(url);
      return { success: true, url };
    } catch (err: any) {
      return { success: false, error: err.message || 'Erreur lors de l\'ouverture du navigateur' };
    }
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.VERIFICATION_DETECT, async () => {
    try {
      return await detectAntigravityVerificationChallenge();
    } catch (err: any) {
      return { found: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.VERIFICATION_OPEN_URL, async (_evt, url: string) => {
    try {
      if (!url) return { success: false, error: 'URL requise' };
      await shell.openExternal(url);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.VERIFICATION_RESET_ONBOARDING, async () => {
    try {
      return resetAntigravityOnboarding();
    } catch (err: any) {
      return { success: false, message: 'Erreur lors de la réinitialisation', error: err?.message || String(err) };
    }
  });

  ipcMain.handle(DOCTOR_IPC_CHANNELS.SYSTEM_RANDOMIZE_MACHINE_ID, async () => {
    try {
      const res = randomizeAllDevices();
      return res;
    } catch (err: any) {
      return { success: false, error: err?.message || 'Erreur lors du renouvellement de l\'empreinte machine' };
    }
  });
}
