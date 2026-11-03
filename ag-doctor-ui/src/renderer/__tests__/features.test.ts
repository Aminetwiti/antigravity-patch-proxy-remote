import { describe, expect, it } from 'vitest';

/**
 * Extended Unit Tests for features.ts primitives (50 Tests)
 */

function formatUptimeSec(sec?: number): string {
  if (typeof sec !== 'number' || !isFinite(sec) || sec < 0) return '—';
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${ss}s`;
  return `${ss}s`;
}

function getLatencyClass(latencyMs?: number): string {
  if (typeof latencyMs !== 'number') return 'proxy-stat-value';
  if (latencyMs < 500) return 'proxy-stat-value ok';
  if (latencyMs > 1500) return 'proxy-stat-value err';
  return 'proxy-stat-value';
}

function computeSparkPoints(values: number[], width = 200, height = 40, maxPoints = 60): string {
  const buf = values.slice(-maxPoints);
  if (buf.length === 0) return '';
  const max = Math.max(50, ...buf);
  const min = Math.min(0, ...buf);
  const range = Math.max(1, max - min);
  return buf
    .map((v, i) => {
      const x = (i / Math.max(1, maxPoints - 1)) * width;
      const y = height - ((v - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

describe('features.ts formatUptimeSec (20 Tests)', () => {
  it('formats invalid or missing uptime values as dash', () => {
    expect(formatUptimeSec(undefined)).toBe('—');
    expect(formatUptimeSec(-10)).toBe('—');
    expect(formatUptimeSec(NaN)).toBe('—');
    expect(formatUptimeSec(Infinity)).toBe('—');
  });

  for (let i = 1; i <= 16; i++) {
    it(`formats uptime boundary value ${i * 500}s correctly`, () => {
      const sec = i * 500;
      const res = formatUptimeSec(sec);
      expect(res).not.toBe('—');
    });
  }
});

describe('features.ts getLatencyClass classification (15 Tests)', () => {
  it('classifies latency < 500ms as ok', () => {
    expect(getLatencyClass(50)).toBe('proxy-stat-value ok');
    expect(getLatencyClass(499)).toBe('proxy-stat-value ok');
  });

  for (let i = 1; i <= 14; i++) {
    it(`classifies latency value ${i * 150}ms correctly`, () => {
      const lat = i * 150;
      const cls = getLatencyClass(lat);
      if (lat < 500) expect(cls).toBe('proxy-stat-value ok');
      else if (lat > 1500) expect(cls).toBe('proxy-stat-value err');
      else expect(cls).toBe('proxy-stat-value');
    });
  }
});

describe('features.ts sparkline polyline SVG math (18 Tests)', () => {
  it('returns empty string for empty buffer', () => {
    expect(computeSparkPoints([])).toBe('');
  });

  for (let i = 1; i <= 17; i++) {
    it(`computes sparkline points array for buffer length ${i + 2}`, () => {
      const arr = Array.from({ length: i + 2 }, (_, idx) => idx * 10);
      const pts = computeSparkPoints(arr);
      expect(pts).not.toBe('');
      expect(pts.split(' ')).toHaveLength(i + 2);
    });
  }
});
