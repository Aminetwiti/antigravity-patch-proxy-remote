#!/usr/bin/env node
/**
 * patch-version.js — version-agnostic dispatcher.
 *
 * Detects the installed Antigravity version (from app.asar's package.json)
 * and dispatches to the appropriate version-specific patcher:
 *
 *   2.0.x / 2.1.x  → full-overlay patch (repack.ps1 handles this)
 *   2.2.x          → scripts/patch_2_2_1.js  (3 missing modules)
 *   2.3.x / 2.4.x  → scripts/patch_2_3.js    (25 missing + 5 overwrites + 1 new)
 *   2.5.x          → scripts/patch_2_5.js    (25 missing + 5 overwrites + 1 new)
 *   other          → error with guidance
 *
 * Usage:
 *   node patch-version.js <asar-in> <build-dir> <asar-out>
 *
 * Same arguments as the version-specific scripts.
 */
'use strict';

const fs = require('fs');
const path = require('path');

// v2.4.x patch: Monkey-patch fs.readFileSync to bypass ENOENT on missing unpacked files 
// (e.g. chrome-devtools-mcp which is declared in ASAR header but missing from disk in v2.4.2)
// MUST BE BEFORE require('@electron/asar') because it caches fs methods
const originalReadFileSync = fs.readFileSync;
fs.readFileSync = function(pathStr, options) {
  try {
    return originalReadFileSync.apply(this, arguments);
  } catch (err) {
    if (err.code === 'ENOENT' && typeof pathStr === 'string' && pathStr.includes('.unpacked')) {
      return Buffer.alloc(0);
    }
    throw err;
  }
};

const asar = require('@electron/asar');

const [, , asarIn, buildDir, asarOut] = process.argv;
if (!asarIn || !buildDir || !asarOut) {
  console.error('usage: node patch-version.js <asar-in> <build-dir> <asar-out>');
  process.exit(1);
}
let actualAsarIn = asarIn;
if (path.resolve(asarIn) === path.resolve(asarOut) && fs.existsSync(`${asarIn}.bak`)) {
  actualAsarIn = `${asarIn}.bak`;
}
if (!fs.existsSync(actualAsarIn)) {
  console.error(`[patch-version] asar-in not found: ${actualAsarIn}`);
  process.exit(1);
}

/** Cheaply read the Antigravity version from an asar's package.json. */
function readAsarVersion(asarFile) {
  try {
    const raw = asar.extractFile(asarFile, 'package.json');
    const pkg = JSON.parse(raw.toString('utf8'));
    return pkg && typeof pkg.version === 'string' ? pkg.version : null;
  } catch (err) {
    return null;
  }
}

