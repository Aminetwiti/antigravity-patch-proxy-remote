/**
 * Tests for the persistedState module.
 *
 * Coverage:
 *   - validate() round-trips good / rejects bad
 *   - toFile/fromFile encode/decode with cooldown filtering
 *   - flush() atomic write + throttling
 *   - loadOrInit() quarantines corrupt / accepts valid
 *   - apply helpers wire to retryBudget + breaker
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  validate,
  fresh,
  toFile,
  fromFile,
  flush,
  loadOrInit,
  applyBudgetPatch,
  applyBreakerPatch,
  gather,
  readState,
  STATE_FILE_VERSION,
  MIN_FLUSH_INTERVAL_MS,
  STATE_FILE_NAME,
  _resetFlushThrottle,
} from '../proxy/persistedState';
import { _resetAllBreakers } from '../proxy/circuitBreaker';
import { _resetRetryBudget } from '../proxy/retryBudget';

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'p6-pstate-'));
}

describe('persistedState / validate', () => {
  it('accepts a fresh default', () => {
    expect(validate(fresh())).toBe(true);
  });

  it('rejects null / undefined', () => {
    expect(validate(null)).toBe(false);
    expect(validate(undefined)).toBe(false);
  });

  it('rejects the wrong version', () => {
    expect(
      validate({ version: 999, savedAt: 0, retryBudget: {}, breakers: {} }),
    ).toBe(false);
  });

  it('rejects non-numeric savedAt', () => {
    expect(
      validate({ version: STATE_FILE_VERSION, savedAt: 'nope', retryBudget: {}, breakers: {} }),
    ).toBe(false);
  });

  it('rejects missing budget map', () => {
    expect(
      validate({ version: STATE_FILE_VERSION, savedAt: 0, breakers: {} }),
    ).toBe(false);
  });
});

describe('persistedState / toFile fromFile roundtrip', () => {
  it('rebuilds the budget patches', () => {
    const breakerSnap = {
      open: [
        { key: 'a', errorType: 'timeout' as const, failures: 1, trippedAt: Date.now() },
      ],
    };
    const raw = { a: { successes: 4, failures: 1, lastUpdate: Date.now() } };
    const file = toFile({
      retryBudgetSnap: { perModel: [] },
      breakerSnap,
      rawBudgetCounts: raw,
    });
    const now = Date.now();
    const { retryBudgetPatch, breakerPatch } = fromFile(file, now, 60_000);
    expect(retryBudgetPatch.get('a')).toEqual(raw.a);
    expect(breakerPatch.get('a')?.errorType).toBe('timeout');
  });

  it('drops breakers that have aged past the cooldown', () => {
    const now = Date.now();
    const breakerSnap = {
      open: [
        { key: 'live', errorType: 'server' as const, failures: 1, trippedAt: now - 1000 },
        { key: 'dead', errorType: 'server' as const, failures: 1, trippedAt: now - 120_000 },
      ],
    };
    const file = toFile({ retryBudgetSnap: { perModel: [] }, breakerSnap });
    const { breakerPatch } = fromFile(file, now, 60_000);
    expect(breakerPatch.has('live')).toBe(true);
    expect(breakerPatch.has('dead')).toBe(false);
  });
});

describe('persistedState / applyBudgetPatch', () => {
  beforeEach(() => _resetRetryBudget());

  it('merges samples into the singleton', () => {
    const patch = new Map([
      ['k', { successes: 8, failures: 2, lastUpdate: Date.now() }],
    ]);
    applyBudgetPatch(patch);
    const file = gather();
    expect(file.retryBudget.k).toEqual(patch.get('k'));
  });

  it('no-ops on empty map', () => {
    expect(() => applyBudgetPatch(new Map())).not.toThrow();
  });
});

describe('persistedState / applyBreakerPatch', () => {
  beforeEach(() => _resetAllBreakers());

  it('restores an open breaker', () => {
    const patch = new Map([
      [
        'p::u::m',
        { errorType: 'timeout' as const, failures: 1, trippedAt: Date.now() },
      ],
    ]);
    applyBreakerPatch(patch);
    const file = gather();
    expect(file.breakers['p::u::m']).toBeTruthy();
    expect(file.breakers['p::u::m']?.errorType).toBe('timeout');
  });
});

describe('persistedState / flush', () => {
  let dir: string;
  beforeEach(() => {
    dir = tmpDir();
    _resetFlushThrottle(0);
  });
  afterEach(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it('writes the file atomically and creates it on disk', () => {
    const path = join(dir, STATE_FILE_NAME);
    const file = fresh();
    file.savedAt = 42;
    expect(flush(path, file)).toBe(true);
    expect(existsSync(path)).toBe(true);
    const back = JSON.parse(readFileSync(path, 'utf-8'));
    expect(back.savedAt).toBe(42);
  });

  it('never leaves a .tmp behind on success', () => {
    const path = join(dir, STATE_FILE_NAME);
    flush(path, fresh());
    expect(existsSync(`${path}.tmp`)).toBe(false);
  });

  it('throttles consecutive flushes within MIN_FLUSH_INTERVAL_MS', () => {
    const path = join(dir, STATE_FILE_NAME);
    expect(flush(path, fresh())).toBe(true);
    expect(flush(path, fresh())).toBe(false); // throttled
  });
});

describe('persistedState / loadOrInit', () => {
  let dir: string;
  beforeEach(() => {
    dir = tmpDir();
  });
  afterEach(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it('returns fresh when the file is missing', () => {
    const f = loadOrInit(join(dir, STATE_FILE_NAME));
    expect(f.version).toBe(STATE_FILE_VERSION);
    expect(Object.keys(f.retryBudget)).toHaveLength(0);
  });

  it('returns the parsed file when present and valid', () => {
    const path = join(dir, STATE_FILE_NAME);
    const file = fresh();
    file.savedAt = 12345;
    writeFileSync(path, JSON.stringify(file));
    const back = loadOrInit(path);
    expect(back.savedAt).toBe(12345);
  });

  it('quarantines a corrupt JSON file', () => {
    const path = join(dir, STATE_FILE_NAME);
    writeFileSync(path, '{not-json');
    const back = loadOrInit(path);
    expect(back).toEqual(fresh());
    const fs = require('fs');
    const entries = fs.readdirSync(dir) as string[];
    expect(entries.some((e) => e.startsWith(STATE_FILE_NAME + '.bak.'))).toBe(true);
  });

  it('quarantines an unreadable but JSON-shaped file', () => {
    const path = join(dir, STATE_FILE_NAME);
    writeFileSync(path, JSON.stringify({ version: 999, savedAt: 'nope' }));
    const back = loadOrInit(path);
    expect(back).toEqual(fresh());
  });
});

describe('persistedState / readState', () => {
  beforeEach(() => _resetFlushThrottle(0));

  it('honors the throttle by default', () => {
    const a = readState({
      retryBudgetRaw: { a: { successes: 1, failures: 0, lastUpdate: 0 } },
    });
    expect(a.wrote).toBe(true);
    const b = readState({
      retryBudgetRaw: { a: { successes: 1, failures: 0, lastUpdate: 0 } },
    });
    expect(b.wrote).toBe(false);
  });

  it('force=true bypasses the throttle', () => {
    readState({ retryBudgetRaw: { a: { successes: 1, failures: 0, lastUpdate: 0 } } });
    const forced = readState({
      force: true,
      retryBudgetRaw: { a: { successes: 1, failures: 0, lastUpdate: 0 } },
    });
    expect(forced.wrote).toBe(true);
  });
});

describe('persistedState / throttle constant', () => {
  it('has a sane default', () => {
    expect(MIN_FLUSH_INTERVAL_MS).toBeGreaterThanOrEqual(1000);
    expect(MIN_FLUSH_INTERVAL_MS).toBeLessThanOrEqual(60_000);
  });
});
