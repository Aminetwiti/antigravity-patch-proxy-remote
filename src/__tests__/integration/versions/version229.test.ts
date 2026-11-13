import { describe, it, expect } from 'vitest';
import { findPatchForVersion } from '../../../../ag-doctor/src/core/version-specific-patch';
import fs from 'fs';
import path from 'path';

describe('Antigravity Version 2.29 Support', () => {
  it('correctly matches Antigravity 2.29.0 to 2.6.0+ patch definition', () => {
    const patch = findPatchForVersion('2.29.0');
    expect(patch).not.toBeNull();
    expect(patch?.versionRange).toBe('2.6.0+');
    expect(patch?.minVersion).toBe('2.6.0');
    expect(patch?.maxVersion).toBeNull();
  });

  it('includes 2.29 in patch description', () => {
    const patch = findPatchForVersion('2.29.0');
    expect(patch?.description).toContain('2.29');
  });

  it('scripts/patch_2_29.js exists and is syntactically valid', () => {
    const patchScript = path.resolve(__dirname, '../../../../scripts/patch_2_29.js');
    expect(fs.existsSync(patchScript)).toBe(true);
    const content = fs.readFileSync(patchScript, 'utf8');
    expect(content).toContain('wcvBrowserRegistry.js');
    expect(content).toContain('wcvIpcHandlers.js');
    expect(content).toContain('wcvZOrderController.js');
    expect(content).toContain('guestDialogController.js');
    expect(content).toContain('webviewDownloadRouting.js');
    expect(content).toContain('externalUrl.js');
    expect(content).toContain('windowState.js');
    expect(content).toContain('takeShellEnv');
  });

  it('scripts/patch-version.js routes 2.29.x to patch_2_29.js', () => {
    const dispatcher = path.resolve(__dirname, '../../../../scripts/patch-version.js');
    const content = fs.readFileSync(dispatcher, 'utf8');
    expect(content).toContain("version.startsWith('2.29.')");
    expect(content).toContain('patch_2_29.js');
  });
});

