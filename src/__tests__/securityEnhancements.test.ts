import { describe, it, expect } from 'vitest';
import { getEncryptionStatus, encryptString, decryptString } from '../cryptoStore';

describe('Encryption Security & Diagnostics', () => {
  it('returns valid EncryptionStatus object', () => {
    const status = getEncryptionStatus();
    expect(status).toHaveProperty('available');
    expect(status).toHaveProperty('mode');
    expect(['safeStorage', 'fallback-base64']).toContain(status.mode);
  });

  it('encrypts and decrypts values correctly in fallback mode', () => {
    const plain = 'sk-test-secret-key-12345';
    const encrypted = encryptString(plain);
    expect(encrypted).not.toBe(plain);
    const decrypted = decryptString(encrypted);
    expect(decrypted).toBe(plain);
  });

  it('handles none and empty values without modification', () => {
    expect(encryptString('none')).toBe('none');
    expect(encryptString('')).toBe('');
    expect(decryptString('none')).toBe('none');
    expect(decryptString('')).toBe('');
  });
});
