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

const revokedRefreshTokens = new Set<string>();

/**
 * Checks whether a refresh token has been quarantined as revoked / invalid_grant.
 */
export function isTokenRevoked(refreshToken?: string): boolean {
  const clean = (refreshToken || '').trim();
  if (!clean) return false;
  return revokedRefreshTokens.has(clean);
}

/**
 * Marks a refresh token as revoked / requiring re-authentication.
 */
export function markTokenRevoked(refreshToken?: string): void {
  const clean = (refreshToken || '').trim();
  if (!clean) return;
  revokedRefreshTokens.add(clean);
  tokenCache.delete(clean);
  inFlightRefreshes.delete(clean);
  log.warn(`[GoogleAuth] Refresh token quarantined as REVOKED / REAUTH_REQUIRED: ${clean.substring(0, 10)}...`);
}

/**
 * Clears revoked tokens set (used on config reload or in tests).
 */
export function clearRevokedTokens(): void {
  revokedRefreshTokens.clear();
}

/**
 * Refreshes a Google OAuth access token using a refresh token.
 * Caches valid tokens in memory for expires_in - 5 minutes.
 * When force is true, ignores cache and requests a fresh token from Google.
 */
export async function refreshGoogleToken(refreshToken: string, force = false): Promise<string | null> {
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
          if (res.statusCode === 400 && (rawData.includes('invalid_grant') || rawData.includes('revoked'))) {
            markTokenRevoked(cleanRefresh);
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
  claudeResetTime?: string;
}

const accountLiveQuotas = new Map<string, AccountLiveQuota>();

export function getLiveAccountQuota(accountKey: string): AccountLiveQuota | undefined {
  return accountLiveQuotas.get(accountKey);
}

export function updateLiveAccountQuota(accountKey: string, quota: AccountLiveQuota): void {
  accountLiveQuotas.set(accountKey, quota);
}

export function _clearLiveQuotasForTests(): void {
  accountLiveQuotas.clear();
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
                  let geminiResetTime: string | undefined;
                  let claudeFiveHourPct: number | undefined;
                  let claudeWeeklyPct: number | undefined;
                  let claudeResetTime: string | undefined;

                  for (const g of rawGroups) {
                    const groupName = (g.displayName || '').toLowerCase();
                    const isGemini = groupName.includes('gemini');
                    const isClaude =
                      groupName.includes('claude') ||
                      groupName.includes('3p') ||
                      groupName.includes('other') ||
                      groupName.includes('gpt');

                    for (const b of Array.isArray(g.buckets) ? g.buckets : []) {
                      const frac = typeof b.remainingFraction === 'number' ? b.remainingFraction : 1.0;
                      const pct = Math.round(frac * 100);
                      const bId = (b.bucketId || '').toLowerCase();
                      const wStr = (b.window || '').toLowerCase();
                      const is5h = bId.includes('5h') || wStr.includes('5h') || wStr.includes('hour');
                      const isWeekly = bId.includes('weekly') || wStr.includes('weekly');

                      if (isGemini) {
                        if (is5h) {
                          geminiFiveHourPct = pct;
                          geminiResetTime = b.resetTime;
                        } else if (isWeekly) {
                          geminiWeeklyPct = pct;
                        }
                      } else if (isClaude) {
                        if (is5h) {
                          claudeFiveHourPct = pct;
                          claudeResetTime = b.resetTime;
                        } else if (isWeekly) {
                          claudeWeeklyPct = pct;
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

                  const result: AccountLiveQuota = {
                    fiveHourPercentage,
                    weeklyPercentage,
                    geminiFiveHourPct: geminiFiveHourPct ?? fiveHourPercentage,
                    geminiWeeklyPct: geminiWeeklyPct ?? weeklyPercentage,
                    claudeFiveHourPct: claudeFiveHourPct ?? 100,
                    claudeWeeklyPct: claudeWeeklyPct ?? 100,
                    updatedAt: Date.now(),
                    geminiResetTime,
                    claudeResetTime,
                  };
                  resolve(result);
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
  accounts: Array<{ refreshToken?: string; apiKey?: string; accountEmail?: string; email?: string }>,
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

    const email = (acc.accountEmail || acc.email || '').trim().toLowerCase();
    const accountKey = email ? `google:${email}` : (acc.apiKey || tokenKey);

    try {
      // If refresh token is nearing expiration, force proactive renewal
      if (refreshToken && shouldRenewToken(refreshToken, 300_000)) {
        log.info(`[GoogleAuth] Proactively renewing access token for ${email || 'account'} during quota poll`);
        await refreshGoogleToken(refreshToken, true);
      }

      const accessToken = await getValidGoogleAccessToken(acc);
      if (!accessToken) continue;
      const quota = await fetchLiveUserQuota(accessToken);
      if (quota) {
        accountLiveQuotas.set(accountKey, quota);
        if (onQuotaSync) {
          try {
            onQuotaSync(accountKey, quota);
          } catch (_) {}
        }
        log.info(
          `[GoogleAuth] Live quota synced for ${email || 'account'}: Gemini 5h=${quota.geminiFiveHourPct}%, Claude 5h=${quota.claudeFiveHourPct}%`
        );
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
}): Promise<string | null> {
  if (account.refreshToken) {
    const clean = account.refreshToken.trim();
    const remainingLifetime = getTokenRemainingLifetime(clean);
    if (remainingLifetime > 0 && remainingLifetime < 300_000) {
      refreshGoogleToken(clean, true).catch(() => {});
    }
    const refreshed = await refreshGoogleToken(clean);
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
    'gemini-3.1-pro-high',
    'claude-sonnet-4-6',
    'claude-opus-4-6-thinking',
    'gpt-oss-120b-medium',
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
    'gemini-3.1-pro-low': 'gemini-3.1-pro-high',
    'gemini-3.1-pro': 'gemini-3.1-pro-high',
    'gemini-flash': 'gemini-3.8-flash-tiered',
    'gemini-pro': 'gemini-3.1-pro-high',
    'claude-sonnet': 'claude-sonnet-4-6',
    'claude-opus': 'claude-opus-4-6-thinking',
  };

  if (map[clean]) return map[clean];

  if (clean.includes('opus')) return 'claude-opus-4-6-thinking';
  if (clean.includes('claude') || clean.includes('sonnet')) return 'claude-sonnet-4-6';
  if (clean.includes('pro')) return 'gemini-3.1-pro-high';
  if (clean.includes('flash')) return 'gemini-3.8-flash-tiered';
  if (clean.includes('gpt-oss')) return 'gpt-oss-120b-medium';

  return 'gemini-3.8-flash-tiered';
}

/**
 * Normalizes Google AI Studio / Gemini model identifiers, mapping unknown, legacy, or alias
 * model names to canonical Google Cloud Code models (e.g. gemini-3.8-flash-tiered, gemini-3.1-pro-high, claude-sonnet-4-6) without throwing 404.
 */
export function normalizeGoogleModelId(modelName: string): string {
  if (!modelName) return 'gemini-3.8-flash-tiered';
  let clean = modelName.replace(/^(?:models\/|[^/]+\/)/, '').trim().toLowerCase();

  const validModels = new Set([
    'gemini-3.8-flash-tiered',
    'gemini-3.7-flash-tiered',
    'gemini-3.1-pro-high',
    'claude-sonnet-4-6',
  ]);

  if (validModels.has(clean)) {
    return clean;
  }

  const aliasMap: Record<string, string> = {
    'gemini-3.8-flash': 'gemini-3.8-flash-tiered',
    'gemini-3.7-flash': 'gemini-3.7-flash-tiered',
    'gemini-flash': 'gemini-3.8-flash-tiered',
    'gemini-3.1-pro': 'gemini-3.1-pro-high',
    'gemini-3.0-pro': 'gemini-3.1-pro-high',
    'gemini-pro': 'gemini-3.1-pro-high',
    'claude-sonnet': 'claude-sonnet-4-6',
  };

  if (aliasMap[clean]) {
    return aliasMap[clean];
  }

  if (clean.includes('claude') || clean.includes('sonnet')) {
    return 'claude-sonnet-4-6';
  }

  if (clean.includes('pro') || clean.includes('opus')) {
    return 'gemini-3.1-pro-high';
  }

  return 'gemini-3.8-flash-tiered';
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
  const genCfg = reqObj.generationConfig as Record<string, any> | undefined;
  if (genCfg && typeof genCfg === 'object') {
    const tc = genCfg.thinkingConfig;
    if (tc && typeof tc === 'object') {
      const budget = typeof tc.thinkingBudget === 'number' ? tc.thinkingBudget : parseInt(tc.thinkingBudget, 10);
      if (isNaN(budget) || budget <= 0) {
        delete genCfg.thinkingConfig;
      } else if (targetModel.includes('claude')) {
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
            log.info(`[Proxy] Sanitized ${removedThinkingBlocks} historical thinking block(s) for Claude request to avoid invalid signature error`);
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

