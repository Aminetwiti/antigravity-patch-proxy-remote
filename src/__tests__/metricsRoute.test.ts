/**
 * Tests for the `/__metrics__` route module (Phase 7.1).
 *
 * Asserts:
 *   - `metricsEnabled` defaults to false and respects AG_METRICS_ENABLED.
 *   - `formatPrometheus` produces well-formed text v0.0.4 output.
 *   - `negotiateContentType` honours Accept headers.
 *   - `getMetricsSnapshot` does not mutate global counters.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as base from '../metrics';
import {
  formatPrometheus,
  metricsEnabled,
  negotiateContentType,
  getMetricsSnapshot,
} from '../proxy/metricsRoute';

describe('metricsRoute / metricsEnabled', () => {
  it('defaults to false', () => {
    expect(metricsEnabled({})).toBe(false);
  });

  it('honours AG_METRICS_ENABLED=1', () => {
    expect(metricsEnabled({ AG_METRICS_ENABLED: '1' })).toBe(true);
  });

  it('honours AG_METRICS_ENABLED=true', () => {
    expect(metricsEnabled({ AG_METRICS_ENABLED: 'true' })).toBe(true);
  });

  it('honours AG_METRICS_ENABLED=yes', () => {
    expect(metricsEnabled({ AG_METRICS_ENABLED: 'yes' })).toBe(true);
  });

  it('rejects unknown values', () => {
    expect(metricsEnabled({ AG_METRICS_ENABLED: 'on' })).toBe(false);
    expect(metricsEnabled({ AG_METRICS_ENABLED: '' })).toBe(false);
  });
});

describe('metricsRoute / negotiateContentType', () => {
  it('returns application/json when absent', () => {
    expect(negotiateContentType(undefined)).toBe('application/json');
    expect(negotiateContentType(null)).toBe('application/json');
    expect(negotiateContentType('')).toBe('application/json');
  });

  it('returns text/plain for text/plain', () => {
    expect(negotiateContentType('text/plain')).toBe('text/plain');
    expect(negotiateContentType('text/plain;version=0.0.4')).toBe('text/plain');
  });

  it('returns text/plain for */*', () => {
    expect(negotiateContentType('*/*')).toBe('text/plain');
  });

  it('returns application/json for application/json', () => {
    expect(negotiateContentType('application/json')).toBe('application/json');
  });
});

describe('metricsRoute / formatPrometheus', () => {
  beforeEach(() => base.reset());

  it('renders a counter family with TYPE prefix', () => {
    base.inc('proxy_requests_total', { provider: 'openai' });
    const snap = base.snapshot();
    const out = formatPrometheus(snap);
    expect(out).toContain('# TYPE proxy_requests_total counter');
    expect(out).toContain('proxy_requests_total{provider="openai"} 1');
  });

  it('renders a gauge without labels', () => {
    base.gauge('queue_depth', 42);
    const out = formatPrometheus(base.snapshot());
    expect(out).toContain('# TYPE queue_depth gauge');
    expect(out).toContain('queue_depth 42');
  });

  it('renders a histogram summary (count/sum/avg)', () => {
    base.observe('proxy_request_ms', 100);
    base.observe('proxy_request_ms', 300);
    const out = formatPrometheus(base.snapshot());
    expect(out).toContain('# TYPE proxy_request_ms summary');
    expect(out).toContain('proxy_request_ms_count 2');
    expect(out).toContain('proxy_request_ms_sum 400');
    expect(out).toContain('proxy_request_ms 200');
  });

  it('escapes quotes and newlines in label values', () => {
    base.inc('foo_total', { x: 'a"b\nc' });
    const out = formatPrometheus(base.snapshot());
    expect(out).toContain('foo_total{x="a\\"b\\nc"}');
  });

  it('sorts labels deterministically', () => {
    base.inc('bar_total', { b: '2', a: '1' });
    const out = formatPrometheus(base.snapshot());
    expect(out).toContain('bar_total{a="1",b="2"}');
  });

  it('returns empty body for an empty snapshot', () => {
    const out = formatPrometheus({ counters: [], gauges: [], histograms: [] });
    expect(out).toBe('');
  });
});

describe('metricsRoute / getMetricsSnapshot', () => {
  beforeEach(() => base.reset());

  it('returns a deep copy (caller mutations do not leak)', () => {
    base.inc('a_total');
    const snap = getMetricsSnapshot();
    snap.counters[0].value = 99;
    const snap2 = base.snapshot();
    expect(snap2.counters[0].value).toBe(1);
  });
});

describe('formatPrometheus / pool_health metric', () => {
  const emptySnap = { counters: [], gauges: [], histograms: [] };

  it('includes google_pool_health_score when poolHealth is provided', () => {
    const poolHealth = [
      { accountKey: 'google:alice@test.com', modelFamily: 'gemini', score: 72 },
      { accountKey: 'google:bob@test.com', modelFamily: 'claude', score: 0 },
    ];
    const output = formatPrometheus(emptySnap as any, poolHealth);
    expect(output).toContain('google_pool_health_score');
    expect(output).toContain('alice@test.com');
    expect(output).toContain('72');
    expect(output).toContain('bob@test.com');
    expect(output).toContain('family="claude"');
  });

  it('omits pool_health section when poolHealth is undefined', () => {
    const output = formatPrometheus(emptySnap as any);
    expect(output).not.toContain('google_pool_health_score');
  });

  it('omits pool_health section when poolHealth is empty array', () => {
    const output = formatPrometheus(emptySnap as any, []);
    expect(output).not.toContain('google_pool_health_score');
  });
});
