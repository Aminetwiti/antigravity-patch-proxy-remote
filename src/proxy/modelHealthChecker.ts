/**
 * Model Health Checker for Antigravity Proxy
 * Performs concurrent lightweight ping/health checks on custom model endpoints
 * to display status dots (🟢🟡🔴) and dynamic latency (ms) in the IDE model dropdown.
 */

import http from 'http';
import https from 'https';
import log from 'electron-log';
import type { CustomModel } from './types';
import { HEALTH_CHECK_INTERVAL_MS, HEALTH_CHECK_CACHE_TTL_MS } from '../constants';

export interface ModelHealthResult {
  status: 'healthy' | 'slow' | 'unhealthy' | 'cooldown';
  statusCode?: number;
  latencyMs: number;
  error?: string;
}

/** Health check results cache (model name -> result) */
const healthCache = new Map<string, { result: ModelHealthResult; expiresAt: number }>();
const inflightPings = new Map<string, Promise<ModelHealthResult>>();
const CACHE_TTL_MS = HEALTH_CHECK_CACHE_TTL_MS;
const HEALTH_CHECK_TIMEOUT_MS = 6000;

/** Synchronous getter for cached health status */
export function getCachedHealth(modelName: string): ModelHealthResult | null {
  const cached = healthCache.get(modelName);
  // Stale-while-revalidate: always return the cached result if it exists.
  // The background check will update it for the next fetch.
  if (cached) {
    return cached.result;
  }
  return null;
}

/** Synchronously get all available cached health results for models */
export function getCachedHealthMap(models: CustomModel[]): Map<string, ModelHealthResult> {
  const map = new Map<string, ModelHealthResult>();
  for (const m of models) {
    const cached = getCachedHealth(m.name);
    if (cached) {
      map.set(m.name, cached);
    }
  }
  return map;
}

/** Get health results quickly using cache, or racing with a bounded timeout (default 800ms) */
export async function getFastOrCachedHealth(models: CustomModel[], timeoutMs = 800): Promise<Map<string, ModelHealthResult>> {
  const cachedMap = getCachedHealthMap(models);
  if (models.length === 0 || cachedMap.size === models.length) {
    return cachedMap;
  }
  try {
    const checkPromise = checkAllModelsHealth(models);
    let timer: NodeJS.Timeout;
    const timeoutPromise = new Promise<Map<string, ModelHealthResult>>((resolve) => {
      timer = setTimeout(() => resolve(cachedMap), timeoutMs);
    });
    const result = await Promise.race([checkPromise, timeoutPromise]);
    clearTimeout(timer!);
    return result;
  } catch {
    return cachedMap;
  }
}

/** Clear health check cache (entire cache or specific model) */
export function invalidateHealthCache(modelName?: string): void {
  if (modelName) {
    healthCache.delete(modelName);
  } else {
    healthCache.clear();
    inflightPings.clear();
  }
}


