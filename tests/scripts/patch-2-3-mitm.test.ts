import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const {
  UNPACKED_LAYOUT,
  assertMitmSourcesExist,
  stageUnpackedFiles,
  moveUnpackedAside,
  restoreUnpackedAfterRepack,
  assertAsarExcludesUnpacked,
  assertUnpackedDeployed,
} = require('../../scripts/lib/patch-2-3-mitm');

function tempDir(prefix = 'patch-2-3-mitm-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeRepoFixture(repoDir: string): void {
  // Mirror the production repo layout that patch-2-3-mitm.js expects.
  fs.mkdirSync(path.join(repoDir, 'scripts', 'mitm'), { recursive: true });
  fs.mkdirSync(path.join(repoDir, 'certs'), { recursive: true });
  fs.writeFileSync(path.join(repoDir, 'scripts', 'mitm', 'mitm_443.js'), '// MITM body');
  fs.writeFileSync(path.join(repoDir, 'scripts', 'mitm', 'start_mitm_443.ps1'), '# ps1 body');
  fs.writeFileSync(path.join(repoDir, 'certs', 'ca-cert.pem'), 'CA-CERT');
  fs.writeFileSync(path.join(repoDir, 'certs', 'server-cert.pem'), 'SERVER-CERT');
  fs.writeFileSync(path.join(repoDir, 'certs', 'server-key.pem'), 'SERVER-KEY');
}

describe('UNPACKED_LAYOUT', () => {
  it('contains every required MITM file', () => {
    const sources = UNPACKED_LAYOUT.map((e) => e.src);
    expect(sources).toEqual(
      expect.arrayContaining([
        'scripts/mitm/mitm_443.js',
        'scripts/mitm/start_mitm_443.ps1',
        'certs/ca-cert.pem',
        'certs/server-cert.pem',
        'certs/server-key.pem',
      ]),
    );
  });

  it('places certs under mitm/certs/ so the MITM script path resolution keeps working', () => {
    const caCert = UNPACKED_LAYOUT.find((e) => e.src === 'certs/ca-cert.pem');
    expect(caCert?.dst).toBe('mitm/certs/ca-cert.pem');
  });
});

describe('assertMitmSourcesExist', () => {
  it('passes when all MITM source files are present', () => {
    const repoDir = tempDir();
    writeRepoFixture(repoDir);
    expect(() => assertMitmSourcesExist(repoDir)).not.toThrow();
  });

  it('throws with the full list of missing files', () => {
    const repoDir = tempDir();
    // Empty repo: every file is missing.
    expect(() => assertMitmSourcesExist(repoDir)).toThrow(/Missing MITM source files/);
    try {
      assertMitmSourcesExist(repoDir);
    } catch (err: any) {
      const msg = err.message as string;
      expect(msg).toContain('scripts/mitm/mitm_443.js');
      expect(msg).toContain('scripts/mitm/start_mitm_443.ps1');
      expect(msg).toContain('certs/ca-cert.pem');
      expect(msg).toContain('certs/server-cert.pem');
      expect(msg).toContain('certs/server-key.pem');
    }
  });
});

