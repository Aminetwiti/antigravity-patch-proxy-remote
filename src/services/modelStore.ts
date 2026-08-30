import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { app } from 'electron';
import log from 'electron-log/main';

import * as cryptoStore from '../cryptoStore';
import { generateModelPlaceholderId } from '../proxy/idGenerator';
import {
  CUSTOM_MODEL_MAX_TOKENS,
  CUSTOM_MODEL_MAX_OUTPUT_TOKENS,
  PROVIDERS,
  type ProviderName,
} from '../constants';

let _writeLock: Promise<void> = Promise.resolve();
function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = _writeLock.then(() => fn(), () => fn());
  _writeLock = next.then(() => undefined, () => undefined);
  return next;
}

export interface CustomModelFileEntry {
  name: string;
  displayName?: string;
  description?: string;
  provider: string;
  apiKey: string;
  apiUrl: string;
  externalModelName: string;
  allowUnauthorized?: boolean;
  encrypted?: boolean;
  useRawBaseUrl?: boolean;
  extraHeaders?: Record<string, string>;
  extraBody?: Record<string, unknown>;
  [key: string]: unknown;
}

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
  extraHeaders?: Record<string, string>;
  extraBody?: Record<string, unknown>;
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
  useRawBaseUrl?: boolean;
  extraHeaders?: Record<string, string>;
  extraBody?: Record<string, unknown>;
  models: ProviderModelEntry[];
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

export function invalidateModelStoreCache(): void {
  _providersCache = null;
  _providersCacheTime = 0;
}

export function getCustomModelsPath(): string {
  const geminiDir = path.join(app.getPath('home'), '.gemini', 'antigravity');
  return path.join(geminiDir, 'custom_models.json');
}

export async function loadCustomModels(): Promise<CustomModelFileEntry[]> {
  const providers = await loadProviders();
  if (providers && providers.length > 0) {
    const flatModels: CustomModelFileEntry[] = [];
    for (const p of providers) {
      if (!p || p.enabled === false) continue;
      const models = Array.isArray(p.models) ? p.models : [];
      for (const m of models) {
        if (!m || m.enabled === false) continue;
        const mergedHeaders = { ...p.extraHeaders, ...m.extraHeaders };
        const mergedBody = { ...p.extraBody, ...m.extraBody };

        flatModels.push({
          name: `${p.id || 'provider-unknown'}-${m.id}`,
          displayName: m.displayName || m.id,
          provider: p.provider || 'openai',
          apiKey: p.apiKey || 'none',
          apiUrl: p.apiUrl || '',
          externalModelName: m.id,
          allowUnauthorized: p.allowUnauthorized,
          encrypted: p.encrypted,
          useRawBaseUrl: p.useRawBaseUrl,
          extraHeaders: Object.keys(mergedHeaders).length > 0 ? mergedHeaders : undefined,
          extraBody: Object.keys(mergedBody).length > 0 ? mergedBody : undefined,
        });
      }
    }
    return flatModels;
  }

  const filePath = getCustomModelsPath();
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(stripBom(content)) as { models?: CustomModelFileEntry[] };
    return parsed.models || [];
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return [];
    }
    log.error('[CustomModelStore] Failed to load custom_models.json:', error);
    return [];
  }
}

export async function saveCustomModels(models: CustomModelFileEntry[]): Promise<void> {
  return withWriteLock(async () => {
    invalidateModelStoreCache();
    const filePath = getCustomModelsPath();
    const existing = readExistingJson(filePath);
    existing.models = models;
    await atomicWriteJson(filePath, existing);
  });
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
    const parsed = JSON.parse(stripBom(content)) as { models?: CustomModelFileEntry[], providers?: ProviderFileEntry[] };

    if (parsed.providers) {
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

function atomicWriteJson(filePath: string, payload: unknown): Promise<void> {
  return (async () => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(payload, null, 2), 'utf-8');
    await fs.rename(tmp, filePath);
  })();
}

