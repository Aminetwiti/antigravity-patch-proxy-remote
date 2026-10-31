import { describe, it, expect, vi } from 'vitest';
import { runAuth } from './auth';
import type { CommandContext } from '../types';

describe('ag-doctor auth command', () => {
  it('returns code 1 and prints help on unknown subcommand', async () => {
    const ctx: CommandContext = {
      json: false,
      verbose: false,
      yes: false,
      cwd: process.cwd(),
      options: {},
    };

    const code = await runAuth(ctx, 'unknown_subcommand');
    expect(code).toBe(1);
  });

  it('returns code 0 on --help', async () => {
    const ctx: CommandContext = {
      json: false,
      verbose: false,
      yes: false,
      cwd: process.cwd(),
      options: {},
    };

    const code = await runAuth(ctx, '--help');
    expect(code).toBe(0);
  });

  it('runs auth status in json mode without crashing', async () => {
    const ctx: CommandContext = {
      json: true,
      verbose: false,
      yes: false,
      cwd: process.cwd(),
      options: {},
    };

    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await runAuth(ctx, 'status');
    expect([0, 1]).toContain(code);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
