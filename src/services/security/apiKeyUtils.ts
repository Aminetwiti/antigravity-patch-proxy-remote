import * as cryptoStore from '../../compat/cryptoStore';

export function isMaskedApiKey(key: string): boolean {
  if (!key) return false;
  if (key === '********') return true;
  return /^[A-Za-z0-9_-]{4}\.\.\.[A-Za-z0-9_-]{4}$/.test(key);
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
