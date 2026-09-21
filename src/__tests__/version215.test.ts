import { describe, it, expect } from 'vitest';
import { findPatchForVersion, PATCH_REGISTRY } from '../../ag-doctor/src/core/version-specific-patch';

describe('Antigravity Version 2.15 Support', () => {
  it('correctly matches Antigravity 2.15.0 to 2.6.0+ patch definition', () => {
    const patch = findPatchForVersion('2.15.0');
    expect(patch).not.toBeNull();
    expect(patch?.versionRange).toBe('2.6.0+');
    expect(patch?.minVersion).toBe('2.6.0');
    expect(patch?.maxVersion).toBeNull();
  });

  it('correctly matches Antigravity 2.15.99 patch definition', () => {
    const patch = findPatchForVersion('2.15.99');
    expect(patch).not.toBeNull();
    expect(patch?.versionRange).toBe('2.6.0+');
  });

  it('includes 2.15 in patch description', () => {
    const patch = findPatchForVersion('2.15.0');
    expect(patch?.description).toContain('2.15');
  });
});
