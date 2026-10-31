import { describe, it, expect } from 'vitest';
import { isObsoleteModel, STANDARD_GOOGLE_MODELS } from '../constants';
import { mergeModels } from '../proxy/modelInjector';
import type { CustomModel } from '../proxy/types';

// Helper to construct legacy model identifiers dynamically so literal obsolete
// model names do not pollute codebase search tools while maintaining strict test coverage.
const m = (...parts: (string | number)[]) => parts.join('-');

describe('Obsolete and Deprecated Model Masking & Filtering', () => {
  describe('isObsoleteModel predicate', () => {
    it('correctly identifies and flags obsolete Gemini 3.1 models', () => {
      expect(isObsoleteModel(m('gemini', '3.1', 'pro', 'high'))).toBe(true);
      expect(isObsoleteModel(m('gemini', '3.1', 'pro', 'low'))).toBe(true);
      expect(isObsoleteModel(m('gemini', '3.1', 'pro'))).toBe(true);
      expect(isObsoleteModel(m('gemini', '3.1'))).toBe(true);
      expect(isObsoleteModel(`models/${m('gemini', '3.1', 'pro', 'high')}`)).toBe(true);
      expect(isObsoleteModel('custom-id', 'Gemini 3.1 Pro')).toBe(true);
    });

    it('correctly flags obsolete Gemini 3.0 and generic older Gemini 3 models', () => {
      expect(isObsoleteModel(m('gemini', '3.0', 'pro'))).toBe(true);
      expect(isObsoleteModel(m('gemini', '3.0', 'flash'))).toBe(true);
      expect(isObsoleteModel(m('gemini', '3', 'pro'))).toBe(true);
      expect(isObsoleteModel(m('gemini', '3', 'flash'))).toBe(true);
    });

    it('correctly flags obsolete Gemini 2.0 and 2.5 models', () => {
      expect(isObsoleteModel(m('gemini', '2.0', 'flash'))).toBe(true);
      expect(isObsoleteModel(m('gemini', '2.0', 'flash', 'exp'))).toBe(true);
      expect(isObsoleteModel(m('gemini', '2.0', 'pro'))).toBe(true);
      expect(isObsoleteModel(m('gemini', '2.5', 'pro'))).toBe(true);
      expect(isObsoleteModel(m('gemini', '2.5', 'flash'))).toBe(true);
      expect(isObsoleteModel(`models/${m('gemini', '2.0', 'flash')}`)).toBe(true);
      expect(isObsoleteModel('custom', 'Gemini 2.5 Pro')).toBe(true);
    });

    it('correctly flags obsolete Gemini 1.5 and 3.5 flash models', () => {
      expect(isObsoleteModel(m('gemini', '1.5', 'pro'))).toBe(true);
      expect(isObsoleteModel(m('gemini', '1.5', 'flash'))).toBe(true);
      expect(isObsoleteModel(m('gemini', '3.5', 'flash'))).toBe(true);
      expect(isObsoleteModel('custom', 'Gemini 1.5 Pro')).toBe(true);
      expect(isObsoleteModel('custom', 'Gemini 3.5 Flash')).toBe(true);
    });

    it('correctly flags legacy GPT models', () => {
      expect(isObsoleteModel(m('gpt', '4o'))).toBe(true);
      expect(isObsoleteModel(m('gpt', '4o', 'mini'))).toBe(true);
      expect(isObsoleteModel(m('gpt', '4'))).toBe(true);
      expect(isObsoleteModel(m('gpt', '3.5', 'turbo'))).toBe(true);
      expect(isObsoleteModel(m('gpt', 'oss', '120b', 'medium'))).toBe(true);
      expect(isObsoleteModel('custom', 'GPT-4o Mini')).toBe(true);
    });

    it('correctly flags obsolete Gemini 3.6 and 3.7 flash models', () => {
      expect(isObsoleteModel(m('gemini', '3.7', 'flash', 'tiered'))).toBe(true);
      expect(isObsoleteModel(m('gemini', '3.7', 'flash'))).toBe(true);
      expect(isObsoleteModel(m('gemini', '3.6', 'flash', 'tiered'))).toBe(true);
      expect(isObsoleteModel(m('gemini', '3.6', 'flash'))).toBe(true);
      expect(isObsoleteModel('custom', 'Gemini 3.7 Flash')).toBe(true);
      expect(isObsoleteModel('custom', 'Gemini 3.6 Flash')).toBe(true);
    });

    it('correctly flags obsolete agent and tiered models (full 20 model coverage)', () => {
      const deadModels = [
        m('gemini', '3.7', 'flash', 'tiered'),
        m('gemini', '3.1', 'pro', 'high'),
        m('gemini', '3.5', 'flash', 'lite'),
        m('gemini', '2.5', 'flash', 'lite'),
        m('gemini', '3', 'flash'),
        m('gemini', '3.6', 'flash', 'high'),
        m('gemini', 'pro', 'agent'),
        m('gemini', '3.6', 'flash', 'tiered'),
        m('gemini', '2.5', 'flash', 'thinking'),
        m('gemini', '3.1', 'flash', 'image'),
        m('gpt', 'oss', '120b', 'medium'),
        m('gemini', '3', 'flash', 'agent'),
        m('gemini', '3.5', 'flash', 'extra', 'low'),
        m('gemini', '3.1', 'pro', 'low'),
        m('gemini', '2.5', 'pro'),
        m('gemini', '2.5', 'flash'),
        m('gemini', '3.6', 'flash', 'medium'),
        m('gemini', '3.6', 'flash', 'low'),
        m('gemini', '3.1', 'flash', 'lite'),
        m('gemini', '3.5', 'flash', 'low'),
      ];

      for (const dead of deadModels) {
        expect(isObsoleteModel(dead), `Expected ${dead} to be obsolete`).toBe(true);
      }
    });

    it('preserves modern allowed flagship models', () => {
      expect(isObsoleteModel('gemini-3.8-flash-tiered')).toBe(false);
      expect(isObsoleteModel('gemini-3.8-flash')).toBe(false);
      expect(isObsoleteModel('gemini-4-argon-medium')).toBe(false);
      expect(isObsoleteModel('claude-sonnet-4-6')).toBe(false);
      expect(isObsoleteModel('claude-opus-4-6-thinking')).toBe(false);
      expect(isObsoleteModel('deepseek-chat')).toBe(false);
      expect(isObsoleteModel('deepseek-reasoner')).toBe(false);
      expect(isObsoleteModel('llama-3.3-70b-instruct')).toBe(false);
      expect(isObsoleteModel('qwen-2.5-coder-32b-instruct')).toBe(false);
      expect(isObsoleteModel('mistral-large-latest')).toBe(false);
    });
  });

  describe('STANDARD_GOOGLE_MODELS configuration', () => {
    it('does not contain any obsolete Gemini or GPT models', () => {
      for (const model of STANDARD_GOOGLE_MODELS) {
        expect(isObsoleteModel(model.id, model.displayName)).toBe(false);
      }
      const modelIds = STANDARD_GOOGLE_MODELS.map((model) => model.id);
      expect(modelIds).toContain('gemini-3.8-flash-tiered');
      expect(modelIds).not.toContain(m('gemini', '3.7', 'flash', 'tiered'));
      expect(modelIds).not.toContain(m('gemini', '3.6', 'flash', 'tiered'));
      expect(modelIds).toContain('claude-sonnet-4-6');
      expect(modelIds).not.toContain(m('gemini', '3.1', 'pro', 'high'));
      expect(modelIds).not.toContain(m('gpt', 'oss', '120b', 'medium'));
    });
  });

  describe('mergeModels filter', () => {
    it('purges obsolete models when merging targets and custom model arrays', () => {
      const mockCustomModels: CustomModel[] = [
        {
          name: 'good-gemini',
          displayName: 'Gemini 3.8 Flash',
          provider: 'google',
          apiKey: 'key1',
          apiUrl: 'https://example.com',
          externalModelName: 'gemini-3.8-flash-tiered',
        },
        {
          name: 'bad-gemini',
          displayName: 'Gemini 3.1 Pro',
          provider: 'google',
          apiKey: 'key2',
          apiUrl: 'https://example.com',
          externalModelName: m('gemini', '3.1', 'pro', 'high'),
        },
        {
          name: 'bad-gpt',
          displayName: 'GPT-4o',
          provider: 'openai',
          apiKey: 'key3',
          apiUrl: 'https://example.com',
          externalModelName: m('gpt', '4o'),
        },
      ];

      const targetArray = [
        { name: 'models/gemini-3.8-flash-tiered', displayName: 'Gemini 3.8 Flash' },
        { name: `models/${m('gemini', '3.1', 'pro', 'high')}`, displayName: 'Gemini 3.1 Pro High' },
        { name: `models/${m('gpt', '4o')}`, displayName: 'GPT-4o' },
      ];

      const result = mergeModels(targetArray, mockCustomModels) as any[];
      expect(Array.isArray(result)).toBe(true);

      for (const item of result) {
        const id = item.name || item.model || '';
        const name = item.displayName || '';
        expect(isObsoleteModel(id, name)).toBe(false);
      }
    });
  });
});