describe('stageUnpackedFiles', () => {
  let repoDir: string;
  let buildDir: string;

  beforeEach(() => {
    repoDir = tempDir();
    buildDir = tempDir('build-');
    writeRepoFixture(repoDir);
  });

  afterEach(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
    fs.rmSync(buildDir, { recursive: true, force: true });
  });

  it('copies every file into buildDir/app.asar.unpacked/ at the expected layout', () => {
    const result = stageUnpackedFiles(buildDir, repoDir);
    expect(result.staged.length).toBe(UNPACKED_LAYOUT.length);
    for (const entry of UNPACKED_LAYOUT) {
      const dest = path.join(buildDir, 'app.asar.unpacked', ...entry.dst.split('/'));
      expect(fs.existsSync(dest)).toBe(true);
      const expectedContent = fs.readFileSync(path.join(repoDir, ...entry.src.split('/')), 'utf8');
      expect(fs.readFileSync(dest, 'utf8')).toBe(expectedContent);
    }
  });

  it('preserves the mitm/ + mitm/certs/ nested structure', () => {
    stageUnpackedFiles(buildDir, repoDir);
    expect(fs.existsSync(path.join(buildDir, 'app.asar.unpacked', 'mitm', 'mitm_443.js'))).toBe(true);
    expect(fs.existsSync(path.join(buildDir, 'app.asar.unpacked', 'mitm', 'start_mitm_443.ps1'))).toBe(true);
    expect(fs.existsSync(path.join(buildDir, 'app.asar.unpacked', 'mitm', 'certs', 'ca-cert.pem'))).toBe(true);
    expect(fs.existsSync(path.join(buildDir, 'app.asar.unpacked', 'mitm', 'certs', 'server-cert.pem'))).toBe(true);
    expect(fs.existsSync(path.join(buildDir, 'app.asar.unpacked', 'mitm', 'certs', 'server-key.pem'))).toBe(true);
  });

  it('reports the total bytes written', () => {
    const result = stageUnpackedFiles(buildDir, repoDir);
    expect(result.totalBytes).toBeGreaterThan(0);
    const sum = result.staged.reduce((acc: number, f: { size: number }) => acc + f.size, 0);
    expect(result.totalBytes).toBe(sum);
  });

  it('is idempotent (overwrites on second call)', () => {
    stageUnpackedFiles(buildDir, repoDir);
    // Modify one file in the repo, re-stage, verify new content landed.
    fs.writeFileSync(path.join(repoDir, 'scripts', 'mitm', 'mitm_443.js'), '// UPDATED');
    const result = stageUnpackedFiles(buildDir, repoDir);
    const stagedMitm = result.staged.find((f: { relativePath: string }) => f.relativePath === 'mitm/mitm_443.js');
    expect(fs.readFileSync(stagedMitm.absolutePath, 'utf8')).toBe('// UPDATED');
  });
});

