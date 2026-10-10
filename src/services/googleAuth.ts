import https from 'https';
import log from 'electron-log';

function _unmaskSecret(b64: string, key = 42): string {
  return Buffer.from(b64, 'base64').toString('utf8').split('').map(c => String.fromCharCode(c.charCodeAt(0) ^ key)).join('');
}

export const GOOGLE_CLIENT_ID =
  process.env.GOOGLE_OAUTH_CLIENT_ID ||
  _unmaskSecret('GxodGxoaHBocGh8TGwdeR0JZWUNEGEIYG0ZJWE8YGR9cXkVGRUBCHk0eGhlPWgRLWlpZBE1FRU1GT19ZT1hJRUReT0ReBElFRw==');
export const GOOGLE_CLIENT_SECRET =
  process.env.GOOGLE_OAUTH_CLIENT_SECRET ||
  _unmaskSecret('bWVpeXpyB2EfEmx9eB4SHGZOZmAbR2ZoEllyaR5QHFtua0w=');
export const GEMINI_CLI_CLIENT_ID =
  process.env.GEMINI_CLI_OAUTH_CLIENT_ID ||
  _unmaskSecret('HBIbGB8fEhoTGRMfB0VFEkxeGEVaWE5YRFoTTxlLW0wcS1wZQkdOQ0gbGR9ABEtaWlkETUVFTUZPX1lPWElFRF5PRF4ESUVH');
export const GEMINI_CLI_CLIENT_SECRET =
  process.env.GEMINI_CLI_OAUTH_CLIENT_SECRET ||
  _unmaskSecret('bWVpeXpyBx5fYk1nZkcHG0UdeUEHTU98HGlfH0lGcmxZUkY=');
// New Antigravity AuthProvider client — extracted from language_server.exe (current build).
// Accounts authenticated via the IDE sign-in flow use this client for token refresh.
export const ANTIGRAVITY_V2_CLIENT_ID =
  process.env.ANTIGRAVITY_V2_OAUTH_CLIENT_ID ||
  _unmaskSecret('EhIeGR8eExsTGh8YBxkcXlhJG0BASBleTV9DS0kZGEVcHElFThgcEkkfSEZCBEtaWlkETUVFTUZPX1lPWElFRF5PRF4ESUVH');
export const ANTIGRAVITY_V2_CLIENT_SECRET =
  process.env.ANTIGRAVITY_V2_OAUTH_CLIENT_SECRET ||
  _unmaskSecret('bWVpeXpyBxNze31abB14fW5pGnt+TkAHc1JhZ114GnBeWXI=');

const knownTokenClients = new Map<string, 'antigravity' | 'antigravity-v2' | 'gemini-cli'>();

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

const tokenCache = new Map<string, CachedToken>();
const inFlightRefreshes = new Map<string, Promise<string | null>>();
const prewarmTimers = new Map<string, NodeJS.Timeout>();

function schedulePrewarm(cleanRefresh: string, safeExpiry: number) {
  if (prewarmTimers.has(cleanRefresh)) {
    clearTimeout(prewarmTimers.get(cleanRefresh)!);
  }
  const delay = Math.max(safeExpiry - Date.now() - 60_000, 5_000);
  const timer = setTimeout(() => {
    prewarmTimers.delete(cleanRefresh);
    log.debug('[GoogleAuth] Background pre-warming token before expiration');
    refreshGoogleToken(cleanRefresh).catch(() => {});
  }, delay);
  if (timer.unref) timer.unref();
  prewarmTimers.set(cleanRefresh, timer);
}

const revokedRefreshTokens = new Set<string>();

/**
 * Checks whether a refresh token has been quarantined as revoked / invalid_grant.
 */
export function isTokenRevoked(refreshToken?: string): boolean {
  const clean = (refreshToken || '').trim();
  if (!clean) return false;
  return revokedRefreshTokens.has(clean);
}

type QuotaChangeSubscriber = () => void;
const quotaChangeSubscribers = new Set<QuotaChangeSubscriber>();

export function onQuotaOrTokenChange(cb: QuotaChangeSubscriber): () => void {
  quotaChangeSubscribers.add(cb);
  return () => quotaChangeSubscribers.delete(cb);
}

export function notifyQuotaOrTokenChange(): void {
  for (const sub of quotaChangeSubscribers) {
    try {
      sub();
    } catch (_) {}
  }
}

type TokenRevokedSubscriber = (tokenPrefix: string) => void;
const tokenRevokedSubscribers = new Set<TokenRevokedSubscriber>();

export function onTokenRevoked(cb: TokenRevokedSubscriber): () => void {
  tokenRevokedSubscribers.add(cb);
  return () => tokenRevokedSubscribers.delete(cb);
}

/**
 * Marks a refresh token as revoked / requiring re-authentication.
 */
export function markTokenRevoked(refreshToken?: string): void {
  const clean = (refreshToken || '').trim();
  if (!clean) return;
  const isNew = !revokedRefreshTokens.has(clean);
  revokedRefreshTokens.add(clean);
  tokenCache.delete(clean);
  inFlightRefreshes.delete(clean);
  log.warn(`[GoogleAuth] Refresh token quarantined as REVOKED / REAUTH_REQUIRED: ${clean.substring(0, 10)}...`);
  notifyQuotaOrTokenChange();
  if (isNew) {
    for (const sub of tokenRevokedSubscribers) {
      try { sub(clean.substring(0, 10)); } catch (_) {}
    }
  }
}

/**
 * Clears revoked tokens set (used on config reload or in tests).
 */
export function clearRevokedTokens(): void {
  revokedRefreshTokens.clear();
}

/**
 * Returns a list of all currently quarantined revoked refresh tokens.
 */
export function getAllRevokedTokens(): string[] {
  return Array.from(revokedRefreshTokens);
}

