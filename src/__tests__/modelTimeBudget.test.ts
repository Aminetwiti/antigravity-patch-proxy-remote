/**
 * Tests for `modelTimeBudget` (Phase 7.3).
 * Trust-shaped wall-clock ceiling: cap = clamp(BASE_MS * trust, MIN, MAX).
 */

import { describe, it, expect } from 'vitest';
import {
  computeTimeBudgetMs,
  withinTimeBudget,
  TIME_BUDGET_MIN_MS,
  TIME_BUDGET_MAX_MS,
  TIME_BUDGET_BASE_MS,
  type TrustLookup,
} from '../proxy/modelTimeBudget';

const stubTrust = (t: number): TrustLookup => ({ trustOf: () => t });
const NOW = 1_700_000_000_000;

describe('modelTimeBudget / computeTimeBudgetMs', () => {
  it('saturation: trust = 1 -> MAX, trust = 0 -> MIN', () => {
    expect(computeTimeBudgetMs(1)).toBe(TIME_BUDGET_MAX_MS);
    expect(computeTimeBudgetMs(0)).toBe(TIME_BUDGET_MIN_MS);
  });

  it.each([
    [-0.5, TIME_BUDGET_MIN_MS],
    [1.4, TIME_BUDGET_MAX_MS],
  ])('clamps trust out-of-range %s -> %s', (input, expected) => {
    expect(computeTimeBudgetMs(input)).toBe(expected);
  });

  it('mid-trust ceiling sits between MIN and MAX', () => {
    const mid = computeTimeBudgetMs(0.5);
    expect(mid).toBeGreaterThan(TIME_BUDGET_MIN_MS);
    expect(mid).toBeLessThan(TIME_BUDGET_MAX_MS);
  });

  it('exposes BASE = MAX so trust = 1 saturates', () => {
    expect(TIME_BUDGET_BASE_MS).toBe(TIME_BUDGET_MAX_MS);
  });
});

describe('modelTimeBudget / withinTimeBudget', () => {
  it('ok=false exactly at the ceiling (strict <)', () => {
    const out = withinTimeBudget({
      startMs: NOW,
      nowMs: NOW + TIME_BUDGET_MAX_MS,
      key: 'k',
      trust: stubTrust(1),
    });
    expect(out).toEqual({ ok: false, elapsedMs: TIME_BUDGET_MAX_MS, ceilingMs: TIME_BUDGET_MAX_MS });
  });

  it('lowering trust shrinks the ceiling', () => {
    const args = { startMs: NOW, nowMs: NOW + 60_000, key: 'k' };
    const high = withinTimeBudget({ ...args, trust: stubTrust(1) });
    const low = withinTimeBudget({ ...args, trust: stubTrust(0) });
    expect(high.ceilingMs).toBeGreaterThan(low.ceilingMs);
    expect(high.ok).toBe(true);
    expect(low.ok).toBe(false);
  });

  it('clock skew (nowMs < startMs) treats elapsed as 0', () => {
    const out = withinTimeBudget({
      startMs: NOW + 1000,
      nowMs: NOW,
      key: 'k',
      trust: stubTrust(1),
    });
    expect(out.ok).toBe(true);
    expect(out.elapsedMs).toBe(0);
  });

  it('trustOf is called with the supplied key', () => {
    let seen = '';
    withinTimeBudget({
      startMs: NOW,
      nowMs: NOW + 1,
      key: 'foo::bar::baz',
      trust: { trustOf(key) { seen = key; return 1; } },
    });
    expect(seen).toBe('foo::bar::baz');
  });
});
