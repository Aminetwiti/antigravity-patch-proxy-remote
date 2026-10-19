import { describe, it, expect } from 'vitest';
import {
  cleanValidationUrl,
  parseValidationFromLogContent,
  getAntigravityLogRoots,
} from './antigravityVerificationResolver';

describe('antigravityVerificationResolver', () => {
  it('cleans HTML entities and escaped characters from validation URLs', () => {
    const raw = 'https://accounts.google.com/signin/continue?sarp=1&amp;scc=1&amp;continue=https://example.com\\u0026plt=AKgnsb"';
    const cleaned = cleanValidationUrl(raw);
    expect(cleaned).toBe('https://accounts.google.com/signin/continue?sarp=1&scc=1&continue=https://example.com&plt=AKgnsb');
  });

  it('parses validation URLs and captures error indicators from log lines', () => {
    const sampleLog = `
      2026-09-26 15:21:53.687 [error] [LS Main stderr] ERROR: logging before google.Init:
      "error": {
        "code": 403,
        "message": "Verify your account to continue.",
        "status": "PERMISSION_DENIED",
        "details": [{
          "reason": "VALIDATION_REQUIRED",
          "metadata": {
            "validation_url": "https://accounts.google.com/signin/continue?sarp=1&amp;scc=1&amp;continue=https://developers.google.com/gemini-code-assist/auth/auth_success_gemini&amp;plt=AKgnsb12345"
          }
        }]
      }
      Account: devuser@gmail.com
    `;

    const parsed = parseValidationFromLogContent(sampleLog);
    expect(parsed).not.toBeNull();
    expect(parsed?.url).toBe('https://accounts.google.com/signin/continue?sarp=1&scc=1&continue=https://developers.google.com/gemini-code-assist/auth/auth_success_gemini&plt=AKgnsb12345');
    expect(parsed?.reason).toBe('VALIDATION_REQUIRED');
    expect(parsed?.email).toBe('devuser@gmail.com');
  });

  it('detects when VALIDATION_REQUIRED occurs without immediate URL match', () => {
    const sampleLog = `
      ERROR: logging before google.Init: cache.go:56] Singleflight refresh failed: PERMISSION_DENIED (code 403): Verify your account to continue.
      The device you used to scan the QR code was used too many times for verification
    `;

    const parsed = parseValidationFromLogContent(sampleLog);
    expect(parsed).not.toBeNull();
    expect(parsed?.reason).toBe('VALIDATION_REQUIRED');
    expect(parsed?.url).toBeUndefined();
  });

  it('returns valid directory roots on current platform', () => {
    const roots = getAntigravityLogRoots();
    expect(Array.isArray(roots)).toBe(true);
  });
});
