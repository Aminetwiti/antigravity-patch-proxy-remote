/**
 * Per-model adaptive retry budget.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Why this layer exists
 * ─────────────────────────────────────────────────────────────────────────────
 * The static `MAX_RETRIES` cap is the same for every model. In practice:
 *
 *   - A flaky model that flips healthy/sick every few minutes deserves *less*
 *     retries per request (we don't want to amplify the noise).
 *   - A battle-tested primary model that has been 100% uptime for an hour
 *     deserves *more* retries per request — when it eventually hiccups, a
 *     retry almost always succeeds.
 *
 * Pattern ported from `vscode-unify-chat-provider`'s `PerModelRetryConfig`:
 * keep a small sliding window of (success/failure) samples per model, derive
 * a "trust score" in [0, 1], and let that score scale the retry budget.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Trust score
 * ─────────────────────────────────────────────────────────────────────────────
 *   trust = successes / (successes + failures)
 *
 * Decay uses a half-life so an idle model recovers from historical failures.
 * Decay is applied on read paths only — never on record — because records
 * happen in tight succession (sub-millisecond) and decaying on every write
 * would amplify the count by a tiny factor per call, causing the win for
 * trusted models to evaporate.
 *
 *   effective_failures = failures * 2^(-elapsed / HALF_LIFE_MS)
 *
 * When the model is completely idle, the trust score drifts toward 0.5
 * (neutral) so the budget settles back to a sensible default.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Retry budget math
 * ─────────────────────────────────────────────────────────────────────────────
 *   effectiveMaxRetries = floor(BASE_MAX_RETRIES * trustScore)
 *
 * Then a floor guarantees every model (even untrusted ones) gets at least
 * one retry, which is what the existing circuit breaker / call sites
 * already expect.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Public API
 * ─────────────────────────────────────────────────────────────────────────────
 *   const budget = new RetryBudget();
 *   budget.recordSuccess(model);
 *   budget.recordFailure(model);
 *   const maxRetries = budget.getMaxRetries(model, BASE_MAX_RETRIES);
 *
 *   // Or via the module-level singleton (used by the proxy):
 *   import { getRetryBudget } from './retryBudget';
 *   getRetryBudget().recordFailure(model);
 *   const retries = getRetryBudget().getMaxRetries(model, 3);
 */

import type { CustomModel } from './types';

export const RETRY_BUDGET_BASE = 3;
export const RETRY_BUDGET_FLOOR = 1;
export const RETRY_BUDGET_HALF_LIFE_MS = 300_000;  // 5min half-life
/** Cap on stored samples per model so we don't leak memory in long-running sessions. */
export const RETRY_BUDGET_MAX_SAMPLES = 256;

export interface ModelBudgetSample {
  /** Successful requests in the current window. */
  successes: number;
  /** Failed requests in the current window. */
  failures: number;
  /** Timestamp (ms) of the last sample (any kind). Used for decay. */
  lastUpdate: number;
}

export interface RetryBudgetVerdict {
  /** The trust score in [0, 1]. Higher means more trusted. */
  trust: number;
  /** The scaled retry cap (>= floor). */
  maxRetries: number;
  /** Number of raw samples used to compute the trust score. */
  samples: number;
  /** Effective failures after time-based decay. */
  effectiveFailures: number;
  /** Effective successes after time-based decay. */
  effectiveSuccesses: number;
}

/**
 * Trust score in [0, 1]. Returns 0.5 for an empty window (neutral).
 */
export function computeTrustScore(
  successes: number,
  failures: number,
): number {
  const total = successes + failures;
  if (total <= 0) return 0.5;
  return successes / total;
}

/**
 * Number of retries to allow for a given model, given a base cap.
 * Returns a value in [RETRY_BUDGET_FLOOR, base].
 */
export function scaleRetries(base: number, trust: number): number {
  const scaled = Math.floor(base * trust);
  // Floor — even untrusted models get one retry.
  if (scaled < RETRY_BUDGET_FLOOR) return RETRY_BUDGET_FLOOR;
  // Ceiling — never exceed the base.
  if (scaled > base) return base;
  return scaled;
}

/**
 * Build a string key that uniquely identifies a model. Used internally to
 * key the per-model sliding window.
 */
export function keyOf(model: CustomModel): string {
  return `${model.provider}::${model.apiUrl}::${model.name}`;
}

/**
 * Sample type for the public API.
 */
export type RetryBudgetSample = 'success' | 'failure';

/**
 * Sliding-window per-model retry budget. Each instance owns its own state
 * so tests can construct a fresh budget per case without leaking shared
 * counters across the suite.
 */
export class RetryBudget {
  private readonly budgets = new Map<string, ModelBudgetSample>();

  /** Records a sample. Counter increments without intermediate decay. */
  record(model: CustomModel, sample: RetryBudgetSample): void {
    const now = Date.now();
    const entry = this._getOrCreate(model, now);
    if (sample === 'success') entry.successes += 1;
    else entry.failures += 1;
    entry.lastUpdate = now;
    this._cap(model);
  }

  /** Sugar for `record(model, 'success')`. */
  recordSuccess(model: CustomModel): void {
    this.record(model, 'success');
  }

  /** Sugar for `record(model, 'failure')`. */
  recordFailure(model: CustomModel): void {
    this.record(model, 'failure');
  }

  /** Returns the number of retries to allow for a model. */
  getMaxRetries(model: CustomModel, base: number): number {
    return scaleRetries(base, this.getTrustScore(model));
  }

