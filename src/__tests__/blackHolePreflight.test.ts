import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import EventEmitter from 'events';
import https from 'https';

vi.mock('electron', () => ({
  app: { getPath: () => '/mock/home' },
}));

vi.mock('electron-log/main', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../services/googleAuth', async () => {
  const actual = await vi.importActual<any>('../services/googleAuth');
  return {
    ...actual,
    getValidGoogleAccessToken: vi.fn().mockImplementation(async (acc) => {
      if (acc.accountEmail?.includes('revoked')) return null;
      return 'mock-access-token-123';
    }),
  };
});

vi.mock('../proxy/dnsResolver', async () => {
  const actual = await vi.importActual<any>('../proxy/dnsResolver');
  return {
    ...actual,
    resolveGoogleIp: vi.fn().mockResolvedValue('142.250.80.46'),
  };
});

import {
  probeGoogleAccountPreflight,
  probeAllGoogleAccountsPreflight,
  unmarkAccountUnlicensed,
  markAccountUnlicensed,
  isAccountUnlicensed,
  isAccountInCooldown,
  setAccountCooldown,
  clearAccountCooldown,
  getAccountCooldownRemaining,
  restoreActiveAccountCooldowns,
  _resetUnlicensedAccounts,
  _resetAllAccountCooldowns,
  startPreflightHealthCheckInterval,
  stopPreflightHealthCheckInterval,
  executeGoogleCloudCodeWithPool,
  incrementAccountInFlight,
  decrementAccountInFlight,
  recordAccountRequest,
} from '../proxy.ts';
import {
  GOOGLE_POOL_HEADER_TIMEOUT_FLASH_MS,
  PREFLIGHT_HEALTH_CHECK_TIMEOUT_MS,
} from '../constants';
import type { CustomModel } from '../types';

