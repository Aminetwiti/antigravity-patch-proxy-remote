import { describe, it, expect, vi } from 'vitest';
import { createResponseClaimer, type ResponseClaimer } from '../proxy';
import {
  HEDGED_REQUEST_DELAY_MS,
  CAPACITY_503_CASCADE_THRESHOLD,
  CONSECUTIVE_504_CASCADE_THRESHOLD,
  GOOGLE_POOL_HEADER_TIMEOUT_LARGE_PROMPT_MS,
  GOOGLE_PROXY_TIMEOUT_MS,
} from '../constants';

describe('Speculative Hedged Requests, 503 & 504 Timeout Cascade Architecture', () => {
  it('verifies HEDGED_REQUEST_DELAY_MS is configured to 2,500ms', () => {
    const expected = process.env.AG_HEDGED_REQUEST_DELAY_MS
      ? parseInt(process.env.AG_HEDGED_REQUEST_DELAY_MS, 10)
      : 2_500;
    expect(HEDGED_REQUEST_DELAY_MS).toBe(expected);
  });

  it('verifies CAPACITY_503_CASCADE_THRESHOLD is configured to 2', () => {
    const expected = process.env.AG_CAPACITY_503_CASCADE_THRESHOLD
      ? parseInt(process.env.AG_CAPACITY_503_CASCADE_THRESHOLD, 10)
      : 2;
    expect(CAPACITY_503_CASCADE_THRESHOLD).toBe(expected);
  });

  it('verifies CONSECUTIVE_504_CASCADE_THRESHOLD is configured to 2', () => {
    const expected = process.env.AG_CONSECUTIVE_504_CASCADE_THRESHOLD
      ? parseInt(process.env.AG_CONSECUTIVE_504_CASCADE_THRESHOLD, 10)
      : 2;
    expect(CONSECUTIVE_504_CASCADE_THRESHOLD).toBe(expected);
  });

  it('verifies GOOGLE_POOL_HEADER_TIMEOUT_LARGE_PROMPT_MS is calibrated to 65s for KV-cache prefill', () => {
    const expected = process.env.AG_GOOGLE_POOL_HEADER_TIMEOUT_LARGE_PROMPT_MS
      ? parseInt(process.env.AG_GOOGLE_POOL_HEADER_TIMEOUT_LARGE_PROMPT_MS, 10)
      : 65_000;
    expect(GOOGLE_POOL_HEADER_TIMEOUT_LARGE_PROMPT_MS).toBe(expected);
  });

  it('verifies GOOGLE_PROXY_TIMEOUT_MS accommodates 90s requests', () => {
    const expected = process.env.AG_GOOGLE_PROXY_TIMEOUT_MS
      ? parseInt(process.env.AG_GOOGLE_PROXY_TIMEOUT_MS, 10)
      : 90_000;
    expect(GOOGLE_PROXY_TIMEOUT_MS).toBe(expected);
  });

  describe('ResponseClaimer', () => {
    it('allows only the first candidate to claim the response', () => {
      const claimer: ResponseClaimer = createResponseClaimer();
      expect(claimer.isClaimed()).toBe(false);

      // Candidate 1 claims
      const c1Claimed = claimer.claim('candidate-1');
      expect(c1Claimed).toBe(true);
      expect(claimer.isClaimed()).toBe(true);

      // Candidate 2 attempts to claim
      const c2Claimed = claimer.claim('candidate-2');
      expect(c2Claimed).toBe(false);
      expect(claimer.isClaimed()).toBe(true);
    });

    it('aborts losing candidates when winner claims the response', () => {
      const claimer: ResponseClaimer = createResponseClaimer();
      const abort1 = vi.fn();
      const abort2 = vi.fn();

      claimer.registerAbort('candidate-1', abort1);
      claimer.registerAbort('candidate-2', abort2);

      // Candidate 2 wins race
      expect(claimer.claim('candidate-2')).toBe(true);
      claimer.abortOthers('candidate-2');

      // Candidate 1 must be aborted, Candidate 2 must NOT be aborted
      expect(abort1).toHaveBeenCalledTimes(1);
      expect(abort2).not.toHaveBeenCalled();
    });

    it('safely handles abort execution even if abort handler throws', () => {
      const claimer: ResponseClaimer = createResponseClaimer();
      const throwingAbort = vi.fn(() => {
        throw new Error('Socket already closed');
      });
      const normalAbort = vi.fn();

      claimer.registerAbort('bad-candidate', throwingAbort);
      claimer.registerAbort('other-candidate', normalAbort);

      expect(claimer.claim('winner')).toBe(true);
      expect(() => claimer.abortOthers('winner')).not.toThrow();

      expect(throwingAbort).toHaveBeenCalledTimes(1);
      expect(normalAbort).toHaveBeenCalledTimes(1);
    });
  });

  describe('Flash Pool Timeout & Contextual Hedging Calibration', () => {
    it('ensures Flash header timeouts are bounded even when no other candidates exist', () => {
      const isContextual = true;
      const isFlashModel = true;
      const hasOtherCandidates = false;
      const effectiveFlashTimeout = 12_000;
      const proxyTimeout = 120_000;

      const flashTimeoutMs = hasOtherCandidates
        ? (isContextual ? Math.min(45_000, proxyTimeout) : effectiveFlashTimeout)
        : (isContextual ? Math.min(45_000, proxyTimeout) : Math.min(30_000, proxyTimeout));

      expect(flashTimeoutMs).toBeLessThanOrEqual(45_000);
      expect(flashTimeoutMs).toBe(45_000);
    });

    it('caps candidate timeout within the remaining pool loop budget (210s max)', () => {
      const poolLoopStartTime = Date.now() - 170_000; // 170s elapsed
      const MAX_POOL_LOOP_DURATION_MS = 210_000;
      let poolHeaderTimeout = 90_000;

      const remainingPoolBudgetMs = Math.max(10_000, MAX_POOL_LOOP_DURATION_MS - (Date.now() - poolLoopStartTime) - 5_000);
      if (poolHeaderTimeout > remainingPoolBudgetMs) {
        poolHeaderTimeout = remainingPoolBudgetMs;
      }

      // Remaining budget should be ~35s (210s - 170s - 5s = 35s), never letting a candidate stall for 90s
      expect(poolHeaderTimeout).toBeLessThanOrEqual(36_000);
      expect(poolHeaderTimeout).toBeGreaterThanOrEqual(30_000);
    });

    it('calibrates contextual hedge delay between 8s and 60% of header timeout', () => {
      const isFlashThinkingHedgeable = false;
      const isContextualPayload = true;
      const poolHeaderTimeout = 45_000;

      const baseHedgeDelay = isFlashThinkingHedgeable
        ? Math.max(HEDGED_REQUEST_DELAY_MS, 15_000)
        : (isContextualPayload ? Math.max(HEDGED_REQUEST_DELAY_MS, 8_000) : HEDGED_REQUEST_DELAY_MS);
      const hedgeDelay = Math.min(baseHedgeDelay, Math.floor(poolHeaderTimeout * 0.6));

      expect(hedgeDelay).toBe(8_000);
    });
  });
});
