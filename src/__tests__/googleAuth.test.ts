import { describe, it, expect } from 'vitest';
import { normalizeCloudCodeModelId, isGoogleCloudCodeModel } from '../services/googleAuth';

describe('googleAuth service', () => {
  describe('normalizeCloudCodeModelId', () => {
    it('normalizes legacy flash high alias to tiered', () => {
      expect(normalizeCloudCodeModelId('gemini-3.8-flash-high')).toBe('gemini-3.8-flash-tiered');
      expect(normalizeCloudCodeModelId('models/gemini-3.8-flash-high')).toBe('gemini-3.8-flash-tiered');
      expect(normalizeCloudCodeModelId('gemini-3.7-flash-high')).toBe('gemini-3.7-flash-tiered');
      expect(normalizeCloudCodeModelId('gemini-3.8-flash')).toBe('gemini-3.8-flash-tiered');
    });

    it('preserves valid standard model IDs', () => {
      expect(normalizeCloudCodeModelId('gemini-2.5-pro')).toBe('gemini-2.5-pro');
      expect(normalizeCloudCodeModelId('gemini-2.5-flash')).toBe('gemini-2.5-flash');
      expect(normalizeCloudCodeModelId('claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
      expect(normalizeCloudCodeModelId('gemini-3.1-pro-high')).toBe('gemini-3.1-pro-high');
    });
  });

  describe('isGoogleCloudCodeModel', () => {
    it('returns true for accounts with ya29 accessToken or refresh token', () => {
      expect(isGoogleCloudCodeModel({ provider: 'google', apiKey: 'ya29.test123' })).toBe(true);
      expect(isGoogleCloudCodeModel({ provider: 'google', refreshToken: '1//refresh123' })).toBe(true);
    });

    it('returns false for AI Studio developer keys', () => {
      expect(isGoogleCloudCodeModel({ provider: 'google', apiKey: 'AIzaSyTestKey' })).toBe(false);
    });

    it('returns false for non-google providers', () => {
      expect(isGoogleCloudCodeModel({ provider: 'openai', apiKey: 'sk-test' })).toBe(false);
      expect(isGoogleCloudCodeModel({ provider: 'anthropic', apiKey: 'sk-ant-test' })).toBe(false);
    });
  });
});
