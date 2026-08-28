#!/usr/bin/env node
// scripts/diag/find-power4.cjs — Find "Power save" string anywhere
const asar = require('@electron/asar');
const fs = require('fs');

const asarPath = 'C:/Users/amine/AppData/Local/Programs/Antigravity/resources/app.asar';
const list = asar.listPackage(asarPath);

console.log('=== Searching ALL .js files for "Power save" ===');
let count = 0;
for (const f of list) {
  if (!f.endsWith('.js') || f.includes('test') || f.includes('__mocks__')) continue;
  try {
    const content = asar.extractFile(asarPath, f).toString('utf8');
    if (/Power save/i.test(content)) {
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/Power save/i.test(lines[i])) {
          console.log('  ' + f + ' L' + (i + 1) + ': ' + lines[i]);
          count++;
        }
      }
    }
  } catch (e) {}
}
console.log('Total matches:', count);

// Also search for "powerSaveBlocker.start"
console.log('\n=== Searching ALL .js files for "powerSaveBlocker.start" ===');
count = 0;
for (const f of list) {
  if (!f.endsWith('.js') || f.includes('test') || f.includes('__mocks__')) continue;
  try {
    const content = asar.extractFile(asarPath, f).toString('utf8');
    if (/powerSaveBlocker\.start/i.test(content)) {
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/powerSaveBlocker\.start/i.test(lines[i])) {
          console.log('  ' + f + ' L' + (i + 1) + ': ' + lines[i]);
          count++;
        }
      }
    }
  } catch (e) {}
}
console.log('Total matches:', count);