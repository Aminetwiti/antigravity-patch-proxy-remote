import { describe, it, expect, beforeEach } from 'vitest';
import { inc, gauge, observe, reset, snapshot, startTimer } from '../metrics';

describe('inc', () => {
  beforeEach(() => reset());

  it('creates a counter on first call', () => {
    inc('requests_total');
    expect(snapshot().counters).toEqual([
      { name: 'requests_total', labels: {}, value: 1 },
    ]);
  });

  it('increments an existing counter by n', () => {
    inc('requests_total', { provider: 'openai' }, 3);
    inc('requests_total', { provider: 'openai' }, 2);
    const c = snapshot().counters.find((c) => c.name === 'requests_total');
    expect(c?.value).toBe(5);
  });

  it('distinguishes counters by labels', () => {
    inc('requests_total', { provider: 'openai' });
    inc('requests_total', { provider: 'anthropic' });
    const counters = snapshot().counters;
    expect(counters).toHaveLength(2);
  });

  it('uses default n=1', () => {
    inc('a');
    inc('a');
    expect(snapshot().counters[0].value).toBe(2);
  });
});

describe('gauge', () => {
  beforeEach(() => reset());

  it('sets a gauge value', () => {
    gauge('queue_depth', 42);
    expect(snapshot().gauges).toEqual([
      { name: 'queue_depth', labels: {}, value: 42 },
    ]);
  });

  it('overwrites a previous gauge value', () => {
    gauge('queue_depth', 42);
    gauge('queue_depth', 7);
    expect(snapshot().gauges[0].value).toBe(7);
  });
});

describe('observe', () => {
  beforeEach(() => reset());

  it('records a single observation', () => {
    observe('latency_ms', 100);
    const h = snapshot().histograms[0];
    expect(h.count).toBe(1);
    expect(h.sum).toBe(100);
    expect(h.min).toBe(100);
    expect(h.max).toBe(100);
    expect(h.avg).toBe(100);
  });

  it('accumulates observations', () => {
    observe('latency_ms', 50);
    observe('latency_ms', 150);
    const h = snapshot().histograms[0];
    expect(h.count).toBe(2);
    expect(h.sum).toBe(200);
    expect(h.min).toBe(50);
    expect(h.max).toBe(150);
    expect(h.avg).toBe(100);
  });

  it('skips non-finite values', () => {
    observe('latency_ms', Number.NaN);
    observe('latency_ms', Infinity);
    expect(snapshot().histograms).toHaveLength(0);
  });
});

describe('startTimer', () => {
  beforeEach(() => reset());

  it('observes elapsed ms', () => {
    const end = startTimer('latency_ms', { provider: 'openai' });
    const observed = end();
    expect(observed).toBeGreaterThanOrEqual(0);
    const h = snapshot().histograms[0];
    expect(h.count).toBe(1);
    expect(h.labels.provider).toBe('openai');
  });

  it('can be called multiple times', () => {
    const end = startTimer('latency_ms');
    end();
    end();
    const h = snapshot().histograms[0];
    expect(h.count).toBe(2);
  });
});

describe('reset', () => {
  it('clears all metrics', () => {
    inc('a');
    gauge('b', 1);
    observe('c', 1);
    reset();
    expect(snapshot()).toEqual({ counters: [], gauges: [], histograms: [] });
  });
});

describe('snapshot', () => {
  beforeEach(() => reset());

  it('returns a deep copy', () => {
    inc('a', { x: '1' });
    const s = snapshot();
    s.counters[0].value = 99;
    expect(snapshot().counters[0].value).toBe(1);
  });
});

describe('label ordering', () => {
  beforeEach(() => reset());

  it('treats label order as insignificant', () => {
    inc('a', { x: '1', y: '2' });
    inc('a', { y: '2', x: '1' });
    expect(snapshot().counters).toHaveLength(1);
    expect(snapshot().counters[0].value).toBe(2);
  });
});
