/**
 * Provider Configuration Import / Export & Base64 Exchange.
 * Allows users to share configurations via Base64 strings, files, or deep-links,
 * with conflict resolution strategies (overwrite, merge, skip).
 */

import type { ProviderFileEntry } from './customModelStore';

export type MergeStrategy = 'overwrite' | 'merge' | 'skip';

export interface ImportResult {
  success: boolean;
  importedCount: number;
  skippedCount: number;
  mergedCount: number;
  providers: ProviderFileEntry[];
  error?: string;
}

/**
 * Encodes an array of ProviderFileEntry objects to a compressed Base64 string for URL or clipboard sharing.
 */
export function exportProvidersToBase64(providers: ProviderFileEntry[]): string {
  const jsonStr = JSON.stringify({ version: 1, providers });
  return Buffer.from(jsonStr, 'utf-8').toString('base64');
}

/**
 * Decodes a Base64 configuration string back into ProviderFileEntry objects.
 */
export function parseProvidersFromBase64(base64Str: string): ProviderFileEntry[] {
  if (!base64Str || typeof base64Str !== 'string') {
    throw new Error('Invalid Base64 input string');
  }

  let jsonStr: string;
  try {
    jsonStr = Buffer.from(base64Str.trim(), 'base64').toString('utf-8');
  } catch (err) {
    throw new Error(`Failed to decode Base64 string: ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    throw new Error(`Failed to parse decoded JSON: ${(err as Error).message}`);
  }

  if (typeof parsed === 'object' && parsed !== null && 'providers' in parsed && Array.isArray((parsed as { providers: unknown }).providers)) {
    return (parsed as { providers: ProviderFileEntry[] }).providers;
  }

  if (Array.isArray(parsed)) {
    return parsed as ProviderFileEntry[];
  }

  throw new Error('Decoded JSON does not contain a valid providers array');
}

/**
 * Merges incoming provider configurations into existing provider configurations using the chosen strategy.
 */
export function mergeProviderConfigs(
  existing: ProviderFileEntry[],
  incoming: ProviderFileEntry[],
  strategy: MergeStrategy = 'merge',
): ImportResult {
  const existingMap = new Map<string, ProviderFileEntry>();
  existing.forEach((p) => existingMap.set(p.id, { ...p }));

  let importedCount = 0;
  let skippedCount = 0;
  let mergedCount = 0;

  for (const inc of incoming) {
    if (!inc || !inc.id || !inc.name) continue;

    if (!existingMap.has(inc.id)) {
      existingMap.set(inc.id, { ...inc });
      importedCount++;
    } else {
      if (strategy === 'skip') {
        skippedCount++;
      } else if (strategy === 'overwrite') {
        existingMap.set(inc.id, { ...inc });
        mergedCount++;
      } else if (strategy === 'merge') {
        const prev = existingMap.get(inc.id)!;
        // Merge models deduplicated by id
        const modelMap = new Map<string, typeof prev.models[0]>();
        prev.models.forEach((m) => modelMap.set(m.id, m));
        inc.models.forEach((m) => modelMap.set(m.id, m));

        existingMap.set(inc.id, {
          ...prev,
          ...inc,
          models: Array.from(modelMap.values()),
        });
        mergedCount++;
      }
    }
  }

  const finalProviders = Array.from(existingMap.values());
  return {
    success: true,
    importedCount,
    skippedCount,
    mergedCount,
    providers: finalProviders,
  };
}

/**
 * Encrypts provider configurations with a user password using AES-256-GCM & PBKDF2.
 */
export function exportEncryptedConfig(providers: ProviderFileEntry[], password: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const crypto = require('crypto');
  const salt = crypto.randomBytes(16);
  const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
  const iv = crypto.randomBytes(12);

  const jsonStr = JSON.stringify({ version: 1, providers });
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  const encrypted = Buffer.concat([cipher.update(jsonStr, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  const payload = {
    encrypted: true,
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    data: encrypted.toString('base64'),
  };

  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

/**
 * Decrypts a password-protected Base64 configuration string back into ProviderFileEntry objects.
 */
export function importEncryptedConfig(encryptedBase64: string, password: string): ProviderFileEntry[] {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const crypto = require('crypto');

  let rawJson: string;
  try {
    rawJson = Buffer.from(encryptedBase64.trim(), 'base64').toString('utf8');
  } catch {
    throw new Error('Invalid Base64 payload');
  }

  let payload: { encrypted: boolean; salt: string; iv: string; tag: string; data: string };
  try {
    payload = JSON.parse(rawJson);
  } catch {
    throw new Error('Invalid JSON structure inside encrypted payload');
  }

  if (!payload.encrypted || !payload.salt || !payload.iv || !payload.tag || !payload.data) {
    throw new Error('Malformed encrypted payload structure');
  }

  const salt = Buffer.from(payload.salt, 'hex');
  const iv = Buffer.from(payload.iv, 'hex');
  const tag = Buffer.from(payload.tag, 'hex');
  const encryptedData = Buffer.from(payload.data, 'base64');

  const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  let decrypted: Buffer;
  try {
    decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);
  } catch {
    throw new Error('Decryption failed. Incorrect password or corrupted payload.');
  }

  const parsed = JSON.parse(decrypted.toString('utf8'));
  if (typeof parsed === 'object' && parsed !== null && 'providers' in parsed && Array.isArray((parsed as any).providers)) {
    return (parsed as any).providers;
  }

  throw new Error('Decrypted payload does not contain a valid providers array');
}
