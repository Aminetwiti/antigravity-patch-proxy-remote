import * as http from 'http';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import log from 'electron-log';
import { LOOPBACK_HOSTS } from '../../../../constants';
import { safeWriteHead, safeEnd } from '../../server/httpUtils';
import { loadCustomModels, loadDisabledModelIds } from '../../../models/catalog/modelLoader';
import { getFastOrCachedHealth } from '../../../resilience/pools/modelHealthChecker';
import { injectCustomModelsIntoResponse } from '../../../models/protobuf/protoInjector';

export let memoryFetchAvailableModelsCache: string | null = null;
export let memoryFetchAvailableModelsTime = 0;

export function getFetchAvailableModelsCachePath(): string {
  const home = os.homedir();
  const dir = path.join(home, '.gemini', 'antigravity');
  if (!fs.existsSync(dir)) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  }
  return path.join(dir, 'fetch_available_models_cache.json');
}

export function loadCachedAvailableModels(): string | null {
  if (memoryFetchAvailableModelsCache) return memoryFetchAvailableModelsCache;
  try {
    const p = getFetchAvailableModelsCachePath();
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, 'utf-8').trim();
      if (content.startsWith('{')) {
        memoryFetchAvailableModelsCache = content;
        return content;
      }
    }
  } catch (e) {
    log.debug('[Proxy] Failed to load cached available models:', e);
  }
  return null;
}

export function saveCachedAvailableModels(content: string): void {
  try {
    memoryFetchAvailableModelsCache = content;
    memoryFetchAvailableModelsTime = Date.now();
    const p = getFetchAvailableModelsCachePath();
    fs.writeFileSync(p, content, 'utf-8');
  } catch (e) {
    log.warn('[Proxy] Failed to save cached available models:', e);
  }
}

export function handleGetAvailableModelsProxy(
  res: http.ServerResponse,
  reqBody: Buffer,
  lsUrl: string,
  reqHeaders: Record<string, string | string[] | undefined>,
): void {
  const lsParsed = new URL(lsUrl);
  const client = lsParsed.protocol === 'https:' ? https : http;
  const bodyToSend = reqBody && reqBody.length > 0 ? reqBody : Buffer.from([0, 0, 0, 0, 0]);

  const options: https.RequestOptions = {
    method: 'POST',
    hostname: lsParsed.hostname,
    port: lsParsed.port || (lsParsed.protocol === 'https:' ? '443' : '80'),
    path: lsParsed.pathname + lsParsed.search,
    headers: {
      'Content-Type': 'application/grpc-web+proto',
      'Accept': 'application/grpc-web+proto',
      'Content-Length': String(bodyToSend.length),
      ...(reqHeaders['x-codeium-csrf-token'] ? { 'x-codeium-csrf-token': String(reqHeaders['x-codeium-csrf-token']) } : {}),
      ...(reqHeaders['Connect-Protocol-Version'] ? { 'Connect-Protocol-Version': String(reqHeaders['Connect-Protocol-Version']) } : {}),
      ...(reqHeaders['X-Grpc-Web'] ? { 'X-Grpc-Web': String(reqHeaders['X-Grpc-Web']) } : {}),
    },
    rejectUnauthorized: !LOOPBACK_HOSTS.includes(lsParsed.hostname as typeof LOOPBACK_HOSTS[number]),
  };

  const lsReq = client.request(options, (lsRes) => {
    let lsResErrored = false;
    lsRes.on('error', (err) => {
      lsResErrored = true;
      log.error('[Proxy] LS error for GetAvailableModels:', err.message);
      if (!res.headersSent && !res.writableEnded) {
        safeWriteHead(res, 502, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': '*',
        });
        safeEnd(res);
      }
    });

    const chunks: Buffer[] = [];
    lsRes.on('data', (chunk: Buffer) => chunks.push(chunk));
    lsRes.on('end', () => {
      if (lsResErrored || res.headersSent || res.writableEnded) {
        log.debug('[Proxy] GetAvailableModels: skipping end handler (response terminated)');
        return;
      }
      const responseBuf = Buffer.concat(chunks);
      const customModels = loadCustomModels();
      const disabledModelIds = loadDisabledModelIds();
      getFastOrCachedHealth(customModels, 800)
        .then((healthMap) => {
          const { buffer: modifiedBuf } = injectCustomModelsIntoResponse(responseBuf, customModels, healthMap, true, disabledModelIds);
          if (
            safeWriteHead(res, lsRes.statusCode || 200, {
              'Content-Type': 'application/grpc-web+proto',
              'Content-Length': String(modifiedBuf.length),
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Headers': '*',
              'Access-Control-Expose-Headers': '*',
            })
          ) {
            safeEnd(res, modifiedBuf);
          }
        })
        .catch(() => {
          const { buffer: modifiedBuf } = injectCustomModelsIntoResponse(responseBuf, customModels, undefined, true, disabledModelIds);
          if (
            safeWriteHead(res, lsRes.statusCode || 200, {
              'Content-Type': 'application/grpc-web+proto',
              'Content-Length': String(modifiedBuf.length),
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Headers': '*',
              'Access-Control-Expose-Headers': '*',
            })
          ) {
            safeEnd(res, modifiedBuf);
          }
        });
    });
  });

  lsReq.setTimeout(30_000, () => {
    log.error('[Proxy] GetAvailableModels forward timed out');
    lsReq.destroy();
    if (!res.headersSent && !res.writableEnded) {
      safeWriteHead(res, 504, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
      });
      safeEnd(res);
    }
  });

  lsReq.on('error', (err) => {
    log.error('[Proxy] GetAvailableModels forward error:', err.message);
    if (!res.headersSent && !res.writableEnded) {
      safeWriteHead(res, 502, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
      });
      safeEnd(res);
    }
  });

  lsReq.write(bodyToSend);
  lsReq.end();
}
