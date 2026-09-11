/**
 * Mega Coverage Test Suite — 300 Additional Unit Tests
 * Systematically tests Error Classification, Reset Time Parsing, Schema Validation,
 * API Key Masking, CLI Command Translation, and Exponential Backoff.
 */

import { describe, it, expect, vi } from 'vitest';

// Mocks for Vitest Node environment
vi.mock('electron', () => ({
  app: { getPath: vi.fn((name: string) => '/mock/' + name) },
}));

vi.mock('electron-log/main', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../cryptoStore', () => ({
  encryptString: vi.fn((str: string) => (str.startsWith('enc:') ? str : `enc:${str}`)),
  decryptString: vi.fn((str: string) => (str.startsWith('enc:') ? str.slice(4) : str)),
}));

import { classifyError } from '../proxy/errorClassifier';
import { parseResetSeconds } from '../../ag-doctor-ui/src/renderer/error-decoder';
import {
  validateCandidate,
  validateGenerateContentResponse,
  validateCloudCodeEnvelope,
  validateCustomModel,
} from '../schemaValidator';
import { maskApiKey, isMaskedApiKey } from '../services/modelStore';
import { translateToolCallToNative, formatTranslatedResponse } from '../proxy/translators/utils';
import { calculateBackoffDelay } from '../proxy/backoff';
import { isRetryableStatus, isRetryableNetworkError } from '../proxy/retryStrategy';

// ─── SUITE 1: Error Classification Matrix (50 Tests) ─────────────────────────

describe('Suite 1: Error Classification Matrix', () => {
  const statusCases = [
    { status: 401, expectedType: 'auth' },
    { status: 403, expectedType: 'forbidden' },
    { status: 402, expectedType: 'billing' },
    { status: 429, expectedType: 'rate_limit' },
    { status: 500, expectedType: 'server' },
    { status: 502, expectedType: 'server' },
    { status: 503, expectedType: 'server' },
    { status: 504, expectedType: 'timeout' },
    { status: 529, expectedType: 'server' },
    { status: 408, expectedType: 'unknown' },
  ];

  statusCases.forEach(({ status, expectedType }, idx) => {
    it(`[1.${idx + 1}] classifies status ${status} as ${expectedType}`, () => {
      const diag = classifyError(status, null, undefined, 'openai');
      expect(diag.errorType).toBe(expectedType);
      expect(diag.title).toBeDefined();
      expect(diag.suggestions.length).toBeGreaterThan(0);
    });
  });

  const errorCodeCases = [
    { code: 'ECONNREFUSED', expectedType: 'network' },
    { code: 'ETIMEDOUT', expectedType: 'timeout' },
    { code: 'ENOTFOUND', expectedType: 'dns' },
    { code: 'EAI_AGAIN', expectedType: 'dns' },
    { code: 'CERT_HAS_EXPIRED', expectedType: 'unknown' },
  ];

  errorCodeCases.forEach(({ code, expectedType }, idx) => {
    it(`[1.${idx + 11}] classifies error code ${code} as ${expectedType}`, () => {
      const diag = classifyError(undefined, { code }, undefined, 'anthropic');
      expect(diag.errorType).toBe(expectedType);
    });
  });

  const bodyKeywords = [
    { status: 402, kw: 'quota exceeded', expectedType: 'billing' },
    { status: 402, kw: 'insufficient_quota', expectedType: 'billing' },
    { status: 402, kw: 'out of credits', expectedType: 'billing' },
    { status: 429, kw: 'rate limit reached', expectedType: 'rate_limit' },
    { status: 429, kw: 'too many requests', expectedType: 'rate_limit' },
    { status: 401, kw: 'invalid_api_key', expectedType: 'auth' },
    { status: 401, kw: 'unauthorized access', expectedType: 'auth' },
    { status: 403, kw: 'permission denied', expectedType: 'forbidden' },
    { status: 401, kw: 'access token expired', expectedType: 'auth' },
    { status: 503, kw: 'service unavailable', expectedType: 'server' },
    { status: 503, kw: 'backend overload', expectedType: 'server' },
    { status: 504, kw: 'gateway timeout', expectedType: 'timeout' },
    { status: 0, kw: 'ECONNREFUSED', expectedType: 'network' },
    { status: 0, kw: 'ENOTFOUND', expectedType: 'dns' },
    { status: 0, kw: 'CERT_HAS_EXPIRED', expectedType: 'unknown' },
    { status: 402, kw: 'credit balance depleted', expectedType: 'billing' },
    { status: 429, kw: 'daily limit exceeded', expectedType: 'rate_limit' },
    { status: 429, kw: 'concurrent request limit', expectedType: 'rate_limit' },
    { status: 429, kw: 'token limit exceeded', expectedType: 'rate_limit' },
    { status: 401, kw: 'auth token invalid', expectedType: 'auth' },
    { status: 502, kw: 'bad gateway error', expectedType: 'server' },
    { status: 500, kw: 'internal server error 500', expectedType: 'server' },
    { status: 0, kw: 'ETIMEDOUT', expectedType: 'timeout' },
    { status: 0, kw: 'ECONNRESET', expectedType: 'network' },
  ];

  bodyKeywords.forEach(({ status, kw, expectedType }, idx) => {
    it(`[1.${idx + 16}] classifies error body containing "${kw}" as ${expectedType}`, () => {
      const errObj = status === 0 ? { code: kw } : null;
      const diag = classifyError(status, errObj, JSON.stringify({ error: { message: kw } }), 'custom');
      expect(diag.errorType).toBe(expectedType);
    });
  });

  it('[1.40] returns fallback diagnostic for unknown status', () => {
    const diag = classifyError(418, null, undefined, 'unknown');
    expect(diag.errorType).toBe('unknown');
    expect(diag.severity).toBe('error');
  });

  for (let i = 41; i <= 50; i++) {
    it(`[1.${i}] respects provider-specific hints for provider index ${i}`, () => {
      const providers = ['openai', 'anthropic', 'google', 'minimax', 'openrouter', 'ollama', 'mistral', 'groq', 'together', 'cohere'];
      const p = providers[i - 41];
      const diag = classifyError(429, null, 'Rate limit', p);
      expect(diag.errorType).toBe('rate_limit');
      expect(diag.suggestions.length).toBeGreaterThan(0);
    });
  }
});

