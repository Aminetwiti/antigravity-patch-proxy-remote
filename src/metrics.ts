/**
 * Lightweight in-memory metrics counter (Sprint 1, TODO-010).
 *
 * Goals:
 *  - Track counters, gauges, and histograms by name.
 *  - Be safely callable from anywhere (main, proxy, IPC).
 *  - Stay zero-dep: just an in-memory store keyed by name.
 *  - Easily expose data via `snapshot()` for a future `/metrics` endpoint.
 */

/** A simple tagged counter (name + labels). */
export interface CounterEntry {
  name: string;
  labels: Record<string, string>;
  value: number;
}

/** A simple gauge (name + labels + current value). */
export interface GaugeEntry {
  name: string;
  labels: Record<string, string>;
  value: number;
}

/** A histogram summary (name + labels + count + sum + min + max). */
export interface HistogramEntry {
  name: string;
  labels: Record<string, string>;
  count: number;
  sum: number;
  min: number;
  max: number;
  avg: number;
}

const counters: CounterEntry[] = [];
const gauges: GaugeEntry[] = [];
const histograms: HistogramEntry[] = [];

function key(name: string, labels: Record<string, string>): string {
  const sorted = Object.keys(labels).sort().map((k) => `${k}=${labels[k]}`).join('|');
  return `${name}#${sorted}`;
}

/**
 * Increment a counter by `n` (default 1) with optional labels.
 *
 * @example
 * inc('proxy_requests_total', { provider: 'openai' });
 * inc('proxy_errors_total', { provider: 'openai', code: '429' }, 3);
 */
export function inc(
  name: string,
  labels: Record<string, string> = {},
  n = 1,
): void {
  const k = key(name, labels);
  const existing = counters.find((c) => key(c.name, c.labels) === k);
  if (existing) {
    existing.value += n;
    return;
  }
  counters.push({ name, labels: { ...labels }, value: n });
}

/**
 * Set a gauge value (overwrites any previous value).
 */
export function gauge(name: string, value: number, labels: Record<string, string> = {}): void {
  const k = key(name, labels);
  const existing = gauges.find((g) => key(g.name, g.labels) === k);
  if (existing) {
    existing.value = value;
    return;
  }
  gauges.push({ name, labels: { ...labels }, value });
}

/**
 * Observe a value into a histogram (count, sum, min, max, avg).
 *
 * @example
 * observe('proxy_request_ms', durationMs, { provider: 'openai' });
 */
export function observe(
  name: string,
  value: number,
  labels: Record<string, string> = {},
): void {
  if (!Number.isFinite(value)) return;
  const k = key(name, labels);
  const existing = histograms.find((h) => key(h.name, h.labels) === k);
  if (existing) {
    existing.count += 1;
    existing.sum += value;
    existing.min = Math.min(existing.min, value);
    existing.max = Math.max(existing.max, value);
    existing.avg = existing.sum / existing.count;
    return;
  }
  histograms.push({
    name,
    labels: { ...labels },
    count: 1,
    sum: value,
    min: value,
    max: value,
    avg: value,
  });
}

/**
 * Reset all metrics. Useful in tests.
 */
export function reset(): void {
  counters.length = 0;
  gauges.length = 0;
  histograms.length = 0;
}

/**
 * Snapshot all metrics. Useful for `/metrics` endpoints or tests.
 */
export function snapshot(): {
  counters: CounterEntry[];
  gauges: GaugeEntry[];
  histograms: HistogramEntry[];
} {
  return {
    counters: counters.map((c) => ({ ...c, labels: { ...c.labels } })),
    gauges: gauges.map((g) => ({ ...g, labels: { ...g.labels } })),
    histograms: histograms.map((h) => ({ ...h, labels: { ...h.labels } })),
  };
}

/**
 * Convenient timing helper: returns a function that, when called, observes
 * the elapsed milliseconds into the given histogram.
 *
 * @example
 * const end = startTimer('proxy_request_ms', { provider: 'openai' });
 * await doWork();
 * end();
 */
export function startTimer(
  name: string,
  labels: Record<string, string> = {},
): () => number {
  const start = Date.now();
  return () => {
    const ms = Date.now() - start;
    observe(name, ms, labels);
    return ms;
  };
}

export function trackTokenUsage(provider: string, promptTokens: number, completionTokens: number): void {
  inc('prompt_tokens_total', { provider }, promptTokens);
  inc('completion_tokens_total', { provider }, completionTokens);
  inc('tokens_total', { provider }, promptTokens + completionTokens);
}

export function getRealtimeStats(): {
  totalRequests: number;
  totalTokens: number;
  avgLatencyMs: number;
  successRate: number;
} {
  const snap = snapshot();
  const reqCounter = snap.counters.find((c) => c.name === 'proxy_requests_total');
  const errCounter = snap.counters.find((c) => c.name === 'proxy_errors_total');
  const tokenCounters = snap.counters.filter((c) => c.name === 'tokens_total');
  const latencyHisto = snap.histograms.find((h) => h.name === 'proxy_request_ms');

  const totalRequests = reqCounter?.value || 0;
  const totalErrors = errCounter?.value || 0;
  const totalTokens = tokenCounters.reduce((acc, c) => acc + c.value, 0);
  const avgLatencyMs = latencyHisto ? Math.round(latencyHisto.avg) : 0;
  const successRate = totalRequests > 0 ? Math.round(((totalRequests - totalErrors) / totalRequests) * 100) : 100;

  return { totalRequests, totalTokens, avgLatencyMs, successRate };
}