function readExistingJson(filePath: string): Record<string, unknown> {
  try {
    const content = fsSync.readFileSync(filePath, 'utf-8');
    return JSON.parse(stripBom(content)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function saveProvidersInternal(providers: ProviderFileEntry[]): Promise<void> {
  invalidateModelStoreCache();
  const filePath = getCustomModelsPath();
  const existing = readExistingJson(filePath);
  existing.providers = providers;
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

export async function deleteCustomModel(modelName: string): Promise<void> {
  return withWriteLock(async () => {
    const providers = await loadProviders();
    let mutated = false;
    const cleanName = modelName.startsWith('models/') ? modelName.slice(7) : modelName;

    for (const p of providers) {
      if (!p || !Array.isArray(p.models)) continue;
      const prefix = `${p.id}-`;
      const stripped = cleanName.startsWith(prefix) ? cleanName.slice(prefix.length) : cleanName;
      const before = p.models.length;

      p.models = p.models.filter((m) => {
        if (!m) return false;
        const placeholderId = generateModelPlaceholderId({
          name: m.id,
          displayName: m.displayName || m.id,
          description: (m as any).description || '',
          provider: (p.provider ?? 'openai') as ProviderName,
          apiKey: p.apiKey ?? '',
          apiUrl: p.apiUrl ?? '',
          externalModelName: m.id,
        });

        const isMatch =
          m.id === modelName ||
          m.displayName === modelName ||
          m.id === cleanName ||
          m.displayName === cleanName ||
          m.id === stripped ||
          m.displayName === stripped ||
          placeholderId === cleanName ||
          placeholderId === stripped ||
          `MODEL_PLACEHOLDER_${placeholderId}` === cleanName;

        return !isMatch;
      });

      if (p.models.length !== before) {
        mutated = true;
      }
    }

    if (mutated) {
      await saveProvidersInternal(providers);
    }

    invalidateModelStoreCache();
    const filePath = getCustomModelsPath();
    const existing = readExistingJson(filePath);
    if (Array.isArray(existing.models)) {
      existing.models = existing.models.filter(
        (model: { name?: string }) => model.name !== modelName && model.name !== cleanName
      );
    }
    await atomicWriteJson(filePath, existing);
  });
}

export function maskApiKey(encryptedKey: string): string {
  if (!encryptedKey || encryptedKey === 'none') {
    return encryptedKey;
  }

  try {
    const decrypted = cryptoStore.decryptString(encryptedKey) as string;
    if (decrypted.length <= 8) {
      return '********';
    }
    return `${decrypted.slice(0, 4)}...${decrypted.slice(-4)}`;
  } catch {
    if (encryptedKey.length <= 8) {
      return '********';
    }
    return `${encryptedKey.slice(0, 4)}...${encryptedKey.slice(-4)}`;
  }
}

export function encryptApiKeyIfNeeded(apiKey: string | undefined): {
  apiKey: string;
  encrypted: boolean;
} {
  if (!apiKey || apiKey === 'none' || isMaskedApiKey(apiKey)) {
    return { apiKey: apiKey ?? 'none', encrypted: false };
  }
  return {
    apiKey: cryptoStore.encryptString(apiKey),
    encrypted: true,
  };
}

export function buildFallbackModelEntry(model: CustomModelFileEntry): FallbackModelEntry {
  return {
    name: model.name,
    displayName: model.displayName ?? model.name,
    version: model.name,
    description: model.description ?? `Custom ${model.provider} model`,
    inputTokenLimit: CUSTOM_MODEL_MAX_TOKENS,
    outputTokenLimit: CUSTOM_MODEL_MAX_OUTPUT_TOKENS,
    supportedGenerationMethods: ['generateContent', 'countTokens'],
    apiProvider: model.provider === PROVIDERS.GOOGLE ? 'API_PROVIDER_GOOGLE_GEMINI' : 'API_PROVIDER_CUSTOM',
  };
}

function stripBom(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

export function isMaskedApiKey(key: string): boolean {
  if (!key) return false;
  if (key === '********') return true;
  return /^[A-Za-z0-9_-]{4}\.\.\.[A-Za-z0-9_-]{4}$/.test(key);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
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
