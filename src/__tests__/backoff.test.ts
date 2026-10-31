import { describe, it, expect } from 'vitest';
import { calculateBackoffDelay, type BackoffConfig } from '../proxy/backoff';

const baseConfig: BackoffConfig = {
  initialDelayMs: 1_000,
  maxDelayMs: 30_000,
  backoffMultiplier: 2,
  jitterFactor: 0.1,
};

describe('calculateBackoffDelay', () => {
  it('returns initial delay (plus jitter) for attempt=0', () => {
    // 1000 +/- 100 -> [900, 1100]
    for (let i = 0; i < 20; i++) {
      const d = calculateBackoffDelay(0, baseConfig);
      expect(d).toBeGreaterThanOrEqual(900);
      expect(d).toBeLessThanOrEqual(1100);
    }
  });

  it('grows exponentially with attempt', () => {
    // attempt=1 -> 2000 +/- 200 -> [1800, 2200]
    for (let i = 0; i < 20; i++) {
      const d = calculateBackoffDelay(1, baseConfig);
      expect(d).toBeGreaterThanOrEqual(1_800);
      expect(d).toBeLessThanOrEqual(2_200);
    }
    // attempt=2 -> 4000 +/- 400
    for (let i = 0; i < 20; i++) {
      const d = calculateBackoffDelay(2, baseConfig);
      expect(d).toBeGreaterThanOrEqual(3_600);
      expect(d).toBeLessThanOrEqual(4_400);
    }
  });

  it('respects maxDelayMs cap', () => {
    // attempt=10 -> 1_000 * 2^10 = 1_024_000 -> capped to 30_000
    for (let i = 0; i < 20; i++) {
      const d = calculateBackoffDelay(10, baseConfig);
      // capped at 30_000, +/- 10% -> [27_000, 33_000]
      expect(d).toBeGreaterThanOrEqual(27_000);
      expect(d).toBeLessThanOrEqual(33_000);
    }
  });

  it('with jitterFactor=0 returns exact values (deterministic)', () => {
    const exact: BackoffConfig = { ...baseConfig, jitterFactor: 0 };
    expect(calculateBackoffDelay(0, exact)).toBe(1_000);
    expect(calculateBackoffDelay(1, exact)).toBe(2_000);
    expect(calculateBackoffDelay(2, exact)).toBe(4_000);
    expect(calculateBackoffDelay(10, exact)).toBe(30_000); // capped
  });

  it('clamps negative or non-finite attempts to 0', () => {
    expect(calculateBackoffDelay(-5, { ...baseConfig, jitterFactor: 0 })).toBe(1_000);
    expect(calculateBackoffDelay(NaN, { ...baseConfig, jitterFactor: 0 })).toBe(1_000);
    expect(calculateBackoffDelay(Infinity, { ...baseConfig, jitterFactor: 0 })).toBe(1_000);
  });

  it('returns non-negative integer', () => {
    // Edge: max jitter could push the value slightly negative when capped value is very small.
    for (let i = 0; i < 50; i++) {
      const d = calculateBackoffDelay(
        i,
        { initialDelayMs: 1, maxDelayMs: 10, backoffMultiplier: 2, jitterFactor: 0.5 }
      );
      expect(d).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(d)).toBe(true);
    }
  });

  it('produces jittered values (variance check)', () => {
    // With jitter, repeated calls at attempt=1 should NOT all be equal.
    const samples = Array.from({ length: 30 }, () => calculateBackoffDelay(1, baseConfig));
    const unique = new Set(samples);
    expect(unique.size).toBeGreaterThan(5); // expect meaningful variance
  });
});
