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

import {
  probeGoogleAccountPreflight,
  probeAllGoogleAccountsPreflight,
  unmarkAccountUnlicensed,
  markAccountUnlicensed,
  isAccountUnlicensed,
  isAccountInCooldown,
  setAccountCooldown,
  clearAccountCooldown,
  _resetUnlicensedAccounts,
  _resetAllAccountCooldowns,
  startPreflightHealthCheckInterval,
  stopPreflightHealthCheckInterval,
  executeGoogleCloudCodeWithPool,
} from '../proxy';
import {
  GOOGLE_POOL_HEADER_TIMEOUT_FLASH_MS,
  PREFLIGHT_HEALTH_CHECK_TIMEOUT_MS,
} from '../constants';
import type { CustomModel } from '../types';

describe('Black-Hole Account Elimination & Pre-Flight Health Checks', () => {
  beforeEach(() => {
    _resetUnlicensedAccounts();
    _resetAllAccountCooldowns();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    stopPreflightHealthCheckInterval();
  });

  it('verifies GOOGLE_POOL_HEADER_TIMEOUT_FLASH_MS is configured to 4.5s', () => {
    const expected = process.env.AG_GOOGLE_POOL_HEADER_TIMEOUT_FLASH_MS
      ? parseInt(process.env.AG_GOOGLE_POOL_HEADER_TIMEOUT_FLASH_MS, 10)
      : 4_500;
    expect(GOOGLE_POOL_HEADER_TIMEOUT_FLASH_MS).toBe(expected);
  });

  it('verifies PREFLIGHT_HEALTH_CHECK_TIMEOUT_MS is configured to 3.5s', () => {
    expect(PREFLIGHT_HEALTH_CHECK_TIMEOUT_MS).toBe(3_500);
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

    // Verified: Account is immediately placed in quarantine and cooldown
    expect(isAccountUnlicensed(blackHoleAcc)).toBe(true);
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
});
