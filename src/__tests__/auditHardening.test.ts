/**
 * auditHardening.test.ts
 * Regression guard for the three failles critiques identified in the adversarial audit:
 *  1. parseProto / parseProtoRaw must never enter an infinite loop on truncated/malformed buffers.
 *  2. notifySlotAvailable must follow FIFO and wake exactly one waiter per released slot.
 *  3. readBodyWithLimit must enforce the 5 MB ceiling and respond HTTP 413 on excess.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseProto, parseProtoRaw } from '../proxy/protobuf';
import {
  notifySlotAvailable,
  waitForAccountSlot,
  _clearSlotWaitersForTests,
  incrementAccountInFlight,
  decrementAccountInFlight,
  MAX_CONCURRENT_PER_ACCOUNT,
} from '../proxy/googlePool';
import { readBodyWithLimit } from '../proxy/bodyLimitGuard';
import type { CustomModel } from '../proxy/types';
import { EventEmitter } from 'events';
import type * as http from 'http';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeModel(overrides: Partial<CustomModel> = {}): CustomModel {
  return {
    name: 'test-model',
    displayName: 'Test Model',
    provider: 'google',
    apiUrl: 'https://test.example.com',
    apiKey: 'test-key',
    accountEmail: `test-${Math.random().toString(36).slice(2)}@example.com`,
    ...overrides,
  } as CustomModel;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`TIMEOUT after ${ms}ms: ${label}`)), ms);
    promise.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

// ─── VULN-01 : parseProto / parseProtoRaw Infinite Loop DoS ──────────────────

describe('VULN-01: parseProto hardening against truncated / malformed buffers', () => {
  it('terminates cleanly on wireType 2 where declared length exceeds buffer bounds', async () => {
    // Tag 0x0a = field 1, wireType 2; declared length 0x64 = 100, but only 2 bytes follow
    const malformed = Buffer.from([0x0a, 0x64, 0x01, 0x02]);
    const result = await withTimeout(
      Promise.resolve(parseProto(malformed, 0, malformed.length)),
      500,
      'parseProto must not block event loop',
    );
    // Must return a partial (clamped) result, not hang
    expect(Array.isArray(result)).toBe(true);
  });

  it('terminates cleanly on empty buffer', () => {
    const result = parseProto(Buffer.alloc(0), 0, 0);
    expect(result).toEqual([]);
  });

  it('terminates on a varint that consumes zero bytes (all-0x80 buffer without terminator)', async () => {
    const noTerminator = Buffer.alloc(10, 0x80);
    const result = await withTimeout(
      Promise.resolve(parseProto(noTerminator, 0, noTerminator.length)),
      500,
      'parseProto must handle varint with no terminator',
    );
    expect(Array.isArray(result)).toBe(true);
  });

  it('parseProtoRaw terminates on wireType 2 where length exceeds buffer', async () => {
    const malformed = Buffer.from([0x0a, 0x64, 0x01, 0x02]);
    const result = await withTimeout(
      Promise.resolve(parseProtoRaw(malformed, 0, malformed.length)),
      500,
      'parseProtoRaw must not block event loop',
    );
    expect(Array.isArray(result)).toBe(true);
  });

  it('parses a valid protobuf message correctly after hardening', () => {
    // Field 1, wireType 2, length 5, then 5 bytes of data
    const valid = Buffer.from([0x0a, 0x05, 0x68, 0x65, 0x6c, 0x6c, 0x6f]);
    const result = parseProto(valid, 0, valid.length);
    expect(result.length).toBe(1);
    expect(result[0].fieldNum).toBe(1);
    expect(result[0].wireType).toBe(2);
  });
});

// ─── VULN-02 : notifySlotAvailable Thundering Herd Fix ───────────────────────

describe('VULN-02: notifySlotAvailable FIFO — exactly one waiter resolved per call', () => {
  beforeEach(() => {
    _clearSlotWaitersForTests();
  });

  afterEach(() => {
    _clearSlotWaitersForTests();
  });

  it('resolves only the first waiter in queue when called once', async () => {
    const model = makeModel();
    // Saturate the account so both subsequent waits will queue
    for (let i = 0; i < MAX_CONCURRENT_PER_ACCOUNT; i++) incrementAccountInFlight(model);

    const p1 = waitForAccountSlot([model], undefined, 2000);
    const p2 = waitForAccountSlot([model], undefined, 2000);

    // Both are blocked — notify exactly once
    notifySlotAvailable();

    // p1 (first) must resolve true; p2 must still be pending within a short window
    const winner = await withTimeout(p1, 500, 'p1 should resolve');
    expect(winner).toBe(true);

    // p2 should NOT have resolved yet (it's still queued)
    let p2Resolved = false;
    p2.then(() => { p2Resolved = true; });
    await new Promise((r) => setTimeout(r, 50));
    expect(p2Resolved).toBe(false);

    // Cleanup
    notifySlotAvailable();
    await p2;
    for (let i = 0; i < MAX_CONCURRENT_PER_ACCOUNT; i++) decrementAccountInFlight(model);
  });

  it('resolves all waiters when notifySlotAvailable(all=true) is called', async () => {
    const model = makeModel();
    for (let i = 0; i < MAX_CONCURRENT_PER_ACCOUNT; i++) incrementAccountInFlight(model);

    const p1 = waitForAccountSlot([model], undefined, 2000);
    const p2 = waitForAccountSlot([model], undefined, 2000);

    notifySlotAvailable(true);

    const [r1, r2] = await withTimeout(Promise.all([p1, p2]), 500, 'both should resolve with all=true');
    expect(r1).toBe(true);
    expect(r2).toBe(true);
    for (let i = 0; i < MAX_CONCURRENT_PER_ACCOUNT; i++) decrementAccountInFlight(model);
  });
});

// ─── VULN-04 : readBodyWithLimit payload size enforcement ────────────────────

describe('VULN-04: readBodyWithLimit enforces payload ceiling with HTTP 413', () => {
  function makeFakeReq(chunks: Buffer[]): http.IncomingMessage {
    const emitter = new EventEmitter();
    const req = emitter as unknown as http.IncomingMessage;
    // Push chunks asynchronously via setImmediate
    setImmediate(() => {
      for (const chunk of chunks) emitter.emit('data', chunk);
      emitter.emit('end');
    });
    return req;
  }

  function makeFakeRes() {
    const ctx = { statusCode: 0, body: '' };
    const emitter = new EventEmitter();
    const res = emitter as unknown as http.ServerResponse;
    (res as any).headersSent = false;
    (res as any).writableEnded = false;
    (res as any).writeHead = (code: number) => {
      ctx.statusCode = code;
      (res as any).headersSent = true;
    };
    (res as any).end = (data?: string | Buffer) => {
      ctx.body = data ? data.toString() : '';
      (res as any).writableEnded = true;
    };
    (res as any).resume = () => {};
    return { res, ctx };
  }

  it('passes body under the limit through cleanly', async () => {
    const data = Buffer.from(JSON.stringify({ foo: 'bar' }));
    const req = makeFakeReq([data]);
    const { res } = makeFakeRes();
    const result = await readBodyWithLimit(req, res, 1024);
    expect(result).not.toBeNull();
    expect(result!.toString()).toBe(data.toString());
  });

  it('responds HTTP 413 and returns null when payload exceeds maxBytes', async () => {
    const bigChunk = Buffer.alloc(10_000, 'x');
    const req = makeFakeReq([bigChunk]);
    const { res, ctx } = makeFakeRes();
    const result = await readBodyWithLimit(req, res, 1024);
    expect(result).toBeNull();
    expect(ctx.statusCode).toBe(413);
  });

  it('accumulates across multiple chunks and enforces limit', async () => {
    const chunk1 = Buffer.alloc(600, 'a');
    const chunk2 = Buffer.alloc(600, 'b');
    const req = makeFakeReq([chunk1, chunk2]);
    const { res, ctx } = makeFakeRes();
    const result = await readBodyWithLimit(req, res, 1000);
    expect(result).toBeNull();
    expect(ctx.statusCode).toBe(413);
  });
});
