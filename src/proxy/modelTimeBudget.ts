/**
 * Phase 7.3 — Per-model time-budget ceiling.
 *
 * Why
 * ───
 * The retry budget (`retryBudget.ts`) caps the *count* of retries a
 * model can use over a sliding window. That's good for load shedding
 * but blind to elapsed wall-clock time: a model that has been failing
 * for 12 minutes with a 60 s `Retry-After` will be allowed to keep
 * retrying because it has used fewer than N attempts.
 *
 * `modelTimeBudget` adds a hard wall-clock ceiling on top of the count
 * budget. It's computed once per request and shrinks as trust drops:
 *
 *   ceilingMs = clamp(BASE_MS * trust,  MIN_MS, MAX_MS)
 *
 * Where `trust ∈ [0, 1]` is the per-model trust score from `RetryBudget`.
 *
 * Pure: no I/O, no clock reads. Callers inject `now` so tests can pin it.
 *
 * Used by `retryStrategy.buildRetryDecision()`:
 *   if (elapsedSinceRequestStart >= getTimeBudgetMs(key, trust)) skip retry.
 */

export interface TrustLookup {
  trustOf(key: string): number;
}

export function computeTimeBudgetMs(trust: number): number {
  const t = Math.min(Math.max(trust, 0), 1);
  const raw = TIME_BUDGET_BASE_MS * t;
  return Math.min(Math.max(raw, TIME_BUDGET_MIN_MS), TIME_BUDGET_MAX_MS);
}

export function withinTimeBudget(args: {
  startMs: number;
  nowMs: number;
  key: string;
  trust: TrustLookup;
}): { ok: boolean; elapsedMs: number; ceilingMs: number } {
  const elapsed = Math.max(0, args.nowMs - args.startMs);
  const ceiling = computeTimeBudgetMs(args.trust.trustOf(args.key));
  return { ok: elapsed < ceiling, elapsedMs: elapsed, ceilingMs: ceiling };
}

/**
 * Lower bound. 5 s keeps us from aborting in-flight requests that
 * haven't even reached the first retry yet.
 */
export const TIME_BUDGET_MIN_MS = 5_000;

/**
 * Upper bound. 5 minutes matches the trust-budget half-life × 1 —
 * a model whose trust is 1.0 may still ride out one long outage
 * before we hand back control to the caller.
 */
export const TIME_BUDGET_MAX_MS = 300_000;

/**
 * Base ceiling applied to a perfectly-trusted (trust = 1) model.
 * Real ceilings are computed as `clamp(BASE * trust, MIN, MAX)`.
 */
export const TIME_BUDGET_BASE_MS = 300_000; // 5 min
