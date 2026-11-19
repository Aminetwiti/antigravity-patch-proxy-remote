import https from 'https';
import log from 'electron-log';
import {
  refreshGoogleToken,
  getValidGoogleAccessToken,
  isTokenRevoked,
  markTokenRevoked,
  notifyQuotaOrTokenChange,
  shouldRenewToken,
} from './tokenManager';
import { isGeminiCliModel } from './modelNormalizer';

export interface AccountLiveQuota {
  fiveHourPercentage: number;
  weeklyPercentage: number;
  geminiFiveHourPct: number;
  geminiWeeklyPct: number;
  claudeFiveHourPct: number;
  claudeWeeklyPct: number;
  argonFiveHourPct?: number;
  argonWeeklyPct?: number;
  updatedAt: number;
  geminiResetTime?: string;
  geminiFiveHourReset?: string;
  geminiWeeklyReset?: string;
  claudeResetTime?: string;
  claudeFiveHourReset?: string;
  claudeWeeklyReset?: string;
  argonFiveHourReset?: string;
  argonWeeklyReset?: string;
  tierId?: string;
  tier?: string;
  projectId?: string;
  creditAmount?: number;
  hasClaude55?: boolean;
  isFamilyShared?: boolean;
  isUnlicensed?: boolean;
  groups?: any[];
}

const accountLiveQuotas = new Map<string, AccountLiveQuota>();

export function getLiveAccountQuota(accountKey: string): AccountLiveQuota | undefined {
  if (!accountKey) return undefined;
  const direct = accountLiveQuotas.get(accountKey);
  if (direct) return direct;
  const altKey = accountKey.startsWith('google:')
    ? accountKey.replace(/^google:/, '')
    : `google:${accountKey}`;
  return accountLiveQuotas.get(altKey);
}

export function updateLiveAccountQuota(accountKey: string, quota: AccountLiveQuota): void {
  accountLiveQuotas.set(accountKey, quota);
  notifyQuotaOrTokenChange();
}

export function _clearLiveQuotasForTests(): void {
  accountLiveQuotas.clear();
}

/**
 * Returns a copy of all current live account quotas.
 */
export function getAllLiveAccountQuotas(): Map<string, AccountLiveQuota> {
  return new Map(accountLiveQuotas);
}

/**
 * Queries Google Cloud Code v1internal:loadCodeAssist to discover user tier, credits, and GCP project.
 */
export function fetchAccountTierAndProject(
  accessToken: string,
): Promise<{ tierId?: string; tier?: string; projectId?: string; creditAmount?: number } | null> {
  const hosts = ['https://daily-cloudcode-pa.googleapis.com', 'https://cloudcode-pa.googleapis.com'];
  return new Promise((resolve) => {
    const tryHost = (idx: number) => {
      if (idx >= hosts.length) {
        resolve(null);
        return;
      }
      try {
        const hostUrl = new URL(`${hosts[idx]}/v1internal:loadCodeAssist`);
        const body = JSON.stringify({ metadata: { ideType: 'ANTIGRAVITY' } });
        const req = https.request(
          {
            protocol: hostUrl.protocol,
            hostname: hostUrl.hostname,
            port: hostUrl.port ? Number(hostUrl.port) : 443,
            path: hostUrl.pathname,
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(body),
              'User-Agent': 'antigravity',
            },
            timeout: 5000,
          },
          (res) => {
            let rawData = '';
            res.on('data', (chunk) => (rawData += chunk));
            res.on('end', () => {
              if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                try {
                  const data = JSON.parse(rawData);
                  const paidTier = data?.paidTier;
                  const currentTier = data?.currentTier;
                  const rawTierId = paidTier?.id || currentTier?.id;
                  let tier = 'pro';
                  if (rawTierId) {
                    const low = String(rawTierId).toLowerCase();
                    if (low.includes('ultra') || low.includes('business')) tier = 'ultra';
                    else if (low.includes('free')) tier = 'free';
                    else tier = 'pro';
                  }
                  let creditAmount: number | undefined;
                  const avail = paidTier?.availableCredits;
                  if (Array.isArray(avail) && avail.length > 0 && typeof avail[0]?.creditAmount !== 'undefined') {
                    creditAmount = Number(avail[0].creditAmount);
                  }
                  resolve({
                    tierId: rawTierId,
                    tier,
                    projectId: data?.cloudaicompanionProject,
                    creditAmount,
                  });
                } catch {
                  tryHost(idx + 1);
                }
              } else {
                tryHost(idx + 1);
              }
            });
          },
        );
        req.on('error', () => tryHost(idx + 1));
        req.on('timeout', () => {
          req.destroy();
          tryHost(idx + 1);
        });
        req.write(body);
        req.end();
      } catch {
        tryHost(idx + 1);
      }
    };
    tryHost(0);
  });
}


