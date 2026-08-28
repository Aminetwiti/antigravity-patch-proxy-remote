#!/usr/bin/env node
// scripts/diag/find-whenready.cjs — Dump whenReady block from deployed main.js
const asar = require('@electron/asar');

const asarPath = 'C:/Users/amine/AppData/Local/Programs/Antigravity/resources/app.asar';
const content = asar.extractFile(asarPath, 'dist/main.js').toString('utf8');
const lines = content.split('\n');

// Find the whenReady block
const wrIdx = lines.findIndex(l => /whenReady|whenReady\(\)/.test(l));
console.log('=== whenReady block (50 lines from L' + (wrIdx + 1) + ') ===');
for (let i = Math.max(0, wrIdx - 5); i < Math.min(wrIdx + 70, lines.length); i++) {
  console.log('  L' + (i + 1) + ': ' + lines[i]);
}

console.log('\n=== Lines 140-220 (entire async flow) ===');
for (let i = 139; i < Math.min(220, lines.length); i++) {
  console.log('  L' + (i + 1) + ': ' + lines[i]);
}