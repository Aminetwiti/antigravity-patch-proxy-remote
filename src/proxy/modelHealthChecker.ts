/**
 * Model Health Checker for Antigravity Proxy
 * Performs concurrent lightweight ping/health checks on custom model endpoints
 * to display status dots (🟢🟡🔴) and dynamic latency (ms) in the IDE model dropdown.
 */

import http from 'http';
import https from 'https';
import log from 'electron-log';
import type { CustomModel } from './types';

export interface ModelHealthResult {
  status: 'healthy' | 'slow' | 'unhealthy' | 'cooldown';
  statusCode?: number;
  latencyMs: number;
  error?: string;
}

/** Health check results cache (model name -> result) with 30s TTL */
const healthCache = new Map<string, { result: ModelHealthResult; expiresAt: number }>();
const inflightPings = new Map<string, Promise<ModelHealthResult>>();
const CACHE_TTL_MS = 30_000;
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

/** Check health of all custom models concurrently */
export async function checkAllModelsHealth(models: CustomModel[]): Promise<Map<string, ModelHealthResult>> {
  const results = new Map<string, ModelHealthResult>();
  log.info(`[HealthChecker] Checking health for ${models.length} custom models concurrently...`);

  const checks = models.map(async (model) => {
    const health = await pingCustomModel(model);
    results.set(model.name, health);
  });

  await Promise.allSettled(checks);
  return results;
}

// Background auto-refresh to pre-warm cache and keep it fresh
import { loadCustomModels } from './modelLoader';
setInterval(() => {
  const models = loadCustomModels();
  if (models.length > 0) {
    checkAllModelsHealth(models).catch(() => {});
  }
}, 30_000);

// Initial pre-warm on module load
setTimeout(() => {
  const models = loadCustomModels();
  if (models.length > 0) {
    checkAllModelsHealth(models).catch(() => {});
  }
}, 2000);

