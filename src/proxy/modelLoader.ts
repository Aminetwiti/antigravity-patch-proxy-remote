/**
 * Custom model loading and management.
 * Handles reading custom_models.json, encryption migration, and validation.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { app } from 'electron';
import log from 'electron-log';
import * as cryptoStore from '../cryptoStore';
import { validateCustomModel } from '../schemaValidator';
import { ALL_PROVIDERS, type ProviderName, LOCAL_SERVICES, STANDARD_GOOGLE_MODELS, isObsoleteModel } from '../constants';
import { generateModelPlaceholderId } from './idGenerator';
import type { CustomModel } from './types';
import {
  normalizeCloudCodeModelId,
  normalizeGoogleModelId,
  isGoogleCloudCodeModel,
  getLiveAccountQuota,
  updateLiveAccountQuota,
} from '../services/googleAuth';

/** Shape of a raw entry in the `providers` array of custom_models.json. */
interface RawProviderEntry {
  id?: string;
  provider?: string;
  apiKey?: string;
  apiUrl?: string;
  allowUnauthorized?: boolean;
  encrypted?: boolean;
  enabled?: boolean;
  useRawBaseUrl?: boolean;
  extraHeaders?: Record<string, string>;
  extraBody?: Record<string, unknown>;
  fallbackModel?: string;
  fallbackChain?: string[] | string;
  supportsImages?: boolean;
  supportsVision?: boolean;
  name?: string;
  email?: string;
  refreshToken?: string;
  projectId?: string;
  quotas?: {
    fiveHourPercentage?: number;
    weeklyPercentage?: number;
    geminiFiveHourPct?: number;
    geminiWeeklyPct?: number;
    claudeFiveHourPct?: number;
    claudeWeeklyPct?: number;
    [key: string]: unknown;
  };
  models?: RawModelEntry[];
}

/** Shape of a raw entry in the `models` array inside a provider. */
interface RawModelEntry {
  id?: string;
  displayName?: string;
  enabled?: boolean;
  supportsImages?: boolean;
  supportsVision?: boolean;
  extraHeaders?: Record<string, string>;
  extraBody?: Record<string, unknown>;
  fallbackModel?: string;
  fallbackChain?: string[] | string;
}


/** Shape of the top-level custom_models.json object. */
interface CustomModelsFile {
  models?: CustomModel[];
  providers?: RawProviderEntry[];
}

/**
 * Returns the absolute path to the custom_models.json file.
 */
export function getCustomModelsPath(): string {
  if (process.env.AG_CUSTOM_MODELS_PATH) {
    return process.env.AG_CUSTOM_MODELS_PATH;
  }
  const homeDir = (app && typeof app.getPath === 'function' && app.getPath('home')) || process.env.USERPROFILE || process.env.HOME || os.homedir();
  const geminiDir = path.join(homeDir, '.gemini', 'antigravity');
  return path.join(geminiDir, 'custom_models.json');
}

/**
 * Returns the default custom models that are written on first run.
 * These are templates the user can customize via the UI.
 */
function getDefaultCustomModels(): CustomModel[] {
  return [
    {
      name: 'models/gpt-4o',
      displayName: 'GPT-4o (OpenAI via Proxy)',
      description: 'OpenAI GPT-4o model redirected through proxy',
      provider: 'openai',
      apiKey: process.env.OPENAI_API_KEY || 'YOUR_OPENAI_API_KEY',
      apiUrl: 'https://api.openai.com/v1/chat/completions',
      externalModelName: 'gpt-4o',
    },
    {
      name: 'models/claude-3-5-sonnet',
      displayName: 'Claude 3.5 Sonnet (Anthropic via Proxy)',
      description: 'Anthropic Claude 3.5 Sonnet model redirected through proxy',
      provider: 'anthropic',
      apiKey: process.env.ANTHROPIC_API_KEY || 'YOUR_ANTHROPIC_API_KEY',
      apiUrl: 'https://api.anthropic.com/v1/messages',
      externalModelName: 'claude-3-5-sonnet-latest',
    },
    {
      name: 'models/llama3',
      displayName: 'Llama 3 (Local Ollama)',
      description: 'Local Ollama Llama 3 model run on your machine',
      provider: 'ollama',
      apiKey: '',
      apiUrl: `${LOCAL_SERVICES.OLLAMA}/v1/chat/completions`,
      externalModelName: 'llama3',
    },
  ];
}

