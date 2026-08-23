/**
 * Read/write the custom_models.json file.
 *
 * Note: this module only handles the plaintext JSON representation.
 * Encryption is handled by the running Electron app via safeStorage.
 * For CLI inspection / migration purposes we read/write the file as-is.
 *
 * Improvements over the original:
 *   - `loadCustomModels` no longer throws on corrupt JSON — returns an empty
 *     file and logs a warning instead.
 *   - `looksEncrypted` uses a broader set of known key prefixes (was: only
 *     `sk-` and `AIza`, which missed Google, Groq, Mistral, etc.).
 *   - `validateCustomModels` now allows `apiKey` to be optional for providers
 *     that don't require authentication (e.g. Ollama, LM Studio).
 */
import fs from 'fs';
import path from 'path';
import { getCustomModelsPath, getAntigravityDataDir } from './paths';
import type { CustomModel, CustomModelsFile } from '../types';

const KNOWN_PROVIDERS = new Set([
  'openai',
  'anthropic',
  'openrouter',
  'ollama',
  'google',
  'custom',
  'deepseek',
  'groq',
  'mistral',
  'cerebras',
  'kimi',
  'kimchi', // internal OpenAI-compatible proxy
  'fireworks',
  'lmstudio',
  'llamacpp',
  'nvidia',
  'opencode',
  'codestral',
  'wafer',
  'zai',
]);

// Providers that don't require an API key (local servers, etc.)
const KEYLESS_PROVIDERS = new Set(['ollama', 'lmstudio', 'llamacpp']);

// Known plaintext API-key prefixes. Anything else is treated as encrypted
// (opaque blob produced by Electron's safeStorage).
const KNOWN_KEY_PREFIXES = [
  'sk-',         // OpenAI, OpenRouter, DeepSeek, Groq, Mistral, Cerebras, Fireworks, Kimi, Z.ai
  'AIza',        // Google AI Studio
  'gsk_',        // Groq (newer)
  'nvapi-',      // NVIDIA NIM
  'fk-',         // Fireworks (alt)
  'wafer-',      // Wafer
  'ant-',        // Anthropic (newer)
];

export function loadCustomModels(filePath?: string, options?: { includeDisabled?: boolean }): CustomModelsFile {
  const fp = filePath ?? getCustomModelsPath();
  if (!fs.existsSync(fp)) {
    return { models: [] };
  }
  try {
    const raw = fs.readFileSync(fp, 'utf-8').replace(/^\uFEFF/, '');
    const parsed = JSON.parse(raw);
    if (!parsed) return { models: [] };

    const models: CustomModel[] = [];
    // ponytail: track keys we've seen from providers to avoid duplicates
    // when models[] and providers[] both contain the same model
    const seen = new Set<string>();

    if (Array.isArray(parsed.providers)) {
      for (const p of parsed.providers) {
        if (!p) continue;
        if (p.enabled === false && !options?.includeDisabled) continue;
        const pModels = Array.isArray(p.models) ? p.models : [];
        for (const m of pModels) {
          if (!m) continue;
          if (m.enabled === false && !options?.includeDisabled) continue;
          const name = m.id?.startsWith('models/') ? m.id : `models/${m.id ?? ''}`;
          const model: CustomModel = {
            name,
            displayName: m.displayName || m.id || name,
            provider: p.provider || 'openai',
            apiKey: p.apiKey || '',
            apiUrl: p.apiUrl || '',
            externalModelName: m.id || '',
            allowUnauthorized: p.allowUnauthorized,
            enabled: m.enabled !== false && p.enabled !== false,
          };
          models.push(model);
          seen.add(modelKey(model));
        }
      }
    }

    // Legacy models — only add if not already covered by a provider
    if (Array.isArray(parsed.models)) {
      for (const m of parsed.models) {
        if (m.enabled === false && !options?.includeDisabled) continue;
        const key = modelKey(m);
        if (!seen.has(key)) {
          models.push(m);
          seen.add(key);
        }
      }
    }

    return { models };
  } catch (e) {
    // Corrupt JSON should not crash the CLI — log and return empty.
    console.warn(`[custom-models] failed to parse ${fp}: ${(e as Error).message}`);
    return { models: [] };
  }
}

