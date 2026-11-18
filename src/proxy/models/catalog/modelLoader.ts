/**
 * Custom model loading and management.
 * Handles reading custom_models.json, encryption migration, and validation.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { app } from 'electron';
import log from 'electron-log';
import * as cryptoStore from '../../../compat/cryptoStore';
import { validateCustomModel } from '../../../shared/schemaValidator';
import { ALL_PROVIDERS, type ProviderName, LOCAL_SERVICES, STANDARD_GOOGLE_MODELS, isObsoleteModel, PROVIDERS } from '../../../constants';
import { generateModelPlaceholderId } from './idGenerator';
import type { CustomModel } from '../../core/types';
import {
  normalizeCloudCodeModelId,
  normalizeGoogleModelId,
  isGoogleCloudCodeModel,
  getLiveAccountQuota,
  updateLiveAccountQuota,
} from '../../../services/auth/googleAuth';

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

let _lastCustomModelsContentOnDisk = '';

export function getLastCustomModelsContentOnDisk(): string {
  return _lastCustomModelsContentOnDisk;
}

export function setLastCustomModelsContentOnDisk(content: string): void {
  _lastCustomModelsContentOnDisk = content;
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

export function parseProvidersSchema(providers: RawProviderEntry[], includeDisabled = false): CustomModel[] {
  const flatModels: CustomModel[] = [];
  for (const p of providers) {
    const hasEnabledAccounts = Array.isArray((p as any).accounts) && (p as any).accounts.some((a: any) => a && a.enabled !== false);
    if (p.enabled === false && !hasEnabledAccounts && !includeDisabled) continue;

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
    const enabledProviderModelIds = new Set<string>();
    if (isGoogle && Array.isArray(p.models)) {
      for (const pm of p.models) {
        if (pm && pm.id) {
          const norm = normalizeCloudCodeModelId(pm.id);
          if (pm.enabled === false) {
            disabledProviderModelIds.add(pm.id);
            if (norm) disabledProviderModelIds.add(norm);
          } else {
            enabledProviderModelIds.add(pm.id);
            if (norm) enabledProviderModelIds.add(norm);
          }
        }
      }
    }

    for (const acc of accounts) {
      if (acc.enabled === false && !includeDisabled) continue;
      const accEmail = (acc.email || (acc as any).accountEmail || '').trim().toLowerCase();
      if (isGoogle && accEmail && (acc as any).quotas) {
        const prefix = isGeminiCli ? 'gemini-cli' : 'google';
        const accKey = `${prefix}:${accEmail}`;
        if (!getLiveAccountQuota(accKey)) {
          updateLiveAccountQuota(accKey, (acc as any).quotas);
        }
      }
      const accModelsList = Array.isArray((acc as any).models) && (acc as any).models.length > 0 ? (acc as any).models : [];
      const hasExplicitAccountModels = accModelsList.length > 0;
      let targetModels: any[];
      if (accModelsList.length === 0) {
        targetModels = models;
      } else {
        const seenIds = new Set(accModelsList.map((m: any) => (typeof m === 'string' ? m : m?.id || '')));
        const missingFromProvider = (models || []).filter((pm: any) => {
          const pmId = typeof pm === 'string' ? pm : pm?.id || '';
          return pmId && !seenIds.has(pmId);
        });
        targetModels = [...accModelsList, ...missingFromProvider];
      }
      for (const rawM of targetModels) {
        const m = typeof rawM === 'string' ? { id: rawM, displayName: '', enabled: true } : rawM;
        const mId = m.id ?? '';
        const normMId = isGoogle ? normalizeCloudCodeModelId(mId) : '';
        const isExplicitlyEnabledAtProvider = enabledProviderModelIds.has(mId) || (Boolean(normMId) && enabledProviderModelIds.has(normMId));
        if (m.enabled === false && !isExplicitlyEnabledAtProvider && !includeDisabled) continue;
        if (!hasExplicitAccountModels && (disabledProviderModelIds.has(mId) || (normMId && disabledProviderModelIds.has(normMId))) && !includeDisabled) continue;
        if (isObsoleteModel(mId, m.displayName)) continue;
        if (isGeminiCli && (mId.includes('gemini-2') || mId.includes('gemini-3.1') || mId.includes('gemini-3.0') || mId.includes('gemini-1'))) {
          continue;
        }
        const mergedHeaders = { ...p.extraHeaders, ...(m as { extraHeaders?: Record<string, string> }).extraHeaders };
        const mergedBody = { ...p.extraBody, ...(m as { extraBody?: Record<string, unknown> }).extraBody };

        let displayName = m.displayName ?? '';
        if (!displayName || displayName === mId || displayName.includes('-tiered') || displayName === 'gemini-4-hydrogen-sonar') {
          const norm = normalizeCloudCodeModelId(mId);
          if (norm === 'gemini-3.8-flash-tiered') displayName = 'Gemini 3.8 Flash';
          else if (norm === 'claude-sonnet-4-6') displayName = 'Claude Sonnet 4.6 (Thinking)';
          else if (norm === 'claude-opus-4-6-thinking') displayName = 'Claude Opus 4.6 (Thinking)';
          else if (mId === 'gemini-4-hydrogen-sonar' || norm === 'gemini-4-hydrogen-sonar') displayName = 'Gemini 4 Hydrogen (Sonar)';
          else if (mId === 'gemini-4-hydrogen' || norm === 'gemini-4-hydrogen') displayName = 'Gemini 4 Hydrogen';
          else displayName = mId;
        }

        const accProvider = (acc as any).provider || (p.provider ?? 'openai');
        const isEffectiveGeminiCli = isGeminiCli || accProvider === 'gemini-cli';
        const accApiUrl = (acc as any).apiUrl as string | undefined;
        const isAiStudio = accProvider === 'google-gemini' || (Boolean(acc.apiKey) && (String(acc.apiKey).startsWith('AIzaSy') || String(acc.apiKey).startsWith('AQ')) && !acc.refreshToken);

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
              : (isCloudCode
                  ? ((accApiUrl && !accApiUrl.includes('generativelanguage') && !accApiUrl.includes('cloudcode-pa.googleapis.com'))
                      ? accApiUrl
                      : (p.apiUrl?.includes('cloudcode') && !p.apiUrl.includes('cloudcode-pa.googleapis.com') ? p.apiUrl : 'https://daily-cloudcode-pa.googleapis.com'))
                  : (accApiUrl || p.apiUrl || '')));

        const isAccountExplicitlyDisabled = acc.enabled === false || m.enabled === false || p.enabled === false;
        const accountStatus = (acc as any).status || (p as any).status;
        const isValReq = Boolean(
          (acc as any).isValidationRequired ||
          (acc as any).status === 'validation_required' ||
          (acc as any).errorDetails?.status === 'VALIDATION_REQUIRED' ||
          (p as any).isValidationRequired ||
          (p as any).status === 'validation_required'
        );
        const isUnlic = Boolean((acc as any).isUnlicensed || (p as any).isUnlicensed);

        const partialModel: CustomModel = {
          name: m.id ?? '',
          displayName,
          description: (m as { description?: string }).description ?? '',
          provider: resolvedProvider as ProviderName,
          apiKey: acc.apiKey ?? p.apiKey ?? 'none',
          apiUrl: resolvedApiUrl,
          externalModelName: m.id ?? '',
          enabled: !isAccountExplicitlyDisabled,
          status: accountStatus,
          isValidationRequired: isValReq,
          isUnlicensed: isUnlic,
          errorDetails: (acc as any).errorDetails || (p as any).errorDetails,
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
          _poolOnly: (isGoogle && !isAiStudio) || isGeminiCli ? true : undefined,
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

let _lastValidCustomModels: CustomModel[] = [];

export function getLastValidCustomModels(): CustomModel[] {
  return [..._lastValidCustomModels];
}

export function resetLastValidCustomModelsForTest(): void {
  _lastValidCustomModels = [];
}

/**
 * Loads custom models from disk, handling first-run defaults,
 * encryption migration, and validation.
 */