/**
 * Creates the default custom_models.json file on first run.
 */
function createDefaultModelsFile(filePath: string): CustomModel[] {
  const defaultModels = getDefaultCustomModels();
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const encrypted = cryptoStore.encryptModels(defaultModels as unknown as Record<string, unknown>[]);
    fs.writeFileSync(filePath, JSON.stringify({ models: encrypted }, null, 2), 'utf-8');
  } catch (e) {
    log.error('[Proxy] Failed to write default custom_models.json', e);
  }
  return defaultModels;
}

/**
 * Migrates plaintext custom_models.json to encrypted format.
 */
function migrateToEncrypted(filePath: string, models: CustomModel[]): CustomModel[] {
  log.info('[Proxy] Plaintext custom_models.json detected. Migrating to encrypted format...');
  cryptoStore.backupFile(filePath);
  const encryptedModels = cryptoStore.encryptModels(models as unknown as Record<string, unknown>[]);
  try {
    fs.writeFileSync(filePath, JSON.stringify({ models: encryptedModels }, null, 2), 'utf-8');
    log.info('[Proxy] Successfully migrated custom_models.json to encrypted format.');
    return cryptoStore.decryptModels(encryptedModels) as unknown as CustomModel[];
  } catch (err) {
    log.error('[Proxy] Failed to write encrypted custom_models.json during migration:', err);
    return cryptoStore.decryptModels(models as unknown as Record<string, unknown>[]) as unknown as CustomModel[];
  }
}

const loggedObsoleteModels = new Set<string>();
let lastReportedValidationSummary = '';
const globalRemappedLogged = new Set<string>();

/**
 * Validates all models and returns only the valid ones.
 */
function validateModels(decrypted: CustomModel[]): CustomModel[] {
  const validModels: CustomModel[] = [];
  for (let i = 0; i < decrypted.length; i++) {
    const m = decrypted[i];
    const modelKey = m.name || m.externalModelName || `index-${i}`;
    if (isObsoleteModel(m.externalModelName || m.name, m.displayName)) {
      if (!loggedObsoleteModels.has(modelKey)) {
        loggedObsoleteModels.add(modelKey);
        log.info(`[Proxy] Skipping obsolete model: ${modelKey}`);
      }
      continue;
    }
    const provider = m.provider as string;
    if (provider !== 'gemini-cli' && !ALL_PROVIDERS.includes(provider as ProviderName)) {
      log.warn(`[Proxy] Skipping model at index ${i}: Unsupported provider ${provider}. Must be one of: ${ALL_PROVIDERS.join(', ')}`);
      continue;
    }
    const validation = validateCustomModel(m) as { valid: boolean; error?: string };
    if (validation.valid) {
      validModels.push(m);
    } else {
      log.warn(`[Proxy] Skipping invalid model at index ${i}: ${validation.error}`);
    }
  }
  const summaryKey = `${validModels.length}/${decrypted.length}`;
  if (validModels.length < decrypted.length && summaryKey !== lastReportedValidationSummary) {
    lastReportedValidationSummary = summaryKey;
    log.info(
      `[Proxy] Loaded ${validModels.length}/${decrypted.length} valid models (${decrypted.length - validModels.length} skipped)`,
    );
  }
  return validModels;
}