/**
 * Automates the 'Get started' consent & onboarding sequence on Google Cloud Code.
 * 1. POST /v1internal:setUserSettings { userSettings: { telemetryEnabled: true } }
 * 2. POST /v1internal:onboardUser { tierId: 'free-tier' }
 * This clears VALIDATION_REQUIRED and provisions cloudaicompanionProject for new/unactivated accounts.
 */
export async function onboardUserAndAcceptTerms(accessToken: string): Promise<{ success: boolean; projectId?: string; error?: string }> {
  if (!accessToken) return { success: false, error: 'No access token provided' };
  const host = 'https://cloudcode-pa.googleapis.com';

  const makePost = (endpoint: string, bodyObj: any): Promise<{ statusCode: number; data: any }> => {
    return new Promise((resolve, reject) => {
      try {
        const u = new URL(`${host}/${endpoint}`);
        const body = JSON.stringify(bodyObj);
        const req = https.request(
          {
            protocol: u.protocol,
            hostname: u.hostname,
            port: u.port ? Number(u.port) : 443,
            path: u.pathname,
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(body),
              'User-Agent': 'antigravity',
            },
            timeout: 10000,
          },
          (res) => {
            let rawData = '';
            res.on('data', (chunk) => (rawData += chunk));
            res.on('end', () => {
              try {
                const parsed = rawData ? JSON.parse(rawData) : {};
                resolve({ statusCode: res.statusCode || 200, data: parsed });
              } catch {
                resolve({ statusCode: res.statusCode || 200, data: rawData });
              }
            });
          },
        );
        req.on('error', reject);
        req.on('timeout', () => {
          req.destroy();
          reject(new Error('Request timed out'));
        });
        req.write(body);
        req.end();
      } catch (err) {
        reject(err);
      }
    });
  };

  try {
    // Step 1: Set user settings (Consent & Telemetry Agreement)
    log.info('[GoogleAuth] Automatically registering user consent (Security Notice & Data Use)...');
    await makePost('v1internal:setUserSettings', {
      userSettings: {
        telemetryEnabled: true,
        marketingEmailsEnabled: false,
      },
    }).catch((err) => {
      log.debug('[GoogleAuth] setUserSettings non-fatal error:', err?.message || err);
    });

    // Step 2: Onboard user into free-tier to provision companion project
    log.info('[GoogleAuth] Automatically executing onboardUser(free-tier) to unlock Google Cloud Code...');
    const onboardRes = await makePost('v1internal:onboardUser', {
      tierId: 'free-tier',
      metadata: { ideType: 'ANTIGRAVITY' },
    });

    let projectId = onboardRes.data?.response?.cloudaicompanionProject?.id || onboardRes.data?.cloudaicompanionProject?.id;
    
    // If long-running operation, poll briefly
    if (onboardRes.data?.name && !onboardRes.data?.done) {
      const opName = onboardRes.data.name;
      for (let i = 0; i < 5; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const opRes = await new Promise<{ statusCode: number; data: any }>((resolve) => {
          const u = new URL(`${host}/v1internal/${opName}`);
          https.get(
            u,
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'User-Agent': 'antigravity',
              },
              timeout: 5000,
            },
            (res) => {
              let raw = '';
              res.on('data', (c) => (raw += c));
              res.on('end', () => {
                try {
                  resolve({ statusCode: res.statusCode || 200, data: JSON.parse(raw) });
                } catch {
                  resolve({ statusCode: res.statusCode || 200, data: raw });
                }
              });
            },
          ).on('error', () => resolve({ statusCode: 500, data: {} }));
        });

        if (opRes.data?.done) {
          projectId = opRes.data?.response?.cloudaicompanionProject?.id;
          break;
        }
      }
    }

    log.info(`[GoogleAuth] Successfully onboarded user to Google Cloud Code! Project: ${projectId || 'default'}`);
    return { success: true, projectId };
  } catch (err: any) {
    log.warn('[GoogleAuth] Automatic onboarding attempt failed:', err?.message || err);
    return { success: false, error: err?.message || String(err) };
  }
}

