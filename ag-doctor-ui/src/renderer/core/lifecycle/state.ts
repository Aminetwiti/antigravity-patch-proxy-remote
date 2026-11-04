/**
 * state.ts — shared fetch/status state primitive for the ag-doctor renderer.
 *
 * Inspired by `vscode-unify-chat-provider`'s `OfficialModelsFetchState` +
 * `recordSuccess` / `recordFailure` / `shouldFetchByState` trio. The goal is to
 * replace the ad-hoc `let fetching = false` + free-form `setStatus('busy')`
 * stringly-typed tracking scattered through `app.ts` with one uniform shape per
 * async flow (models fetch, MITM load, patch load, Antigravity status, …).
 *
 * Authored script-style (no top-level import/export) so it compiles into the same
 * `app.js` bundle as `app.ts` and shares the renderer global scope. `tsc` emits
 * this as a script; `error-decoder.ts`/`modal-manager.ts` follow the same pattern.
 */

// ─────────────────────────────────────────────────────────────────────────────
// FetchState
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Uniform async-fetch state. Mirrors the vendor's `OfficialModelsFetchState`
 * (minus the persisted `models`/`modelsHash` fields, which live in the caller).
 */
interface FetchState {
  /** True while a fetch is in flight. Single source of truth for "busy". */
  isFetching: boolean;
  /** Epoch ms of the last *successful* fetch. */
  lastFetchTime: number;
  /** Epoch ms of the last fetch attempt (success or failure). */
  lastAttemptTime: number;
  /** Last error message, if any. Cleared on success. */
  lastError?: string;
  /** Epoch ms when `lastError` was recorded. */
  lastErrorTime?: number;
  /** Consecutive failures since the last success (drives backoff). */
  consecutiveErrorFetches: number;
}

/** Zero-valued state. Mirrors the vendor's `ensureState` default. */
function createFetchState(): FetchState {
  return {
    isFetching: false,
    lastFetchTime: 0,
    lastAttemptTime: 0,
    lastError: undefined,
    lastErrorTime: undefined,
    consecutiveErrorFetches: 0,
  };
}

/** Record a successful fetch. Clears error fields. Mirrors `recordSuccess`. */
function recordFetchSuccess(state: FetchState, now: number = Date.now()): void {
  state.lastFetchTime = now;
  state.lastAttemptTime = now;
  state.lastError = undefined;
  state.lastErrorTime = undefined;
  state.consecutiveErrorFetches = 0;
  state.isFetching = false;
}

/** Record a failed fetch. Increments the consecutive-error counter. */
function recordFetchFailure(
  state: FetchState,
  errorMessage: string,
  now: number = Date.now(),
): void {
  state.lastAttemptTime = now;
  state.lastError = errorMessage;
  state.lastErrorTime = now;
  state.consecutiveErrorFetches = (state.consecutiveErrorFetches ?? 0) + 1;
  state.isFetching = false;
}

/**
 * Time-based refetch gate. Returns true when `intervalMs` has elapsed since the
 * last attempt (or there has never been one). Mirrors `shouldFetchByState`.
 */
function shouldRefetch(
  state: FetchState,
  intervalMs: number,
  now: number = Date.now(),
): boolean {
  const last = state.lastAttemptTime || state.lastFetchTime;
  if (!last) return true;
  return now - last >= intervalMs;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tiny typed event emitter (mirrors the vendor's onDidUpdateEmitter.fire)
// ─────────────────────────────────────────────────────────────────────────────

interface Emitter<T> {
  fire(value: T): void;
  event(handler: (value: T) => void): () => void;
}

/**
 * Minimal re-usable event emitter so views can *subscribe* to state changes
 * instead of polling. `event()` returns a disposer.
 */
function createEmitter<T>(): Emitter<T> {
  const handlers = new Set<(value: T) => void>();
  return {
    fire(value: T): void {
      for (const h of Array.from(handlers)) {
        try {
          h(value);
        } catch {
          /* a misbehaving listener must not break the others */
        }
      }
    },
    event(handler: (value: T) => void): () => void {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
}
