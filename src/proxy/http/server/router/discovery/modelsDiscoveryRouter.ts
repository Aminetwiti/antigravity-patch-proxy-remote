import * as http from 'http';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { URL } from 'url';
import log from 'electron-log';
import { GOOGLE_HOSTS } from '../../../../../constants';
import { resolveGoogleIp } from '../../dnsResolver';
import { safeWriteHead, safeEnd } from '../../httpUtils';
import { loadCustomModels } from '../../../../models/catalog/modelLoader';
import { generateModelPlaceholderId, toSlug } from '../../../../models/catalog/idGenerator';
import {
  mergeModels,
  injectCustomSlugsIntoAgentModelSorts,
  buildSyntheticModelsResponse,
} from '../../../../models/protobuf/modelInjector';
import { checkAllModelsHealth } from '../../../../resilience/pools/modelHealthChecker';
import {
  loadCachedAvailableModels,
  saveCachedAvailableModels,
  memoryFetchAvailableModelsTime,
} from '../../../routes/endpointHandlers';

export async function handleModelsDiscoveryRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  fullBody: Buffer,
): Promise<boolean> {
  if (req.url!.includes('/v1internal:fetchAvailableModels')) {
    log.debug('[Proxy] Intercepting fetchAvailableModels request');

    const cachedModels = loadCachedAvailableModels();
    if (cachedModels && memoryFetchAvailableModelsTime && Date.now() - memoryFetchAvailableModelsTime < 60_000) {
      log.debug('[Proxy] Serving fresh cached fetchAvailableModels response instantly');
      if (safeWriteHead(res, 200, { 'Content-Type': 'application/json' })) {
        safeEnd(res, cachedModels);
      }
      return true;
    }

    const customModelsForHealth = loadCustomModels();
    if (customModelsForHealth.length > 0) {
      checkAllModelsHealth(customModelsForHealth).catch((err) => {
        log.error('[Proxy] Background health check failed:', err);
      });
    }

    const targetHost = GOOGLE_HOSTS.CLOUD_CODE;
    const targetUrl = `https://${targetHost}`;
    let parsedUrl: URL;
    try {
      const realIp = await resolveGoogleIp(targetHost);
      parsedUrl = new URL(req.url!, targetUrl);
      parsedUrl.hostname = realIp;
    } catch (e) {
      log.warn(`[Proxy] DNS resolution failed for ${targetHost}, serving cached/synthetic custom models:`, e);
      if (!res.headersSent && !res.writableEnded) {
        const customModels = loadCustomModels();
        const fallbackPayload = loadCachedAvailableModels() || JSON.stringify(buildSyntheticModelsResponse(customModels));
        safeWriteHead(res, 200, { 'Content-Type': 'application/json' });
        safeEnd(res, fallbackPayload);
      }
      return true;
    }

    const fwdHeaders: Record<string, string | string[] | undefined> = {
      ...(req.headers as Record<string, string | string[] | undefined>),
    };
    fwdHeaders['host'] = targetHost;
    delete fwdHeaders['connection'];
    delete fwdHeaders['keep-alive'];
    delete fwdHeaders['accept-encoding'];

    const fwdOptions: https.RequestOptions = {
      method: req.method,
      headers: fwdHeaders as Record<string, string>,
      servername: targetHost,
    };

    const googleReq = https.request(parsedUrl, fwdOptions, (googleRes) => {
      let googleResErrored = false;
      googleRes.on('error', (err) => {
        googleResErrored = true;
        log.error('[Proxy] fetchAvailableModels upstream error:', err.message);
      });

      let googleBody = '';
      googleRes.on('data', (chunk) => (googleBody += chunk));
      googleRes.on('end', () => {
        if (googleResErrored || res.headersSent || res.writableEnded) return;
        let googleJson: Record<string, unknown> | null = null;
        try {
          try {
            googleJson = JSON.parse(googleBody) as Record<string, unknown>;
          } catch {
            googleJson = { models: {} };
          }
          fs.promises
            .writeFile(path.join(os.tmpdir(), 'ag-fetchAvailableModels-dump.json'), JSON.stringify(googleJson, null, 2))
            .catch(() => {});
          const customModels = loadCustomModels();

          let merged = false;
          if (googleJson.models) {
            googleJson.models = mergeModels(googleJson.models, customModels);
            merged = true;
          }
          if (googleJson.availableModels) {
            googleJson.availableModels = mergeModels(googleJson.availableModels, customModels);
            merged = true;
          }
          if (googleJson.available_models) {
            googleJson.available_models = mergeModels(googleJson.available_models, customModels);
            merged = true;
          }

          if (!merged) {
            const synth = buildSyntheticModelsResponse(customModels);
            googleJson.models = synth.models;
            if (!googleJson.agentModelSorts) googleJson.agentModelSorts = synth.agentModelSorts;
          }

          if (googleJson.models && typeof googleJson.models === 'object') {
            for (const mEntry of Object.values(googleJson.models as Record<string, any>)) {
              if (mEntry?.modelExperiments?.experiments) {
                for (const exp of Object.values(mEntry.modelExperiments.experiments as Record<string, any>)) {
                  if (typeof exp?.stringValue === 'string' && exp.stringValue.includes('MODEL_PLACEHOLDER_')) {
                    exp.stringValue = exp.stringValue.replace(
                      /"checkpoint_model":\s*"MODEL_PLACEHOLDER_[^"]+"/g,
                      '"checkpoint_model": "gemini-3.8-flash"',
                    );
                  }
                }
              }
            }
          }

          const unlockModelsMap = (modelsMap: any) => {
            if (!modelsMap || typeof modelsMap !== 'object') return;
            for (const [mId, mEntry] of Object.entries(modelsMap as Record<string, any>)) {
              if (!mEntry || typeof mEntry !== 'object') continue;
              const mDisp = String(mEntry.displayName || '');
              const mTag = String(mEntry.tagTitle || '');
              const mDesc = String(mEntry.tagDescription || '');
              const mIdLower = mId.toLowerCase();
              const mDispLower = mDisp.toLowerCase();
              // Preserve native Carbon, Argon, and Hydrogen as Unavailable / disabled
              if (
                mIdLower.includes('carbon') || mDispLower.includes('carbon') ||
                mIdLower.includes('argon') || mDispLower.includes('argon') ||
                ((mIdLower.includes('hydrogen') || mDispLower.includes('hydrogen')) && !mIdLower.includes('sonar') && !mDispLower.includes('sonar') && !mIdLower.includes('model_placeholder_'))
              ) {
                mEntry.disabled = true;
                mEntry.tagTitle = 'Unavailable';
                mEntry.tagDescription = 'Unavailable';
                continue;
              }
              if (
                mTag.toLowerCase().includes('unavailable') ||
                mDesc.toLowerCase().includes('ultra') ||
                mEntry.disabled === true
              ) {
                delete mEntry.disabled;
                if (mTag.toLowerCase().includes('unavailable') || mDesc.toLowerCase().includes('ultra')) {
                  delete mEntry.tagTitle;
                  delete mEntry.tagDescription;
                }
                if (!mEntry.quotaInfo) {
                  mEntry.quotaInfo = { remainingFraction: 1, resetTime: '2099-01-01T00:00:00Z' };
                }
              }
            }
          };
          unlockModelsMap(googleJson.models);
          unlockModelsMap(googleJson.availableModels);
          unlockModelsMap(googleJson.available_models);

          try {
            if (typeof injectCustomSlugsIntoAgentModelSorts === 'function') {
              injectCustomSlugsIntoAgentModelSorts(googleJson, customModels);
            }
          } catch (sortErr) {
            log.warn('[Proxy] Failed to inject custom slugs into agentModelSorts:', sortErr);
          }

          if (googleJson.error) {
            delete (googleJson as Record<string, unknown>).error;
          }

          const finalPayload = JSON.stringify(googleJson);
          saveCachedAvailableModels(finalPayload);
          safeWriteHead(res, 200, { 'Content-Type': 'application/json' });
          safeEnd(res, finalPayload);
        } catch (err) {
          log.error('[Proxy] Parsing fetchAvailableModels failed:', err);
          if (res.headersSent || res.writableEnded) return;
          const customModels = loadCustomModels();
          const mappedCustom: Record<string, unknown> = {};
          customModels.forEach((m) => {
            const slug = toSlug(m);
            const pid = generateModelPlaceholderId(m);
            const entry = {
              displayName: m.displayName,
              maxTokens: 1048576,
              maxOutputTokens: 4096,
              model: pid,
              planModel: pid,
              requestedModel: pid,
              apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
              modelProvider: 'MODEL_PROVIDER_GOOGLE',
            };
            mappedCustom[slug] = entry;
            mappedCustom[pid] = entry;
          });
          let responsePayload: Record<string, unknown> = { models: mappedCustom };
          if (googleJson && typeof googleJson === 'object') {
            if (googleJson.models && typeof googleJson.models === 'object') {
              responsePayload = { ...googleJson, models: { ...(googleJson.models as Record<string, unknown>), ...mappedCustom } };
            } else {
              responsePayload = { ...googleJson, models: mappedCustom };
            }
          }
          const fallbackStr = JSON.stringify(responsePayload);
          saveCachedAvailableModels(fallbackStr);
          safeWriteHead(res, 200, { 'Content-Type': 'application/json' });
          safeEnd(res, fallbackStr);
        }
      });
    });

    googleReq.on('error', (err) => {
      log.error('[Proxy] Forwarding fetchAvailableModels failed:', err.message);
      if (!res.headersSent && !res.writableEnded) {
        const customModels = loadCustomModels();
        const fallbackPayload = loadCachedAvailableModels() || JSON.stringify(buildSyntheticModelsResponse(customModels));
        safeWriteHead(res, 200, { 'Content-Type': 'application/json' });
        safeEnd(res, fallbackPayload);
      }
    });

    const FETCH_AVAILABLE_MODELS_TIMEOUT_MS = 3_500;
    googleReq.setTimeout(FETCH_AVAILABLE_MODELS_TIMEOUT_MS, () => {
      googleReq.destroy();
      if (!res.headersSent && !res.writableEnded) {
        const customModels = loadCustomModels();
        const fallbackPayload = loadCachedAvailableModels() || JSON.stringify(buildSyntheticModelsResponse(customModels));
        safeWriteHead(res, 200, { 'Content-Type': 'application/json' });
        safeEnd(res, fallbackPayload);
      }
    });

    if (fullBody && fullBody.length > 0) {
      googleReq.write(fullBody);
    }
    googleReq.end();
    return true;
  }

  if (req.method === 'GET' && (req.url!.endsWith('/models') || req.url!.includes('/models?'))) {
    log.debug('[Proxy] Intercepting models list request');

    const targetHost = GOOGLE_HOSTS.GENERATIVE_LANGUAGE;
    const targetUrl = `https://${targetHost}`;
    let parsedUrl: URL;
    try {
      const realIp = await resolveGoogleIp(targetHost);
      parsedUrl = new URL(req.url!, targetUrl);
      parsedUrl.hostname = realIp;
    } catch (e) {
      log.error(`[Proxy] Could not resolve upstream IP for ${targetHost}:`, e);
      if (safeWriteHead(res, 500, { 'Content-Type': 'application/json' })) {
        safeEnd(res, JSON.stringify({ error: { message: 'DNS resolution failed for ' + targetHost } }));
      }
      return true;
    }
    const mdlHeaders: Record<string, string | string[] | undefined> = {
      ...(req.headers as Record<string, string | string[] | undefined>),
    };
    mdlHeaders['host'] = targetHost;
    delete mdlHeaders['connection'];
    delete mdlHeaders['accept-encoding'];

    const mdlOptions: https.RequestOptions = {
      method: 'GET',
      headers: mdlHeaders as Record<string, string>,
      servername: targetHost,
    };

    const googleReq = https.request(parsedUrl, mdlOptions, (googleRes) => {
      let googleResErrored = false;
      googleRes.on('error', (err) => {
        googleResErrored = true;
        log.error('[Proxy] Models list upstream error:', err.message);
      });

      let googleBody = '';
      googleRes.on('data', (chunk) => (googleBody += chunk));
      googleRes.on('end', () => {
        if (googleResErrored || res.headersSent || res.writableEnded) return;
        try {
          const googleJson = JSON.parse(googleBody) as { models?: unknown[] };
          const customModels = loadCustomModels();

          const mappedCustom = customModels.map((m) => ({
            name: 'models/' + generateModelPlaceholderId(m),
            version: '1.0',
            displayName: m.displayName,
            description: m.description,
            inputTokenLimit: 1048576,
            outputTokenLimit: 4096,
            supportedGenerationMethods: ['generateContent', 'countTokens'],
            temperature: 0.7,
            topP: 0.9,
            topK: 40,
          }));

          if (googleJson.models) {
            googleJson.models = [...mappedCustom, ...googleJson.models];
          } else {
            googleJson.models = mappedCustom;
          }

          safeWriteHead(res, 200, { 'Content-Type': 'application/json' });
          safeEnd(res, JSON.stringify(googleJson));
        } catch (err) {
          log.error('[Proxy] Google list models failed:', err);
          if (res.headersSent || res.writableEnded) return;
          safeWriteHead(res, 502, { 'Content-Type': 'application/json' });
          safeEnd(res, JSON.stringify({ error: { message: `Upstream models parse error: ${(err as Error).message}` } }));
        }
      });
    });

    googleReq.on('error', (err) => {
      log.error('[Proxy] Google models list request error:', err);
      if (!res.headersSent && !res.writableEnded) {
        const customModels = loadCustomModels();
        safeWriteHead(res, 200, { 'Content-Type': 'application/json' });
        safeEnd(
          res,
          JSON.stringify({
            models: customModels.map((m) => ({
              name: m.name,
              displayName: m.displayName,
              description: m.description,
              supportedGenerationMethods: ['generateContent'],
            })),
          }),
        );
      }
    });

    googleReq.setTimeout(30_000, () => {
      googleReq.destroy();
      if (!res.headersSent && !res.writableEnded) {
        const customModels = loadCustomModels();
        safeWriteHead(res, 200, { 'Content-Type': 'application/json' });
        safeEnd(
          res,
          JSON.stringify({
            models: customModels.map((m) => ({
              name: m.name,
              displayName: m.displayName,
              description: m.description,
              supportedGenerationMethods: ['generateContent'],
            })),
          }),
        );
      }
    });
    googleReq.end();
    return true;
  }

  return false;
}
