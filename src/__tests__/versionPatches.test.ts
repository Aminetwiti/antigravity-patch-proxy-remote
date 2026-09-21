import { describe, it, expect } from 'vitest';
import { findPatchForVersion } from '../../ag-doctor/src/core/version-specific-patch';

describe('Antigravity Version Patch Registry Resolution', () => {
  it.each([
    ['2.14.0', '2.6.0+'],
    ['2.14.99', '2.6.0+'],
    ['2.15.0', '2.6.0+'],
    ['2.15.99', '2.6.0+'],
  ])('matches Antigravity %s to patch range %s', (version, expectedRange) => {
    const patch = findPatchForVersion(version);
    expect(patch).not.toBeNull();
    expect(patch?.versionRange).toBe(expectedRange);
  });
});
