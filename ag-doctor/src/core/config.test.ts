/**
 * Unit tests for patch version-override helpers.
 *
 * These tests stub the on-disk profile path by setting HOME/userprofile via
 * `os.homedir()` so the config file lives in a temp dir for the duration of
 * the test run. Each test cleans up after itself.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

let tmpHome: string;

beforeEach(async () => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-doctor-cfg-'));
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  const { setPatchVersionOverride } = await import('./config');
  setPatchVersionOverride(null);
});

afterEach(() => {
  try {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('patch version override', () => {
  it('returns null override on first read', async () => {
    const { getPatchVersionOverride } = await import('./config');
    const ov = getPatchVersionOverride();
    expect(ov.range).toBeNull();
    expect(ov.reason).toBeNull();
    expect(ov.setAt).toBeNull();
  });

  it('sets and reads back an override', async () => {
    const { setPatchVersionOverride, getPatchVersionOverride } = await import('./config');
    setPatchVersionOverride('2.3.0+', 'auto-detect was wrong');
    const ov = getPatchVersionOverride();
    expect(ov.range).toBe('2.3.0+');
    expect(ov.reason).toBe('auto-detect was wrong');
    expect(typeof ov.setAt).toBe('string');
    expect(new Date(ov.setAt as string).toString()).not.toBe('Invalid Date');
  });

  it('rejects unknown range names', async () => {
    const { setPatchVersionOverride } = await import('./config');
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setPatchVersionOverride('not-a-real-range' as any),
    ).toThrowError(/Unknown patch range/);
  });

  it('clears override when passed null', async () => {
    const { setPatchVersionOverride, getPatchVersionOverride } = await import('./config');
    setPatchVersionOverride('2.2.0 - 2.2.x');
    expect(getPatchVersionOverride().range).toBe('2.2.0 - 2.2.x');
    setPatchVersionOverride(null);
    const cleared = getPatchVersionOverride();
    expect(cleared.range).toBeNull();
    expect(cleared.reason).toBeNull();
    expect(cleared.setAt).toBeNull();
  });

  it('clears override when passed empty string', async () => {
    const { setPatchVersionOverride, getPatchVersionOverride } = await import('./config');
    setPatchVersionOverride('2.0.1 - 2.1.x');
    expect(getPatchVersionOverride().range).toBe('2.0.1 - 2.1.x');
    setPatchVersionOverride('');
    expect(getPatchVersionOverride().range).toBeNull();
  });

  it('exposes KNOWN_PATCH_RANGES for the UI', async () => {
    const { KNOWN_PATCH_RANGES } = await import('./config');
    expect(KNOWN_PATCH_RANGES).toContain('2.0.1 - 2.1.x');
    expect(KNOWN_PATCH_RANGES).toContain('2.2.0 - 2.2.x');
    expect(KNOWN_PATCH_RANGES).toContain('2.3.0+');
  });

  it('isKnownPatchRange type-guard works', async () => {
    const { isKnownPatchRange } = await import('./config');
    expect(isKnownPatchRange('2.3.0+')).toBe(true);
    expect(isKnownPatchRange('garbage')).toBe(false);
    expect(isKnownPatchRange(undefined)).toBe(false);
    expect(isKnownPatchRange(42)).toBe(false);
  });
});