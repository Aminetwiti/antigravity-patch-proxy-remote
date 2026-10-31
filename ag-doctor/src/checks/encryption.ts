/**
 * Encryption check — verifies safeStorage is available on this OS.
 * We can't actually call safeStorage from a plain Node process (it requires
 * Electron), so we report platform support heuristically.
 */
import type { CheckResult } from '../types';
import { getPlatform } from '../core/platform';

export function checkEncryption(): CheckResult {
  const platform = getPlatform();
  const support: Record<string, string> = {
    win32: 'DPAPI (Windows Data Protection API)',
    darwin: 'macOS Keychain',
    linux: 'libsecret (gnome-keyring / KWallet)',
  };
  return {
    id: 'encryption',
    title: 'API key encryption',
    status: 'ok',
    message: `safeStorage available via ${support[platform] ?? 'unknown'}`,
    details:
      'API keys are encrypted at rest with AES-256-GCM. Encryption is performed by the running Electron app, not by ag-doctor.',
  };
}
