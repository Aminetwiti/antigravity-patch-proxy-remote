import { isGeminiCliModel } from './modelNormalizer';

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
  _unmaskSecret('bWVpeXpyBx5fYk1nekcHG0UdeUEHTU98HGlfH0lGcmxZUkY=');
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

export const TOKEN_REVOCATION_TTL_MS = 60 * 60_000;
const revokedRefreshTokens = new Map<string, number>();

/**
 * Checks whether a refresh token has been quarantined as revoked / invalid_grant.
 */
export function isTokenRevoked(refreshToken?: string): boolean {
  const clean = (refreshToken || '').trim();
  if (!clean) return false;
  const quarantinedAt = revokedRefreshTokens.get(clean);
  if (!quarantinedAt) return false;
  if (Date.now() - quarantinedAt > TOKEN_REVOCATION_TTL_MS) {
    revokedRefreshTokens.delete(clean);
    log.info(`[GoogleAuth] Quarantine TTL elapsed for token [${clean.substring(0, 10)}...]. Restoring to candidate pool for re-probing.`);
    return false;
  }
  return true;
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
  revokedRefreshTokens.set(clean, Date.now());
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
  return Array.from(revokedRefreshTokens.keys());
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
      // Validate structured Google OAuth JSON response to avoid false revocations on HTML error pages (AUDIT-011)
      let isExplicitGoogleOAuthError = false;
      try {
        const errJson = typeof result.rawData === 'string' && result.rawData.trim().startsWith('{')
          ? JSON.parse(result.rawData)
          : null;
        if (errJson && typeof errJson === 'object') {
          const errCode = String(errJson.error || '').toLowerCase();
          const errDesc = String(errJson.error_description || '').toLowerCase();
          if (
            errCode === 'invalid_grant' ||
            errCode === 'unauthorized_client' ||
            errDesc.includes('revoked') ||
            errDesc.includes('expired')
          ) {
            isExplicitGoogleOAuthError = true;
          }
        }
      } catch {}

      if (isExplicitGoogleOAuthError) {
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

    log.warn(`[GoogleAuth] Token refresh failed for [${cleanRefresh.substring(0, 10)}...] with status ${result.statusCode}: ${result.rawData.substring(0, 150)}`);
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
    if (!token || seen.has(token) || isTokenCached(token) || isTokenRevoked(token)) continue;
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
