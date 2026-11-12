import type http from 'http';
import * as zlib from 'zlib';
import log from 'electron-log';
import { safeWriteHead, safeEnd } from '../../../http/server/httpUtils';
import { extractAndCacheThoughtSignatures } from '../../../core/shared';
import { sanitizeCandidatesInResponse } from '../../stream/streamPipeline';
import { logTokenUsageEvent } from '../../../state/remote/remoteState';
import type { ResponseClaimer } from '../../transforms/historyTrimmer';
import type { GoogleRequestOutcome } from './types';

export function handleBufferedCloudCodeResponse(
  proxyRes: http.IncomingMessage,
  res: http.ServerResponse,
  req: http.IncomingMessage,
  status: number,
  finish: (outcome: GoogleRequestOutcome) => void,
): void {
  const responseChunks: Buffer[] = [];
  proxyRes.on('data', (chunk: Buffer) => responseChunks.push(chunk));
  proxyRes.on('error', (err) => {
    if (safeWriteHead(res, 502, { 'Content-Type': 'application/json' })) {
      safeEnd(res, JSON.stringify({ error: { message: `Upstream response stream error: ${err.message}` } }));
    }
    finish({ success: false, statusCode: 502, error: err.message, isTransportError: true });
  });
  proxyRes.on('close', () => {
    finish({ success: false, statusCode: 502, error: 'Upstream connection closed prematurely', isTransportError: true });
  });
  proxyRes.on('end', () => {
    if (res.headersSent || res.writableEnded) {
      finish({ success: true, statusCode: status });
      return;
    }
    const fullResBody = Buffer.concat(responseChunks);
    let text: string;
    const encoding = proxyRes.headers['content-encoding'];
    if (encoding === 'gzip') {
      try {
        text = zlib.gunzipSync(fullResBody).toString('utf-8');
      } catch (e) {
        if (safeWriteHead(res, 502, { 'Content-Type': 'application/json' })) {
          safeEnd(res, JSON.stringify({ error: { message: `Decompression failed: ${(e as Error).message}` } }));
        }
        finish({ success: true, statusCode: 502 });
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

    if (safeWriteHead(res, status, modifiedHeaders as Record<string, string>)) {
      safeEnd(res, modifiedBuffer);
    }
    finish({ success: true, statusCode: status });
  });
}

export function handleNonStreamingGenerationResponse(
  proxyRes: http.IncomingMessage,
  res: http.ServerResponse,
  convId: string,
  modelName: string,
  startTime: number,
  status: number,
  traceId: string,
  responseClaimer: ResponseClaimer | undefined,
  proxyReq: http.ClientRequest | undefined,
  finish: (outcome: GoogleRequestOutcome) => void,
): void {
  const responseChunks: Buffer[] = [];
  proxyRes.on('data', (chunk: Buffer) => responseChunks.push(chunk));
  proxyRes.on('error', (err) => {
    finish({ success: false, statusCode: 502, error: 'Upstream generation stream error: ' + err.message, isTransportError: true });
  });
  proxyRes.on('close', () => {
    finish({ success: false, statusCode: 502, error: 'Upstream generation connection closed prematurely', isTransportError: true });
  });
  proxyRes.on('end', () => {
    if (res.headersSent || res.writableEnded) {
      finish({ success: true, statusCode: status });
      return;
    }
    const fullResBody = Buffer.concat(responseChunks);
    let text = fullResBody.toString('utf-8');
    try {
      const data = JSON.parse(text);
      extractAndCacheThoughtSignatures(data, convId);
      const modified = sanitizeCandidatesInResponse(data);
      if (modified) {
        text = JSON.stringify(data);
      }
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
            model: modelName || data?.response?.modelVersion || data?.modelVersion || 'gemini-3.8-flash',
            promptTokens: pTokens,
            completionTokens: cTokens,
            totalTokens: tTokens,
            cachedTokens: usage.cachedContentTokenCount || 0,
            latencyMs: Math.max(1, Date.now() - startTime),
            status,
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
    if (responseClaimer) {
      if (!responseClaimer.claim(traceId)) {
        try { proxyReq?.destroy(); } catch (_) {}
        finish({ success: false, statusCode: 499, error: 'Cancelled by winning hedged request' });
        return;
      }
      responseClaimer.abortOthers(traceId);
    }
    if (safeWriteHead(res, status, modifiedHeaders as Record<string, string>)) {
      safeEnd(res, modifiedBuffer);
    }
    finish({ success: true, statusCode: status });
  });
}
