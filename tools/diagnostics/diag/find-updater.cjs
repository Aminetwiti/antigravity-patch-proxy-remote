#!/usr/bin/env node
// scripts/diag/find-updater.cjs — Search updater.js
const asar = require('@electron/asar');

const asarPath = 'C:/Users/amine/AppData/Local/Programs/Antigravity/resources/app.asar';
const content = asar.extractFile(asarPath, 'dist\\updater.js').toString('utf8');
const lines = content.split('\n');

console.log('=== dist/updater.js (' + lines.length + ' lines) ===');
console.log('Looking for powerSaveBlocker / Power save:');
for (let i = 0; i < lines.length; i++) {
  if (/powerSave|prevent-app/i.test(lines[i])) {
    console.log('  L' + (i + 1) + ': ' + lines[i]);
  }
}

// Also check the file's main exports
console.log('\n=== First 50 lines of updater.js ===');
for (let i = 0; i < Math.min(50, lines.length); i++) {
  console.log('  L' + (i + 1) + ': ' + lines[i]);
}

// Search the entire asar for "Power save blocker started" via binary
console.log('\n=== Search asar binary for "Power save" ===');
const allFiles = require('@electron/asar').listPackage(asarPath);
for (const f of allFiles) {
  try {
    const content = asar.extractFile(asarPath, f);
    const str = content.toString('binary');
    const idx = str.indexOf('Power save blocker');
    if (idx >= 0) {
      console.log('  HIT: ' + f + ' (binary) at offset ' + idx);
      console.log('    context: ' + str.substring(Math.max(0, idx - 50), idx + 100));
    }
  } catch (e) {}
}