// patch-2-3-mitm.js — Bundle the Antigravity MITM forwarder into the
// patched app.asar so it can be auto-launched by proxy-runner.js.
//
// The MITM lives in `app.asar.unpacked/mitm/` (external to the asar) because:
//   1. Electron reads `app.asar.unpacked/` files from the real filesystem,
//      which is required by Node.js modules like `https`, `fs`, etc.
//   2. Antigravity's official unpacked convention is honoured: files placed
//      next to app.asar in `app.asar.unpacked/` are loadable via plain paths.
//
// @electron/asar@4.2.0 does NOT honour the `*.unpacked` convention automatically
// (verified empirically — files inside app.asar.unpacked/ end up packed inside
// the asar). This module works around it by staging files in
// `buildDir/app.asar.unpacked/`, then `moveUnpackedAside` removes them from
// the staging tree before `asar.createPackage` runs, and
// `restoreUnpackedAfterRepack` places them next to the final app.asar output.

const fs = require('fs');
const path = require('path');

// Files shipped into `app.asar.unpacked/mitm/`.
// Each entry is a repo-relative path (relative to the repo root).
const MITM_UNPACKED_FILES = [
  'scripts/mitm/mitm_443.js',
  'scripts/mitm/start_mitm_443.ps1',
  'certs/ca-cert.pem',
  'certs/server-cert.pem',
  'certs/server-key.pem',
];

// The directory name we use inside app.asar.unpacked.
const UNPACKED_MITM_DIR = 'mitm';

// `certs/*.pem` is mirrored at `mitm/certs/*.pem` so the MITM script's
// path resolution (certs/ relative to its own location) keeps working.
const UNPACKED_LAYOUT = [
  { src: 'scripts/mitm/mitm_443.js', dst: 'mitm/mitm_443.js' },
  { src: 'scripts/mitm/start_mitm_443.ps1', dst: 'mitm/start_mitm_443.ps1' },
  { src: 'certs/ca-cert.pem', dst: 'mitm/certs/ca-cert.pem' },
  { src: 'certs/server-cert.pem', dst: 'mitm/certs/server-cert.pem' },
  { src: 'certs/server-key.pem', dst: 'mitm/certs/server-key.pem' },
];

// Path used for the move-aside staging directory during repack.
// Kept here only as a defensive fallback; the normal flow moves the
// unpacked folder DIRECTLY to its final location next to the asar output,
// so @electron/asar.createPackage never sees it.
const STAGING_SUFFIX = '.asar-unpack-staging';

/**
 * Resolve repo-relative paths to absolute paths under repoDir.
 */
function resolveLayout(repoDir, layout) {
  return layout.map((entry) => ({
    src: path.join(repoDir, ...entry.src.split('/')),
    dstRelative: entry.dst,
    dstAbsolute: null, // set later by stage/copy functions
    srcRelative: entry.src,
  }));
}

function ensureCertsInRepo(repoDir, fsImpl = fs) {
  const certDir = path.join(repoDir, 'certs');
  fsImpl.mkdirSync(certDir, { recursive: true });
  const caKey = path.join(certDir, 'server-key.pem');
  const caCert = path.join(certDir, 'server-cert.pem');
  const caRoot = path.join(certDir, 'ca-cert.pem');
  if (!fsImpl.existsSync(caKey) || !fsImpl.existsSync(caCert) || !fsImpl.existsSync(caRoot)) {
    try {
      const { ensureCa } = require(path.join(repoDir, 'ag-doctor', 'dist', 'core', 'cert'));
      const ca = ensureCa();
      if (fsImpl.existsSync(ca.keyPath) && fsImpl.existsSync(ca.certPath)) {
        if (!fsImpl.existsSync(caKey)) fsImpl.copyFileSync(ca.keyPath, caKey);
        if (!fsImpl.existsSync(caCert)) fsImpl.copyFileSync(ca.certPath, caCert);
        if (!fsImpl.existsSync(caRoot)) fsImpl.copyFileSync(ca.certPath, caRoot);
      }
    } catch (_) {}
  }
}

/**
 * Validate that every repo source exists. Throws with the full list of
 * missing files if any are absent (matches the assertRequiredArtifacts style
 * used elsewhere in the patcher).
 */
function assertMitmSourcesExist(repoDir, fsImpl = fs) {
  ensureCertsInRepo(repoDir, fsImpl);
  const toPosix = (p) => p.replaceAll('\\', '/');
  const missing = UNPACKED_LAYOUT
    .map((entry) => path.join(repoDir, ...entry.src.split('/')))
    .filter((abs) => !fsImpl.existsSync(abs))
    .map((abs) => toPosix(path.relative(repoDir, abs)))
    .sort();
  if (missing.length > 0) {
    throw new Error(
      `Missing MITM source files for app.asar.unpacked: ${missing.join(', ')}. ` +
      `Ensure certs/ and scripts/mitm/ are present in the repo.`,
    );
  }
}

/**
 * Stage all MITM files into `buildDir/app.asar.unpacked/<dst>`.
 * Returns the list of staged absolute paths for later validation.
 */
function stageUnpackedFiles(buildDir, repoDir, fsImpl = fs) {
  const unpackedRoot = path.join(buildDir, 'app.asar.unpacked');
  const staged = [];
  let totalBytes = 0;
  for (const entry of resolveLayout(repoDir, UNPACKED_LAYOUT)) {
    const dest = path.join(unpackedRoot, ...entry.dstRelative.split('/'));
    fsImpl.mkdirSync(path.dirname(dest), { recursive: true });
    fsImpl.copyFileSync(entry.src, dest);
    const size = fsImpl.statSync(dest).size;
    totalBytes += size;
    staged.push({
      absolutePath: dest,
      relativePath: entry.dstRelative,
      size,
    });
  }
  return { unpackedRoot, staged, totalBytes };
}

