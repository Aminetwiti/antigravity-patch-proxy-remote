/**
 * Zero-Config Local Model Detector.
 *
 * Scans local endpoints (Ollama :11434, LM Studio :1234) with lightweight,
 * non-blocking HTTP probes (800ms timeout) to discover locally running models.
 */

import { LOOPBACK_HOSTS, LOCAL_SERVICES } from '../constants';
import * as http from 'http';
import log from 'electron-log';

export interface LocalDiscoveredModel {
  id: string;
  name: string;
  sizeBytes?: number;
}

export interface LocalRunnerInfo {
  type: 'ollama' | 'lmstudio';
  name: string;
  apiUrl: string;
  models: LocalDiscoveredModel[];
}

function probeEndpoint(
  urlStr: string,
  timeoutMs: number = 800
): Promise<{ status: number; body: string } | null> {
  return new Promise((resolve) => {
    try {
      const parsedUrl = new URL(urlStr);
      const req = http.get(
        {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port || 80,
          path: parsedUrl.pathname + parsedUrl.search,
          timeout: timeoutMs,
          headers: {
            Accept: 'application/json',
          },
        },
        (res) => {
          let data = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            data += chunk;
            // Cap response size to prevent memory issues
            if (data.length > 256 * 1024) {
              req.destroy();
              resolve({ status: res.statusCode || 200, body: data });
            }
          });
          res.on('end', () => {
            resolve({ status: res.statusCode || 200, body: data });
          });
        }
      );

      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });

      req.on('error', () => {
        resolve(null);
      });
    } catch {
      resolve(null);
    }
  });
}

/**
 * Detects locally running Ollama instance on http://127.0.0.1:11434
 */
export async function detectOllama(
  baseUrl: string = LOCAL_SERVICES.OLLAMA
): Promise<LocalRunnerInfo | null> {
  try {
    const res = await probeEndpoint(`${baseUrl}/api/tags`);
    if (!res || res.status !== 200) return null;

    const data = JSON.parse(res.body) as { models?: Array<{ name: string; model?: string; size?: number }> };
    if (!data.models || !Array.isArray(data.models)) return null;

    const models: LocalDiscoveredModel[] = data.models.map((m) => ({
      id: m.name || m.model || '',
      name: m.name || m.model || '',
      sizeBytes: m.size,
    })).filter((m) => m.id.length > 0);

    return {
      type: 'ollama',
      name: 'Local Ollama',
      apiUrl: `${baseUrl}/v1/chat/completions`,
      models,
    };
  } catch (err) {
    log.debug('[LocalDetector] Ollama probe error:', err);
    return null;
  }
}

/**
 * Detects locally running LM Studio instance on http://127.0.0.1:1234
 */
export async function detectLMStudio(
  baseUrl: string = LOCAL_SERVICES.LMSTUDIO
): Promise<LocalRunnerInfo | null> {
  try {
    const res = await probeEndpoint(`${baseUrl}/v1/models`);
    if (!res || res.status !== 200) return null;

    const data = JSON.parse(res.body) as { data?: Array<{ id: string }> };
    if (!data.data || !Array.isArray(data.data)) return null;

    const models: LocalDiscoveredModel[] = data.data.map((m) => ({
      id: m.id || '',
      name: m.id || '',
    })).filter((m) => m.id.length > 0);

    return {
      type: 'lmstudio',
      name: 'Local LM Studio',
      apiUrl: `${baseUrl}/v1/chat/completions`,
      models,
    };
  } catch (err) {
    log.debug('[LocalDetector] LM Studio probe error:', err);
    return null;
  }
}

/**
 * Probes all common local runners concurrently and returns all active runners.
 */
export async function detectAllLocalRunners(): Promise<LocalRunnerInfo[]> {
  const results = await Promise.allSettled([
    detectOllama(),
    detectLMStudio(),
  ]);

  const discovered: LocalRunnerInfo[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) {
      discovered.push(r.value);
    }
  }
  return discovered;
}