const claude55CapabilityCache = new Map<string, { has55: boolean; timestamp: number }>();

/**
 * Queries Google Cloud Code v1internal:fetchAvailableModels to discover whether an account
 * is entitled to Claude 5.5 models (Claude Opus 5.5 / Sonnet 5.5) via Family group or direct subscription.
 */
export function checkAccountClaude55Access(accessToken: string): Promise<boolean> {
  const cached = claude55CapabilityCache.get(accessToken);
  if (cached && Date.now() - cached.timestamp < 3600_000) {
    return Promise.resolve(cached.has55);
  }
  const hosts = ['https://daily-cloudcode-pa.googleapis.com', 'https://cloudcode-pa.googleapis.com'];
  return new Promise((resolve) => {
    const tryHost = (idx: number) => {
      if (idx >= hosts.length) {
        resolve(false);
        return;
      }
      try {
        const hostUrl = new URL(`${hosts[idx]}/v1internal:fetchAvailableModels`);
        const body = '{}';
        const req = https.request(
          {
            protocol: hostUrl.protocol,
            hostname: hostUrl.hostname,
            port: hostUrl.port ? Number(hostUrl.port) : 443,
            path: hostUrl.pathname,
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(body),
              'User-Agent': 'antigravity',
            },
            timeout: 5000,
          },
          (res) => {
            let rawData = '';
            res.on('data', (chunk) => (rawData += chunk));
            res.on('end', () => {
              if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                try {
                  const data = JSON.parse(rawData);
                  const models = data?.models || {};
                  const has55 = Object.keys(models).some(
                    (m) => m.includes('5-5') || m.includes('5.5'),
                  );
                  claude55CapabilityCache.set(accessToken, { has55, timestamp: Date.now() });
                  resolve(has55);
                  return;
                } catch {
                  tryHost(idx + 1);
                }
              } else {
                tryHost(idx + 1);
              }
            });
          },
        );
        req.on('error', () => tryHost(idx + 1));
        req.on('timeout', () => {
          req.destroy();
          tryHost(idx + 1);
        });
        req.write(body);
        req.end();
      } catch {
        tryHost(idx + 1);
      }
    };
    tryHost(0);
  });
}

/**
 * Queries Google Cloud Code v1internal:fetchAvailableModels to discover real Gemini model quotas.
 */
