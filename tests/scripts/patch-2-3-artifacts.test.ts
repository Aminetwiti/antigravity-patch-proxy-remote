import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildPatchManifest } from '../../scripts/patch_2_3';

const {
  discoverJavaScriptFiles,
  assertRequiredArtifacts,
  copyRelativeFiles,
  validateAsarInventory,
} = require('../../scripts/lib/patch-2-3-artifacts');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'patch-2-3-artifacts-'));
}

function write(root: string, relativePath: string, content = '') {
  const target = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

describe('discoverJavaScriptFiles', () => {
  it('finds nested JavaScript files and excludes maps, declarations, and TypeScript', () => {
    const root = tempDir();
    write(root, 'idGenerator.js');
    write(root, 'errorClassifier.js');
    write(root, 'translators/openai.js');
    write(root, 'translators/openai.js.map');
    write(root, 'types.d.ts');
    write(root, 'source.ts');

    expect(discoverJavaScriptFiles(root)).toEqual([
      'errorClassifier.js',
      'idGenerator.js',
      'translators/openai.js',
    ]);
  });
});

describe('assertRequiredArtifacts', () => {
  it('reports every missing required build artifact', () => {
    const repoDir = tempDir();
    write(repoDir, 'dist/proxy.js');

    expect(() =>
      assertRequiredArtifacts(repoDir, [
        'dist/proxy.js',
        'dist/proxy/idGenerator.js',
        'dist/proxy/errorClassifier.js',
      ]),
    ).toThrow(
      'Missing required build artifacts: dist/proxy/errorClassifier.js, dist/proxy/idGenerator.js. Run npm run build before patching.',
    );
  });
});

describe('copyRelativeFiles', () => {
  it('preserves nested paths', () => {
    const source = tempDir();
    const destination = tempDir();
    write(source, 'proxy/idGenerator.js', 'id');
    write(source, 'proxy/translators/openai.js', 'openai');

    copyRelativeFiles(source, destination, [
      'proxy/idGenerator.js',
      'proxy/translators/openai.js',
    ]);

    expect(fs.readFileSync(path.join(destination, 'proxy', 'idGenerator.js'), 'utf8')).toBe('id');
    expect(
      fs.readFileSync(path.join(destination, 'proxy', 'translators', 'openai.js'), 'utf8'),
    ).toBe('openai');
  });
});

describe('validateAsarInventory', () => {
  it('rejects a candidate missing selected files', () => {
    const asarImpl = { listPackage: () => ['/dist/proxy.js', '/dist/proxy/idGenerator.js'] };
    expect(() =>
      validateAsarInventory(
        'candidate.asar',
        [
          'dist/proxy.js',
          'dist/proxy/idGenerator.js',
          'dist/proxy/errorClassifier.js',
        ],
        asarImpl,
      ),
    ).toThrow('Candidate ASAR is incomplete; missing: /dist/proxy/errorClassifier.js');
  });

  it('accepts a complete candidate inventory', () => {
    const asarImpl = {
      listPackage: () => [
        '/dist/proxy.js',
        '/dist/proxy/idGenerator.js',
        '/dist/proxy/errorClassifier.js',
      ],
    };
    expect(() =>
      validateAsarInventory(
        'candidate.asar',
        [
          'dist/proxy.js',
          'dist/proxy/idGenerator.js',
          'dist/proxy/errorClassifier.js',
        ],
        asarImpl,
      ),
    ).not.toThrow();
  });
  it('accepts Windows-style paths returned by @electron/asar', () => {
    const asarImpl = {
      listPackage: () => [
        '\\dist\\proxy.js',
        '\\dist\\proxy\\idGenerator.js',
        '\\dist\\proxy\\errorClassifier.js',
      ],
    };
    expect(() =>
      validateAsarInventory(
        'candidate.asar',
        [
          'dist/proxy.js',
          'dist/proxy/idGenerator.js',
          'dist/proxy/errorClassifier.js',
        ],
        asarImpl,
      ),
    ).not.toThrow();
  });
});

describe('buildPatchManifest', () => {
  it('includes the complete compiled proxy tree and critical modules', () => {
    const manifest = buildPatchManifest(path.resolve(__dirname, '../..'));
    expect(manifest).toContain('dist/proxy.js');
    expect(manifest).toContain('dist/proxy/idGenerator.js');
    expect(manifest).toContain('dist/proxy/errorClassifier.js');
    expect(manifest).toContain('dist/proxy/translators/openai.js');
    expect(manifest).toContain('dist/proxy/translators/anthropic.js');
    expect(manifest.some((entry: string) => entry.endsWith('.js.map'))).toBe(false);
    expect(manifest.some((entry: string) => entry.endsWith('.d.ts'))).toBe(false);
  });
});
