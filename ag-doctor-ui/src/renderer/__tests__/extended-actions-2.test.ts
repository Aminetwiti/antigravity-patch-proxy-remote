import { describe, expect, it } from 'vitest';

/**
 * Extended Test Suite Part 2:
 * - Diagnostic Report JSON Parser & Health Scoring (25 tests)
 * - Toast Queue & Notification Lifecycle (15 tests)
 * - Theme Switcher & Visual Preference Resolution (10 tests)
 */

// ── Diagnostic Report Parser & Health Scoring ──────────────────────────────

export interface DiagnosticCheckItem {
  id: string;
  name: string;
  category: 'network' | 'patch' | 'binary' | 'cert' | 'models';
  status: 'pass' | 'warn' | 'fail';
  message: string;
  autoFixable?: boolean;
}

export interface DiagnosticReport {
  timestamp: number;
  version: string;
  checks: DiagnosticCheckItem[];
}

export function computeHealthScore(report: DiagnosticReport): {
  score: number; // 0 - 100
  rating: 'EXCELLENT' | 'GOOD' | 'NEEDS_ATTENTION' | 'CRITICAL';
  fixableCount: number;
  failedCount: number;
} {
  if (!report.checks || report.checks.length === 0) {
    return { score: 0, rating: 'CRITICAL', fixableCount: 0, failedCount: 0 };
  }

  let totalWeight = 0;
  let earnedWeight = 0;
  let fixableCount = 0;
  let failedCount = 0;

  report.checks.forEach((c) => {
    const weight = c.category === 'patch' || c.category === 'binary' ? 3 : 2;
    totalWeight += weight;

    if (c.status === 'pass') {
      earnedWeight += weight;
    } else if (c.status === 'warn') {
      earnedWeight += weight * 0.5;
    } else {
      failedCount++;
      if (c.autoFixable) fixableCount++;
    }
  });

  const score = Math.round((earnedWeight / totalWeight) * 100);

  let rating: 'EXCELLENT' | 'GOOD' | 'NEEDS_ATTENTION' | 'CRITICAL' = 'CRITICAL';
  if (score >= 90) rating = 'EXCELLENT';
  else if (score >= 75) rating = 'GOOD';
  else if (score >= 50) rating = 'NEEDS_ATTENTION';

  return { score, rating, fixableCount, failedCount };
}

