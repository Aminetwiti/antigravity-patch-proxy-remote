/**
 * Manual mock for cryptoStore to avoid loading electron in tests.
 * The real cryptoStore.ts uses require('electron') which fails under vitest.
 */
export function isEncryptionAvailable(): boolean {
  return false;
}

export function encryptString(plainText: string): string {
  return plainText;
}

export function decryptString(encryptedText: string): string {
  return encryptedText;
}

export function encryptModels(models: unknown[] | null): unknown[] {
  return models || [];
}

export function decryptModels(models: unknown[] | null): unknown[] {
  return models || [];
}

export function backupFile(_filePath: string): void {
  // no-op in tests
}