export function parseProvidersSchema(providers: RawProviderEntry[]): CustomModel[] {
  const flatModels: CustomModel[] = [];
  for (const p of providers) {
    const hasEnabledAccounts = Array.isArray((p as any).accounts) && (p as any).accounts.some((a: any) => a && a.enabled !== false);
    if (p.enabled === false && !hasEnabledAccounts) continue;

    const accounts = Array.isArray((p as any).accounts) && (p as any).accounts.length > 0
      ? (p as any).accounts
      : [{ id: p.id, name: p.name, email: p.email, apiKey: p.apiKey, refreshToken: p.refreshToken, quotas: p.quotas, projectId: p.projectId, enabled: p.enabled }];

    const isGeminiCli = p.provider === 'gemini-cli' || p.id === 'gemini-cli-preset' || p.id === 'gemini-cli';
    const isGoogle = p.provider === 'google' || p.provider === 'gemini' || p.id === 'provider-google' || isGeminiCli;
    let models = Array.isArray(p.models) && p.models.length > 0 ? p.models : [];
    if (models.length === 0 && isGoogle) {
      const accWithModels = accounts.find((a: any) => Array.isArray(a.models) && a.models.length > 0);
      models = accWithModels ? accWithModels.models : STANDARD_GOOGLE_MODELS;
    }

    const disabledProviderModelIds = new Set<string>();
    if (isGoogle && Array.isArray(p.models)) {
      for (const pm of p.models) {
        if (pm && pm.enabled === false && pm.id) {
          disabledProviderModelIds.add(pm.id);
          const norm = normalizeCloudCodeModelId(pm.id);
          if (norm) disabledProviderModelIds.add(norm);
        }
      }
    }

    for (const acc of accounts) {
      if (acc.enabled === false) continue;
      const accEmail = (acc.email || (acc as any).accountEmail || '').trim().toLowerCase();
      if (isGoogle && accEmail && (acc as any).quotas) {
        const prefix = isGeminiCli ? 'gemini-cli' : 'google';
        const accKey = `${prefix}:${accEmail}`;
        if (!getLiveAccountQuota(accKey)) {
          updateLiveAccountQuota(accKey, (acc as any).quotas);
        }
      }
      const targetModels = Array.isArray((acc as any).models) && (acc as any).models.length > 0 ? (acc as any).models : models;
      for (const rawM of targetModels) {
        const m = typeof rawM === 'string' ? { id: rawM, displayName: '', enabled: true } : rawM;
        if (m.enabled === false) continue;
        const mId = m.id ?? '';
        const normMId = isGoogle ? normalizeCloudCodeModelId(mId) : '';
        if (disabledProviderModelIds.has(mId) || (normMId && disabledProviderModelIds.has(normMId))) continue;
        if (isObsoleteModel(mId, m.displayName)) continue;
        if (isGeminiCli && (mId.includes('gemini-2') || mId.includes('gemini-3.1') || mId.includes('gemini-3.0') || mId.includes('gemini-1'))) {
          continue;
        }
        const mergedHeaders = { ...p.extraHeaders, ...(m as { extraHeaders?: Record<string, string> }).extraHeaders };
        const mergedBody = { ...p.extraBody, ...(m as { extraBody?: Record<string, unknown> }).extraBody };

        let displayName = m.displayName ?? '';
        if (!displayName || displayName === mId || displayName.includes('-tiered')) {
          const norm = normalizeCloudCodeModelId(mId);
          if (norm === 'gemini-3.8-flash-tiered') displayName = 'Gemini 3.8 Flash';
          else if (norm === 'gemini-3.7-flash-tiered') displayName = 'Gemini 3.7 Flash';
          else if (norm === 'gemini-3.6-flash-tiered') displayName = 'Gemini 3.6 Flash';
          else if (norm === 'claude-sonnet-4-6') displayName = 'Claude Sonnet 4.6 (Thinking)';
          else if (norm === 'claude-opus-4-6-thinking') displayName = 'Claude Opus 4.6 (Thinking)';
          else displayName = mId;
        }

        const accProvider = (acc as any).provider || (p.provider ?? 'openai');
        const isEffectiveGeminiCli = isGeminiCli || accProvider === 'gemini-cli';
        const accApiUrl = (acc as any).apiUrl as string | undefined;
        const isAiStudio = accProvider === 'google-gemini' || (Boolean(acc.apiKey) && (String(acc.apiKey).startsWith('AIzaSy') || String(acc.apiKey).startsWith('AQ.')) && !acc.refreshToken);

        // Google AI Studio does not support Claude models
        const isClaude = mId.includes('claude') || displayName.toLowerCase().includes('claude');
        if (isAiStudio && isClaude) {
          continue;
        }

        const isCloudCode = !isAiStudio && isGoogle;
        const resolvedProvider = isAiStudio ? 'google-gemini' : (isEffectiveGeminiCli ? 'gemini-cli' : accProvider);
        const resolvedApiUrl = isAiStudio
          ? (accApiUrl || (p.apiUrl?.includes('generativelanguage') ? p.apiUrl : 'https://generativelanguage.googleapis.com/v1beta'))
          : (isEffectiveGeminiCli
              ? (accApiUrl || (p.apiUrl?.includes('cloudcode') ? p.apiUrl : 'https://cloudcode-pa.googleapis.com/v1internal'))
              : (isCloudCode ? (accApiUrl || (p.apiUrl?.includes('cloudcode') ? p.apiUrl : 'https://daily-cloudcode-pa.googleapis.com')) : (accApiUrl || p.apiUrl || '')));

        const partialModel: CustomModel = {
          name: m.id ?? '',
          displayName,
          description: (m as { description?: string }).description ?? '',
          provider: resolvedProvider as ProviderName,
          apiKey: acc.apiKey ?? p.apiKey ?? 'none',
          apiUrl: resolvedApiUrl,
          externalModelName: m.id ?? '',
          allowUnauthorized: p.allowUnauthorized,
          encrypted: p.encrypted,
          useRawBaseUrl: p.useRawBaseUrl,
          fallbackModel: m.fallbackModel ?? p.fallbackModel,
          fallbackChain: m.fallbackChain ?? p.fallbackChain,
          supportsImages: m.supportsImages ?? p.supportsImages ?? true,
          supportsVision: m.supportsVision ?? p.supportsVision ?? true,
          extraHeaders: Object.keys(mergedHeaders).length > 0 ? mergedHeaders : undefined,
          extraBody: Object.keys(mergedBody).length > 0 ? mergedBody : undefined,
          accountName: acc.name || p.name,
          accountEmail: acc.email || p.email,
          refreshToken: acc.refreshToken || p.refreshToken,
          projectId: isEffectiveGeminiCli
            ? (acc.projectId && acc.projectId !== 'aicode-consumers' ? acc.projectId : 'gemini-cli-users')
            : (acc.projectId || p.projectId),
          quotas: acc.quotas || p.quotas,
          _poolOnly: (isAiStudio || isGeminiCli) ? true : undefined,
        };
      const placeholderId = generateModelPlaceholderId(partialModel);

      flatModels.push({
        ...partialModel,
        name: `models/${placeholderId}`,
      });
      }
    }
  }
  const decrypted = cryptoStore.decryptModels(flatModels as unknown as Record<string, unknown>[]) as unknown as CustomModel[];
  return validateModels(decrypted);
}

