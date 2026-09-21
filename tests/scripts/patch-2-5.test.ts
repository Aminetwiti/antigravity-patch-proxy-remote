import { describe, expect, it } from 'vitest';
import path from 'path';
import fs from 'fs';
import { buildPatchManifest } from '../../scripts/patch_2_5';

describe('patch_2_5 manifest and artifact inventory', () => {
  const repoRoot = path.resolve(__dirname, '../..');

  it('builds a comprehensive manifest containing all 2.5 re-injected modules', () => {
    const manifest = buildPatchManifest(repoRoot);

    // 1. Must contain the core root proxy modules
    expect(manifest).toContain('dist/proxy.js');
    expect(manifest).toContain('dist/cryptoStore.js');
    expect(manifest).toContain('dist/customModelStore.js');
    expect(manifest).toContain('dist/schemaValidator.js');
    expect(manifest).toContain('proxy-runner.js');
    expect(manifest).toContain('constants.js');

    // 2. Must contain key proxy submodules
    expect(manifest).toContain('dist/proxy/circuitBreaker.js');
    expect(manifest).toContain('dist/proxy/retryBudget.js');
    expect(manifest).toContain('dist/proxy/errorClassifier.js');
    expect(manifest).toContain('dist/proxy/idGenerator.js');

    // 3. Must contain key preload and IPC files
    expect(manifest).toContain('dist/preload/types.js');
    expect(manifest).toContain('dist/preload/api.js');
  });

  it('ensures the manifest only includes JavaScript files without .ts, .map, or .d.ts', () => {
    const manifest = buildPatchManifest(repoRoot);

    for (const filePath of manifest) {
      expect(filePath.endsWith('.js')).toBe(true);
      expect(filePath.endsWith('.d.ts')).toBe(false);
      expect(filePath.endsWith('.map')).toBe(false);
    }
  });

  it('verifies that manifest targets actually exist in the compiled dist directory', () => {
    const manifest = buildPatchManifest(repoRoot);
    const missing: string[] = [];

    for (const relativePath of manifest) {
      const fullPath = path.join(repoRoot, relativePath);
      if (!fs.existsSync(fullPath)) {
        missing.push(relativePath);
      }
    }

    expect(missing).toEqual([]);
  });
});
