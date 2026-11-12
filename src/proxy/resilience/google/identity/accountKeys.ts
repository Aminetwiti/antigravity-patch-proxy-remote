import type { CustomModel } from '../../../core/types';
import { isGeminiCliModel } from '../../../../services/auth/googleAuth';

// ─── Multi-Account Session Affinity (Sticky Sessions) ─────────────────────────

const refreshTokenToEmail = new Map<string, string>();

export function registerAccountRefreshToken(refreshToken?: string, email?: string): void {
  if (refreshToken && email && email.includes('@')) {
    refreshTokenToEmail.set(refreshToken.trim(), email.trim().toLowerCase());
  }
}

export function getAccountQuotaKey(item: CustomModel): string {
  const prefix = isGeminiCliModel(item) ? 'gemini-cli' : 'google';
  if (item.accountEmail) {
    if (item.refreshToken) registerAccountRefreshToken(item.refreshToken, item.accountEmail);
    return `${prefix}:${item.accountEmail.toLowerCase()}`;
  }
  if (item.refreshToken) {
    const knownEmail = refreshTokenToEmail.get(item.refreshToken.trim());
    if (knownEmail) {
      return `${prefix}:${knownEmail}`;
    }
    return `${prefix}:refresh:${item.refreshToken.slice(-15)}`;
  }
  try {
    const host = new URL(item.apiUrl).hostname;
    return `${host}:${item.apiKey || 'none'}`;
  } catch {
    return item.apiUrl || item.name || '';
  }
}
