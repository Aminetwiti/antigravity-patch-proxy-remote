#!/usr/bin/env node
// scripts/diag/find-power2.cjs — Find powerSaveBlocker in main.js
const asar = require('@electron/asar');

const asarPath = 'C:/Users/amine/AppData/Local/Programs/Antigravity/resources/app.asar';
const content = asar.extractFile(asarPath, 'dist\\main.js').toString('utf8');
const lines = content.split('\n');

for (let i = 0; i < lines.length; i++) {
  if (/powerSaveBlocker/i.test(lines[i])) {
    console.log('  L' + (i + 1) + ': ' + lines[i]);
  }
}
console.log('total lines:', lines.length);