describe('Diagnostic Report Parser & Health Scoring (25 Tests)', () => {
  it('returns 100% score and EXCELLENT rating when all checks pass', () => {
    const report: DiagnosticReport = {
      timestamp: Date.now(),
      version: '2.2.0',
      checks: [
        { id: '1', name: 'Proxy Port', category: 'network', status: 'pass', message: 'Proxy port open' },
        { id: '2', name: 'MITM Port', category: 'network', status: 'pass', message: 'Port 443 listening' },
        { id: '3', name: 'ASAR Integrity', category: 'patch', status: 'pass', message: 'ASAR clean' },
        { id: '4', name: 'CA Certificate', category: 'cert', status: 'pass', message: 'CA in store' },
      ],
    };
    const res = computeHealthScore(report);
    expect(res.score).toBe(100);
    expect(res.rating).toBe('EXCELLENT');
    expect(res.failedCount).toBe(0);
    expect(res.fixableCount).toBe(0);
  });

  it('returns CRITICAL rating and 0 score when all checks fail', () => {
    const report: DiagnosticReport = {
      timestamp: Date.now(),
      version: '2.2.0',
      checks: [
        { id: '1', name: 'Proxy Port', category: 'network', status: 'fail', message: 'Down', autoFixable: true },
        { id: '2', name: 'ASAR Integrity', category: 'patch', status: 'fail', message: 'Tampered', autoFixable: false },
      ],
    };
    const res = computeHealthScore(report);
    expect(res.score).toBe(0);
    expect(res.rating).toBe('CRITICAL');
    expect(res.failedCount).toBe(2);
    expect(res.fixableCount).toBe(1);
  });

  it('weights patch and binary checks higher than cert or model checks', () => {
    const report1: DiagnosticReport = {
      timestamp: Date.now(),
      version: '2.2.0',
      checks: [
        { id: '1', name: 'ASAR Integrity', category: 'patch', status: 'fail', message: 'Fail' }, // weight 3
        { id: '2', name: 'CA Cert', category: 'cert', status: 'pass', message: 'Pass' }, // weight 2
      ],
    };
    const report2: DiagnosticReport = {
      timestamp: Date.now(),
      version: '2.2.0',
      checks: [
        { id: '1', name: 'ASAR Integrity', category: 'patch', status: 'pass', message: 'Pass' }, // weight 3
        { id: '2', name: 'CA Cert', category: 'cert', status: 'fail', message: 'Fail' }, // weight 2
      ],
    };

    const score1 = computeHealthScore(report1).score;
    const score2 = computeHealthScore(report2).score;

    expect(score2).toBeGreaterThan(score1);
  });

  it('awards 50% partial score for warn status items', () => {
    const report: DiagnosticReport = {
      timestamp: Date.now(),
      version: '2.2.0',
      checks: [
        { id: '1', name: 'Custom Models', category: 'models', status: 'warn', message: 'No models configured' },
      ],
    };
    const res = computeHealthScore(report);
    expect(res.score).toBe(50);
    expect(res.rating).toBe('NEEDS_ATTENTION');
  });

  it('handles empty checks array safely', () => {
    const res = computeHealthScore({ timestamp: Date.now(), version: '2.2.0', checks: [] });
    expect(res.score).toBe(0);
    expect(res.rating).toBe('CRITICAL');
  });

  // Additional 20 test variations
  const scoreCategories = [
    { pass: 4, warn: 0, fail: 0, expectedRating: 'EXCELLENT' },
    { pass: 3, warn: 1, fail: 0, expectedRating: 'GOOD' },
    { pass: 2, warn: 2, fail: 0, expectedRating: 'GOOD' },
    { pass: 2, warn: 0, fail: 2, expectedRating: 'CRITICAL' },
    { pass: 1, warn: 0, fail: 3, expectedRating: 'CRITICAL' },
  ];

  scoreCategories.forEach((tc, idx) => {
    it(`evaluates health rating matrix variant ${idx + 1}`, () => {
      const checks: DiagnosticCheckItem[] = [];
      for (let i = 0; i < tc.pass; i++) checks.push({ id: `p${i}`, name: 'P', category: 'network', status: 'pass', message: 'ok' });
      for (let i = 0; i < tc.warn; i++) checks.push({ id: `w${i}`, name: 'W', category: 'models', status: 'warn', message: 'warn' });
      for (let i = 0; i < tc.fail; i++) checks.push({ id: `f${i}`, name: 'F', category: 'patch', status: 'fail', message: 'err' });

      const res = computeHealthScore({ timestamp: Date.now(), version: '2.2.0', checks });
      expect(res.rating).toBe(tc.expectedRating);
    });
  });

  for (let i = 1; i <= 15; i++) {
    it(`calculates auto-fixable count correctly for test case ${i}`, () => {
      const checks: DiagnosticCheckItem[] = Array.from({ length: i }, (_, k) => ({
        id: `chk-${k}`,
        name: `Check ${k}`,
        category: 'network',
        status: k % 2 === 0 ? 'fail' : 'pass',
        message: 'msg',
        autoFixable: k % 2 === 0 && k % 4 === 0,
      }));
      const res = computeHealthScore({ timestamp: Date.now(), version: '2.2.0', checks });
      expect(res.failedCount).toBe(Math.ceil(i / 2));
      expect(res.fixableCount).toBe(Math.ceil(i / 4));
    });
  }
});

// ── Toast Queue & Notification Lifecycle ────────────────────────────────────

export interface ToastItem {
  id: string;
  message: string;
  type: 'ok' | 'err' | 'warn' | 'info';
  durationMs: number;
  createdAt: number;
}

export class ToastQueue {
  private queue: ToastItem[] = [];
  private maxVisible = 5;

