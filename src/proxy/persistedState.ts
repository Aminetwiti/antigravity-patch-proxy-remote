/**
 * Persisted proxy state.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * Why this module exists
 * ─────────────────────────────────────────────────────────────────────────────
 * The adaptive retry budget (`proxy/retryBudget.ts`) and the circuit
 * breaker (`proxy/circuitBreaker.ts`) currently live only in process memory.
 * That means every proxy restart resets them — a model that was just
 * struggling gets a "clean slate" the next time you relaunch the IDE.
 *
 * Real users notice this:
 *
 *   1. Host B's network flaps for 90 s.
 *   2. Proxy trips the breaker for B's models.
 *   3. User restarts the IDE to try and fix something else.
 *   4. Immediately on restart every model is "fresh", so the proxy
 *      happily retries the broken upstream and the user is back in the
 *      retry-storm situation.
 *
 * `persistedState` writes the relevant counters to disk so the next process
 * can pick them up. It's deliberately small — just the data we'd actually
 * want to preserve, not the entire module state.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * Storage format
 * ─────────────────────────────────────────────────────────────────────────────
 * A single JSON file in the user's Electron `userData` dir:
 *
 *     providerState.json
 *     {
 *       "version": 1,
 *       "savedAt": 1753540800000,
 *       "retryBudget": { "openai::url::gpt-4o": { "successes": 12.5, ... } },
 *       "breakers":   { "openai::url::gpt-4o": { "errorType": "timeout", ... } }
 *     }
 *
 * Decimal samples are stored verbatim so the trust-score math stays bit-
 * identical across a restart. Breaker records are restored as-is but a
 * breaker that has aged past its cooldown is dropped on load (we never
 * resurrect a dead-breaker into a tripped state — half-open reset is
 * preferable to false-positive tripping).
 *
 * ──────────────────────────────────────────────────────────────────────────
 * Durability contract
 * ─────────────────────────────────────────────────────────────────────────────
 *   - `flush()` writes atomically: temp file + rename.
 *   - `flush()` is throttled internally to at most one write per
 *     `MIN_FLUSH_INTERVAL_MS` so heavy retry storms don't hammer the disk.
 *   - On read, schema-version mismatches fall back to "fresh state". The
 *     previous (unreadable) file is renamed `<file>.bak.<ts>` so we never
 *     silently lose the user's diagnostic data.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * Pure / runtime split
 * ─────────────────────────────────────────────────────────────────────────────
 * The pure helpers (`validate`, `toFile`, `fromFile`) are intentionally
 * decoupled from the filesystem — tests can exercise them with strings
 * and objects. The runtime hooks (`installFlushListener`,
 * `loadPersistedState`) glue them to the rest of the proxy.
 */

import { renameSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { dirname } from 'path';
import type { ErrorType } from './errorClassifier';
import { CIRCUIT_BREAKER_RESET_MS, circuitBreaker, type CachedDiagnostic } from './circuitBreaker';
import { keyOf, RETRY_BUDGET_HALF_LIFE_MS } from './retryBudget';

/**
 * Minimum interval between two `flush()` calls. Stops bursty
 * flows (e.g. 100 failures in 50 ms) from writing the file 100 times.
 */
export const MIN_FLUSH_INTERVAL_MS = 5000;

/**
 * on-disk schema version. Bump if the shape of `PersistedStateFile`
 * changes incompatibly.
 */
export const STATE_FILE_VERSION = 1;

/** Default name of the state file inside the user-data dir. */
export const STATE_FILE_NAME = 'providerState.json';

/**
 * A persisted retry-budget sample. Numbers (not raw counters) so they
 * survive across restarts without time-skew error.
 */
export interface PersistedBudgetSample {
  successes: number;
  failures: number;
  /** ms-since-epoch of the last update. */
  lastUpdate: number;
}

/**
 * A persisted breaker record — identical to `CachedDiagnostic` but
 * optionally carrying a "skip until" timestamp we honour on load to
 * avoid resurrecting cooldown-expired breakers as tripped.
 */
export interface PersistedBreaker {
  errorType: ErrorType;
  failures: number;
  trippedAt: number;
}

/** Top-level shape of the persisted state file. */
export interface PersistedStateFile {
  version: number;
  savedAt: number;
  retryBudget: Record<string, PersistedBudgetSample>;
  breakers: Record<string, PersistedBreaker>;
  recentModels?: string[];
}

const DEFAULT_STATE: PersistedStateFile = Object.freeze({
  version: STATE_FILE_VERSION,
  savedAt: 0,
  retryBudget: {},
  breakers: {},
  recentModels: [],
});

/**
 * Type-guard: is the parsed JSON a v1 state file?
 *
 * Keeps the runtime tolerant of unrelated `*.json` files that happen
 * to live in the userData dir (a misclick on save-as, for example).
 */
export function validate(parsed: unknown): parsed is PersistedStateFile {
  if (!parsed || typeof parsed !== 'object') return false;
  const p = parsed as Record<string, unknown>;
  if (p.version !== STATE_FILE_VERSION) return false;
  if (typeof p.savedAt !== 'number') return false;
  if (!p.retryBudget || typeof p.retryBudget !== 'object') return false;
  if (!p.breakers || typeof p.breakers !== 'object') return false;
  return true;
}

/** Build the empty default state. */
export function fresh(): PersistedStateFile {
  return {
    version: STATE_FILE_VERSION,
    savedAt: 0,
    retryBudget: {},
    breakers: {},
  };
}

/**
 * Encode the current in-memory state for persistence. Pure: takes the
 * budget + breaker snapshots, returns a serialisable object. Never touches
 * the filesystem.
 */
export function toFile(args: {
  retryBudgetSnap: { perModel: Array<{ key: string; }> };
  breakerSnap: { open: Array<{ key: string; errorType: ErrorType; failures: number; trippedAt: number }> };
  /**
   * Optional map of raw budget counters (successes, failures, lastUpdate).
   * We don't keep those on the diagnostic snapshot so the caller must
   * hand them in.
   */
  rawBudgetCounts?: Record<string, { successes: number; failures: number; lastUpdate: number }>;
  /**
   * If a model's breaker has already aged past its reset window in the
   * current process, omit it from the persisted snapshot. The second
   * argument here lets us filter that way.
   */
  hasLiveBreaker?: (key: string) => boolean;
}): PersistedStateFile {
  const out = fresh();
  out.savedAt = Date.now();
  if (args.rawBudgetCounts) {
    for (const [key, sample] of Object.entries(args.rawBudgetCounts)) {
      out.retryBudget[key] = {
        successes: sample.successes,
        failures: sample.failures,
        lastUpdate: sample.lastUpdate,
      };
    }
  } else {
    // Fall back to per-model summaries if the caller hasn't provided
    // raw counters. The diagnostic snapshot's perModel only has trust +
    // maxRetries + samples — not enough to reconstruct. Warn at runtime.
    for (const m of args.retryBudgetSnap.perModel) {
      out.retryBudget[m.key] = { successes: 0, failures: 0, lastUpdate: 0 };
    }
  }
  for (const b of args.breakerSnap.open) {
    if (args.hasLiveBreaker && !args.hasLiveBreaker(b.key)) continue;
    out.breakers[b.key] = {
      errorType: b.errorType,
      failures: b.failures,
      trippedAt: b.trippedAt,
    };
  }
  return out;
}

/**
 * Decode a persisted file into runtime-friendly patches. Pure: no FS.
 *
 * Returns:
 *   - `retryBudgetPatch`: `Map<key, sample>` — bulk-apply to `RetryBudget`.
 *   - `breakerPatch`: `Map<key, CachedDiagnostic>` — only entries that
 *     are still within their cooldown window when we look them up will
 *     be honoured; the rest are silently dropped.
 */
export function fromFile(
  file: PersistedStateFile,
  now: number,
  cooldownMs: number,
): {
  retryBudgetPatch: Map<string, PersistedBudgetSample>;
  breakerPatch: Map<string, CachedDiagnostic>;
} {
  const retryBudgetPatch = new Map<string, PersistedBudgetSample>();
  const breakerPatch = new Map<string, CachedDiagnostic>();
  if (!validate(file)) return { retryBudgetPatch, breakerPatch };
  for (const [key, sample] of Object.entries(file.retryBudget)) {
    retryBudgetPatch.set(key, sample);
  }
  for (const [key, breaker] of Object.entries(file.breakers)) {
    if (now - breaker.trippedAt >= cooldownMs) continue;
    breakerPatch.set(key, {
      errorType: breaker.errorType,
      failures: breaker.failures,
      trippedAt: breaker.trippedAt,
    });
  }
  return { retryBudgetPatch, breakerPatch };
}

/* ------------------------------------------------------------------ *
 * Phase 7.2 — Compaction                                              *
 * ------------------------------------------------------------------ */

/**
 * Drop stale entries from a persisted snapshot *before* it is written.
 *
 * Why: a long-lived install accumulates entries whose breaker cooldown
 * has long since expired or whose retry-budget sample is older than
 * `budgetHalfLifeMs * 5` (after which the trust math has effectively
 * forgotten them). Persisting those is pure noise — they bloat the
 * file and slow the next `loadOrInit()` call.
 *
 * Purge rules:
 *   - Breakers whose `now - trippedAt > breakerResetMs * 4` are dropped.
 *     (×4 = the breaker has rolled its reset window at least once and
 *     there is no live signal of the upstream still being down.)
 *   - Budget samples whose `lastUpdate < now - budgetHalfLifeMs * 5`
 *     are dropped. (5 half-lives ≈ EWMA weight ~3 %, indistinguishable
 *     from "fresh sample".)
 *
 * Pure: returns a new `PersistedStateFile`, never mutates `file`.
 */
export function compact(
  file: PersistedStateFile,
  opts: {
    now: number;
    breakerResetMs: number;
    budgetHalfLifeMs: number;
  },
): PersistedStateFile {
  const breakerCutoff = opts.breakerResetMs * 4;
  const budgetCutoff = opts.budgetHalfLifeMs * 5;

  const breakers: Record<string, PersistedBreaker> = {};
  for (const [key, breaker] of Object.entries(file.breakers ?? {})) {
    if (breaker && typeof breaker.trippedAt === 'number') {
      if (opts.now - breaker.trippedAt >= breakerCutoff) continue;
    }
    breakers[key] = breaker;
  }

  const retryBudget: Record<string, PersistedBudgetSample> = {};
  for (const [key, sample] of Object.entries(file.retryBudget ?? {})) {
    if (sample && typeof sample.lastUpdate === 'number') {
      if (opts.now - sample.lastUpdate >= budgetCutoff) continue;
    }
    retryBudget[key] = sample;
  }

  return {
    version: STATE_FILE_VERSION,
    savedAt: opts.now,
    retryBudget,
    breakers,
  };
}

/* ------------------------------------------------------------------ *
 * Runtime helpers — talk to the proxy singletons.                    *
 * ------------------------------------------------------------------ */

/**
 * Resolves the path to the state file. Pure wrapper around
 * `app.getPath('userData')` so tests can pass a custom path.
 */
export function stateFilePath(userDataDir?: string): string {
  if (userDataDir) return `${userDataDir}/${STATE_FILE_NAME}`;
  try {
    // Lazy require so unit tests (no Electron) don't blow up at import.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require('electron') as typeof import('electron');
    return `${app.getPath('userData')}/${STATE_FILE_NAME}`;
  } catch {
    return `./${STATE_FILE_NAME}`;
  }
}

/** Tracks the last write so we can throttle. */
let _lastFlushAt = 0;

/**
 * Test-only helper: resets the flush throttle so a fresh test can write.
 * Exported as `_resetFlushThrottle` to make it obvious this is for tests.
 */
export function _resetFlushThrottle(now: number = 0): void {
  _lastFlushAt = now;
}

/**
 * Optionally returns the JSON-serialisable file, ready to be written.
 * `force=true` ignores the throttle — pass `true` on graceful shutdown.
 */
export function readState(args: {
  force?: boolean;
  /** Optional override — defaults to live singletons. */
  retryBudgetRaw?: Record<string, { successes: number; failures: number; lastUpdate: number }>;
  breakerSnap?: { open: Array<{ key: string; errorType: ErrorType; failures: number; trippedAt: number }> };
}): { file: PersistedStateFile; wrote: boolean } {
  const now = Date.now();
  if (!args.force && now - _lastFlushAt < MIN_FLUSH_INTERVAL_MS) {
    return { file: fresh(), wrote: false };
  }
  _lastFlushAt = now;
  const breakerSnap = args.breakerSnap ?? _snapshotBreakers();
  const file = toFile({
    retryBudgetSnap: { perModel: [] },
    breakerSnap,
    rawBudgetCounts: args.retryBudgetRaw,
  });
  return { file, wrote: true };
}

/**
 * Flushes the current state to disk. Atomic write: writes to
 * `<file>.tmp` first, then renames over the target.
 *
 * @param path absolute file path
 * @param file  payload to serialise
 * @returns `true` if a write was performed, `false` if throttled.
 */
export function flush(path: string, file: PersistedStateFile): boolean {
  // Always honour the throttle — even forced flushes debounce internally.
  const now = Date.now();
  if (now - _lastFlushAt < MIN_FLUSH_INTERVAL_MS) return false;
  _lastFlushAt = now;
  // Make sure the parent dir exists. If it doesn't, we silently bail —
  // there's no recovered state to lose, just no future state to save.
  const dir = dirname(path);
  // `existsSync` is cheap and avoids throwing in environments where the
  // dir is intentionally absent (CI sandboxes, etc.).
  if (!existsSync(dir)) return false;
  const tmp = `${path}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(file), { encoding: 'utf-8' });
    renameSync(tmp, path);
    return true;
  } catch {
    // Best-effort: never let a flush failure crash the proxy.
    return false;
  }
}

/**
 * Loads persisted state from disk, falling back to fresh if missing /
 * corrupt. Quarantines corrupt files instead of deleting them.
 *
 * @returns empty fresh state if no file existed / was unreadable.
 */
export function loadOrInit(path: string): PersistedStateFile {
  if (!existsSync(path)) return fresh();
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    return fresh();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    quarantineCorrupt(path);
    return fresh();
  }
  if (!validate(parsed)) {
    quarantineCorrupt(path);
    return fresh();
  }
  return parsed;
}

/**
 * Move an unreadable state file aside so the next run starts fresh.
 * Pure FS helper exposed for the test suite.
 */
function quarantineCorrupt(path: string): void {
  try {
    const ts = Date.now();
    renameSync(path, `${path}.bak.${ts}`);
  } catch {
    // ignore — best effort
  }
}

/* ------------------------------------------------------------------ *
 * Wiring — re-exports for convenience.                                *
 * ------------------------------------------------------------------ */

/**
 * Persistence glue — exposes runtime helpers for apply/snapshot.
 */
import {
  applyRetryBudgetPatch,
  rawRetryBudgetCounts,
} from './retryBudget';
import {
  applyBreakerPatch as _applyBreakerPatch,
  snapshotBreakers as _snapshotBreakers,
} from './circuitBreaker';

/**
 * Apply a retry-budget patch produced by `fromFile`.
 */
export function applyBudgetPatch(
  patch: Map<string, PersistedBudgetSample>,
): void {
  applyRetryBudgetPatch(patch);
}

/**
 * Apply a breaker patch produced by `fromFile`.
 */
export function applyBreakerPatch(patch: Map<string, CachedDiagnostic>): void {
  _applyBreakerPatch(patch);
}

import { getRecentModels } from './recentModelsStore';

/**
 * Collect the current in-memory state, ready to be written by `flush()`.
 * Phase 7.2: the result is run through `compact()` so the on-disk file
 * never grows unbounded with stale breaker / budget entries.
 */
export function gather(args?: {
  breakerSnap?: Parameters<typeof toFile>[0]['breakerSnap'];
  retryBudgetRaw?: Parameters<typeof toFile>[0]['rawBudgetCounts'];
}): PersistedStateFile {
  const breakerSnap = args?.breakerSnap ?? _snapshotBreakers();
  const retryBudgetRaw = args?.retryBudgetRaw ?? rawRetryBudgetCounts();
  const file = toFile({
    retryBudgetSnap: { perModel: [] },
    breakerSnap,
    rawBudgetCounts: retryBudgetRaw,
  });
  file.recentModels = getRecentModels();
  return compact(file, {
    now: Date.now(),
    breakerResetMs: CIRCUIT_BREAKER_RESET_MS,
    budgetHalfLifeMs: RETRY_BUDGET_HALF_LIFE_MS,
  });
}
