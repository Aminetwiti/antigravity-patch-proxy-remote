import { describe, it, expect } from 'vitest';
import {
  normalizeCloudCodeModelId,
  isGoogleCloudCodeModel,
  normalizeGoogleModelId,
  sanitizeCloudCodeGenerationConfig,
} from '../services/googleAuth';

describe('googleAuth service', () => {
  describe('normalizeCloudCodeModelId', () => {
    it('normalizes legacy flash high alias to tiered', () => {
      expect(normalizeCloudCodeModelId('gemini-3.8-flash-high')).toBe('gemini-3.8-flash-tiered');
      expect(normalizeCloudCodeModelId('models/gemini-3.8-flash-high')).toBe('gemini-3.8-flash-tiered');
      expect(normalizeCloudCodeModelId('gemini-3.7-flash-high')).toBe('gemini-3.7-flash-tiered');
      expect(normalizeCloudCodeModelId('gemini-3.8-flash')).toBe('gemini-3.8-flash-tiered');
    });

    it('preserves valid standard model IDs', () => {
      expect(normalizeCloudCodeModelId('gemini-3.8-flash-tiered')).toBe('gemini-3.8-flash-tiered');
      expect(normalizeCloudCodeModelId('gemini-3.1-pro-high')).toBe('gemini-3.1-pro-high');
      expect(normalizeCloudCodeModelId('claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
      expect(normalizeCloudCodeModelId('gemini-3.1-pro-high')).toBe('gemini-3.1-pro-high');
    });

    it('maps gemini-2.5 and other alias models to canonical Cloud Code models', () => {
      expect(normalizeCloudCodeModelId('gemini-2.5-flash')).toBe('gemini-3.8-flash-tiered');
      expect(normalizeCloudCodeModelId('gemini-2.5-pro')).toBe('gemini-3.1-pro-high');
      expect(normalizeCloudCodeModelId('claude-3-7-sonnet')).toBe('claude-sonnet-4-6');
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

  describe('sanitizeCloudCodeGenerationConfig', () => {
    it('deletes thinkingConfig if budget is zero or negative', () => {
      const payload: Record<string, unknown> = {
        generationConfig: {
          thinkingConfig: { thinkingBudget: 0 },
        },
      };
      sanitizeCloudCodeGenerationConfig(payload, 'gpt-oss-120b-medium');
      expect((payload.generationConfig as any).thinkingConfig).toBeUndefined();

      const payload2: Record<string, unknown> = {
        generationConfig: {
          thinkingConfig: { thinkingBudget: -1 },
        },
      };
      sanitizeCloudCodeGenerationConfig(payload2, 'gemini-3.8-flash-tiered');
      expect((payload2.generationConfig as any).thinkingConfig).toBeUndefined();
    });

    it('clamps thinkingBudget to >= 1024 for Claude models', () => {
      const payload: Record<string, unknown> = {
        generationConfig: {
          thinkingConfig: { thinkingBudget: 500 },
          maxOutputTokens: 2048,
          temperature: 0.7,
        },
      };
      sanitizeCloudCodeGenerationConfig(payload, 'claude-sonnet-4-6');
      const cfg = payload.generationConfig as any;
      expect(cfg.thinkingConfig.thinkingBudget).toBe(1024);
      expect(cfg.maxOutputTokens).toBeGreaterThan(1024);
      expect(cfg.temperature).toBeUndefined();
    });

    it('prunes trailing model turns from contents', () => {
      const payload: Record<string, unknown> = {
        contents: [
          { role: 'user', parts: [{ text: 'hello' }] },
          { role: 'model', parts: [{ text: 'hi' }] },
        ],
      };
      sanitizeCloudCodeGenerationConfig(payload, 'claude-sonnet-4-6');
      expect((payload.contents as any[]).length).toBe(1);
      expect((payload.contents as any[])[0].role).toBe('user');
    });
  });

  describe('normalizeGoogleModelId', () => {
    it('preserves canonical models gemini-3.8-flash-tiered and gemini-3.1-pro-high', () => {
      expect(normalizeGoogleModelId('gemini-3.8-flash-tiered')).toBe('gemini-3.8-flash-tiered');
      expect(normalizeGoogleModelId('gemini-3.1-pro-high')).toBe('gemini-3.1-pro-high');
      expect(normalizeGoogleModelId('claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
      expect(normalizeGoogleModelId('models/gemini-3.8-flash-tiered')).toBe('gemini-3.8-flash-tiered');
    });

    it('maps legacy flash models to canonical gemini-3.8-flash-tiered', () => {
      expect(normalizeGoogleModelId('gemini-3.8-flash-tiered')).toBe('gemini-3.8-flash-tiered');
      expect(normalizeGoogleModelId('gemini-3.8-flash-tiered')).toBe('gemini-3.8-flash-tiered');
      expect(normalizeGoogleModelId('gemini-3.8-flash')).toBe('gemini-3.8-flash-tiered');
      expect(normalizeGoogleModelId('gemini-flash')).toBe('gemini-3.8-flash-tiered');
    });

    it('maps legacy pro models to canonical gemini-3.1-pro-high', () => {
      expect(normalizeGoogleModelId('gemini-3.1-pro-high')).toBe('gemini-3.1-pro-high');
      expect(normalizeGoogleModelId('gemini-3.1-pro-high')).toBe('gemini-3.1-pro-high');
      expect(normalizeGoogleModelId('gemini-3.1-pro')).toBe('gemini-3.1-pro-high');
      expect(normalizeGoogleModelId('gemini-pro')).toBe('gemini-3.1-pro-high');
    });

    it('falls back safely for non-Gemini model names routed to Google', () => {
      expect(normalizeGoogleModelId('claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
      expect(normalizeGoogleModelId('gpt-4o')).toBe('gemini-3.8-flash-tiered');
    });

    it('returns canonical default on empty string or nullish input', () => {
      expect(normalizeGoogleModelId('')).toBe('gemini-3.8-flash-tiered');
    });
  });
});

