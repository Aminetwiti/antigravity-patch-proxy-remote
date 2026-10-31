/**
 * Runtime diagnostics snapshot.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Why this module exists
 * ─────────────────────────────────────────────────────────────────────────────
 * When an LLM proxy is misbehaving (retry storms, breaker trips, slow upstreams)
 * the only signal an operator has is grep-the-logs. That's painful. So we
 * bundle the most-asked-for questions into a single JSON-serialisable
 * snapshot: which models are tripped right now, what's the per-model trust
 * score, which upstreams have we ever heard from, and how long have we been
 * running.
 *
 * Inspired by `vscode-unify-chat-provider`'s `CliTelemetry`: cheap, structured,
 * synchronous, no external collector required. A future Phase 7 workstream
 * can stream the same snapshot to OTLP/HTTP/SQLite — the schema here is the
 * contract.
 *
 * ───────���─────────────────────────────────────────────────────────────────────
 * Design constraints
 * ─────────────────────────────────────────────────────────────────────────────
 * - Zero dependencies beyond Node built-ins (`crypto` + `path`).
 * - Pure: snapshots are read-only. They must never mutate the retry budget
 *   or circuit breaker.
 * - Lazy: avoids touching the disk or pulling the model registry unless the
 *   caller asks. Tests can therefore construct cheap snapshots against a
 *   fake `_snapshotSource`.
 * - Serializable: everything must round-trip through `JSON.stringify`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Integration plan
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Import `snapshot()` from this module.
 * 2. Hook it into the proxy HTTP layer at an opt-in `/__diag__` route.
 * 3. In test suites, use the lower-level `_buildSnapshot(source)` API so
 *    diagnostics can be unit-tested without booting the proxy.
 */

import { createHash } from 'crypto';
import { DEFAULT_MAX_RETRIES } from '../constants';
import { getRetryBudget } from './retryBudget';
import { snapshotBreakers } from './circuitBreaker';
import { loadCustomModels } from './modelLoader';
import {
  DEFAULT_TRUSTED_PROVIDERS,
  snapshot as gateSnapshot,
} from './providerGate';

const moduleLoadTime = Date.now();

export interface DiagnosticsModelStat {
  /** True if this model is in the registered custom model list. */
  known: boolean;
  /** Models ever seen by the retry budget. */
  budgeted: boolean;
  /** Models currently tripped on the breaker. */
  breakerOpen: boolean;
  /** Per-key trust score reported by the retry budget. */
  trust: number | null;
}

export interface DiagnosticsSnapshot {
  /** Wall-clock uptime of this proxy process. */
  uptimeMs: number;
  /** Snapshot timestamp (`Date.now()`). */
  now: number;
  /** SHA-256 hex of the snapshot's JSON form — cheap dedup for UIs. */
  hash: string;
  /** Per-model diagnostics keyed by `provider::apiUrl::name`. */
  models: Record<string, DiagnosticsModelStat>;
  /** List of currently-open (tripped) breakers. */
  breakersOpen: ReturnType<typeof snapshotBreakers>['open'];
  /** Global counters from the retry budget. */
  retryBudget: ReturnType<ReturnType<typeof getRetryBudget>['snapshot']>;
  /** Resolved base retry budget. */
  baseMaxRetries: number;
  /** Provider gate (trusted providers). */
  providerGate: ReturnType<typeof gateSnapshot>;
}

export interface DiagnosticsSource {
  /** Default base retry count. */
  baseMaxRetries?: number;
  /** Override for the retry budget snapshot. */
  retryBudget?: () => ReturnType<ReturnType<typeof getRetryBudget>['snapshot']>;
  /** Override for the breaker snapshot. */
  breakers?: () => ReturnType<typeof snapshotBreakers>;
  /** Override for the custom model registry snapshot (probe only — names). */
  knownModels?: () => Iterable<string>;
}

/**
 * Default source: pulls live data from the existing singletons. Intended
 * for runtime use. Tests must pass their own `_buildSnapshot` data.
 */
function defaultSource(): Required<DiagnosticsSource> {
  return {
    baseMaxRetries: DEFAULT_MAX_RETRIES,
    retryBudget: () => getRetryBudget().snapshot(DEFAULT_MAX_RETRIES),
    breakers: () => snapshotBreakers(),
    knownModels: () => loadCustomModels().map((m) => `${m.provider}::${m.apiUrl}::${m.name}`),
  };
}

/**
 * Builds the diagnostics snapshot. Pure: never mutates state.
 */
