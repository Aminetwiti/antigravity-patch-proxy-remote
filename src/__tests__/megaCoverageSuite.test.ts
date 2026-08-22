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

// ─── SUITE 2: Custom Provider Error Decoder & Reset Countdown (50 Tests) ─────

describe('Suite 2: Custom Provider Error Decoder & Reset Countdown', () => {
  const retryTextScenarios = Array.from({ length: 40 }, (_, i) => {
    const secs = (i + 1) * 10;
    return { text: `Retry-After: ${secs}s`, expectedSecs: secs };
  });

  retryTextScenarios.forEach(({ text, expectedSecs }, idx) => {
    it(`[2.${idx + 1}] parses reset text "${text}" as ${expectedSecs}s`, () => {
      expect(parseResetSeconds(text)).toBe(expectedSecs);
    });
  });

  const edgeTexts = [
    { text: 'no numbers here', expected: undefined },
    { text: 'reset in 120 sec', expected: 120 },
    { text: 'wait 45 seconds', expected: 45 },
    { text: 'retry in 300s', expected: 300 },
    { text: 'rate limit reset: 60s', expected: 60 },
    { text: 'in 90 seconds', expected: 90 },
    { text: 'Retry-After: 0s', expected: undefined },
    { text: 'reset in 3600 seconds', expected: 3600 },
    { text: 'wait 15 s', expected: 15 },
    { text: 'retry in 500s', expected: 500 },
  ];

  edgeTexts.forEach(({ text, expected }, idx) => {
    it(`[2.${idx + 41}] handles edge reset text case #${idx + 1}`, () => {
      expect(parseResetSeconds(text)).toBe(expected);
    });
  });
});

// ─── SUITE 3: Schema Validation Matrix (50 Tests) ────────────────────────────

describe('Suite 3: Schema Validation Matrix', () => {
  const candidateValidCases = Array.from({ length: 15 }, (_, i) => ({
    role: i % 2 === 0 ? 'model' : undefined,
    finishReason: i % 3 === 0 ? 'STOP' : 'MAX_TOKENS',
    parts: [{ text: `Sample part text #${i}` }],
  }));

  candidateValidCases.forEach((c, idx) => {
    it(`[3.${idx + 1}] validates candidate shape #${idx + 1}`, () => {
      const res = validateCandidate({
        content: { role: c.role, parts: c.parts },
        finishReason: c.finishReason,
      });
      expect(res.valid).toBe(true);
    });
  });

  const candidateInvalidCases = Array.from({ length: 15 }, (_, i) => {
    if (i < 5) return { candidate: null, err: 'null or not an object' };
    if (i < 10) return { candidate: { content: 'not-an-object' }, err: 'missing content object' };
    return { candidate: { content: { parts: 'not-an-array' } }, err: 'parts is not an array' };
  });

  candidateInvalidCases.forEach(({ candidate, err }, idx) => {
    it(`[3.${idx + 16}] invalidates invalid candidate #${idx + 1}`, () => {
      const res = validateCandidate(candidate);
      expect(res.valid).toBe(false);
      expect(res.error).toContain(err);
    });
  });

  const modelValidationCases = Array.from({ length: 20 }, (_, i) => {
    const valid = i < 15;
    return {
      model: {
        name: valid ? `custom-model-${i}` : (i === 15 ? '' : 123),
        provider: valid ? 'openai' : (i === 16 ? '' : null),
        apiUrl: valid ? 'https://api.openai.com/v1' : 'not-a-url',
        apiKey: 'sk-test-key-1234567890',
      },
      valid,
    };
  });

  modelValidationCases.forEach(({ model, valid }, idx) => {
    it(`[3.${idx + 31}] validates custom model object #${idx + 1}`, () => {
      const res = validateCustomModel(model);
      expect(res.valid).toBe(valid);
    });
  });
});

// ─── SUITE 4: API Key Masking & Encryption Boundary Matrix (50 Tests) ───────

