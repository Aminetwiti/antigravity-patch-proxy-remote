#!/usr/bin/env node
// scripts/diag/find-power5.cjs — Search all files for PowerSave / powerSave
const asar = require('@electron/asar');

const asarPath = 'C:/Users/amine/AppData/Local/Programs/Antigravity/resources/app.asar';
const list = asar.listPackage(asarPath);

console.log('=== Search ALL files (any extension) for "powerSave" ===');
let count = 0;
for (const f of list) {
  if (f.includes('test') || f.includes('__mocks__') || f.endsWith('.map')) continue;
  try {
    const content = asar.extractFile(asarPath, f).toString('binary');
    const str = content.toString('utf8');
    if (/powerSave/i.test(str)) {
      console.log('  HIT: ' + f);
      // Show context
      const lines = str.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/powerSave/i.test(lines[i])) {
          console.log('    L' + (i + 1) + ': ' + lines[i].substring(0, 200));
        }
      }
      count++;
    }
  } catch (e) {}
}
console.log('Total hits:', count);