/**
 * Move `buildDir/app.asar.unpacked/` to its final destination next to
 * `asarOut`, so `asar.createPackage(buildDir, asarOut)` will NOT include
 * the unpacked files in the asar.
 *
 * @electron/asar@4.2.0 does NOT honour the `*.unpacked` convention for
 * arbitrary prefixes — only literal `app.asar.unpacked/` is recognised
 * (and even that is unreliable, see assertAsarExcludesUnpacked). The
 * safest approach is to remove the folder entirely from the build tree
 * BEFORE createPackage, then restore it next to the output asar.
 *
 * Returns the final destination path on success. If `buildDir/app.asar.unpacked/`
 * doesn't exist, this is a no-op (returns null).
 */
function moveUnpackedAside(buildDir, asarOut, fsImpl = fs) {
  const unpackedRoot = path.join(buildDir, 'app.asar.unpacked');
  if (!fsImpl.existsSync(unpackedRoot)) return null;
  const asarOutDir = path.dirname(asarOut);
  // Wipe a previous app.asar.unpacked/ next to the asar (the unpacked
  // folder is fully reproduced from buildDir at every patch run).
  const finalRoot = path.join(asarOutDir, 'app.asar.unpacked');
  if (fsImpl.existsSync(finalRoot)) {
    fsImpl.rmSync(finalRoot, { recursive: true, force: true });
  }
  // Try rename first (fast, same-device). Falls back to recursive copy +
  // delete when renameSync throws EXDEV (cross-device link), which happens
  // when %TEMP% and %LOCALAPPDATA% are on different volumes or junctions.
  try {
    fsImpl.renameSync(unpackedRoot, finalRoot);
  } catch (err) {
    if (err.code === 'EXDEV') {
      fsImpl.cpSync(unpackedRoot, finalRoot, { recursive: true });
    } else {
      throw err;
    }
  }
  // CRITICAL: remove the unpacked folder from buildDir so createPackage
  // never sees it — even if the rename succeeded above, a stale staging
  // folder from a previous run could still be lingering.
  if (fsImpl.existsSync(unpackedRoot)) {
    fsImpl.rmSync(unpackedRoot, { recursive: true, force: true });
  }
  // Also clean up any stale staging-suffix folders from older patch runs.
  const staleStaging = path.join(buildDir, 'app.asar.unpacked' + STAGING_SUFFIX);
  if (fsImpl.existsSync(staleStaging)) {
    fsImpl.rmSync(staleStaging, { recursive: true, force: true });
  }
  return finalRoot;
}

/**
 * No-op for backward compatibility. Kept as a wrapper in case a future
 * caller chains moveUnpackedAside + restoreUnpackedAfterRepack manually.
 * The unpacked folder is now placed in its final location by
 * moveUnpackedAside directly, so there's nothing to restore.
 */
function restoreUnpackedAfterRepack(_asarOut, finalRoot) {
  return finalRoot;
}

/**
 * Validate that the asar inventory does NOT contain any of the MITM
 * unpacked paths. Defensive: if for some reason the asar library packs
 * the MITM (either at `app.asar.unpacked/mitm/...` or because an older
 * move-aside step left a `*.asar-unpack-staging` rename behind), we want
 * to fail loudly rather than ship an asar that duplicates the MITM.
 */
function assertAsarExcludesUnpacked(asarPath, layout, asarImpl) {
  const toPosix = (p) => '/' + p.replaceAll('\\', '/').replace(/^\/+/, '');
  const inventory = new Set(asarImpl.listPackage(asarPath).map(toPosix));
  const expected = layout.map((entry) => toPosix('app.asar.unpacked/' + entry.dst));
  const stagingLeak = layout.map((entry) => toPosix('app.asar.unpacked' + STAGING_SUFFIX + '/' + entry.dst));
  const leaks = expected.filter((p) => inventory.has(p))
    .concat(stagingLeak.filter((p) => inventory.has(p)));
  if (leaks.length > 0) {
    throw new Error(
      `Candidate ASAR contains unpacked MITM files: ${leaks.join(', ')}. ` +
      `This means the asar library packed app.asar.unpacked/ into the asar. ` +
      `Investigate @electron/asar version compatibility.`,
    );
  }
}

/**
 * Verify that every MITM file is present at the expected final location
 * (next to the deployed app.asar). Run after `restoreUnpackedAfterRepack`.
 */
function assertUnpackedDeployed(asarOut, layout, fsImpl = fs) {
  const toPosix = (p) => p.replaceAll('\\', '/');
  const asarOutDir = path.dirname(asarOut);
  const finalRoot = path.join(asarOutDir, 'app.asar.unpacked');
  const missing = layout
    .map((entry) => path.join(finalRoot, ...entry.dst.split('/')))
    .filter((abs) => !fsImpl.existsSync(abs))
    .map((abs) => toPosix(path.relative(asarOutDir, abs)))
    .sort();
  if (missing.length > 0) {
    throw new Error(
      `MITM unpacked files missing after restore: ${missing.join(', ')}. ` +
      `Expected under ${finalRoot}.`,
    );
  }
}

module.exports = {
  MITM_UNPACKED_FILES,
  UNPACKED_LAYOUT,
  assertMitmSourcesExist,
  stageUnpackedFiles,
  moveUnpackedAside,
  restoreUnpackedAfterRepack,
  assertAsarExcludesUnpacked,
  assertUnpackedDeployed,
};