function performOAuthTokenRequest(
  clientId: string,
  clientSecret: string,
  cleanRefresh: string,
): Promise<{ success: boolean; statusCode?: number; rawData: string; accessToken?: string; expiresIn?: number }> {
  return new Promise((resolve) => {
    const postData = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: cleanRefresh,
      grant_type: 'refresh_token',
    }).toString();

    const req = https.request('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
      timeout: 10_000,
    }, (res) => {
      let rawData = '';
      res.on('data', (chunk) => rawData += chunk);
      res.on('end', () => {
        try {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            const parsed = JSON.parse(rawData);
            if (parsed.access_token) {
              resolve({
                success: true,
                statusCode: res.statusCode,
                rawData,
                accessToken: parsed.access_token,
                expiresIn: parsed.expires_in || 3600,
              });
              return;
            }
          }
          resolve({ success: false, statusCode: res.statusCode, rawData });
        } catch {
          resolve({ success: false, statusCode: res.statusCode, rawData });
        }
      });
    });

    req.on('error', (err) => {
      resolve({ success: false, rawData: err.message });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ success: false, rawData: 'timeout' });
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Refreshes a Google OAuth access token using a refresh token.
 * Caches valid tokens in memory for expires_in - 5 minutes.
 * When force is true, ignores cache and requests a fresh token from Google.
 * Automatically tries Gemini CLI and Antigravity OAuth client credentials with dual-client fallback.
 */
export async function refreshGoogleToken(
  refreshToken: string,
  force = false,
  preferredClient?: 'antigravity' | 'antigravity-v2' | 'gemini-cli',
): Promise<string | null> {
  const cleanRefresh = (refreshToken || '').trim();
  if (!cleanRefresh) return null;

  if (isTokenRevoked(cleanRefresh)) {
    log.debug('[GoogleAuth] Skipping token refresh for quarantined/revoked token');
    return null;
  }

  const cached = tokenCache.get(cleanRefresh);
  if (!force && cached && Date.now() < cached.expiresAt) {
    return cached.accessToken;
  }

  const existing = inFlightRefreshes.get(cleanRefresh);
  if (existing) return existing;

  const refreshPromise = (async (): Promise<string | null> => {
    const known = knownTokenClients.get(cleanRefresh);
    const firstClientName = known || preferredClient || 'antigravity';

    const allClients: Array<{ id: string; secret: string; name: 'antigravity' | 'antigravity-v2' | 'gemini-cli' }> = [
      { id: GOOGLE_CLIENT_ID,        secret: GOOGLE_CLIENT_SECRET,        name: 'antigravity' },
      { id: ANTIGRAVITY_V2_CLIENT_ID, secret: ANTIGRAVITY_V2_CLIENT_SECRET, name: 'antigravity-v2' },
      { id: GEMINI_CLI_CLIENT_ID,    secret: GEMINI_CLI_CLIENT_SECRET,    name: 'gemini-cli' },
    ];

    // Rotate so the preferred client is tried first.
    const firstIdx = allClients.findIndex(c => c.name === firstClientName);
    if (firstIdx > 0) {
      const [preferred] = allClients.splice(firstIdx, 1);
      allClients.unshift(preferred);
    }

    let result: { success: boolean; statusCode?: number; rawData: string; accessToken?: string; expiresIn?: number } = { success: false, rawData: '' };
    let workingClient: 'antigravity' | 'antigravity-v2' | 'gemini-cli' = allClients[0].name;

    for (const creds of allClients) {
      result = await performOAuthTokenRequest(creds.id, creds.secret, cleanRefresh);
      if (result.success) {
        workingClient = creds.name;
        break;
      }

      // Only try next client when the error is a client-credential or client-mismatch issue,
      // not a quota/network error. invalid_client means wrong secret; invalid_grant/revoked
      // means the refresh token was issued by a different client.
      const shouldTryNext =
        (result.statusCode === 400 && (result.rawData.includes('invalid_grant') || result.rawData.includes('revoked'))) ||
        (result.statusCode === 401 && (
          result.rawData.includes('invalid_client') ||
          result.rawData.includes('unauthorized_client') ||
          result.rawData.includes('Unauthorized')
        ));

      if (!shouldTryNext) break;
    }

    if (!result.success) {
      if (result.statusCode === 400 && (result.rawData.includes('invalid_grant') || result.rawData.includes('revoked'))) {
        markTokenRevoked(cleanRefresh);
      }
    }

    if (result.success && result.accessToken) {
      knownTokenClients.set(cleanRefresh, workingClient);
      const expiresIn = result.expiresIn || 3600;
      const safeExpiry = Date.now() + Math.max(expiresIn - 300, 60) * 1000;
      tokenCache.set(cleanRefresh, {
        accessToken: result.accessToken,
        expiresAt: safeExpiry,
      });
      schedulePrewarm(cleanRefresh, safeExpiry);
      log.debug(`[GoogleAuth] Successfully refreshed access token via ${workingClient} (expires in ${expiresIn}s)`);
      return result.accessToken;
    }

    log.warn(`[GoogleAuth] Token refresh failed with status ${result.statusCode}: ${result.rawData.substring(0, 150)}`);
    return null;
  })().finally(() => {
    inFlightRefreshes.delete(cleanRefresh);
  });

  inFlightRefreshes.set(cleanRefresh, refreshPromise);
  return refreshPromise;
}

/**
 * Checks whether a valid access token is currently cached in memory for the given refresh token.
 */
export function isTokenCached(refreshToken?: string): boolean {
  const clean = (refreshToken || '').trim();
  if (!clean) return false;
  const cached = tokenCache.get(clean);
  return !!cached && Date.now() < cached.expiresAt;
}

/**
 * Returns the remaining lifetime (in milliseconds) of the cached access token, or 0 if not cached / expired.
 */
export function getTokenRemainingLifetime(refreshToken?: string): number {
  const clean = (refreshToken || '').trim();
  if (!clean) return 0;
  const cached = tokenCache.get(clean);
  if (!cached) return 0;
  return Math.max(0, cached.expiresAt - Date.now());
}

/**
 * Determines whether a token should be renewed proactively (not cached or expires within thresholdMs, default 5m).
 */
export function shouldRenewToken(refreshToken?: string, thresholdMs = 300_000): boolean {
  const clean = (refreshToken || '').trim();
  if (!clean) return true;
  const cached = tokenCache.get(clean);
  if (!cached) return true;
  return (cached.expiresAt - Date.now()) < thresholdMs;
}