export function fetchRealModelQuotas(accessToken: string): Promise<{
  geminiFiveHourPct?: number;
  geminiFiveHourReset?: string;
  claudeFiveHourPct?: number;
  claudeFiveHourReset?: string;
  argonFiveHourPct?: number;
  argonFiveHourReset?: string;
} | null> {
  const preferredHost = process.env.AG_GOOGLE_CLOUDCODE_HOST || 'daily-cloudcode-pa.googleapis.com';
  const hosts = [
    `https://${preferredHost}`,
    preferredHost === 'daily-cloudcode-pa.googleapis.com'
      ? 'https://cloudcode-pa.googleapis.com'
      : 'https://daily-cloudcode-pa.googleapis.com',
  ];
  return new Promise((resolve) => {
    const tryHost = (idx: number) => {
      if (idx >= hosts.length) {
        resolve(null);
        return;
      }
      try {
        const hostUrl = new URL(`${hosts[idx]}/v1internal:fetchAvailableModels`);
        const body = '{}';
        const req = https.request(
          {
            protocol: hostUrl.protocol,
            hostname: hostUrl.hostname,
            port: hostUrl.port ? Number(hostUrl.port) : 443,
            path: hostUrl.pathname,
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(body),
              'User-Agent': 'antigravity',
            },
            timeout: 5000,
          },
          (res) => {
            let rawData = '';
            res.on('data', (chunk) => (rawData += chunk));
            res.on('end', () => {
              if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                try {
                  const data = JSON.parse(rawData);
                  const models = data?.models || {};
                  let minRemainingFrac = 1.0;
                  let earliestReset: string | undefined;
                  let geminiFiveHourPct: number | undefined;
                  let geminiFiveHourReset: string | undefined;
                  let claudeFiveHourPct: number | undefined;
                  let claudeFiveHourReset: string | undefined;
                  let argonFiveHourPct: number | undefined;
                  let argonFiveHourReset: string | undefined;

                  for (const [modelId, modelData] of Object.entries<any>(models)) {
                    const qInfo = modelData?.quotaInfo;
                    if (!qInfo) continue;
                    const remainingFrac = typeof qInfo.remainingFraction === 'number' ? qInfo.remainingFraction : 1.0;
                    const pct = Math.round(remainingFrac * 100);
                    const resetTime = qInfo.resetTime;

                    if (remainingFrac < minRemainingFrac) {
                      minRemainingFrac = remainingFrac;
                      earliestReset = resetTime;
                    }

                    const lower = modelId.toLowerCase();
                    if (lower.includes('argon')) {
                      if (argonFiveHourPct === undefined || pct < argonFiveHourPct) {
                        argonFiveHourPct = pct;
                        argonFiveHourReset = resetTime;
                      }
                    } else if (lower.includes('claude')) {
                      if (claudeFiveHourPct === undefined || pct < claudeFiveHourPct) {
                        claudeFiveHourPct = pct;
                        claudeFiveHourReset = resetTime;
                      }
                    } else if (lower.includes('gemini')) {
                      if (geminiFiveHourPct === undefined || pct < geminiFiveHourPct) {
                        geminiFiveHourPct = pct;
                        geminiFiveHourReset = resetTime;
                      }
                    }
                  }

                  const effGem5h = geminiFiveHourPct ?? Math.round(minRemainingFrac * 100);
                  const effGemReset = geminiFiveHourReset ?? earliestReset;
                  resolve({
                    geminiFiveHourPct: effGem5h,
                    geminiFiveHourReset: effGemReset,
                    claudeFiveHourPct,
                    claudeFiveHourReset,
                    argonFiveHourPct,
                    argonFiveHourReset,
                  });
                  return;
                } catch {
                  tryHost(idx + 1);
                }
              } else {
                tryHost(idx + 1);
              }
            });
          },
        );
        req.on('error', () => tryHost(idx + 1));
        req.on('timeout', () => {
          req.destroy();
          tryHost(idx + 1);
        });
        req.write(body);
        req.end();
      } catch {
        tryHost(idx + 1);
      }
    };
    tryHost(0);
  });
}

/**
 * Queries Google Cloud Code for live user quota summary (5h and weekly buckets).
 */
