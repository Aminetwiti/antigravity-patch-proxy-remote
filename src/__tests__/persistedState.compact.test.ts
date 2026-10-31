/**
 * Tests for `persistedState.compact()` (Phase 7.2).
 * Pure: drops stale breaker/budget entries from a snapshot in memory.
 */

import { describe, it, expect } from 'vitest';
import { fresh, toFile, compact } from '../proxy/persistedState';
import { CIRCUIT_BREAKER_RESET_MS } from '../proxy/circuitBreaker';
import { RETRY_BUDGET_HALF_LIFE_MS } from '../proxy/retryBudget';

const NOW = 1_700_000_000_000;
const OPTS = {
  now: NOW,
  breakerResetMs: CIRCUIT_BREAKER_RESET_MS,
  budgetHalfLifeMs: RETRY_BUDGET_HALF_LIFE_MS,
};
const BUDGET_CUTOFF = RETRY_BUDGET_HALF_LIFE_MS * 5;
const BREAKER_CUTOFF = CIRCUIT_BREAKER_RESET_MS * 4;

function makeFile() {
  return toFile({
    retryBudgetSnap: { perModel: [] },
    breakerSnap: { open: [] },
    rawBudgetCounts: {
      a: { successes: 5, failures: 0, lastUpdate: NOW - 10_000 },
      b: { successes: 5, failures: 1, lastUpdate: NOW - BUDGET_CUTOFF - 1 },
    },
  });
}

describe('persistedState / compact', () => {
  it('keeps all entries when nothing is stale', () => {
    const file = toFile({
      retryBudgetSnap: { perModel: [] },
      breakerSnap: { open: [] },
      rawBudgetCounts: { x: { successes: 3, failures: 0, lastUpdate: NOW } },
    });
    const out = compact(file, OPTS);
    expect(Object.keys(out.retryBudget)).toEqual(['x']);
  });

  it('drops breaker entries past their reset window x4', () => {
    const file = fresh();
    file.breakers = {
      fresh: { errorType: 'dns', failures: 1, trippedAt: NOW - 1000 },
      stale: { errorType: 'dns', failures: 99, trippedAt: NOW - BREAKER_CUTOFF - 1 },
    };
    const out = compact(file, OPTS);
    expect(Object.keys(out.breakers).sort()).toEqual(['fresh']);
  });

  it('drops budget samples older than halfLife * 5', () => {
    const out = compact(makeFile(), OPTS);
    expect(Object.keys(out.retryBudget).sort()).toEqual(['a']);
  });

  it('is pure (does not mutate the input)', () => {
    const input = makeFile();
    const before = Object.keys(input.retryBudget).length;
    compact(input, OPTS);
    expect(Object.keys(input.retryBudget).length).toBe(before);
  });
});
