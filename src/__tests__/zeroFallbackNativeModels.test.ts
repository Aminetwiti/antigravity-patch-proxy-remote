import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'http';
import https from 'https';
import { EventEmitter } from 'events';

vi.mock('electron', () => ({
  app: { getPath: () => '/mock/home' },
}));

vi.mock('electron-log/main', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../proxy/dnsResolver', () => ({
  resolveGoogleIp: vi.fn().mockResolvedValue('142.250.180.206'),
}));

import {
  isNativeCloudCodeModel,
  setSessionModelFallback,
  getSessionModelFallback,
  clearSessionModelFallback,
  clearSessionModelFallbacks,
  matchesCustomModel,
  proxyToGoogle,
  markNativeSession,
  getNativeSession,
  recordNativeSessionError,
  clearNativeSessions,
} from '../proxy';
import { isModelOrLabelDisabled } from '../proxy/protoInjector';
import { expandModelsWithEffort } from '../proxy/effortExpander';
import { generateModelPlaceholderId } from '../proxy/idGenerator';
import type { CustomModel } from '../proxy/types';

describe('Strict Zero Fallback on Native Models', () => {
  beforeEach(() => {
    clearSessionModelFallbacks();
    clearNativeSessions();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isNativeCloudCodeModel - Classification Engine', () => {
    it('classifies all original Antigravity models as native', () => {
      // Gemini originals
      expect(isNativeCloudCodeModel('gemini-4-argon')).toBe(true);
      expect(isNativeCloudCodeModel('gemini-4-argon-medium')).toBe(true);
      expect(isNativeCloudCodeModel('gemini-4-argon-thinking')).toBe(true);
      expect(isNativeCloudCodeModel('gemini-3.8-flash')).toBe(true);
      expect(isNativeCloudCodeModel('gemini-3.8-flash-tiered')).toBe(true);
      expect(isNativeCloudCodeModel('gemini-3.8-pro')).toBe(true);
      expect(isNativeCloudCodeModel('gemini-2.5-pro')).toBe(true);
      expect(isNativeCloudCodeModel('gemini-2.5-flash')).toBe(true);

      // Claude originals
      expect(isNativeCloudCodeModel('claude-sonnet-4-6')).toBe(true);
      expect(isNativeCloudCodeModel('claude-sonnet-4.6')).toBe(true);
      expect(isNativeCloudCodeModel('claude-opus-4-6')).toBe(true);
      expect(isNativeCloudCodeModel('claude-opus-4.6')).toBe(true);
      expect(isNativeCloudCodeModel('claude-haiku-4-5')).toBe(true);
      expect(isNativeCloudCodeModel('claude-3-5-sonnet')).toBe(true);
      expect(isNativeCloudCodeModel('claude-3.5-sonnet')).toBe(true);
      expect(isNativeCloudCodeModel('claude-3-7-sonnet')).toBe(true);
      expect(isNativeCloudCodeModel('claude-4-sonnet')).toBe(true);

      // Other Google Cloud Code native models
      expect(isNativeCloudCodeModel('gpt-oss-120b')).toBe(true);
      expect(isNativeCloudCodeModel('gemma-3-27b')).toBe(true);
    });

    it('classifies Antigravity UI display names as native models', () => {
      expect(isNativeCloudCodeModel('Gemini 4 Argon (Medium)')).toBe(true);
      expect(isNativeCloudCodeModel('Gemini 4 Argon (High)')).toBe(true);
      expect(isNativeCloudCodeModel('Gemini 3.8 Flash (Low)')).toBe(true);
      expect(isNativeCloudCodeModel('Gemini 3.8 Flash (Medium)')).toBe(true);
      expect(isNativeCloudCodeModel('Claude Sonnet 4.6 (Thinking)')).toBe(true);
      expect(isNativeCloudCodeModel('Claude Opus 4.6 (Thinking)')).toBe(true);
      expect(isNativeCloudCodeModel('GPT-OSS 120B (Medium)')).toBe(true);
    });

    it('rejects custom models with status dots or pills', () => {
      expect(isNativeCloudCodeModel('🟢 • Gemini 3.8 Flash')).toBe(false);
      expect(isNativeCloudCodeModel('⭐ 🟢 • Claude 3.7 Sonnet')).toBe(false);
      expect(isNativeCloudCodeModel('🔴 [Offline] • Gemini 4 Argon')).toBe(false);
      expect(isNativeCloudCodeModel('🟢 • [Default] Gemini 3.8 Flash')).toBe(false);
    });

    it('handles models/ prefix gracefully', () => {
      expect(isNativeCloudCodeModel('models/gemini-4-argon')).toBe(true);
      expect(isNativeCloudCodeModel('models/claude-sonnet-4-6')).toBe(true);
      expect(isNativeCloudCodeModel('models/Gemini 4 Argon (Medium)')).toBe(true);
    });

    it('NEVER classifies any model with MODEL_PLACEHOLDER_ or custom- prefix as native', () => {
      expect(isNativeCloudCodeModel('MODEL_PLACEHOLDER_M54')).toBe(false);
      expect(isNativeCloudCodeModel('MODEL_PLACEHOLDER_M16')).toBe(false);
      expect(isNativeCloudCodeModel('models/MODEL_PLACEHOLDER_M418')).toBe(false);
      expect(isNativeCloudCodeModel('gemini-3.8-flash-MODEL_PLACEHOLDER_M1')).toBe(false);
      expect(isNativeCloudCodeModel('custom-gemini-3-8-flash')).toBe(false);
      expect(isNativeCloudCodeModel('custom-google-gemini-4-argon')).toBe(false);
    });

    it('does NOT classify third-party or custom models as native Cloud Code', () => {
      expect(isNativeCloudCodeModel('gpt-4o')).toBe(false);
      expect(isNativeCloudCodeModel('deepseek-chat')).toBe(false);
      expect(isNativeCloudCodeModel('deepseek-coder')).toBe(false);
      expect(isNativeCloudCodeModel('my-custom-model')).toBe(false);
      expect(isNativeCloudCodeModel('')).toBe(false);
    });
  });

  describe('matchesCustomModel - Native Model Protection', () => {
    it('refuses to match pure native model identifiers to custom models', () => {
      const mockCustomModel: CustomModel = {
        name: 'models/custom-argon',
        displayName: 'Gemini 4 Argon (Medium)',
        provider: 'google',
        apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: 'test-key',
        externalModelName: 'gemini-4-argon-medium',
      };

      // Native model candidates must NEVER be captured by custom model matcher
      expect(matchesCustomModel(mockCustomModel, 'gemini-4-argon-medium')).toBe(false);
      expect(matchesCustomModel(mockCustomModel, 'models/gemini-4-argon-medium')).toBe(false);
      expect(matchesCustomModel(mockCustomModel, 'gemini-3.8-flash')).toBe(false);
      expect(matchesCustomModel(mockCustomModel, 'claude-sonnet-4-6')).toBe(false);
      expect(matchesCustomModel(mockCustomModel, 'Gemini 4 Argon (Medium)')).toBe(false);
      expect(matchesCustomModel(mockCustomModel, 'Gemini 3.8 Flash (Low)')).toBe(false);
      expect(matchesCustomModel(mockCustomModel, 'Claude Sonnet 4.6 (Thinking)')).toBe(false);

      // Explicit custom slug or placeholder DOES match
      expect(matchesCustomModel(mockCustomModel, 'custom-argon')).toBe(true);
    });
  });

  describe('Session Fallback Purge on Original Models', () => {
    it('strictly refuses to assign a fallback to any native model', () => {
      const convId = 'session-test-purge-123';

      // Attempting to assign a fallback to a native model is strictly rejected
      setSessionModelFallback(convId, 'gemini-4-argon', 'gemini-3.8-flash-tiered', true);
      expect(getSessionModelFallback(convId)).toBeUndefined();
    });

    it('immediately purges any legacy session fallback when clearSessionModelFallback is called', () => {
      const convId = 'session-test-purge-456';

      // If a non-native model had an active fallback in an earlier session
      clearSessionModelFallback(convId);
      expect(getSessionModelFallback(convId)).toBeUndefined();
    });
  });

  describe('proxyToGoogle - Direct Upstream Error Passthrough', () => {
    it('transmits official Google HTTP 429 quota error directly to client without SSE distortion', async () => {
      const official429Body = JSON.stringify({
        error: {
          code: 429,
          message: 'Resource has been exhausted (e.g. check quota).',
          status: 'RESOURCE_EXHAUSTED',
        },
      });

      // Mock upstream https.request to return Google 429
      vi.spyOn(https, 'request').mockImplementation((((...args: any[]) => {
        const callback = args.find(a => typeof a === 'function');
        const clientReq = new EventEmitter() as any;
        clientReq.setTimeout = vi.fn();
        clientReq.write = vi.fn();
        clientReq.destroy = vi.fn();
        clientReq.end = vi.fn().mockImplementation(() => {
          const upstreamRes = new EventEmitter() as any;
          upstreamRes.statusCode = 429;
          upstreamRes.headers = {
            'content-type': 'application/json; charset=UTF-8',
          };
          upstreamRes.pipe = vi.fn((destination: any) => {
            destination.write(Buffer.from(official429Body, 'utf-8'));
            destination.end();
            return destination;
          });
          if (callback) {
            callback(upstreamRes);
          }
        });
        return clientReq;
      }) as any));

      // Incoming request from IDE for a native model stream
      const req = new EventEmitter() as any;
      req.method = 'POST';
      req.url = '/v1internal:streamGenerateContent?alt=sse';
      req.headers = {
        authorization: 'Bearer official-ide-token-123',
        host: '127.0.0.1:51074',
      };

      let writtenStatus = 0;
      let writtenHeaders: any = null;
      let writtenData = '';

      const res = new EventEmitter() as any;
      res.headersSent = false;
      res.writableEnded = false;
      res.writeHead = vi.fn((status: number, headers?: any) => {
        writtenStatus = status;
        writtenHeaders = headers;
        res.headersSent = true;
        return true;
      });
      res.write = vi.fn((chunk: any) => {
        writtenData += chunk.toString();
        return true;
      });
      res.end = vi.fn(() => {
        res.writableEnded = true;
      });

      const reqBody = Buffer.from(JSON.stringify({
        model: 'gemini-4-argon',
        request: { contents: [{ role: 'user', parts: [{ text: 'Hello' }] }] },
      }), 'utf-8');

      await proxyToGoogle(req, res, reqBody, false, undefined, 'conv-test-1');

      // 1. Exact HTTP 429 status code forwarded
      expect(writtenStatus).toBe(429);
      // 2. Exact Google error body piped directly to client
      expect(writtenData).toContain('RESOURCE_EXHAUSTED');
      expect(writtenData).toContain('Resource has been exhausted');
      // 3. ZERO fake SSE STOP event or data: markers generated on error
      expect(writtenData).not.toContain('finishReason');
      expect(writtenData).not.toContain('data:');
    });

    it('transmits official Google HTTP 404 model unavailable error directly to client', async () => {
      const official404Body = JSON.stringify({
        error: {
          code: 404,
          message: 'models/gemini-4-argon is not found for API version v1internal, or is not available on this project.',
          status: 'NOT_FOUND',
        },
      });

      vi.spyOn(https, 'request').mockImplementation((((...args: any[]) => {
        const callback = args.find(a => typeof a === 'function');
        const clientReq = new EventEmitter() as any;
        clientReq.setTimeout = vi.fn();
        clientReq.write = vi.fn();
        clientReq.destroy = vi.fn();
        clientReq.end = vi.fn().mockImplementation(() => {
          const upstreamRes = new EventEmitter() as any;
          upstreamRes.statusCode = 404;
          upstreamRes.headers = {
            'content-type': 'application/json; charset=UTF-8',
          };
          upstreamRes.pipe = vi.fn((destination: any) => {
            destination.write(Buffer.from(official404Body, 'utf-8'));
            destination.end();
            return destination;
          });
          if (callback) {
            callback(upstreamRes);
          }
        });
        return clientReq;
      }) as any));

      const req = new EventEmitter() as any;
      req.method = 'POST';
      req.url = '/v1internal:streamGenerateContent?alt=sse';
      req.headers = {
        authorization: 'Bearer official-ide-token-123',
        host: '127.0.0.1:51074',
      };

      let writtenStatus = 0;
      let writtenData = '';

      const res = new EventEmitter() as any;
      res.headersSent = false;
      res.writableEnded = false;
      res.writeHead = vi.fn((status: number) => {
        writtenStatus = status;
        res.headersSent = true;
        return true;
      });
      res.write = vi.fn((chunk: any) => {
        writtenData += chunk.toString();
        return true;
      });
      res.end = vi.fn(() => {
        res.writableEnded = true;
      });

      const reqBody = Buffer.from(JSON.stringify({
        model: 'gemini-4-argon-medium',
        request: { contents: [{ role: 'user', parts: [{ text: 'Hello Argon' }] }] },
      }), 'utf-8');

      await proxyToGoogle(req, res, reqBody, false, undefined, 'conv-argon-404');

      expect(writtenStatus).toBe(404);
      expect(writtenData).toContain('NOT_FOUND');
      expect(writtenData).toContain('models/gemini-4-argon is not found');
      expect(writtenData).not.toContain('gemini-3.8-flash-tiered');
    });
  });

  describe('Native Session Registry & Error Preservation', () => {
    it('records native session models and manages TTL properly', () => {
      const sessKey = 'sess-test-native-1';
      markNativeSession(sessKey, 'gemini-4-argon-high');

      const record = getNativeSession(sessKey);
      expect(record).toBeDefined();
      expect(record?.originalModel).toBe('gemini-4-argon-high');

      // Records error correctly
      const errBuffer = Buffer.from(JSON.stringify({ error: { code: 429, message: 'Resource exhausted' } }));
      recordNativeSessionError(sessKey, 429, { 'content-type': 'application/json' }, errBuffer);

      const updated = getNativeSession(sessKey);
      expect(updated?.lastError?.statusCode).toBe(429);
      expect(updated?.lastError?.body.toString()).toContain('Resource exhausted');

      // Clear sessions
      clearNativeSessions();
      expect(getNativeSession(sessKey)).toBeUndefined();
    });

    it('identifies and blocks automated fallback within turn window on native sessions', () => {
      const sessKey = 'sess-argon-fallback-test';
      markNativeSession(sessKey, 'gemini-4-argon-high');

      const upstream429 = Buffer.from(JSON.stringify({
        error: { code: 429, message: 'Resource has been exhausted (e.g. check quota).', status: 'RESOURCE_EXHAUSTED' }
      }));
      recordNativeSessionError(sessKey, 429, { 'content-type': 'application/json' }, upstream429, 'gemini-4-argon-high');

      // 100ms later: Language Server sends automated fallback request for Flash
      const activeNative = getNativeSession(sessKey);
      expect(activeNative).toBeDefined();
      expect(activeNative?.originalModel).toBe('gemini-4-argon-high');
      expect(activeNative?.lastError?.statusCode).toBe(429);
      expect(activeNative?.lastError?.body.toString()).toContain('RESOURCE_EXHAUSTED');

      // Turn window is active (< 2 minutes)
      const timeSince = Date.now() - activeNative!.lastSeen;
      expect(timeSince).toBeLessThan(120000);
    });

    it('preserves original model even if recordNativeSessionError is called before markNativeSession', () => {
      const sessKey = 'sess-sessid-before-mark';
      const upstream404 = Buffer.from(JSON.stringify({ error: { code: 404, message: 'Model not found' } }));
      recordNativeSessionError(sessKey, 404, { 'content-type': 'application/json' }, upstream404, 'gemini-4-argon');

      const record = getNativeSession(sessKey);
      expect(record).toBeDefined();
      expect(record?.originalModel).toBe('gemini-4-argon');
      expect(record?.lastError?.statusCode).toBe(404);
    });

    it('protects Claude Sonnet 4.6 and other native models from automated fallback', () => {
      const sessKey = 'sess-claude-fallback-test';
      markNativeSession(sessKey, 'claude-sonnet-4-6');

      const upstream429 = Buffer.from(JSON.stringify({
        error: { code: 429, message: 'Resource has been exhausted (e.g. check quota).', status: 'RESOURCE_EXHAUSTED' }
      }));
      recordNativeSessionError(sessKey, 429, { 'content-type': 'application/json' }, upstream429, 'claude-sonnet-4-6');

      const activeNative = getNativeSession(sessKey);
      expect(activeNative).toBeDefined();
      expect(activeNative?.originalModel).toBe('claude-sonnet-4-6');
      expect(activeNative?.lastError?.statusCode).toBe(429);
      expect(activeNative?.lastError?.body.toString()).toContain('RESOURCE_EXHAUSTED');

      // Also records even if called without prior markNativeSession
      const sessKey2 = 'sess-claude-no-mark';
      recordNativeSessionError(sessKey2, 429, { 'content-type': 'application/json' }, upstream429, 'claude-sonnet-4-6');
      const activeNative2 = getNativeSession(sessKey2);
      expect(activeNative2).toBeDefined();
      expect(activeNative2?.originalModel).toBe('claude-sonnet-4-6');
      expect(activeNative2?.lastError?.statusCode).toBe(429);
    });
  });

  describe('isModelOrLabelDisabled - Native Model Immunity', () => {
    it('refuses to disable or strip official native Gemini models even if present in disabledSet', () => {
      const disabledSet = new Set<string>([
        'gemini-4-argon-medium',
        'gemini-4-argon',
        'gemini-3.8-flash',
      ]);

      // Native Gemini models must NEVER be disabled by custom provider toggles
      expect(isModelOrLabelDisabled('gemini-4-argon-medium', 'Gemini 4 Argon (Medium)', disabledSet)).toBe(false);
      expect(isModelOrLabelDisabled('gemini-4-argon-high', 'Gemini 4 Argon (High)', disabledSet)).toBe(false);
      expect(isModelOrLabelDisabled('gemini-3.8-flash', 'Gemini 3.8 Flash', disabledSet)).toBe(false);
      expect(isModelOrLabelDisabled('gemini-3.8-flash-low', 'Gemini 3.8 Flash (Low)', disabledSet)).toBe(false);

      // Custom models or third-party models CAN be disabled
      expect(isModelOrLabelDisabled('custom-gemini-argon', 'Custom Argon', new Set(['custom-gemini-argon']))).toBe(true);
      expect(isModelOrLabelDisabled('deepseek-chat', 'DeepSeek-V3', new Set(['deepseek-chat']))).toBe(true);

      // Claude models can be explicitly toggled off by users
      expect(isModelOrLabelDisabled('claude-sonnet-4-6', 'Claude Sonnet 4.6 (Thinking)', new Set(['claude-sonnet-4-6']))).toBe(true);
    });
  });

  describe('Candidate Names Matching Audit', () => {
    it('tests which candidate names match models from custom_models.json', () => {
      const customModelsPath = 'C:/Users/amine/.gemini/antigravity/custom_models.json';
      const fs = require('fs');
      if (!fs.existsSync(customModelsPath)) return;

      const raw = JSON.parse(fs.readFileSync(customModelsPath, 'utf-8'));
      const candidates = [
        'models/model_placeholder_m50',
        'models/model_placeholder_m563',
        'model_placeholder_m50',
        'model_placeholder_m563',
        'gemini-3.8-flash-tiered',
        'models/gemini-3.8-flash-tiered',
        'gemini-3.8-flash',
        'models/gemini-3.8-flash',
        'Gemini 3.8 Flash (Low)',
        'gemini-3.8-flash-low',
        'gemini-4-argon-medium',
        'gemini-4-argon-high',
        'gemini-4-argon',
      ];

      const allModels: CustomModel[] = [];
      for (const p of raw.providers || []) {
        for (const m of (p.models || [])) {
          allModels.push({
            provider: p.provider,
            apiUrl: p.apiUrl,
            externalModelName: m.id,
            displayName: m.displayName,
            name: m.id,
          });
        }
        for (const a of (p.accounts || [])) {
          for (const m of (a.models || [])) {
            allModels.push({
              provider: p.provider,
              apiUrl: p.apiUrl,
              externalModelName: m.id,
              displayName: m.displayName,
              name: m.id,
              accountEmail: a.email,
              accountName: a.name,
            });
          }
        }
      }

      const expanded = expandModelsWithEffort(allModels);
      console.log('Total expanded models:', expanded.length);

      for (const cand of candidates) {
        const isNative = isNativeCloudCodeModel(cand.replace(/^models\//, ''));
        const matches = expanded.filter((m: any) => matchesCustomModel(m, cand));
        if (isNative) {
          // Strict Zero Fallback: Native models must NEVER match custom pool entries!
          expect(matches.length).toBe(0);
        }
      }
    });
  });

  describe('Placeholder Case Insensitivity & Custom Immunity', () => {
    it('matches placeholder IDs regardless of case and models/ prefix', () => {
      const mockModel: CustomModel = {
        name: 'models/custom-test',
        displayName: 'Gemini 3.8 Flash (Medium)',
        provider: 'google',
        externalModelName: 'gemini-3.8-flash-tiered',
        _effortSuffix: '-medium',
      };
      const placeholder = generateModelPlaceholderId(mockModel);
      expect(placeholder).toMatch(/^MODEL_PLACEHOLDER_/);

      // Exact match
      expect(matchesCustomModel(mockModel, placeholder)).toBe(true);
      expect(matchesCustomModel(mockModel, `models/${placeholder}`)).toBe(true);

      // Lowercase match
      const lowerPlaceholder = placeholder.toLowerCase();
      expect(matchesCustomModel(mockModel, lowerPlaceholder)).toBe(true);
      expect(matchesCustomModel(mockModel, `models/${lowerPlaceholder}`)).toBe(true);
    });

    it('ensures custom placeholder models are NEVER classified as native cloud code', () => {
      expect(isNativeCloudCodeModel('MODEL_PLACEHOLDER_M319')).toBe(false);
      expect(isNativeCloudCodeModel('model_placeholder_m319')).toBe(false);
      expect(isNativeCloudCodeModel('models/model_placeholder_m319')).toBe(false);
      expect(isNativeCloudCodeModel('models/model_placeholder_m50')).toBe(false);
    });
  });
});

