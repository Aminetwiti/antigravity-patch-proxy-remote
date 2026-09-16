import { describe, it, expect } from 'vitest';
import { normalizeCloudCodeModelId, isGoogleCloudCodeModel, normalizeGoogleModelId } from '../services/googleAuth';

describe('googleAuth service', () => {
  describe('normalizeCloudCodeModelId', () => {
    it('normalizes legacy flash high alias to tiered', () => {
      expect(normalizeCloudCodeModelId('gemini-3.8-flash-high')).toBe('gemini-3.8-flash-tiered');
      expect(normalizeCloudCodeModelId('models/gemini-3.8-flash-high')).toBe('gemini-3.8-flash-tiered');
      expect(normalizeCloudCodeModelId('gemini-3.7-flash-high')).toBe('gemini-3.7-flash-tiered');
      expect(normalizeCloudCodeModelId('gemini-3.8-flash')).toBe('gemini-3.8-flash-tiered');
    });

    it('preserves valid standard model IDs', () => {
      expect(normalizeCloudCodeModelId('gemini-2.0-flash')).toBe('gemini-2.0-flash');
      expect(normalizeCloudCodeModelId('gemini-1.5-pro')).toBe('gemini-1.5-pro');
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

  describe('normalizeGoogleModelId', () => {
    it('preserves canonical models gemini-2.5-flash and gemini-2.5-pro', () => {
      expect(normalizeGoogleModelId('gemini-2.5-flash')).toBe('gemini-2.5-flash');
      expect(normalizeGoogleModelId('gemini-2.5-pro')).toBe('gemini-2.5-pro');
      expect(normalizeGoogleModelId('models/gemini-2.5-flash')).toBe('gemini-2.5-flash');
      expect(normalizeGoogleModelId('models/gemini-2.5-pro')).toBe('gemini-2.5-pro');
    });

    it('maps unknown or tiered flash models to canonical gemini-2.5-flash', () => {
      expect(normalizeGoogleModelId('gemini-3.8-flash-tiered')).toBe('gemini-2.5-flash');
      expect(normalizeGoogleModelId('gemini-3.7-flash-tiered')).toBe('gemini-2.5-flash');
      expect(normalizeGoogleModelId('gemini-3.8-flash')).toBe('gemini-2.5-flash');
      expect(normalizeGoogleModelId('gemini-3.7-flash')).toBe('gemini-2.5-flash');
      expect(normalizeGoogleModelId('gemini-flash')).toBe('gemini-2.5-flash');
    });

    it('maps unknown or tiered pro models to canonical gemini-2.5-pro', () => {
      expect(normalizeGoogleModelId('gemini-3.1-pro')).toBe('gemini-2.5-pro');
      expect(normalizeGoogleModelId('gemini-3.0-pro')).toBe('gemini-2.5-pro');
      expect(normalizeGoogleModelId('gemini-pro')).toBe('gemini-2.5-pro');
    });

    it('falls back safely for non-Gemini model names routed to Google', () => {
      expect(normalizeGoogleModelId('claude-sonnet-4-6')).toBe('gemini-2.5-pro');
      expect(normalizeGoogleModelId('gpt-4o')).toBe('gemini-2.5-flash');
    });

    it('returns canonical default on empty string or nullish input', () => {
      expect(normalizeGoogleModelId('')).toBe('gemini-2.5-flash');
    });
  });
});
