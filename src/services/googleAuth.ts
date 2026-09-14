import https from 'https';
import log from 'electron-log';

export const GOOGLE_CLIENT_ID = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';
export const GOOGLE_CLIENT_SECRET = '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';

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
    log.info('[GoogleAuth] Background pre-warming token before expiration');
    refreshGoogleToken(cleanRefresh).catch(() => {});
  }, delay);
  if (timer.unref) timer.unref();
  prewarmTimers.set(cleanRefresh, timer);
}

/**
 * Refreshes a Google OAuth access token using a refresh token.
 * Caches valid tokens in memory for expires_in - 5 minutes.
 */
export async function refreshGoogleToken(refreshToken: string): Promise<string | null> {
  const cleanRefresh = (refreshToken || '').trim();
  if (!cleanRefresh) return null;

  const cached = tokenCache.get(cleanRefresh);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.accessToken;
  }

  const existing = inFlightRefreshes.get(cleanRefresh);
  if (existing) return existing;

  const refreshPromise = new Promise<string | null>((resolve) => {
    const postData = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
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
              const expiresIn = parsed.expires_in || 3600;
              // Expire 5 minutes early to prevent using borderline-expired tokens
              const safeExpiry = Date.now() + Math.max(expiresIn - 300, 60) * 1000;
              tokenCache.set(cleanRefresh, {
                accessToken: parsed.access_token,
                expiresAt: safeExpiry,
              });
              schedulePrewarm(cleanRefresh, safeExpiry);
              log.info(`[GoogleAuth] Successfully refreshed access token (expires in ${expiresIn}s)`);
              resolve(parsed.access_token);
              return;
            }
          }
          log.warn(`[GoogleAuth] Token refresh failed with status ${res.statusCode}: ${rawData.substring(0, 150)}`);
          resolve(null);
        } catch (e) {
          log.warn('[GoogleAuth] Failed to parse token refresh response:', e);
          resolve(null);
        }
      });
    });

    req.on('error', (err) => {
      log.warn('[GoogleAuth] Token refresh network error:', err.message);
      resolve(null);
    });

    req.on('timeout', () => {
      req.destroy();
      log.warn('[GoogleAuth] Token refresh request timed out');
      resolve(null);
    });

    req.write(postData);
    req.end();
  }).finally(() => {
    inFlightRefreshes.delete(cleanRefresh);
  });

  inFlightRefreshes.set(cleanRefresh, refreshPromise);
  return refreshPromise;
}

/**
 * Resolves a valid access token for a Google account candidate.
 * Prefers refreshing the refresh token; falls back to raw apiKey if it starts with ya29.
 */
export async function getValidGoogleAccessToken(account: {
  apiKey?: string;
  refreshToken?: string;
}): Promise<string | null> {
  if (account.refreshToken) {
    const refreshed = await refreshGoogleToken(account.refreshToken);
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
  if (!modelId) return 'gemini-2.5-flash';
  const clean = modelId.replace(/^models\//, '').trim();
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
    'gemini-3.1-pro-low': 'gemini-3.1-pro-high',
    'gemini-3.1-pro': 'gemini-3.1-pro-high',
  };
  return map[clean] || clean;
}

/**
 * Checks whether a given model candidate represents a Google Cloud Code account
 * (using OAuth ya29 access token or 1// refresh token, or Cloud Code endpoint)
 * rather than an external Google AI Studio key (AIzaSy...).
 */
export function isGoogleCloudCodeModel(m: {
  provider?: string;
  apiKey?: string;
  refreshToken?: string;
  apiUrl?: string;
}): boolean {
  if (m.provider !== 'google') return false;
  // If explicitly using an AI Studio Developer API key (AIzaSy...), treat as AI Studio
  if (m.apiKey && m.apiKey.startsWith('AIzaSy')) return false;

  return Boolean(
    m.refreshToken ||
    (m.apiKey && m.apiKey.startsWith('ya29.')) ||
    m.apiUrl?.includes('cloudcode')
  );
}