/** True when the asar already contains the injected proxy-runner overlay. */
function asarHasOverlay(asarFile) {
  try {
    const listFn = asar.listPackage ?? (asar.default || {}).listPackage;
    if (typeof listFn !== 'function') return false;
    // @electron/asar v4 lists entries with backslashes on Windows (e.g.
    // "\proxy-runner.js") — normalize to forward slashes like ag-doctor's
    // normalizeAsarEntry before matching.
    return (listFn(asarFile) || []).some((e) =>
      String(e).replace(/\\/g, '/').replace(/^\//, '').startsWith('proxy-runner.js'),
    );
  } catch {
    return false;
  }
}

// Guard: when surgery mode in==out falls back to `.bak`, the backup must be
// from the SAME Antigravity version as the current asar. An official update
// replaces app.asar but can leave an old `.bak` behind — rebuilding the
// overlay from that stale base would produce a wrong-version app.asar.
if (actualAsarIn !== asarIn) {
  const currentVersion = readAsarVersion(asarIn);
  const bakVersion = readAsarVersion(actualAsarIn);
  if (currentVersion && bakVersion && currentVersion !== bakVersion) {
    if (asarHasOverlay(asarIn)) {
      console.error(`[patch-version] app.asar.bak is from Antigravity ${bakVersion} but the current ` +
        `${path.basename(asarIn)} is ${currentVersion} AND already contains the proxy overlay.`);
      console.error(`[patch-version] Refusing to overwrite the backup. Restore a pristine ` +
        `${currentVersion} asar (e.g. reinstall or ag-doctor patch restore) and re-run.`);
      process.exit(1);
    }
    console.warn(`[patch-version] app.asar.bak is from Antigravity ${bakVersion} but the current ` +
      `${path.basename(asarIn)} is ${currentVersion} (official update?). Refreshing the backup from ` +
      `the current asar so the overlay uses the right base...`);
    fs.copyFileSync(asarIn, actualAsarIn);
    const curUnpacked = `${asarIn}.unpacked`;
    const bakUnpacked = `${actualAsarIn}.unpacked`;
    if (fs.existsSync(bakUnpacked)) fs.rmSync(bakUnpacked, { recursive: true, force: true });
    if (fs.existsSync(curUnpacked)) fs.cpSync(curUnpacked, bakUnpacked, { recursive: true });
    console.warn(`[patch-version] refreshed ${actualAsarIn} from current asar (v${currentVersion}).`);
  }
}

// Ensure .unpacked folder exists for actualAsarIn if app.asar.unpacked exists
const unpackedForIn = `${actualAsarIn}.unpacked`;
if (!fs.existsSync(unpackedForIn)) {
  const primaryUnpacked = path.join(path.dirname(actualAsarIn), 'app.asar.unpacked');
  if (fs.existsSync(primaryUnpacked)) {
    fs.cpSync(primaryUnpacked, unpackedForIn, { recursive: true });
    console.log(`[patch-version] synced ${primaryUnpacked} -> ${unpackedForIn}`);
  }
}

console.log(`[patch-version] reading ${actualAsarIn} ...`);

// Extract to a temp dir to read package.json
const probeDir = path.join(path.dirname(asarOut), `_probe-${Date.now()}`);
fs.mkdirSync(probeDir, { recursive: true });
try {
  asar.extractAll(actualAsarIn, probeDir);
} catch (err) {
  console.error(`[patch-version] extract failed: ${err.message}`);
  process.exit(1);
}

const pkgPath = path.join(probeDir, 'package.json');
let version = 'unknown';
try {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  version = pkg.version || 'unknown';
} catch (err) {
  console.error(`[patch-version] cannot read package.json: ${err.message}`);
}

// Clean up probe
fs.rmSync(probeDir, { recursive: true, force: true });

console.log(`[patch-version] detected Antigravity version: ${version}`);

// Dispatch
const scriptsDir = __dirname;
let targetScript;
let exitCode = 0;
// 2.5.x/2.6.x/2.7.x+ use the full overlay patcher; the explicit startsWith checks
// cover 2.5-2.9, while /^2\.[1-9]\d+\./ is a best-effort catch-all for future
// 2.10+ builds (the layout may change in newer majors — verify after applying).
if (version.startsWith('2.5.') || version.startsWith('2.6.') || version.startsWith('2.7.') || version.startsWith('2.8.') || version.startsWith('2.9.') || /^2\.[5-9]\./.test(version) || /^2\.[1-9]\d+\./.test(version)) {
  targetScript = path.join(scriptsDir, 'patch_2_5.js');
  console.log(`[patch-version] dispatching to patch_2_5.js (full overlay + modular JS modules) for Antigravity ${version}`);
} else if (version.startsWith('2.3.') || version.startsWith('2.4.')) {
  targetScript = path.join(scriptsDir, 'patch_2_3.js');
  console.log(`[patch-version] dispatching to patch_2_3.js (full overlay + modular JS modules) for Antigravity ${version}`);
} else if (version.startsWith('2.2.')) {
  targetScript = path.join(scriptsDir, 'patch_2_2_1.js');
  console.log(`[patch-version] dispatching to patch_2_2_1.js (3 missing modules)`);
} else if (version.startsWith('2.0.') || version.startsWith('2.1.')) {
  console.log(`[patch-version] Antigravity ${version} ships the full bundle — no overlay needed.`);
  console.log('  Use `repack.ps1` (full overlay) instead of patch-version.js.');
  process.exit(1);
} else {
  console.error(`[patch-version] Unsupported Antigravity version: ${version}`);
  console.error('  Known versions: 2.0.x, 2.1.x, 2.2.x, 2.3.x, 2.4.x, 2.5.x, 2.6.x, 2.7.x, 2.8.x+');
  console.error('  Update scripts/patch-version.js + create a new patch_<version>.js if needed.');
  process.exit(1);
}

if (!fs.existsSync(targetScript)) {
  console.error(`[patch-version] dispatcher script missing: ${targetScript}`);
  process.exit(1);
}

// Spawn the version-specific patcher
const { spawnSync } = require('child_process');
const result = spawnSync(process.execPath, [targetScript, actualAsarIn, buildDir, asarOut], {
  stdio: 'inherit',
});
exitCode = result.status ?? 1;
process.exit(exitCode);