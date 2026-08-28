#!/usr/bin/env node
// scripts/diag/dump-createwindow.cjs — Find createWindow call
const asar = require('@electron/asar');

const asarPath = 'C:/Users/amine/AppData/Local/Programs/Antigravity/resources/app.asar';
const content = asar.extractFile(asarPath, 'dist\\main.js').toString('utf8');
const lines = content.split('\n');

// Find createWindow
for (let i = 0; i < lines.length; i++) {
  if (/createWindow|onPortChanged|showOrCreateWindow/.test(lines[i])) {
    console.log('  L' + (i + 1) + ': ' + lines[i].substring(0, 200));
  }
}

// Find onPortChanged context
console.log('\n=== onPortChanged context (lines 220-245) ===');
for (let i = 219; i < Math.min(245, lines.length); i++) {
  console.log('  L' + (i + 1) + ': ' + lines[i].substring(0, 200));
}