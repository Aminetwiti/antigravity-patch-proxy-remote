import * as fs from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';
import log from 'electron-log/main';
import * as cryptoStore from '../security/cryptoStore';
import { isMaskedApiKey, maskApiKey } from '../security/apiKeyUtils';
import { isObsoleteModel } from '../../constants';
import {
  type CustomModelFileEntry,
  atomicWriteJson,
  withWriteLock,
  tryParseJsonWithBackupFallback,
  getCustomModelsPath,
  invalidateModelStoreCache,
  readExistingJson,
  isNodeError,
} from './modelStore';

export interface TestModelParams {
  apiUrl: string;
  provider: string;
  apiKey?: string;
  allowUnauthorized?: boolean;
}

export interface ConnectionTestResult {
  success: boolean;
  status?: number;
  message?: string;
  error?: string;
  latencyMs?: number;
}

export interface FallbackModelEntry {
  name: string;
  displayName: string;
  version: string;
  description: string;
  inputTokenLimit: number;
  outputTokenLimit: number;
  supportedGenerationMethods: string[];
  apiProvider: string;
}

export interface ProviderModelEntry {
  id: string;
  displayName?: string;
  enabled: boolean;
  supportsImages?: boolean;
  supportsVision?: boolean;
  extraHeaders?: Record<string, string>;
  extraBody?: Record<string, unknown>;
  fallbackModel?: string;
  fallbackChain?: string[] | string;
}

export interface ProviderFileEntry {
  id: string;
  name: string;
  provider: string;
  apiUrl: string;
  apiKey: string;
  allowUnauthorized?: boolean;
  encrypted?: boolean;
  enabled: boolean;
  supportsImages?: boolean;
  supportsVision?: boolean;
  useRawBaseUrl?: boolean;
  extraHeaders?: Record<string, string>;
  extraBody?: Record<string, unknown>;
  fallbackModel?: string;
  fallbackChain?: string[] | string;
  refreshToken?: string;
  projectId?: string;
  models: ProviderModelEntry[];
  accounts?: Array<Record<string, unknown>>;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalRequests: number;
    lastUsed?: number;
  };
}

let _providersCache: ProviderFileEntry[] | null = null;
let _providersCacheTime = 0;
let _providersCacheMtime = 0;
const CACHE_TTL_MS = 60_000;

export function invalidateProviderStoreCache(): void {
  _providersCache = null;
  _providersCacheTime = 0;
}

export async function loadProviders(): Promise<ProviderFileEntry[]> {
  const now = Date.now();
  const filePath = getCustomModelsPath();
  try {
    const stat = await fs.stat(filePath);
    if (_providersCache && stat.mtimeMs > _providersCacheMtime) {
      _providersCache = null;
    }
  } catch {
    _providersCache = null;
  }
  if (!process.env.VITEST && _providersCache && now - _providersCacheTime < CACHE_TTL_MS) {
    return _providersCache;
  }
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const parsed = tryParseJsonWithBackupFallback<{ models?: CustomModelFileEntry[], providers?: ProviderFileEntry[] }>(filePath, content) || {};

    if (parsed.providers) {
      for (const p of parsed.providers) {
        const isGoogle = p.provider === 'google' || p.provider === 'gemini' || p.id === 'provider-google';
        if (isGoogle && Array.isArray(p.models)) {
          p.models = p.models.filter((m: any) => m && !isObsoleteModel(m.id || m.name, m.displayName));
        }
        if (isGoogle && Array.isArray(p.accounts)) {
          for (const acc of p.accounts) {
            if (Array.isArray((acc as any).models)) {
              (acc as any).models = (acc as any).models.filter((m: any) => m && !isObsoleteModel(m.id || m.name, m.displayName));
            }
          }
        }
      }
      _providersCache = parsed.providers;
      _providersCacheTime = now;
      try {
        const s = await fs.stat(filePath);
        _providersCacheMtime = s.mtimeMs;
      } catch {
        _providersCacheMtime = now;
      }
      return _providersCache;
    }

    if (parsed.models && parsed.models.length > 0) {
       log.info('[CustomModelStore] Migrating legacy models to providers architecture');
       const providerMap = new Map<string, ProviderFileEntry>();
       let pId = 1;
       for (const m of parsed.models) {
         const pKey = m.apiUrl + '|' + m.provider + '|' + m.apiKey;
         if (!providerMap.has(pKey)) {
            providerMap.set(pKey, {
              id: `provider-${Date.now()}-${pId++}`,
              name: `Legacy ${m.provider}`,
              provider: m.provider,
              apiUrl: m.apiUrl,
              apiKey: m.apiKey,
              allowUnauthorized: m.allowUnauthorized,
              encrypted: m.encrypted,
              enabled: true,
              models: []
            });
         }
         const p = providerMap.get(pKey)!;
         p.models.push({
            id: m.externalModelName || m.name,
            displayName: m.displayName || m.name,
            enabled: true
         });
       }
       const migratedProviders = Array.from(providerMap.values());
       return migratedProviders;
    }
    return [];
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return [];
    log.error('[CustomModelStore] Failed to load providers:', error);
    return [];
  }
}


