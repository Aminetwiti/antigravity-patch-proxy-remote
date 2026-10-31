import { describe, it, expect, vi, beforeEach } from 'vitest';
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
    getValidGoogleAccessToken: vi.fn().mockResolvedValue('mock-token-stream'),
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
  executeGoogleCloudCodeWithPool,
  isAccountInCooldown,
  getAccountInFlight,
  _resetAllAccountCooldowns,
} from '../proxy.ts';
import type { CustomModel } from '../constants';

describe('Stream in-flight retention and client abort resilience', () => {
  beforeEach(() => {
    _resetAllAccountCooldowns();
    vi.restoreAllMocks();
  });

  it('keeps candidate inFlight=1 while SSE stream is active and decrements on res finish', async () => {
    const acc: CustomModel = {
      name: 'acc-streaming',
      provider: 'google',
      apiUrl: 'https://daily-cloudcode-pa.googleapis.com',
      refreshToken: 'tok-stream-1',
      accountEmail: 'streaming@gmail.com',
      externalModelName: 'gemini-3.8-flash-tiered',
    } as any;

    let serverResponseCallback: any;
    vi.spyOn(https, 'request').mockImplementation((_url: any, _opts: any, cb: any): any => {
      serverResponseCallback = cb;
      const emitter = new EventEmitter() as any;
      emitter.write = vi.fn();
      emitter.setTimeout = vi.fn();
      emitter.destroy = vi.fn();
      emitter.end = vi.fn(() => {
        const res = new EventEmitter() as any;
        res.statusCode = 200;
        res.headers = { 'content-type': 'text/event-stream' };
        serverResponseCallback(res);
      });
      return emitter;
    });

    const fakeReq = { url: '/v1internal:streamGenerateContent?alt=sse', method: 'POST', headers: {} } as any;
    const fakeSocket = { destroyed: false, writable: true, setNoDelay: vi.fn() };
    const fakeRes = new EventEmitter() as any;
    fakeRes.writableEnded = false;
    fakeRes.destroyed = false;
    fakeRes.headersSent = true;
    fakeRes.socket = fakeSocket;
    fakeRes.writeHead = vi.fn();
    fakeRes.write = vi.fn();
    fakeRes.end = vi.fn();

    const dispatchPromise = executeGoogleCloudCodeWithPool(
      fakeReq,
      fakeRes,
      {
        model: 'gemini-3.8-flash-tiered',
        request: { contents: [{ parts: [{ text: 'stream prompt' }] }] },
      },
      [acc],
      false,
      'conv-stream',
      'sess-stream',
    );

    const result = await dispatchPromise;
    expect(result).toBe(true);

    // In-flight MUST still be 1 because fakeRes has not finished streaming yet!
    expect(getAccountInFlight(acc)).toBe(1);

    // Now simulate stream completion
    fakeRes.writableEnded = true;
    fakeRes.emit('finish');

    // After finish, in-flight must be cleanly decremented to 0
    expect(getAccountInFlight(acc)).toBe(0);

    // Emitting close subsequently should not double-decrement
    fakeRes.emit('close');
    expect(getAccountInFlight(acc)).toBe(0);
  });

  it('does not place candidate in 120s cooldown when client disconnects (499) within allowed header timeout window', async () => {
    vi.spyOn(https, 'request').mockImplementation((_url: any, _opts: any, _cb: any): any => {
      const emitter = new EventEmitter() as any;
      emitter.write = vi.fn();
      emitter.setTimeout = vi.fn();
      emitter.destroy = vi.fn();
      emitter.end = vi.fn(() => {
        // Upstream socket hangs up because client aborted downstream
        emitter.emit('error', new Error('socket hang up'));
      });
      return emitter;
    });

    const acc: CustomModel = {
      name: 'acc-flash-cancel',
      provider: 'google',
      apiUrl: 'https://daily-cloudcode-pa.googleapis.com',
      refreshToken: 'tok-cancel',
      accountEmail: 'client-cancel@gmail.com',
      externalModelName: 'gemini-3.8-flash-tiered',
    } as any;

    const fakeReq = { url: '/v1internal:streamGenerateContent?alt=sse', method: 'POST', headers: {} } as any;
    const fakeSocket = { destroyed: true, writable: false };
    const fakeRes = new EventEmitter() as any;
    fakeRes.writableEnded = false;
    fakeRes.destroyed = true; // Client canceled
    fakeRes.headersSent = false;
    fakeRes.socket = fakeSocket;
    fakeRes.writeHead = vi.fn();
    fakeRes.write = vi.fn();
    fakeRes.end = vi.fn();

    const result = await executeGoogleCloudCodeWithPool(
      fakeReq,
      fakeRes,
      {
        model: 'gemini-3.8-flash-tiered',
        request: { contents: [{ parts: [{ text: 'quick prompt' }] }] },
      },
      [acc],
      false,
      'conv-cancel',
      'sess-cancel',
    );

    expect(result).toBe(false);
    // Crucial assertion: The candidate MUST NOT be in cooldown!
    expect(isAccountInCooldown(acc, 'gemini')).toBe(false);
    expect(getAccountInFlight(acc)).toBe(0);
  });

  it('does not place candidate in 120s cooldown when client aborts at 9s (before header timeout)', async () => {
    vi.spyOn(https, 'request').mockImplementation((_url: any, _opts: any, _cb: any): any => {
      const emitter = new EventEmitter() as any;
      emitter.write = vi.fn();
      emitter.setTimeout = vi.fn();
      emitter.destroy = vi.fn();
      emitter.end = vi.fn(() => {
        // Upstream socket hangs up after delay
        emitter.emit('error', new Error('socket hang up'));
      });
      return emitter;
    });

    const acc: CustomModel = {
      name: 'acc-flash-cancel-8s',
      provider: 'google',
      apiUrl: 'https://daily-cloudcode-pa.googleapis.com',
      refreshToken: 'tok-cancel-8s',
      accountEmail: 'client-cancel-8s@gmail.com',
      externalModelName: 'gemini-3.8-flash-tiered',
    } as any;

    const fakeReq = { url: '/v1internal:streamGenerateContent?alt=sse', method: 'POST', headers: {} } as any;
    const fakeSocket = { destroyed: true, writable: false };
    const fakeRes = new EventEmitter() as any;
    fakeRes.writableEnded = false;
    fakeRes.destroyed = true; // Client canceled
    fakeRes.headersSent = false;
    fakeRes.socket = fakeSocket;
    fakeRes.writeHead = vi.fn();
    fakeRes.write = vi.fn();
    fakeRes.end = vi.fn();

    // Mock Date.now to advance by 9000ms during request
    const realNow = Date.now;
    let callCount = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => {
      callCount++;
      return realNow() + (callCount > 3 ? 9000 : 0);
    });

    const result = await executeGoogleCloudCodeWithPool(
      fakeReq,
      fakeRes,
      {
        model: 'gemini-3.8-flash-tiered',
        request: { contents: [{ parts: [{ text: 'quick prompt' }] }] },
      },
      [acc],
      false,
      'conv-cancel-8s',
      'sess-cancel-8s',
    );

    expect(result).toBe(false);
    // Under old code, elapsedMs >= 8000 && !res.headersSent would have caused 120s cooldown!
    expect(isAccountInCooldown(acc, 'gemini')).toBe(false);
  });
});
