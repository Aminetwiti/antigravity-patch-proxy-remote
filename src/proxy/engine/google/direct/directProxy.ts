import type http from 'http';
import https from 'https';
import * as zlib from 'zlib';
import log from 'electron-log';
import { startTimer as metricTimer, inc as metricInc, observe as metricObserve } from '../../../../metrics';
import { GOOGLE_HOSTS, GOOGLE_PROXY_TIMEOUT_MS } from '../../../../constants';
import { extractAndCacheThoughtSignatures } from '../../../core/shared';
import { extractModelNameFromPayload } from '../../../models/modelUtils';
import { resolveGoogleIp } from '../../../http/dnsResolver';
import { safeWriteHead, safeEnd, proxyLog, newTraceId } from '../../../http/httpUtils';
import { unlockCodeAssistPayload, saveCachedCodeAssist } from '../../../http/endpointHandlers';
import { sanitizeCandidatesInResponse, transformGoogleStreamForRemote } from '../../streamPipeline';
import { logTokenUsageEvent } from '../../../state/remoteState';
import {
  recordNativeSessionError,
  recordLatestNativeError,
  updateLatestNativeErrorBody,
} from '../../../resilience/sessionAffinities';
import { getHttpsAgent } from '../../../resilience/agentPool';

export async function proxyToGoogle(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  reqBody: Buffer,
  isRemoteSession = false,
  customAuthHeader?: string,
  convId = '',
  hostOverride?: string,
  sessId = '',
  originalModel = '',
): Promise<void> {
  const traceId = newTraceId();
  const isCloudCodeUrl = req.url!.includes('v1internal') || req.url!.includes('daily-cloudcode') || req.url!.includes('cloudcode');
  const targetHost = hostOverride || (isCloudCodeUrl ? GOOGLE_HOSTS.CLOUD_CODE : GOOGLE_HOSTS.GENERATIVE_LANGUAGE);
  const targetUrl = `https://${targetHost}`;
  const parsedUrl = new URL(req.url!, targetUrl);
  const endTimer = metricTimer('proxy_request_ms', { upstream: targetHost });
  log.debug('[Proxy] req', traceId, req.method, req.url, '→', targetHost);

  try {
    const realIp = await resolveGoogleIp(targetHost);
    parsedUrl.hostname = realIp;
  } catch (e) {
    metricInc('proxy_errors_total', { upstream: targetHost, stage: 'dns', trace_id: traceId });
    const ms = endTimer();
    proxyLog.error('DNS resolution failed for', targetHost, 'traceId=', traceId, '(in', ms, 'ms)');
    log.error(`[Proxy] Could not resolve upstream IP for ${targetHost}:`, e);
    if (safeWriteHead(res, 500, { 'Content-Type': 'application/json' })) {
      safeEnd(res, JSON.stringify({ error: { message: 'DNS resolution failed for ' + targetHost, traceId } }));
    }
    return;
  }

  const headers: Record<string, string | string[] | undefined> = {
    ...(req.headers as Record<string, string | string[] | undefined>),
  };
  headers['host'] = targetHost;
  headers['content-length'] = String(reqBody.length);
  delete headers['connection'];
  delete headers['keep-alive'];
  if (customAuthHeader) {
    headers['authorization'] = customAuthHeader;
    headers['Authorization'] = customAuthHeader;
  }
  if (isCloudCodeUrl) {
    headers['user-agent'] = 'antigravity';
    headers['User-Agent'] = 'antigravity';
  }

  const isGeneration = req.url!.includes('generateContent') || req.url!.includes('streamGenerateContent');
  const shouldBufferAndModify = isCloudCodeUrl && !isGeneration;

  if (shouldBufferAndModify || isGeneration) {
    delete headers['accept-encoding'];
    delete headers['Accept-Encoding'];
  }

  const options: https.RequestOptions = {
    method: req.method,
    headers: headers as Record<string, string>,
    servername: targetHost,
    agent: getHttpsAgent({ host: targetHost }),
  };

  const safeHead = (status: number, hdrs?: Record<string, string>): boolean => safeWriteHead(res, status, hdrs);

  const proxyReq = https.request(parsedUrl, options, (proxyRes) => {
    proxyReq.setTimeout(0);
    if (!hostOverride && isCloudCodeUrl && !isGeneration && (proxyRes.statusCode === 503 || proxyRes.statusCode === 502)) {
      log.warn(`[Proxy] Google Cloud Code returned ${proxyRes.statusCode} on ${targetHost}. Trying production endpoint...`);
      proxyToGoogle(req, res, reqBody, isRemoteSession, customAuthHeader, convId, GOOGLE_HOSTS.CLOUD_CODE_PROD);
      return;
    }

    if (shouldBufferAndModify) {
      const responseChunks: Buffer[] = [];
      proxyRes.on('data', (chunk) => responseChunks.push(chunk));
      proxyRes.on('end', () => {
        if (res.headersSent || res.writableEnded) return;
        const fullResBody = Buffer.concat(responseChunks);
        let text: string;
        const encoding = proxyRes.headers['content-encoding'];
        if (encoding === 'gzip') {
          try {
            text = zlib.gunzipSync(fullResBody).toString('utf-8');
          } catch (e) {
            log.error('[Proxy] gunzipSync failed:', e);
            if (safeHead(502, { 'Content-Type': 'application/json' })) {
              safeEnd(res, JSON.stringify({ error: { message: `Failed to decompress upstream response: ${(e as Error).message}` } }));
            }
            return;
          }
        } else {
          text = fullResBody.toString('utf-8');
        }

        const proxyHost = req.headers.host || 'localhost';
        const proxyProto = proxyHost.endsWith('.googleapis.com') ? 'https:' : 'http:';
        text = text.replace(/https:(\/\/)daily-cloudcode-pa\.googleapis\.com/g, `${proxyProto}$1${proxyHost}`);
        text = text.replace(/https:(\/\/)cloudcode-pa\.googleapis\.com/g, `${proxyProto}$1${proxyHost}`);
        text = text.replace(/https:(\/\/)generativelanguage\.googleapis\.com/g, `${proxyProto}$1${proxyHost}`);

        const modifiedHeaders: Record<string, string | string[] | undefined> = { ...proxyRes.headers };
        delete modifiedHeaders['content-encoding'];
        delete modifiedHeaders['transfer-encoding'];

        const modifiedBuffer = Buffer.from(text, 'utf-8');
        modifiedHeaders['content-length'] = String(modifiedBuffer.length);

        if (req.url!.includes('loadCodeAssist') && proxyRes.statusCode === 200 && text.startsWith('{')) {
          text = unlockCodeAssistPayload(text);
          saveCachedCodeAssist(text);
        }

        if (safeWriteHead(res, proxyRes.statusCode || 200, modifiedHeaders as Record<string, string>)) {
          safeEnd(res, modifiedBuffer);
        }
      });
    } else if (isGeneration) {
      const reqModelName = extractModelNameFromPayload(reqBody);
      const effectiveModel = reqModelName || originalModel || '';
      const reqStart = Date.now();
      const isStream = req.url!.includes('streamGenerateContent') || req.url!.includes('alt=sse');
      if (proxyRes.statusCode && proxyRes.statusCode >= 400) {
        log.warn(`[Proxy] Google returned error status ${proxyRes.statusCode} for [${effectiveModel || 'unknown'}]`);
        let isAuxiliaryReq = false;
        try {
          const parsed = typeof reqBody === 'string' ? JSON.parse(reqBody) : JSON.parse(reqBody.toString('utf-8'));
          const rType = String(parsed?.requestType || parsed?.request?.requestType || '').toUpperCase();
          isAuxiliaryReq = rType === 'CONVERSATION_TITLE' || rType === 'TITLE' || rType === 'SUMMARY' || rType === 'CONVERSATION_SUMMARY';
        } catch {}

        if (!isAuxiliaryReq) {
          if (convId) recordNativeSessionError(convId, proxyRes.statusCode!, proxyRes.headers as Record<string, string>, Buffer.alloc(0), effectiveModel);
          if (sessId && sessId !== convId) recordNativeSessionError(sessId, proxyRes.statusCode!, proxyRes.headers as Record<string, string>, Buffer.alloc(0), effectiveModel);
          if (!convId && !sessId) recordLatestNativeError(proxyRes.statusCode!, proxyRes.headers as Record<string, string>, Buffer.alloc(0), effectiveModel);
        }

        const errChunks: Buffer[] = [];
        proxyRes.on('data', (chunk) => errChunks.push(chunk));
        proxyRes.on('end', () => {
          const fullErr = Buffer.concat(errChunks);
          if (!isAuxiliaryReq) {
            if (convId) recordNativeSessionError(convId, proxyRes.statusCode!, proxyRes.headers as Record<string, string>, fullErr, effectiveModel);
            if (sessId && sessId !== convId) recordNativeSessionError(sessId, proxyRes.statusCode!, proxyRes.headers as Record<string, string>, fullErr, effectiveModel);
            if (!convId && !sessId) updateLatestNativeErrorBody(fullErr);
          }
        });
        if (safeHead(proxyRes.statusCode, proxyRes.headers as Record<string, string>)) {
          proxyRes.pipe(res);
        }
        return;
      }
      if (isStream) {
        transformGoogleStreamForRemote(proxyRes, res, convId, isRemoteSession, reqModelName, reqStart);
      } else {
        const responseChunks: Buffer[] = [];
        proxyRes.on('data', (chunk) => responseChunks.push(chunk));
        proxyRes.on('end', () => {
          if (res.headersSent || res.writableEnded) return;
          const fullResBody = Buffer.concat(responseChunks);
          let text = fullResBody.toString('utf-8');
          try {
            const data = JSON.parse(text);
            extractAndCacheThoughtSignatures(data, convId);
            if (sanitizeCandidatesInResponse(data)) text = JSON.stringify(data);
            const usage = data?.response?.usageMetadata || data?.usageMetadata;
            if (usage) {
              const pTokens = usage.promptTokenCount || 0;
              const cTokens = usage.candidatesTokenCount || 0;
              const tTokens = usage.totalTokenCount || (pTokens + cTokens);
              if (tTokens > 0 || pTokens > 0) {
                logTokenUsageEvent({
                  id: `req-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
                  timestamp: Date.now(),
                  conversationId: convId || undefined,
                  provider: 'google',
                  model: reqModelName || data?.response?.modelVersion || data?.modelVersion || 'gemini-3.8-flash',
                  promptTokens: pTokens,
                  completionTokens: cTokens,
                  totalTokens: tTokens,
                  cachedTokens: usage.cachedContentTokenCount || 0,
                  latencyMs: Math.max(1, Date.now() - reqStart),
                  status: proxyRes.statusCode || 200,
                  endpoint: '/v1internal:generateContent',
                });
              }
            }
          } catch (_) {}
          const modifiedHeaders = { ...proxyRes.headers };
          delete modifiedHeaders['content-encoding'];
          delete modifiedHeaders['transfer-encoding'];
          const modifiedBuffer = Buffer.from(text, 'utf-8');
          modifiedHeaders['content-length'] = String(modifiedBuffer.length);
          if (safeWriteHead(res, proxyRes.statusCode || 200, modifiedHeaders as Record<string, string>)) {
            safeEnd(res, modifiedBuffer);
          }
        });
      }
    } else {
      if (safeHead(proxyRes.statusCode || 200, proxyRes.headers as Record<string, string>)) {
        proxyRes.pipe(res);
      }
    }
  });

  proxyReq.on('error', (err) => {
    if (!hostOverride && isCloudCodeUrl && !isGeneration && !res.headersSent && !res.writableEnded) {
      log.warn(`[Proxy] Google network error on ${targetHost}. Retrying production...`);
      proxyToGoogle(req, res, reqBody, isRemoteSession, customAuthHeader, convId, GOOGLE_HOSTS.CLOUD_CODE_PROD, sessId, originalModel);
      return;
    }
    metricInc('proxy_errors_total', { upstream: targetHost, stage: 'forward', trace_id: traceId });
    const ms = endTimer();
    proxyLog.error('Google forwarding error traceId=', traceId, 'after', ms, 'ms:', err.message);
    const effectiveModel = originalModel || '';
    if (convId) recordNativeSessionError(convId, 502, {}, Buffer.from(err.message), effectiveModel);
    if (sessId && sessId !== convId) recordNativeSessionError(sessId, 502, {}, Buffer.from(err.message), effectiveModel);
    recordLatestNativeError(502, {}, Buffer.from(err.message), effectiveModel);
    if (safeWriteHead(res, 500, { 'Content-Type': 'application/json' })) {
      safeEnd(res, JSON.stringify({ error: { message: 'Proxy forwarding failed: ' + err.message, traceId } }));
    }
  });

  proxyReq.on('close', () => {
    const ms = endTimer();
    metricObserve('proxy_upstream_ms', ms, { upstream: targetHost, trace_id: traceId });
  });

  const isFlashDirect = /flash/i.test(originalModel || '');
  const isDirectLargeOrThinking = (reqBody && reqBody.length > 120_000) ||
    /thinking|thought|-high$|-medium$/i.test(originalModel || '') ||
    (reqBody && reqBody.includes(Buffer.from('/think-')));
  const forwardTimeoutMs = isFlashDirect
    ? (isDirectLargeOrThinking ? Math.min(65_000, GOOGLE_PROXY_TIMEOUT_MS) : Math.min(35_000, GOOGLE_PROXY_TIMEOUT_MS))
    : GOOGLE_PROXY_TIMEOUT_MS;
  proxyReq.setTimeout(forwardTimeoutMs, () => {
    log.error(`[Proxy] Google proxy request timed out after ${forwardTimeoutMs / 1000}s`);
    proxyReq.destroy();
    const effectiveModel = originalModel || '';
    if (convId) recordNativeSessionError(convId, 504, {}, Buffer.from('Google API request timed out'), effectiveModel);
    if (sessId && sessId !== convId) recordNativeSessionError(sessId, 504, {}, Buffer.from('Google API request timed out'), effectiveModel);
    recordLatestNativeError(504, {}, Buffer.from('Google API request timed out'), effectiveModel);
    if (safeHead(504, { 'Content-Type': 'application/json' })) {
      safeEnd(res, JSON.stringify({ error: { message: 'Google API request timed out' } }));
    }
  });

  if (reqBody) proxyReq.write(reqBody);
  proxyReq.end();
}
