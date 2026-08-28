#!/usr/bin/env node
// scripts/diag/dump-ls-top.cjs — First 250 lines + context around startProxy
const asar = require('@electron/asar');

const asarPath = 'C:/Users/amine/AppData/Local/Programs/Antigravity/resources/app.asar';
const content = asar.extractFile(asarPath, 'dist/languageServer.js').toString('utf8');
const lines = content.split('\n');

console.log('=== Lines 200-280 (around startProxy at pos 8413) ===');
for (let i = 199; i < Math.min(280, lines.length); i++) {
  console.log('  L' + (i + 1) + ': ' + lines[i]);
}

console.log('\n=== Lines 1-50 (top of file) ===');
for (let i = 0; i < Math.min(50, lines.length); i++) {
  console.log('  L' + (i + 1) + ': ' + lines[i]);
}