import { describe, it, expect } from 'vitest';
import {
  computeRetryDelay,
  shouldRetryStatus,
  buildRetryDecision,
  isRetryableStatus,
  type RetryStrategy,
} from '../proxy/retryStrategy';
import {
  STREAM_RETRY_BASE_DELAY_MS,
  SERVER_ERROR_RETRY_BASE_DELAY_MS,
  RATE_LIMIT_RETRY_BASE_DELAY_MS,
} from '../constants';

describe('computeRetryDelay', () => {
  describe('when Retry-After header is present', () => {
    it('returns retryAfterMs for stream-error', () => {
      expect(computeRetryDelay('stream-error', 0, 5000)).toBe(5000);
    });

    it('returns retryAfterMs for server-error', () => {
      expect(computeRetryDelay('server-error', 2, 10_000)).toBe(10_000);
    });

    it('returns retryAfterMs for rate-limit', () => {
      expect(computeRetryDelay('rate-limit', 3, 30_000)).toBe(30_000);
    });

    it('ignores Retry-After when 0 (returns jittered base delay)', () => {
      const d = computeRetryDelay('server-error', 0, 0);
      // Jittered: SERVER_ERROR_RETRY_BASE_DELAY_MS +/- 10%
      expect(d).toBeGreaterThanOrEqual(SERVER_ERROR_RETRY_BASE_DELAY_MS * 0.9);
      expect(d).toBeLessThanOrEqual(SERVER_ERROR_RETRY_BASE_DELAY_MS * 1.1);
    });
  });

  describe('stream-error strategy', () => {
    it('returns small delay near base for attempt=0', () => {
      // initialDelay * 2^0 = 1000ms, capped at 5000ms, +/- 10% jitter
      const d = computeRetryDelay('stream-error', 0, 0);
      expect(d).toBeGreaterThanOrEqual(STREAM_RETRY_BASE_DELAY_MS * 0.9);
      expect(d).toBeLessThanOrEqual(STREAM_RETRY_BASE_DELAY_MS * 1.1);
    });

    it('grows exponentially with retryCount', () => {
      const d0 = computeRetryDelay('stream-error', 0, 0);
      const d1 = computeRetryDelay('stream-error', 1, 0);
      const d2 = computeRetryDelay('stream-error', 2, 0);
      expect(d1).toBeGreaterThan(d0);
      expect(d2).toBeGreaterThan(d1);
    });
  });

  describe('server-error strategy', () => {
    it('returns base delay for attempt=0 (with jitter)', () => {
      const d = computeRetryDelay('server-error', 0, 0);
      expect(d).toBeGreaterThanOrEqual(SERVER_ERROR_RETRY_BASE_DELAY_MS * 0.9);
      expect(d).toBeLessThanOrEqual(SERVER_ERROR_RETRY_BASE_DELAY_MS * 1.1);
    });

    it('grows exponentially for attempt=1,2,3', () => {
      const d0 = computeRetryDelay('server-error', 0, 0);
      const d1 = computeRetryDelay('server-error', 1, 0);
      const d2 = computeRetryDelay('server-error', 2, 0);
      const d3 = computeRetryDelay('server-error', 3, 0);
      expect(d1).toBeGreaterThan(d0);
      expect(d2).toBeGreaterThan(d1);
      expect(d3).toBeGreaterThan(d2);
    });
  });

  describe('rate-limit strategy', () => {
    it('returns base delay for attempt=0 (with jitter)', () => {
      const d = computeRetryDelay('rate-limit', 0, 0);
      expect(d).toBeGreaterThanOrEqual(RATE_LIMIT_RETRY_BASE_DELAY_MS * 0.9);
      expect(d).toBeLessThanOrEqual(RATE_LIMIT_RETRY_BASE_DELAY_MS * 1.1);
    });

    it('grows exponentially with retryCount', () => {
      const d0 = computeRetryDelay('rate-limit', 0, 0);
      const d1 = computeRetryDelay('rate-limit', 1, 0);
      const d2 = computeRetryDelay('rate-limit', 2, 0);
      expect(d1).toBeGreaterThan(d0);
      expect(d2).toBeGreaterThan(d1);
    });
  });
});

