import { safeStorage } from 'electron';
import * as fs from 'fs';
import * as crypto from 'crypto';
import log from 'electron-log';
import {
  PBKDF2_ITERATIONS,
  PBKDF2_LEGACY_ITERATIONS,
  PBKDF2_KEY_LEN,
  PBKDF2_DIGEST,
} from '../constants';

/**
 * Creates a backup of the specified file with a .bak extension.
 */
export function backupFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      const backupPath = filePath + '.bak';
      fs.copyFileSync(filePath, backupPath);
      log.info(`[CryptoStore] Backup created successfully at: ${backupPath}`);
    }
  } catch (err) {
    log.error('[CryptoStore] Failed to create file backup:', err);
  }
}

/**
 * Diagnostic info on the encryption system status.
 */
export interface EncryptionStatus {
  available: boolean;
  mode: 'safeStorage' | 'fallback-base64';
  warning?: string;
}

/**
 * Returns current system encryption capabilities and mode.
 */
export function getEncryptionStatus(): EncryptionStatus {
  const available = isEncryptionAvailable();
  if (available) {
    return { available: true, mode: 'safeStorage' };
  }
  return {
    available: false,
    mode: 'fallback-base64',
    warning: 'Native OS keychain encryption (safeStorage) is unavailable. API keys are encoded using base64 fallback.',
  };
}

/**
 * Checks if Electron's safeStorage API is fully functional on the current system.
 */
export function isEncryptionAvailable(): boolean {
  try {
    return !!(safeStorage && safeStorage.isEncryptionAvailable());
  } catch (_e) {
    return false;
  }
}

/**
 * Encrypts a plaintext string. Falls back to base64 with a prefix if safeStorage is unavailable.
 */
export function encryptString(plainText: string): string {
  if (!plainText || plainText === 'none') return plainText;

  if (isEncryptionAvailable()) {
    try {
      const buffer = safeStorage.encryptString(plainText);
      return 'enc:' + buffer.toString('base64');
    } catch (err) {
      log.error('[CryptoStore] safeStorage encryption failed, falling back to base64:', err);
      return 'fallback:' + Buffer.from(plainText, 'utf-8').toString('base64');
    }
  } else {
    log.warn('[CryptoStore] safeStorage not available. Using base64 fallback format.');
    return 'fallback:' + Buffer.from(plainText, 'utf-8').toString('base64');
  }
}

/**
 * Decrypts a previously encrypted string. Handles safeStorage, base64 fallback, and plaintext gracefully.
 */
export function decryptString(encryptedText: string): string {
  if (!encryptedText || encryptedText === 'none') return encryptedText;

  if (encryptedText.startsWith('enc:')) {
    const base64Data = encryptedText.substring(4);
    if (isEncryptionAvailable()) {
      try {
        const buffer = Buffer.from(base64Data, 'base64');
        return safeStorage.decryptString(buffer);
      } catch (err) {
        log.error('[CryptoStore] safeStorage decryption failed:', err);
        return 'DECRYPTION_FAILED';
      }
    } else {
      log.error(
        '[CryptoStore] safeStorage is unavailable, but data was encrypted with it. Trying fallback raw data.',
      );
      return 'DECRYPTION_FAILED_STORAGE_UNAVAILABLE';
    }
  } else if (encryptedText.startsWith('fallback:')) {
    const base64Data = encryptedText.substring(9);
    try {
      return Buffer.from(base64Data, 'base64').toString('utf-8');
    } catch (err) {
      log.error('[CryptoStore] Fallback base64 decryption failed:', err);
      return 'DECRYPTION_FAILED';
    }
  }

  // Plaintext (older config, not yet migrated)
  return encryptedText;
}

interface ModelWithKey {
  apiKey?: string;
  encrypted?: boolean;
  provider?: string;
  [key: string]: unknown;
}

/**
 * Iterates through a list of custom models and encrypts their API keys.
 */
export function encryptModels(models: ModelWithKey[] | null): ModelWithKey[] {
  if (!models || !Array.isArray(models)) return [];
  return models.map((model) => {
    if (model.apiKey && model.apiKey !== 'none' && !model.encrypted) {
      return {
        ...model,
        apiKey: encryptString(model.apiKey),
        encrypted: true,
      };
    }
    return model;
  });
}

/**
 * Iterates through a list of custom models and decrypts their API keys for in-memory use.
 */
export function decryptModels(models: ModelWithKey[] | null): ModelWithKey[] {
  if (!models || !Array.isArray(models)) return [];
  return models.map((model) => {
    if (model.encrypted) {
      return {
        ...model,
        apiKey: decryptString(model.apiKey as string),
        encrypted: false,
      };
    }
    return model;
  });
}

export function exportAgBoxPackage(payload: unknown, passphrase: string): string {
  if (!passphrase || typeof passphrase !== 'string' || passphrase.trim().length === 0) {
    throw new Error('Passphrase is required for exporting .agbox package');
  }
  const jsonStr = JSON.stringify(payload);
  const salt = crypto.randomBytes(16);
  const key = crypto.pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, PBKDF2_KEY_LEN, PBKDF2_DIGEST);
  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(jsonStr, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  const boxed = {
    version: '2.0',
    format: 'agbox',
    timestamp: Date.now(),
    encrypted: true,
    iterations: PBKDF2_ITERATIONS,
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    data: encrypted.toString('base64'),
  };
  return Buffer.from(JSON.stringify(boxed), 'utf-8').toString('base64');
}

export function importAgBoxPackage(base64Box: string, passphrase?: string): { success: boolean; data?: unknown; error?: string } {
  try {
    const rawBoxed = Buffer.from(base64Box, 'base64').toString('utf-8');
    const parsed = JSON.parse(rawBoxed);
    if (!parsed || parsed.format !== 'agbox' || !parsed.data) {
      return { success: false, error: 'Invalid .agbox package format' };
    }

    // Version 2.0: AES-256-GCM authenticated encryption
    if (parsed.version === '2.0' && parsed.salt && parsed.iv && parsed.tag) {
      if (!passphrase) {
        return { success: false, error: 'Passphrase is required for decrypting .agbox package' };
      }
      const salt = Buffer.from(parsed.salt, 'hex');
      const iv = Buffer.from(parsed.iv, 'hex');
      const tag = Buffer.from(parsed.tag, 'hex');
      const encryptedData = Buffer.from(parsed.data, 'base64');

      const primaryIterations = parsed.iterations || PBKDF2_ITERATIONS;

      const tryDecrypt = (iterCount: number): unknown | null => {
        try {
          const key = crypto.pbkdf2Sync(passphrase, salt, iterCount, PBKDF2_KEY_LEN, PBKDF2_DIGEST);
          const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
          decipher.setAuthTag(tag);
          const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);
          return JSON.parse(decrypted.toString('utf8'));
        } catch {
          return null;
        }
      };

      let data = tryDecrypt(primaryIterations);
      if (!data && primaryIterations !== PBKDF2_LEGACY_ITERATIONS) {
        data = tryDecrypt(PBKDF2_LEGACY_ITERATIONS);
      }

      if (data !== null) {
        return { success: true, data };
      }
      return { success: false, error: 'Déchiffrement échoué : mot de passe incorrect ou données corrompues' };
    }

    // Version 1.0 legacy fallback (Base64)
    const jsonStr = Buffer.from(parsed.data, 'base64').toString('utf-8');
    const data = JSON.parse(jsonStr);
    return { success: true, data };
  } catch (err: any) {
    return { success: false, error: `Failed to import .agbox package: ${err.message}` };
  }
}
