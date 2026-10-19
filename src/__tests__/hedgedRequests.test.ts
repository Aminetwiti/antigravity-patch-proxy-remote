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
});