describe('isRetryableStatus', () => {
  it('returns true for 5xx server errors', () => {
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(502)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(504)).toBe(true);
  });

  it('returns true for 429 rate limit', () => {
    expect(isRetryableStatus(429)).toBe(true);
  });

  it('returns false for other status codes', () => {
    expect(isRetryableStatus(200)).toBe(false);
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(401)).toBe(false);
    expect(isRetryableStatus(402)).toBe(false);
    expect(isRetryableStatus(403)).toBe(false);
    expect(isRetryableStatus(404)).toBe(false);
  });
});

describe('shouldRetryStatus', () => {
  it('returns true for 5xx server errors when under max retries', () => {
    expect(shouldRetryStatus(500, 0, 3)).toBe(true);
    expect(shouldRetryStatus(502, 1, 3)).toBe(true);
    expect(shouldRetryStatus(503, 2, 3)).toBe(true);
    expect(shouldRetryStatus(504, 2, 3)).toBe(true);
  });

  it('returns true for 429 rate limit when under max retries', () => {
    expect(shouldRetryStatus(429, 0, 3)).toBe(true);
    expect(shouldRetryStatus(429, 2, 3)).toBe(true);
  });

  it('returns false for 4xx client errors (except 429)', () => {
    expect(shouldRetryStatus(400, 0, 3)).toBe(false);
    expect(shouldRetryStatus(401, 0, 3)).toBe(false);
    expect(shouldRetryStatus(403, 0, 3)).toBe(false);
    expect(shouldRetryStatus(404, 0, 3)).toBe(false);
  });

  it('returns false for 2xx success', () => {
    expect(shouldRetryStatus(200, 0, 3)).toBe(false);
    expect(shouldRetryStatus(204, 0, 3)).toBe(false);
  });

  it('returns false when max retries reached', () => {
    expect(shouldRetryStatus(500, 3, 3)).toBe(false);
    expect(shouldRetryStatus(429, 5, 3)).toBe(false);
    expect(shouldRetryStatus(503, 10, 3)).toBe(false);
  });

  it('returns false when retryCount exceeds maxRetries', () => {
    expect(shouldRetryStatus(500, 4, 3)).toBe(false);
  });

  it('handles edge cases for 5xx range', () => {
    expect(shouldRetryStatus(499, 0, 3)).toBe(false);
    expect(shouldRetryStatus(500, 0, 3)).toBe(true);
    expect(shouldRetryStatus(599, 0, 3)).toBe(true);
    expect(shouldRetryStatus(600, 0, 3)).toBe(false);
  });
});

describe('buildRetryDecision', () => {
  it('returns shouldRetry=true when under max retries', () => {
    const decision = buildRetryDecision('server-error', 0, 3, 0);
    expect(decision.shouldRetry).toBe(true);
    expect(decision.nextRetryCount).toBe(1);
    expect(decision.delayMs).toBeGreaterThan(0);
  });

  it('returns shouldRetry=false when max retries reached', () => {
    const decision = buildRetryDecision('server-error', 3, 3, 0);
    expect(decision.shouldRetry).toBe(false);
    expect(decision.nextRetryCount).toBe(3);
    expect(decision.delayMs).toBe(0);
  });

  it('respects Retry-After header', () => {
    const decision = buildRetryDecision('rate-limit', 0, 3, 15_000);
    expect(decision.shouldRetry).toBe(true);
    expect(decision.delayMs).toBe(15_000);
  });

  it('uses exponential backoff when no Retry-After', () => {
    const d0 = buildRetryDecision('server-error', 0, 5, 0);
    const d1 = buildRetryDecision('server-error', 1, 5, 0);
    const d2 = buildRetryDecision('server-error', 2, 5, 0);
    expect(d1.delayMs).toBeGreaterThan(d0.delayMs);
    expect(d2.delayMs).toBeGreaterThan(d1.delayMs);
  });

  it('increments retry count correctly', () => {
    expect(buildRetryDecision('stream-error', 0, 5, 0).nextRetryCount).toBe(1);
    expect(buildRetryDecision('stream-error', 1, 5, 0).nextRetryCount).toBe(2);
    expect(buildRetryDecision('stream-error', 4, 5, 0).nextRetryCount).toBe(5);
  });
});

describe('RetryStrategy type', () => {
  it('supports all three strategy types', () => {
    const strategies: RetryStrategy[] = ['stream-error', 'server-error', 'rate-limit'];
    expect(strategies).toHaveLength(3);
  });
});
