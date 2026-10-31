import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { IdleTimeoutError, IdleTimeoutGuard } from '../proxy/idleTimeout';

/**
 * Fake timers + a tiny PassThrough-backed Readable give us deterministic
 * control over chunk timing without spinning real setTimeout calls.
 */

function makeStream(): Readable {
  return new Readable({ read() { /* push happens from tests */ } });
}

describe('IdleTimeoutError', () => {
  it('has correct name, kind, and message', () => {
    const err = new IdleTimeoutError(1000, 'my-stream');
    expect(err.name).toBe('IdleTimeoutError');
    expect(err.kind).toBe('idle-timeout');
    expect(err.idleTimeoutMs).toBe(1000);
    expect(err.label).toBe('my-stream');
    expect(err.message).toContain('my-stream');
    expect(err.message).toContain('1000ms');
  });

  it('has reasonable message without label', () => {
    const err = new IdleTimeoutError(500);
    expect(err.message).toContain('500ms');
    expect(err.label).toBeUndefined();
  });

  it('is instanceof Error', () => {
    const err = new IdleTimeoutError(100);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(IdleTimeoutError);
  });
});

describe('IdleTimeoutGuard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Default Date.now to fake time.
    vi.setSystemTime(new Date(0));
  });
  afterEach(() => vi.useRealTimers());

  it('does not fire if data arrives before the timeout', () => {
    const s = new EventEmitter() as unknown as NodeJS.ReadableStream;
    let dataListeners = 0;
    (s as unknown as { on: (e: string, l: () => void) => void }).on = (e, l) => {
      if (e === 'data') dataListeners++;
      EventEmitter.prototype.on.call(s, e, l);
    };
    const onTimeout = vi.fn();
    const guard = new IdleTimeoutGuard(s, { idleTimeoutMs: 1000, onTimeout });

    // Simulate data arrival at 800ms (within 1000ms window).
    vi.advanceTimersByTime(800);
    s.emit('data', Buffer.from('chunk-1'));
    vi.advanceTimersByTime(800);
    s.emit('data', Buffer.from('chunk-2'));
    vi.advanceTimersByTime(800);
    s.emit('data', Buffer.from('chunk-3'));

    expect(onTimeout).not.toHaveBeenCalled();
    expect(dataListeners).toBeGreaterThanOrEqual(1);
    expect(guard.didFire()).toBe(false);
  });

  it('fires after idleTimeoutMs of inactivity', () => {
    const s = new EventEmitter() as unknown as NodeJS.ReadableStream;
    const onTimeout = vi.fn();
    const guard = new IdleTimeoutGuard(s, { idleTimeoutMs: 1000, onTimeout });

    s.emit('data', Buffer.from('chunk-1')); // arm timer
    vi.advanceTimersByTime(1500); // no more data → timeout fires

    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(onTimeout).toHaveBeenCalledWith(expect.any(IdleTimeoutError));
    expect(guard.didFire()).toBe(true);
  });

  it('resets timer on each chunk (per-chunk semantics)', () => {
    const s = new EventEmitter() as unknown as NodeJS.ReadableStream;
    const onTimeout = vi.fn();
    new IdleTimeoutGuard(s, { idleTimeoutMs: 1000, onTimeout });

    for (let i = 0; i < 10; i++) {
      s.emit('data', Buffer.from(`chunk-${i}`));
      vi.advanceTimersByTime(500); // half the timeout
    }
    // We've advanced 5 seconds total, but each chunk re-armed the timer.
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('disposes cleanly on stream end', () => {
    const s = new EventEmitter() as unknown as NodeJS.ReadableStream;
    const onTimeout = vi.fn();
    const guard = new IdleTimeoutGuard(s, { idleTimeoutMs: 1000, onTimeout });

    s.emit('data', Buffer.from('a'));
    s.emit('end');
    vi.advanceTimersByTime(5000);

    expect(onTimeout).not.toHaveBeenCalled();
    expect(guard.didFire()).toBe(false);
  });

  it('disposes cleanly on stream close', () => {
    const s = new EventEmitter() as unknown as NodeJS.ReadableStream;
    const onTimeout = vi.fn();
    const guard = new IdleTimeoutGuard(s, { idleTimeoutMs: 1000, onTimeout });

    s.emit('data', Buffer.from('a'));
    s.emit('close');
    vi.advanceTimersByTime(5000);

    expect(onTimeout).not.toHaveBeenCalled();
    expect(guard.didFire()).toBe(false);
  });

  it('dispose() is idempotent', () => {
    const s = new EventEmitter() as unknown as NodeJS.ReadableStream;
    const guard = new IdleTimeoutGuard(s, { idleTimeoutMs: 1000 });
    guard.dispose();
    guard.dispose();
    guard.dispose();
    expect(guard.didFire()).toBe(false);
  });

  it('fires only once even if multiple intervals elapse', () => {
    const s = new EventEmitter() as unknown as NodeJS.ReadableStream;
    const onTimeout = vi.fn();
    new IdleTimeoutGuard(s, { idleTimeoutMs: 1000, onTimeout });

    vi.advanceTimersByTime(1500);
    expect(onTimeout).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5000);
    expect(onTimeout).toHaveBeenCalledTimes(1); // still just once
  });

  it('includes label in the surfaced error', () => {
    const s = new EventEmitter() as unknown as NodeJS.ReadableStream;
    const onTimeout = vi.fn();
    new IdleTimeoutGuard(s, { idleTimeoutMs: 500, label: 'gpt-4', onTimeout });

    vi.advanceTimersByTime(600);

    const err = onTimeout.mock.calls[0][0] as IdleTimeoutError;
    expect(err.label).toBe('gpt-4');
    expect(err.message).toContain('gpt-4');
  });

  it('swallows onTimeout callback errors', () => {
    const s = new EventEmitter() as unknown as NodeJS.ReadableStream;
    const onTimeout = vi.fn(() => {
      throw new Error('callback boom');
    });
    new IdleTimeoutGuard(s, { idleTimeoutMs: 100, onTimeout });

    expect(() => vi.advanceTimersByTime(200)).not.toThrow();
    expect(onTimeout).toHaveBeenCalledOnce();
  });

  it('does not fire after dispose()', () => {
    const s = new EventEmitter() as unknown as NodeJS.ReadableStream;
    const onTimeout = vi.fn();
    const guard = new IdleTimeoutGuard(s, { idleTimeoutMs: 1000, onTimeout });

    guard.dispose();
    vi.advanceTimersByTime(2000);

    expect(onTimeout).not.toHaveBeenCalled();
  });
});