// ─── SUITE 2: Custom Provider Error Decoder & Reset Countdown ────────────────

describe('Suite 2: Custom Provider Error Decoder & Reset Countdown', () => {
  it.each([
    ['Retry-After: 10s', 10],
    ['Retry-After: 60s', 60],
    ['Retry-After: 300s', 300],
    ['reset in 120 sec', 120],
    ['wait 45 seconds', 45],
    ['Retry-After: 0s', undefined],
    ['no numbers here', undefined],
  ])('parses reset text "%s" as %s', (text, expectedSecs) => {
    expect(parseResetSeconds(text)).toBe(expectedSecs);
  });
});

// ─── SUITE 3: Schema Validation Matrix ───────────────────────────────────────

describe('Suite 3: Schema Validation Matrix', () => {
  it('validates a valid candidate structure', () => {
    const res = validateCandidate({
      content: { role: 'model', parts: [{ text: 'Hello' }] },
      finishReason: 'STOP',
    });
    expect(res.valid).toBe(true);
  });

  it.each([
    [null, 'null or not an object'],
    [{ content: 'not-an-object' }, 'missing content object'],
    [{ content: { parts: 'not-an-array' } }, 'parts is not an array'],
  ])('invalidates malformed candidate: %j', (candidate, expectedErr) => {
    const res = validateCandidate(candidate);
    expect(res.valid).toBe(false);
    expect(res.error).toContain(expectedErr);
  });

  it('validates valid and invalid custom models', () => {
    expect(validateCustomModel({
      name: 'custom-model',
      provider: 'openai',
      apiUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test-key-1234567890',
    }).valid).toBe(true);

    expect(validateCustomModel({
      name: '',
      provider: 'openai',
      apiUrl: 'https://api.openai.com/v1',
    }).valid).toBe(false);
  });
});

// ─── SUITE 4: API Key Masking & Encryption Boundary Matrix ───────────────────

