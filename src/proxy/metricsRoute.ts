/**
 * Runtime metrics route (Phase 7.1).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Why
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 6 wires the proxy to the counter pipeline in `src/metrics.ts`. This
 * module exposes that pipeline over HTTP at `GET /__metrics__`, so an operator
 * can:
 *
 *   - verify whether the proxy is actually serving requests,
 *   - watch `proxy_request_ms` and `proxy_upstream_ms` live,
 *   - count error stages (`dns`, `forward`, …) by upstream host.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Design
 * ─────────────────────────────────────────────────────────────────────────────
 * - Zero deps: only `src/metrics.ts` (already in-tree).
 * - Two output formats negotiated via `Accept`:
 *      `text/plain;version=0.0.4` → Prometheus text exposition style,
 *      anything else              → indented JSON snapshot.
 * - Gated by an env flag (`AG_METRICS_ENABLED`). Default **off** so the
 *   route is invisible unless the operator opts in.
 *
 * Inspired by Cline's `CliTelemetry` (vendors/cline/src/utils/telemetry)
 * and the standard `/metrics` contract from Prometheus; we deliberately
 * don't pull a Prometheus client library — the goal is local visibility,
 * not scraping.
 */

import * as metrics from '../metrics';

export type MetricsSnapshot = ReturnType<typeof metrics.snapshot>;

/** Public toggle for callers (HTTP layer or tests). Default = false. */
export function metricsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.AG_METRICS_ENABLED;
  return v === '1' || v === 'true' || v === 'yes';
}

/** Returns a deep-clone snapshot. Pure: does not mutate global state. */
export function getMetricsSnapshot(): MetricsSnapshot {
  return metrics.snapshot();
}

function labelString(labels: Record<string, string>): string {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return '';
  return `{${keys.map((k) => `${k}=${JSON.stringify(String(labels[k]))}`).join(',')}}`;
}

/**
 * Per-account pool health entry for the google_pool_health_score metric.
 */
export interface PoolHealthEntry {
  accountKey: string;
  modelFamily: string;
  score: number;
}

/**
 * Format a snapshot in Prometheus text exposition format (v0.0.4).
 * The shape is intentionally minimal: counters, then gauges, then
 * histogram summaries. No `_bucket` rows (we don't store buckets).
 * If poolHealth is provided, appends google_pool_health_score gauge entries.
 */
export function formatPrometheus(snap: MetricsSnapshot, poolHealth?: PoolHealthEntry[]): string {
  const out: string[] = [];
  for (const c of snap.counters) {
    out.push(`# TYPE ${c.name} counter`);
    out.push(`${c.name}${labelString(c.labels)} ${c.value}`);
  }
  for (const g of snap.gauges) {
    out.push(`# TYPE ${g.name} gauge`);
    out.push(`${g.name}${labelString(g.labels)} ${g.value}`);
  }
  for (const h of snap.histograms) {
    out.push(`# TYPE ${h.name} summary`);
    const labels = labelString(h.labels);
    out.push(`${h.name}_count${labels} ${h.count}`);
    out.push(`${h.name}_sum${labels} ${h.sum}`);
    out.push(`${h.name}${labels} ${h.avg}`);
  }
  if (poolHealth && poolHealth.length > 0) {
    out.push('# HELP google_pool_health_score Dynamic health score per Google Cloud Code account (0-100+)');
    out.push('# TYPE google_pool_health_score gauge');
    for (const entry of poolHealth) {
      const safeKey = (entry.accountKey || '').replace(/[\\"\n]/g, '_');
      out.push(`google_pool_health_score{account="${safeKey}",family="${entry.modelFamily}"} ${entry.score}`);
    }
  }
  return out.join('\n') + (out.length > 0 ? '\n' : '');
}

export function negotiateContentType(
  accept: string | undefined | null,
): 'text/plain' | 'application/json' {
  const a = accept ? String(accept).toLowerCase() : '';
  return a.includes('text/plain') || a.includes('*/*') ? 'text/plain' : 'application/json';
}
