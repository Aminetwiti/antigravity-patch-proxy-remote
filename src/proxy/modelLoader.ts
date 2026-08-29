/**
 * Custom model loading and management.
 * Handles reading custom_models.json, encryption migration, and validation.
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import log from 'electron-log';
import * as cryptoStore from '../cryptoStore';
import { validateCustomModel } from '../schemaValidator';
import { ALL_PROVIDERS, type ProviderName, LOCAL_SERVICES } from '../constants';
import { generateModelPlaceholderId } from './idGenerator';
import type { CustomModel } from './types';

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
  models?: RawModelEntry[];
}

/** Shape of a raw entry in the `models` array inside a provider. */
interface RawModelEntry {
  id?: string;
  displayName?: string;
  enabled?: boolean;
  extraHeaders?: Record<string, string>;
  extraBody?: Record<string, unknown>;
  fallbackModel?: string;
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
  const geminiDir = path.join(app.getPath('home'), '.gemini', 'antigravity');
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

/**
 * Validates all models and returns only the valid ones.
 */
function validateModels(decrypted: CustomModel[]): CustomModel[] {
  const validModels: CustomModel[] = [];
  for (let i = 0; i < decrypted.length; i++) {
    const m = decrypted[i];
    const provider = m.provider as string;
    if (!ALL_PROVIDERS.includes(provider as ProviderName)) {
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
  if (validModels.length < decrypted.length) {
    log.info(
      `[Proxy] Loaded ${validModels.length}/${decrypted.length} valid models (${decrypted.length - validModels.length} skipped)`,
    );
  }
  return validModels;
}

function parseProvidersSchema(providers: RawProviderEntry[]): CustomModel[] {
  const flatModels: CustomModel[] = [];
  for (const p of providers) {
    if (p.enabled === false) continue;
    const models = Array.isArray(p.models) ? p.models : [];
    for (const m of models) {
      if (m.enabled === false) continue;
      const mergedHeaders = { ...p.extraHeaders, ...(m as { extraHeaders?: Record<string, string> }).extraHeaders };
      const mergedBody = { ...p.extraBody, ...(m as { extraBody?: Record<string, unknown> }).extraBody };

      const partialModel: CustomModel = {
        name: m.id ?? '',
        displayName: m.displayName ?? m.id ?? '',
        description: (m as { description?: string }).description ?? '',
        provider: (p.provider ?? 'openai') as ProviderName,
        apiKey: p.apiKey ?? 'none',
        apiUrl: p.apiUrl ?? '',
        externalModelName: m.id ?? '',
        allowUnauthorized: p.allowUnauthorized,
        encrypted: p.encrypted,
        useRawBaseUrl: p.useRawBaseUrl,
        fallbackModel: m.fallbackModel ?? p.fallbackModel,
        extraHeaders: Object.keys(mergedHeaders).length > 0 ? mergedHeaders : undefined,
        extraBody: Object.keys(mergedBody).length > 0 ? mergedBody : undefined,
      };
      const placeholderId = generateModelPlaceholderId(partialModel);

      flatModels.push({
        ...partialModel,
        name: `models/${placeholderId}`,
      });
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

    if (parsed.providers && Array.isArray(parsed.providers)) {
      return parseProvidersSchema(parsed.providers);
    }

    const models = parsed.models || [];
    return parseModelsSchema(models, filePath);
  } catch (e) {
    log.error('[Proxy] Failed to parse custom_models.json', e);
    try {
      if (fs.existsSync(filePath)) {
        cryptoStore.backupFile(filePath);
        fs.renameSync(filePath, filePath + '.corrupt');
        log.warn(`[Proxy] Corrupted custom_models.json moved to ${filePath}.corrupt. Recreating defaults.`);
      }
      return createDefaultModelsFile(filePath);
    } catch (recoveryErr) {
      log.error('[Proxy] Auto-recovery failed:', recoveryErr);
      return [];
    }
  }
}
