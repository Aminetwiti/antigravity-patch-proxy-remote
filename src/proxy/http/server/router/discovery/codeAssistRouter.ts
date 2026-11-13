import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import log from 'electron-log';
import { GOOGLE_HOSTS } from '../../../../../constants';
import { resolveGoogleIp } from '../../dnsResolver';
import { safeWriteHead, safeEnd } from '../../httpUtils';
import { loadCustomModels } from '../../../../models/catalog/modelLoader';
import {
  unlockCodeAssistPayload,
  loadCachedCodeAssist,
  saveCachedCodeAssist,
} from '../../../routes/endpointHandlers';

export function buildDefaultCodeAssistFallback(): string {
  const customModels = loadCustomModels();
  const googleAccount = customModels.find((m) => (m as any).accountProject || (m as any).projectId);
  const projectId = (googleAccount as any)?.accountProject || (googleAccount as any)?.projectId || 'projects/antigravity-local';
  return JSON.stringify({
    cloudaicompanionProject: projectId,
    allowedTiers: [
      { id: 'free-tier', isDefault: false },
      { id: 'standard-tier', isDefault: false },
      { id: 'g1-pro-tier', isDefault: true },
    ],
    currentTier: { id: 'g1-pro-tier', name: 'Google AI Pro' },
    paidTier: { id: 'g1-pro-tier', name: 'Google AI Pro' },
  });
}

export async function handleCodeAssistRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  fullBody: Buffer,
): Promise<boolean> {
  if (
    req.url!.includes('/v1internal:recordCodeAssistMetrics') ||
    req.url!.includes('/v1internal:recordTrajectoryAnalytics') ||
    req.url!.includes('/v1internal:recordClientEvent') ||
    req.url!.includes('/v1internal:uploadPerformanceProfile') ||
    req.url!.includes('/v1internal:checkUrlDenylist') ||
    req.url!.includes('/v1internal:fetchFromTrawlerCache') ||
    req.url!.includes('/v1internal:batchFetchFromTrawlerCache')
  ) {
    if (safeWriteHead(res, 200, { 'Content-Type': 'application/json' })) {
      safeEnd(res, JSON.stringify({}));
    }
    return true;
  }

  if (!req.url!.includes('/v1internal:loadCodeAssist')) {
    return false;
  }
  log.debug('[Proxy] Intercepting loadCodeAssist request');

  const cached = loadCachedCodeAssist();
  if (cached) {
    log.debug('[Proxy] Serving cached loadCodeAssist response instantly (prevents LS deadline exceeded)');
    if (safeWriteHead(res, 200, { 'Content-Type': 'application/json' })) {
      safeEnd(res, cached);
    }
    return true;
  }

  const targetHost = GOOGLE_HOSTS.CLOUD_CODE;
  const targetUrl = `https://${targetHost}`;
  let parsedUrl: URL;
  try {
    const realIp = await resolveGoogleIp(targetHost);
    parsedUrl = new URL(req.url!, targetUrl);
    parsedUrl.hostname = realIp;
  } catch (e) {
    log.warn(`[Proxy] DNS resolution failed for ${targetHost} on loadCodeAssist:`, e);
    const cachedFallback = loadCachedCodeAssist() || buildDefaultCodeAssistFallback();
    if (safeWriteHead(res, 200, { 'Content-Type': 'application/json' })) {
      safeEnd(res, cachedFallback);
    }
    return true;
  }

  const fwdHeaders: Record<string, string | string[] | undefined> = {
    ...(req.headers as Record<string, string | string[] | undefined>),
  };
  fwdHeaders['host'] = targetHost;
  fwdHeaders['user-agent'] = 'antigravity';
  delete fwdHeaders['connection'];
  delete fwdHeaders['keep-alive'];
  delete fwdHeaders['accept-encoding'];

  const fwdOptions: https.RequestOptions = {
    method: req.method,
    headers: fwdHeaders as Record<string, string>,
    servername: targetHost,
  };

  const fallback = (isLocationBlocked?: boolean) => {
    if (res.headersSent || res.writableEnded) return;
    const cachedData = loadCachedCodeAssist() || buildDefaultCodeAssistFallback();
    log.warn(
      isLocationBlocked
        ? '[Proxy] Upstream loadCodeAssist blocked by LOCATION/GEO. Serving fallback (an egress VPN/proxy may be required for downstream inference).'
        : '[Proxy] Upstream loadCodeAssist failed/timed out, serving fallback response',
    );
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (isLocationBlocked) {
      headers['X-Antigravity-Location-Warning'] = 'LOCATION_BLOCKED';
    }
    if (safeWriteHead(res, 200, headers)) {
      safeEnd(res, cachedData);
    }
  };

  let completed = false;
  const googleReq = https.request(parsedUrl, fwdOptions, (googleRes) => {
    if (googleRes.statusCode === 429 || googleRes.statusCode === 503) {
      completed = true;
      fallback();
      return;
    }

    const chunks: Buffer[] = [];
    googleRes.on('data', (c) => chunks.push(c));
    googleRes.on('end', () => {
      if (completed || res.headersSent || res.writableEnded) return;
      completed = true;
      const body = Buffer.concat(chunks).toString('utf-8');
      if (googleRes.statusCode === 200 && body.startsWith('{')) {
        const unlockedBody = unlockCodeAssistPayload(body);
        saveCachedCodeAssist(unlockedBody);
        if (safeWriteHead(res, 200, { 'Content-Type': 'application/json' })) {
          safeEnd(res, unlockedBody);
        }
      } else if (
        googleRes.statusCode === 403 ||
        (googleRes.statusCode === 400 && (body.includes('LOCATION') || body.includes('1008') || body.toLowerCase().includes('location')))
      ) {
        log.warn(`[Proxy] Upstream loadCodeAssist rejected with HTTP ${googleRes.statusCode} (${body.slice(0, 150)}). Serving unlocked fallback with location warning.`);
        fallback(true);
      } else if (googleRes.statusCode && googleRes.statusCode < 500) {
        if (safeWriteHead(res, googleRes.statusCode, { 'Content-Type': 'application/json' })) {
          safeEnd(res, body);
        }
      } else {
        fallback();
      }
    });
  });

  googleReq.setTimeout(2_500, () => {
    if (!completed) {
      completed = true;
      googleReq.destroy();
      fallback();
    }
  });

  googleReq.on('error', (err) => {
    if (!completed) {
      completed = true;
      log.warn('[Proxy] Upstream loadCodeAssist network error:', err.message);
      fallback();
    }
  });

  if (fullBody && fullBody.length > 0) {
    googleReq.write(fullBody);
  }
  googleReq.end();
  return true;
}