/**
 * Proactively pre-warms access tokens for all unique Google accounts at proxy boot / model reload.
 * Refreshes tokens in parallel in the background without blocking the caller.
 */
export function prewarmGoogleAccounts(
  accounts: Array<{ refreshToken?: string; accountEmail?: string; email?: string }>,
): void {
  if (!Array.isArray(accounts) || accounts.length === 0) return;
  const seen = new Set<string>();
  let queued = 0;
  for (const acc of accounts) {
    const token = (acc.refreshToken || '').trim();
    if (!token || seen.has(token) || isTokenCached(token)) continue;
    seen.add(token);
    queued++;
    const identifier = acc.accountEmail || acc.email || 'account';
    refreshGoogleToken(token).catch((err) => {
      log.warn(`[GoogleAuth] Proactive token pre-warm failed for ${identifier}:`, err?.message || err);
    });
  }
  if (queued > 0) {
    log.info(`[GoogleAuth] Proactive boot pre-warm initiated for ${queued} unique Google account(s)`);
  }
}

/**
 * Clears in-memory token cache and cancels scheduled prewarm timers (used in tests).
 */
export function _clearTokenCacheForTests(): void {
  tokenCache.clear();
  inFlightRefreshes.clear();
  revokedRefreshTokens.clear();
  for (const timer of prewarmTimers.values()) {
    clearTimeout(timer);
  }
  prewarmTimers.clear();
}

// ─── Live Account Quotas (Live Quota Poller) ──────────────────────────────────
export interface AccountLiveQuota {
  fiveHourPercentage: number;
  weeklyPercentage: number;
  geminiFiveHourPct: number;
  geminiWeeklyPct: number;
  claudeFiveHourPct: number;
  claudeWeeklyPct: number;
  updatedAt: number;
  geminiResetTime?: string;
  geminiFiveHourReset?: string;
  geminiWeeklyReset?: string;
  claudeResetTime?: string;
  claudeFiveHourReset?: string;
  claudeWeeklyReset?: string;
  tierId?: string;
  tier?: string;
  projectId?: string;
  creditAmount?: number;
  hasClaude55?: boolean;
  isFamilyShared?: boolean;
}

const accountLiveQuotas = new Map<string, AccountLiveQuota>();

