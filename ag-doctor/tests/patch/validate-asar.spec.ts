/**
 * Unit tests for `validateAsar()`.
 *
 * These tests stub `@electron/asar` so they can run anywhere — no real
 * asar archive is needed on disk for most cases. The "happy path" test
 * uses an in-memory fake archive created via `createFakeAsar`.
 *
 * IMPORTANT: We use Node's `require.cache` rather than `vi.mock(...)` to
 * substitute `@electron/asar`, because the SUT calls into the library with
 * CJS `require()` and vitest's `vi.mock` factory only hooks ESM imports.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

// Build the shared spy object up front. `vi.hoisted` lifts the ref so that
// the require-cache entry below (a normal CJS statement) sees the same
// object the test cases reference.
const hoisted = vi.hoisted(() => ({
  listPackage: vi.fn((_asarPath: string) => [] as unknown[]),
  extractFile: vi.fn((_asarPath: string, _file: string) => null as unknown),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const electronAsarPath = require.resolve('@electron/asar');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const electronAsarReal = require('@electron/asar');
// eslint-disable-next-line @typescript-eslint/no-var-requires
require.cache[electronAsarPath] = {
  id: electronAsarPath,
  filename: electronAsarPath,
  loaded: true,
  exports: {
    ...electronAsarReal,
    listPackage: hoisted.listPackage,
    extractFile: hoisted.extractFile,
  },
  // @ts-ignore - children/paths intentionally omitted for the stub
  children: [],
  // @ts-ignore
  paths: [],
};

import { validateAsar } from '../../src/commands/patch/validate-asar';

function tmpFile(name: string, size: number): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-doctor-validate-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, Buffer.alloc(size));
  return file;
}

describe('validateAsar', () => {
  beforeEach(() => {
    hoisted.listPackage.mockReset();
    hoisted.extractFile.mockReset();
    // Default: empty package, null extraction (caller must set up positive
    // mocks explicitly via `mockReturnValueOnce(...)` or `mockImplementation(...)`
    // when validations are needed).
    hoisted.listPackage.mockImplementation(() => []);
    hoisted.extractFile.mockImplementation(() => null);
  });

  it('blocks when the path does not exist', () => {
    const report = validateAsar(path.join(os.tmpdir(), 'definitely-missing-' + Date.now() + '.asar'));
    expect(report.verdict).toBe('block');
    expect(report.checks.some((c) => c.id === 'asar-exists' && c.status === 'fail')).toBe(true);
    expect(report.deltaSizeBytes).toBeNull();
    expect(report.asarSizeBytes).toBe(0);
  });

  it('blocks when the file is too small (< 500 KB)', () => {
    const tiny = tmpFile('tiny.asar', 100_000);
    const report = validateAsar(tiny);
    expect(report.verdict).toBe('block');
    expect(report.checks.find((c) => c.id === 'asar-exists')?.status).toBe('fail');
    expect(report.asarSizeBytes).toBe(100_000);
  });

  it('blocks when the archive has no dist/main.js', () => {
    const p = tmpFile('no-main.asar', 1_000_000);
    hoisted.listPackage.mockReturnValueOnce([
      '/package.json',
      '/dist/cryptoStore.js',
    ]);
    const report = validateAsar(p);
    expect(report.verdict).toBe('block');
    const mainCheck = report.checks.find((c) => c.id === 'main-js-present');
    expect(mainCheck?.status).toBe('fail');
  });

  it('blocks when dist/main.js size is way off (overlay-style 21 MB main.js)', () => {
    const p = tmpFile('huge-main.asar', 2_000_000);
    hoisted.listPackage.mockReturnValueOnce([
      '/package.json',
      '/dist/main.js',
      '/dist/cryptoStore.js',
    ]);
    // 21 MB main.js ⇒ 100× the expected size ⇒ fails the size check.
    // Size mismatch is now a *required* failure (escalates to 'block').
    hoisted.extractFile.mockReturnValueOnce(Buffer.alloc(21_000_000));
    const report = validateAsar(p);
    const mainCheck = report.checks.find((c) => c.id === 'main-js-present');
    expect(mainCheck?.status).toBe('fail');
    expect(mainCheck?.value).toBe(21_000_000);
    expect(mainCheck?.required).toBe(true);
    expect(report.verdict).toBe('block');
  });

  it('blocks when dist/cryptoStore.js is missing', () => {
    const p = tmpFile('no-crypto.asar', 1_000_000);
    hoisted.listPackage.mockReturnValueOnce([
      '/package.json',
      '/dist/main.js',
    ]);
    hoisted.extractFile.mockReturnValueOnce(Buffer.alloc(14_554));
    const report = validateAsar(p);
    expect(report.verdict).toBe('block');
    expect(report.checks.find((c) => c.id === 'crypto-store-present')?.status).toBe('fail');
  });

  it('blocks when dist/__mocks__/* entries are present', () => {
    const p = tmpFile('with-mocks.asar', 1_000_000);
    hoisted.listPackage.mockReturnValueOnce([
      '/package.json',
      '/dist/main.js',
      '/dist/cryptoStore.js',
      '/dist/__mocks__/auth.js',
      '/dist/__mocks__/user.js',
    ]);
    hoisted.extractFile.mockReturnValueOnce(Buffer.alloc(14_554));
    const report = validateAsar(p);
    expect(report.verdict).toBe('block');
    const mocksCheck = report.checks.find((c) => c.id === 'no-mocks');
    expect(mocksCheck?.status).toBe('fail');
    expect(mocksCheck?.value).toBe(2);
  });

  it('warns when delta vs live asar exceeds ±100 KB', () => {
    const p = tmpFile('live-delta.asar', 1_500_000);
    const live = tmpFile('live.asar', 1_000_000);
    hoisted.listPackage.mockReturnValueOnce([
      '/package.json',
      '/dist/main.js',
      '/dist/cryptoStore.js',
    ]);
    hoisted.extractFile.mockReturnValueOnce(Buffer.alloc(14_554));
    const report = validateAsar(p, live);
    const deltaCheck = report.checks.find((c) => c.id === 'delta-size');
    expect(deltaCheck?.status).toBe('fail');
    expect(deltaCheck?.value).toBe(500_000);
    expect(report.deltaSizeBytes).toBe(500_000);
    expect(report.verdict).toBe('warn');
  });

  it('reports ok when delta vs live is within ±100 KB', () => {
    const p = tmpFile('live-ok.asar', 1_020_000);
    const live = tmpFile('live2.asar', 1_000_000);
    hoisted.listPackage.mockReturnValueOnce([
      '/package.json',
      '/dist/main.js',
      '/dist/cryptoStore.js',
    ]);
    hoisted.extractFile.mockReturnValueOnce(Buffer.alloc(14_554));
    const report = validateAsar(p, live);
    const deltaCheck = report.checks.find((c) => c.id === 'delta-size');
    expect(deltaCheck?.status).toBe('ok');
    expect(report.deltaSizeBytes).toBe(20_000);
    expect(report.verdict).toBe('ok');
  });

  it('reports ok for a healthy surgical patch (nominal case)', () => {
    const p = tmpFile('healthy.asar', 1_000_000);
    hoisted.listPackage.mockReturnValueOnce([
      '/package.json',
      '/dist/main.js',
      '/dist/cryptoStore.js',
    ]);
    hoisted.extractFile.mockReturnValueOnce(Buffer.alloc(14_554));
    const report = validateAsar(p);
    expect(report.verdict).toBe('ok');
    expect(report.checks.every((c) => c.status === 'ok')).toBe(true);
    expect(report.asarSizeBytes).toBe(1_000_000);
  });

  it('returns null deltaSizeBytes when no live path is provided', () => {
    const p = tmpFile('no-live.asar', 1_000_000);
    hoisted.listPackage.mockReturnValueOnce([
      '/package.json',
      '/dist/main.js',
      '/dist/cryptoStore.js',
    ]);
    hoisted.extractFile.mockReturnValueOnce(Buffer.alloc(14_554));
    const report = validateAsar(p);
    expect(report.deltaSizeBytes).toBeNull();
    expect(report.checks.find((c) => c.id === 'delta-size')).toBeUndefined();
  });

  it('tolerates dist/main.js within ±10 % of expected size', () => {
    const p = tmpFile('tolerance.asar', 1_000_000);
    hoisted.listPackage.mockReturnValueOnce([
      '/package.json',
      '/dist/main.js',
      '/dist/cryptoStore.js',
    ]);
    // 13 500 B is just inside the -10 % boundary (≈ -7 %)
    hoisted.extractFile.mockReturnValueOnce(Buffer.alloc(13_500));
    const report = validateAsar(p);
    const mainCheck = report.checks.find((c) => c.id === 'main-js-present');
    expect(mainCheck?.status).toBe('ok');
    expect(report.verdict).toBe('ok');
  });
});
