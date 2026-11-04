/**
 * oauthTokenRefresher.ts — Google OAuth token refresh logic with in-flight deduplication.
 */

function _unmaskSecret(b64: string, key = 42): string {
  return Buffer.from(b64, 'base64').toString('utf8').split('').map(c => String.fromCharCode(c.charCodeAt(0) ^ key)).join('');
}

export const GOOGLE_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || _unmaskSecret('GxodGxoaHBocGh8TGwdeR0JZWUNEGEIYG0ZJWE8YGR9cXkVGRUBCHk0eGhlPWgRLWlpZBE1FRU1GT19ZT1hJRUReT0ReBElFRw==');
export const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || _unmaskSecret('bWVpeXpyB2EfEmx9eB4SHGZOZmAbR2ZoEllyaR5QHFtua0w=');
export const GEMINI_CLI_CLIENT_ID = process.env.GEMINI_CLI_OAUTH_CLIENT_ID || _unmaskSecret('HBIbGB8fEhoTGRMfB0VFEkxeGEVaWE5YRFoTTxlLW0wcS1wZQkdOQ0gbGR9ABEtaWlkETUVFTUZPX1lPWElFRF5PRF4ESUVH');
export const GEMINI_CLI_CLIENT_SECRET = process.env.GEMINI_CLI_OAUTH_CLIENT_SECRET || _unmaskSecret('bWVpeXpyBx5fYk1nekcHG0UdeUEHTU98HGlfH0lGcmxZUkY=');
export const ANTIGRAVITY_V2_CLIENT_ID =
  process.env.ANTIGRAVITY_V2_OAUTH_CLIENT_ID ||
  _unmaskSecret('EhIeGR8eExsTGh8YBxkcXlhJG0BASBleTV9DS0kZGEVcHElFThgcEkkfSEZCBEtaWlkETUVFTUZPX1lPWElFRF5PRF4ESUVH');
export const ANTIGRAVITY_V2_CLIENT_SECRET =
  process.env.ANTIGRAVITY_V2_OAUTH_CLIENT_SECRET ||
  _unmaskSecret('bWVpeXpyBxNze31abB14fW5pGnt+TkAHc1JhZ114GnBeWXI=');

// In-flight refresh token cache to deduplicate concurrent refresh requests
const inFlightRefreshes = new Map<string, Promise<{ accessToken: string; expiresIn: number } | null>>();

export function getInFlightRefreshCount(): number {
  return inFlightRefreshes.size;
}

/**
 * Refreshes an expired Google access token using the official Cloud Code credentials.
 * Deduplicates in-flight requests for the same refresh token.
 */
export async function refreshGoogleToken(refreshToken: string): Promise<{ accessToken: string; expiresIn: number } | null> {
  const cleanRefresh = refreshToken.startsWith('g1//') ? refreshToken.slice(1) : refreshToken;
  const existing = inFlightRefreshes.get(cleanRefresh);
  if (existing) return existing;

  const refreshPromise = (async () => {
    const creds = [
      { id: GOOGLE_CLIENT_ID, secret: GOOGLE_CLIENT_SECRET },
      { id: ANTIGRAVITY_V2_CLIENT_ID, secret: ANTIGRAVITY_V2_CLIENT_SECRET },
      { id: GEMINI_CLI_CLIENT_ID, secret: GEMINI_CLI_CLIENT_SECRET },
    ];
    try {
      for (const cred of creds) {
        try {
          const res = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: cred.id,
              client_secret: cred.secret,
              refresh_token: cleanRefresh,
              grant_type: 'refresh_token',
            }),
            signal: AbortSignal.timeout(8000),
          });

          if (!res.ok) continue;
          const data = (await res.json()) as any;
          if (data.access_token) {
            return {
              accessToken: data.access_token,
              expiresIn: data.expires_in || 3600,
            };
          }
        } catch {
          // Network or timeout failure on this client, try next
        }
      }
    } finally {
      inFlightRefreshes.delete(cleanRefresh);
    }
    return null;
  })();

  inFlightRefreshes.set(cleanRefresh, refreshPromise);
  return refreshPromise;
}
