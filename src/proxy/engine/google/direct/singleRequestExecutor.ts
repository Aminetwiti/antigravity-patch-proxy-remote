import type http from 'http';
import https from 'https';
import log from 'electron-log';
import { startTimer as metricTimer, inc as metricInc, observe as metricObserve } from '../../../../shared/metrics';
import { GOOGLE_HOSTS, GOOGLE_PROXY_TIMEOUT_MS } from '../../../../constants';
import type { CustomModel } from '../../../core/types';
import { isRetryableNetworkError } from '../../../resilience/retry/retryStrategy';
import { getHttpsAgent, evictAgent } from '../../../resilience/pools/agentPool';
import { resolveGoogleIp, invalidateCachedDns } from '../../../http/server/dnsResolver';
import { getAccountVirtualDeviceHeaders } from '../../../resilience/pools/googlePool';
import { safeWriteHead, proxyLog, newTraceId } from '../../../http/server/httpUtils';
import type { ResponseClaimer } from '../../transforms/historyTrimmer';
import { transformGoogleStreamForRemote } from '../../stream/streamPipeline';
import type { GoogleRequestOutcome } from './types';
import { handleBufferedCloudCodeResponse, handleNonStreamingGenerationResponse } from './responseRewriter';

export function executeGoogleCloudCodeRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  reqBody: Buffer,
  isRemoteSession = false,
  customAuthHeader?: string,
  convId = '',
  hostOverride?: string,
  timeoutMs?: number,
  modelName = '',
  startTime = Date.now(),
  responseClaimer?: ResponseClaimer,
  candidate?: CustomModel,
): Promise<GoogleRequestOutcome> {
  return new Promise((resolve) => {
    const traceId = newTraceId();
    const isCloudCodeUrl = req.url!.includes('v1internal') || req.url!.includes('daily-cloudcode') || req.url!.includes('cloudcode');
    const targetHost = hostOverride || (isCloudCodeUrl ? GOOGLE_HOSTS.CLOUD_CODE : GOOGLE_HOSTS.GENERATIVE_LANGUAGE);
    const targetUrl = `https://${targetHost}`;
    const parsedUrl = new URL(req.url!, targetUrl);
    const endTimer = metricTimer('proxy_request_ms', { upstream: targetHost });

    let settled = false;
    let proxyReq: http.ClientRequest | undefined;

    const onClientClose = () => {
      const clientTrulyClosed = res?.writableEnded || res?.destroyed || Boolean(res?.socket && res.socket.destroyed);
      if (!settled && clientTrulyClosed) {
        try { proxyReq?.destroy(); } catch (_) {}
        finish({ success: false, statusCode: 499, error: 'Client closed request before completion' });
      }
    };
    if (typeof res?.once === 'function') res.once('close', onClientClose);

    const finish = (outcome: GoogleRequestOutcome) => {
      if (settled) return;
      settled = true;
      try {
        if (typeof res?.off === 'function') res.off('close', onClientClose);
      } catch (_) {}
      if (proxyReq) {
        try { proxyReq.setTimeout(0); } catch (_) {}
        if (!outcome.success) {
          try { proxyReq.destroy(); } catch (_) {}
        }
      }
      resolve(outcome);
    };

    resolveGoogleIp(targetHost).then((realIp) => {
      parsedUrl.hostname = realIp;

      const headers: Record<string, string | string[] | undefined> = {
        ...(req.headers as Record<string, string | string[] | undefined>),
      };
      headers['host'] = targetHost;
      headers['content-length'] = String(reqBody.length);
      delete headers['connection'];
      delete headers['keep-alive'];
      delete headers['Authorization'];
      delete headers['authorization'];
      if (customAuthHeader) {
        headers['authorization'] = customAuthHeader;
      }
      if (isCloudCodeUrl) {
        delete headers['User-Agent'];
        delete headers['user-agent'];
        headers['user-agent'] = 'antigravity';
        if (candidate) {
          const virtualDevHeaders = getAccountVirtualDeviceHeaders(candidate);
          Object.assign(headers, virtualDevHeaders);
        }
      }

      const isGeneration = req.url!.includes('generateContent') || req.url!.includes('streamGenerateContent');
      const isStream = req.url!.includes('streamGenerateContent') || req.url!.includes('alt=sse');
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

      log.info(`[SingleExec Dispatch] URL=${parsedUrl.toString()} servername=${targetHost} auth=${String(headers['authorization']).slice(0, 20)}... bodyLen=${reqBody.length}`);

      proxyReq = https.request(parsedUrl, options, (proxyRes) => {
        if (responseClaimer) {
          responseClaimer.registerAbort(traceId, () => {
            try { proxyReq?.destroy(); } catch (_) {}
          });
        }
        proxyReq?.setTimeout(0);

        const status = proxyRes.statusCode || 200;

        if (status >= 400) {
          proxyReq?.setTimeout(15_000, () => {
            try { proxyReq?.destroy(); } catch (_) {}
            finish({ success: false, statusCode: status, error: 'Timed out waiting for error body', isTransportError: true });
          });
          const errChunks: Buffer[] = [];
          proxyRes.on('data', (c: Buffer) => errChunks.push(c));
          proxyRes.on('error', (err) => {
            finish({ success: false, statusCode: status, error: 'Proxy response stream error: ' + (err?.message || 'unknown'), isTransportError: true });
          });
          proxyRes.on('close', () => {
            if (!settled) {
              const errText = Buffer.concat(errChunks).toString('utf-8');
              finish({ success: false, statusCode: status, error: errText || 'Upstream error response closed prematurely', isTransportError: true });
            }
          });
          proxyRes.on('end', () => {
            const errText = Buffer.concat(errChunks).toString('utf-8');
            finish({ success: false, statusCode: status, error: errText, headers: proxyRes.headers });
          });
          return;
        }

        if (shouldBufferAndModify) {
          handleBufferedCloudCodeResponse(proxyRes, res, req, status, finish);
        } else if (isGeneration) {
          if (isStream) {
            transformGoogleStreamForRemote(proxyRes, res, convId, isRemoteSession, modelName, startTime);
            finish({ success: true, statusCode: status });
          } else {
            handleNonStreamingGenerationResponse(
              proxyRes,
              res,
              convId,
              modelName,
              startTime,
              status,
              traceId,
              responseClaimer,
              proxyReq,
              finish,
            );
          }
        } else {
          proxyRes.on('error', (err) => {
            finish({ success: false, statusCode: 502, error: 'Upstream stream error: ' + err.message, isTransportError: true });
          });
          if (responseClaimer) {
            if (!responseClaimer.claim(traceId)) {
              try { proxyReq?.destroy(); } catch (_) {}
              finish({ success: false, statusCode: 499, error: 'Cancelled by winning hedged request' });
              return;
            }
            responseClaimer.abortOthers(traceId);
          }
          if (safeWriteHead(res, status, proxyRes.headers as Record<string, string>)) {
            proxyRes.pipe(res);
          }
          finish({ success: true, statusCode: status });
        }
      });

      let isTimedOut = false;

      proxyReq.on('error', (err) => {
        if (settled || isTimedOut) return;
        try { proxyReq?.destroy(); } catch (_) {}
        metricInc('proxy_errors_total', { upstream: targetHost, stage: 'forward', trace_id: traceId });
        const ms = endTimer();
        proxyLog.error('Google forwarding error traceId=', traceId, 'after', ms, 'ms:', err.message);
        const errMsg = err.message || '';
        const isTransport =
          isRetryableNetworkError(err) ||
          /ENETUNREACH|EHOSTUNREACH|ENETDOWN|ECONNREFUSED|ECONNABORTED|ECONNRESET|socket hang up/i.test(errMsg);
        if (isTransport) {
          try {
            evictAgent({ host: targetHost });
            invalidateCachedDns(targetHost);
          } catch (_) {}
        }
        finish({
          success: false,
          statusCode: 502,
          error: 'Proxy forwarding failed: ' + errMsg,
          isTransportError: isTransport,
        });
      });

      proxyReq.on('close', () => {
        const ms = endTimer();
        metricObserve('proxy_upstream_ms', ms, { upstream: targetHost, trace_id: traceId });
      });

      let effectiveTimeout: number;
      if (typeof timeoutMs === 'number' && timeoutMs > 0) {
        effectiveTimeout = Math.min(timeoutMs, GOOGLE_PROXY_TIMEOUT_MS);
      } else {
        effectiveTimeout = /flash/i.test(modelName) ? 35_000 : GOOGLE_PROXY_TIMEOUT_MS;
      }
      if (typeof proxyReq?.setTimeout === 'function') {
        proxyReq.setTimeout(effectiveTimeout, () => {
          isTimedOut = true;
          log.error(`[Proxy] Google pool request timed out waiting for response headers on ${targetHost} after ${effectiveTimeout / 1000}s`);
          proxyReq?.destroy();
          finish({ success: false, statusCode: 504, error: 'Google API request timed out' });
        });
      }

      proxyReq.on('socket', (socket) => {
        try {
          if (typeof socket.setNoDelay === 'function') socket.setNoDelay(true);
        } catch (_) {}
      });

      if (reqBody) {
        proxyReq.write(reqBody);
      }
      proxyReq.end();
    }).catch((dnsErr) => {
      metricInc('proxy_errors_total', { upstream: targetHost, stage: 'dns', trace_id: traceId });
      const ms = endTimer();
      proxyLog.error('DNS resolution failed for', targetHost, 'traceId=', traceId, '(in', ms, 'ms)');
      try {
        invalidateCachedDns(targetHost);
      } catch (_) {}
      finish({ success: false, statusCode: 500, error: 'DNS resolution failed: ' + (dnsErr as Error).message, isTransportError: true });
    });
  });
}