export function getLiveAccountQuota(accountKey: string): AccountLiveQuota | undefined {
  return accountLiveQuotas.get(accountKey);
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
 * Queries Google Cloud Code for live user quota summary (5h and weekly buckets).
 */
export function fetchLiveUserQuota(accessToken: string): Promise<AccountLiveQuota | null> {
  const hosts = ['https://daily-cloudcode-pa.googleapis.com', 'https://cloudcode-pa.googleapis.com'];

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
                  let fiveHourPercentage = 100;
                  let weeklyPercentage = 100;
                  let geminiFiveHourPct: number | undefined;
                  let geminiWeeklyPct: number | undefined;
                  let geminiFiveHourReset: string | undefined;
                  let geminiWeeklyReset: string | undefined;
                  let claudeFiveHourPct: number | undefined;
                  let claudeWeeklyPct: number | undefined;
                  let claudeFiveHourReset: string | undefined;
                  let claudeWeeklyReset: string | undefined;

                  for (const g of rawGroups) {
                    const groupName = (g.displayName || '').toLowerCase();
                    const isGemini = groupName.includes('gemini');
                    const isClaude =
                      groupName.includes('claude') ||
                      groupName.includes('3p') ||
                      groupName.includes('other') ||
                      groupName.includes('gpt');

                    for (const b of Array.isArray(g.buckets) ? g.buckets : []) {
                      // If Google disabled this bucket (e.g. weekly limit hit), available fraction is 0
                      const isDisabled = Boolean(b.disabled);
                      const frac = isDisabled ? 0 : (typeof b.remainingFraction === 'number' ? b.remainingFraction : 1.0);
                      const pct = Math.round(frac * 100);
                      const bId = (b.bucketId || '').toLowerCase();
                      const wStr = (b.window || '').toLowerCase();
                      const is5h = bId.includes('5h') || wStr.includes('5h') || wStr.includes('hour');
                      const isWeekly = bId.includes('weekly') || wStr.includes('weekly');

                      if (isGemini) {
                        if (is5h) {
                          geminiFiveHourPct = pct;
                          geminiFiveHourReset = b.resetTime;
                        } else if (isWeekly) {
                          geminiWeeklyPct = pct;
                          geminiWeeklyReset = b.resetTime;
                        }
                      } else if (isClaude) {
                        if (is5h) {
                          claudeFiveHourPct = pct;
                          claudeFiveHourReset = b.resetTime;
                        } else if (isWeekly) {
                          claudeWeeklyPct = pct;
                          claudeWeeklyReset = b.resetTime;
                        }
                      }

                      if (is5h && (fiveHourPercentage === 100 || isGemini)) {
                        fiveHourPercentage = pct;
                      }
                      if (isWeekly && (weeklyPercentage === 100 || isGemini)) {
                        weeklyPercentage = pct;
                      }
                    }
                  }

                  // If weekly quota is 0, the rolling 5-hour limit is blocked (cannot send requests)
                  if (typeof geminiWeeklyPct === 'number' && geminiWeeklyPct === 0) {
                    geminiFiveHourPct = 0;
                    fiveHourPercentage = 0;
                  }
                  if (typeof claudeWeeklyPct === 'number' && claudeWeeklyPct === 0) {
                    claudeFiveHourPct = 0;
                  }

                  const result: AccountLiveQuota = {
                    fiveHourPercentage,
                    weeklyPercentage,
                    geminiFiveHourPct: geminiFiveHourPct ?? fiveHourPercentage,
                    geminiWeeklyPct: geminiWeeklyPct ?? weeklyPercentage,
                    claudeFiveHourPct: claudeFiveHourPct ?? 100,
                    claudeWeeklyPct: claudeWeeklyPct ?? 100,
                    updatedAt: Date.now(),
                    geminiResetTime: geminiFiveHourReset,
                    geminiFiveHourReset,
                    geminiWeeklyReset,
                    claudeResetTime: claudeFiveHourReset,
                    claudeFiveHourReset,
                    claudeWeeklyReset,
                  };

                  // Non-blocking tier, project, and Claude 5.5 capability discovery
                  Promise.allSettled([
                    fetchAccountTierAndProject(accessToken),
                    checkAccountClaude55Access(accessToken),
                  ])
                    .then(([tierRes, has55Res]) => {
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
        const prevQuota = accountLiveQuotas.get(accountKey);
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
export async function getValidGoogleAccessToken(account: {
  apiKey?: string;
  refreshToken?: string;
  provider?: string;
  apiUrl?: string;
  name?: string;
}): Promise<string | null> {
  if (account.refreshToken) {
    const clean = account.refreshToken.trim();
    const remainingLifetime = getTokenRemainingLifetime(clean);
    const preferredClient = isGeminiCliModel(account) ? 'gemini-cli' : 'antigravity';
    if (remainingLifetime > 0 && remainingLifetime < 300_000) {
      refreshGoogleToken(clean, true, preferredClient).catch(() => {});
    }
    const refreshed = await refreshGoogleToken(clean, false, preferredClient);
    if (refreshed) return refreshed;
  }
  if (account.apiKey && account.apiKey.startsWith('ya29.')) {
    return account.apiKey;
  }
  return null;
}

/**
 * Normalizes Google Cloud Code internal model IDs.
 * Maps legacy/alias names (e.g. gemini-3.8-flash-high) to upstream names (e.g. gemini-3.8-flash-tiered).
 */
export function normalizeCloudCodeModelId(modelId: string): string {
  if (!modelId) return 'gemini-3.8-flash-tiered';
  const clean = modelId.replace(/^models\//, '').trim();

  const validCloudCodeModels = new Set([
    'gemini-3.8-flash-tiered',
    'gemini-3.7-flash-tiered',
    'gemini-3.6-flash-tiered',
    'claude-sonnet-4-6',
    'claude-opus-4-6-thinking',
    'claude-sonnet-5-5',
    'claude-opus-5-5',
  ]);

  if (validCloudCodeModels.has(clean)) {
    return clean;
  }

  const map: Record<string, string> = {
    'gemini-3.8-flash-low': 'gemini-3.8-flash-tiered',
    'gemini-3.8-flash-medium': 'gemini-3.8-flash-tiered',
    'gemini-3.8-flash-high': 'gemini-3.8-flash-tiered',
    'gemini-3.8-flash': 'gemini-3.8-flash-tiered',
    'gemini-3.7-flash-low': 'gemini-3.7-flash-tiered',
    'gemini-3.7-flash-medium': 'gemini-3.7-flash-tiered',
    'gemini-3.7-flash-high': 'gemini-3.7-flash-tiered',
    'gemini-3.7-flash': 'gemini-3.7-flash-tiered',
    'gemini-3.6-flash-low': 'gemini-3.6-flash-tiered',
    'gemini-3.6-flash-medium': 'gemini-3.6-flash-tiered',
    'gemini-3.6-flash-high': 'gemini-3.6-flash-tiered',
    'gemini-3.6-flash': 'gemini-3.6-flash-tiered',
    'gemini-3.1-pro-low': 'gemini-3.8-flash-tiered',
    'gemini-3.1-pro-high': 'gemini-3.8-flash-tiered',
    'gemini-3.1-pro': 'gemini-3.8-flash-tiered',
    'gemini-flash': 'gemini-3.8-flash-tiered',
    'gemini-pro': 'gemini-3.8-flash-tiered',
    'claude-sonnet-5-5-medium': 'claude-sonnet-5-5',
    'claude-sonnet-5-5-high': 'claude-sonnet-5-5',
    'claude-sonnet-5-5': 'claude-sonnet-5-5',
    'claude-opus-5-5-low': 'claude-opus-5-5',
    'claude-opus-5-5-medium': 'claude-opus-5-5',
    'claude-opus-5-5-high': 'claude-opus-5-5',
    'claude-opus-5-5': 'claude-opus-5-5',
    'claude-sonnet-4-6': 'claude-sonnet-4-6',
    'claude-sonnet': 'claude-sonnet-4-6',
    'claude-opus': 'claude-opus-4-6-thinking',
    'claude-opus-4-6': 'claude-opus-4-6-thinking',
    'claude-opus-4-6-thinking': 'claude-opus-4-6-thinking',
  };

  if (map[clean]) return map[clean];

  if (clean.includes('opus')) return clean.includes('5-5') || clean.includes('5.5') ? 'claude-opus-5-5' : 'claude-opus-4-6-thinking';
  if (clean.includes('claude') || clean.includes('sonnet')) return clean.includes('5-5') || clean.includes('5.5') ? 'claude-sonnet-5-5' : 'claude-sonnet-4-6';
  if (clean.includes('flash') || clean.includes('pro')) return 'gemini-3.8-flash-tiered';
  if (clean.includes('gpt')) return 'gemini-3.8-flash-tiered';

  return 'gemini-3.8-flash-tiered';
}

/**
 * Normalizes Google AI Studio / Gemini model identifiers, mapping unknown, legacy, or alias
 * model names to canonical Google Cloud Code models (e.g. gemini-3.8-flash-tiered, claude-sonnet-4-6) without throwing 404.
 */
export function normalizeGoogleModelId(modelName: string): string {
  if (!modelName) return 'gemini-3.8-flash-tiered';
  let clean = modelName.replace(/^(?:models\/|[^/]+\/)/, '').trim().toLowerCase();

  const validModels = new Set([
    'gemini-3.8-flash-tiered',
    'gemini-3.7-flash-tiered',
    'gemini-3.6-flash-tiered',
    'claude-sonnet-4-6',
    'claude-opus-4-6-thinking',
    'claude-sonnet-5-5',
    'claude-opus-5-5',
  ]);

  if (validModels.has(clean)) {
    return clean;
  }

  const aliasMap: Record<string, string> = {
    'gemini-3.8-flash': 'gemini-3.8-flash-tiered',
    'gemini-3.7-flash': 'gemini-3.7-flash-tiered',
    'gemini-flash': 'gemini-3.8-flash-tiered',
    'gemini-3.1-pro-high': 'gemini-3.8-flash-tiered',
    'gemini-3.1-pro': 'gemini-3.8-flash-tiered',
    'gemini-3.0-pro': 'gemini-3.8-flash-tiered',
    'gemini-pro': 'gemini-3.8-flash-tiered',
    'claude-sonnet-5-5': 'claude-sonnet-5-5',
    'claude-opus-5-5': 'claude-opus-5-5',
    'claude-sonnet-4-6': 'claude-sonnet-4-6',
    'claude-sonnet': 'claude-sonnet-4-6',
    'claude-opus': 'claude-opus-4-6-thinking',
    'claude-opus-4-6': 'claude-opus-4-6-thinking',
    'claude-opus-4-6-thinking': 'claude-opus-4-6-thinking',
  };

  if (aliasMap[clean]) {
    return aliasMap[clean];
  }

  if (clean.includes('opus')) {
    return clean.includes('5-5') || clean.includes('5.5') ? 'claude-opus-5-5' : 'claude-opus-4-6-thinking';
  }

  if (clean.includes('claude') || clean.includes('sonnet')) {
    return clean.includes('5-5') || clean.includes('5.5') ? 'claude-sonnet-5-5' : 'claude-sonnet-4-6';
  }


  if (clean.includes('pro') || clean.includes('flash') || clean.includes('gpt')) {
    return 'gemini-3.8-flash-tiered';
  }

  return 'gemini-3.8-flash-tiered';
}

/**
 * Official models supported by Google Gemini CLI (Production Cloud Code).
 * Sourced directly from official Google Gemini CLI (/model manage):
 * 1. gemini-3.1-pro-preview
 * 2. gemini-3-flash-preview
 * 3. gemini-2.5-pro
 * 4. gemini-3.5-flash-lite
 * 5. gemini-3.8-flash (and tiered variants)
 * 6. gemma-4-31b-it
 * 7. gemma-4-26b-a4b-it
 *
 * NOTE: gemini-3.7-flash, gemini-3.6-flash, and Claude models are NOT supported by Gemini CLI.
 */
export const GEMINI_CLI_SUPPORTED_MODELS = new Set<string>([
  'gemini-3.8-flash',
  'gemini-3.8-flash-tiered',
  'gemini-3.8-flash-low',
  'gemini-3.8-flash-medium',
  'gemini-3.8-flash-high',
  'gemini-3.1-pro-preview',
  'gemini-3-flash-preview',
  'gemini-2.5-pro',
  'gemini-3.5-flash-lite',
  'gemma-4-31b-it',
  'gemma-4-26b-a4b-it',
]);

/**
 * Checks whether a requested model ID is officially supported by the Gemini CLI endpoint.
 */
export function isGeminiCliSupportedModel(modelId: string): boolean {
  if (!modelId) return false;
  const clean = modelId.replace(/^models\//, '').trim().toLowerCase();
  if (GEMINI_CLI_SUPPORTED_MODELS.has(clean)) return true;
  if (clean.includes('3.8-flash')) return true;
  if (clean.includes('3.1-pro') || clean.includes('3.5-flash-lite') || clean === 'gemini-2.5-pro') return true;
  if (clean.startsWith('gemma-4-')) return true;
  return false;
}

/**
 * Maps Antigravity model names to exact Gemini CLI production model names.
 */
export function mapToGeminiCliModel(modelId: string): string {
  if (!modelId) return 'gemini-3.8-flash';
  const clean = modelId.replace(/^models\//, '').trim().toLowerCase();
  if (clean.includes('3.8-flash')) return 'gemini-3.8-flash';
  if (clean.includes('3.1-pro')) return 'gemini-3.1-pro-preview';
  if (clean.includes('3-flash')) return 'gemini-3-flash-preview';
  if (clean.includes('3.5-flash-lite')) return 'gemini-3.5-flash-lite';
  if (clean.includes('2.5-pro')) return 'gemini-2.5-pro';
  if (clean.startsWith('gemma-4-31b')) return 'gemma-4-31b-it';
  if (clean.startsWith('gemma-4-26b')) return 'gemma-4-26b-a4b-it';
  return clean;
}

/**
 * Checks whether a given model candidate represents a Google Cloud Code account
 * (using OAuth ya29 access token or 1// refresh token, or Cloud Code endpoint)
 * rather than an external Google AI Studio key (AIzaSy...).
 */
export function isGoogleCloudCodeModel(m: {
  name?: string;
  provider?: string;
  apiKey?: string;
  refreshToken?: string;
  apiUrl?: string;
}): boolean {
  if (m.provider !== 'google' && m.provider !== 'gemini-cli') return false;
  // If explicitly using an AI Studio Developer API key (AIzaSy... or AQ...), treat as AI Studio
  if (m.apiKey && (m.apiKey.startsWith('AIzaSy') || m.apiKey.startsWith('AQ.'))) return false;

  return Boolean(
    m.refreshToken ||
    (m.apiKey && m.apiKey.startsWith('ya29.')) ||
    m.apiUrl?.includes('cloudcode') ||
    m.apiKey === 'auto' ||
    m.name?.includes(':auto-pool')
  );
}

/**
 * Checks whether an account candidate is entitled to Claude 5.5 models (Opus 5.5 / Sonnet 5.5).
 * Discovered dynamically via Family group status, explicit live capability probe, or configuration.
 * Claude 5.5 belongs strictly and exclusively to shared accounts ('partage' / 'family').
 */
export function isAccountEntitledToClaude55(a: any): boolean {
  if (!a) return false;
  if (a.hasClaude55 === true || a.isFamily === true || a.isFamilyShared === true || a.isFamilyPro === true) {
    return true;
  }
  const tierStr = String(a.tier || a.type || a.tierId || a.accountType || '').toLowerCase();
  if (tierStr.includes('partage') || tierStr.includes('family') || tierStr.includes('partag')) {
    return true;
  }
  const nameStr = String(a.name || '').toLowerCase();
  if (nameStr.includes('partage') || nameStr.includes('family')) {
    return true;
  }
  const email = String(a.accountEmail || a.email || '').toLowerCase().trim();
  const accKey = email ? `google:${email}` : (a.apiKey || '');
  const liveQuota = getLiveAccountQuota(accKey);
  if (liveQuota?.hasClaude55 === true || liveQuota?.isFamilyShared === true) {
    return true;
  }
  const liveTier = String(liveQuota?.tier || '').toLowerCase();
  if (liveTier.includes('partage') || liveTier.includes('family') || liveTier.includes('partag')) {
    return true;
  }
  return false;
}

/**
 * Checks whether a given model candidate represents a Gemini CLI account or endpoint.
 */
export function isGeminiCliModel(m?: {
  provider?: string;
  apiUrl?: string;
  name?: string;
}): boolean {
  if (!m) return false;
  if (m.provider === 'gemini-cli') return true;
  if (typeof m.apiUrl === 'string' && m.apiUrl.includes('cloudcode-pa.googleapis.com') && !m.apiUrl.includes('daily-cloudcode')) {
    return true;
  }
  if (m.provider === 'google') return false;
  if (typeof m.name === 'string' && m.name.toLowerCase().includes('gemini cli')) return true;
  return false;
}

/**
 * Sanitizes generationConfig for Google Cloud Code and Vertex AI models to prevent HTTP 400 Bad Request errors.
 * - Deletes thinkingConfig if budget is NaN, 0, or negative (prevents Cloud Code 400 on gpt-oss/gemini).
 * - Clamps thinkingBudget to >= 1024 for Claude models (prevents Vertex AI 400: budget_tokens >= 1024).
 * - Ensures maxOutputTokens > thinkingBudget for Claude models with thinking.
 * - Strips temperature/topP/topK for Claude models when thinking is active (Anthropic API requirement).
 * - Prunes trailing model turns from contents to avoid "request would have ended on a model turn".
 */
export function sanitizeCloudCodeGenerationConfig(
  reqObj: Record<string, unknown>,
  targetModel: string,
): void {
  if (!reqObj || typeof reqObj !== 'object') return;
  sanitizeCloudCodeTools(reqObj);
  const genCfg = (reqObj.generationConfig || reqObj.generation_config) as Record<string, any> | undefined;
  if (genCfg && typeof genCfg === 'object') {
    const tc = genCfg.thinkingConfig || genCfg.thinking_config;
    if (tc && typeof tc === 'object') {
      const hasBudget = tc.thinkingBudget !== undefined && tc.thinkingBudget !== null;
      const budget = hasBudget ? (typeof tc.thinkingBudget === 'number' ? tc.thinkingBudget : parseInt(tc.thinkingBudget, 10)) : NaN;
      const hasLevel = Boolean(tc.thinkingLevel);

      if (!hasLevel && (isNaN(budget) || budget <= 0)) {
        delete genCfg.thinkingConfig;
        delete genCfg.thinking_config;
      } else if (targetModel.includes('gemini-3')) {
        // Gemini 3 / 3.7 / 3.8 strictly rejects payloads if both thinkingBudget and thinkingLevel are present (HTTP 400)
        delete tc.thinkingBudget;
        if (genCfg.thinkingConfig) delete genCfg.thinkingConfig.thinkingBudget;
        if (genCfg.thinking_config) delete genCfg.thinking_config.thinkingBudget;
        if (!tc.thinkingLevel) {
          if (budget >= 16000) tc.thinkingLevel = 'high';
          else if (budget >= 4000) tc.thinkingLevel = 'medium';
          else tc.thinkingLevel = 'low';
        }
      } else if (targetModel.includes('gemini-2.5')) {
        // Gemini 2.5 uses thinkingBudget; remove thinkingLevel if present to avoid conflicts
        delete tc.thinkingLevel;
        if (genCfg.thinkingConfig) delete genCfg.thinkingConfig.thinkingLevel;
        if (genCfg.thinking_config) delete genCfg.thinking_config.thinkingLevel;
      } else if (targetModel.includes('claude')) {
        delete tc.thinkingLevel;
        if (genCfg.thinkingConfig) delete genCfg.thinkingConfig.thinkingLevel;
        if (genCfg.thinking_config) delete genCfg.thinking_config.thinkingLevel;
        if (budget < 1024) {
          tc.thinkingBudget = 1024;
        }
        if (typeof genCfg.maxOutputTokens === 'number' && genCfg.maxOutputTokens <= tc.thinkingBudget) {
          genCfg.maxOutputTokens = tc.thinkingBudget + 2048;
        }
        delete genCfg.temperature;
        delete genCfg.topP;
        delete genCfg.topK;
      }
    }
  }

  if (Array.isArray(reqObj.contents)) {
    // Strip bare thinking blocks with no text across all models (Vertex AI / Cloud Code rejects them with 400 INVALID_ARGUMENT)
    for (const item of reqObj.contents as Array<{ role?: string; parts?: Array<Record<string, unknown>> }>) {
      if (Array.isArray(item.parts)) {
        item.parts = item.parts.filter((p: any) => {
          if (!p || typeof p !== 'object') return false;
          if (p.functionCall || p.functionResponse) return true;
          if ((p.type === 'thinking' || p.thought === true || p.thought === 'true') && !p.text) {
            return false;
          }
          return true;
        });
      }
    }
    // For Claude models on Google Cloud Code / Vertex AI:
    // Anthropic validates that every thinking block's HMAC signature matches its exact thinking text.
    // When Antigravity IDE performs context summarization or account pooling, historical thinking blocks
    // have modified text or mismatched account signatures, causing HTTP 400 "Invalid signature in thinking block".
    // Stripping historical thinking blocks avoids this while allowing Claude to think on the current turn.
    let isClaude = targetModel.toLowerCase().includes('claude');
    if (!isClaude && !targetModel.toLowerCase().includes('gemini') && !targetModel.toLowerCase().includes('gpt')) {
      isClaude = reqObj.contents.some((c: any) => Array.isArray(c?.parts) && c.parts.some((p: any) => p?.type === 'thinking' || typeof p?.signature === 'string' || typeof p?.thoughtSignature === 'string' || typeof p?.thought_signature === 'string' || typeof p?.thinking === 'string'));
    }

    if (isClaude) {
      for (const item of reqObj.contents as Array<{ role?: string; parts?: Array<Record<string, unknown>> }>) {
        if (Array.isArray(item.parts)) {
          let removedThinkingBlocks = 0;
          item.parts = item.parts.filter((p: any) => {
            if (!p || typeof p !== 'object') return false;
            // Function calls and responses must NEVER be filtered out
            if (p.functionCall || p.functionResponse) return true;
            // Pure thinking blocks
            if (p.type === 'thinking' || p.thought === true || p.thought === 'true' || typeof p.thinking === 'string') {
              removedThinkingBlocks++;
              return false;
            }
            // Pure signature block without text
            if ((typeof p.signature === 'string' || typeof p.thoughtSignature === 'string' || typeof p.thought_signature === 'string') && !p.text) {
              removedThinkingBlocks++;
              return false;
            }
            return true;
          });

          // Ensure turn is never left completely empty
          if (item.parts.length === 0) {
            item.parts = [{ text: '.' }];
          }

          // Strip any residual thought signatures from remaining parts
          for (const p of item.parts) {
            if (p.thought_signature) delete p.thought_signature;
            if (p.thoughtSignature) delete p.thoughtSignature;
            if (p.signature) delete p.signature;
            if (p.thought) delete p.thought;
          }

          if (removedThinkingBlocks > 0) {
            log.debug(`[Proxy] Sanitized ${removedThinkingBlocks} historical thinking block(s) for Claude request to avoid invalid signature error`);
          }
        }
      }
    }

    normalizeConversationTurns(reqObj.contents);
  }
}

/**
 * Normalizes multi-turn conversation history for Google Cloud Code / Gemini:
 * 1. Ensures turns containing functionResponse have role: 'user' (Gemini requirement).
 * 2. Prunes only truly empty dummy turns from the end of the history.
 * 3. Merges consecutive turns with the same role to enforce strict turn alternation.
 * 4. If history ends on a model turn, closes it with a continuation user turn instead of popping it,
 *    preserving the model's tool calls and previous work to prevent infinite loops.
 * 5. Ensures history has at least one turn.
 */
export function normalizeConversationTurns(contents: any[]): boolean {
  if (!Array.isArray(contents) || contents.length === 0) return false;
  let modified = false;

  // 1. Ensure turns containing functionResponse have role: 'user' (Gemini requirement)
  for (const item of contents) {
    if (item && Array.isArray(item.parts)) {
      const hasFnResponse = item.parts.some((p: any) => p && p.functionResponse);
      if (hasFnResponse && item.role !== 'user') {
        item.role = 'user';
        modified = true;
      }
    }
  }

  // 2. Pop truly empty dummy turns from the end
  while (contents.length > 0) {
    const last = contents[contents.length - 1];
    const isEmpty =
      !last?.parts ||
      !Array.isArray(last.parts) ||
      last.parts.length === 0 ||
      last.parts.every(
        (p: any) =>
          (!p?.text || !p.text.trim() || p.text === '.') &&
          !p?.functionCall &&
          !p?.functionResponse &&
          !p?.thinking
      );
    if (isEmpty) {
      contents.pop();
      modified = true;
    } else {
      break;
    }
  }

  // 3. Merge consecutive turns with the same role to ensure strict alternation (user <-> model)
  for (let i = 1; i < contents.length; i++) {
    const prev = contents[i - 1];
    const curr = contents[i];
    if (prev?.role && curr?.role && prev.role === curr.role) {
      if (Array.isArray(prev.parts) && Array.isArray(curr.parts)) {
        prev.parts.push(...curr.parts);
      }
      contents.splice(i, 1);
      i--;
      modified = true;
    }
  }

  // 4. If history still ends on a model turn, close it with a continuation user turn instead of popping,
  // preventing history erasure and infinite agent loops.
  if (contents.length > 0 && contents[contents.length - 1]?.role === 'model') {
    contents.push({ role: 'user', parts: [{ text: 'Continue.' }] });
    modified = true;
  }

  // 5. If contents is completely empty, ensure at least one user turn exists
  if (contents.length === 0) {
    contents.push({ role: 'user', parts: [{ text: 'Continue.' }] });
    modified = true;
  }

  return modified;
}

/**
 * Recursively cleans and flattens JSON schema in tool definitions so Google Cloud Code /
 * Code Assist's strict schema validator doesn't reject them with HTTP 400 Bad Request.
 * - Flattens `allOf`
 * - Simplifies `anyOf` / `oneOf`
 * - Normalizes `type: ["string", "null"]` to `type: "string"` with `(nullable)` hint
 * - Removes unsupported `nullable: true`
 * - Strips circular references
 */
export function cleanToolParametersJsonSchema(schema: any, visited = new Set<any>()): any {
  if (!schema || typeof schema !== 'object') return schema;
  if (visited.has(schema)) {
    return { type: 'object', description: 'circular reference' };
  }
  visited.add(schema);

  if (Array.isArray(schema)) {
    return schema.map((item) => cleanToolParametersJsonSchema(item, visited));
  }

  let result: Record<string, any> = { ...schema };

  // 1. Flatten allOf
  if (Array.isArray(result.allOf)) {
    const mergedProps: Record<string, any> = {};
    const mergedRequired: string[] = [];
    for (const sub of result.allOf) {
      const cleaned = cleanToolParametersJsonSchema(sub, visited);
      if (cleaned && typeof cleaned === 'object') {
        if (cleaned.properties && typeof cleaned.properties === 'object') {
          Object.assign(mergedProps, cleaned.properties);
        }
        if (Array.isArray(cleaned.required)) {
          mergedRequired.push(...cleaned.required);
        }
      }
    }
    delete result.allOf;
    if (Object.keys(mergedProps).length > 0) {
      result.properties = { ...mergedProps, ...(result.properties || {}) };
    }
    if (mergedRequired.length > 0) {
      result.required = Array.from(new Set([...mergedRequired, ...(Array.isArray(result.required) ? result.required : [])]));
    }
  }

  // 2. Simplify anyOf / oneOf
  const unionKey = Array.isArray(result.anyOf) ? 'anyOf' : Array.isArray(result.oneOf) ? 'oneOf' : null;
  if (unionKey) {
    const list: any[] = result[unionKey];
    delete result[unionKey];
    // Find first non-null variant
    const nonNull = list.find((item) => item && (item.type !== 'null' && item.type !== null));
    if (nonNull && typeof nonNull === 'object') {
      const cleanedVariant = cleanToolParametersJsonSchema(nonNull, visited);
      result = { ...cleanedVariant, ...result };
    }
    const hasNull = list.some((item) => item?.type === 'null' || item === null);
    if (hasNull && result.description) {
      result.description = `${result.description} (nullable)`;
    }
  }

  // 3. Normalize array type e.g. ["string", "null"]
  if (Array.isArray(result.type)) {
    const nonNullType = result.type.find((t: any) => typeof t === 'string' && t.toLowerCase() !== 'null') || 'string';
    const isNullable = result.type.some((t: any) => typeof t === 'string' && t.toLowerCase() === 'null');
    result.type = nonNullType;
    if (isNullable) {
      result.description = result.description ? `${result.description} (nullable)` : '(nullable)';
    }
  }

  // 4. Remove unsupported nullable: true flag (Code Assist rejects this parameter)
  if (result.nullable === true) {
    delete result.nullable;
    result.description = result.description ? `${result.description} (nullable)` : '(nullable)';
  }

  // 5. Clean nested properties
  if (result.properties && typeof result.properties === 'object') {
    const cleanedProps: Record<string, any> = {};
    for (const [k, v] of Object.entries(result.properties)) {
      cleanedProps[k] = cleanToolParametersJsonSchema(v, visited);
    }
    result.properties = cleanedProps;
  }

  // 6. Clean nested items
  if (result.items && typeof result.items === 'object') {
    result.items = cleanToolParametersJsonSchema(result.items, visited);
  }

  return result;
}

export function sanitizeCloudCodeTools(reqObj: Record<string, unknown>): void {
  if (!reqObj || typeof reqObj !== 'object') return;
  const tools = reqObj.tools;
  if (!Array.isArray(tools)) return;

  for (const tool of tools) {
    if (!tool || typeof tool !== 'object') continue;
    const decls = (tool as any).functionDeclarations;
    if (Array.isArray(decls)) {
      for (const decl of decls) {
        if (!decl || typeof decl !== 'object') continue;
        if (decl.parameters) {
          decl.parameters = cleanToolParametersJsonSchema(decl.parameters);
        }
        if (decl.parametersJsonSchema) {
          decl.parametersJsonSchema = cleanToolParametersJsonSchema(decl.parametersJsonSchema);
        }
      }
    }
  }
}

export const SYNTHETIC_TOOL_NAME = 'emit_answer';

export const SYNTHETIC_TOOL_DECLARATION = {
  name: SYNTHETIC_TOOL_NAME,
  description:
    'You MUST call this tool exactly once to output your final user-visible answer. ' +
    'Put the complete answer in the \'content\' argument. ' +
    'Do NOT output any text outside this tool call.',
  parameters: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'The complete final answer to output to the user.',
      },
    },
    required: ['content'],
  },
};

export const ANTI_TRUNCATION_INSTRUCTION =
  'Strict execution rule: You MUST call `emit_answer` to return your final answer in `content`. Do not output raw text outside this tool call.';

/**
 * Injects synthetic `emit_answer` tool and instructions into Cloud Code payload
 * to protect the output from upstream safety truncation filters.
 */
export function applyAntiTruncation(reqObj: Record<string, unknown>): boolean {
  if (!reqObj || typeof reqObj !== 'object') return false;

  // 1. Inject tool
  let tools = Array.isArray(reqObj.tools) ? (reqObj.tools as any[]) : [];
  const alreadyInjected = tools.some(
    (t) =>
      Array.isArray(t?.functionDeclarations) &&
      t.functionDeclarations.some((decl: any) => decl?.name === SYNTHETIC_TOOL_NAME),
  );
  if (!alreadyInjected) {
    tools.push({ functionDeclarations: [SYNTHETIC_TOOL_DECLARATION] });
    reqObj.tools = tools;
  }

  // 2. Ensure function calling mode is AUTO
  const toolConfig = (reqObj.toolConfig && typeof reqObj.toolConfig === 'object'
    ? reqObj.toolConfig
    : {}) as Record<string, any>;
  const funcConfig = (toolConfig.functionCallingConfig && typeof toolConfig.functionCallingConfig === 'object'
    ? toolConfig.functionCallingConfig
    : {}) as Record<string, any>;
  if (funcConfig.mode === 'NONE' || !funcConfig.mode) {
    funcConfig.mode = 'AUTO';
  }
  toolConfig.functionCallingConfig = funcConfig;
  reqObj.toolConfig = toolConfig;

  // 3. Inject system instruction
  const sysInst = (reqObj.systemInstruction && typeof reqObj.systemInstruction === 'object'
    ? reqObj.systemInstruction
    : {}) as Record<string, any>;
  const parts = Array.isArray(sysInst.parts) ? (sysInst.parts as any[]) : [];
  const hasInstruction = parts.some((p: any) => typeof p?.text === 'string' && p.text.includes(SYNTHETIC_TOOL_NAME));
  if (!hasInstruction) {
    parts.push({ text: ANTI_TRUNCATION_INSTRUCTION });
    sysInst.parts = parts;
    reqObj.systemInstruction = sysInst;
  }

  return true;
}

/**
 * Extracts synthetic tool response (`emit_answer`) back to standard text content if present.
 */
export function extractSyntheticToolContent(data: any): string | null {
  if (!data || typeof data !== 'object') return null;
  const target = data.response ? data.response : data;
  const candidates = Array.isArray(target.candidates) ? target.candidates : [];
  for (const cand of candidates) {
    const parts = Array.isArray(cand?.content?.parts) ? cand.content.parts : [];
    for (const p of parts) {
      if (p?.functionCall?.name === SYNTHETIC_TOOL_NAME) {
        const args = p.functionCall.args;
        if (args && typeof args.content === 'string') {
          return args.content;
        }
      }
    }
  }
  return null;
}


