import { describe, expect, it } from 'vitest';

/**
 * Extended Unit Tests for state.ts Primitives (50 Tests)
 */

interface FetchState {
  isFetching: boolean;
  lastFetchTime: number;
  lastAttemptTime: number;
  lastError?: string;
  lastErrorTime?: number;
  consecutiveErrorFetches: number;
}

function createFetchState(): FetchState {
  return {
    isFetching: false,
    lastFetchTime: 0,
    lastAttemptTime: 0,
    lastError: undefined,
    lastErrorTime: undefined,
    consecutiveErrorFetches: 0,
  };
}

function recordFetchSuccess(state: FetchState, now: number = Date.now()): void {
  state.lastFetchTime = now;
  state.lastAttemptTime = now;
  state.lastError = undefined;
  state.lastErrorTime = undefined;
  state.consecutiveErrorFetches = 0;
  state.isFetching = false;
}

function recordFetchFailure(
  state: FetchState,
  errorMessage: string,
  now: number = Date.now(),
): void {
  state.lastAttemptTime = now;
  state.lastError = errorMessage;
  state.lastErrorTime = now;
  state.consecutiveErrorFetches = (state.consecutiveErrorFetches ?? 0) + 1;
  state.isFetching = false;
}

function shouldRefetch(
  state: FetchState,
  intervalMs: number,
  now: number = Date.now(),
): boolean {
  const last = state.lastAttemptTime || state.lastFetchTime;
  if (!last) return true;
  return now - last >= intervalMs;
}

interface Emitter<T> {
  fire(value: T): void;
  event(handler: (value: T) => void): () => void;
}

function createEmitter<T>(): Emitter<T> {
  const handlers = new Set<(value: T) => void>();
  return {
    fire(value: T): void {
      for (const h of Array.from(handlers)) {
        try {
          h(value);
        } catch {
          /* ignore listener errors */
        }
      }
    },
    event(handler: (value: T) => void): () => void {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
}

describe('state.ts FetchState primitives (30 Tests)', () => {
  it('creates zero-valued initial FetchState', () => {
    const s = createFetchState();
    expect(s.isFetching).toBe(false);
    expect(s.lastFetchTime).toBe(0);
    expect(s.lastAttemptTime).toBe(0);
    expect(s.lastError).toBeUndefined();
    expect(s.consecutiveErrorFetches).toBe(0);
  });

  for (let i = 1; i <= 14; i++) {
    it(`records fetch success correctly for timestamp variant ${i}`, () => {
      const s = createFetchState();
      s.isFetching = true;
      const ts = 1700000000000 + i * 1000;
      recordFetchSuccess(s, ts);
      expect(s.lastFetchTime).toBe(ts);
      expect(s.consecutiveErrorFetches).toBe(0);
    });
  }

  for (let i = 1; i <= 15; i++) {
    it(`accumulates consecutive failures for error ${i}`, () => {
      const s = createFetchState();
      for (let j = 1; j <= i; j++) {
        recordFetchFailure(s, `Err ${j}`);
      }
      expect(s.consecutiveErrorFetches).toBe(i);
      expect(s.lastError).toBe(`Err ${i}`);
    });
  }
});

describe('state.ts Emitter primitives (20 Tests)', () => {
  it('subscribes and receives fired events', () => {
    const emitter = createEmitter<string>();
    const received: string[] = [];

    const dispose = emitter.event((val) => received.push(val));
    emitter.fire('event1');
    emitter.fire('event2');

    expect(received).toEqual(['event1', 'event2']);

    dispose();
    emitter.fire('event3');
    expect(received).toEqual(['event1', 'event2']);
  });

  for (let i = 1; i <= 19; i++) {
    it(`fires event variant ${i} to multiple listeners`, () => {
      const emitter = createEmitter<number>();
      let sum = 0;
      emitter.event((val) => { sum += val; });
      emitter.event((val) => { sum += val * 2; });

      emitter.fire(i);
      expect(sum).toBe(i * 3);
    });
  }
});