export async function saveProvidersInternal(providers: ProviderFileEntry[]): Promise<void> {
  invalidateModelStoreCache();
  const filePath = getCustomModelsPath();
  const existing = readExistingJson(filePath);
  existing.providers = providers;
  delete existing.models;
  await atomicWriteJson(filePath, existing);
}

export async function saveProviders(providers: ProviderFileEntry[]): Promise<void> {
  return withWriteLock(() => saveProvidersInternal(providers));
}

export async function recordProviderUsage(providerId: string, promptTokens: number = 0, completionTokens: number = 0): Promise<void> {
  return withWriteLock(async () => {
    try {
      const providers = await loadProviders();
      const target = providers.find((p) => p.id === providerId || `provider-${p.id}` === providerId);
      if (!target) return;

      if (!target.usage) {
        target.usage = { promptTokens: 0, completionTokens: 0, totalRequests: 0 };
      }
      target.usage.promptTokens += Math.max(0, promptTokens);
      target.usage.completionTokens += Math.max(0, completionTokens);
      target.usage.totalRequests += 1;
      target.usage.lastUsed = Date.now();

      await saveProvidersInternal(providers);
    } catch (err) {
      log.error('[CustomModelStore] Failed to record provider usage:', err);
    }
  });
}


export async function testProviderHealth(params: TestModelParams): Promise<ConnectionTestResult> {
  const { apiUrl, apiKey, allowUnauthorized } = params;
  if (!apiUrl) {
    return { success: false, error: 'API URL is required' };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(apiUrl);
  } catch (err) {
    return { success: false, error: `Invalid API URL: ${(err as Error).message}` };
  }

  const startTime = Date.now();
  const protocol = parsedUrl.protocol === 'https:' ? require('https') : require('http');

  const headers: Record<string, string> = {
    'User-Agent': 'Antigravity-HealthProbe/2.2',
  };

  let rawKey = apiKey;
  if (rawKey && rawKey !== 'none' && !isMaskedApiKey(rawKey)) {
    try {
      rawKey = cryptoStore.decryptString(rawKey);
    } catch {
      // If decryption fails, keep rawKey as is
    }
    headers['Authorization'] = `Bearer ${rawKey}`;
  }

  return new Promise((resolve) => {
    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers,
      timeout: 10_000,
      rejectUnauthorized: !allowUnauthorized,
    };

    const req = protocol.request(reqOptions, (res: import('http').IncomingMessage) => {
      const latencyMs = Date.now() - startTime;
      const status = res.statusCode || 0;
      const isReachable = status > 0 && status < 500;

      resolve({
        success: isReachable,
        status,
        latencyMs,
        message: isReachable
          ? `Server reachable (${status}), latency: ${latencyMs}ms`
          : `HTTP error ${status} (${res.statusMessage || 'Upstream Error'})`,
      });
    });

    req.on('error', (err: Error) => {
      const latencyMs = Date.now() - startTime;
      resolve({
        success: false,
        latencyMs,
        error: `Connection failed: ${err.message}`,
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        success: false,
        latencyMs: Date.now() - startTime,
        error: 'Health check timed out after 10s',
      });
    });

    req.end();
  });
}

export const testModelConnection = testProviderHealth;
