import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isGeminiCliModel,
  isGoogleCloudCodeModel,
  GEMINI_CLI_CLIENT_ID,
  GEMINI_CLI_CLIENT_SECRET,
  refreshGoogleToken,
  isTokenRevoked,
  clearRevokedTokens,
} from '../services/googleAuth';
import {
  getGoogleAccountPool,
  getAccountQuotaKey,
  setAccountCooldown,
  isAccountInCooldown,
} from '../proxy';
import { parseProvidersSchema } from '../proxy/modelLoader';
import { CustomModel } from '../types';
import https from 'https';
import { EventEmitter } from 'events';

describe('Gemini CLI Integration & Auto-Pool Fusion', () => {
  beforeEach(() => {
    clearRevokedTokens();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Model Identification & Classification', () => {
    it('accurately identifies Gemini CLI models by provider or URL', () => {
      expect(isGeminiCliModel({ provider: 'gemini-cli' })).toBe(true);
      expect(isGeminiCliModel({ provider: 'google', apiUrl: 'https://cloudcode-pa.googleapis.com/v1internal' })).toBe(true);
      expect(isGeminiCliModel({ provider: 'google', apiUrl: 'https://daily-cloudcode-pa.googleapis.com' })).toBe(false);
      expect(isGeminiCliModel({ provider: 'google-gemini' })).toBe(false);
    });

    it('treats Gemini CLI accounts as Cloud Code compatible for account pooling', () => {
      const cliAccount = {
        provider: 'gemini-cli',
        refreshToken: '1//test-cli-refresh-token',
        apiUrl: 'https://cloudcode-pa.googleapis.com/v1internal',
      };
      expect(isGoogleCloudCodeModel(cliAccount)).toBe(true);
    });
  });

  describe('Model Loader & Obsolete Version Filtering', () => {
    it('enforces minimum model >= 3.6 Flash and strips 2.x and 3.1 models for Gemini CLI', () => {
      const parsed = parseProvidersSchema([
        {
          id: 'gemini-cli-preset',
          provider: 'gemini-cli',
          models: [
            { id: 'gemini-3.8-flash-tiered', displayName: 'Gemini 3.8 Flash' },
            { id: 'gemini-3.7-flash-tiered', displayName: 'Gemini 3.7 Flash' },
            { id: 'gemini-3.6-flash-tiered', displayName: 'Gemini 3.6 Flash' },
            { id: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro' },
            { id: 'gemini-3.1-pro-preview', displayName: 'Gemini 3.1 Pro' },
            { id: 'gemini-1.5-flash', displayName: 'Gemini 1.5 Flash' },
          ],
          accounts: [
            { id: 'cli-acc-1', name: 'CLI Account', refreshToken: '1//cli-token-123' },
          ],
        },
      ]);

      const modelNames = parsed.map((m) => m.externalModelName || m.displayName);
      expect(modelNames).toContain('gemini-3.8-flash-tiered');
      expect(modelNames).toContain('gemini-3.7-flash-tiered');
      expect(modelNames).toContain('gemini-3.6-flash-tiered');

      // Crucial: no 2.x, 3.1, or 1.5 models allowed
      for (const name of modelNames) {
        expect(name).not.toMatch(/gemini-2/);
        expect(name).not.toMatch(/gemini-3\.1/);
        expect(name).not.toMatch(/gemini-1/);
      }

      // Individual account models must have _poolOnly: true (hidden from Antigravity dropdown)
      for (const m of parsed) {
        expect(m._poolOnly).toBe(true);
      }
    });
  });

  describe('Account Pooling between Antigravity and Gemini CLI', () => {
    it('pools Antigravity and Gemini CLI accounts together for the same model', () => {
      const antigravityModel: CustomModel = {
        name: 'models/ag-model-1',
        displayName: 'Gemini 3.8 Flash',
        externalModelName: 'gemini-3.8-flash-tiered',
        provider: 'google',
        apiKey: 'none',
        refreshToken: '1//ag-token-1',
        apiUrl: 'https://daily-cloudcode-pa.googleapis.com',
      };

      const geminiCliModel: CustomModel = {
        name: 'models/cli-model-1',
        displayName: 'Gemini 3.8 Flash',
        externalModelName: 'gemini-3.8-flash-tiered',
        provider: 'gemini-cli',
        apiKey: 'none',
        refreshToken: '1//cli-token-2',
        apiUrl: 'https://cloudcode-pa.googleapis.com/v1internal',
      };

      const allModels = [antigravityModel, geminiCliModel];
      const pool = getGoogleAccountPool(antigravityModel, allModels);

      expect(pool.length).toBe(2);
      expect(pool.some((m) => m.provider === 'google')).toBe(true);
      expect(pool.some((m) => m.provider === 'gemini-cli')).toBe(true);
    });

    it('isolates quota keys and cooldowns between Antigravity and Gemini CLI for the same email', () => {
      const email = 'cli-user@example.com';
      const agModel: CustomModel = {
        name: 'models/gemini-3.8-flash-tiered',
        provider: 'google',
        accountEmail: email,
        apiKey: 'ya29.ag-token',
        apiUrl: 'https://daily-cloudcode-pa.googleapis.com',
      };
      const cliModel: CustomModel = {
        name: 'models/gemini-3.8-flash-tiered',
        provider: 'gemini-cli',
        accountEmail: email,
        apiKey: 'ya29.cli-token',
        apiUrl: 'https://cloudcode-pa.googleapis.com/v1internal',
      };

      const agKey = getAccountQuotaKey(agModel);
      const cliKey = getAccountQuotaKey(cliModel);

      // Quota keys must be strictly isolated by provider prefix
      expect(agKey).toBe('google:cli-user@example.com');
      expect(cliKey).toBe('gemini-cli:cli-user@example.com');
      expect(agKey).not.toBe(cliKey);

      // Putting Antigravity account on cooldown must NOT put Gemini CLI on cooldown
      setAccountCooldown(agModel, 3600_000);
      expect(isAccountInCooldown(agModel)).toBe(true);
      expect(isAccountInCooldown(cliModel)).toBe(false);

      // Deduplication in pool preserves BOTH accounts because quota keys differ
      const pool = getGoogleAccountPool(agModel, [agModel, cliModel]);
      expect(pool.length).toBe(2);
    });
  });

  describe('Dual-Client OAuth Token Refresh', () => {
    it('exposes valid Gemini CLI client ID and Secret', () => {
      expect(typeof GEMINI_CLI_CLIENT_ID).toBe('string');
      expect(GEMINI_CLI_CLIENT_ID.endsWith('apps.googleusercontent.com')).toBe(true);
      expect(typeof GEMINI_CLI_CLIENT_SECRET).toBe('string');
      expect(GEMINI_CLI_CLIENT_SECRET.startsWith('GOCSPX-')).toBe(true);
    });

    it('successfully falls back to Gemini CLI client when Antigravity client returns invalid_grant', async () => {
      let callCount = 0;
      const requestMock = vi.spyOn(https, 'request').mockImplementation(((url: any, opts: any, cb: any) => {
        callCount++;
        const clientReq = new EventEmitter() as any;
        clientReq.write = vi.fn();
        clientReq.end = vi.fn().mockImplementation(() => {
          const res = new EventEmitter() as any;
          if (callCount === 1) {
            // First attempt with Antigravity client fails with invalid_grant
            res.statusCode = 400;
            cb(res);
            res.emit('data', Buffer.from(JSON.stringify({ error: 'invalid_grant', error_description: 'Bad Request' })));
            res.emit('end');
          } else {
            // Second attempt with Gemini CLI client succeeds!
            res.statusCode = 200;
            cb(res);
            res.emit('data', Buffer.from(JSON.stringify({ access_token: 'ya29.valid-cli-token', expires_in: 3600 })));
            res.emit('end');
          }
        });
        return clientReq;
      }) as any);

      const token = await refreshGoogleToken('1//test-dual-fallback', true);
      expect(token).toBe('ya29.valid-cli-token');
      expect(callCount).toBe(2);
      expect(isTokenRevoked('1//test-dual-fallback')).toBe(false);
      requestMock.mockRestore();
    });

    it('successfully falls back to Gemini CLI client when Antigravity client returns 401 unauthorized_client', async () => {
      let callCount = 0;
      const requestMock = vi.spyOn(https, 'request').mockImplementation(((url: any, opts: any, cb: any) => {
        callCount++;
        const clientReq = new EventEmitter() as any;
        clientReq.write = vi.fn();
        clientReq.end = vi.fn().mockImplementation(() => {
          const res = new EventEmitter() as any;
          if (callCount === 1) {
            // First attempt with Antigravity client fails with 401 unauthorized_client
            res.statusCode = 401;
            cb(res);
            res.emit('data', Buffer.from(JSON.stringify({ error: 'unauthorized_client', error_description: 'Unauthorized' })));
            res.emit('end');
          } else {
            // Second attempt with Gemini CLI client succeeds!
            res.statusCode = 200;
            cb(res);
            res.emit('data', Buffer.from(JSON.stringify({ access_token: 'ya29.valid-cli-from-401', expires_in: 3600 })));
            res.emit('end');
          }
        });
        return clientReq;
      }) as any);

      const token = await refreshGoogleToken('1//test-401-fallback', true);
      expect(token).toBe('ya29.valid-cli-from-401');
      expect(callCount).toBe(2);
      expect(isTokenRevoked('1//test-401-fallback')).toBe(false);
      requestMock.mockRestore();
    });
  });

  describe('Account-Level Gemini CLI Provider Inheritance', () => {
    it('correctly sets provider and apiUrl to gemini-cli when account specifies provider: gemini-cli under provider-google', () => {
      const parsed = parseProvidersSchema([
        {
          id: 'provider-google',
          provider: 'google',
          apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
          accounts: [
            {
              id: 'acc-normal',
              email: 'ide-user@example.com',
              provider: 'google',
              enabled: true,
            },
            {
              id: 'acc-cli',
              email: 'cli-user@example.com',
              provider: 'gemini-cli',
              enabled: true,
            },
          ],
        },
      ]);

      const normalModels = parsed.filter((m) => (m as any).accountEmail === 'ide-user@example.com');
      const cliModels = parsed.filter((m) => (m as any).accountEmail === 'cli-user@example.com');

      expect(normalModels.length).toBeGreaterThan(0);
      expect(normalModels[0].provider).toBe('google');
      expect(normalModels[0].apiUrl).toContain('daily-cloudcode-pa');

      expect(cliModels.length).toBeGreaterThan(0);
      expect(cliModels[0].provider).toBe('gemini-cli');
      expect(cliModels[0].apiUrl).toContain('cloudcode-pa.googleapis.com/v1internal');
      expect(cliModels[0].apiUrl).not.toContain('daily-cloudcode-pa');
    });
  });
});