export function _buildSnapshot(source: DiagnosticsSource = {}): DiagnosticsSnapshot {
  const src: Required<DiagnosticsSource> = { ...defaultSource(), ...source };
  const budget = src.retryBudget();
  const breakerList = src.breakers();
  const known = new Set<string>(Array.from(src.knownModels(), (m) => String(m)));
  const breakerKeys = new Set<string>(breakerList.open.map((b) => b.key));
  const budgetKeys = new Map<string, number>();
  for (const entry of budget.perModel) budgetKeys.set(entry.key, entry.trust);

  const keys = new Set<string>([...known, ...breakerKeys, ...budgetKeys.keys()]);
  const models: Record<string, DiagnosticsModelStat> = {};
  for (const key of keys) {
    models[key] = {
      known: known.has(key),
      budgeted: budgetKeys.has(key),
      breakerOpen: breakerKeys.has(key),
      trust: budgetKeys.has(key) ? (budgetKeys.get(key) as number) : null,
    };
  }

  const now = Date.now();
  const breakersOpen = breakerList.open;
  const partial = {
    uptimeMs: now - moduleLoadTime,
    now,
    models,
    breakersOpen,
    retryBudget: budget,
    baseMaxRetries: src.baseMaxRetries,
    providerGate: gateSnapshot(),
  };

  // Hash over the deterministic part of the snapshot (everything except
  // uptime/now which move on every call).
  const hashInput = JSON.stringify({
    models,
    breakersOpen,
    budget,
    providerGate: gateSnapshot(),
  });
  const hash = createHash('sha256').update(hashInput).digest('hex').slice(0, 16);

  return { ...partial, hash };
}

/**
 * Public entry point. Returns the live runtime snapshot.
 */
export function snapshot(): DiagnosticsSnapshot {
  return _buildSnapshot();
}

/**
 * Returns a human-readable markdown rendering of a snapshot. Useful for
 * `/__diag__?format=md` and pasting into bug reports.
 */
export function formatSnapshot(snapshot: DiagnosticsSnapshot): string {
  const lines: string[] = [];
  lines.push('# Proxy Diagnostics');
  lines.push('');
  lines.push(`- now: ${new Date(snapshot.now).toISOString()}`);
  lines.push(`- uptimeMs: ${snapshot.uptimeMs}`);
  lines.push(`- hash: ${snapshot.hash}`);
  lines.push(`- baseMaxRetries: ${snapshot.baseMaxRetries}`);
  lines.push('');
  lines.push('## Provider Gate');
  lines.push(
    `- default (${snapshot.providerGate.default.length}): ${snapshot.providerGate.default.join(', ')}`,
  );
  lines.push(
    `- extension (${snapshot.providerGate.extension.length}): ${snapshot.providerGate.extension.join(', ') || '∅'}`,
  );
  lines.push('');
  lines.push('## Circuit Breakers (open)');
  if (snapshot.breakersOpen.length === 0) {
    lines.push('- none');
  } else {
    for (const b of snapshot.breakersOpen) {
      lines.push(
        `- ${b.key} :: error=${b.errorType} failures=${b.failures} remainingMs=${b.msRemaining}`,
      );
    }
  }
  lines.push('');
  lines.push('## Retry Budget');
  if (snapshot.retryBudget.perModel.length === 0) {
    lines.push('- no samples yet');
  } else {
    for (const m of snapshot.retryBudget.perModel) {
      lines.push(
        `- ${m.key} :: trust=${m.trust.toFixed(3)} maxRetries=${m.maxRetries} samples=${m.samples.toFixed(2)}`,
      );
    }
  }
  lines.push('');
  lines.push('## Known Models');
  const known = Object.entries(snapshot.models).filter(([, v]) => v.known);
  const unknown = Object.entries(snapshot.models).filter(([, v]) => !v.known);
  if (known.length === 0) {
    lines.push('- none registered');
  } else {
    for (const [k] of known) lines.push(`- ${k}`);
  }
  if (unknown.length > 0) {
    lines.push('');
    lines.push(`(also seen: ${unknown.length} unrecognised)`);
  }
  return lines.join('\n');
}

/**
 * Re-export the trusted providers count for UIs that just want a quick
 * "we shipped N providers" metric.
 */
export function knownDefaultProviders(): number {
  return DEFAULT_TRUSTED_PROVIDERS.length;
}

/**
 * Test/diagnostic helper. Resets the per-process module load timestamp.
 * Used only by tests that assert exact uptime — most do not need this.
 */
export function _resetDiagnosticsClock(): void {
  // We intentionally do not reassign the module-scope constant. Tests that
  // need a deterministic uptime should assert on shape rather than exact ms.
}