/** Ping a single custom model endpoint with strict timeout */
export function pingCustomModel(model: CustomModel): Promise<ModelHealthResult> {
  const cached = healthCache.get(model.name);
  if (cached && Date.now() < cached.expiresAt) {
    return Promise.resolve(cached.result);
  }

  // Deduplicate concurrent in-flight probes to the same endpoint & API key
  const endpointKey = `${model.apiUrl}::${model.apiKey || ''}`;
  const inflight = inflightPings.get(endpointKey);
  if (inflight) {
    return inflight.then((result) => {
      healthCache.set(model.name, { result, expiresAt: Date.now() + CACHE_TTL_MS });
      return result;
    });
  }

  const pingPromise = new Promise<ModelHealthResult>((resolve) => {
    const startTime = Date.now();
    let settled = false;
    let req: http.ClientRequest | null = null;

    const finish = (result: ModelHealthResult) => {
      if (settled) return;
      settled = true;
      healthCache.set(model.name, { result, expiresAt: Date.now() + CACHE_TTL_MS });
      resolve(result);
    };

    const timer = setTimeout(() => {
      if (req) {
        try { req.destroy(); } catch {}
      }
      finish({
        status: 'unhealthy',
        latencyMs: Date.now() - startTime,
        error: 'Timeout',
      });
    }, HEALTH_CHECK_TIMEOUT_MS);

    try {
      const url = new URL(model.apiUrl);
      const isHttps = url.protocol === 'https:';
      const client = isHttps ? https : http;

      req = client.request(
        model.apiUrl,
        {
          method: 'GET',
          timeout: HEALTH_CHECK_TIMEOUT_MS,
          rejectUnauthorized: model.allowUnauthorized ? false : true,
          headers: {
            'User-Agent': 'Antigravity-HealthCheck/1.0',
            ...(model.apiKey && model.apiKey !== 'none' ? { Authorization: `Bearer ${model.apiKey}` } : {}),
          },
        },
        (res) => {
          clearTimeout(timer);
          const latencyMs = Date.now() - startTime;
          const statusCode = res.statusCode || 0;
          // Abort request to save bandwidth (we only need headers/status)
          res.destroy();
          if (req) req.destroy();

          if (statusCode === 429) {
            finish({ status: 'cooldown', statusCode, latencyMs, error: 'Cooldown (429)' });
          } else if (statusCode === 401 || statusCode === 403) {
            finish({ status: 'unhealthy', statusCode, latencyMs, error: 'Auth Error' });
          } else if (statusCode >= 500) {
            finish({ status: 'unhealthy', statusCode, latencyMs, error: `Server Error (${statusCode})` });
          } else if (latencyMs > 500) {
            finish({ status: 'slow', statusCode, latencyMs });
          } else {
            finish({ status: 'healthy', statusCode, latencyMs });
          }
        },
      );

      req.on('error', (err) => {
        clearTimeout(timer);
        finish({
          status: 'unhealthy',
          latencyMs: Date.now() - startTime,
          error: err.message,
        });
      });

      req.end();
    } catch (e) {
      clearTimeout(timer);
      finish({
        status: 'unhealthy',
        latencyMs: 0,
        error: String(e),
      });
    }
  });

  inflightPings.set(endpointKey, pingPromise);
  pingPromise.finally(() => {
    if (inflightPings.get(endpointKey) === pingPromise) {
      inflightPings.delete(endpointKey);
    }
  });

  return pingPromise;
}

/** Check health of all custom models with endpoint deduplication and bounded concurrency */
export async function checkAllModelsHealth(models: CustomModel[]): Promise<Map<string, ModelHealthResult>> {
  const results = new Map<string, ModelHealthResult>();
  if (models.length === 0) return results;

  // Group models by unique endpoint (apiUrl + apiKey) so 10 accounts pointing to the same endpoint don't spam 10 sockets
  const endpointMap = new Map<string, CustomModel[]>();
  for (const m of models) {
    const key = `${m.apiUrl}::${m.apiKey || ''}`;
    const group = endpointMap.get(key) || [];
    group.push(m);
    endpointMap.set(key, group);
  }

  log.info(`[HealthChecker] Checking health for ${models.length} models across ${endpointMap.size} unique endpoints...`);

  // Bounded concurrency pool (max 6 parallel pings)
  const uniqueEndpoints = Array.from(endpointMap.values()).map(group => group[0]);
  const limit = 6;
  const queue = [...uniqueEndpoints];

  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length > 0) {
      const model = queue.shift();
      if (!model) break;
      const health = await pingCustomModel(model);
      const group = endpointMap.get(`${model.apiUrl}::${model.apiKey || ''}`) || [model];
      for (const m of group) {
        results.set(m.name, health);
        // Also ensure individual cache entries are set
        healthCache.set(m.name, { result: health, expiresAt: Date.now() + CACHE_TTL_MS });
      }
    }
  });

  await Promise.allSettled(workers);
  return results;
}

// Background auto-refresh to pre-warm cache and keep it fresh
import { loadCustomModels } from './modelLoader';
if (HEALTH_CHECK_INTERVAL_MS > 0) {
  setInterval(() => {
    const models = loadCustomModels();
    if (models.length > 0) {
      checkAllModelsHealth(models).catch(() => {});
    }
  }, HEALTH_CHECK_INTERVAL_MS);
}

// Initial pre-warm on module load
setTimeout(() => {
  const models = loadCustomModels();
  if (models.length > 0) {
    checkAllModelsHealth(models).catch(() => {});
  }
}, 2000);