describe('Black-Hole Account Elimination & Pre-Flight Health Checks', () => {
  beforeEach(() => {
    _resetUnlicensedAccounts();
    _resetAllAccountCooldowns();
  });

  afterEach(() => {
    stopPreflightHealthCheckInterval();
  });

  it('verifies GOOGLE_POOL_HEADER_TIMEOUT_FLASH_MS is configured to 10s', () => {
    const expected = process.env.AG_GOOGLE_POOL_HEADER_TIMEOUT_FLASH_MS
      ? parseInt(process.env.AG_GOOGLE_POOL_HEADER_TIMEOUT_FLASH_MS, 10)
      : 10_000;
    expect(GOOGLE_POOL_HEADER_TIMEOUT_FLASH_MS).toBe(expected);
  });

  it('verifies PREFLIGHT_HEALTH_CHECK_TIMEOUT_MS is configured to 3.5s', () => {
    const expected = process.env.AG_PREFLIGHT_HEALTH_CHECK_TIMEOUT_MS
      ? parseInt(process.env.AG_PREFLIGHT_HEALTH_CHECK_TIMEOUT_MS, 10)
      : 3_500;
    expect(PREFLIGHT_HEALTH_CHECK_TIMEOUT_MS).toBe(expected);
  });

  it('unmarks an unlicensed account across all email variants when restored', () => {
    const acc: CustomModel = {
      name: 'test-model',
      provider: 'google',
      apiUrl: 'https://daily-cloudcode-pa.googleapis.com',
      accountEmail: 'repaired@gmail.com',
      refreshToken: 'tok123',
    } as any;

    markAccountUnlicensed(acc);
    expect(isAccountUnlicensed(acc)).toBe(true);

    unmarkAccountUnlicensed(acc);
    expect(isAccountUnlicensed(acc)).toBe(false);

    // Can also unmark by string
    markAccountUnlicensed(acc);
    expect(isAccountUnlicensed(acc)).toBe(true);
    unmarkAccountUnlicensed('repaired@gmail.com');
    expect(isAccountUnlicensed(acc)).toBe(false);
  });

  it('quarantines Black-Hole accounts when ping probe times out', async () => {
    const blackHoleAcc: CustomModel = {
      name: 'gemini-flash',
      provider: 'google',
      apiUrl: 'https://daily-cloudcode-pa.googleapis.com',
      accountEmail: 'blackhole@gmail.com',
      refreshToken: 'rt-blackhole',
    } as any;

    // Simulate https.request timing out after 3.5s
    vi.spyOn(https, 'request').mockImplementation((_url: any, _opts: any, _cb: any): any => {
      const emitter = new EventEmitter() as any;
      emitter.write = vi.fn();
      emitter.end = vi.fn(() => {
        setTimeout(() => {
          emitter.emit('timeout');
        }, 10);
      });
      emitter.destroy = vi.fn();
      return emitter;
    });

    const result = await probeGoogleAccountPreflight(blackHoleAcc, 50);
    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(504);
    expect(result.reason).toContain('TIMEOUT');

    // Verified: Account is placed in transient cooldown, but NOT falsely marked unlicensed
    expect(isAccountUnlicensed(blackHoleAcc)).toBe(false);
    expect(isAccountInCooldown(blackHoleAcc, 'gemini')).toBe(true);
  });

  it('restores and marks healthy accounts active on HTTP 200 OK', async () => {
    const healthyAcc: CustomModel = {
      name: 'gemini-flash',
      provider: 'google',
      apiUrl: 'https://daily-cloudcode-pa.googleapis.com',
      accountEmail: 'healthy@gmail.com',
      refreshToken: 'rt-healthy',
    } as any;

    // Pre-mark as quarantined to verify recovery
    markAccountUnlicensed(healthyAcc);
    setAccountCooldown(healthyAcc, 60_000, 'gemini');
    expect(isAccountUnlicensed(healthyAcc)).toBe(true);

    vi.spyOn(https, 'request').mockImplementation((_url: any, _opts: any, cb: any): any => {
      const emitter = new EventEmitter() as any;
      emitter.write = vi.fn();
      emitter.end = vi.fn(() => {
        const res = new EventEmitter() as any;
        res.statusCode = 200;
        cb(res);
        res.emit('data', Buffer.from(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'pong' }] } }] })));
        res.emit('end');
      });
      return emitter;
    });

    const result = await probeGoogleAccountPreflight(healthyAcc, 100);
    expect(result.ok).toBe(true);
    expect(result.statusCode).toBe(200);

    // Verified: Quarantine and cooldown are completely lifted
    expect(isAccountUnlicensed(healthyAcc)).toBe(false);
    expect(isAccountInCooldown(healthyAcc, 'gemini')).toBe(false);
  });

  it('quarantines accounts receiving security challenge (HTTP 403 / captcha)', async () => {
    const challengedAcc: CustomModel = {
      name: 'gemini-flash',
      provider: 'google',
      apiUrl: 'https://daily-cloudcode-pa.googleapis.com',
      accountEmail: 'challenge@gmail.com',
      refreshToken: 'rt-challenge',
    } as any;

    vi.spyOn(https, 'request').mockImplementation((_url: any, _opts: any, cb: any): any => {
      const emitter = new EventEmitter() as any;
      emitter.write = vi.fn();
      emitter.end = vi.fn(() => {
        const res = new EventEmitter() as any;
        res.statusCode = 403;
        cb(res);
        res.emit('data', Buffer.from(JSON.stringify({ error: { message: 'Verify your account to continue' } })));
        res.emit('end');
      });
      return emitter;
    });

    const result = await probeGoogleAccountPreflight(challengedAcc, 100);
    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(403);
    expect(result.reason).toContain('Verify your account');

    expect(isAccountUnlicensed(challengedAcc)).toBe(true);
    expect(isAccountInCooldown(challengedAcc, 'gemini')).toBe(true);
  });

  it('runs probeAllGoogleAccountsPreflight across account list and aggregates summary', async () => {
    const models: CustomModel[] = [
      { name: 'm1', provider: 'google', accountEmail: 'acc1@gmail.com', refreshToken: 't1' } as any,
      { name: 'm2', provider: 'google', accountEmail: 'acc2@gmail.com', refreshToken: 't2' } as any,
    ];

    vi.spyOn(https, 'request').mockImplementation((_url: any, _opts: any, cb: any): any => {
      const emitter = new EventEmitter() as any;
      emitter.write = vi.fn();
      emitter.end = vi.fn(() => {
        const res = new EventEmitter() as any;
        res.statusCode = 200;
        cb(res);
        res.emit('data', Buffer.from('{}'));
        res.emit('end');
      });
      return emitter;
    });

    const summary = await probeAllGoogleAccountsPreflight(models);
    expect(summary.results.length).toBe(2);
    expect(summary.healthy).toBe(2);
    expect(summary.quarantined).toBe(0);
  });

  it('continues rotation to next candidate when upstream disconnects (499) while client is alive', async () => {
    let callCount = 0;
    vi.spyOn(https, 'request').mockImplementation((_url: any, _opts: any, cb: any): any => {
      callCount++;
      const emitter = new EventEmitter() as any;
      emitter.write = vi.fn();
      emitter.setTimeout = vi.fn();
      emitter.destroy = vi.fn();
      emitter.end = vi.fn(() => {
        if (callCount === 1) {
          // Account 1: upstream socket hang up
          emitter.emit('error', new Error('socket hang up'));
        } else {
          // Account 2: succeeds with 200 OK
          const res = new EventEmitter() as any;
          res.statusCode = 200;
          cb(res);
          res.emit('data', Buffer.from(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] })));
          res.emit('end');
        }
      });
      return emitter;
    });

    const acc1: CustomModel = {
      name: 'acc1',
      provider: 'google',
      apiUrl: 'https://daily-cloudcode-pa.googleapis.com',
      refreshToken: 'tok1',
      accountEmail: 'acc1@gmail.com',
      externalModelName: 'gemini-3.8-flash-tiered',
    } as any;
    const acc2: CustomModel = {
      name: 'acc2',
      provider: 'google',
      apiUrl: 'https://daily-cloudcode-pa.googleapis.com',
      refreshToken: 'tok2',
      accountEmail: 'acc2@gmail.com',
      externalModelName: 'gemini-3.8-flash-tiered',
    } as any;

    const fakeReq = { url: '/v1internal:generateContent', method: 'POST', headers: {} } as any;
    const fakeSocket = { destroyed: false, writable: true };
    const fakeRes = {
      writableEnded: false,
      destroyed: false,
      headersSent: false,
      socket: fakeSocket,
      writeHead: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
      once: vi.fn(),
      off: vi.fn(),
    } as any;

    const result = await executeGoogleCloudCodeWithPool(
      fakeReq,
      fakeRes,
      { model: 'gemini-3.8-flash-tiered', request: { contents: [{ parts: [{ text: 'ping' }] }] } },
      [acc1, acc2],
      false,
      'conv-1',
      'sess-1',
    );

    expect(callCount).toBe(2);
    expect(result).toBe(true);
  });

  it('skips probing accounts that are in-flight or recently active to prevent false-positive quarantines', async () => {
    let requestCount = 0;
    vi.spyOn(https, 'request').mockImplementation((_url: any, _opts: any, cb: any): any => {
      requestCount++;
      const emitter = new EventEmitter() as any;
      emitter.write = vi.fn();
      emitter.end = vi.fn(() => {
        const res = new EventEmitter() as any;
        res.statusCode = 200;
        cb(res);
        res.emit('data', Buffer.from('{}'));
        res.emit('end');
      });
      return emitter;
    });

    const busyAcc: CustomModel = {
      name: 'busy',
      provider: 'google',
      accountEmail: 'busy@gmail.com',
      refreshToken: 'tok-busy',
    } as any;
    const recentAcc: CustomModel = {
      name: 'recent',
      provider: 'google',
      accountEmail: 'recent@gmail.com',
      refreshToken: 'tok-recent',
    } as any;
    const idleAcc: CustomModel = {
      name: 'idle',
      provider: 'google',
      accountEmail: 'idle@gmail.com',
      refreshToken: 'tok-idle',
    } as any;

    // Simulate busyAcc has active request in flight
    incrementAccountInFlight(busyAcc);
    // Simulate recentAcc was used 5 seconds ago
    recordAccountRequest(recentAcc);

    const summary = await probeAllGoogleAccountsPreflight([busyAcc, recentAcc, idleAcc]);

    decrementAccountInFlight(busyAcc);

    // Only idleAcc should have been probed! busyAcc and recentAcc must be skipped.
    expect(requestCount).toBe(1);
    expect(summary.results.length).toBe(1);
    expect(summary.results[0].email).toBe('idle@gmail.com');
  });

  it('auto-heals and unmarks previously quarantined unlicensed accounts on HTTP 200 OK', async () => {
    vi.spyOn(https, 'request').mockImplementation((_url: any, _opts: any, cb: any): any => {
      // Simulate that while the request is in flight, background preflight falsely marked it unlicensed
      markAccountUnlicensed(acc);
      expect(isAccountUnlicensed(acc)).toBe(true);

      const emitter = new EventEmitter() as any;
      emitter.setTimeout = vi.fn();
      emitter.write = vi.fn();
      emitter.end = vi.fn(() => {
        const res = new EventEmitter() as any;
        res.statusCode = 200;
        res.headers = {};
        cb(res);
        res.emit('data', Buffer.from(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'healthy response' }] } }] })));
        res.emit('end');
      });
      return emitter;
    });

    const acc: CustomModel = {
      name: 'acc-quarantined',
      provider: 'google',
      apiUrl: 'https://daily-cloudcode-pa.googleapis.com',
      refreshToken: 'tok-q',
      accountEmail: 'quarantined@gmail.com',
      externalModelName: 'gemini-3.8-flash-tiered',
    } as any;

    const fakeReq = { url: '/v1internal:generateContent', method: 'POST', headers: {} } as any;
    const fakeSocket = { destroyed: false, writable: true };
    const fakeRes = {
      writableEnded: false,
      destroyed: false,
      headersSent: false,
      socket: fakeSocket,
      writeHead: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
      once: vi.fn(),
      off: vi.fn(),
    } as any;

    const result = await executeGoogleCloudCodeWithPool(
      fakeReq,
      fakeRes,
      { model: 'gemini-3.8-flash-tiered', request: { contents: [{ parts: [{ text: 'hello' }] }] } },
      [acc],
      false,
      'conv-1',
      'sess-1',
    );

    expect(result).toBe(true);
    // Verified: HTTP 200 OK unmarks the unlicensed quarantine
    expect(isAccountUnlicensed(acc)).toBe(false);
  });

  it('classifies quota-exhausted 429 in preflight and applies multi-hour cooldown instead of 30s', async () => {
    const acc: CustomModel = {
      name: 'gemini-flash',
      provider: 'google',
      apiUrl: 'https://daily-cloudcode-pa.googleapis.com',
      accountEmail: 'quota-exhausted@gmail.com',
      refreshToken: 'rt-quota',
    } as any;

    vi.spyOn(https, 'request').mockImplementation((_url: any, _opts: any, cb: any): any => {
      const emitter = new EventEmitter() as any;
      emitter.write = vi.fn();
      emitter.end = vi.fn(() => {
        const res = new EventEmitter() as any;
        res.statusCode = 429;
        res.headers = {};
        cb(res);
        res.emit('data', Buffer.from(JSON.stringify({
          error: {
            code: 429,
            message: 'Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 140h50m33s.',
            status: 'RESOURCE_EXHAUSTED',
          },
        })));
        res.emit('end');
      });
      return emitter;
    });

    const result = await probeGoogleAccountPreflight(acc, 100);
    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(429);
    expect(result.reason).toContain('quota_exhausted');

    // Must be in a multi-hour cooldown, NOT a 30s burst pause
    expect(isAccountInCooldown(acc, 'gemini')).toBe(true);

    // Verify cooldown is >= 5h (quota exhaustion floor), not 30s
    const remaining = getAccountCooldownRemaining(acc, 'gemini');
    expect(remaining).toBeGreaterThan(4 * 3600 * 1000); // at least 4h remaining
  });

  it('restores weekly-depleted cooldown at boot even when 5h shows 100%', () => {
    _resetAllAccountCooldowns();

    const now = Date.now();
    const cooldownUntil = now + 5 * 3600_000; // 5h from now

    // Simulate persisted quotas: 5h=100% but weekly=0% (weekly exhaustion)
    const persistedQuotas = new Map();
    persistedQuotas.set('google:weekly-depleted@gmail.com', {
      geminiFiveHourPct: 100,
      geminiWeeklyPct: 0,
      updatedAt: now - 60_000, // 1 min old = fresh
    });

    restoreActiveAccountCooldowns(
      { 'google:weekly-depleted@gmail.com:gemini': cooldownUntil },
      persistedQuotas,
    );

    // The cooldown should NOT have been skipped because weekly is 0%
    const fakeAcc = { accountEmail: 'weekly-depleted@gmail.com', provider: 'google', apiUrl: 'https://daily-cloudcode-pa.googleapis.com' } as any;
    expect(isAccountInCooldown(fakeAcc, 'gemini')).toBe(true);

    _resetAllAccountCooldowns();
  });
});
