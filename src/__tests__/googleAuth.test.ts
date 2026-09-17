import { describe, it, expect } from 'vitest';
import {
  normalizeCloudCodeModelId,
  isGoogleCloudCodeModel,
  normalizeGoogleModelId,
  sanitizeCloudCodeGenerationConfig,
  normalizeConversationTurns,
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

    it('maps alias models to canonical Cloud Code models', () => {
      expect(normalizeCloudCodeModelId('claude-sonnet')).toBe('claude-sonnet-4-6');
      expect(normalizeCloudCodeModelId('gemini-flash')).toBe('gemini-3.8-flash-tiered');
      expect(normalizeCloudCodeModelId('gemini-pro')).toBe('gemini-3.1-pro-high');
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

    it('normalizes trailing model turns so request ends on a user turn without losing history', () => {
      const payload: Record<string, unknown> = {
        contents: [
          { role: 'user', parts: [{ text: 'hello' }] },
          { role: 'model', parts: [{ text: 'hi' }] },
        ],
      };
      sanitizeCloudCodeGenerationConfig(payload, 'claude-sonnet-4-6');
      const contents = payload.contents as any[];
      expect(contents.length).toBe(3);
      expect(contents[0]).toEqual({ role: 'user', parts: [{ text: 'hello' }] });
      expect(contents[1]).toEqual({ role: 'model', parts: [{ text: 'hi' }] });
      expect(contents[2]).toEqual({ role: 'user', parts: [{ text: 'Continue.' }] });
      expect(contents[contents.length - 1].role).toBe('user');
    });

    it('normalizes functionResponse with model role to user role to prevent turn alternation failure', () => {
      const payload: Record<string, unknown> = {
        contents: [
          { role: 'user', parts: [{ text: 'run tool' }] },
          { role: 'model', parts: [{ functionCall: { name: 'run_command', args: {} } }] },
          { role: 'model', parts: [{ functionResponse: { name: 'run_command', response: { output: 'ok' } } }] },
        ],
      };
      sanitizeCloudCodeGenerationConfig(payload, 'claude-sonnet-4-6');
      const contents = payload.contents as any[];
      expect(contents.length).toBe(3);
      expect(contents[0].role).toBe('user');
      expect(contents[1].role).toBe('model');
      expect(contents[2].role).toBe('user');
    });

    it('prunes truly empty dummy turns at the end', () => {
      const payload: Record<string, unknown> = {
        contents: [
          { role: 'user', parts: [{ text: 'hello' }] },
          { role: 'model', parts: [] },
        ],
      };
      sanitizeCloudCodeGenerationConfig(payload, 'claude-sonnet-4-6');
      const contents = payload.contents as any[];
      expect(contents.length).toBe(1);
      expect(contents[0].role).toBe('user');
    });

    it('strips historical thinking blocks and thought signatures for Claude models', () => {
      const payload: Record<string, unknown> = {
        contents: [
          {
            role: 'user',
            parts: [{ text: 'write code' }],
          },
          {
            role: 'model',
            parts: [
              { thought: true, text: 'Thinking about the code...', thoughtSignature: 'sig_bad' },
              { type: 'thinking', thinking: 'Internal reasoning...', signature: 'sig_bad2' },
              { text: 'Here is the code:', thought_signature: 'sig_gemini' },
              { functionCall: { name: 'run_command', args: { cmd: 'ls' } }, thoughtSignature: 'sig_bad3' },
            ],
          },
          {
            role: 'user',
            parts: [{ text: 'continue' }],
          },
        ],
      };
      sanitizeCloudCodeGenerationConfig(payload, 'claude-sonnet-4-6');
      const modelTurn = (payload.contents as any[])[1];
      expect(modelTurn.parts.length).toBe(2);
      expect(modelTurn.parts[0].text).toBe('Here is the code:');
      expect(modelTurn.parts[0].thought_signature).toBeUndefined();
      expect(modelTurn.parts[1].functionCall.name).toBe('run_command');
      expect(modelTurn.parts[1].thoughtSignature).toBeUndefined();
    });

    it('preserves thought parts for Gemini models', () => {
      const payload: Record<string, unknown> = {
        contents: [
          {
            role: 'model',
            parts: [
              { thought: true, text: 'Gemini thinking...', thought_signature: 'sig_gemini' },
              { text: 'Gemini answer' },
            ],
          },
          {
            role: 'user',
            parts: [{ text: 'next' }],
          },
        ],
      };
      sanitizeCloudCodeGenerationConfig(payload, 'gemini-3.8-flash-tiered');
      const modelTurn = (payload.contents as any[])[0];
      expect(modelTurn.parts.length).toBe(2);
      expect(modelTurn.parts[0].thought).toBe(true);
      expect(modelTurn.parts[0].thought_signature).toBe('sig_gemini');
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

  describe('normalizeConversationTurns', () => {
    it('converts functionResponse turns with model role to user role', () => {
      const contents = [
        { role: 'user', parts: [{ text: 'Check files' }] },
        { role: 'model', parts: [{ functionCall: { name: 'list_dir', args: {} } }] },
        { role: 'model', parts: [{ functionResponse: { name: 'list_dir', response: { files: [] } } }] },
      ];
      const modified = normalizeConversationTurns(contents);
      expect(modified).toBe(true);
      expect(contents.length).toBe(3);
      expect(contents[0].role).toBe('user');
      expect(contents[1].role).toBe('model');
      expect(contents[2].role).toBe('user');
    });

    it('merges consecutive model turns to enforce alternation', () => {
      const contents = [
        { role: 'user', parts: [{ text: 'Hello' }] },
        { role: 'model', parts: [{ text: 'Part 1' }] },
        { role: 'model', parts: [{ text: 'Part 2' }] },
      ];
      const modified = normalizeConversationTurns(contents);
      expect(modified).toBe(true);
      // Merged into 1 model turn, then closed with 'Continue.'
      expect(contents.length).toBe(3);
      expect(contents[0].role).toBe('user');
      expect(contents[1].role).toBe('model');
      expect(contents[1].parts.length).toBe(2);
      expect(contents[2].role).toBe('user');
      expect(contents[2].parts[0].text).toBe('Continue.');
    });

    it('preserves model tool calls and closes with Continue user turn instead of popping', () => {
      const contents = [
        { role: 'user', parts: [{ text: 'Run tests' }] },
        { role: 'model', parts: [{ functionCall: { name: 'run_command', args: { cmd: 'npm test' } } }] },
      ];
      const modified = normalizeConversationTurns(contents);
      expect(modified).toBe(true);
      expect(contents.length).toBe(3);
      expect(contents[0].role).toBe('user');
      expect(contents[1].role).toBe('model');
      expect(contents[1].parts[0].functionCall.name).toBe('run_command');
      expect(contents[2].role).toBe('user');
      expect(contents[2].parts[0].text).toBe('Continue.');
    });

    it('prunes empty dummy turns from the end', () => {
      const contents = [
        { role: 'user', parts: [{ text: 'Hello' }] },
        { role: 'model', parts: [] },
      ];
      const modified = normalizeConversationTurns(contents);
      expect(modified).toBe(true);
      expect(contents.length).toBe(1);
      expect(contents[0].role).toBe('user');
    });

    it('handles empty contents by creating an initial user turn', () => {
      const contents: any[] = [];
      const modified = normalizeConversationTurns(contents);
      expect(modified).toBe(false);
    });
  });
});