  /** Returns a structured verdict for diagnostics / tests. */
  getVerdict(model: CustomModel, base: number): RetryBudgetVerdict {
    const now = Date.now();
    const entry = this._getOrCreate(model, now);
    this._applyDecay(entry, now);
    const trust = computeTrustScore(entry.successes, entry.failures);
    return {
      trust,
      maxRetries: scaleRetries(base, trust),
      samples: entry.successes + entry.failures,
      effectiveSuccesses: entry.successes,
      effectiveFailures: entry.failures,
    };
  }

  /** Returns the trust score in [0, 1]. */
  getTrustScore(model: CustomModel): number {
    const now = Date.now();
    const entry = this._getOrCreate(model, now);
    this._applyDecay(entry, now);
    return computeTrustScore(entry.successes, entry.failures);
  }

  /** Clears all stored samples. Tests / hot reloads. */
  reset(): void {
    this.budgets.clear();
  }

  /** Wipes a single model. Useful when a model is removed from config. */
  forget(model: CustomModel): void {
    this.budgets.delete(keyOf(model));
  }

  /**
   * Apply a persistence patch (typically loaded from disk).
   * Existing entries are overwritten; missing entries are preserved.
   * Used by `persistedState.ts` on startup.
   */
  applyPatch(
    patch: Map<string, import('./persistedState').PersistedBudgetSample>,
  ): void {
    for (const [key, sample] of patch) {
      if (!sample) continue;
      this.budgets.set(key, {
        successes: sample.successes,
        failures: sample.failures,
        lastUpdate: sample.lastUpdate,
      });
    }
  }

  /**
   * Raw success/failure counters per model — used to serialise state for
   * persistence on shutdown / throttled flushes.
   */
  rawCounts(): Record<
    string,
    { successes: number; failures: number; lastUpdate: number }
  > {
    const out: Record<
      string,
      { successes: number; failures: number; lastUpdate: number }
    > = {};
    for (const [key, sample] of this.budgets) {
      // Don't decay here — we want to persist exactly what we have.
      out[key] = {
        successes: sample.successes,
        failures: sample.failures,
        lastUpdate: sample.lastUpdate,
      };
    }
    return out;
  }

  /**
   * Returns a JSON-serialisable snapshot of every tracked model. Used by the
   * `diagnostics` module. Each entry includes its current trust score
   * (decay applied) and the sample count.
   */
  snapshot(base: number): {
    perModel: Array<{
      key: string;
      trust: number;
      maxRetries: number;
      samples: number;
    }>;
  } {
    const now = Date.now();
    const perModel: Array<{
      key: string;
      trust: number;
      maxRetries: number;
      samples: number;
    }> = [];
    for (const [key, sample] of this.budgets) {
      this._applyDecay(sample, now);
      const trust = computeTrustScore(sample.successes, sample.failures);
      perModel.push({
        key,
        trust,
        maxRetries: scaleRetries(base, trust),
        samples: sample.successes + sample.failures,
      });
    }
    return { perModel };
  }

  /** Applies exponential decay to the stored samples. Read-side only. */
  private _applyDecay(sample: ModelBudgetSample, now: number): void {
    const elapsed = Math.max(0, now - sample.lastUpdate);
    if (elapsed === 0) return;
    if (elapsed >= RETRY_BUDGET_HALF_LIFE_MS * 10) {
      // An idle model that's been silent for what amounts to an entire
      // operational lifetime. Reset to neutral rather than decaying on
      // a possibly-massive factor.
      sample.successes = 0;
      sample.failures = 0;
      sample.lastUpdate = now;
      return;
    }
    const decayFactor = Math.pow(2, -elapsed / RETRY_BUDGET_HALF_LIFE_MS);
    sample.successes *= decayFactor;
    sample.failures *= decayFactor;
    sample.lastUpdate = now;
  }

  private _getOrCreate(model: CustomModel, now: number): ModelBudgetSample {
    const key = keyOf(model);
    let entry = this.budgets.get(key);
    if (!entry) {
      entry = { successes: 0, failures: 0, lastUpdate: now };
      this.budgets.set(key, entry);
    }
    return entry;
  }

  /** Cap memory usage by trimming to MAX_SAMPLES on the most active model. */
  private _cap(model: CustomModel): void {
    const entry = this.budgets.get(keyOf(model));
    if (!entry) return;
    const total = entry.successes + entry.failures;
    if (total > RETRY_BUDGET_MAX_SAMPLES) {
      // Scale both counters down proportionally.
      const factor = RETRY_BUDGET_MAX_SAMPLES / total;
      entry.successes *= factor;
      entry.failures *= factor;
    }
  }
}

/**
 * Process-wide singleton. The proxy uses this for simplicity.
 * Tests can construct `new RetryBudget()` directly to keep state isolated.
 */
let _singleton: RetryBudget | null = null;

export function getRetryBudget(): RetryBudget {
  if (!_singleton) _singleton = new RetryBudget();
  return _singleton;
}

/**
 * Applies a persistence patch to the singleton. Used by `persistedState.ts`
 * during startup once the on-disk state file has been parsed.
 */
export function applyRetryBudgetPatch(
  patch: Map<string, import('./persistedState').PersistedBudgetSample>,
): void {
  getRetryBudget().applyPatch(patch);
}

/**
 * Returns the singleton's raw counters. Used by `persistedState.ts` to
 * build the on-disk snapshot at shutdown.
 */
export function rawRetryBudgetCounts(): Record<
  string,
  { successes: number; failures: number; lastUpdate: number }
> {
  return getRetryBudget().rawCounts();
}

/**
 * Test/diagnostic helper. Resets the singleton back to a fresh state.
 */
export function _resetRetryBudget(): void {
  if (_singleton) _singleton.reset();
  _singleton = null;
}
