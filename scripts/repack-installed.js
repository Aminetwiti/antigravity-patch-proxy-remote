#!/usr/bin/env node
/**
 * repack-installed.js — Reliable zero-error repacker for installed Antigravity app.asar.
 *
 * Automatically resolves installed paths, staging directory, and auto-heal cache
 * using Node.js without PowerShell quote-escaping bugs.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const classicDir = path.join(localAppData, 'Programs', 'antigravity');
const asarPath = path.join(classicDir, 'resources', 'app.asar');
const patchScript = path.join(__dirname, 'patch-version.js');
const repoRoot = path.resolve(__dirname, '..');

if (!fs.existsSync(asarPath)) {
  console.error('[repack-installed] Error: app.asar not found at:', asarPath);
  process.exit(1);
}

// 1. Create backup if not already present
const bakPath = asarPath + '.bak';
if (!fs.existsSync(bakPath)) {
  console.log('[repack-installed] Creating backup:', bakPath);
  fs.copyFileSync(asarPath, bakPath);
}

// 2. Prepare staging directory
const stageDir = path.join(os.tmpdir(), 'ag-stage-' + Date.now());
if (fs.existsSync(stageDir)) {
  fs.rmSync(stageDir, { recursive: true, force: true });
}
fs.mkdirSync(stageDir, { recursive: true });

console.log('[repack-installed] Target asar:', asarPath);
console.log('[repack-installed] Staging dir:', stageDir);

try {
  // 3. Execute patch-version.js
  execFileSync(process.execPath, [patchScript, asarPath, stageDir, asarPath], {
    cwd: repoRoot,
    stdio: 'inherit',
  });

  // 4. Update auto-heal cache
  const scratchDir = path.join(os.homedir(), '.gemini', 'antigravity', 'scratch');
  if (!fs.existsSync(scratchDir)) {
    fs.mkdirSync(scratchDir, { recursive: true });
  }
  const cachePath = path.join(scratchDir, 'app.asar.patched');
  fs.copyFileSync(asarPath, cachePath);
  console.log('[repack-installed] Cached patched asar for auto-heal:', cachePath);

  console.log('[repack-installed] SUCCESS! app.asar repacked and deployed successfully.');
} catch (err) {
  console.error('[repack-installed] Failed to repack app.asar:', err);
  process.exit(1);
} finally {
  try {
    if (fs.existsSync(stageDir)) {
      fs.rmSync(stageDir, { recursive: true, force: true });
    }
  } catch (_) {}
}
