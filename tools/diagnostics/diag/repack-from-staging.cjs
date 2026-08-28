#!/usr/bin/env node
/**
 * scripts/diag/repack-from-staging.cjs
 * Repack the already-extracted staging dir to the live asar.
 * Usage: takes the latest asar-repack-* dir under %TEMP% and repacks it.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const asar = require('@electron/asar');

const AG_RES = 'C:\\Users\\amine\\AppData\\Local\\Programs\\Antigravity\\resources';
const ASAR = path.join(AG_RES, 'app.asar');

const tempRoot = os.tmpdir();
const candidates = fs.readdirSync(tempRoot)
  .filter((n) => n.startsWith('asar-repack-') && n >= 'asar-repack-1784827')
  .sort();
if (candidates.length === 0) {
  console.error('no asar-repack-* staging dir found in %TEMP%');
  process.exit(1);
}
const staging = path.join(tempRoot, candidates[candidates.length - 1]);
console.log('using staging:', staging);

// Sanity check: schemaValidator should contain our patch
const sv = fs.readFileSync(path.join(staging, 'dist', 'schemaValidator.js'), 'utf8');
if (!sv.includes("models_")) {
  console.error('STAGING DOES NOT CONTAIN patched schemaValidator.js — aborting');
  process.exit(1);
}
console.log('schemaValidator patch verified: models_ found');

// Repack to a temp file then atomically swap.
const tmpAsar = ASAR + '.new';

// make sure no stale .new from previous run
try { fs.unlinkSync(tmpAsar); } catch {}

console.log('calling asar.createPackage...');
try {
  asar.createPackage(staging, tmpAsar);
} catch (e) {
  console.error('createPackage FAILED:');
  console.error('  message:', e.message);
  console.error('  code:', e.code);
  console.error('  errno:', e.errno);
  console.error('  stack:', e.stack);
  process.exit(1);
}
console.log('createPackage returned OK');

// wait a moment for file system flush
const end = Date.now() + 500;
while (Date.now() < end) { /* spin */ }

if (!fs.existsSync(tmpAsar)) {
  console.error('tmpAsar was not created at', tmpAsar);
  console.error('contents of staging:', fs.readdirSync(staging).slice(0, 20));
  process.exit(1);
}
console.log('repacked to', tmpAsar, '(', fs.statSync(tmpAsar).size, 'B )');

// Back up live asar
const backup = ASAR + '.pre-validator-fix-' + Date.now() + '.bak';
fs.copyFileSync(ASAR, backup);
console.log('backed up live asar →', backup);

// Atomic swap
fs.unlinkSync(ASAR);
fs.renameSync(tmpAsar, ASAR);
console.log('swapped asar →', ASAR, '(', fs.statSync(ASAR).size, 'B )');