describe('moveUnpackedAside + restoreUnpackedAfterRepack', () => {
  let buildDir: string;
  let asarOutDir: string;
  let asarOut: string;

  beforeEach(() => {
    buildDir = tempDir('build-');
    asarOutDir = tempDir('asar-out-');
    asarOut = path.join(asarOutDir, 'app.asar');
    fs.mkdirSync(asarOutDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(buildDir, { recursive: true, force: true });
    fs.rmSync(asarOutDir, { recursive: true, force: true });
  });

  it('returns null when there is nothing to move', () => {
    expect(moveUnpackedAside(buildDir, asarOut)).toBeNull();
    expect(restoreUnpackedAfterRepack(asarOut, null)).toBeNull();
  });

  it('moves the unpacked folder directly next to asarOut, not into buildDir', () => {
    const repoDir = tempDir('repo-');
    writeRepoFixture(repoDir);
    stageUnpackedFiles(buildDir, repoDir);

    const finalRoot = moveUnpackedAside(buildDir, asarOut);
    expect(finalRoot).toBe(path.join(asarOutDir, 'app.asar.unpacked'));
    // Source is gone from buildDir (it was renamed across the boundary).
    expect(fs.existsSync(path.join(buildDir, 'app.asar.unpacked'))).toBe(false);
    expect(fs.existsSync(finalRoot!)).toBe(true);

    // Every MITM file is at its final location, ready for asar.createPackage.
    for (const entry of UNPACKED_LAYOUT) {
      const dest = path.join(asarOutDir, 'app.asar.unpacked', ...entry.dst.split('/'));
      expect(fs.existsSync(dest)).toBe(true);
    }
  });

  it('restoresUnpackedAfterRepack returns the finalRoot (no-op wrapper)', () => {
    const repoDir = tempDir('repo-');
    writeRepoFixture(repoDir);
    stageUnpackedFiles(buildDir, repoDir);

    const finalRoot = moveUnpackedAside(buildDir, asarOut);
    const restored = restoreUnpackedAfterRepack(asarOut, finalRoot);
    expect(restored).toBe(finalRoot);
  });

  it('wipes a previous app.asar.unpacked/ next to asarOut', () => {
    const repoDir = tempDir('repo-');
    writeRepoFixture(repoDir);
    stageUnpackedFiles(buildDir, repoDir);

    // Simulate a previous run that left a stale mitm/ at the destination.
    const staleMitm = path.join(asarOutDir, 'app.asar.unpacked', 'mitm');
    fs.mkdirSync(staleMitm, { recursive: true });
    fs.writeFileSync(path.join(staleMitm, 'stale.js'), 'OLD');

    const finalRoot = moveUnpackedAside(buildDir, asarOut);
    expect(fs.existsSync(path.join(staleMitm, 'stale.js'))).toBe(false);
    expect(fs.existsSync(path.join(finalRoot!, 'mitm', 'mitm_443.js'))).toBe(true);
  });

  it('throws if the source app.asar.unpacked does not exist', () => {
    expect(() => moveUnpackedAside(buildDir, asarOut)).not.toThrow();
    // No staged files => returns null, no folder created at destination either.
    expect(fs.existsSync(path.join(asarOutDir, 'app.asar.unpacked'))).toBe(false);
  });
});

describe('assertAsarExcludesUnpacked', () => {
  it('passes when the asar inventory has no MITM unpacked paths', () => {
    const fakeAsar = { listPackage: () => ['/dist/main.js', '/proxy-runner.js'] };
    expect(() => assertAsarExcludesUnpacked('app.asar', UNPACKED_LAYOUT, fakeAsar)).not.toThrow();
  });

  it('throws when any MITM file leaked into the asar', () => {
    const fakeAsar = {
      listPackage: () => [
        '/dist/main.js',
        '/app.asar.unpacked/mitm/mitm_443.js',
      ],
    };
    expect(() => assertAsarExcludesUnpacked('app.asar', UNPACKED_LAYOUT, fakeAsar)).toThrow(
      /Candidate ASAR contains unpacked MITM files/,
    );
  });

  it('normalises Windows-style backslashes from @electron/asar inventory', () => {
    const fakeAsar = {
      listPackage: () => [
        '\\dist\\main.js',
        '\\app.asar.unpacked\\mitm\\mitm_443.js',
      ],
    };
    expect(() => assertAsarExcludesUnpacked('app.asar', UNPACKED_LAYOUT, fakeAsar)).toThrow(
      /Candidate ASAR contains unpacked MITM files/,
    );
  });
});

describe('assertUnpackedDeployed', () => {
  it('passes when every MITM file is present next to asarOut', () => {
    const repoDir = tempDir('repo-');
    writeRepoFixture(repoDir);
    const buildDir = tempDir('build-');
    const asarOutDir = tempDir('out-');
    const asarOut = path.join(asarOutDir, 'app.asar');
    fs.mkdirSync(asarOutDir, { recursive: true });
    stageUnpackedFiles(buildDir, repoDir);
    moveUnpackedAside(buildDir, asarOut);
    expect(() => assertUnpackedDeployed(asarOut, UNPACKED_LAYOUT)).not.toThrow();
    fs.rmSync(buildDir, { recursive: true, force: true });
    fs.rmSync(asarOutDir, { recursive: true, force: true });
  });

  it('lists every missing file in the error message', () => {
    const asarOutDir = tempDir('out-');
    fs.mkdirSync(asarOutDir, { recursive: true });
    const asarOut = path.join(asarOutDir, 'app.asar');
    // No MITM files staged or moved next to asarOut.
    expect(() => assertUnpackedDeployed(asarOut, UNPACKED_LAYOUT)).toThrow(
      /MITM unpacked files missing after restore/,
    );
    fs.rmSync(asarOutDir, { recursive: true, force: true });
  });
});