export function fetchLiveUserQuota(accessToken: string): Promise<AccountLiveQuota | null> {
  const preferredHost = process.env.AG_GOOGLE_CLOUDCODE_HOST || 'cloudcode-pa.googleapis.com';
  const hosts = [
    `https://${preferredHost}`,
    preferredHost === 'cloudcode-pa.googleapis.com'
      ? 'https://daily-cloudcode-pa.googleapis.com'
      : 'https://cloudcode-pa.googleapis.com',
  ];

  return new Promise((resolve) => {
    const tryHost = (idx: number) => {
      if (idx >= hosts.length) {
        resolve(null);
        return;
      }
      try {
        const hostUrl = new URL(`${hosts[idx]}/v1internal:retrieveUserQuotaSummary`);
        const body = '{}';
        const req = https.request(
          {
            protocol: hostUrl.protocol,
            hostname: hostUrl.hostname,
            port: hostUrl.port ? Number(hostUrl.port) : 443,
            path: hostUrl.pathname,
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(body),
              'User-Agent': 'antigravity',
            },
            timeout: 7000,
          },
          (res) => {
            let rawData = '';
            res.on('data', (chunk) => (rawData += chunk));
            res.on('end', () => {
              if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                try {
                  const data = JSON.parse(rawData);
                  const rawGroups = Array.isArray(data?.groups) ? data.groups : [];
                  let geminiFiveHourPct: number | undefined;
                  let geminiWeeklyPct: number | undefined;
                  let geminiFiveHourReset: string | undefined;
                  let geminiWeeklyReset: string | undefined;
                  let claudeFiveHourPct: number | undefined;
                  let claudeWeeklyPct: number | undefined;
                  let claudeFiveHourReset: string | undefined;
                  let claudeWeeklyReset: string | undefined;
                  let argonFiveHourPct: number | undefined;
                  let argonWeeklyPct: number | undefined;
                  let argonFiveHourReset: string | undefined;
                  let argonWeeklyReset: string | undefined;

                  for (const g of rawGroups) {
                    const groupName = (g.displayName || '').toLowerCase();
                    const isArgon = groupName.includes('argon');
                    const isClaude =
                      groupName.includes('claude') ||
                      groupName.includes('3p') ||
                      groupName.includes('other') ||
                      groupName.includes('gpt');
                    const isGemini = groupName.includes('gemini') && !isArgon;

                    for (const b of Array.isArray(g.buckets) ? g.buckets : []) {
                      // If Google disabled this bucket (e.g. weekly limit hit), available fraction is 0
                      const isDisabled = Boolean(b.disabled);
                      const frac = isDisabled ? 0 : (typeof b.remainingFraction === 'number' ? b.remainingFraction : 1.0);
                      const pct = Math.round(frac * 100);
                      const bId = (b.bucketId || '').toLowerCase();
                      const wStr = (b.window || '').toLowerCase();
                      const is5h = bId.includes('5h') || wStr.includes('5h') || wStr.includes('hour');
                      const isWeekly = bId.includes('weekly') || wStr.includes('weekly');

                      const isArgonBucket = bId.includes('argon') || (isArgon && !bId.includes('3p') && !bId.includes('claude'));
                      const isGeminiBucket = !isArgonBucket && (bId.includes('gemini') || (isGemini && !bId.includes('3p') && !bId.includes('claude')));
                      const isClaudeBucket = bId.includes('3p') || bId.includes('claude') || (isClaude && !bId.includes('gemini') && !isArgon);

                      if (isArgonBucket) {
                        if (is5h) {
                          argonFiveHourPct = pct;
                          argonFiveHourReset = b.resetTime;
                        } else if (isWeekly) {
                          argonWeeklyPct = pct;
                          argonWeeklyReset = b.resetTime;
                        }
                      } else if (isGeminiBucket) {
                        if (is5h) {
                          geminiFiveHourPct = pct;
                          geminiFiveHourReset = b.resetTime;
                        } else if (isWeekly) {
                          geminiWeeklyPct = pct;
                          geminiWeeklyReset = b.resetTime;
                        }
                      } else if (isClaudeBucket) {
                        if (is5h) {
                          claudeFiveHourPct = pct;
                          claudeFiveHourReset = b.resetTime;
                        } else if (isWeekly) {
                          claudeWeeklyPct = pct;
                          claudeWeeklyReset = b.resetTime;
                        }
                      }
                    }
                  }

                  // If this host's response lacked the Gemini group entirely, try the next host
                  if (geminiFiveHourPct === undefined && geminiWeeklyPct === undefined && idx + 1 < hosts.length) {
                    tryHost(idx + 1);
                    return;
                  }

                  // If weekly quota is 0, the rolling 5-hour limit is blocked (cannot send requests)
                  if (typeof geminiWeeklyPct === 'number' && geminiWeeklyPct === 0) {
                    geminiFiveHourPct = 0;
                  }
                  if (typeof claudeWeeklyPct === 'number' && claudeWeeklyPct === 0) {
                    claudeFiveHourPct = 0;
                  }
                  if (typeof argonWeeklyPct === 'number' && argonWeeklyPct === 0) {
                    argonFiveHourPct = 0;
                  }

                  const effGemini5h = geminiFiveHourPct ?? 100;
                  const effGeminiWk = (typeof geminiWeeklyPct === 'number' && geminiWeeklyPct < 100) ? geminiWeeklyPct : effGemini5h;
                  const effGeminiWkReset = (typeof geminiWeeklyPct === 'number' && geminiWeeklyPct < 100 && geminiWeeklyReset) ? geminiWeeklyReset : geminiFiveHourReset;

                  const result: AccountLiveQuota = {
                    fiveHourPercentage: effGemini5h,
                    weeklyPercentage: effGeminiWk,
                    geminiFiveHourPct: effGemini5h,
                    geminiWeeklyPct: effGeminiWk,
                    claudeFiveHourPct: typeof claudeFiveHourPct === 'number' ? claudeFiveHourPct : 0,
                    claudeWeeklyPct: typeof claudeWeeklyPct === 'number' ? claudeWeeklyPct : 0,
                    argonFiveHourPct,
                    argonWeeklyPct,
                    updatedAt: Date.now(),
                    geminiResetTime: geminiFiveHourReset,
                    geminiFiveHourReset,
                    geminiWeeklyReset: effGeminiWkReset,
                    claudeResetTime: claudeFiveHourReset,
                    claudeFiveHourReset,
                    claudeWeeklyReset,
                    argonFiveHourReset,
                    argonWeeklyReset,
                    groups: rawGroups,
                  };

                  // Non-blocking tier, project, Claude 5.5 capability, and real Gemini model quota discovery
                  Promise.allSettled([
                    fetchAccountTierAndProject(accessToken),
                    checkAccountClaude55Access(accessToken),
                    geminiFiveHourPct === undefined ? fetchRealModelQuotas(accessToken) : Promise.resolve(null),
                  ])
                    .then(([tierRes, has55Res, modelQuotaRes]) => {
                      if (tierRes.status === 'fulfilled' && tierRes.value) {
                        const info = tierRes.value;
                        if (info.tierId) result.tierId = info.tierId;
                        if (info.tier) result.tier = info.tier;
                        if (info.projectId) result.projectId = info.projectId;
                        if (typeof info.creditAmount !== 'undefined') result.creditAmount = info.creditAmount;
                      }
                      if (has55Res.status === 'fulfilled' && has55Res.value === true) {
                        result.hasClaude55 = true;
                        result.isFamilyShared = true;
                        result.tier = 'partage';
                      } else if (has55Res.status === 'fulfilled' && has55Res.value === false) {
                        result.hasClaude55 = false;
                      }
                      if (modelQuotaRes.status === 'fulfilled' && modelQuotaRes.value) {
                        const mq = modelQuotaRes.value;
                        if (typeof mq.geminiFiveHourPct === 'number') {
                          result.geminiFiveHourPct = mq.geminiFiveHourPct;
                          result.fiveHourPercentage = mq.geminiFiveHourPct;
                          if (mq.geminiFiveHourReset) {
                            result.geminiFiveHourReset = mq.geminiFiveHourReset;
                            result.geminiResetTime = mq.geminiFiveHourReset;
                          }
                        }
                        if (typeof mq.argonFiveHourPct === 'number' && typeof result.argonFiveHourPct !== 'number') {
                          result.argonFiveHourPct = mq.argonFiveHourPct;
                          result.argonFiveHourReset = mq.argonFiveHourReset;
                        }
                      }
                      resolve(result);
                    })
                    .catch(() => resolve(result));
                  return;
                } catch (_) {
                  tryHost(idx + 1);
                }
              } else if (res.statusCode === 429 || (res.statusCode && res.statusCode >= 500)) {
                tryHost(idx + 1);
              } else {
                resolve(null);
              }
            });
          }
        );

        req.on('timeout', () => {
          req.destroy();
          tryHost(idx + 1);
        });
        req.on('error', () => {
          tryHost(idx + 1);
        });
        req.write(body);
        req.end();
      } catch (_) {
        tryHost(idx + 1);
      }
    };

    tryHost(0);
  });
}

