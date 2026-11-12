import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { app } from 'electron';
import log from 'electron-log/main';

import * as cryptoStore from '../../cryptoStore';
import { generateModelPlaceholderId } from '../../proxy/models/idGenerator';
import { setLastCustomModelsContentOnDisk } from '../../proxy/models/modelLoader';
import { normalizeCloudCodeModelId, normalizeGoogleModelId } from '../auth/googleAuth';
import {
  CUSTOM_MODEL_MAX_TOKENS,
  CUSTOM_MODEL_MAX_OUTPUT_TOKENS,
  PROVIDERS,
  type ProviderName,
  STANDARD_GOOGLE_MODELS,
  isObsoleteModel,
} from '../../constants';

import {
  loadProviders,
  saveProvidersInternal,
  invalidateProviderStoreCache,
  type ProviderFileEntry,
} from './providerStore';

export { invalidateProviderStoreCache as invalidateModelStoreCache } from './providerStore';

let _writeLock: Promise<void> = Promise.resolve();
export function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
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
  refreshToken?: string;
  projectId?: string;
  [key: string]: unknown;
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

export function readExistingJson(filePath: string): Record<string, unknown> {
  const parsed = tryParseJsonWithBackupFallback<Record<string, unknown>>(filePath);
  return (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
    ? parsed
    : {};
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
      if (!p) continue;
      const hasEnabledAccounts = Array.isArray((p as any).accounts) && (p as any).accounts.some((a: any) => a && a.enabled !== false);
      if (p.enabled === false && !hasEnabledAccounts) continue;
      const accounts = Array.isArray((p as any).accounts) && (p as any).accounts.length > 0
        ? (p as any).accounts
        : [{ id: p.id, apiKey: p.apiKey, refreshToken: p.refreshToken, projectId: p.projectId, enabled: p.enabled }];

      const isGoogle = p.provider === 'google' || p.provider === 'gemini' || p.id === 'provider-google';
      let models = Array.isArray(p.models) && p.models.length > 0 ? p.models : [];
      if (models.length === 0 && isGoogle) {
        const accWithModels = accounts.find((a: any) => Array.isArray(a.models) && a.models.length > 0);
        models = accWithModels ? accWithModels.models : STANDARD_GOOGLE_MODELS;
      }

      for (const acc of accounts) {
        if (acc.enabled === false) continue;
        for (const m of models) {
          if (!m || m.enabled === false) continue;
          if (isObsoleteModel(m.id, m.displayName)) continue;
          const mergedHeaders = { ...p.extraHeaders, ...m.extraHeaders };
          const mergedBody = { ...p.extraBody, ...m.extraBody };

          let extName = m.id || '';
          if (isGoogle && extName) {
            const isCC = Boolean(
              acc.refreshToken ||
              p.refreshToken ||
              (acc.apiKey && acc.apiKey.startsWith('ya29.')) ||
              (p.apiKey && p.apiKey.startsWith('ya29.'))
            );
            if (isCC) {
              extName = normalizeCloudCodeModelId(extName);
            } else {
              extName = normalizeGoogleModelId(extName);
            }
          }

          flatModels.push({
            name: `${p.id || 'provider-unknown'}-${extName}`,
            displayName: m.displayName || m.id,
            provider: p.provider || 'openai',
            apiKey: acc.apiKey || p.apiKey || 'none',
            apiUrl: p.apiUrl || '',
            externalModelName: extName,
            allowUnauthorized: p.allowUnauthorized,
            encrypted: p.encrypted,
            useRawBaseUrl: p.useRawBaseUrl,
            supportsImages: m.supportsImages ?? p.supportsImages ?? true,
            supportsVision: m.supportsVision ?? p.supportsVision ?? true,
            extraHeaders: Object.keys(mergedHeaders).length > 0 ? mergedHeaders : undefined,
            extraBody: Object.keys(mergedBody).length > 0 ? mergedBody : undefined,
            refreshToken: acc.refreshToken || p.refreshToken,
            projectId: acc.projectId || p.projectId,
            tier: (acc as any).tier || (p as any).tier,
            isFamily: Boolean((acc as any).isFamily || (acc as any).isFamilyShared),
            hasClaude55: Boolean((acc as any).hasClaude55),
          });
        }
      }
    }
    return flatModels;
  }

  const filePath = getCustomModelsPath();
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const parsed = tryParseJsonWithBackupFallback<{ models?: CustomModelFileEntry[] }>(filePath, content) || {};
    return parsed.models || [];
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return [];
    }
    const fallback = tryParseJsonWithBackupFallback<{ models?: CustomModelFileEntry[] }>(filePath);
    if (fallback?.models) return fallback.models;
    log.error('[CustomModelStore] Failed to load custom_models.json:', error);
    return [];
  }
}

