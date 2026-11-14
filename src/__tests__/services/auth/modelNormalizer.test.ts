import { describe, it, expect } from 'vitest';
import {
  normalizeCloudCodeModelId,
  normalizeGoogleModelId,
} from '../../../services/auth/modelNormalizer';

describe('modelNormalizer', () => {
  describe('normalizeCloudCodeModelId', () => {
    it('returns default model for empty or null inputs', () => {
      expect(normalizeCloudCodeModelId('')).toBe('gemini-3.8-flash-tiered');
      expect(normalizeCloudCodeModelId(undefined as any)).toBe('gemini-3.8-flash-tiered');
    });

    it('handles case-insensitivity correctly for valid cloud code models', () => {
      expect(normalizeCloudCodeModelId('GEMINI-3.8-FLASH-TIERED')).toBe('gemini-3.8-flash-tiered');
      expect(normalizeCloudCodeModelId('Claude-Sonnet-4-6')).toBe('claude-sonnet-4-6');
      expect(normalizeCloudCodeModelId('CLAUDE-OPUS-4-6-THINKING')).toBe('claude-opus-4-6-thinking');
      expect(normalizeCloudCodeModelId('Gemini-4-Argon-High')).toBe('gemini-4-argon-high');
    });

    it('strips models/ prefix and trims whitespace with varying cases', () => {
      expect(normalizeCloudCodeModelId('  models/Claude-Sonnet-4-6  ')).toBe('claude-sonnet-4-6');
      expect(normalizeCloudCodeModelId('models/GEMINI-4-ARGON-MEDIUM')).toBe('gemini-4-argon-medium');
    });

    it('maps legacy and alias names properly regardless of case', () => {
      expect(normalizeCloudCodeModelId('gemini-3.8-flash')).toBe('gemini-3.8-flash-tiered');
      expect(normalizeCloudCodeModelId('GEMINI-3.8-FLASH-HIGH')).toBe('gemini-3.8-flash-tiered');
      expect(normalizeCloudCodeModelId('gemini-3.8-flash-medium')).toBe('gemini-3.8-flash-tiered');
      expect(normalizeCloudCodeModelId('gemini-3.8-flash-low')).toBe('gemini-3.8-flash-tiered');
      expect(normalizeCloudCodeModelId('claude-sonnet')).toBe('claude-sonnet-4-6');
      expect(normalizeCloudCodeModelId('Claude-Opus')).toBe('claude-opus-4-6-thinking');
    });

    it('correctly falls back for generic keywords (opus, claude/sonnet, argon)', () => {
      expect(normalizeCloudCodeModelId('my-custom-opus-model')).toBe('claude-opus-4-6-thinking');
      expect(normalizeCloudCodeModelId('my-custom-opus-5-5-preview')).toBe('claude-opus-5-5');
      expect(normalizeCloudCodeModelId('custom-sonnet-model')).toBe('claude-sonnet-4-6');
      expect(normalizeCloudCodeModelId('custom-sonnet-5.5-pro')).toBe('claude-sonnet-5-5');
      expect(normalizeCloudCodeModelId('argon-test-low')).toBe('gemini-4-argon-low');
      expect(normalizeCloudCodeModelId('argon-test-medium')).toBe('gemini-4-argon-medium');
      expect(normalizeCloudCodeModelId('argon-test')).toBe('gemini-4-argon-high');
    });
  });

  describe('normalizeGoogleModelId', () => {
    it('returns default model for empty input', () => {
      expect(normalizeGoogleModelId('')).toBe('gemini-3.8-flash-tiered');
    });

    it('normalizes valid models and handles case insensitivity', () => {
      expect(normalizeGoogleModelId('GEMINI-4-ARGON-HIGH')).toBe('gemini-4-argon-high');
      expect(normalizeGoogleModelId('claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
      expect(normalizeGoogleModelId('models/GEMINI-3.8-FLASH-TIERED')).toBe('gemini-3.8-flash-tiered');
    });
  });
});