export function loadCustomModels(includeDisabled = false): CustomModel[] {
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
    // Clean null bytes and trim whitespace (handles partial writes or NTFS preallocation zeros)
    content = content.replace(/\0/g, '').trim();
    if (!content) {
      if (_lastValidCustomModels.length > 0) {
        log.warn(`[Proxy] custom_models.json is empty or contains only null bytes. Serving ${_lastValidCustomModels.length} models from in-memory cache.`);
        return [..._lastValidCustomModels];
      }
      return [];
    }
    const parsed = JSON.parse(content) as CustomModelsFile;

    let loadedModels: CustomModel[] = [];
    if (parsed.providers && Array.isArray(parsed.providers)) {
      loadedModels = parseProvidersSchema(parsed.providers, includeDisabled);
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

    const isUnsupportedCloudCodeModel = (name: string) => {
      const lower = (name || '').toLowerCase();
      if (lower.includes('sonar')) return false;
      return lower.includes('argon') || lower.includes('carbon');
    };

    const seenBaseIds = new Map<string, CustomModel>();
    for (const m of googleFamilyModels) {
      const raw = (m.externalModelName || m.name || '').replace(/^models\//, '');
      const rawLower = raw.toLowerCase();
      // Argon, Hydrogen and Carbon are internal/native models not supported on Google Cloud Code OAuth API (returns 404/400).
      // Skip auto-pool generation so they are not injected as broken pools.
      if (isUnsupportedCloudCodeModel(rawLower) && isGoogleCloudCodeModel(m)) {
        continue;
      }
      const baseId = normalizeCloudCodeModelId(raw);
      if (isUnsupportedCloudCodeModel(baseId) && isGoogleCloudCodeModel(m)) {
        continue;
      }
      if (!seenBaseIds.has(baseId)) {
        seenBaseIds.set(baseId, m);
      }
    }

    const pooledGoogleModels: CustomModel[] = [];
    seenBaseIds.forEach((template, baseId) => {
      let displayName = template.displayName || baseId;
      displayName = displayName.replace(/^\[[^\]]+\]\s*/, '').trim();
      if (baseId === 'gemini-3.8-flash-tiered' && (!displayName || displayName === baseId)) displayName = 'Gemini 3.8 Flash';
      else if (baseId === 'claude-sonnet-4-6' && (!displayName || displayName === baseId)) displayName = 'Claude Sonnet 4.6 (Thinking)';
      else if (baseId === 'claude-opus-4-6-thinking' && (!displayName || displayName === baseId)) displayName = 'Claude Opus 4.6 (Thinking)';
      else if (baseId === 'gemini-4-hydrogen' && (!displayName || displayName === baseId)) displayName = 'Gemini 4 Hydrogen';
      else if (baseId === 'gemini-4-hydrogen-sonar' && (!displayName || displayName === baseId || displayName.includes('gemini-4-hydrogen'))) displayName = 'gemini-4-hydrogen-sonar';
      else displayName = displayName || baseId;

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
    // Exclude Argon, Hydrogen and Carbon from Cloud Code OAuth dispatch pool since Cloud Code OAuth returns 404 for them.
    const realGoogleModels = googleFamilyModels
      .filter((m) => !isUnsupportedCloudCodeModel(m.externalModelName || m.name || '') || !isGoogleCloudCodeModel(m))
      .map((m) => ({ ...m, _poolOnly: true as const }));

    const result = [...pooledGoogleModels, ...realGoogleModels, ...otherModels];
    if (result.length > 0) {
      _lastValidCustomModels = result;
    }
    return result;
  } catch (e: any) {
    if (_lastValidCustomModels.length > 0) {
      log.warn(`[Proxy] Failed to parse custom_models.json (${e?.message || e}). Preserving in-memory cache of ${_lastValidCustomModels.length} models to avoid service interruption.`);
      return [..._lastValidCustomModels];
    }
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
