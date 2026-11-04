import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import EventEmitter from 'events';
import fs from 'fs';

const mockSpawn = vi.fn();
vi.mock('child_process', () => ({
  spawn: (...args: any[]) => mockSpawn(...args),
}));

import { CliWorkerPool } from '../cliWorkerPool';
import { WORKER_CMD_TIMEOUT_MS } from '../../constants';

describe('CliWorkerPool', () => {
  let pool: CliWorkerPool;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockSpawn.mockReset();
  });

  afterEach(() => {
    if (pool) {
      pool.shutdown();
    }
  });

  it('returns error code -1 when CLI path does not exist', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    pool = new CliWorkerPool('/path/to/missing/cli.js');

    const result = await pool.run(['status']);
    expect(result.code).toBe(-1);
    expect(result.stderr).toContain('CLI not found');
  });

  it('spawns a worker and executes command when CLI path exists', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);

    const mockStdin = {
      write: vi.fn(),
      end: vi.fn(),
      on: vi.fn(),
    };

    const mockStdout = new EventEmitter();
    const mockStderr = new EventEmitter();

    const mockProc = new EventEmitter() as any;
    mockProc.pid = 9999;
    mockProc.stdin = mockStdin;
    mockProc.stdout = mockStdout;
    mockProc.stderr = mockStderr;
    mockProc.kill = vi.fn();

    mockSpawn.mockReturnValue(mockProc);

    pool = new CliWorkerPool('/path/to/cli.js');

    const runPromise = pool.run(['models']);

    expect(mockStdin.write).toHaveBeenCalledWith(expect.stringContaining('"models"'));
    mockStdout.emit('data', Buffer.from(JSON.stringify({ code: 0, stdout: 'model list ok', stderr: '' }) + '\n'));

    const result = await runPromise;
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('model list ok');
  });

  it('rejects pending command if worker closes unexpectedly', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);

    const mockStdin = {
      write: vi.fn(),
      end: vi.fn(),
      on: vi.fn(),
    };
    const mockStdout = new EventEmitter();
    const mockStderr = new EventEmitter();

    const mockProc = new EventEmitter() as any;
    mockProc.pid = 9998;
    mockProc.stdin = mockStdin;
    mockProc.stdout = mockStdout;
    mockProc.stderr = mockStderr;
    mockProc.kill = vi.fn();

    mockSpawn.mockReturnValue(mockProc);

    pool = new CliWorkerPool('/path/to/cli.js');

    const runPromise = pool.run(['diagnose'], 0);

    mockProc.emit('close');

    await expect(runPromise).rejects.toThrow('CLI worker closed unexpectedly');
  });

  it('kills worker and rejects when command execution times out', async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);

      const mockProc = new EventEmitter() as any;
      mockProc.pid = 7777;
      mockProc.stdin = { write: vi.fn(), end: vi.fn(), on: vi.fn() };
      mockProc.stdout = new EventEmitter();
      mockProc.stderr = new EventEmitter();
      mockProc.kill = vi.fn();

      mockSpawn.mockReturnValue(mockProc);

      pool = new CliWorkerPool('/path/to/cli.js');

      const runPromise = pool.run(['long-running-command'], 0);

      // Advance time beyond WORKER_CMD_TIMEOUT_MS
      vi.advanceTimersByTime(WORKER_CMD_TIMEOUT_MS + 500);

      await expect(runPromise).rejects.toThrow(/CLI worker timed out after 60s/);
      expect(mockProc.kill).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shuts down cleanly and empties workers and wait queue', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const mockProc = new EventEmitter() as any;
    mockProc.stdin = { write: vi.fn(), end: vi.fn(), on: vi.fn() };
    mockProc.stdout = new EventEmitter();
    mockProc.stderr = new EventEmitter();
    mockProc.kill = vi.fn();

    mockSpawn.mockReturnValue(mockProc);

    pool = new CliWorkerPool('/path/to/cli.js');
    pool.warmUp();

    expect((pool as any).workers.length).toBe(1);
    pool.shutdown();
    expect((pool as any).workers.length).toBe(0);
    expect(mockProc.kill).toHaveBeenCalled();
  });
});
