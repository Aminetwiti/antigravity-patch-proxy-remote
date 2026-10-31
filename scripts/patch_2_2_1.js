#!/usr/bin/env node
/**
 * patch_2_2_1.js — Surgical patcher for Antigravity v2.2.x app.asar.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * VERSION DIFFERENCE (the WHY this script exists)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Antigravity 2.0.x / 2.1.0  ───────────────────────────────────────────────
 *   • Official bundle ships with `dist/proxy.js` + `dist/proxy/translators/`
 *   • `proxy-runner.js` lives at the root
 *   • `dist/main.js` has TLS bypass + `require('../proxy-runner')` integrated
 *   • Custom models work out of the box if proxy.js is configured
 *
 * Antigravity 2.2.x (since 2026-06)  ─────────────────────────────────────────
 *   • Google REMOVED `dist/proxy.js` + `dist/proxy/translators/` from the
 *     official bundle. The custom-model proxy code is NOT shipped anymore.
 *   • `proxy-runner.js` still present at the root (kept by Google as a hook)
 *   • `dist/main.js` still has TLS bypass + `require('../proxy-runner')`
 *   • But the proxy implementation is missing → proxy-runner loads
 *     `dist/proxy.js` → MODULE_NOT_FOUND
 *
 * What the patch needs to do for 2.2.x  ──────────────────────────────────────
 *   Re-inject ONLY the proxy implementation modules that 2.2.x dropped.
 *   In practice, only 3 modules are needed because everything else is
 *   already linked into `dist/proxy.js`:
 *
 *     dist/cryptoStore.js      (used by dist/proxy/modelLoader.js)
 *     dist/customModelStore.js (used by dist/ipcHandlers.js, customModelStore.ts)
 *     dist/schemaValidator.js  (used by dist/proxy/translators/*)
 *
 * What the patch does NOT do  ───────────────────────────────────────────────
 *   • Does NOT replace `dist/main.js` (the wrapper's version already has the
 *     TLS bypass + `require('../proxy-runner')` integration. Replacing it
 *     breaks the patch — see "lesson learned" below.)
 *   • Does NOT re-add `dist/proxy.js` (it's already in the wrapper).
 *   • Does NOT re-add `dist/proxy/translators/` (already in the wrapper).
 *   • Does NOT re-add `proxy-runner.js` at the root (already in the wrapper).
 *   • Does NOT include `dist/__mocks__/*` (vitest test mocks; would crash
 *     Electron module resolution if shipped in the production asar).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LESSON LEARNED (the WHY this is surgical, not full-overlay)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Earlier attempts (2026-07-10 v2 + 2026-07-11 recon) used a full-overlay
 * approach (`copyDir(repoDist, buildDist)`). This REPLACED the wrapper's
 * `dist/main.js` (14 554 B, with patch integration) with our repo's main.js
 * (17 157 B, without integration). Result:
 *   • TLS bypass gone → all HTTPS calls fail
 *   • `require('../proxy-runner')` gone → proxy never loads
 *   • `__mocks__/*` shipped in production asar → Electron module resolution
 *     picks them up → app crashes immediately on startup
 *
 * The fix: surgical copy of only the 3 missing modules.
 *
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Usage:
 *   node patch_2_2_1.js <asar-in> <build-dir> <asar-out>
 *
 *   <asar-in>   Path to the existing app.asar (typically the deployed one
 *               under %LOCALAPPDATA%\Programs\Antigravity\resources\)
 *   <build-dir> Staging directory for the patched contents (will be wiped
 *               and recreated — DO NOT point at anything you want to keep)
 *   <asar-out>  Where to write the patched asar
 *
 * Env:
 *   AG_REPO_DIR  Override the project root (default: parent of this script).
 *                The project must contain a built `dist/` with the 3 modules.
 *
 * Exit codes:
 *   0  Success
 *   1  Bad CLI args, missing input file, missing source modules
 *   2  require('electron') failed (Electron not in node_modules)
 *   3  asar.createPackage failed (repack error)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const asar = require('@electron/asar');

// ─── The 3 modules that v2.2.x dropped and we need to re-inject ────────────
// Listed with their optional .d.ts / .map siblings so the build is complete.
const MISSING_MODULES = [
  'cryptoStore',
  'customModelStore',
  'schemaValidator',
];

// Optional sibling files to copy alongside each .js module (silently
// skipped if not present in the repo's dist/).
const OPTIONAL_SIBLINGS = ['.d.ts', '.js.map', '.d.ts.map'];

function die(msg, code = 1) {
  console.error(`[patch_2_2_1] ${msg}`);
  process.exit(code);
}

function rimraf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function copyFileIfExists(src, dst) {
  if (!fs.existsSync(src)) return false;
  ensureDir(path.dirname(dst));
  fs.copyFileSync(src, dst);
  return true;
}

async function main() {
  const [, , asarIn, buildDir, asarOut] = process.argv;
  if (!asarIn || !buildDir || !asarOut) {
    die('usage: node patch_2_2_1.js <asar-in> <build-dir> <asar-out>');
  }
  if (!fs.existsSync(asarIn)) die(`asar-in not found: ${asarIn}`);

  const repoDir = process.env.AG_REPO_DIR
    || path.resolve(__dirname, '..', '..');
  const repoDist = path.join(repoDir, 'dist');

  if (!fs.existsSync(repoDist)) {
    die(`repo dist/ not found at ${repoDist} — run \`npm run build\` first`);
  }

  console.log(`[patch_2_2_1] asar-in   = ${asarIn}`);
  console.log(`[patch_2_2_1] build-dir = ${buildDir}`);
  console.log(`[patch_2_2_1] asar-out  = ${asarOut}`);
  console.log(`[patch_2_2_1] repo      = ${repoDir}`);

  // Step 1: extract the deployed asar (clean staging dir first)
  console.log('[patch_2_2_1] step 1/3 — extract');
  rimraf(buildDir);
  ensureDir(buildDir);
  asar.extractAll(asarIn, buildDir);

  // Step 2: SURGICAL copy — only the 3 modules v2.2.x dropped
  console.log(`[patch_2_2_1] step 2/3 — inject ${MISSING_MODULES.length} missing modules`);
  const buildDist = path.join(buildDir, 'dist');
  ensureDir(buildDist);

  let totalBytes = 0;
  let filesAdded = 0;
  for (const name of MISSING_MODULES) {
    // .js is required
    const srcJs = path.join(repoDist, `${name}.js`);
    const dstJs = path.join(buildDist, `${name}.js`);
    if (!fs.existsSync(srcJs)) {
      die(`required source missing: ${srcJs}\n` +
          `  (you may need to run \`npm run build\` in the repo first)`);
    }
    fs.copyFileSync(srcJs, dstJs);
    totalBytes += fs.statSync(srcJs).size;
    filesAdded++;
    console.log(`            + dist/${name}.js (${fs.statSync(srcJs).size} B)`);

    // .d.ts / .map are optional
    for (const ext of OPTIONAL_SIBLINGS) {
      const src = path.join(repoDist, `${name}${ext}`);
      if (copyFileIfExists(src, path.join(buildDist, `${name}${ext}`))) {
        totalBytes += fs.statSync(src).size;
        filesAdded++;
        console.log(`            + dist/${name}${ext} (${fs.statSync(src).size} B)`);
      }
    }
  }
  console.log(`            total: ${filesAdded} files, ${totalBytes} B`);

  // Step 3: repack
  console.log('[patch_2_2_1] step 3/3 — repack');
  if (fs.existsSync(asarOut)) fs.unlinkSync(asarOut);
  try {
    await asar.createPackage(buildDir, asarOut);
  } catch (err) {
    die(`asar.createPackage failed: ${err.stack || err.message}`, 3);
  }

  const inSize = fs.statSync(asarIn).size;
  const outSize = fs.statSync(asarOut).size;
  const delta = outSize - inSize;
  console.log(`[patch_2_2_1] done — ${asarOut}`);
  console.log(`            in:  ${inSize} B`);
  console.log(`            out: ${outSize} B (+${delta} B)`);
  if (delta > 100 * 1024) {
    console.warn(`[patch_2_2_1] WARNING: output grew by ${delta} B (>100 KB).`);
    console.warn('            This patcher should add only ~45 KB. If growth');
    console.warn('            is much larger, something else got copied — abort');
    console.warn('            and check the build-dir before deploying.');
  }
}

main().catch((err) => die(err.stack || err.message));