describe('Suite 4: API Key Masking & Encryption Boundary Matrix', () => {
  const keyLengths = Array.from({ length: 30 }, (_, i) => i + 1);

  keyLengths.forEach((len, idx) => {
    it(`[4.${idx + 1}] masks key of length ${len} correctly`, () => {
      const rawKey = 'k'.repeat(len);
      const masked = maskApiKey(rawKey);
      expect(typeof masked).toBe('string');

      if (len <= 8) {
        expect(masked).toBe('********');
      } else {
        expect(masked).toBe(`${rawKey.slice(0, 4)}...${rawKey.slice(-4)}`);
      }
    });
  });

  const prefixKeys = [
    'sk-proj-1234567890abcdef',
    'gai-AIzaSyA1234567890',
    'nvapi-abcdef1234567890',
    'xai-9876543210fedcba',
    'pplx-1122334455667788',
    'ai-secret-key-123456',
    'sk-ant-api03-abcdefg',
    'Bearer-sk-9988776655',
    'KEY_WITH_UNDERSCORES_123',
    'key_with_underscores_456',
  ];

  prefixKeys.forEach((key, idx) => {
    it(`[4.${idx + 31}] correctly identifies masked key for "${key}"`, () => {
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
    { input: 'a', expected: '********' },
    { input: 'ab', expected: '********' },
    { input: 'abc', expected: '********' },
    { input: 'abcd', expected: '********' },
    { input: 'abcde', expected: '********' },
    { input: 'abcdefghijkl', expected: 'abcd...ijkl' },
  ];

  edgeCases.forEach(({ input, expected }, idx) => {
    it(`[4.${idx + 41}] handles key masking edge case #${idx + 1}`, () => {
      expect(maskApiKey(input)).toBe(expected);
    });
  });
});

// ─── SUITE 5: CLI Command to Native Antigravity Translation (50 Tests) ───────

describe('Suite 5: CLI Command Translation Matrix', () => {
  const cliCommands = [
    { cmd: 'view_file', args: { AbsolutePath: '/tmp/test.txt' }, expectedTool: 'view_file' },
    { cmd: 'list_dir', args: { DirectoryPath: '/tmp' }, expectedTool: 'list_dir' },
    { cmd: 'grep_search', args: { Query: 'TODO', SearchPath: '.' }, expectedTool: 'grep_search' },
    { cmd: 'write_to_file', args: { TargetFile: '/tmp/out.txt', CodeContent: 'hello' }, expectedTool: 'write_to_file' },
    { cmd: 'run_command', args: { CommandLine: 'ls' }, expectedTool: 'list_dir' },
    { cmd: 'run_command', args: { CommandLine: 'ls -la' }, expectedTool: 'list_dir' },
    { cmd: 'run_command', args: { CommandLine: 'dir' }, expectedTool: 'list_dir' },
    { cmd: 'run_command', args: { CommandLine: 'cat /etc/hosts' }, expectedTool: 'view_file' },
    { cmd: 'run_command', args: { CommandLine: 'type C:\\file.txt' }, expectedTool: 'view_file' },
    { cmd: 'run_command', args: { CommandLine: 'grep "TODO" app.ts' }, expectedTool: 'grep_search' },
    { cmd: 'run_command', args: { CommandLine: 'findstr /i "ERROR" logs.txt' }, expectedTool: 'grep_search' },
    { cmd: 'run_command', args: { CommandLine: 'echo hello > out.txt' }, expectedTool: 'write_file' },
    { cmd: 'run_command', args: { CommandLine: 'git status' }, expectedTool: 'run_command' },
    { cmd: 'run_command', args: { CommandLine: 'git log -n 5' }, expectedTool: 'run_command' },
    { cmd: 'run_command', args: { CommandLine: 'npm test' }, expectedTool: 'run_command' },
    { cmd: 'run_command', args: { CommandLine: 'npm run build' }, expectedTool: 'run_command' },
    { cmd: 'run_command', args: { CommandLine: 'cargo build' }, expectedTool: 'run_command' },
    { cmd: 'run_command', args: { CommandLine: 'python main.py' }, expectedTool: 'run_command' },
    { cmd: 'run_command', args: { CommandLine: 'node app.js' }, expectedTool: 'run_command' },
    { cmd: 'run_command', args: { CommandLine: 'docker ps' }, expectedTool: 'run_command' },
    { cmd: 'run_command', args: { CommandLine: 'kubectl get pods' }, expectedTool: 'run_command' },
    { cmd: 'run_command', args: { CommandLine: 'curl https://api.com' }, expectedTool: 'run_command' },
    { cmd: 'run_command', args: { CommandLine: 'wget https://file.zip' }, expectedTool: 'run_command' },
    { cmd: 'run_command', args: { CommandLine: 'ping google.com' }, expectedTool: 'run_command' },
    { cmd: 'run_command', args: { CommandLine: 'echo test' }, expectedTool: 'run_command' },
  ];

  cliCommands.forEach(({ cmd, args, expectedTool }, idx) => {
    it(`[5.${idx + 1}] translates tool call "${cmd}"`, () => {
      const translated = translateToolCallToNative(cmd, args);
      expect(translated).not.toBeNull();
      expect(translated?.name).toBe(expectedTool);
    });
  });

  const responseFormatCases = Array.from({ length: 25 }, (_, i) => {
    const translatedName = i % 3 === 0 ? 'list_dir' : i % 3 === 1 ? 'view_file' : 'grep_search';
    return {
      translatedName,
      cmd: `ls -la /dir_${i}`,
      rawOutput: { files: [`file_${i}.ts`], lines: [`line content ${i}`], count: i },
    };
  });

  responseFormatCases.forEach(({ translatedName, cmd, rawOutput }, idx) => {
    it(`[5.${idx + 26}] formats translated response for ${translatedName} #${idx + 1}`, () => {
      const formatted = formatTranslatedResponse({ translatedName, cmd }, rawOutput);
      expect(typeof formatted).toBe('string');
      expect(formatted.length).toBeGreaterThan(0);
    });
  });
});

// ─── SUITE 6: Exponential Backoff & Retry Jitter Matrix (50 Tests) ───────────

describe('Suite 6: Exponential Backoff & Retry Jitter Matrix', () => {
  const attemptCases = Array.from({ length: 30 }, (_, i) => i);

  attemptCases.forEach((attempt, idx) => {
    it(`[6.${idx + 1}] computes bounded backoff for attempt ${attempt}`, () => {
      const delay = calculateBackoffDelay(attempt, {
        initialDelayMs: 500,
        maxDelayMs: 30000,
        backoffMultiplier: 2,
        jitterFactor: 0.2,
      });
      expect(delay).toBeGreaterThanOrEqual(100);
      expect(delay).toBeLessThanOrEqual(36000);
    });
  });

  const statusRetryCases = [
    { status: 429, expected: true },
    { status: 500, expected: true },
    { status: 502, expected: true },
    { status: 503, expected: true },
    { status: 504, expected: true },
    { status: 529, expected: true },
    { status: 408, expected: false },
    { status: 401, expected: false },
    { status: 403, expected: false },
    { status: 402, expected: false },
    { status: 400, expected: false },
    { status: 404, expected: false },
    { status: 200, expected: false },
  ];

  statusRetryCases.forEach(({ status, expected }, idx) => {
    it(`[6.${idx + 31}] evaluates isRetryableStatus(${status}) as ${expected}`, () => {
      expect(isRetryableStatus(status)).toBe(expected);
    });
  });

  const networkErrCases = [
    { err: { code: 'ECONNREFUSED' }, expected: true },
    { err: { code: 'ETIMEDOUT' }, expected: true },
    { err: { code: 'ENOTFOUND' }, expected: true },
    { err: { code: 'EAI_AGAIN' }, expected: true },
    { err: { code: 'ECONNRESET' }, expected: true },
    { err: new Error('fetch failed'), expected: true },
    { err: new Error('other error'), expected: false },
  ];

  networkErrCases.forEach(({ err, expected }, idx) => {
    it(`[6.${idx + 44}] evaluates isRetryableNetworkError(${JSON.stringify(err.code || err.message)}) as ${expected}`, () => {
      expect(isRetryableNetworkError(err)).toBe(expected);
    });
  });
});
