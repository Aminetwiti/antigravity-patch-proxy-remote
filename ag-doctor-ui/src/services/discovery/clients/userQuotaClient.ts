/**
 * userQuotaClient.ts — Client for retrieving live user quota summaries and warmup pings.
 */

import { AccountQuotaSummary, QuotaBucket, QuotaGroup } from '../discoveryTypes';
import { fetchRealGoogleModelQuotas } from './cloudCodeQuotaClient';
import { ensureCloudCodeProject } from './cloudCodeProjectClient';

/**
 * Queries Google Cloud Code for live user quota summary (5h and weekly buckets).
 */
export async function fetchGoogleAccountQuotas(accessToken: string): Promise<AccountQuotaSummary | null> {
  const preferredHost = process.env.AG_GOOGLE_CLOUDCODE_HOST || 'cloudcode-pa.googleapis.com';
  const hosts = [
    `https://${preferredHost}`,
    preferredHost === 'cloudcode-pa.googleapis.com'
      ? 'https://daily-cloudcode-pa.googleapis.com'
      : 'https://cloudcode-pa.googleapis.com',
  ];
  let nonTos403Error: any = null;
  for (const host of hosts) {
    try {
      const res = await fetch(`${host}/v1internal:retrieveUserQuotaSummary`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'User-Agent': 'antigravity',
        },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(7000),
      });

      if (!res.ok) {
        if (res.status === 401) {
          return null;
        }
        if (res.status === 403) {
          let errJson: any = null;
          try {
            errJson = await res.json();
          } catch (e) {
            // Response is not JSON
          }
          const details = Array.isArray(errJson?.error?.details) ? errJson.error.details : [];
          let appealUrl = 'https://forms.gle/hGzM9MEUv2azZsrb9';
          let validationUrl: string | undefined;
          for (const d of details) {
            if (d?.metadata?.appeal_url) appealUrl = d.metadata.appeal_url;
            if (d?.metadata?.validation_url) validationUrl = d.metadata.validation_url;
            if (d?.metadata?.challenge_url) validationUrl = d.metadata.challenge_url;
          }
          const errDetail = details[0];
          const reason = errDetail?.reason || (errJson?.error?.message?.includes('Terms of Service') ? 'TOS_VIOLATION' : 'PERMISSION_DENIED');
          const message = errJson?.error?.message || 'This service has been disabled in this account for violation of Terms of Service. Please submit an appeal to continue using this product.';

          if (validationUrl || reason === 'VALIDATION_REQUIRED' || message.toLowerCase().includes('validation_required') || message.toLowerCase().includes('challenge')) {
            const valUrl = validationUrl || 'https://accounts.google.com';
            return {
              fiveHourPercentage: 0,
              weeklyPercentage: 0,
              geminiFiveHourPct: 0,
              geminiWeeklyPct: 0,
              claudeFiveHourPct: 0,
              claudeWeeklyPct: 0,
              isUnlicensed: false,
              isValidationRequired: true,
              errorDetails: {
                code: 403,
                status: 'VALIDATION_REQUIRED',
                reason: 'VALIDATION_REQUIRED',
                message: message || 'Une vérification interactive est requise pour ce compte Google (Captcha ou validation de sécurité).',
                validationUrl: valUrl,
                appealUrl,
                detectionTime: new Date().toISOString(),
                raw: errJson || { error: { code: 403, status: 'VALIDATION_REQUIRED', message, details: [{ reason: 'VALIDATION_REQUIRED', metadata: { validation_url: valUrl } }] } }
              },
              groups: [
                {
                  displayName: 'Vérification Requise (HTTP 403)',
                  buckets: [
                    { bucketId: 'validation_required', window: 'none', percentage: 0 }
                  ]
                }
              ]
            };
          }

          if (reason === 'TOS_VIOLATION' || errJson?.error?.message?.includes('Terms of Service')) {
            return {
              fiveHourPercentage: 0,
              weeklyPercentage: 0,
              geminiFiveHourPct: 0,
              geminiWeeklyPct: 0,
              claudeFiveHourPct: 0,
              claudeWeeklyPct: 0,
              isUnlicensed: true,
              errorDetails: {
                code: 403,
                status: errJson?.error?.status || 'PERMISSION_DENIED',
                reason: 'TOS_VIOLATION',
                message,
                appealUrl,
                detectionTime: new Date().toISOString(),
                raw: errJson || { error: { code: 403, status: 'PERMISSION_DENIED', message, details: [{ reason: 'TOS_VIOLATION', metadata: { appeal_url: appealUrl } }] } }
              },
              groups: [
                {
                  displayName: 'Violation TOS (HTTP 403)',
                  buckets: [
                    { bucketId: 'unlicensed', window: 'none', percentage: 0 }
                  ]
                }
              ]
            };
          }

          nonTos403Error = {
            code: 403,
            status: errJson?.error?.status || 'PERMISSION_DENIED',
            reason,
            message,
            appealUrl,
            detectionTime: new Date().toISOString(),
            raw: errJson || { error: { code: 403, status: 'PERMISSION_DENIED', message, details: [{ reason, metadata: { appeal_url: appealUrl } }] } }
          };
          continue;
        }
        continue;
      }
      const data = (await res.json()) as any;
      const rawGroups = data.groups || [];

      const groups: QuotaGroup[] = [];
      let geminiFiveHourPct: number | undefined;
      let geminiFiveHourReset: string | undefined;
      let geminiWeeklyPct: number | undefined;
      let geminiWeeklyReset: string | undefined;

      let claudeFiveHourPct: number | undefined;
      let claudeFiveHourReset: string | undefined;
      let claudeWeeklyPct: number | undefined;
      let claudeWeeklyReset: string | undefined;

      let argonFiveHourPct: number | undefined;
      let argonFiveHourReset: string | undefined;
      let argonWeeklyPct: number | undefined;
      let argonWeeklyReset: string | undefined;

      for (const g of rawGroups) {
        const groupName = g.displayName || 'Quota Group';
        const isArgonGroup = groupName.toLowerCase().includes('argon');
        const isClaudeGroup = groupName.toLowerCase().includes('claude') || groupName.toLowerCase().includes('other') || groupName.toLowerCase().includes('3p') || groupName.toLowerCase().includes('gpt');
        const isGeminiGroup = !isArgonGroup && groupName.toLowerCase().includes('gemini');
        const buckets: QuotaBucket[] = [];

        for (const b of g.buckets || []) {
          const isDisabled = Boolean(b.disabled);
          const remainingFrac = isDisabled ? 0 : (typeof b.remainingFraction === 'number' ? b.remainingFraction : 1.0);
          const pct = Math.round(remainingFrac * 100);
          const bucketId = b.bucketId || '';
          const windowStr = b.window || '';

          buckets.push({
            bucketId,
            window: windowStr,
            percentage: pct,
            resetTime: b.resetTime,
          });

          const is5h = bucketId.includes('5h') || windowStr.includes('5h') || windowStr.includes('hour');
          const isWeekly = bucketId.includes('weekly') || windowStr.includes('weekly');

          const isArgonBucket = bucketId.includes('argon') || (isArgonGroup && !bucketId.includes('3p') && !bucketId.includes('claude'));
          const isGeminiBucket = !isArgonBucket && (bucketId.includes('gemini') || (isGeminiGroup && !bucketId.includes('3p') && !bucketId.includes('claude')));
          const isClaudeBucket = bucketId.includes('3p') || bucketId.includes('claude') || (isClaudeGroup && !bucketId.includes('gemini') && !isArgonGroup);

          if (isArgonBucket) {
            if (is5h) {
              argonFiveHourPct = pct;
              argonFiveHourReset = b.resetTime;
            }
            if (isWeekly) {
              argonWeeklyPct = pct;
              argonWeeklyReset = b.resetTime;
            }
          } else if (isGeminiBucket) {
            if (is5h) {
              geminiFiveHourPct = pct;
              geminiFiveHourReset = b.resetTime;
            }
            if (isWeekly) {
              geminiWeeklyPct = pct;
              geminiWeeklyReset = b.resetTime;
            }
          } else if (isClaudeBucket) {
            if (is5h) {
              claudeFiveHourPct = pct;
              claudeFiveHourReset = b.resetTime;
            }
            if (isWeekly) {
              claudeWeeklyPct = pct;
              claudeWeeklyReset = b.resetTime;
            }
          }
        }

        groups.push({ displayName: groupName, buckets });
      }

      if (geminiFiveHourPct === undefined && geminiWeeklyPct === undefined && hosts.indexOf(host) + 1 < hosts.length) {
        continue;
      }

      if (geminiFiveHourPct === undefined) {
        try {
          const realModelQuotas = await fetchRealGoogleModelQuotas(accessToken);
          if (realModelQuotas) {
            if (typeof realModelQuotas.geminiFiveHourPct === 'number') {
              geminiFiveHourPct = realModelQuotas.geminiFiveHourPct;
              geminiFiveHourReset = realModelQuotas.geminiFiveHourReset;
            }
            if (typeof realModelQuotas.geminiWeeklyPct === 'number' && realModelQuotas.geminiWeeklyPct < 100) {
              geminiWeeklyPct = realModelQuotas.geminiWeeklyPct;
              geminiWeeklyReset = realModelQuotas.geminiWeeklyReset;
            }
            if (typeof realModelQuotas.argonFiveHourPct === 'number' && argonFiveHourPct === undefined) {
              argonFiveHourPct = realModelQuotas.argonFiveHourPct;
              argonFiveHourReset = realModelQuotas.argonFiveHourReset;
            }
            if (Array.isArray(realModelQuotas.groups)) {
              for (const mg of realModelQuotas.groups) {
                if (!groups.some((g) => g.displayName?.toLowerCase().includes('gemini'))) {
                  groups.unshift(mg);
                }
              }
            }
          }
        } catch (enrichErr) {
          console.debug?.('[UserQuotaClient] Secondary quota enrichment failed:', enrichErr);
        }
      }

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

      return {
        fiveHourPercentage: effGemini5h,
        fiveHourResetTime: geminiFiveHourReset,
        weeklyPercentage: effGeminiWk,
        weeklyResetTime: effGeminiWkReset,
        geminiFiveHourPct: effGemini5h,
        geminiFiveHourReset,
        geminiWeeklyPct: effGeminiWk,
        geminiWeeklyReset: effGeminiWkReset,
        claudeFiveHourPct: claudeFiveHourPct ?? 100,
        claudeFiveHourReset,
        claudeWeeklyPct: claudeWeeklyPct ?? 100,
        claudeWeeklyReset,
        argonFiveHourPct,
        argonFiveHourReset,
        argonWeeklyPct,
        argonWeeklyReset,
        groups,
      };
    } catch (hostErr) {
      console.debug?.('[UserQuotaClient] Host request failed (' + host + '):', hostErr);
    }
  }

  try {
    const realModelQuotas = await fetchRealGoogleModelQuotas(accessToken);
    if (realModelQuotas) {
      return realModelQuotas;
    }
  } catch (modelQuotasErr) {
    console.debug?.('[UserQuotaClient] Fallback real model quotas failed:', modelQuotasErr);
  }

  try {
    const proj = await ensureCloudCodeProject(accessToken);
    if (proj) {
      const isPro = proj.tierId?.toLowerCase().includes('pro');
      return {
        fiveHourPercentage: 100,
        weeklyPercentage: 100,
        geminiFiveHourPct: 100,
        geminiWeeklyPct: 100,
        claudeFiveHourPct: 100,
        claudeWeeklyPct: 100,
        groups: [
          {
            displayName: isPro ? 'Gemini CLI (Pro Tier)' : 'Gemini CLI (Free Tier)',
            buckets: [
              {
                bucketId: 'gemini-cli-rpd',
                window: 'daily',
                percentage: 100,
              },
            ],
          },
        ],
      };
    }
  } catch (cloudCodeProjErr) {
    console.debug?.('[UserQuotaClient] Cloud Code project fallback failed:', cloudCodeProjErr);
  }

  if (nonTos403Error) {
    return {
      fiveHourPercentage: 0,
      weeklyPercentage: 0,
      geminiFiveHourPct: 0,
      geminiWeeklyPct: 0,
      claudeFiveHourPct: 0,
      claudeWeeklyPct: 0,
      isUnlicensed: true,
      errorDetails: nonTos403Error,
      groups: [
        {
          displayName: 'Licence requise (HTTP 403)',
          buckets: [
            { bucketId: 'unlicensed', window: 'none', percentage: 0 }
          ]
        }
      ]
    };
  }

  return null;
}

/**
 * Triggers a minimal quota warmup ping to Google Cloud Code.
 */
export async function warmupGoogleAccount(accessToken: string): Promise<boolean> {
  const hosts = ['https://daily-cloudcode-pa.googleapis.com', 'https://cloudcode-pa.googleapis.com'];
  for (const host of hosts) {
    try {
      const res = await fetch(`${host}/v1internal:retrieveUserQuotaSummary`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'User-Agent': 'antigravity',
        },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(7000),
      });
      if (res.ok) return true;
    } catch (warmupErr) {
      console.debug?.('[UserQuotaClient] Warmup ping failed on ' + host + ':', warmupErr);
    }
  }
  return false;
}