/**
 * Synchronizes live quotas for all unique Google accounts in the pool.
 * Also proactively renews tokens that are within 5 minutes of expiring.
 */
export async function pollAllGoogleQuotas(
  accounts: Array<{ refreshToken?: string; apiKey?: string; accountEmail?: string; email?: string; provider?: string; apiUrl?: string; name?: string }>,
  onQuotaSync?: (accountKey: string, quota: AccountLiveQuota) => void,
): Promise<void> {
  if (!Array.isArray(accounts) || accounts.length === 0) return;
  const seenTokens = new Set<string>();

  for (const acc of accounts) {
    const refreshToken = (acc.refreshToken || '').trim();
    if (refreshToken && isTokenRevoked(refreshToken)) {
      continue;
    }
    const tokenKey = refreshToken || (acc.apiKey || '').trim();
    if (!tokenKey || seenTokens.has(tokenKey)) continue;
    seenTokens.add(tokenKey);

    const isCli = isGeminiCliModel(acc);
    const prefix = isCli ? 'gemini-cli' : 'google';
    const email = (acc.accountEmail || acc.email || '').trim().toLowerCase();
    const accountKey = email ? `${prefix}:${email}` : (acc.apiKey || tokenKey);

    try {
      // If refresh token is nearing expiration, force proactive renewal
      if (refreshToken && shouldRenewToken(refreshToken, 300_000)) {
        log.debug(`[GoogleAuth] Proactively renewing access token for ${email || 'account'} during quota poll`);
        await refreshGoogleToken(refreshToken, true, isCli ? 'gemini-cli' : 'antigravity');
      }

      const accessToken = await getValidGoogleAccessToken(acc);
      if (!accessToken) continue;
      const quota = await fetchLiveUserQuota(accessToken);
      if (quota) {
        const prevQuota = getLiveAccountQuota(accountKey) || accountLiveQuotas.get(accountKey);
        if (prevQuota) {
          const now = Date.now();
          const gemini5hReset = (prevQuota.geminiFiveHourReset || prevQuota.geminiResetTime) ? Date.parse(prevQuota.geminiFiveHourReset || prevQuota.geminiResetTime!) : 0;
          const geminiWeeklyReset = prevQuota.geminiWeeklyReset ? Date.parse(prevQuota.geminiWeeklyReset) : 0;
          const isGeminiWeeklyExhausted = (quota.geminiWeeklyPct === 0 || prevQuota.geminiWeeklyPct === 0 || prevQuota.weeklyPercentage === 0) && geminiWeeklyReset > now;
          const isGemini5hExhausted = (quota.geminiFiveHourPct === 0 || prevQuota.geminiFiveHourPct === 0) && (gemini5hReset > now || isGeminiWeeklyExhausted);

          if (isGeminiWeeklyExhausted || (isGemini5hExhausted && quota.geminiFiveHourPct === 0)) {
            quota.geminiFiveHourPct = 0;
            quota.fiveHourPercentage = 0;
            if (isGeminiWeeklyExhausted) {
              quota.geminiWeeklyPct = 0;
              quota.weeklyPercentage = 0;
              quota.geminiWeeklyReset = prevQuota.geminiWeeklyReset;
              quota.geminiFiveHourReset = prevQuota.geminiWeeklyReset;
              quota.geminiResetTime = prevQuota.geminiWeeklyReset;
            } else {
              quota.geminiFiveHourReset = prevQuota.geminiFiveHourReset || prevQuota.geminiResetTime;
              quota.geminiResetTime = prevQuota.geminiResetTime || prevQuota.geminiFiveHourReset;
              if (prevQuota.geminiWeeklyPct === 0 || prevQuota.weeklyPercentage === 0) {
                quota.geminiWeeklyPct = 0;
                quota.weeklyPercentage = 0;
              }
              if (prevQuota.geminiWeeklyReset) quota.geminiWeeklyReset = prevQuota.geminiWeeklyReset;
            }
          } else if (quota.geminiFiveHourPct > 0 && !isGeminiWeeklyExhausted) {
            quota.geminiFiveHourReset = undefined;
            quota.geminiResetTime = undefined;
          }

          const claude5hReset = (prevQuota.claudeFiveHourReset || prevQuota.claudeResetTime) ? Date.parse(prevQuota.claudeFiveHourReset || prevQuota.claudeResetTime!) : 0;
          const claudeWeeklyReset = prevQuota.claudeWeeklyReset ? Date.parse(prevQuota.claudeWeeklyReset) : 0;
          const isClaudeWeeklyExhausted = (quota.claudeWeeklyPct === 0 || prevQuota.claudeWeeklyPct === 0 || prevQuota.weeklyPercentage === 0) && claudeWeeklyReset > now;
          const isClaude5hExhausted = (quota.claudeFiveHourPct === 0 || prevQuota.claudeFiveHourPct === 0) && (claude5hReset > now || isClaudeWeeklyExhausted);

          if (isClaudeWeeklyExhausted || (isClaude5hExhausted && quota.claudeFiveHourPct === 0)) {
            quota.claudeFiveHourPct = 0;
            if (isClaudeWeeklyExhausted) {
              quota.claudeWeeklyPct = 0;
              quota.claudeWeeklyReset = prevQuota.claudeWeeklyReset;
              quota.claudeFiveHourReset = prevQuota.claudeWeeklyReset;
              quota.claudeResetTime = prevQuota.claudeWeeklyReset;
            } else {
              quota.claudeFiveHourReset = prevQuota.claudeFiveHourReset;
              quota.claudeResetTime = prevQuota.claudeFiveHourReset;
              if (prevQuota.claudeWeeklyPct === 0 || prevQuota.weeklyPercentage === 0) {
                quota.claudeWeeklyPct = 0;
              }
              if (prevQuota.claudeWeeklyReset) quota.claudeWeeklyReset = prevQuota.claudeWeeklyReset;
            }
          } else if (quota.claudeFiveHourPct > 0 && !isClaudeWeeklyExhausted) {
            quota.claudeFiveHourReset = undefined;
            quota.claudeResetTime = undefined;
          }
        }
        const quotaChanged = !prevQuota ||
          prevQuota.geminiFiveHourPct !== quota.geminiFiveHourPct ||
          prevQuota.geminiWeeklyPct !== quota.geminiWeeklyPct ||
          prevQuota.claudeFiveHourPct !== quota.claudeFiveHourPct ||
          prevQuota.claudeWeeklyPct !== quota.claudeWeeklyPct;
        accountLiveQuotas.set(accountKey, quota);
        if (onQuotaSync) {
          try {
            onQuotaSync(accountKey, quota);
          } catch (_) {}
        }
        if (quotaChanged) {
          const healthRemark = (quota.geminiFiveHourPct > 20 && quota.geminiWeeklyPct > 10) ? '🟢' : '🟡';
          log.info(
            `[GoogleAuth] ${healthRemark} Live quota for ${email || 'account'}: Gemini 5h=${quota.geminiFiveHourPct}%, week=${quota.geminiWeeklyPct}% | Claude 5h=${quota.claudeFiveHourPct}%, week=${quota.claudeWeeklyPct}%`
          );
          // Auto-recover exhausted accounts when rolling 5-hour quota recovers above 0
          if ((quota.geminiFiveHourPct > 0 || quota.claudeFiveHourPct > 0) && email) {
            try {
              const { clearAccountQuotaExhaustedFromDisk } = require('../../proxy/resilience/google/identity/diskPersistence');
              clearAccountQuotaExhaustedFromDisk(email);
            } catch (_) {}
          }
        } else {
          log.debug(
            `[GoogleAuth] Live quota unchanged for ${email || 'account'}: Gemini 5h=${quota.geminiFiveHourPct}%, week=${quota.geminiWeeklyPct}% | Claude 5h=${quota.claudeFiveHourPct}%, week=${quota.claudeWeeklyPct}%`
          );
        }
      }
    } catch (err: any) {
      log.debug(`[GoogleAuth] Live quota sync skipped for ${email || 'account'}: ${err?.message || err}`);
    }
  }
}

/**
 * Resolves a valid access token for a Google account candidate.
 * Prefers refreshing the refresh token; falls back to raw apiKey if it starts with ya29.
 * If token is cached but expires within 5 minutes, serves cached token instantly (0ms latency)
 * while triggering a non-blocking background refresh for subsequent requests.
 */