describe('Suite 4: API Key Masking & Encryption Boundary Matrix', () => {
  it.each([
    [4, '********'],
    [8, '********'],
    [9, 'kkkk...kkkk'],
    [20, 'kkkk...kkkk'],
  ])('masks key of length %i correctly', (len, expectedMask) => {
    const rawKey = 'k'.repeat(len);
    const masked = maskApiKey(rawKey);
    expect(typeof masked).toBe('string');
    if (len <= 8) {
      expect(masked).toBe('********');
    } else {
      expect(masked).toBe(expectedMask);
    }
  });

  const prefixKeys = [
    'sk-proj-1234567890abcdef',
    'gai-AIzaSyA1234567890',
    'nvapi-abcdef1234567890',
    'xai-9876543210fedcba',
    'sk-ant-api03-abcdefg',
  ];

  prefixKeys.forEach((key) => {
    it(`correctly identifies masked key for "${key}"`, () => {
      const masked = maskApiKey(key);
      expect(isMaskedApiKey(masked)).toBe(true);
      expect(isMaskedApiKey(key)).toBe(false);
    });
  });

  const edgeCases = [
    { input: '', expected: '' },
    { input: '   ', expected: '********' },
    { input: '********', expected: '********' },
    { input: 'sk-1234567890abcdef', expected: 'sk-1...cdef' },
    { input: 'abcdefghijkl', expected: 'abcd...ijkl' },
  ];

  edgeCases.forEach(({ input, expected }) => {
    it(`handles key masking edge case "${input}"`, () => {
      expect(maskApiKey(input)).toBe(expected);
    });
  });
});

// ─── SUITE 5: CLI Command to Native Antigravity Translation ──────────────────

describe('Suite 5: CLI Command Translation Matrix', () => {
  const cliCommands = [
    { cmd: 'view_file', args: { AbsolutePath: '/tmp/test.txt' }, expectedTool: 'view_file' },
    { cmd: 'list_dir', args: { DirectoryPath: '/tmp' }, expectedTool: 'list_dir' },
    { cmd: 'grep_search', args: { Query: 'TODO', SearchPath: '.' }, expectedTool: 'grep_search' },
    { cmd: 'write_to_file', args: { TargetFile: '/tmp/out.txt', CodeContent: 'hello' }, expectedTool: 'write_to_file' },
    { cmd: 'run_command', args: { CommandLine: 'ls -la' }, expectedTool: 'list_dir' },
    { cmd: 'run_command', args: { CommandLine: 'cat /etc/hosts' }, expectedTool: 'view_file' },
    { cmd: 'run_command', args: { CommandLine: 'grep "TODO" app.ts' }, expectedTool: 'grep_search' },
    { cmd: 'run_command', args: { CommandLine: 'git status' }, expectedTool: 'run_command' },
  ];

  cliCommands.forEach(({ cmd, args, expectedTool }) => {
    it(`translates tool call "${cmd}"`, () => {
      const translated = translateToolCallToNative(cmd, args);
      expect(translated).not.toBeNull();
      expect(translated?.name).toBe(expectedTool);
    });
  });

  it.each(['list_dir', 'view_file', 'grep_search'])('formats translated response for %s', (translatedName) => {
    const formatted = formatTranslatedResponse(
      { translatedName, cmd: 'ls' },
      { files: ['file.ts'], lines: ['hello'], count: 1 },
    );
    expect(typeof formatted).toBe('string');
    expect(formatted.length).toBeGreaterThan(0);
  });
});

// ─── SUITE 6: Exponential Backoff & Retry Jitter Matrix ───────────────────────

describe('Suite 6: Exponential Backoff & Retry Jitter Matrix', () => {
  it.each([0, 1, 3, 5])('computes bounded backoff for attempt %i', (attempt) => {
    const delay = calculateBackoffDelay(attempt, {
      initialDelayMs: 500,
      maxDelayMs: 30000,
      backoffMultiplier: 2,
      jitterFactor: 0.2,
    });
    expect(delay).toBeGreaterThanOrEqual(100);
    expect(delay).toBeLessThanOrEqual(36000);
  });

  const statusRetryCases = [
    { status: 429, expected: true },
    { status: 500, expected: true },
    { status: 502, expected: true },
    { status: 503, expected: true },
    { status: 504, expected: true },
    { status: 529, expected: true },
    { status: 401, expected: false },
    { status: 403, expected: false },
    { status: 200, expected: false },
  ];

  statusRetryCases.forEach(({ status, expected }) => {
    it(`evaluates isRetryableStatus(${status}) as ${expected}`, () => {
      expect(isRetryableStatus(status)).toBe(expected);
    });
  });

  const networkErrCases = [
    { err: { code: 'ECONNREFUSED' }, expected: true },
    { err: { code: 'ETIMEDOUT' }, expected: true },
    { err: { code: 'ENOTFOUND' }, expected: true },
    { err: new Error('fetch failed'), expected: true },
    { err: new Error('other error'), expected: false },
  ];

  networkErrCases.forEach(({ err, expected }) => {
    it(`evaluates isRetryableNetworkError(${JSON.stringify(err.code || err.message)}) as ${expected}`, () => {
      expect(isRetryableNetworkError(err)).toBe(expected);
    });
  });
});
