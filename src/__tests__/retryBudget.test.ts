import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  RetryBudget,
  computeTrustScore,
  scaleRetries,
  getRetryBudget,
  _resetRetryBudget,
  RETRY_BUDGET_FLOOR,
  RETRY_BUDGET_BASE,
  RETRY_BUDGET_MAX_SAMPLES,
} from '../proxy/retryBudget';
import type { CustomModel } from '../proxy/types';

const makeModel = (over: Partial<CustomModel> = {}): CustomModel => ({
  name: 'test-model',
  displayName: 'Test Model',
  description: 'A test model',
  provider: 'custom',
  apiUrl: 'https://api.example.com/v1',
  apiKey: 'k',
  externalModelName: 'underlying-model',
  ...over,
} as CustomModel);

describe('retryBudget', () => {
  describe('computeTrustScore', () => {
    it('returns 0.5 when no samples exist', () => {
      expect(computeTrustScore(0, 0)).toBe(0.5);
    });

    it('returns 1.0 when no failures', () => {
      expect(computeTrustScore(10, 0)).toBe(1.0);
    });

    it('returns 0.0 when no successes', () => {
      expect(computeTrustScore(0, 10)).toBe(0.0);
    });

    it('returns the success ratio in between', () => {
      expect(computeTrustScore(3, 1)).toBe(0.75);
      expect(computeTrustScore(1, 3)).toBe(0.25);
    });
  });

  describe('scaleRetries', () => {
    it('honors the floor', () => {
      expect(scaleRetries(3, 0)).toBe(RETRY_BUDGET_FLOOR);
      expect(scaleRetries(3, 0.1)).toBe(RETRY_BUDGET_FLOOR);
    });

    it('honors the ceiling', () => {
      expect(scaleRetries(3, 1)).toBe(3);
      expect(scaleRetries(3, 1.5)).toBe(3);
    });

    it('floors the rounded number', () => {
      expect(scaleRetries(3, 0.6)).toBe(1);
      expect(scaleRetries(3, 0.7)).toBe(2);
    });

    it('treats 0.5 trust as half the budget', () => {
      expect(scaleRetries(4, 0.5)).toBe(2);
    });
  });

  describe('RetryBudget class', () => {
    let budget: RetryBudget;
    beforeEach(() => {
      budget = new RetryBudget();
    });

    it('returns neutral trust initially', () => {
      const m = makeModel();
      const trust = budget.getTrustScore(m);
      expect(trust).toBe(0.5);
    });

    it('all-successes drives trust toward 1', () => {
      const m = makeModel();
      for (let i = 0; i < 10; i++) budget.recordSuccess(m);
      expect(budget.getTrustScore(m)).toBe(1);
    });

    it('all-failures drives trust toward 0', () => {
      const m = makeModel();
      for (let i = 0; i < 10; i++) budget.recordFailure(m);
      expect(budget.getTrustScore(m)).toBe(0);
    });

    it('mixes successes and failures produces a ratio', () => {
      const m = makeModel();
      for (let i = 0; i < 7; i++) budget.recordSuccess(m);
      for (let i = 0; i < 3; i++) budget.recordFailure(m);
      expect(budget.getTrustScore(m)).toBeCloseTo(0.7, 5);
    });

    it('returns the right retry budget for trusted models', () => {
      const m = makeModel();
      for (let i = 0; i < 100; i++) budget.recordSuccess(m);
      expect(budget.getMaxRetries(m, RETRY_BUDGET_BASE)).toBe(RETRY_BUDGET_BASE);
    });

    it('returns the floor for untrusted models', () => {
      const m = makeModel();
      for (let i = 0; i < 100; i++) budget.recordFailure(m);
      expect(budget.getMaxRetries(m, RETRY_BUDGET_BASE)).toBe(RETRY_BUDGET_FLOOR);
    });

    it('memory caps extremely active models', () => {
      const m = makeModel();
      // Push 10x the max samples; the budget should scale back, not saturate.
      for (let i = 0; i < RETRY_BUDGET_MAX_SAMPLES * 10; i++) budget.recordSuccess(m);
      const verdict = budget.getVerdict(m, RETRY_BUDGET_BASE);
      expect(verdict.samples).toBeLessThanOrEqual(RETRY_BUDGET_MAX_SAMPLES + 1);
    });

    it('forget() removes a model', () => {
      const m = makeModel();
      budget.recordSuccess(m);
      budget.forget(m);
      expect(budget.getTrustScore(m)).toBe(0.5);
    });

    it('reset() wipes all models', () => {
      const a = makeModel({ name: 'a' });
      const b = makeModel({ name: 'b' });
      budget.recordSuccess(a);
      budget.recordSuccess(b);
      budget.reset();
      expect(budget.getTrustScore(a)).toBe(0.5);
      expect(budget.getTrustScore(b)).toBe(0.5);
    });

    it('different models are tracked independently', () => {
      const a = makeModel({ name: 'a' });
      const b = makeModel({ name: 'b' });
      for (let i = 0; i < 10; i++) budget.recordSuccess(a);
      for (let i = 0; i < 10; i++) budget.recordFailure(b);
      expect(budget.getTrustScore(a)).toBe(1);
      expect(budget.getTrustScore(b)).toBe(0);
    });

    it('different apiUrls are tracked independently', () => {
      const a = makeModel({ apiUrl: 'https://a.example.com' });
      const b = makeModel({ apiUrl: 'https://b.example.com' });
      for (let i = 0; i < 10; i++) budget.recordSuccess(a);
      for (let i = 0; i < 10; i++) budget.recordFailure(b);
      expect(budget.getTrustScore(a)).toBe(1);
      expect(budget.getTrustScore(b)).toBe(0);
    });

    it('different providers are tracked independently', () => {
      const a = makeModel({ provider: 'openrouter' });
      const b = makeModel({ provider: 'custom' });
      for (let i = 0; i < 5; i++) budget.recordSuccess(a);
      for (let i = 0; i < 5; i++) budget.recordFailure(b);
      expect(budget.getTrustScore(a)).toBeCloseTo(1, 5);
      expect(budget.getTrustScore(b)).toBeCloseTo(0, 5);
    });

    it('verdict includes all diagnostic fields', () => {
      const m = makeModel();
      for (let i = 0; i < 3; i++) budget.recordSuccess(m);
      for (let i = 0; i < 1; i++) budget.recordFailure(m);
      const verdict = budget.getVerdict(m, 3);
      expect(verdict).toMatchObject({
        trust: expect.any(Number),
        maxRetries: expect.any(Number),
        samples: expect.any(Number),
        effectiveFailures: expect.any(Number),
        effectiveSuccesses: expect.any(Number),
      });
      expect(verdict.trust).toBeCloseTo(0.75, 5);
      expect(verdict.maxRetries).toBe(2);
    });
  });

  describe('time-based decay', () => {
    it('decays old samples using the half-life', () => {
      const budget = new RetryBudget();
      const m = makeModel();
      // Record a mix of 9 successes + 1 failure at t=0.
      const t0 = 1_000_000_000_000;
      vi.setSystemTime(t0);
      for (let i = 0; i < 9; i++) budget.recordSuccess(m);
      budget.recordFailure(m);
      // Jump 5 minutes (one half-life) into the future.
      vi.setSystemTime(t0 + 5 * 60_000);
      const trust = budget.getTrustScore(m);
      // After 1 half-life, both counters are halved. The ratio is unchanged
      // (9/10) so the trust score should still be close to 0.9.
      expect(trust).toBeCloseTo(0.9, 1);
      vi.useRealTimers();
    });

    it('resets to neutral for models idle for very long', () => {
      const budget = new RetryBudget();
      const m = makeModel();
      const t0 = 1_000_000_000_000;
      vi.setSystemTime(t0);
      for (let i = 0; i < 10; i++) budget.recordFailure(m);
      // 10x the half-life = reset condition.
      vi.setSystemTime(t0 + 5 * 60_000 * 10 + 1);
      const trust = budget.getTrustScore(m);
      expect(trust).toBe(0.5);
      vi.useRealTimers();
    });

    it('uses real wall clock when system time is not mocked', () => {
      const budget = new RetryBudget();
      const m = makeModel();
      budget.recordSuccess(m);
      budget.recordSuccess(m);
      // Just verify no exceptions and the call returns a number.
      expect(typeof budget.getTrustScore(m)).toBe('number');
    });
  });

  describe('module-level singleton', () => {
    beforeEach(() => {
      _resetRetryBudget();
    });

    it('returns the same instance', () => {
      const a = getRetryBudget();
      const b = getRetryBudget();
      expect(a).toBe(b);
    });

    it('resets via the test helper', () => {
      const budget = getRetryBudget();
      const m = makeModel();
      budget.recordSuccess(m);
      _resetRetryBudget();
      expect(getRetryBudget().getTrustScore(m)).toBe(0.5);
    });
  });
});