export function saveCustomModels(file: CustomModelsFile, filePath?: string): void {
  const fp = filePath ?? getCustomModelsPath();
  const dir = path.dirname(fp);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  let existing: any = {};
  if (fs.existsSync(fp)) {
    try {
      existing = JSON.parse(fs.readFileSync(fp, 'utf-8').replace(/^\uFEFF/, ''));
    } catch {
      existing = {};
    }
  }
  existing.models = file.models;

  if (Array.isArray(existing.providers)) {
    const providers = existing.providers as any[];
    for (const m of file.models) {
      const cleanId = m.name.replace(/^models\//, '');
      let providerEntry = providers.find(
        (p) =>
          (p.apiUrl && m.apiUrl && p.apiUrl.toLowerCase() === m.apiUrl.toLowerCase()) ||
          (p.provider && m.provider && p.provider.toLowerCase() !== 'openai' && m.provider.toLowerCase() !== 'openai' && p.provider.toLowerCase() === m.provider.toLowerCase()) ||
          (!p.apiUrl && !m.apiUrl && p.provider && m.provider && p.provider.toLowerCase() === m.provider.toLowerCase())
      );
      if (!providerEntry) {
        providerEntry = {
          id: `provider-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          name: m.provider ? `${m.provider.toUpperCase()} CLI Provider` : 'CLI Provider',
          provider: m.provider || 'custom',
          apiUrl: m.apiUrl || '',
          apiKey: m.apiKey || '',
          allowUnauthorized: m.allowUnauthorized,
          enabled: true,
          models: [],
        };
        providers.push(providerEntry);
      }
      if (!Array.isArray(providerEntry.models)) {
        providerEntry.models = [];
      }
      const existingModel = providerEntry.models.find(
        (pm: any) => pm.id === cleanId || pm.id === m.name || pm.displayName === m.displayName
      );
      if (existingModel) {
        existingModel.enabled = m.enabled !== false;
      } else {
        providerEntry.models.push({
          id: cleanId,
          displayName: m.displayName || cleanId,
          enabled: m.enabled !== false,
        });
      }
    }
  }

  fs.writeFileSync(fp, JSON.stringify(existing, null, 2), 'utf-8');
}

/**
 * Returns a stable unique key for a custom model.
 * Two models are considered the same only when they share BOTH name and provider,
 * so users can register the same model name against different providers/endpoints.
 */
export function modelKey(model: CustomModel): string {
  return `${model.provider || 'custom'}::${model.name}`;
}

export function addCustomModel(model: CustomModel, filePath?: string): CustomModelsFile {
  const file = loadCustomModels(filePath);
  const key = modelKey(model);
  const idx = file.models.findIndex((m) => modelKey(m) === key);
  if (idx >= 0) {
    file.models[idx] = model;
  } else {
    file.models.push(model);
  }
  saveCustomModels(file, filePath);
  return file;
}

export function removeCustomModel(name: string, filePath?: string): CustomModelsFile {
  const file = loadCustomModels(filePath);
  const cleanName = name.replace(/^models\//, '');
  // Match by name only when no provider is encoded, otherwise by full key.
  // Accept either the legacy plain name or the "provider::name" form.
  file.models = file.models.filter((m) => {
    if (name.includes('::')) return modelKey(m) !== name;
    return m.name !== name;
  });

  // Dual-format sync: loadCustomModels merges providers[] back into the model
  // list, so a model removed from models[] but still referenced by a provider
  // entry would resurrect in every consumer (CLI list, doctor UI, proxy).
  // loadCustomModels only returns { models }, so prune the raw file directly.
  const fp = filePath ?? getCustomModelsPath();
  let raw: any = { models: file.models };
  try {
    if (fs.existsSync(fp)) {
      raw = JSON.parse(fs.readFileSync(fp, 'utf-8').replace(/^\uFEFF/, ''));
    }
  } catch {
    raw = { models: file.models };
  }
  raw.models = file.models;
  if (Array.isArray(raw.providers)) {
    for (const p of raw.providers) {
      if (!Array.isArray(p.models)) continue;
      p.models = p.models.filter((pm: any) => {
        if (!pm) return false;
        const pmId = String(pm.id ?? pm.displayName ?? '').replace(/^models\//, '');
        const pmName = String(pm.name ?? '').replace(/^models\//, '');
        return pmId !== cleanName && pmName !== cleanName && pmId !== name && pmName !== name;
      });
    }
  }
  const dir = path.dirname(fp);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(raw, null, 2), 'utf-8');
  return file;
}

export function looksEncrypted(filePath?: string): boolean {
  const fp = filePath ?? getCustomModelsPath();
  if (!fs.existsSync(fp)) return false;
  const file = loadCustomModels(fp);
  return file.models.some((m) => {
    if (typeof m.apiKey !== 'string' || m.apiKey.length === 0) return false;
    return !KNOWN_KEY_PREFIXES.some((p) => m.apiKey!.startsWith(p));
  });
}

/**
 * True when the key was encrypted by the language server's own scheme:
 * "enc:" + base64 of a blob starting with the 3-byte ASCII marker "v10"
 * (0x76 0x31 0x30). The local proxy's cryptoStore cannot decrypt this format
 * (it is not Chromium OSCrypt v10 and not raw DPAPI) — only the Go language
 * server can. Such keys must be re-entered via `ag-doctor models rekey`.
 */
export function isLsEncryptedKey(apiKey: string | undefined): boolean {
  if (typeof apiKey !== 'string' || !apiKey.startsWith('enc:')) return false;
  try {
    const buf = Buffer.from(apiKey.slice(4), 'base64');
    return buf.length >= 3 && buf[0] === 0x76 && buf[1] === 0x31 && buf[2] === 0x30;
  } catch {
    return false;
  }
}

/** Number of models whose key is in the language server's own format. */
export function countLsEncryptedKeys(filePath?: string): number {
  const fp = filePath ?? getCustomModelsPath();
  if (!fs.existsSync(fp)) return 0;
  try {
    const file = loadCustomModels(fp);
    return file.models.filter((m) => isLsEncryptedKey(m.apiKey)).length;
  } catch {
    return 0;
  }
}

/**
 * Encode a plaintext API key in the proxy-compatible fallback format
 * ("fallback:" + base64). The local proxy's cryptoStore decrypts this format
 * without requiring Electron safeStorage, so keys re-entered through the CLI
 * keep working when the proxy runs standalone.
 *
 * SECURITY NOTE: this is base64 obfuscation, not encryption — anyone with
 * read access to custom_models.json can recover the plaintext key. It exists
 * because the CLI cannot use Electron's safeStorage; it matches the existing
 * `fallback:` convention the proxy already understands.
 */
export function toFallbackKey(plaintext: string): string {
  return 'fallback:' + Buffer.from(plaintext, 'utf-8').toString('base64');
}

export interface ValidationIssue {
  model: string;
  field: string;
  message: string;
}

export function validateCustomModels(file: CustomModelsFile): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const m of file.models) {
    if (!m.name || !m.name.startsWith('models/')) {
      issues.push({ model: m.name ?? '<unnamed>', field: 'name', message: 'must start with "models/"' });
    }
    if (!m.provider) {
      issues.push({ model: m.name, field: 'provider', message: 'is required' });
    } else if (!KNOWN_PROVIDERS.has(m.provider)) {
      issues.push({ model: m.name, field: 'provider', message: `unknown provider "${m.provider}"` });
    }
    if (!m.apiUrl) {
      issues.push({ model: m.name, field: 'apiUrl', message: 'is required' });
    } else {
      try {
        new URL(m.apiUrl);
      } catch {
        issues.push({ model: m.name, field: 'apiUrl', message: 'is not a valid URL' });
      }
    }
    if (!m.externalModelName) {
      issues.push({ model: m.name, field: 'externalModelName', message: 'is required' });
    }
    // API key is required unless the provider is keyless (Ollama, LM Studio, etc.)
    if (!m.apiKey && m.provider && !KEYLESS_PROVIDERS.has(m.provider)) {
      issues.push({ model: m.name, field: 'apiKey', message: 'is required for this provider' });
    }
  }
  return issues;
}

/** Returns the data dir, creating it and guaranteeing valid configuration files if needed. */
export function ensureDataDir(): string {
  const dir = getAntigravityDataDir();
  fs.mkdirSync(dir, { recursive: true });

  // Auto-heal ~/.gemini/config/config.json & ~/.gemini/config/projects/.json
  try {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    if (home) {
      const configDir = path.join(home, '.gemini', 'config');
      const projectsDir = path.join(configDir, 'projects');
      fs.mkdirSync(projectsDir, { recursive: true });

      const configJsonPath = path.join(configDir, 'config.json');
      let configValid = false;
      if (fs.existsSync(configJsonPath)) {
        try {
          const content = fs.readFileSync(configJsonPath, 'utf-8').replace(/^\uFEFF/, '');
          JSON.parse(content);
          configValid = true;
        } catch {
          configValid = false;
        }
      }
      if (!configValid) {
        fs.writeFileSync(configJsonPath, '{}', 'utf-8');
      }

      const defaultProjectJson = path.join(projectsDir, '.json');
      if (!fs.existsSync(defaultProjectJson)) {
        fs.writeFileSync(defaultProjectJson, '{}', 'utf-8');
      }
    }
  } catch {
    // Non-fatal
  }

  return dir;
}
