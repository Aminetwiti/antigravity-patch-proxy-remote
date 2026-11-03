import { describe, expect, it } from 'vitest';
import {
  parseLogLine,
  filterByFacet,
  filterSignalOnly,
  explainError,
  ParsedLogEntry,
} from './log-viewer';

describe('Log Viewer Facets & Error Explainability', () => {
  const sampleLogs: ParsedLogEntry[] = [
    parseLogLine('🔄 [ROTATION]  [Account Rotation] Model: [gemini-3.8-flash] | Account: [test-user-1@example.com] (attempt 2/32)'),
    parseLogLine('📡 [PROXY]     ✅ [Feedback] Model: [gemini-3.8-flash] | Account: [test-user-1@example.com] -> HTTP 200 OK (2774ms)'),
    parseLogLine('⚠ [PROXY]      [Feedback] Model: [gemini-3.7-flash] | Account: [test-user-2@example.com] -> HTTP 400 ({"error":{"code":400,"message":"Request contains an invalid argument."}})'),
    parseLogLine('📡 [PROXY]     🔀 [Model Fallback] Pool exhausted for [gemini-3.8-flash]. Switching to fallback model: [claude-sonnet-4-6]...'),
    parseLogLine('🟢 [COOLDOWN]  Cooldown Verification / Wake-up: 59 checked, 59 active cooldown(s) remain.'),
    parseLogLine('🔑 [AUTH]      🟢 Live quota for test-user-3@example.com: Gemini 5h=84%, week=97% | Claude 5h=0%, week=0%'),
    parseLogLine('http_helpers.go:123] URL: http://daily-cloudcode-pa.googleapis.com (Trace: 0x12345)'), // noise
  ];

  it('filters entries by specific facets', () => {
    const rotationLogs = filterByFacet(sampleLogs, 'rotation');
    expect(rotationLogs).toHaveLength(1);
    expect(rotationLogs[0].raw).toContain('[Account Rotation]');

    const fallbackLogs = filterByFacet(sampleLogs, 'fallback');
    expect(fallbackLogs).toHaveLength(1);
    expect(fallbackLogs[0].raw).toContain('[Model Fallback]');

    const authLogs = filterByFacet(sampleLogs, 'auth');
    expect(authLogs).toHaveLength(1);
    expect(authLogs[0].raw).toContain('Live quota');

    const cooldownLogs = filterByFacet(sampleLogs, 'cooldown');
    expect(cooldownLogs).toHaveLength(1);
    expect(cooldownLogs[0].raw).toContain('Cooldown Verification');

    const errorLogs = filterByFacet(sampleLogs, 'error');
    expect(errorLogs).toHaveLength(1);
    expect(errorLogs[0].raw).toContain('HTTP 400');
  });

  it('filters noise out in signal-only mode', () => {
    const signalOnly = filterSignalOnly(sampleLogs);
    expect(signalOnly.length).toBeLessThan(sampleLogs.length);
    expect(signalOnly.some((e) => e.raw.includes('http_helpers.go'))).toBe(false);
  });

  it('generates root-cause explanation for HTTP 400 Invalid Argument', () => {
    const errorEntry = parseLogLine('HTTP 400 ({"error":{"code":400,"message":"Request contains an invalid argument."}})');
    const explanation = explainError(errorEntry);
    expect(explanation).not.toBeNull();
    expect(explanation?.code).toBe(400);
    expect(explanation?.title).toContain('HTTP 400');
    expect(explanation?.recommendation).toContain('generationConfig');
    expect(explanation?.actionId).toBe('inspect-payload');
  });

  it('generates root-cause explanation for HTTP 429 Quota Exhaustion', () => {
    const errorEntry = parseLogLine('HTTP 429 RESOURCE_EXHAUSTED: Rate limit exceeded');
    const explanation = explainError(errorEntry);
    expect(explanation).not.toBeNull();
    expect(explanation?.code).toBe(429);
    expect(explanation?.recommendation).toContain('Claude Sonnet');
    expect(explanation?.actionId).toBe('view-pool');
  });

  it('generates root-cause explanation for HTTP 504 Gateway Timeout', () => {
    const errorEntry = parseLogLine('HTTP 504 Google API request timed out after 20000ms (Gateway Timeout)');
    const explanation = explainError(errorEntry);
    expect(explanation).not.toBeNull();
    expect(explanation?.code).toBe(504);
    expect(explanation?.recommendation).toContain('production host');
    expect(explanation?.actionId).toBe('view-network');
  });
});
