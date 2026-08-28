#!/usr/bin/env node
// scripts/diag/dump-after-port.cjs — Dump after startAndMonitor (lines 240-300)
const asar = require('@electron/asar');

const asarPath = 'C:/Users/amine/AppData/Local/Programs/Antigravity/resources/app.asar';
const content = asar.extractFile(asarPath, 'dist\\main.js').toString('utf8');
const lines = content.split('\n');

// Dump lines 240-300
console.log('=== Lines 240-300 (after startAndMonitor) ===');
for (let i = 239; i < Math.min(300, lines.length); i++) {
  console.log('  L' + (i + 1) + ': ' + lines[i].substring(0, 200));
}