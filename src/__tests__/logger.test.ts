import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLogger, logger, type LogLevel } from '../logger';

describe('createLogger', () => {
  let spies: { error: ReturnType<typeof vi.spyOn>; warn: ReturnType<typeof vi.spyOn>; info: ReturnType<typeof vi.spyOn>; debug: ReturnType<typeof vi.spyOn> };

  beforeEach(() => {
    spies = {
      error: vi.spyOn(console, 'error').mockImplementation(() => undefined),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => undefined),
      info: vi.spyOn(console, 'info').mockImplementation(() => undefined),
      debug: vi.spyOn(console, 'debug').mockImplementation(() => undefined),
    };
  });

  afterEach(() => {
    spies.error.mockRestore();
    spies.warn.mockRestore();
    spies.info.mockRestore();
    spies.debug.mockRestore();
  });

  it('tags messages with the scope and ISO timestamp', () => {
    const log = createLogger('Proxy');
    log.info('hello');
    expect(spies.info).toHaveBeenCalledTimes(1);
    const [head] = spies.info.mock.calls[0];
    expect(head).toMatch(/^\d{4}-\d{2}-\d{2}T.*INFO \[Proxy\]$/);
  });

  it('routes severities to the right console method', () => {
    const log = createLogger('S');
    log.error('e');
    log.warn('w');
    log.info('i');
    log.debug('d');
    expect(spies.error).toHaveBeenCalledTimes(1);
    expect(spies.warn).toHaveBeenCalledTimes(1);
    expect(spies.info).toHaveBeenCalledTimes(1);
    expect(spies.debug).toHaveBeenCalledTimes(1);
  });

  it('composes nested scopes via child()', () => {
    const log = createLogger('Proxy').child('OpenAI');
    log.warn('mismatch');
    const [head] = spies.warn.mock.calls[0];
    expect(head).toMatch(/\[Proxy\.OpenAI\]$/);
  });

  it('handles multiple positional args', () => {
    const log = createLogger('X');
    log.info('count', 3, { ok: true });
    expect(spies.info).toHaveBeenCalledWith(expect.stringMatching(/INFO \[X\]$/), 'count', 3, { ok: true });
  });

  it('passes object payload as a single argument when meaningful', () => {
    const log = createLogger('X');
    log.info({ event: 'translate', model: 'gpt-4o' });
    expect(spies.info).toHaveBeenCalledWith(expect.stringMatching(/INFO \[X\]$/), { event: 'translate', model: 'gpt-4o' });
  });

  it('exposes a default logger', () => {
    expect(logger).toBeDefined();
    logger.info('default');
    expect(spies.info).toHaveBeenCalled();
  });

  it('does not infinite-recurse if loggers are called inside console itself', () => {
    const log = createLogger('Safe');
    log.error('fail');
    expect(spies.error).toHaveBeenCalledTimes(1);
  });
});

describe('logger child chain', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('supports arbitrary depth', () => {
    const log = createLogger('A').child('B').child('C');
    log.info('x');
    const [head] = (console.info as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(head).toMatch(/\[A\.B\.C\]$/);
  });
});

describe('LogLevel', () => {
  it('exposes the canonical levels', () => {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    expect(levels).toHaveLength(4);
  });
});