export async function saveCustomModels(models: CustomModelFileEntry[]): Promise<void> {
  return withWriteLock(async () => {
    invalidateProviderStoreCache();
    const filePath = getCustomModelsPath();
    const existing = readExistingJson(filePath);
    existing.models = models;
    await atomicWriteJson(filePath, existing);
  });
}

export function atomicWriteJson(filePath: string, payload: unknown): Promise<void> {
  return (async () => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    const serialized = JSON.stringify(payload, null, 2);

    // ponytail: Windows NTFS hardware durability via open/write/sync to prevent zero-byte/null-byte corruption
    let written = false;
    try {
      const openFn = (fs as any).open;
      if (typeof openFn === 'function') {
        const handle = await openFn(tmp, 'w');
        try {
          await handle.writeFile(serialized, 'utf-8');
          if (typeof handle.sync === 'function') {
            await handle.sync();
          }
          written = true;
        } finally {
          await handle.close();
        }
      }
    } catch {}

    if (!written) {
      await fs.writeFile(tmp, serialized, 'utf-8');
    }

    // Maintain a valid .bak before replacing target file
    try {
      const existingText = tryReadFileSync(filePath);
      if (existingText && !isCorruptedOrEmpty(existingText)) {
        await fs.writeFile(`${filePath}.bak`, existingText, 'utf-8').catch(() => {});
      }
    } catch {}

    // ponytail: Windows NTFS retry on EPERM/EBUSY caused by active fs.watch or antivirus locks
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        await fs.rename(tmp, filePath);
        try { setLastCustomModelsContentOnDisk(serialized); } catch (_) {}
        return;
      } catch (err: any) {
        if ((err?.code === 'EPERM' || err?.code === 'EBUSY') && attempt < 7) {
          await new Promise((resolve) => setTimeout(resolve, 35 * (attempt + 1)));
          continue;
        }
        try {
          const copyFn = (fs as any).copyFile;
          if (typeof copyFn === 'function') {
            await copyFn(tmp, filePath);
          } else {
            await fs.writeFile(filePath, serialized, 'utf-8');
          }
          const unlinkFn = (fs as any).unlink;
          if (typeof unlinkFn === 'function') {
            await unlinkFn(tmp).catch(() => {});
          }
          try { setLastCustomModelsContentOnDisk(serialized); } catch (_) {}
          return;
        } catch {
          const unlinkFn = (fs as any).unlink;
          if (typeof unlinkFn === 'function') {
            await unlinkFn(tmp).catch(() => {});
          }
          throw err;
        }
      }
    }
  })();
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

    invalidateProviderStoreCache();
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

export function isCorruptedOrEmpty(content: string): boolean {
  if (!content) return true;
  return content.replace(/\0/g, '').trim().length === 0;
}

function tryReadFileSync(filePath: string): string | null {
  try {
    return fsSync.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

export function tryParseJsonWithBackupFallback<T>(filePath: string, rawContent?: string): T | null {
  const bakPath = `${filePath}.bak`;

  if (rawContent !== undefined && !isCorruptedOrEmpty(rawContent)) {
    try {
      return JSON.parse(stripBom(rawContent)) as T;
    } catch {
      // Malformed JSON, proceed to backup recovery
    }
  }

  const primaryContent = rawContent !== undefined ? rawContent : tryReadFileSync(filePath);
  if (primaryContent && !isCorruptedOrEmpty(primaryContent)) {
    try {
      return JSON.parse(stripBom(primaryContent)) as T;
    } catch {
      // Primary corrupted, proceed to backup recovery
    }
  }

  const bakContent = tryReadFileSync(bakPath);
  if (bakContent && !isCorruptedOrEmpty(bakContent)) {
    try {
      const parsed = JSON.parse(stripBom(bakContent)) as T;
      log.warn(`[CustomModelStore] 🛡️ Restored corrupted config at ${filePath} from backup ${bakPath}`);
      return parsed;
    } catch (err) {
      log.error(`[CustomModelStore] Failed to read backup file ${bakPath}:`, err);
    }
  }

  return null;
}

export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

export * from './providerStore';
export * from '../security/apiKeyUtils';