/**
 * Parses and decrypts the legacy `models` JSON schema format.
 */
function parseModelsSchema(models: CustomModel[], filePath: string): CustomModel[] {
  const needsMigration = models.some(
    (m) =>
      !m.encrypted &&
      m.apiKey &&
      m.apiKey !== 'none' &&
      !m.apiKey.startsWith('enc:') &&
      !m.apiKey.startsWith('fallback:'),
  );
  if (needsMigration) {
    return migrateToEncrypted(filePath, models);
  }

  const decrypted = cryptoStore.decryptModels(models as unknown as Record<string, unknown>[]) as unknown as CustomModel[];
  return validateModels(decrypted);
}

/**
 * Loads custom models from disk, handling first-run defaults,
 * encryption migration, and validation.
 */
export function loadCustomModels(): CustomModel[] {
  const filePath = getCustomModelsPath();

  if (!fs.existsSync(filePath)) {
    return createDefaultModelsFile(filePath);
  }

  try {
    let content = fs.readFileSync(filePath, 'utf-8');
    // Strip UTF-8 BOM if present
    if (content.charCodeAt(0) === 0xFEFF) {
      content = content.slice(1);
    }
    const parsed = JSON.parse(content) as CustomModelsFile;

    let loadedModels: CustomModel[] = [];
    if (parsed.providers && Array.isArray(parsed.providers)) {
      loadedModels = parseProvidersSchema(parsed.providers);
    } else {
      const models = parsed.models || [];
      loadedModels = parseModelsSchema(models, filePath);
    }
    loadedModels = loadedModels.filter(m => !isObsoleteModel(m.externalModelName || m.name, m.displayName));

    // Auto-remap unhosted Google model IDs so stale saved configs on disk are cleaned up in memory and updated
    for (const m of loadedModels) {
      if (m.provider === 'google' || isGoogleCloudCodeModel(m)) {
        const rawName = (m.externalModelName || m.name || '').replace(/^models\//, '').trim();
        if (rawName) {
          const norm = isGoogleCloudCodeModel(m)
            ? normalizeCloudCodeModelId(rawName)
            : normalizeGoogleModelId(rawName);
          if (norm && norm !== rawName) {
            const remapKey = `${rawName}->${norm}`;
            if (!globalRemappedLogged.has(remapKey)) {
              globalRemappedLogged.add(remapKey);
              log.debug(`[ModelLoader] Auto-remapped unhosted/alias Google model ID '${rawName}' to '${norm}'`);
            }
            m.externalModelName = norm;
            if (m.name && (m.name === rawName || m.name === `models/${rawName}`)) {
              m.name = `models/${norm}`;
            }
          }
        }
      }
    }

    // For all Google family models (both Cloud Code OAuth accounts and Google AI Studio API key accounts):
    // collapse to ONE unified pooled entry per unique canonical model in the Antigravity dropdown.
    // The backend proxy dispatches across all accounts and handles fallbacks automatically.
    const isGoogleFamily = (m: CustomModel) =>
      (m.provider === 'google' || m.provider === 'google-gemini' || m.provider === 'gemini' || m.provider === 'gemini-cli') &&
      (Boolean(m.apiKey) || Boolean(m.refreshToken)) &&
      !m.apiKey.startsWith('fallback:');

    const googleFamilyModels = loadedModels.filter(isGoogleFamily);
    const otherModels = loadedModels.filter(m => !isGoogleFamily(m));

    const seenBaseIds = new Map<string, CustomModel>();
    for (const m of googleFamilyModels) {
      const raw = (m.externalModelName || m.name || '').replace(/^models\//, '');
      const baseId = normalizeCloudCodeModelId(raw);
      if (!seenBaseIds.has(baseId)) {
        seenBaseIds.set(baseId, m);
      }
    }

    const pooledGoogleModels: CustomModel[] = [];
    seenBaseIds.forEach((template, baseId) => {
      let displayName = template.displayName || baseId;
      displayName = displayName.replace(/^\[[^\]]+\]\s*/, '');
      if (baseId === 'gemini-3.8-flash-tiered' && (displayName === baseId || displayName.includes('-tiered'))) displayName = 'Gemini 3.8 Flash';
      if (baseId === 'gemini-3.7-flash-tiered' && (displayName === baseId || displayName.includes('-tiered'))) displayName = 'Gemini 3.7 Flash';
      if (baseId === 'gemini-3.6-flash-tiered' && (displayName === baseId || displayName.includes('-tiered'))) displayName = 'Gemini 3.6 Flash';
      if (baseId === 'claude-sonnet-4-6' && (displayName === baseId || displayName.includes('-4-6'))) displayName = 'Claude Sonnet 4.6 (Thinking)';
      if (baseId === 'claude-opus-4-6-thinking' && (displayName === baseId || displayName.includes('-4-6'))) displayName = 'Claude Opus 4.6 (Thinking)';

      pooledGoogleModels.push({
        ...template,
        provider: 'google',
        name: `models/google:${baseId}:auto-pool`,
        displayName,
        externalModelName: baseId,
        apiUrl: 'https://daily-cloudcode-pa.googleapis.com',
        apiKey: 'auto',
        refreshToken: undefined,
        accountName: '',
        accountEmail: '',
        _effortSuffix: template._effortSuffix || '',
      });
    });

    // Mark ALL real per-account entries (both Cloud Code and AI Studio) as dispatch-only (hidden from dropdown)
    const realGoogleModels = googleFamilyModels.map(m => ({ ...m, _poolOnly: true as const }));

    return [...pooledGoogleModels, ...realGoogleModels, ...otherModels];
  } catch (e) {
    log.error('[Proxy] Failed to parse custom_models.json (preserving file on disk):', e);
    return [];
  }
}

/**
 * Returns set of IDs and labels for models explicitly marked enabled: false in custom_models.json.
 */
export function loadDisabledModelIds(): Set<string> {
  const disabled = new Set<string>();
  const fp = getCustomModelsPath();
  try {
    if (!fs.existsSync(fp)) return disabled;
    const content = fs.readFileSync(fp, 'utf8').replace(/^\uFEFF/, '');
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed.providers)) {
      for (const p of parsed.providers) {
        if (!p) continue;
        if (Array.isArray(p.models)) {
          for (const m of p.models) {
            if (m && m.enabled === false && m.id) {
              const id = m.id.trim().toLowerCase();
              disabled.add(id);
              disabled.add(id.replace(/^models\//, ''));
              const norm = normalizeCloudCodeModelId(id);
              if (norm) disabled.add(norm.toLowerCase());
              if (m.displayName) {
                disabled.add(m.displayName.trim().toLowerCase());
              }
            }
          }
        }
      }
    }
  } catch {}
  return disabled;
}