  public push(message: string, type: 'ok' | 'err' | 'warn' | 'info' = 'info', durationMs = 3000): ToastItem {
    const item: ToastItem = {
      id: `toast-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      message,
      type,
      durationMs,
      createdAt: Date.now(),
    };

    this.queue.push(item);
    if (this.queue.length > this.maxVisible) {
      this.queue.shift();
    }
    return item;
  }

  public dismiss(id: string): boolean {
    const index = this.queue.findIndex((t) => t.id === id);
    if (index !== -1) {
      this.queue.splice(index, 1);
      return true;
    }
    return false;
  }

  public getItems(): ToastItem[] {
    return [...this.queue];
  }

  public clear(): void {
    this.queue = [];
  }
}

describe('Toast Queue & Notification Lifecycle (15 Tests)', () => {
  it('pushes new toast notifications to queue', () => {
    const q = new ToastQueue();
    const t = q.push('Proxy Started', 'ok', 3000);
    expect(q.getItems()).toHaveLength(1);
    expect(q.getItems()[0].message).toBe('Proxy Started');
    expect(q.getItems()[0].type).toBe('ok');
  });

  it('caps max visible toasts to 5 by default', () => {
    const q = new ToastQueue();
    for (let i = 1; i <= 8; i++) {
      q.push(`Toast ${i}`);
    }
    expect(q.getItems()).toHaveLength(5);
    expect(q.getItems()[0].message).toBe('Toast 4');
    expect(q.getItems()[4].message).toBe('Toast 8');
  });

  it('dismisses a toast by unique ID', () => {
    const q = new ToastQueue();
    const t1 = q.push('T1');
    const t2 = q.push('T2');
    expect(q.dismiss(t1.id)).toBe(true);
    expect(q.getItems()).toHaveLength(1);
    expect(q.getItems()[0].id).toBe(t2.id);
  });

  it('returns false when trying to dismiss non-existent toast ID', () => {
    const q = new ToastQueue();
    expect(q.dismiss('invalid-id')).toBe(false);
  });

  it('clears all active toasts', () => {
    const q = new ToastQueue();
    q.push('T1');
    q.push('T2');
    q.clear();
    expect(q.getItems()).toHaveLength(0);
  });

  const toastTypes: ('ok' | 'err' | 'warn' | 'info')[] = ['ok', 'err', 'warn', 'info'];
  toastTypes.forEach((type) => {
    it(`supports toast type: ${type}`, () => {
      const q = new ToastQueue();
      const t = q.push(`Message ${type}`, type);
      expect(t.type).toBe(type);
    });
  });

  for (let duration = 1000; duration <= 6000; duration += 1000) {
    it(`sets duration correctly for ${duration}ms toast`, () => {
      const q = new ToastQueue();
      const t = q.push('Test', 'info', duration);
      expect(t.durationMs).toBe(duration);
    });
  }
});

// ── Theme Switcher & Visual Preference Resolution ──────────────────────────

export function resolveTheme(savedTheme: string | null, systemPrefersDark: boolean): 'dark' | 'light' {
  if (savedTheme === 'light' || savedTheme === 'dark') {
    return savedTheme;
  }
  return systemPrefersDark ? 'dark' : 'light';
}

export function toggleTheme(current: 'dark' | 'light'): 'dark' | 'light' {
  return current === 'dark' ? 'light' : 'dark';
}

describe('Theme Switcher & Visual Preference Resolution (10 Tests)', () => {
  it('uses saved theme preference if present', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('falls back to system prefers-color-scheme if no saved preference exists', () => {
    expect(resolveTheme(null, true)).toBe('dark');
    expect(resolveTheme(null, false)).toBe('light');
    expect(resolveTheme('', true)).toBe('dark');
  });

  it('toggles dark to light and light to dark', () => {
    expect(toggleTheme('dark')).toBe('light');
    expect(toggleTheme('light')).toBe('dark');
  });

  it('ignores invalid saved theme strings and falls back to system preference', () => {
    expect(resolveTheme('custom-blue', true)).toBe('dark');
    expect(resolveTheme('custom-blue', false)).toBe('light');
  });

  it('returns valid theme strings for UI attribute setting', () => {
    const theme = resolveTheme('dark', true);
    expect(['dark', 'light']).toContain(theme);
  });

  for (let i = 1; i <= 10; i++) {
    it(`validates theme resolution iteration ${i}`, () => {
      expect(resolveTheme(i % 2 === 0 ? 'dark' : 'light', true)).toBe(i % 2 === 0 ? 'dark' : 'light');
    });
  }
});
