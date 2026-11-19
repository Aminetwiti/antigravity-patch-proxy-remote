/**
 * cloudCodeQuotaClient.ts — Fetches available models, real quotas, and Google user profile.
 */

import { AccountQuotaSummary, QuotaBucket } from '../discoveryTypes';

/**
 * Queries Google Cloud Code v1internal:fetchAvailableModels to discover real model quotas and reset times.
 */
export async function fetchRealGoogleModelQuotas(accessToken: string): Promise<AccountQuotaSummary | null> {
  const preferredHost = process.env.AG_GOOGLE_CLOUDCODE_HOST || 'daily-cloudcode-pa.googleapis.com';
  const hosts = [
    `https://${preferredHost}`,
    preferredHost === 'daily-cloudcode-pa.googleapis.com'
      ? 'https://cloudcode-pa.googleapis.com'
      : 'https://daily-cloudcode-pa.googleapis.com',
  ];
  for (const host of hosts) {
    try {
      const res = await fetch(`${host}/v1internal:fetchAvailableModels`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'User-Agent': 'antigravity',
        },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(7000),
      });

      if (!res.ok) continue;

      const data = (await res.json()) as any;
      const models = data?.models;
      if (!models || typeof models !== 'object') continue;

      const buckets: QuotaBucket[] = [];
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

        buckets.push({
          bucketId: modelId,
          window: modelData.displayName || modelId,
          percentage: pct,
          resetTime,
        });

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

      if (buckets.length > 0) {
        const effGem5h = geminiFiveHourPct ?? Math.round(minRemainingFrac * 100);
        const effGemReset = geminiFiveHourReset ?? earliestReset;
        const effClaude5h = claudeFiveHourPct ?? 100;
        const effClaudeReset = claudeFiveHourReset;

        return {
          fiveHourPercentage: Math.round(minRemainingFrac * 100),
          fiveHourResetTime: earliestReset,
          weeklyPercentage: 100,
          geminiFiveHourPct: effGem5h,
          geminiFiveHourReset: effGemReset,
          geminiWeeklyPct: 100,
          geminiWeeklyReset: undefined,
          claudeFiveHourPct: effClaude5h,
          claudeFiveHourReset: effClaudeReset,
          claudeWeeklyPct: 100,
          argonFiveHourPct,
          argonFiveHourReset,
          argonWeeklyPct: 100,
          groups: [
            {
              displayName: 'Gemini Models',
              buckets: [
                {
                  bucketId: 'gemini-5h',
                  window: '5h',
                  percentage: effGem5h,
                  resetTime: effGemReset,
                },
                {
                  bucketId: 'gemini-weekly',
                  window: 'weekly',
                  percentage: 100,
                  resetTime: undefined,
                },
              ],
            },
            {
              displayName: 'Claude and GPT models',
              buckets: [
                {
                  bucketId: '3p-5h',
                  window: '5h',
                  percentage: effClaude5h,
                  resetTime: effClaudeReset,
                },
                {
                  bucketId: '3p-weekly',
                  window: 'weekly',
                  percentage: 100,
                  resetTime: effClaudeReset,
                },
              ],
            },
          ],
        };
      }
    } catch {
      // try next host
    }
  }
  return null;
}

/**
 * Fetches Google UserInfo (email, full name, avatar) for a valid access token.
 */
export async function fetchGoogleUserInfo(accessToken: string): Promise<{ email: string; name?: string; picture?: string } | null> {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(6000),
    });

    if (res.ok) {
      const data = (await res.json()) as any;
      if (data.email) {
        return {
          email: data.email,
          name: data.name || data.given_name,
          picture: data.picture,
        };
      }
    }
  } catch {
    // Ignore fetch error
  }
  return null;
}
