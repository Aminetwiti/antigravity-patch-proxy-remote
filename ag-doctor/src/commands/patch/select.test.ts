import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { CommandContext } from '../../types';

const mockState = vi.hoisted(() => ({
  override: {
    range: null as string | null,
    reason: null as string | null,
    setAt: null as string | null,
  },
}));

vi.mock('../../core/config', () => ({
  KNOWN_PATCH_RANGES: ['2.0.1 - 2.1.x', '2.2.0 - 2.2.x', '2.3.0+'],
  isKnownPatchRange: (value: unknown) =>
    typeof value === 'string' && ['2.0.1 - 2.1.x', '2.2.0 - 2.2.x', '2.3.0+'].includes(value),
  setPatchVersionOverride: (range: string | null, reason?: string) => {
    if (range == null || range === '') {
      mockState.override = { range: null, reason: null, setAt: null };
    } else if (!['2.0.1 - 2.1.x', '2.2.0 - 2.2.x', '2.3.0+'].includes(range)) {
      throw new Error(`Unknown patch range "${range}". Known: 2.0.1 - 2.1.x, 2.2.0 - 2.2.x, 2.3.0+`);
    } else {
      mockState.override = {
        range,
        reason: reason ?? null,
        setAt: new Date().toISOString(),
      };
    }
    return { patch: { versionOverride: mockState.override.range, overrideReason: mockState.override.reason, overrideSetAt: mockState.override.setAt } };
  },
  getPatchVersionOverride: () => mockState.override,
}));

function makeCtx(json = false): CommandContext {
  return {
    json,
    verbose: false,
    yes: false,
    cwd: process.cwd(),
    options: {},
  };
}

beforeEach(() => {
  mockState.override = { range: null, reason: null, setAt: null };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runPatchSelect', () => {
  it('returns usage error when no value is provided', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { runPatchSelect } = await import('./select');

    const code = await runPatchSelect(makeCtx(), undefined);

    expect(code).toBe(2);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('ag-doctor patch select <range|auto>'));
  });

  it('returns success for help', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { runPatchSelect } = await import('./select');

    const code = await runPatchSelect(makeCtx(), '--help');

    expect(code).toBe(0);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Known ranges:'));
  });

  it('sets a valid override with selector reason', async () => {
    const { runPatchSelect } = await import('./select');
    const { getPatchVersionOverride } = await import('../../core/config');

    const code = await runPatchSelect(makeCtx(), '2.2.0 - 2.2.x');
    const override = getPatchVersionOverride();

    expect(code).toBe(0);
    expect(override.range).toBe('2.2.0 - 2.2.x');
    expect(override.reason).toBe('set from patch selector');
    expect(typeof override.setAt).toBe('string');
  });

  it('clears the override in auto mode and returns json payload', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { runPatchSelect } = await import('./select');
    const { setPatchVersionOverride, getPatchVersionOverride } = await import('../../core/config');

    setPatchVersionOverride('2.3.0+', 'manual test');
    const code = await runPatchSelect(makeCtx(true), 'auto');

    expect(code).toBe(0);
    expect(getPatchVersionOverride().range).toBeNull();
    expect(logSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0] ?? '{}')) as {
      ok: boolean;
      mode: string;
      override: { range: string | null };
    };
    expect(payload.ok).toBe(true);
    expect(payload.mode).toBe('auto');
    expect(payload.override.range).toBeNull();
  });

  it('returns json error payload for an unknown range', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { runPatchSelect } = await import('./select');

    const code = await runPatchSelect(makeCtx(true), '9.9.x');

    expect(code).toBe(2);
    expect(logSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0] ?? '{}')) as {
      ok: boolean;
      error: string;
      knownRanges: string[];
    };
    expect(payload.ok).toBe(false);
    expect(payload.error).toContain('Unknown patch range');
    expect(payload.knownRanges).toContain('2.3.0+');
  });
});
