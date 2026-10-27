import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { Readable } from 'stream';
import { transformGoogleStreamForRemote } from '../proxy';

describe('transformGoogleStreamForRemote SSE Heartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('periodically emits SSE keep-alive ping when upstream is silent', async () => {
    const proxyRes = new Readable({ read() {} }) as any;
    proxyRes.headers = {};
    proxyRes.statusCode = 200;

    const writtenChunks: string[] = [];
    const clientRes = new EventEmitter() as any;
    clientRes.writeHead = vi.fn();
    clientRes.flush = vi.fn();
    clientRes.write = vi.fn((data: string) => {
      writtenChunks.push(data);
      return true;
    });
    clientRes.end = vi.fn();
    clientRes.writableEnded = false;
    clientRes.destroyed = false;

    transformGoogleStreamForRemote(proxyRes, clientRes, 'test-conv', false, 'gemini-3.8-flash');

    // Headers sent
    expect(clientRes.writeHead).toHaveBeenCalledWith(200, expect.any(Object));

    // Initially no chunks written
    expect(writtenChunks).toHaveLength(0);

    // Advance 3 seconds: heartbeat should fire and write ': ping\n\n'
    vi.advanceTimersByTime(3100);
    expect(writtenChunks).toContain(': ping\n\n');
    expect(clientRes.flush).toHaveBeenCalled();

    // Advance another 3 seconds: another heartbeat
    vi.advanceTimersByTime(3100);
    const pingCount = writtenChunks.filter((c) => c === ': ping\n\n').length;
    expect(pingCount).toBe(2);

    // When upstream sends real data, lastChunkTime is reset
    const sseChunk = 'data: {"response":{"candidates":[{"content":{"parts":[{"text":"hello"}]}}]}}\n\n';
    proxyRes.push(Buffer.from(sseChunk));

    // Advance 1 second: real data arrived, no new ping yet
    vi.advanceTimersByTime(1000);
    expect(writtenChunks.filter((c) => c === ': ping\n\n').length).toBe(2);

    // When stream ends, heartbeat timer is cleaned up
    proxyRes.push(null);
    await vi.advanceTimersByTimeAsync(50);
    expect(clientRes.end).toHaveBeenCalled();

    // Advance more time: no more pings written
    await vi.advanceTimersByTimeAsync(6000);
    expect(writtenChunks.filter((c) => c === ': ping\n\n').length).toBe(2);
  });

  it('stops heartbeat when client connection closes prematurely', () => {
    const proxyRes = new Readable({ read() {} }) as any;
    proxyRes.headers = {};
    proxyRes.statusCode = 200;

    const writtenChunks: string[] = [];
    const clientRes = new EventEmitter() as any;
    clientRes.writeHead = vi.fn();
    clientRes.write = vi.fn((data: string) => {
      writtenChunks.push(data);
      return true;
    });
    clientRes.end = vi.fn();
    clientRes.writableEnded = false;
    clientRes.destroyed = false;

    transformGoogleStreamForRemote(proxyRes, clientRes, 'test-conv', false, 'gemini-3.8-flash');

    vi.advanceTimersByTime(3100);
    expect(writtenChunks).toContain(': ping\n\n');

    // Client closes connection
    clientRes.writableEnded = true;
    clientRes.emit('close');

    vi.advanceTimersByTime(10000);
    // Ping count should stay at 1
    expect(writtenChunks.filter((c) => c === ': ping\n\n').length).toBe(1);
  });
});
