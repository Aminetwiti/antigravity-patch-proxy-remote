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
    while (
      reqObj.contents.length > 0 &&
      (reqObj.contents[reqObj.contents.length - 1] as { role?: string })?.role === 'model'
    ) {
      log.warn(`[Proxy] Pruned trailing model turn in Cloud Code request for ${targetModel}`);
      reqObj.contents.pop();
    }

    if (reqObj.contents.length === 0) {
      reqObj.contents.push({ role: 'user', parts: [{ text: 'Continue.' }] });
    }

    // For Claude models on Google Cloud Code / Vertex AI:
    // Anthropic validates that every thinking block's HMAC signature matches its exact thinking text.
    // When Antigravity IDE performs context summarization or account pooling, historical thinking blocks
    // have modified text or mismatched account signatures, causing HTTP 400 "Invalid signature in thinking block".
    // Stripping historical thinking blocks avoids this while allowing Claude to think on the current turn.
    const isClaude = targetModel.toLowerCase().includes('claude') ||
      reqObj.contents.some((c: any) => Array.isArray(c?.parts) && c.parts.some((p: any) => p?.type === 'thinking' || typeof p?.signature === 'string' || typeof p?.thinking === 'string'));

    if (isClaude) {
      for (const item of reqObj.contents as Array<{ role?: string; parts?: Array<Record<string, unknown>> }>) {
        if (Array.isArray(item.parts)) {
          const originalCount = item.parts.length;
          item.parts = item.parts.filter((p: any) => {
            if (!p || typeof p !== 'object') return false;
            // Function calls and responses must NEVER be filtered out
            if (p.functionCall || p.functionResponse) return true;
            // Pure thinking blocks
            if (p.type === 'thinking') return false;
            if (p.thought === true || p.thought === 'true') return false;
            if (typeof p.thinking === 'string') return false;
            // Pure signature block without text
            if ((typeof p.signature === 'string' || typeof p.thoughtSignature === 'string' || typeof p.thought_signature === 'string') && !p.text) {
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

          if (item.parts.length !== originalCount) {
            log.info(`[Proxy] Sanitized ${originalCount - item.parts.length} historical thinking block(s) for Claude request to avoid invalid signature error`);
          }
        }
      }
    }
  }
}

