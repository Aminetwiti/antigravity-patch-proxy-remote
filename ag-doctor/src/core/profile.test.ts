import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  validateProfileName,
  resolveActiveProfile,
  setActiveProfile,
  profileExists,
  getActiveProfileFile,
} from './profile';

let tmpHome: string;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-profile-test-'));
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  delete process.env.AG_DOCTOR_PROFILE;
});

afterEach(() => {
  delete process.env.AG_DOCTOR_PROFILE;
  try {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('profile.ts name validation (15 tests)', () => {
  it('allows valid alphanumeric profile names', () => {
    expect(() => validateProfileName('dev')).not.toThrow();
    expect(() => validateProfileName('prod-patch')).not.toThrow();
    expect(() => validateProfileName('v2.2_test')).not.toThrow();
    expect(() => validateProfileName('profile1')).not.toThrow();
  });

  it('rejects empty profile name', () => {
    expect(() => validateProfileName('')).toThrow('Profile name is required');
  });

  it('rejects non-string profile name', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => validateProfileName(null as any)).toThrow('Profile name is required');
  });

  it('rejects profile names longer than 64 characters', () => {
    const longName = 'a'.repeat(65);
    expect(() => validateProfileName(longName)).toThrow('Profile name too long');
  });

  it('allows profile name exactly 64 characters long', () => {
    const valid64 = 'a'.repeat(64);
    expect(() => validateProfileName(valid64)).not.toThrow();
  });

  it('rejects profile names starting with non-alphanumeric characters', () => {
    expect(() => validateProfileName('-invalid')).toThrow('must start with alphanumeric');
    expect(() => validateProfileName('_invalid')).toThrow('must start with alphanumeric');
    expect(() => validateProfileName('.invalid')).toThrow('must start with alphanumeric');
  });

  it('rejects profile names containing spaces or special characters', () => {
    expect(() => validateProfileName('my profile')).toThrow('contain only');
    expect(() => validateProfileName('profile@1')).toThrow('contain only');
    expect(() => validateProfileName('profile!2')).toThrow('contain only');
  });

  it('rejects reserved profile name "default"', () => {
    expect(() => validateProfileName('default')).toThrow('is reserved');
  });

  it('rejects reserved profile name "global"', () => {
    expect(() => validateProfileName('global')).toThrow('is reserved');
  });
});

describe('profile.ts resolution hierarchy (10 tests)', () => {
  it('returns null when no CLI flag, env var, or active file exists', () => {
    expect(resolveActiveProfile()).toBeNull();
  });

  it('CLI flag takes highest priority over env var and file', () => {
    process.env.AG_DOCTOR_PROFILE = 'env-profile';
    expect(resolveActiveProfile('cli-profile')).toBe('cli-profile');
  });

  it('env var takes priority over active profile file', () => {
    process.env.AG_DOCTOR_PROFILE = 'env-profile';
    expect(resolveActiveProfile()).toBe('env-profile');
  });

  it('ignores reserved CLI flag "default"', () => {
    process.env.AG_DOCTOR_PROFILE = 'env-profile';
    expect(resolveActiveProfile('default')).toBe('env-profile');
  });

  it('ignores reserved CLI flag "global"', () => {
    process.env.AG_DOCTOR_PROFILE = 'env-profile';
    expect(resolveActiveProfile('global')).toBe('env-profile');
  });

  it('ignores reserved env var "default"', () => {
    process.env.AG_DOCTOR_PROFILE = 'default';
    expect(resolveActiveProfile()).toBeNull();
  });

  it('ignores reserved env var "global"', () => {
    process.env.AG_DOCTOR_PROFILE = 'global';
    expect(resolveActiveProfile()).toBeNull();
  });

  it('returns false for profileExists on uncreated profile', () => {
    expect(profileExists('nonexistent')).toBe(false);
  });

  it('clears active profile file when set to null', () => {
    setActiveProfile(null);
    expect(fs.existsSync(getActiveProfileFile())).toBe(false);
  });

  it('returns false for profileExists on invalid name without throwing', () => {
    expect(profileExists('-invalid-name')).toBe(false);
  });
});
