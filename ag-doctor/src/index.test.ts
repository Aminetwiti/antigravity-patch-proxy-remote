import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';

describe('ag-doctor CLI help handling', () => {
  let logSpy: MockInstance;

  beforeEach(() => {
    // main() is async; the help path prints to console and returns 0 without
    // touching the network or any command module.
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('`ag-doctor --help` prints usage instead of running the doctor', async () => {
    // Imported lazily so the heavy command modules only load when needed.
    const { main } = await import('./index');

    const code = await main(['--help']);

    expect(code).toBe(0);
    const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('Usage:');
    expect(output).toContain('ag-doctor [command] [options]');
    // Must NOT be a doctor run — the diagnostics banner starts with "[OK] Environment".
    expect(output).not.toContain('[OK] Environment');
  });

  it('`ag-doctor -h` prints usage as well', async () => {
    const { main } = await import('./index');

    const code = await main(['-h']);

    expect(code).toBe(0);
    const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('Usage:');
  });
});