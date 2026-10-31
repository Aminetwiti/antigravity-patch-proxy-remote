import { describe, it, expect } from 'vitest';
import {
  EmptyStreamGuard,
  EMPTY_STREAM_MIN_USEFUL_BYTES,
  EMPTY_STREAM_MIN_FRAME_BYTES,
} from '../proxy/emptyStream';

describe('emptyStream', () => {
  describe('constants', () => {
    it('exports sane thresholds', () => {
      expect(EMPTY_STREAM_MIN_USEFUL_BYTES).toBeGreaterThan(0);
      expect(EMPTY_STREAM_MIN_FRAME_BYTES).toBeGreaterThan(0);
    });
  });

  describe('isEmpty detection', () => {
    it('flags 200 + zero chunks as empty', () => {
      const guard = new EmptyStreamGuard();
      const verdict = guard.finalize({ statusCode: 200 });
      expect(verdict.isEmpty).toBe(true);
      expect(verdict.reason).toMatch(/zero chunks/);
      expect(verdict.rawChunkCount).toBe(0);
    });

    it('flags 200 + only [DONE] as empty', () => {
      const guard = new EmptyStreamGuard();
      guard.observe('data: [DONE]\n\n');
      const verdict = guard.finalize({ statusCode: 200 });
      expect(verdict.isEmpty).toBe(true);
      expect(verdict.reason).toMatch(/\[DONE\]/);
    });

    it('flags 200 + tiny non-data bytes as empty', () => {
      const guard = new EmptyStreamGuard();
      guard.observe('\n');
      guard.observe(' ');
      const verdict = guard.finalize({ statusCode: 200 });
      expect(verdict.isEmpty).toBe(true);
      expect(verdict.reason).toMatch(/byte/);
    });

    it('does NOT flag 200 with a real data frame', () => {
      const guard = new EmptyStreamGuard();
      guard.observe('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n');
      guard.observe('data: [DONE]\n\n');
      const verdict = guard.finalize({ statusCode: 200 });
      expect(verdict.isEmpty).toBe(false);
      expect(verdict.reason).toBe('non-empty');
      expect(verdict.sseFrameCount).toBe(1);
    });

    it('does NOT flag 200 with multi-frame payload', () => {
      const guard = new EmptyStreamGuard();
      guard.observe('data: {"choices":[{"delta":{"content":"a"}}]}\n\n');
      guard.observe('data: {"choices":[{"delta":{"content":"b"}}]}\n\n');
      guard.observe('data: [DONE]\n\n');
      const verdict = guard.finalize({ statusCode: 200 });
      expect(verdict.isEmpty).toBe(false);
      expect(verdict.sseFrameCount).toBe(2);
    });

    it('does NOT flag non-2xx responses (status code path takes over)', () => {
      const guard = new EmptyStreamGuard();
      const verdict = guard.finalize({ statusCode: 500 });
      expect(verdict.isEmpty).toBe(false);
      expect(verdict.reason).toBe('non-empty');
    });

    it('flags 204 with zero chunks as empty (204 is a successful status code with no body)', () => {
      const guard = new EmptyStreamGuard();
      const verdict = guard.finalize({ statusCode: 204 });
      expect(verdict.isEmpty).toBe(true);
      expect(verdict.reason).toMatch(/zero chunks/);
    });

    it('accepts statusCode as a string', () => {
      const guard = new EmptyStreamGuard();
      guard.observe('data: [DONE]\n\n');
      const verdict = guard.finalize({ statusCode: '200' });
      expect(verdict.isEmpty).toBe(true);
      expect(verdict.statusCode).toBe(200);
    });
  });

  describe('chunk accounting', () => {
    it('counts raw chunks correctly', () => {
      const guard = new EmptyStreamGuard();
      guard.observe('a');
      guard.observe('b');
      guard.observe('c');
      expect(guard.rawChunkCount).toBe(3);
    });

    it('counts bytes received', () => {
      const guard = new EmptyStreamGuard();
      guard.observe('hello');
      guard.observe('world');
      expect(guard.bytesReceived).toBe(10);
    });

    it('accepts Buffer chunks', () => {
      const guard = new EmptyStreamGuard();
      guard.observe(Buffer.from('data: {"x":1}\n\n'));
      const verdict = guard.finalize({ statusCode: 200 });
      expect(verdict.isEmpty).toBe(false);
      expect(verdict.sseFrameCount).toBe(1);
    });

    it('handles SSE frames spanning two chunks', () => {
      const guard = new EmptyStreamGuard();
      guard.observe('data: {"choices":[{"d');
      guard.observe('elta":{"content":"hi"}}]}\n\n');
      guard.observe('data: [DONE]\n\n');
      const verdict = guard.finalize({ statusCode: 200 });
      expect(verdict.isEmpty).toBe(false);
      expect(verdict.sseFrameCount).toBe(1);
    });

    it('flushes the trailing non-newline buffer on finalize', () => {
      const guard = new EmptyStreamGuard();
      // Last frame lacks a trailing newline.
      guard.observe('data: {"choices":[{"delta":{"content":"x"}}]}');
      const verdict = guard.finalize({ statusCode: 200 });
      expect(verdict.isEmpty).toBe(false);
      expect(verdict.sseFrameCount).toBe(1);
    });

    it('flags comment-only / heartbeat streams as empty', () => {
      const guard = new EmptyStreamGuard();
      guard.observe(': keep-alive\n\n');
      guard.observe('event: ping\n\n');
      guard.observe('id: 42\n\n');
      const verdict = guard.finalize({ statusCode: 200 });
      expect(verdict.isEmpty).toBe(true);
      expect(verdict.sseFrameCount).toBe(0);
      expect(verdict.reason).toMatch(/no data frames/);
    });

    it('ignores tiny data frames below MIN_FRAME_BYTES', () => {
      const guard = new EmptyStreamGuard();
      guard.observe('data: a\n\n');
      const verdict = guard.finalize({ statusCode: 200 });
      // Single-byte payload is below MIN_FRAME_BYTES → not counted.
      expect(verdict.sseFrameCount).toBe(0);
      expect(verdict.isEmpty).toBe(true);
    });
  });

  describe('reset', () => {
    it('clears all internal counters', () => {
      const guard = new EmptyStreamGuard();
      guard.observe('data: {"x":1}\n\n');
      guard.observe('data: [DONE]\n\n');
      guard.reset();
      expect(guard.rawChunkCount).toBe(0);
      expect(guard.sseFrameCount).toBe(0);
      expect(guard.bytesReceived).toBe(0);
      const verdict = guard.finalize({ statusCode: 200 });
      expect(verdict.isEmpty).toBe(true);
    });
  });

  describe('verdict shape', () => {
    it('returns all the fields', () => {
      const guard = new EmptyStreamGuard();
      guard.observe('data: {"x":1}\n\n');
      const verdict = guard.finalize({ statusCode: 200 });
      expect(verdict).toMatchObject({
        isEmpty: false,
        reason: 'non-empty',
        rawChunkCount: 1,
        sseFrameCount: 1,
        bytesReceived: expect.any(Number),
        statusCode: 200,
      });
    });
  });
});
