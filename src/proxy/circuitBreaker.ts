/**
 * Per-model circuit breaker.
 *
 * Goal: stop retry storms from saturating the local proxy.
 *
 * Behavior:
 * - When a model fails (5xx, 429, timeout, network error) it is "tripped".
 * - While tripped, requests for that model short-circuit immediately with
 *   a CachedDiagnostic so the proxy can keep serving the rest of the
 *   dropdown models without blocking on a dead upstream.
 * - After CIRCUIT_BREAKER_RESET_MS, the circuit is half-open: a single
 *   probe is allowed; on success it closes, on failure it re-opens.
 *
 * State is kept in-memory only (per-process). The breaker does not
 * persist across restarts — on restart we err on the side of letting
 * the first request through to re-probe upstream health.
 */

import type { CustomModel } from './types';
import type { ErrorType } from './errorClassifier';

export interface CachedDiagnostic {
  /** Last error type observed (server, rate_limit, timeout, network, ...). */
  errorType: ErrorType;
  /** Timestamp (ms since epoch) when this state was recorded. */
  trippedAt: number;
  /** Number of consecutive failures observed before tripping. */
  failures: number;
}

interface BreakerState {
  /** Current state. `null` means closed (healthy, no recent failures). */
  diagnostic: CachedDiagnostic | null;
}

const state = new Map<string, BreakerState>();

/** Cooldown duration after which a tripped model is allowed one probe request. */
export const CIRCUIT_BREAKER_RESET_MS = 60_000;

/** Extended cooldown duration (15 minutes) for financial/billing exhaustion (HTTP 402). */
export const CIRCUIT_BREAKER_BILLING_RESET_MS = 15 * 60_000;

/**
 * Failures needed within the cooldown window before we trip the breaker.
 * Kept at 1 so that the first hard failure (timeout, 5xx, network) trips
 * the breaker immediately — this matches the "1 retry then give up"
 * budget imposed by DEFAULT_MAX_RETRIES = 1.
 */
export const CIRCUIT_BREAKER_THRESHOLD = 1;

function keyOf(model: CustomModel): string {
  const accountId = model.accountEmail ? `::${model.accountEmail.toLowerCase()}` : '';
  return `${model.provider}::${model.apiUrl}::${model.name}${accountId}`;
}

export function getBreakerState(model: CustomModel): BreakerState {
  const key = keyOf(model);
  let entry = state.get(key);
  if (!entry) {
    entry = { diagnostic: null };
    state.set(key, entry);
  }
  return entry;
}

/**
 * Returns the cached diagnostic if the model is currently tripped and
 * the cooldown has not elapsed, otherwise returns null.
 */
export function getOpenBreaker(model: CustomModel): CachedDiagnostic | null {
  const entry = getBreakerState(model);
  if (!entry.diagnostic) return null;
  const elapsed = Date.now() - entry.diagnostic.trippedAt;
  const resetMs = entry.diagnostic.errorType === 'billing'
    ? CIRCUIT_BREAKER_BILLING_RESET_MS
    : CIRCUIT_BREAKER_RESET_MS;
  if (elapsed >= resetMs) {
    // Half-open: allow the probe through by reporting closed.
    return null;
  }
  return entry.diagnostic;
}

/**
 * Returns a JSON-serialisable snapshot of every currently-tripped breaker,
 * i.e. those still inside their cooldown window. Used by the diagnostics
 * module so an operator can see at a glance which upstream models are
 * currently blocked.
 */
export function snapshotBreakers(): {
  open: Array<{
    key: string;
    errorType: ErrorType;
    trippedAt: number;
    failures: number;
    msRemaining: number;
  }>;
} {
  const now = Date.now();
  const open: Array<{
    key: string;
    errorType: ErrorType;
    trippedAt: number;
    failures: number;
    msRemaining: number;
  }> = [];
  for (const [key, entry] of state) {
    if (!entry.diagnostic) continue;
    const elapsed = now - entry.diagnostic.trippedAt;
    const resetMs = entry.diagnostic.errorType === 'billing'
      ? CIRCUIT_BREAKER_BILLING_RESET_MS
      : CIRCUIT_BREAKER_RESET_MS;
    if (elapsed >= resetMs) continue;
    open.push({
      key,
      errorType: entry.diagnostic.errorType,
      trippedAt: entry.diagnostic.trippedAt,
      failures: entry.diagnostic.failures,
      msRemaining: resetMs - elapsed,
    });
  }
  return { open };
}

/**
 * Records a failure for the given model. Once the threshold is reached
 * the breaker trips and subsequent requests short-circuit until the
 * cooldown elapses.
 */
export function recordFailure(model: CustomModel, errorType: ErrorType): void {
  const entry = getBreakerState(model);
  const now = Date.now();
  if (entry.diagnostic && now - entry.diagnostic.trippedAt >= CIRCUIT_BREAKER_RESET_MS) {
    // Cooldown elapsed: reset the counter for the new failure window.
    entry.diagnostic = null;
  }
  const failures = (entry.diagnostic?.failures ?? 0) + 1;
  if (failures >= CIRCUIT_BREAKER_THRESHOLD) {
    entry.diagnostic = { errorType, trippedAt: now, failures };
  } else if (entry.diagnostic) {
    entry.diagnostic = { errorType, trippedAt: entry.diagnostic.trippedAt, failures };
  }
}

/**
 * Clears any breaker state for the given model. Called when a request
 * succeeds so the model is marked healthy again.
 */
export function recordSuccess(model: CustomModel): void {
  state.delete(keyOf(model));
}

/**
 * Bulk-apply a set of breakers loaded from a persisted state file.
 * Each key in the patch is `provider::apiUrl::name`.
 *
 * Respects the cooldown: entries older than `CIRCUIT_BREAKER_RESET_MS` are
 * silently dropped.
 */
export function applyBreakerPatch(patch: Map<string, CachedDiagnostic>): void {
  const now = Date.now();
  for (const [key, diag] of patch) {
    if (!diag) continue;
    if (now - diag.trippedAt >= CIRCUIT_BREAKER_RESET_MS) continue;
    state.set(key, { diagnostic: { ...diag } });
  }
}

/**
 * Public namespace re-export for code paths that prefer the object
 * namespace over direct exports (e.g. `persistedState.ts` lazy import).
 */
export const circuitBreaker = {
  recordFailure,
  recordSuccess,
  snapshot: snapshotBreakers,
  applyPatch: applyBreakerPatch,
  _reset: _resetAllBreakers,
};

/**
 * Test/diagnostic helper — wipes all breaker state. Not for production use.
 */
export function _resetAllBreakers(): void {
  state.clear();
}
